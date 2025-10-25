// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import b4a from 'b4a';
import c from 'compact-encoding';
import { ok, err, CODES } from './result/index.js';
import { encodeU16LE, decodeU16LE, encodeU32LE, decodeU32LE, encodeBool, decodeBool } from './bytes/index.js';
import { getReqCodec, delReqCodec, putReqCodec, appendReqCodec, scanReqCodec } from './protocol/store.js';
import { loadRootEnv } from './env/index.js';
import { createLogger } from './log/index.js';
loadRootEnv();

const log = createLogger({ name: 'plex-rpc', context: { subsystem: 'plex' } });
const clientLog = log.child({ channel: 'client' });
const serverLog = log.child({ channel: 'server' });
const STALL_WARN_MS = Number(process.env.PLEX_RPC_CLIENT_STALL_WARN_MS || 0);
const PENDING_LOG_MS = Number(process.env.PLEX_RPC_PENDING_LOG_MS || 0);
const DEFAULT_CLIENT_TIMEOUT_MS = Number(process.env.PLEX_RPC_CLIENT_TIMEOUT_MS || 0);
const ORPHAN_TTL_MS = Number(process.env.PLEX_RPC_ORPHAN_TTL_MS || 2000);
const DEFAULT_MAX_REQ_BYTES = 256 * 1024;
const envMax = Number(process.env.PLEX_RPC_MAX_REQUEST_BYTES);
const MAX_REQ_BYTES = Number.isFinite(envMax) && envMax > 0 ? envMax : DEFAULT_MAX_REQ_BYTES;
const DEFAULT_MAX_CLIENT_ROUTES = 256;
const DEFAULT_MAX_SERVER_ROUTES = 256;

function resolveRouteLimit(raw, fallback) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const num = Number(raw);
  if (!Number.isFinite(num) || num < 0) return fallback;
  return num;
}

function getMaxClientRoutes() {
  return resolveRouteLimit(process.env.PLEX_RPC_MAX_CLIENT_ROUTES, DEFAULT_MAX_CLIENT_ROUTES);
}

function getMaxServerRoutes() {
  return resolveRouteLimit(process.env.PLEX_RPC_MAX_SERVER_ROUTES, DEFAULT_MAX_SERVER_ROUTES);
}

// Frame type constants
const FT_REQ = 0;
const FT_RES = 1;
const FT_CANCEL = 2;

const FT_REQ_BUF = new Uint8Array([FT_REQ]);
const FT_RES_BUF = new Uint8Array([FT_RES]);
const FT_CANCEL_BUF = new Uint8Array([FT_CANCEL]);

// Method ids (StorePort v1)
const MID_GET = 0;
const MID_PUT = 1;
const MID_DEL = 2;
const MID_SCAN = 3;
const MID_APPEND = 4;

export const METHOD = { GET: MID_GET, PUT: MID_PUT, DEL: MID_DEL, SCAN: MID_SCAN };

const MID_NAME = {
  [MID_GET]: 'GET',
  [MID_PUT]: 'PUT',
  [MID_DEL]: 'DEL',
  [MID_SCAN]: 'SCAN',
  [MID_APPEND]: 'APPEND'
};

const EMPTY = new Uint8Array(0);

const encReq = {
  [MID_GET]: (o) => c.encode(getReqCodec.cSchema, o || {}),
  [MID_DEL]: (o) => c.encode(delReqCodec.cSchema, o || {}),
  [MID_PUT]: (o) => c.encode(putReqCodec.cSchema, o || {}),
  [MID_APPEND]: (o) => c.encode(appendReqCodec.cSchema, o || {}),
  [MID_SCAN]: (o) => c.encode(scanReqCodec.cSchema, o || {})
};

const decReq = {
  [MID_GET]: (buf) => c.decode(getReqCodec.cSchema, buf),
  [MID_DEL]: (buf) => c.decode(delReqCodec.cSchema, buf),
  [MID_PUT]: (buf) => c.decode(putReqCodec.cSchema, buf),
  [MID_SCAN]: (buf) => c.decode(scanReqCodec.cSchema, buf),
  [MID_APPEND]: (buf) => c.decode(appendReqCodec.cSchema, buf)
};

