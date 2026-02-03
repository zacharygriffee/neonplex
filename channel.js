// @ts-check
import process from 'process'
import b4a from 'b4a'
import { normalizeCfg, zeroBuff } from './config.js'
import { createLogger } from './log/index.js'

const defaultLogger = createLogger({ name: 'plex-channel', context: { subsystem: 'plex' }, level: process.env.PLEX_MUX_LOG_LEVEL || process.env.NL_LOG_LEVEL })
const noopLogger = { trace(){}, debug(){}, info(){}, warn(){}, error(){}, fatal(){}, log(){}, child(){ return this }, setLevel(){}, isLevelEnabled(){ return false } }
const resolveLogger = (cfg) => {
  const candidate = cfg?.logger ?? cfg?.log
  if (candidate === false) return noopLogger
  if (candidate && typeof candidate === 'object') return candidate
  return defaultLogger
}

/**
 * Locate an existing Protomux channel by id+protocol.
 * @param {any} [cfg]
 */
export const getChannel = (cfg = {}) => {
  const { mux, id, protocol } = normalizeCfg(cfg)
  for (const ch of mux) if (b4a.equals(ch.id, id) && ch.protocol === protocol) return ch
  return null
}

/**
 * True if a channel is already open for id+protocol.
 * @param {any} [cfg]
 */
export const isChannelOpen = (cfg = {}) => {
  const { mux, id, protocol } = normalizeCfg(cfg)
  return mux.opened({ id, protocol })
}

/**
 * Ensure a Protomux channel exists and attach handlers.
 * Mutates cfg to add { plexChannel, plexSend }.
 * @param {any} [cfg]
 */
export const ensurePlexChannel = (cfg = {}) => {
  const _cfg = normalizeCfg(cfg)
  const log = resolveLogger(_cfg)
  const { mux, id, protocol } = _cfg
  const existing = (_cfg.plexChannel ||= getChannel({ mux, id, protocol }))
  if (existing) {
    log.debug('ensure channel reuse', { protocol, hasExisting: true });
    return _cfg;
  }

  const { _dataEncoder, _handshakeEncoder } = _cfg
  log.debug('create channel', { protocol, id: id ? b4a.toString(id, 'hex') : undefined });
  const channel = mux.createChannel({
    ..._cfg,
    id,
    protocol,
    handshake: _handshakeEncoder,
    onopen: _cfg.onopen,
    onclose: _cfg.onclose,
    ondestroy: _cfg.ondestroy,
    messages: [{ encoding: _dataEncoder, onmessage }]
  })
  _cfg.plexChannel = channel
  _cfg.plexSend = (msg) => {
    const len = msg?.length;
    const res = _cfg.plexChannel.messages[0].send(msg);
    log.debug('plex send', { protocol, len, res });
    return res;
  }
  log.debug?.('ensure channel new', { protocol, id: id ? b4a.toString(id, 'hex') : undefined });
  return _cfg

  function onmessage (msg) {
    log.debug('plex message received', { protocol, len: msg?.length });
    return _cfg?.onmessage?.(msg);
  }
}

/**
 * Open channel (creating it if needed) and send handshake.
 * @param {any} [cfg]
 */
export const openPlexChannel = (cfg = {}) => {
  if (isChannelOpen(cfg)) return normalizeCfg(cfg)
  const _cfg = ensurePlexChannel(cfg)
  const { plexChannel, handshakeMessage } = _cfg
  // If a handshakeMessage is provided, send it. If a handshakeEncoding is set
  // but no message, open with undefined (no payload). Otherwise default to zeroBuff.
  const hs = (handshakeMessage !== undefined)
    ? handshakeMessage
    : (cfg.handshakeEncoding ? undefined : zeroBuff)
  plexChannel.open(hs)
  return _cfg
}

/**
 * Pair and open when a remote peer pairs.
 * @param {any} [cfg]
 * @param onPair
 */
export const pairPlexChannel = (cfg = {}, onPair) => {
  const _cfg = normalizeCfg(cfg)
  const log = resolveLogger(_cfg)
  const { mux, id, protocol, onPair: _cfg_onPair = () => {} } = _cfg
  _cfg.onPair = (cfg) => (onPair || _cfg_onPair)(cfg);
  mux.pair({ id, protocol }, () => {
    log.debug('pair callback invoked', { protocol, id: id ? b4a.toString(id, 'hex') : undefined });
    _cfg.onPair(openPlexChannel(_cfg));
  });
  return _cfg
}

/**
 * Unpair a previously paired channel.
 * @param {any} [cfg]
 */
export const unpairPlexChannel = (cfg = {}) => {
  const { mux, id, protocol } = normalizeCfg(cfg)
  mux.unpair({ id, protocol })
}

/** Advanced: low-level listen that wires handlers directly (no Duplex wrapper). */
export const listenChannel = (cfg = {}, onPair) => pairPlexChannel(cfg, onPair)
/** Advanced: low-level connect that opens immediately (no Duplex wrapper). */
export const connectChannel = (cfg = {}) => openPlexChannel(cfg)
