// @ts-check
import Protomux from 'protomux'
import b4a from 'b4a'
import { getRawCodec, makeCodec } from './codec/index.js'
import { createLogger } from './log/index.js'

// Defaults and shared normalization helpers for Plex
export const defaultProtocol = 'neonloom/protocol/v1'
export const zeroBuff = b4a.alloc(0)
export const defaultCodec = makeCodec('raw')
const isNormalizedSym = Symbol('plex.normalized')
const muxSymbol = Symbol.for('plex.protomux')
export const streamMuxSymbol = muxSymbol
const log = createLogger({ name: 'plex-config', context: { subsystem: 'plex' } })

/**
 * Attempt to locate an existing Protomux instance on a stream.
 * @param {any} stream
 * @returns {any|undefined}
 */
export const getMuxFromStream = (stream) => {
  if (!stream || typeof stream !== 'object') return undefined
  if (stream.isProtomux) return stream
  const existing = stream[muxSymbol]
  return existing && existing.isProtomux ? existing : undefined
}

/**
 * Types
 * @typedef {object} PlexBaseConfig
 * @property {import('streamx').Duplex|any} stream A Duplex transport or a Protomux mux.
 * @property {Uint8Array} id Channel id (bytes) to multiplex on.
 * @property {string=} protocol Channel protocol (default neonloom/protocol/v1).
 * @property {any=} encoding Data encoding (compact-encoding token/codec).
 * @property {any=} handshakeEncoding Handshake encoding (compact-encoding token/codec).
 * @property {any=} handshakeMessage Value matching handshakeEncoding (e.g., string for 'utf8', bytes for 'raw').
 *
 * @typedef {object} PlexChannelConfig
 * @property {(handshake:any)=>void=} onOpen Functional hook (Duplex variant) for remote-open.
 * // Advanced (low-level channel) handlers — not required for Duplex usage
 * @property {(buf:any)=>void=} onmessage
 * @property {(handshake:any)=>void=} onopen
 * @property {()=>void=} onclose
 * @property {()=>void=} ondestroy
 *
 * @typedef {object} PlexDuplexOptions
 * @property {number=} highWaterMark
 * @property {(data:any)=>any=} map
 * @property {(data:any)=>number=} byteLength
 * @property {AbortSignal=} signal
 * @property {boolean=} eagerOpen Eagerly open the Duplex (streamx option)
 * @property {(data:any)=>any=} mapWritable
 * @property {(data:any)=>number=} byteLengthWritable
 * @property {(data:any)=>any=} mapReadable
 * @property {(data:any)=>number=} byteLengthReadable
 */

/**
 * If cfg.mux exists use it, else Protomux.from(stream, opts)
 * @param {any} [cfg]
 */
export const fromStream = (cfg = {}) => {
  if (cfg.mux && cfg.mux.isProtomux) return cfg
  const { stream, onError, ...opts } = cfg
  const existingMux = getMuxFromStream(stream)
  const mux = existingMux ?? Protomux.from(stream, opts)
  if (!existingMux && stream && typeof stream === 'object') {
    try {
      stream[muxSymbol] = mux
    } catch {
      // Ignore if stream is frozen/sealed
    }
  }
  const onerror = (err) => {
    const handled = onError ? onError(err) : undefined;
    if (handled) return;
    const error = err instanceof Error ? err : new Error(String(err));
    log.error('plex stream error', error);
  };
  if (!existingMux && stream?.once) stream.once('error', onerror);
  return { ...opts, stream, mux }
}

/** @param {any} cfg */
const normalizeStream = (cfg = {}) => fromStream(cfg)

/** @param {any} cfg */
const normalizeEncodings = (cfg = {}) => {
  const { ..._cfg } = cfg
  _cfg._handshakeEncoder = getRawCodec(cfg.handshakeEncoding ?? defaultCodec)
  _cfg._dataEncoder = getRawCodec(cfg.encoding ?? defaultCodec)
  return _cfg
}

/** @param {any} cfg */
const normalizeIdProtocol = (cfg = {}) => {
  const { id, protocol = defaultProtocol, ...rest } = cfg
  return { ...rest, id, protocol }
}

/** Normalize user config into an internal cfg used by Plex.
 * Adds: mux, _handshakeEncoder, _dataEncoder, protocol default, and a guard symbol.
 * @param {any} [cfg]
 */
export const normalizeCfg = (cfg = {}) => {
  if (cfg[isNormalizedSym]) return cfg
  const _cfg = normalizeStream(normalizeIdProtocol(normalizeEncodings(cfg)))
  _cfg[isNormalizedSym] = true
  return _cfg
}
