# Plex Standalone

Plex is NeonLoom's Protomux channel helper extracted into a standalone package.
It provides a small toolkit for wiring streamx `Duplex` connections over Protomux,
including high–level helpers for peers, RPC, pools, and WebSocket transports.

## Install

```sh
npm install @neonloom/plex
```

## Quick start

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

> Plex leans on [`b4a`](https://github.com/mafintosh/b4a) for binary data. Use `b4a` helpers (`b4a.from`, `b4a.equals`, `b4a.alloc`) instead of Node’s legacy `Buffer` APIs to keep implementations portable across runtimes (Node, browsers, Deno).
>
> Always attach your listeners before initiating traffic and wait for the `'remote-open'` event before calling `duplex.write(...)`. Both peers acknowledge channel readiness via that handshake; skipping it risks dropping the first payload.

See `test/*.brittle.test.js` for end-to-end examples covering peer pools, RPC helpers, policy routing, and error flows.

## API overview

- `listen(config)` / `connect(config)` (`duplex.js`): streamx `Duplex` wrappers that manage channel pairing, buffering, and lifecycle events.
- `listenChannel(config)` / `connectChannel(config)` (`channel.js`): lower-level Protomux channel helpers if you want to manage your own streams.
- `createWebSocketStream(opts)` (`ws/index.js`): converts a WebSocket into a streamx-compatible duplex transport (Node or browser).
- `peer`, `pool`, `rpc`, `service`: higher-level coordination helpers (peers, peer pools with policies, capability-based RPC, and service composition).
- `codec`, `bytes`, `result`, `log`, `env`: helper modules for encoding, binary buffers, tagged results, structured logging, and environment config.

All exports are available via the package export map, e.g. `import { Pool } from '@neonloom/plex/pool'`.

## Module reference

- `index.js`: Top-level re-exports `listen/connect` duplex helpers and WebSocket stream factory.
- `channel.js`: Channel pairing utilities (`listenChannel`, `connectChannel`, `unpairPlexChannel`).
- `config.js`: Normalizes shared configuration (`id`, `multiplex`, backpressure options, hooks).
- `duplex.js`: Streamx `Duplex` wrapper that buffers until channels are open and emits lifecycle events (`remote-open`, `channel-close`, `channel-destroy`).
- `peer.js`: Convenience helpers for representing remote peers.
- `pool.js`: Peer pool with weighted and sticky routing policies and health tracking.
- `service.js`: Glue for composing multiple RPC/service routes on top of a plex connection.
- `rpc.js`: Capability-aware StorePort RPC client/server helpers (timeouts, cancellations, envelopes).
- `ws/*`: WebSocket transport helpers, including `WebSocketStream` and WebSocket detection utilities.
- `codec/*`, `bytes/*`, `result/*`, `log/*`, `env/*`: Supporting modules that keep encoding, binary, logging, results, and environment concerns reusable and consistent.

### Module cheatsheet

```js
// Binary helpers (Node + browser safe)
import { toU8, equal, utf8 } from '@neonloom/plex/bytes';
const payload = toU8('hello');
console.log(equal(payload, utf8.encode('hello'))); // true

// Codec factory (wraps compact-encoding)
import { makeCodec } from '@neonloom/plex/codec';
const textCodec = makeCodec('utf8');
const encoded = textCodec.encode('hi');

// Result helpers (typed envelopes)
import { ok, err } from '@neonloom/plex/result';
const value = ok({ count: 1 });
const failure = err('Timeout', 'Store did not respond in time');

// Logger
import { createLogger } from '@neonloom/plex/log';
const log = createLogger({ name: 'example', level: 'info' });
log.info('connected', { peer: 'alpha' });

// Environment bootstrap
import { loadRootEnv } from '@neonloom/plex/env';
loadRootEnv(); // loads once globally

// WebSocket stream wrapper (Node or browser WebSocket)
import { createWebSocketStream } from '@neonloom/plex/ws';
const wsStream = createWebSocketStream(webSocket);
```

## Architecture notes

- Plex builds on top of `protomux`, mapping a single logical channel to a streamx `Duplex`.
- `listen/connect` normalize the provided configuration (mux instance, protocol, id, hooks) before wiring the Protomux channel handlers.
- Each duplex defers writes until the channel handshake completes; once connected it passes data through with minimal overhead.
- Pools and services sit above these duplexes, letting you reuse transports across multiple logical routes while applying policies (round-robin, weighted, sticky).
- RPC helpers leverage the `result` module to express explicit envelopes for success, errors, timeouts, and cancellations.

## Environments

- **Node.js**: Tested against active LTS. TCP transports typically use `net` sockets as shown above.
- **Bare runtime**: Ships a top-level import map (`package.json#imports`) so Bare resolves builtins like `fs`, `path`, and `process` to the matching `bare-*` modules. Keep the guard (`npm run check:bare`) green to ensure no `node:` specifiers slip in. For additional shims, refer to `/home/zevilz/Virtualia/cyberpunk-conspiracy-website/docs/platforms/bare/{bare-modules.md,node-compatibility.md}`.
- **Binary data**: Always use `b4a` utilities for buffers to remain portable across environments.

## Logging

Structured logging lives in `log/index.js`. Pass `PLEX_MUX_LOG_LEVEL` (or `NL_LOG_LEVEL`) to control verbosity. For production integrations, wire the logger hooks into your logging sink or silence them by providing a custom logger implementation.

## Testing & scripts

- `npm run check:bare`: static guard that fails if any `node:*` specifier sneaks into the tree.
- `npm test`: runs the Bare guard and then executes the brittle suite (`test/*.brittle.test.js`).
- `npm run smoke:*`: TCP and WebSocket smoke tests that exercise the dev helpers end-to-end.

- More architectural details live in `docs/architecture.md`.
- Runtime compatibility notes (Node & Bare focus) live in `docs/runtime-compatibility.md`.
