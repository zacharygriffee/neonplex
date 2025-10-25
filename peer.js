// @ts-check
import b4a from 'b4a';
import { connectDuplex, listenDuplex } from './duplex.js';
import Protomux from 'protomux';
import { defaultProtocol } from './config.js';
import { isWebSocket } from './ws/isWebSocket.js';
import { createWebSocketStream } from './ws/index.js';
import { WEBSOCKET } from './ws/symbol.js';

/**
 * @typedef {import('streamx').Duplex & {
 *   write: (buf: Uint8Array, cb?: (err?: Error|null) => void) => void,
 *   destroy: (err?: Error|null) => void
 * }} NLTransport
 *
 * @typedef {object} PeerConfig
 * @property {string} protocolBase
 * @property {any} mux
 * @property {NLTransport} transport
 * @property {any=} websocket
 */

/**
 * Create a Peer helper around a base transport/mux.
 * Provides helpers to open nested Plex duplex channels for different concerns
 * (e.g., 'rpc', 'events'). This does not add policy; it only standardizes
 * how we derive/open channels consistently.
 *
 * Note: ids must be Uint8Array (bytes). Callers own any string→bytes conversion.
 *
 * @param {{ stream:any, protocolBase?:string }} cfg
 */
export function createPeer (cfg = {}) {
  let { stream, protocolBase = defaultProtocol } = cfg;
  // Avoid mutating cfg; if a WebSocket is passed, wrap locally
  let originalWebSocket = undefined;
  if (isWebSocket(stream)) {
    originalWebSocket = stream;
    stream = createWebSocketStream(stream);
  }
  if (!stream) throw new TypeError('createPeer: stream required');
  // Ensure a single Protomux mux is used across all lanes for this peer
  const mux = Protomux.from(stream);

  /**
   * Open a nested Plex duplex for a named lane under the base protocol.
   *
   * @param {'connect'|'listen'} role
   * @param {{ id:Uint8Array, lane?:string, protocol?:string, handshakeEncoding?:any, handshakeMessage?:any, encoding?:any, eagerOpen?:boolean }} opts
   */
  function openLane (role, opts = {}) {
    const { id, lane, protocol, handshakeEncoding, handshakeMessage, encoding, eagerOpen, onError, onPair } = opts;
    if (!id || !b4a.isBuffer(id)) throw new TypeError('openLane: id (Uint8Array) required');
    const laneProtocol = protocol ?? (lane ? `${protocolBase}/${lane}` : protocolBase);
    // Pass the mux as the underlying stream to avoid creating multiple Protomux instances
    const base = { stream, mux, id, protocol: laneProtocol, handshakeEncoding, handshakeMessage, encoding, eagerOpen, onError, onPair };
    return role === 'listen' ? listenDuplex(base) : connectDuplex(base);
  }

  const peer = {
    /** Open a duplex for RPC traffic (connect side). */
    connectRpc (id, opts = {}) { return openLane('connect', { ...opts, id, lane: 'rpc' }); },
    /** Open a duplex for RPC traffic (listen side). */
    listenRpc (id, opts = {}) { return openLane('listen',  { ...opts, id, lane: 'rpc' }); },
    /** Open a duplex for stream/topic traffic (connect side). */
    connectStream (id, opts = {}) { return openLane('connect', { ...opts, id, lane: 'events' }); },
    /** Open a duplex for stream/topic traffic (listen side). */
    listenStream (id, opts = {}) { return openLane('listen',  { ...opts, id, lane: 'events' }); },
    /** Escape hatch to open a custom lane name. */
    connectLane (id, lane, opts = {}) { return openLane('connect', { ...opts, id, lane }); },
    /** Escape hatch to open a custom lane name. */
    listenLane (id, lane, opts = {}) { return openLane('listen',  { ...opts, id, lane }); },
    /**
     * Get the effective transport used by this peer.
     * @returns {NLTransport}
     */
    getTransport () { return /** @type {NLTransport} */(stream); },
    /**
     * Get a snapshot of peer configuration/state for introspection.
     * @returns {PeerConfig}
     */
    getConfig () { return { protocolBase, mux, transport: /** @type {NLTransport} */(stream), websocket: originalWebSocket }; }
  };

  // Expose original WebSocket (if provided) non-enumerably on the returned peer
  if (originalWebSocket) {
    Object.defineProperty(peer, WEBSOCKET, { value: originalWebSocket, enumerable: false });
  }

  return peer;
}