function encodeBytes(u8) {
  const bytes = u8 ? b4a.from(u8) : EMPTY;
  return b4a.concat([encodeU32LE(bytes.length), bytes]);
}

function decodeBytes(buf, offset = 0) {
  const len = decodeU32LE(buf, offset);
  const start = offset + 4;
  const end = start + len;
  return [buf.subarray(start, end), end];
}

function encodeString(str) {
  const bytes = b4a.from(String(str), 'utf8');
  return b4a.concat([encodeU16LE(bytes.length), bytes]);
}

function decodeString(buf, offset = 0) {
  const len = decodeU16LE(buf, offset);
  const start = offset + 2;
  const end = start + len;
  return [b4a.toString(buf.subarray(start, end), 'utf8'), end];
}

function encodeEnvelope(env) {
  const okFlag = encodeBool(!!env?.ok);
  if (env?.ok) {
    const hasValue = env.value != null;
    const hasMetaKey = !!env?.meta?.key;
    const valueBytes = hasValue ? encodeBytes(env.value) : encodeBytes(null);
    const metaKeyBytes = hasMetaKey ? encodeBytes(env.meta.key) : encodeBytes(null);
    return b4a.concat([
      okFlag,
      encodeBool(hasValue),
      valueBytes,
      encodeBool(hasMetaKey),
      metaKeyBytes
    ]);
  }
  const code = encodeString(env?.code || CODES.Unknown);
  const message = encodeString(env?.message || '');
  return b4a.concat([okFlag, code, message]);
}

function decodeEnvelope(buf) {
  let off = 0;
  const okFlag = decodeBool(buf, off); off += 1;
  if (okFlag) {
    const hasValue = decodeBool(buf, off); off += 1;
    let value; [value, off] = decodeBytes(buf, off); if (!hasValue) value = undefined;
    const hasKey = decodeBool(buf, off); off += 1;
    let key; [key, off] = decodeBytes(buf, off);
    const meta = hasKey ? { key } : undefined;
    return ok(value, meta ? { meta } : undefined);
  }
  let code; [code, off] = decodeString(buf, off);
  let message; [message, off] = decodeString(buf, off);
  return err(code, message);
}

function encReqFrame(rid, mid, payload) {
  return b4a.concat([FT_REQ_BUF, encodeU32LE(rid), new Uint8Array([mid]), payload || EMPTY]);
}

function encResFrame(rid, mid, more, payload) {
  return b4a.concat([FT_RES_BUF, encodeU32LE(rid), new Uint8Array([mid, more ? 1 : 0]), payload || EMPTY]);
}

function encCancelFrame(rid, mid) {
  return b4a.concat([FT_CANCEL_BUF, encodeU32LE(rid), new Uint8Array([mid])]);
}

function decFrame(buf) {
  let off = 0;
  const t = buf[off++];
  const rid = decodeU32LE(buf, off); off += 4;
  const mid = buf[off++];
  if (t === FT_RES) {
    const more = buf[off++] === 1;
    const payload = buf.subarray(off);
    return { t, rid, mid, more, payload };
  }
  if (t === FT_REQ) {
    const payload = buf.subarray(off);
    return { t, rid, mid, payload };
  }
  if (t === FT_CANCEL) {
    return { t, rid, mid };
  }
  return { t: 255 };
}

const TRACE_PATH = process.env.PLEX_RPC_TRACE_PATH;
const RPC_TRACE = process.env.PLEX_RPC_TRACE === '1' || !!TRACE_PATH;
const FRAME_TRACE = process.env.PLEX_RPC_TRACE_FRAMES === '1' || !!process.env.PLEX_RPC_TRACE_FRAME_PATH;
const FRAME_TRACE_PATH = process.env.PLEX_RPC_TRACE_FRAME_PATH;
let traceStream;
let frameTraceStream;

