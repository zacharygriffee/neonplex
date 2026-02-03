# Plex

Streamx-friendly plumbing on top of Protomux. Plex gives you:
- duplex wrappers that buffer until a channel is open,
- higher-level peers, pools, and RPC helpers,
- transport adapters (TCP, WebSocket, nested duplexes),
- small batteries for bytes/codec/result/log/env.

## Install

```sh
npm install @neonloom/plex
```

## Quick start (TCP echo)

```js
import { listen, connect } from '@neonloom/plex';
import net from 'net';
import b4a from 'b4a';

const id = b4a.from([0x01, 0x02]);

const server = net.createServer((socket) => {
  const channel = listen({ stream: socket, id });
  channel.on('data', (buf) => {
    console.log('server received', buf.toString());
    channel.write(buf); // echoes back to client
  });
});
server.listen(4000);

const socket = net.connect(4000);
const client = connect({ stream: socket, id });
client.on('remote-open', () => client.write(b4a.from('hello')));
client.on('data', (buf) => console.log('client received', b4a.toString(buf)));
```

> Always attach listeners before sending. Wait for `'remote-open'` before writing; both peers need the handshake to avoid dropping the first payload.

## Core concepts

- **Channel pairing**: `listen(config)` waits for a remote opener; `connect(config)` opens immediately. Both wrap a Protomux channel in a streamx `Duplex` and buffer writes until `remote-open`.
- **Identity**: `id` (bytes) + `protocol` (string, defaults to `neonloom/protocol/v1`) identify a channel. Multiple lanes can share the same transport/mux.
- **Handshake**: optional `handshakeEncoding` + `handshakeMessage` lets peers exchange a small payload during open.
- **Lifecycle events**: `remote-open`/`connection`, `channel-close`, `channel-destroy`; `duplex.isConnected()` reports readiness.
- **Transports**: any streamx-compatible Duplex works (TCP, WebSocket via `createWebSocketStream`, even nested plex duplexes).

## API surface (quick map)

- Duplex wrappers: `listen`, `connect` from `@neonloom/plex` or `duplex.js`.
- Low-level channels: `listenChannel`, `connectChannel`, `unpairPlexChannel` (`channel.js`).
- WebSocket adapter: `createWebSocketStream` (`ws/index.js`).
- Peers & pools: `peer.js`, `pool.js` (weighted/sticky/rr policies, health stats).
- RPC/service: `rpc.js` (StorePort helpers, timeouts, caps), `service.js` (compose routes over a plex link).
- Utilities: `bytes`, `codec`, `result`, `log`, `env`.

Common options (selected)
- `stream` (Duplex) or `mux` (Protomux instance)
- `id` (Uint8Array), `protocol` (string)
- `encoding`, `handshakeEncoding`, `handshakeMessage`
- `onOpen` (handshake hook), `eagerOpen` (streamx)
- `log` / `logger`: pass a logger instance or `false` to disable internal logs

## Usage snippets

```js
// Binary helpers
import { toU8, equal, utf8 } from '@neonloom/plex/bytes';
equal(toU8('hello'), utf8.encode('hello')); // true

// Codec factory
import { makeCodec } from '@neonloom/plex/codec';
const text = makeCodec('utf8').encode('hi');

// Results
import { ok, err } from '@neonloom/plex/result';
const value = ok({ count: 1 });
const failure = err('Timeout', 'Store did not respond');

// Logger (can be disabled with log:false on APIs)
import { createLogger } from '@neonloom/plex/log';
const log = createLogger({ name: 'example', level: 'info' });

// WebSocket transport (Node or browser WebSocket provided by caller)
import { createWebSocketStream } from '@neonloom/plex/ws';
const wsStream = createWebSocketStream(webSocket);
```

## Lifecycle & backpressure

- Writes before `remote-open` are buffered and flushed in order after the handshake.
- `destroy()` closes the channel and unpairs; remote receives `channel-close`/`channel-destroy`.
- Backpressure is delegated to streamx; tune via `highWaterMark`, `map`, `byteLength` options.

## Dev & tests

- `npm test` — Bare guard + brittle suite (`test/*.brittle.test.js`).
- `npm run smoke:tcp` / `npm run smoke:ws` — quick end-to-end echoes (`dev/smoke/`).
- `npm run check:bare` — fails if `node:*` imports slip in.

See also:
- `docs/architecture.md` for channel/pool diagrams.
- `docs/runtime-compatibility.md` for Node/Bare notes (kept brief here).
- `docs/bare-standards.md` for shim matrix (if you care about Bare).
