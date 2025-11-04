// @ts-check
import process from 'process';
import { fs, isFsAvailable } from './platform/fs.js';
import { path } from './platform/path.js';
import { EventEmitter } from './platform/events.js';
import { createStorePortProxyOverPlex } from './rpc.js';
import b4a from 'b4a';
import { ok } from './result/index.js';
import { loadRootEnv } from './env/index.js';
import { createLogger } from './log/index.js';
loadRootEnv();

const log = createLogger({ name: 'peer-pool', context: { subsystem: 'plex' } });

/**
 * Minimal Peer Pool with round-robin selection.
 * - Add peers created via createPeer(stream)
 * - Provide a StorePort proxy that selects a peer per call.
 *
 * Future hooks reserved: weights, token buckets, health, circuit breakers.
 */
export function createPeerPool () {
  const TRACE_PATH = process.env.PLEX_POOL_TRACE_PATH;
  const TRACE = process.env.PLEX_POOL_TRACE === '1' || !!TRACE_PATH;
  let callSeq = 0;
  let traceStream;

  function trace (event, payload) {
    if (!TRACE) return;
    const json = JSON.stringify(payload);
    const line = `[peer-pool][trace] ${event} ${json}`;
    try { console.log(line); } catch {}
    if (!TRACE_PATH || !isFsAvailable) return;
    try {
      if (!traceStream) {
        try { fs.mkdirSync(path.dirname(TRACE_PATH), { recursive: true }); } catch {}
        traceStream = fs.createWriteStream(TRACE_PATH, { flags: 'a' });
        process.once('exit', () => { try { traceStream?.end(); } catch {} });
      }
      traceStream.write(`${new Date().toISOString()} ${line}\n`);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      log.warn('peer-pool trace append failed', error);
    }
  }

  const events = new EventEmitter();
  events.setMaxListeners(0);

  /** @type {Array<{ id:number, peer:any, weight:number, meta?:{ source?:string, locality?:string }, inFlight:number, failures:number, successes:number, latencyMs:number, cooldownUntil:number, clients:Map<string, any> }>} */
  const peers = [];
  let rr = 0;
  let nextId = 1;
  const COOLDOWN_MS = 2000;
  const LAT_EWMA_A = 0.2; // latency EMA alpha

  function add (peer, { weight = 1, meta } = {}) {
    const entry = { id: nextId++, peer, weight, meta, inFlight: 0, failures: 0, successes: 0, latencyMs: 1, cooldownUntil: 0, clients: new Map() };
    peers.push(entry);
    events.emit('peer-add', summarizePeer(entry));
    return { dispose: () => remove(peer) };
  }

  function remove (peer) {
    const i = peers.findIndex(p => p.peer === peer);
    if (i >= 0) {
      for (const c of peers[i].clients.values()) { try { c.destroy?.(); } catch {} }
      events.emit('peer-remove', summarizePeer(peers[i]));
      peers.splice(i, 1);
      if (rr >= peers.length) rr = 0;
    }
  }

  function now () { return Date.now(); }

  function eligiblePeers () {
    const n = now();
    return peers.filter(p => n >= p.cooldownUntil);
  }

  function baseLocalityWeight (p) {
    const loc = p.meta?.locality;
    if (loc === 'local') return 8;
    if (loc === 'lan') return 4;
    return 1; // wan/default
  }

  function effectiveWeight (p, prefer) {
    let w = p.weight * baseLocalityWeight(p);
    if (prefer === 'local' && p.meta?.locality === 'local') w *= 2;
    // simple health penalties
    w = w / (1 + p.failures);
    w = w / (1 + p.latencyMs / 20); // 20ms target baseline
    return Math.max(0.0001, w);
  }

  function pickRoundRobin (list) {
    if (list.length === 0) return null;
    const p = list[rr++ % list.length];
    if (rr > 1e9) rr = rr % list.length;
    return p;
  }

  function pickWeighted (list, prefer) {
    if (list.length === 0) return null;
    let sum = 0;
    const weights = list.map(p => { const w = effectiveWeight(p, prefer); sum += w; return w; });
    let r = Math.random() * sum;
    for (let i = 0; i < list.length; i++) { r -= weights[i]; if (r <= 0) return list[i]; }
    return list[list.length - 1];
  }

  function hashKey (keyBytes) {
    // djb2
    let h = 5381;
    for (let i = 0; i < keyBytes.length; i++) h = ((h << 5) + h) + keyBytes[i];
    return h >>> 0;
  }

  function pickSticky (list, keyBytes) {
    if (list.length === 0) return null;
    if (!keyBytes || keyBytes.length === 0) return pickRoundRobin(list);
    const h = hashKey(keyBytes);
    const idx = h % list.length;
    return list[idx];
  }

  function pick ({ policy = 'round-robin', prefer, keyBytes } = {}) {
    const list = eligiblePeers();
    if (list.length === 0) return null;
    if (policy === 'weighted') return pickWeighted(list, prefer);
    if (policy === 'sticky') return pickSticky(list, keyBytes);
    return pickRoundRobin(list);
  }

  function keyOf (id, lane) {
    const hex = id ? b4a.toString(id, 'hex') : '';
    return `${hex}::${lane || 'rpc'}`;
  }

  function getClient (entry, id, lane, eagerOpen) {
    const k = keyOf(id, lane);
    let cli = entry.clients.get(k);
    if (!cli) {
      const duplex = lane ? entry.peer.connectLane(id, lane, { eagerOpen }) : entry.peer.connectRpc(id, { eagerOpen });
      cli = createStorePortProxyOverPlex({ duplex });
      entry.clients.set(k, cli);
    }
    return cli;
  }

  function connectStorePort ({ id, lane, eagerOpen = false, policy = 'round-robin', keyFn, prefer } = {}) {
    const selectEntry = (method, opts) => {
      const keyBytes = typeof keyFn === 'function' ? normalizeKey(keyFn(opts)) : undefined;
      const entry = pick({ policy, prefer, keyBytes });
      const callId = ++callSeq;
      const key = keyBytes ? toShortHex(keyBytes) : undefined;
      if (!entry) {
        trace('call.noPeer', { id: callId, method, policy, prefer, key });
        events.emit('call', { type: 'no-peer', id: callId, method, policy, prefer, key, ts: Date.now() });
        throw new Error('PeerPool: no peers available');
      }
      trace('call.pick', { id: callId, method, peerId: entry.id, policy, prefer, key });
      return { entry, callId };
    };

    const callUnary = (method) => async (opts) => {
      const { entry, callId } = selectEntry(method, opts);
      const cli = getClient(entry, id, lane, eagerOpen);
      if (typeof cli[method] !== 'function') {
        const error = new Error(`Peer client missing method ${method}`);
        entry.failures += 1;
        entry.cooldownUntil = now() + COOLDOWN_MS;
        trace('call.error', { id: callId, method, peerId: entry.id, message: error.message });
        throw error;
      }
      const started = now();
      entry.inFlight += 1;
      try {
        const result = await cli[method](opts);
        const dur = now() - started;
        entry.latencyMs = entry.latencyMs * (1 - LAT_EWMA_A) + dur * LAT_EWMA_A;
        if (result && typeof result.ok === 'boolean') {
          if (result.ok) entry.successes += 1;
          else entry.failures += 1;
        } else {
          entry.successes += 1;
        }
        trace('call.complete', { id: callId, method, peerId: entry.id, ok: result?.ok, durMs: dur });
        events.emit('peer-stats', summarizePeer(entry));
        events.emit('call', { type: 'complete', peerId: entry.id, method, ok: result?.ok, durMs: dur });
        return result;
      } catch (error) {
        entry.failures += 1;
        entry.cooldownUntil = now() + COOLDOWN_MS;
        trace('call.error', { id: callId, method, peerId: entry.id, message: String(error?.message || error) });
        events.emit('peer-stats', summarizePeer(entry));
        events.emit('call', { type: 'error', peerId: entry.id, method, message: String(error?.message || error) });
        throw error;
      } finally {
        entry.inFlight = Math.max(0, entry.inFlight - 1);
      }
    };

    const callStream = (method) => (opts) => {
      const { entry, callId } = selectEntry(method, opts);
      const cli = getClient(entry, id, lane, eagerOpen);
      if (typeof cli[method] !== 'function') {
        entry.failures += 1;
        entry.cooldownUntil = now() + COOLDOWN_MS;
        const error = new Error(`Peer client missing method ${method}`);
        trace('call.error', { id: callId, method, peerId: entry.id, message: error.message });
        throw error;
      }
      const iterator = cli[method](opts);
      if (!iterator || typeof iterator[Symbol.asyncIterator] !== 'function') {
        entry.failures += 1;
        entry.cooldownUntil = now() + COOLDOWN_MS;
        const error = new Error(`Method ${method} must return an AsyncIterable`);
        trace('call.error', { id: callId, method, peerId: entry.id, message: error.message });
        throw error;
      }
      const started = now();
      entry.inFlight += 1;
      let lastOk = null;

      const wrapped = (async function * () {
        let thrown;
        try {
          for await (const env of iterator) {
            try { if (env && typeof env.ok === 'boolean') lastOk = env.ok; } catch {}
            yield env;
          }
        } catch (err) {
          thrown = err;
          throw err;
        } finally {
          entry.inFlight = Math.max(0, entry.inFlight - 1);
          const dur = now() - started;
          entry.latencyMs = entry.latencyMs * (1 - LAT_EWMA_A) + dur * LAT_EWMA_A;
          if (thrown) {
            entry.failures += 1;
            entry.cooldownUntil = now() + COOLDOWN_MS;
            trace('call.error', { id: callId, method, peerId: entry.id, message: String(thrown?.message || thrown) });
            events.emit('peer-stats', summarizePeer(entry));
            events.emit('call', { type: 'error', peerId: entry.id, method, message: String(thrown?.message || thrown) });
          } else {
            if (lastOk === false) entry.failures += 1;
            else entry.successes += 1;
            trace('call.complete', { id: callId, method, peerId: entry.id, ok: lastOk, durMs: dur });
            events.emit('peer-stats', summarizePeer(entry));
            events.emit('call', { type: 'complete', peerId: entry.id, method, ok: lastOk, durMs: dur });
          }
        }
      })();

      return wrapped;
    };

    return {
      get: callUnary('get'),
      put: callUnary('put'),
      del: callUnary('del'),
      append: callUnary('append'),
      scan: callStream('scan'),
      async waitReady () {},
      async close () { close(); return ok(); },
      async destroy () { destroy(); return ok(); }
    };
  }

  function normalizeKey (k) {
    if (!k) return undefined;
    if (b4a.isBuffer(k)) return k;
    if (typeof k === 'string') return b4a.from(k);
    if (k instanceof Uint8Array) return k;
    try { return b4a.from(String(k)); } catch { return undefined; }
  }

  function toShortHex (u8) {
    if (!u8) return undefined;
    const hex = b4a.toString(u8, 'hex');
    return hex.length > 32 ? `${hex.slice(0, 32)}...` : hex;
  }

  function close () { for (const e of peers) for (const c of e.clients.values()) { try { c.close?.(); } catch {} } }
  function destroy () { for (const e of peers) for (const c of e.clients.values()) { try { c.destroy?.(); } catch {} } }

  function summarizePeer (entry) {
    return {
      id: entry.id,
      weight: entry.weight,
      meta: entry.meta,
      inFlight: entry.inFlight,
      failures: entry.failures,
      successes: entry.successes,
      latencyMs: entry.latencyMs,
      cooldownUntil: entry.cooldownUntil
    };
  }

  function stats () {
    return peers.map(summarizePeer);
  }

  return { add, remove, connectStorePort, close, destroy, stats, events };
}
