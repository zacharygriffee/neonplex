// Re-export minimal surface that is runtime-agnostic for browser builds.
export { listenDuplex as listen, connectDuplex as connect, listenDuplex, connectDuplex } from '../duplex.js'
export { listenChannel, connectChannel } from '../channel.js'
export { createWebSocketStream } from '../ws/index.js'
