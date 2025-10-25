// @ts-check
// Byte utilities backed by b4a (works in Node + browsers)
// Keep this file dependency-free besides 'b4a' so it’s safe in any runtime.
import * as b4a from 'b4a';
import {makeCodec} from "../codec/index.js";

const u8Encoder = makeCodec("utf8");

/**
 * Is the value a Uint8Array/Buffer?
 * @param {any} v
 * @returns {v is Uint8Array}
 */
export function isU8(v) {
    // b4a.isBuffer returns true for both Buffer and Uint8Array
    return b4a.isBuffer(v);
}

/**
 * Normalize common inputs to Uint8Array.
 * Accepts: Uint8Array/Buffer, string (utf8), ArrayBuffer/DataView/TypedArray, number[]
 * @param {any} v
 * @returns {Uint8Array}
 */
export function toU8(v) {
    if (v == null) return new Uint8Array(0);
    if (isU8(v)) return /** @type {Uint8Array} */(v);
    if (typeof v === 'string') return b4a.from(v, 'utf8');
    if (v instanceof ArrayBuffer) return new Uint8Array(v);
    if (ArrayBuffer.isView(v) && v.buffer instanceof ArrayBuffer) {
        return new Uint8Array(v.buffer, v.byteOffset || 0, v.byteLength || 0);
    }
    if (Array.isArray(v)) return b4a.from(v);
    throw new TypeError('toU8: unsupported input type for bytes');
}

/**
 * Constant-time-ish equality (fast & portable via b4a)
 * @param {Uint8Array} a
 * @param {Uint8Array} b
 */
export function equal(a, b) {
    return b4a.equals(a, b);
}

/**
 * Bytewise prefix test
 * @param {Uint8Array} a
 * @param {Uint8Array} prefix
 */
export function startsWith(a, prefix) {
    if (prefix.length > a.length) return false;
    // Compare the first N bytes
    return b4a.equals(a.subarray(0, prefix.length), prefix);
}

/**
 * Hex helpers for stable string keys (e.g., Map, logs)
 * @param {Uint8Array} u8
 * @returns {string}
 */
export function toHex(u8) {
    return b4a.toString(u8, 'hex');
}

/**
 * @param {string} hex
 * @returns {Uint8Array}
 */
export function fromHex(hex) {
    return b4a.from(hex, 'hex');
}

/** UTF-8 helpers (handy in UIs) */
export const utf8 = {
    /**
     * @param {string} s
     * @returns {Uint8Array}
     */
    encode: (s) => u8Encoder.encode(s),
    /**
     * @param {Uint8Array} u8
     * @returns {string}
     */
    decode: (u8) => u8Encoder.decode(u8),
};

/**
 * Encode an unsigned 16-bit integer (little-endian) into a 2-byte Uint8Array.
 * @param {number} value
 * @returns {Uint8Array}
 */
export function encodeU16LE(value) {
    const buf = new Uint8Array(2);
    new DataView(buf.buffer, buf.byteOffset, 2).setUint16(0, value >>> 0, true);
    return buf;
}

/**
 * Decode an unsigned 16-bit integer (little-endian) from a buffer at offset.
 * @param {Uint8Array} buf
 * @param {number} [offset=0]
 * @returns {number}
 */
export function decodeU16LE(buf, offset = 0) {
    return new DataView(buf.buffer, buf.byteOffset + offset, 2).getUint16(0, true);
}

/**
 * Encode an unsigned 32-bit integer (little-endian) into a 4-byte Uint8Array.
 * @param {number} value
 * @returns {Uint8Array}
 */
export function encodeU32LE(value) {
    const buf = new Uint8Array(4);
    new DataView(buf.buffer, buf.byteOffset, 4).setUint32(0, value >>> 0, true);
    return buf;
}

/**
 * Decode an unsigned 32-bit integer (little-endian) from a buffer at offset.
 * @param {Uint8Array} buf
 * @param {number} [offset=0]
 * @returns {number}
 */
export function decodeU32LE(buf, offset = 0) {
    return new DataView(buf.buffer, buf.byteOffset + offset, 4).getUint32(0, true);
}

/**
 * Encode a boolean as a single byte (`1` for true, `0` for false).
 * @param {boolean} value
 * @returns {Uint8Array}
 */
export function encodeBool(value) {
    return new Uint8Array([value ? 1 : 0]);
}

/**
 * Decode a boolean from a buffer at offset (`1` → true, otherwise false).
 * @param {Uint8Array} buf
 * @param {number} [offset=0]
 * @returns {boolean}
 */
export function decodeBool(buf, offset = 0) {
    return buf[offset] === 1;
}

