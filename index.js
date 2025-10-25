// @ts-check
/**
 * NeonLoom Plex module
 * Public API is re-exported from modular files for clarity.
 *
 * Default exports map to Duplex creators for ergonomics:
 * - listen(cfg) => streamx Duplex
 * - connect(cfg) => streamx Duplex
 * Advanced (low-level) channel helpers are exposed as listenChannel/connectChannel.
 */
export { connectDuplex as connect, listenDuplex as listen, connectDuplex, listenDuplex } from './duplex.js'
export { connectChannel, listenChannel } from './channel.js'
export { createWebSocketStream } from './ws/index.js'
