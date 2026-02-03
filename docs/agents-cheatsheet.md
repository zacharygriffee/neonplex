# Plex Agent Cheatsheet

Minimal snippets for automations/agents to exercise the core API quickly.

## Duplex in three lines (TCP)
```js
import net from 'net';
import b4a from 'b4a';
import { listen, connect } from '@neonloom/plex';

const id = b4a.from([0x01]);
const server = net.createServer((socket) => {
  const ch = listen({ stream: socket, id, log: false });
  ch.on('data', (buf) => ch.write(buf)); // echo
});
server.listen(0, () => {
  const socket = net.connect(server.address().port);
  const ch = connect({ stream: socket, id, log: false });
  ch.once('remote-open', () => ch.write(b4a.from('hi')));
  ch.on('data', (buf) => console.log('got', b4a.toString(buf)));
});
```

## WebSocket transport (Node or browser WebSocket)
```js
import { WebSocket } from 'ws';            // or the browser global
import { createWebSocketStream, connect } from '@neonloom/plex';

const ws = new WebSocket('wss://example');
const stream = createWebSocketStream(ws);
const ch = connect({ stream, id: myId, log: false });
ch.once('remote-open', () => ch.write(myPayload));
```

## Peer + pool (round‑robin)
```js
import { createPeer } from '@neonloom/plex/peer';
import { createPeerPool } from '@neonloom/plex/pool';

const peer = createPeer(myTransport); // transport is streamx duplex or Protomux mux
const pool = createPeerPool({ log: false });
pool.add(peer);

const store = pool.connectStorePort({ id: myId }); // returns StorePort proxy
await store.put({ key: myKey, value: myVal });
```

## RPC server + client
```js
import { serveStorePortOverPlex, createStorePortProxyOverPlex } from '@neonloom/plex/rpc';

// server
serveStorePortOverPlex({
  duplex: listen({ stream, id }), // or peer.listenRpc
  port: { async get({ key }) { return { ok: true, value: b4a.from('hi') }; } },
  log: false
});

// client
const store = createStorePortProxyOverPlex({ duplex: connect({ stream, id }), log: false });
const res = await store.get({ key: myKey });
```

## Service composition (multiple routes)
```js
import { exposeStorePort, connectStorePort } from '@neonloom/plex/service';
// server
const svc = exposeStorePort(peer, { id, lane: 'rpc' }, myStorePort);
// client
const store = connectStorePort(peer, { id, lane: 'rpc' });
```

## Handy flags
- `log: false` or `logger: myLogger` on all public factories to silence or override logging.
- `eagerOpen: true` to open the streamx duplex immediately (connect side opens channel as soon as the duplex opens).
- `handshakeEncoding` + `handshakeMessage` to exchange small metadata on open.

## Troubleshooting quickies
- Stuck waiting? Ensure both sides installed listeners *before* writing and that you wait for `'remote-open'`.
- Binary mismatch? Always use `b4a` (`b4a.from`, `b4a.equals`, `b4a.alloc`) instead of `Buffer`.
- Multiple lanes over one transport? Reuse the same Protomux mux and vary `id` or `protocol`.