function trace(side, event, payload) {
  if (!RPC_TRACE) return;
  const json = JSON.stringify(payload);
  const line = `[plex-rpc][trace] ${side} ${event} ${json}`;
  try { console.log(line); } catch {}
  if (!TRACE_PATH) return;
  try {
    if (!traceStream) {
      try { fs.mkdirSync(path.dirname(TRACE_PATH), { recursive: true }); } catch {}
      traceStream = fs.createWriteStream(TRACE_PATH, { flags: 'a' });
      process.once('exit', () => { try { traceStream?.end(); } catch {} });
    }
    traceStream.write(`${new Date().toISOString()} ${line}\n`);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    log.warn('plex-rpc trace append failed', error);
  }
}

function traceFrame(side, direction, frameBuf, payload) {
  if (!FRAME_TRACE) return;
  const meta = {
    side,
    direction,
    frame: frameBuf && frameBuf.length ? shortHex(frameBuf.subarray(0, 64)) : undefined,
    ...payload
  };
  if (!FRAME_TRACE_PATH) {
    try { console.log('[plex-rpc][frame]', JSON.stringify(meta)); } catch {}
    return;
  }
  try {
    if (!frameTraceStream) {
      try { fs.mkdirSync(path.dirname(FRAME_TRACE_PATH), { recursive: true }); } catch {}
      frameTraceStream = fs.createWriteStream(FRAME_TRACE_PATH, { flags: 'a' });
      process.once('exit', () => { try { frameTraceStream?.end(); } catch {} });
    }
    frameTraceStream.write(`${new Date().toISOString()} ${JSON.stringify(meta)}\n`);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    log.warn('plex-rpc frame trace append failed', error);
  }
}

function shortHex(u8, limit = 48) {
  if (!u8) return '';
  if (u8.length <= limit) return b4a.toString(u8, 'hex');
  return `${b4a.toString(u8.subarray(0, limit), 'hex')}…`;
}

function frameTypeName(t) {
  if (t === FT_REQ) return 'req';
  if (t === FT_RES) return 'res';
  if (t === FT_CANCEL) return 'cancel';
  return 'unknown';
}

function envelopeFromError(e, fallback = 'Unknown error') {
  const message = e instanceof Error ? e.message : String(e ?? fallback);
  return err(CODES.Unknown, message);
}

/**
 * @param {{ duplex:any, port:{ get?:(o:any)=>Promise<any>, put?:(o:any)=>Promise<any>, del?:(o:any)=>Promise<any>, append?:(o:any)=>Promise<any>, scan?:(o:any)=>AsyncIterable<any> } }} io
 */
