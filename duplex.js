// @ts-check
import process from 'process'
import { Duplex } from 'streamx'
import { normalizeCfg } from './config.js'
import {listenChannel, connectChannel, unpairPlexChannel, getChannel} from './channel.js'
import { createLogger } from './log/index.js'

/**
 * @typedef {import('./config.js').PlexBaseConfig} PlexBaseConfig
 * @typedef {import('./config.js').PlexChannelConfig} PlexChannelConfig
 * @typedef {import('./config.js').PlexDuplexOptions} PlexDuplexOptions
 * @typedef {PlexBaseConfig & PlexChannelConfig & PlexDuplexOptions} PlexDuplexConfig
 */

/**
 * Plex Duplex
 * A streamx Duplex that wraps a single Protomux channel (1:1 connection).
 *
 * Events (emitted by the Duplex instance):
 * - 'remote-open' (handshake: Uint8Array): remote called channel.open(handshake)
 * - 'connection' (handshake: Uint8Array): alias of 'remote-open'
 * - 'channel-close': remote side closed the channel
 * - 'channel-destroy': channel destroyed (fires after close if remote closed)
 *
 * Hooks (provided via cfg – optional):
 * - onOpen(handshake): functional hook for remote-open
 *
 * Behavior:
 * - Writes buffer until the Protomux channel is fully open on the listen side.
 * - destroy() closes the channel (best-effort) and unpairs to notify remote, then ends the stream.
 * - Fully synchronous: no promises/microtasks in core logic (pair remains event-driven by Protomux).
 *
 * Methods:
 * - isConnected(): boolean — true only when duplex is alive and the channel is open.
 */

const extractStreamConfig = (cfg = {}) => {
  const {
    highWaterMark,
    map,
    byteLength,
    signal,
    eagerOpen,
    mapWritable,
    byteLengthWritable,
    mapReadable,
    byteLengthReadable,
    ...rest
  } = cfg
  const streamCfg = {
    highWaterMark,
    map,
    byteLength,
    signal,
    eagerOpen,
    mapWritable,
    byteLengthWritable,
    mapReadable,
    byteLengthReadable
  }
  return { streamCfg, rest }
}

/**
 * Internal factory to create a Plex Duplex around a Protomux channel.
 * @param {'listen'|'connect'} role Controls pairing behavior.
 * @param {Partial<PlexDuplexConfig>} [cfg]
 */
const makePlexDuplex = (role, cfg = {}) => {
  const { streamCfg, rest } = extractStreamConfig(cfg)
  const _cfg = normalizeCfg({ ...rest })

  let connected = false
  let alive = true

  // Handlers wired into Protomux channel
  _cfg.onmessage = (msg) => {
    if (!alive) return
    duplex.push(msg)
  }
  const onOpenHook = cfg.onOpen
  _cfg.onopen = (handshake) => {
    log.debug('plex channel opened', { role, protocol: _cfg?.protocol, handshakeLen: handshake ? handshake.length : 0 });
    if (!alive) return
    connected = true
    if (typeof onOpenHook === 'function') onOpenHook(handshake)
    duplex.emit('remote-open', handshake)
    duplex.emit('connection', handshake)
  }
  _cfg.onclose = () => {
    connected = false
    duplex.push(null)
    if (_cfg?.protocol) log.debug('plex channel close event', { role, protocol: _cfg.protocol });
    duplex.emit('channel-close')
  }
  _cfg.ondestroy = (e) => {
    // create better error stuffs
    // if (e) duplex.emit('error', new Error("Channel destroyed"));
    const err = e instanceof Error ? e : (e ? new Error(String(e)) : undefined)
    if (err) log.debug('plex channel destroyed', err, { role, protocol: _cfg?.protocol });
    else log.debug('plex channel destroyed', { role, protocol: _cfg?.protocol });
    connected = false
    alive = false
    duplex.emit('channel-destroy')
    duplex.destroy()
  }

  const duplex = new Duplex({
    ...streamCfg,
    open (cb) {
      // Always normalize and attach handlers first
      this._cfg = normalizeCfg(_cfg)
      if (role === 'listen') {
        listenChannel(this._cfg, cfg => {
          this._cfg = cfg;
          return cb(null);
        });
      } else {
        this._cfg = connectChannel(this._cfg)
        return cb(null);
      }
    },
    write (data, cb) {
      log.debug('plex duplex write', { role, protocol: this._cfg?.protocol, len: data?.length });
      this._cfg.plexSend(data);
      cb(null)
    },
    read (cb) { cb(null) },
    final (cb) { cb(null) },
    destroy (cb) {
      try {
        connected = false
        alive = false
        // Close underlying channel first, then unpair to notify remote.
        try {
          const ch = this._cfg && this._cfg.plexChannel
          if (ch && typeof ch.close === 'function') ch.close()
        } catch {}
        unpairPlexChannel(this._cfg)
      } catch {}
      cb(null)
    }
  })

  duplex._cfg ??= undefined
  duplex.isConnected = () => (!duplex.destroyed) && alive && connected

  // Expose read-only view of normalized config for advanced integrations
  // Note: do not mutate returned object fields unless you know what you're doing.
  Object.defineProperty(duplex, 'config', { get: () => _cfg })
  // Convenience getter method (same as .config)
  // @ts-ignore
  duplex.getConfig = () => _cfg
  // User-attached bag for safe metadata (does not affect internals)
  // @ts-ignore
  duplex.userData = Object.create(null)

  // duplex.once("error", e => {
  //   debugger;
  // });

  return duplex
}

/**
 * Create a Duplex that proactively opens a channel on the provided transport/mux.
 * - Triggers channel open once the Duplex opens (first read/write/pipe or eagerOpen).
 * - Emits 'remote-open'/'connection' when the handshake arrives.
 * @param {Partial<PlexDuplexConfig>} [cfg]
 * @returns {Duplex & { isConnected: () => boolean, config: any, getConfig: () => any, userData: any }}
 */
export const connectDuplex = (cfg = {}) => makePlexDuplex('connect', cfg)

/**
 * Create a Duplex that waits for a remote to pair/open, then buffers until connected.
 * - Emits 'remote-open'/'connection' when the handshake arrives.
 * - Writes are buffered until the channel is open (then flushed in order).
 * @param {Partial<PlexDuplexConfig>} [cfg]
 * @returns {Duplex & { isConnected: () => boolean, config: any, getConfig: () => any, userData: any }}
 */
export const listenDuplex = (cfg = {}) => makePlexDuplex('listen', cfg)
const log = createLogger({ name: 'plex-duplex', context: { subsystem: 'plex' }, level: process.env.PLEX_MUX_LOG_LEVEL || process.env.NL_LOG_LEVEL })
