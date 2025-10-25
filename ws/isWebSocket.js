// @ts-check
/**
 * Detect if a given value is a WebSocket-like instance.
 * Works for browser `WebSocket` and Node `ws` (v8+).
 *
 * @param {any} x
 * @returns {boolean}
 */
export function isWebSocket (x) {
    return !!(
        x &&
        typeof x === 'object' &&
        typeof x.send === 'function' &&
        typeof x.close === 'function' &&
        // Browser WS: readyState numeric; Node ws: readyState constant
        (typeof x.readyState === 'number' || typeof x.readyState === 'string') &&
        // URL is present in browser; may be absent in Node ws
        (typeof x.url === 'string' || typeof x._socket === 'object')
    );
}