export function serveStorePortOverPlex({ duplex, port }) {
  const inflight = new Map();
  const maxServerRoutes = getMaxServerRoutes();
  const serverLimitEnabled = maxServerRoutes > 0;

  const finishStream = (entry) => {
    if (entry.end) entry.end();
    inflight.delete(entry.rid);
  };

  const failStream = (entry, error) => {
    if (entry.fail) entry.fail(error);
    inflight.delete(entry.rid);
  };

  const sendFrame = (frameInfo, frameBuf) => {
    traceFrame('server', 'tx', frameBuf, frameInfo);
    duplex.write(frameBuf);
  };

  function respondOnce(rid, mid, env) {
    const payload = encodeEnvelope(env ?? ok());
    const frame = encResFrame(rid, mid, false, payload);
    sendFrame({ rid, mid, more: false, payloadLen: payload.length }, frame);
  }

  async function handleUnary(rid, mid, handler, opts) {
    const entry = {
      rid,
      mid,
      type: 'unary',
      cancelled: false,
      cancel: async () => { entry.cancelled = true; },
      end: () => {},
      fail: () => {}
    };
    inflight.set(rid, entry);
    try {
      const env = await handler(opts);
      if (entry.cancelled) return;
      respondOnce(rid, mid, env ?? ok());
    } catch (error) {
      if (entry.cancelled) return;
      respondOnce(rid, mid, envelopeFromError(error));
    } finally {
      inflight.delete(rid);
    }
  }

  async function handleScan(rid, mid, iterator) {
    const entry = {
      rid,
      mid,
      type: 'stream',
      cancel: async () => {
        entry.cancelled = true;
        if (iterator?.return) {
          try { await iterator.return(); } catch {}
        }
      },
      end: () => {
        if (entry.done) return;
        entry.done = true;
        const terminal = encResFrame(rid, mid, false, EMPTY);
        sendFrame({ rid, mid, more: false, payloadLen: 0 }, terminal);
      },
      fail: (err) => {
        const payload = encodeEnvelope(envelopeFromError(err));
        const frame = encResFrame(rid, mid, false, payload);
        sendFrame({ rid, mid, more: false, payloadLen: payload.length }, frame);
      },
      done: false,
      cancelled: false
    };
    inflight.set(rid, entry);

    try {
      for await (const env of iterator) {
        if (entry.cancelled) break;
        const payload = encodeEnvelope(env);
        const frame = encResFrame(rid, mid, true, payload);
        sendFrame({ rid, mid, more: true, payloadLen: payload.length }, frame);
      }
      if (!entry.cancelled) entry.end();
    } catch (err) {
      if (!entry.cancelled) entry.fail(err);
    } finally {
      inflight.delete(rid);
    }
  }

  function handleReq(rid, mid, payload) {
    trace('server', 'req', { rid, mid, payloadLen: payload?.length ?? 0 });
    if (STALL_WARN_MS > 0) {
      serverLog.debug('received request', { rid, mid, payloadLen: payload?.length ?? 0 });
    }
    if (payload && payload.length > MAX_REQ_BYTES) {
      respondOnce(rid, mid, err(CODES.PayloadTooLarge, 'Request payload exceeds limit', { details: { limit: MAX_REQ_BYTES, actual: payload.length } }));
      return;
    }
    let opts = {};
    try {
      opts = decReq[mid]?.(payload) ?? {};
    } catch {
      respondOnce(rid, mid, err(CODES.Unknown, 'Bad request payload'));
      return;
    }

    if (serverLimitEnabled && inflight.size >= maxServerRoutes) {
      serverLog.warn('server route limit reached', {
        rid,
        mid,
        method: MID_NAME[mid] || mid,
        limit: maxServerRoutes,
        inflight: inflight.size
      });
      respondOnce(rid, mid, err(CODES.NotReady, 'Too many in-flight requests', { details: { limit: maxServerRoutes } }));
      setImmediate(() => {
        try { duplex.destroy?.(new Error('Too many in-flight Plex server routes')); } catch {}
      });
      return;
    }

    const unary = {
      [MID_GET]: port.get,
      [MID_PUT]: port.put,
      [MID_DEL]: port.del,
      [MID_APPEND]: port.append
    };

    if (mid === MID_SCAN) {
      if (typeof port.scan !== 'function') {
        respondOnce(rid, mid, err(CODES.Unknown, 'Scan not supported'));
        return;
      }
      let iterator;
      try {
        iterator = port.scan(opts);
      } catch (err) {
        respondOnce(rid, mid, envelopeFromError(err));
        return;
      }
      if (!iterator || typeof iterator[Symbol.asyncIterator] !== 'function') {
        respondOnce(rid, mid, err(CODES.Unknown, 'scan() must return AsyncIterable'));
        return;
      }
      handleScan(rid, mid, iterator);
      return;
    }

    const fn = unary[mid];
    if (typeof fn !== 'function') {
      respondOnce(rid, mid, err(CODES.Unknown, 'Unknown method'));
      return;
    }

    handleUnary(rid, mid, fn.bind(port), opts);
  }

  function handleCancel(rid) {
    const entry = inflight.get(rid);
    if (!entry) return;
    entry.cancelled = true;
    if (entry.cancel) {
      entry.cancel().catch(() => {});
    }
  }

  const onData = (buf) => {
    const f = decFrame(buf);
    traceFrame('server', 'rx', buf, { frame: frameTypeName(f.t), rid: f.rid, mid: f.mid, more: f.more === true, payloadLen: f.payload ? f.payload.length : 0 });
    if (f.t === FT_REQ) return handleReq(f.rid, f.mid, f.payload);
    if (f.t === FT_CANCEL) return handleCancel(f.rid);
  };

  duplex.on('data', onData);

  const serverFlush = () => {
    for (const entry of inflight.values()) {
      try { entry.cancel?.(); } catch {}
    }
    inflight.clear();
  };
  duplex.on('close', serverFlush);
  duplex.on('end', serverFlush);
  duplex.on('error', serverFlush);

  return {
    close() {
      try { duplex.destroy?.(); } catch {}
    },
    unwrap() {
      return duplex;
    }
  };
}

