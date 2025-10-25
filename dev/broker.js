// @ts-check
import { createDuplexPair } from './pair.js';
import b4a from 'b4a';

/**
 * Minimal dev-only local socket broker.
 * - Ensures both ends are framed and bound in the same tick.
 * - Server accept() must call ctx.ready() synchronously to signal handlers are installed.
 * - Use one base stream per peer; open channels/lanes over the same transport via Protomux.
 */

const listeners = new Map();

function keyOf(id) {
  if (id == null) throw new TypeError('broker: id required');
  if (b4a.isBuffer(id)) return 'u8:' + b4a.toString(/** @type {Uint8Array} */(id), 'hex');
  return 'str:' + String(id);
}

/**
 * Register a server acceptor for a base peer id.
 * @param {{ id:string|Uint8Array }} opts
 * @param {(ctx:{ stream:any, ready:()=>void, close:()=>void })=>void} accept
 * @returns {{ dispose:()=>void }}
 */
export function listen(opts, accept) {
  const k = keyOf(opts?.id);
  if (listeners.has(k)) throw new Error('broker.listen: already listening for id');
  if (typeof accept !== 'function') throw new TypeError('broker.listen: accept(ctx) required');
  listeners.set(k, { accept });
  return { dispose() { try { listeners.delete(k); } catch {} } };
}

/**
 * Create a new framed socket pair and synchronously hand server end to acceptor.
 * Server acceptor must call ctx.ready() before this returns; otherwise throws.
 * @param {{ id:string|Uint8Array }} opts
 * @returns {any} clientStream (FramedStream)
 */
export function connectNow(opts) {
  const k = keyOf(opts?.id);
  const entry = listeners.get(k);
  if (!entry) throw new Error('broker.connectNow: no listener for id');
  const [srvStream, cliStream] = createDuplexPair();
  let ready = false;
  const ctx = {
    stream: srvStream,
    ready: () => { ready = true; },
    close: () => { try { srvStream.destroy?.(); } catch {} }
  };
  // Synchronously invoke accept; require immediate readiness
  entry.accept(ctx);
  if (!ready) {
    try { srvStream.destroy?.(); } catch {}
    try { cliStream.destroy?.(); } catch {}
    throw new Error('broker.connectNow: listener did not call ready() synchronously');
  }
  return cliStream;
}

/** Singleton export for convenience */
export const broker = { listen, connectNow };

