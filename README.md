# Plex Standalone

Plex is NeonLoom's Protomux channel helper extracted into a standalone package.
It provides a small toolkit for wiring streamx `Duplex` connections over Protomux,
including high–level helpers for peers, RPC, pools, and WebSocket transports.

## Install

```sh
npm install @neonloom/plex
```

## Usage

```js
import { listen, connect } from '@neonloom/plex';
import net from 'node:net';

const id = new Uint8Array([0x01, 0x02]);

const server = net.createServer((socket) => {
  const channel = listen({ stream: socket, id });
  channel.on('data', (buf) => {
    console.log('server received', buf);
    channel.write(buf);
  });
});
server.listen(4000);

const socket = net.connect(4000);
const client = connect({ stream: socket, id });
client.write(new TextEncoder().encode('hello'));
client.on('data', (buf) => console.log('client received', buf));
```

See `test/*.brittle.test.js` for more scenarios, including peer pools and Store
Port RPC helpers.