/**
 * @param {{ duplex:any }} io
 */
export function createStorePortProxyOverPlex({ duplex }) {
  let nextRid = 1;
  /** @type {Map<number, any>} */
  const routes = new Map();
  /** @type {Map<number, number>} */
  const recentlyClosed = new Map();
  const maxClientRoutes = getMaxClientRoutes();
  const clientLimitEnabled = maxClientRoutes > 0;

  function trackClosed(route) {
    if (!route || ORPHAN_TTL_MS <= 0) return;
    const rid = route.rid;
    if (typeof rid !== 'number') return;
    const expiry = Date.now() + ORPHAN_TTL_MS;
    recentlyClosed.set(rid, expiry);
    const timer = setTimeout(() => {
      const current = recentlyClosed.get(rid);
      if (current === expiry) {
        recentlyClosed.delete(rid);
      }
    }, ORPHAN_TTL_MS);
    if (typeof timer?.unref === 'function') timer.unref();
  }

  function registerCleanup(route, fn) {
    if (!route) return;
    if (!route.cleanups) route.cleanups = [];
    route.cleanups.push(fn);
  }

  function cleanupRoute(route) {
    if (!route?.cleanups) return;
    for (const fn of route.cleanups) {
      try { fn(); } catch {}
    }
    route.cleanups = null;
  }

  function timeoutEnvelope(ms) {
    const message = ms > 0 ? `Request timed out after ${ms}ms` : 'Request timed out';
    return err(CODES.Timeout, message);
  }

  function abortEnvelope(reason) {
    if (!reason) return err(CODES.Destroyed, 'Request aborted');
    if (typeof reason === 'object' && reason?.code) {
      const code = String(reason.code);
      if (code === CODES.Timeout) return err(CODES.Timeout, reason.message || 'Request timed out');
      if (typeof reason.message === 'string' && reason.message.length) {
        return err(code, reason.message);
      }
      return err(code, 'Request aborted');
    }
    const message = typeof reason === 'string' ? reason : String(reason?.message || reason || 'Request aborted');
    return err(CODES.Destroyed, message);
  }

  function completeWithEnvelope(route, env) {
    if (!route || route.state !== 'active') return;
    if (route.type === 'unary') {
      route.result = env;
    } else if (route.type === 'stream') {
      route.push?.(env);
      route.done = true;
    }
    closeRoute(route);
  }

  function computeTimeoutMs(override) {
    if (override === null || override === undefined) return DEFAULT_CLIENT_TIMEOUT_MS;
    const num = Number(override);
    if (!Number.isFinite(num) || num <= 0) return 0;
    return num;
  }

  function scheduleRouteTimeout(route, override) {
    const ms = typeof override === 'number' ? override : computeTimeoutMs(override);
    if (!route || !Number.isFinite(ms) || ms <= 0) return;
    route.timeoutMs = ms;
    route.timeoutTimer = setTimeout(() => {
      route.timeoutTimer = null;
      if (route.state !== 'active') return;
      route.guard = 'timeout';
      const env = timeoutEnvelope(ms);
      sendCancel(route);
      completeWithEnvelope(route, env);
    }, ms);
    if (typeof route.timeoutTimer?.unref === 'function') route.timeoutTimer.unref();
  }

  function attachAbortSignal(route, signal) {
    if (!route || !signal) return;
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      if (route.state !== 'active') return;
      const env = abortEnvelope(signal.reason);
      route.guard = 'abort';
      sendCancel(route);
      completeWithEnvelope(route, env);
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    registerCleanup(route, () => {
      try { signal.removeEventListener('abort', onAbort); } catch {}
    });
  }

  function clearTimers(route) {
    if (route.stallTimer) { clearTimeout(route.stallTimer); route.stallTimer = null; }
    if (route.pendingTimer) { clearTimeout(route.pendingTimer); route.pendingTimer = null; }
    if (route.timeoutTimer) { clearTimeout(route.timeoutTimer); route.timeoutTimer = null; }
  }

  function closeRoute(route, error) {
    if (!route || route.state === 'closed') return;
    route.state = 'closed';
    clearTimers(route);
    cleanupRoute(route);
    trackClosed(route);
    routes.delete(route.rid);
    if (route.type === 'unary') {
      if (error) {
        route.reject?.(error instanceof Error ? error : new Error(String(error)));
      } else {
        route.resolve?.(route.result ?? ok());
      }
    } else if (route.type === 'stream') {
      if (error) route.fail?.(error instanceof Error ? error : new Error(String(error)));
      else route.end?.();
    }
  }

  function flushAllClient(error) {
    for (const route of routes.values()) {
      closeRoute(route, error || new Error('Connection closed'));
    }
    routes.clear();
  }

  function describeOpts(mid, opts) {
    if (!opts) return {};
    const out = {};
    const maybeHex = (u8) => (u8 instanceof Uint8Array ? shortHex(u8) : undefined);
    const keyHex = maybeHex(opts.key);
    if (keyHex) out.keyHex = keyHex;
    const valueLen = opts.value instanceof Uint8Array ? opts.value.length : undefined;
    if (typeof valueLen === 'number') out.valueLen = valueLen;
    if (opts.prefix instanceof Uint8Array) out.prefixHex = shortHex(opts.prefix);
    if (opts.range) {
      const range = {};
      if (opts.range.gte instanceof Uint8Array) range.gteHex = shortHex(opts.range.gte);
      if (opts.range.gt instanceof Uint8Array) range.gtHex = shortHex(opts.range.gt);
      if (opts.range.lte instanceof Uint8Array) range.lteHex = shortHex(opts.range.lte);
      if (opts.range.lt instanceof Uint8Array) range.ltHex = shortHex(opts.range.lt);
      if (Object.keys(range).length) out.range = range;
    }
    const timeoutMs = opts?.timeoutMs ?? opts?.timeout;
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) out.timeoutMs = Number(timeoutMs);
    return out;
  }

  function setupTimers(route) {
    if (STALL_WARN_MS > 0) {
      route.stallTimer = setTimeout(() => {
        if (routes.has(route.rid) && route.state === 'active') {
          clientLog.warn('request stalled without response', {
            rid: route.rid,
            mid: route.mid,
            method: MID_NAME[route.mid] || route.mid,
            ms: Date.now() - route.startedAt,
            routes: routes.size,
            ...route.meta
          });
        }
      }, STALL_WARN_MS);
    }
    if (PENDING_LOG_MS > 0) {
      const emit = () => {
        if (!routes.has(route.rid) || route.state !== 'active') return;
        const ageMs = Date.now() - route.startedAt;
        clientLog.warn('request still pending', {
          rid: route.rid,
          mid: route.mid,
          method: MID_NAME[route.mid] || route.mid,
          ageMs,
          routes: routes.size,
          ...route.meta
        });
        route.pendingTimer = setTimeout(emit, PENDING_LOG_MS);
      };
      route.pendingTimer = setTimeout(emit, PENDING_LOG_MS);
    }
  }

  function sendCancel(route) {
    if (!route || route.cancelSent) return;
    route.cancelSent = true;
    try {
      const frame = encCancelFrame(route.rid, route.mid);
      traceFrame('client', 'tx', frame, { rid: route.rid, mid: route.mid, frame: 'cancel' });
      duplex.write(frame);
    } catch {}
  }

  function enforceRequestLimit(length, mid) {
    if (length > MAX_REQ_BYTES) {
      const method = MID_NAME[mid] || mid;
      const error = new Error(`Request payload exceeds limit (${length} > ${MAX_REQ_BYTES}) for ${method}`);
      error.code = CODES.PayloadTooLarge;
      throw error;
    }
  }

  function startRoute(mid, opts, type) {
    const rid = nextRid++;

    if (clientLimitEnabled && routes.size >= maxClientRoutes) {
      clientLog.warn('client route limit reached', {
        rid,
        mid,
        method: MID_NAME[mid] || mid,
        limit: maxClientRoutes,
        routes: routes.size
      });
      const limitError = new Error('Too many in-flight Plex client routes');
      limitError.code = CODES.NotReady;
      try { duplex.destroy?.(limitError); } catch {}
      throw limitError;
    }
    let signal;
    let timeoutOverride;
    let payloadOpts = opts;
    if (opts && typeof opts === 'object') {
      signal = opts.signal;
      if (Object.prototype.hasOwnProperty.call(opts, 'timeoutMs')) timeoutOverride = opts.timeoutMs;
      else if (Object.prototype.hasOwnProperty.call(opts, 'timeout')) timeoutOverride = opts.timeout;
      if (signal || timeoutOverride !== undefined) {
        payloadOpts = { ...opts };
        if ('signal' in payloadOpts) delete payloadOpts.signal;
        if ('timeoutMs' in payloadOpts) delete payloadOpts.timeoutMs;
        if ('timeout' in payloadOpts) delete payloadOpts.timeout;
      }
    }
    const payload = encReq[mid] ? encReq[mid](payloadOpts || {}) : EMPTY;
    enforceRequestLimit(payload.length, mid);
    const computedTimeout = computeTimeoutMs(timeoutOverride);
    const route = {
      rid,
      mid,
      type,
      state: 'active',
      startedAt: Date.now(),
      seenData: false,
      meta: describeOpts(mid, (opts && typeof opts === 'object') ? opts : {}),
      stallTimer: null,
      pendingTimer: null,
      timeoutTimer: null,
      cancelSent: false,
      cleanups: null,
      guard: null,
      timeoutMs: computedTimeout > 0 ? computedTimeout : undefined
    };
    routes.set(rid, route);
    if (computedTimeout > 0 && route.meta.timeoutMs === undefined) {
      route.meta.timeoutMs = computedTimeout;
    }
    trace('client', 'req', { rid, mid, payloadLen: payload.length, ...route.meta });
    clientLog.debug('request sent', { rid, mid, payloadLen: payload.length, method: MID_NAME[mid] || mid, ...route.meta });
    setupTimers(route);
    attachAbortSignal(route, signal);
    scheduleRouteTimeout(route, computedTimeout);
    try {
      const frame = encReqFrame(rid, mid, payload);
      traceFrame('client', 'tx', frame, { rid, mid, frame: 'req', payloadLen: payload.length });
      duplex.write(frame);
    } catch (error) {
      clientLog.error('req frame write failed', { rid, mid, message: String(error?.message || error), stack: error?.stack });
      closeRoute(route, error instanceof Error ? error : new Error(String(error)));
    }
    return route;
  }

  function callUnary(mid, opts) {
    return new Promise((resolve, reject) => {
      const route = startRoute(mid, opts, 'unary');
      route.resolve = resolve;
      route.reject = reject;
      route.result = ok();
      route.cancel = () => {
        if (route.state !== 'active') return;
        route.state = 'cancelled';
        sendCancel(route);
        closeRoute(route, new Error('Request cancelled'));
      };
    });
  }

  function createStream(mid, opts) {
    const route = startRoute(mid, opts, 'stream');
    route.queue = [];
    route.waiters = [];
    route.done = false;
    route.error = null;

    const pump = () => {
      if (route.waiters.length) {
        if (route.error) {
          const { reject } = route.waiters.shift();
          reject(route.error);
        } else if (route.queue.length) {
          const { resolve } = route.waiters.shift();
          resolve({ value: route.queue.shift(), done: false });
        } else if (route.done) {
          const { resolve } = route.waiters.shift();
          resolve({ value: undefined, done: true });
        }
      }
    };

    route.push = (env) => {
      if (route.state !== 'active') return;
      route.queue.push(env);
      pump();
    };
    route.end = () => {
      if (route.done) return;
      route.done = true;
      pump();
    };
    route.fail = (error) => {
      if (route.error) return;
      route.error = error instanceof Error ? error : new Error(String(error));
      pump();
    };
    route.cancel = () => {
      if (route.state !== 'active') return { done: true };
      route.state = 'cancelled';
      sendCancel(route);
      route.fail(new Error('Stream cancelled'));
      return { done: true };
    };

    const iterator = {
      async next() {
        if (route.queue.length) {
          const value = route.queue.shift();
          return { value, done: false };
        }
        if (route.error) {
          const err = route.error;
          route.error = null;
          throw err;
        }
        if (route.done || route.state === 'closed') {
          return { value: undefined, done: true };
        }
        return await new Promise((resolve, reject) => {
          route.waiters.push({ resolve, reject });
        });
      },
      async return() {
        route.cancel();
        closeRoute(route);
        return { value: undefined, done: true };
      },
      async throw(error) {
        route.cancel();
        closeRoute(route, error instanceof Error ? error : new Error(String(error)));
        throw error;
      },
      [Symbol.asyncIterator]() {
        return this;
      }
    };

    route.iterator = iterator;
    return iterator;
  }

  const onData = (buf) => {
    const frame = decFrame(buf);
    traceFrame('client', 'rx', buf, { frame: frameTypeName(frame.t), rid: frame.rid, mid: frame.mid, more: frame.more === true, payloadLen: frame.payload ? frame.payload.length : 0 });
    const route = routes.get(frame.rid);
    if (!route) {
      const expiresAt = recentlyClosed.get(frame.rid);
      if (expiresAt && ORPHAN_TTL_MS > 0 && expiresAt >= Date.now()) {
        clientLog.debug('response for closed route', { rid: frame.rid, mid: frame.mid, more: frame.more, payloadLen: frame.payload ? frame.payload.length : 0 });
        return;
      }
      if (expiresAt) recentlyClosed.delete(frame.rid);
      clientLog.warn('response without route', { rid: frame.rid, mid: frame.mid, more: frame.more, payloadLen: frame.payload ? frame.payload.length : 0 });
      return;
    }

    if (route.state === 'cancelled') {
      if (!frame.more) closeRoute(route);
      return;
    }

    if (frame.payload && frame.payload.length) {
      try {
        const env = decodeEnvelope(frame.payload);
        if (route.type === 'unary') {
          route.result = env;
          route.seenData = true;
        } else if (route.type === 'stream') {
          route.push?.(env);
        }
      } catch (error) {
        closeRoute(route, error instanceof Error ? error : new Error(String(error)));
        return;
      }
    }

    if (!frame.more) {
      closeRoute(route);
    }
  };

  duplex.on('data', onData);
  duplex.on('close', () => flushAllClient(new Error('Connection closed')));
  duplex.on('end', () => flushAllClient(new Error('Connection ended')));
  duplex.on('error', (err) => flushAllClient(err instanceof Error ? err : new Error(String(err))));

  return {
    async waitReady() {},
    async ready() {},
    async get(o) { return callUnary(MID_GET, o); },
    async put(o) { return callUnary(MID_PUT, o); },
    async del(o) { return callUnary(MID_DEL, o); },
    async append(o) { return callUnary(MID_APPEND, o); },
    scan(o) { return createStream(MID_SCAN, o); },
    async close() {
      try { duplex.destroy?.(); } catch {}
      return ok();
    },
    async destroy() {
      try { duplex.destroy?.(); } catch {}
      return ok();
    },
    unwrap() { return duplex; }
  };
}
