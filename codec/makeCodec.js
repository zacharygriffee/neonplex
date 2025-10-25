// @ts-check
import c from 'compact-encoding';
import * as b4a from 'b4a';

/** Symbol tag to mark blessed codecs */
export const CODEC = Symbol.for('cq.codec');

/** WeakMap cache for compiled compact-encoding schemas (object keys only) */
const COMPILED = new WeakMap();

/** @typedef {{ id?: string|Uint8Array, version?: number }} CodecMeta */

/**
 * Return true if v is a blessed codec (made by makeCodec or already tagged).
 * @param {any} v
 * @returns {boolean}
 */
export function isCodec(v) {
  return !!(v && (v[CODEC] || v.isCodec === true));
}

/** Return true if v looks like a CE codec (has { preencode, encode, decode }) */
function isCeCodec(v) {
  return !!(v && typeof v.preencode === 'function' && typeof v.encode === 'function' && typeof v.decode === 'function');
}

/** coerce id to string; if Uint8Array provided, hex it */
function coerceId(idLike, fallback) {
  if (idLike == null) return fallback;
  if (b4a.isBuffer(idLike) || idLike instanceof Uint8Array) return b4a.toString(idLike, 'hex');
  return String(idLike);
}

/** decode utf8 from bytes (best-effort) */
function utf8Decode(u8) {
  try { return b4a.toString(u8, 'utf8'); } catch { return ''; }
}

/** pick a CE bytes codec from compact-encoding */
function pickBytesCodec() {
  const cand = /** @type {any} */ (c.bytes || c.buffer || c.raw);
  if (!isCeCodec(cand)) throw new Error('compact-encoding: no bytes codec found (expected c.bytes or c.buffer).');
  return cand;
}

/**
 * Normalize schema/codec tokens to CE codecs where possible.
 * - 'json' -> c.json
 * - 'string'|'utf8'|'str' -> c.string
 * - 'bytes'|'u8'|'bin' -> c.bytes/c.buffer
 * - Uint8Array token -> try utf8 keyword; else treat as bytes codec
 * - Otherwise return original (object schema expected)
 * @param {any} s
 * @returns {any} // CE codec or original schema
 */
function normalizeToken(s) {
  if (isCodec(s)) return s?.cSchema || s;
  if (typeof s === 'string') {
    if (s.indexOf('.') > 0) {
      let [mod, ...spec] = s.split(".", 2);
      spec = spec.join('.');
      if (mod === "raw") return c.raw[spec] || s;
      if (mod === "array") return c.array(normalizeToken(spec)) || s;
      return c?.[mod]?.[spec] || s;
    } else {
      return c?.[s] || c.from(s);
    }
  }
  if (s.preencode && s.encode && s.decode) return s;
  return c.from(s);
}

/**
 * Bless an object that already has encode/decode into a proper codec by tagging it.
 * No wrapping; preserves original methods and fills id/version defaults.
 * @template T
 * @param {{encode:(value:T)=>Uint8Array, decode:(buf:Uint8Array)=>T, id?:string, version?:number}} codec
 * @param {CodecMeta} [meta]
 */
export function blessCodec(codec, meta = {}) {
  if (isCodec(codec)) return codec;
  const out = Object.assign({}, codec, {
    id: coerceId(meta?.id ?? codec.id, undefined),
    version: meta?.version ?? codec.version ?? 1,
  });
  Object.defineProperty(out, CODEC, { value: true, enumerable: false });
  Object.defineProperty(out, 'isCodec', { value: true, enumerable: false });
  return out;
}

export const getRawCodec = (codec) => {
  const _c = isCodec(codec) ? codec : normalizeToken(codec);
  return _c?.cSchema || _c;
}

/**
 * makeCodec(schemaOrCodec, meta?)
 * - If passed a blessed codec, returns as-is.
 * - If it has encode/decode, blesses & returns (no double-wrapping).
 * - If it is a token (string/bytes), maps to CE codec.
 * - Else treats it as a compact-encoding schema, compiles once, and returns a wrapper.
 * The wrapper always exposes { id, version, cSchema, encode, decode } where encode returns Uint8Array.
 * @template T
 * @param {any} schemaOrCodec
 * @param {CodecMeta} [meta]
 */
export function makeCodec(schemaOrCodec, meta = {}) {
  // Already a blessed codec?
  if (isCodec(schemaOrCodec)) return schemaOrCodec;

  // Normalize tokens before caching
  const normalized = normalizeToken(schemaOrCodec);

  // If we now have a CE codec, wrap it
  if (isCeCodec(normalized)) {
    const ce = normalized;
    const out = {
      id: coerceId(meta.id, 'anon'),
      version: meta.version ?? 1,
      cSchema: ce,
      encode: (value) => {
        return c.encode(ce, value);
      },
      decode: (buf) => c.decode(ce, buf),
    };
    Object.defineProperty(out, CODEC, { value: true, enumerable: false });
    Object.defineProperty(out, 'isCodec', { get() { return true; } });
    return out;
  }

  // If user provided a high-level codec with encode/decode, bless it
  if (normalized && typeof normalized.encode === 'function' && typeof normalized.decode === 'function' && !normalized.preencode) {
    return blessCodec(normalized, meta);
  }

  // Expect a CE schema object here
  if (typeof normalized !== 'object' || normalized === null) {
    throw new TypeError('makeCodec: expected a compact-encoding schema object or a codec/token');
  }

  // Compile CE schema (memoized by object identity)
  let compiled = COMPILED.get(normalized);
  if (!compiled) {
    compiled = c.from(normalized);
    COMPILED.set(normalized, compiled);
  }

  const out = {
    id: coerceId(meta.id, 'anon'),
    version: meta.version ?? 1,
    cSchema: compiled,
    encode: (value) => c.encode(compiled, value),
    decode: (buf) => c.decode(compiled, buf),
  };

  Object.defineProperty(out, CODEC, { value: true, enumerable: false });
  Object.defineProperty(out, 'isCodec', { get() { return true; } });
  return out;
}
