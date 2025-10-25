// @ts-check
import b4a from 'b4a';
import { utf8 } from './bytes/index.js';
import { serveStorePortOverPlex, createStorePortProxyOverPlex } from './rpc.js';

/**
 * Derive a stable service id (bytes) from namespace/name/version.
 * Deterministic, human-readable, not cryptographic. Callers can override as needed.
 * @param {string|Uint8Array} namespace
 * @param {string|Uint8Array} name
 * @param {string|number|Uint8Array} version
 */
export function deriveId(namespace, name, version) {
  const ns = b4a.isBuffer(namespace) ? /** @type {Uint8Array} */ (namespace) : utf8.encode(String(namespace ?? ''));
  const nm = b4a.isBuffer(name) ? /** @type {Uint8Array} */ (name) : utf8.encode(String(name ?? ''));
  const ver = b4a.isBuffer(version) ? /** @type {Uint8Array} */ (version) : utf8.encode(String(version ?? ''));
  return b4a.concat([utf8.encode('svc:'), ns, utf8.encode('/'), nm, utf8.encode('/'), ver]);
}

/**
 * Expose a Store Port over a peer's RPC lane.
 * @param {ReturnType<import('./peer.js').createPeer>} peer
 * @param {{ id:Uint8Array, lane?:string, eagerOpen?:boolean }} cfg
 * @param {{ get?:(o:any)=>Promise<any>, put?:(o:any)=>Promise<any>, del?:(o:any)=>Promise<any>, append?:(o:any)=>Promise<any>, scan?:(o:any)=>AsyncIterable<any> }} port
 */
export function exposeStorePort(peer, { id, lane, eagerOpen = false }, port) {
  const duplex = lane ? peer.listenLane(id, lane, { eagerOpen }) : peer.listenRpc(id, { eagerOpen });
  const server = serveStorePortOverPlex({ duplex, port: normalizeStorePort(port) });
  return {
    dispose() {
      try { duplex.destroy?.(); } catch {}
      server.close?.();
    }
  };
}

/**
 * Connect to a Store Port exposed over a peer.
 * @param {ReturnType<import('./peer.js').createPeer>} peer
 * @param {{ id:Uint8Array, lane?:string, eagerOpen?:boolean }} cfg
 */
export function connectStorePort(peer, { id, lane, eagerOpen = false }) {
  const duplex = lane ? peer.connectLane(id, lane, { eagerOpen }) : peer.connectRpc(id, { eagerOpen });
  return createStorePortProxyOverPlex({ duplex });
}

export function withStoreCaps(store, token) {
  if (!token) return store;
  const capsBytes = token instanceof Uint8Array ? token : b4a.from(String(token));

  const inject = (opts = {}) => {
    if (!opts || typeof opts !== 'object') return { caps: capsBytes };
    if (opts.caps && opts.caps !== capsBytes) return { ...opts, caps: capsBytes };
    return { ...opts, caps: capsBytes };
  };

  const wrapped = {
    async get(opts) { return store.get?.(inject(opts)); },
    async put(opts) { return store.put?.(inject(opts)); },
    async del(opts) { return store.del?.(inject(opts)); },
    async append(opts) { return store.append?.(inject(opts)); },
    scan(opts) { return store.scan?.(inject(opts)); },
    async close() { return store.close?.(); },
    async destroy() { return store.destroy?.(); },
    unwrap() { return store.unwrap?.() ?? store; }
  };

  return wrapped;
}

function normalizeStorePort(port = {}) {
  if (typeof port !== 'object') throw new TypeError('Store port must be an object');
  const adapted = {};
  if (typeof port.get === 'function') adapted.get = port.get.bind(port);
  if (typeof port.put === 'function') adapted.put = port.put.bind(port);
  if (typeof port.del === 'function') adapted.del = port.del.bind(port);
  if (typeof port.append === 'function') adapted.append = port.append.bind(port);
  if (typeof port.scan === 'function') {
    adapted.scan = async function* (opts) {
      for await (const env of port.scan.call(this, opts)) {
        yield env;
      }
    };
  }
  if (typeof port.close === 'function') adapted.close = port.close.bind(port);
  if (typeof port.destroy === 'function') adapted.destroy = port.destroy.bind(port);
  return adapted;
}
