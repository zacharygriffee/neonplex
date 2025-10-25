// @ts-check
/**
 * @module @neonloom/core/result
 * Sharp-Edges & Boring Envelope helpers (v1).
 *
 * This module ONLY shapes envelopes. It performs no IO and no type coercion.
 */

import b4a from "b4a";

/** Schema version tag for envelopes */
export const V = 1;

/** Frozen set of allowed domain error codes */
export const CODES = Object.freeze({
  BadArg: 'BadArg',
  CodecError: 'CodecError',
  CASFailed: 'CASFailed',
  CapabilityDenied: 'CapabilityDenied',
  Timeout: 'Timeout',
  DriverError: 'DriverError',
  CryptoError: 'CryptoError',
  NotAvailable: 'NotAvailable',
  NotReady: 'NotReady',
  PayloadTooLarge: 'PayloadTooLarge',
  Closed: 'Closed',
  Destroyed: 'Destroyed',
  Unknown: 'Unknown',
});

/**
 * Create a success envelope.
 * @template T
 * @param {T} [value]
 * @param {{ ver?: number|{feed:number,seq:number}, pos?: number, meta?: any }} [extra]
 * @returns {{ v:1, ok:true, value?:T, ver?:any, pos?:number, meta?:any }}
 */
export function ok(value, extra) {
  /** @type {any} */
  const out = { v: V, ok: true };
  if (value !== undefined) out.value = value;
  if (extra && typeof extra === 'object') {
    if ('ver' in extra && extra.ver != null) out.ver = extra.ver;
    if ('pos' in extra && extra.pos != null) out.pos = extra.pos;
    if ('meta' in extra && extra.meta != null) out.meta = extra.meta;
  }
  return out;
}

/**
 * Create a failure envelope.
 * @param {keyof typeof CODES|string} code
 * @param {string} message
 * @param {{ details?: any, cause?: { name?: string, stack?: string }|Error, meta?: any }} [extra]
 * @returns {{ v:1, ok:false, code:string, message:string, details?:any, cause?:{name:string, stack?:string}, meta?:any }}
 */
export function err(code, message, extra) {
  const c = normalizeCode(code);
  /** @type {any} */
  const out = { v: V, ok: false, code: c, message: String(message ?? '') };
  if (extra && typeof extra === 'object') {
    if ('details' in extra && extra.details !== undefined) out.details = extra.details;
    if ('meta' in extra && extra.meta !== undefined) out.meta = extra.meta;
    if ('cause' in extra && extra.cause) {
      const cause = /** @type {any} */ (extra.cause);
      const name = String(cause?.name ?? 'Error');
      const stack = typeof cause?.stack === 'string' ? cause.stack : undefined;
      out.cause = stack ? { name, stack } : { name };
    }
  }
  return out;
}

/**
 * Convert a thrown Error/unknown into a failure envelope.
 * Use for mapping programmer faults or external errors into domain-visible failures when appropriate.
 *
 * @param {unknown} e
 * @param {keyof typeof CODES|string} [fallbackCode='DriverError']
 * @param {any} [meta]
 * @returns {{ v:1, ok:false, code:string, message:string, cause:{name:string, stack?:string}, meta?:any }}
 */
export function fromThrowable(e, fallbackCode = CODES.DriverError, meta) {
  if (e && typeof e === 'object') {
    const anyE = /** @type {any} */ (e);
    const message = String(anyE.message ?? anyE.toString?.() ?? 'Error');
    const name = String(anyE.name ?? 'Error');
    const stack = typeof anyE.stack === 'string' ? anyE.stack : undefined;
    return err(normalizeCode(anyE.code ?? fallbackCode), message, { cause: { name, stack }, meta });
  }
  return err(normalizeCode(fallbackCode), String(e ?? 'Error'), { cause: { name: 'Error' }, meta });
}

/**
 * Is the given value a success envelope?
 * @param {any} env
 * @returns {env is { v:1, ok:true }}
 */
export function isOk(env) {
  return !!env && env.ok === true && env.v === V;
}

/**
 * Is the given value a failure envelope?
 * @param {any} env
 * @returns {env is { v:1, ok:false, code:string, message:string }}
 */
export function isErr(env) {
  return !!env && env.ok === false && env.v === V && typeof env.code === 'string';
}

/**
 * Convenience creator for strict validation failures.
 * @param {string} at - path of the invalid argument (e.g., 'scan.prefix')
 * @param {string} expected - human-readable expectation (e.g., 'Uint8Array')
 * @param {any} received - actual received value (will be stringified)
 * @returns {{ v:1, ok:false, code:string, message:string, details:{ at:string, expected:string, received:string } }}
 */
export function badArg(at, expected, received) {
  return err(
    CODES.BadArg,
    `Invalid argument at ${at}: expected ${expected}`,
    { details: { at, expected, received: typeOf(received) } }
  );
}

/**
 * Normalize error code to a supported string; unknown codes map to 'Unknown'.
 * @param {any} code
 * @returns {string}
 */
function normalizeCode(code) {
  const s = String(code ?? '');
  // Exact match against known codes first
  if (Object.prototype.hasOwnProperty.call(CODES, s)) return s;
  // Accept values equal to any of CODES values
  for (const k in CODES) if (CODES[k] === s) return s;
  return CODES.Unknown;
}

/**
 * Compact type string for diagnostics (does not coerce/inspect deeply).
 * @param {any} v
 * @returns {string}
 */
function typeOf(v) {
  if (v === null) return 'null';
  const t = typeof v;
  if (t !== 'object') return t;
  if (b4a.isBuffer?.(v)) return 'Buffer';
  if (typeof Uint8Array !== 'undefined' && v instanceof Uint8Array) return 'Uint8Array';
  if (Array.isArray(v)) return 'Array';
  const tag = Object.prototype.toString.call(v); // [object Something]
  const m = /^\[object\s+([^\]]+)\]$/.exec(tag);
  return m ? m[1] : 'object';
}

export { okV1, errV1, resultV1, encodeOk, encodeErr, encodeResult, decodeResult } from './encoding.js'
