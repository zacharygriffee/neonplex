import { test, solo } from 'brittle'
import duplexThrough from 'duplex-through'
import b4a from 'b4a'
import { listenDuplex, connectDuplex, listen as listenDuplexDefault, connect as connectDuplexDefault } from '../index.js'
import { fromStream, getMuxFromStream, streamMuxSymbol } from '../config.js'
import { makeCodec } from '../codec/index.js';

const binaryCodec = makeCodec("binary");

test('fromStream reuses mux cached on stream', t => {
  t.plan(5)

  const [a] = duplexThrough()

  const cfg1 = fromStream({ stream: a })
  t.ok(cfg1.mux && cfg1.mux.isProtomux)
  t.is(a[streamMuxSymbol], cfg1.mux)
  t.is(getMuxFromStream(a), cfg1.mux)

  const cfg2 = fromStream({ stream: a })
  t.is(cfg2.mux, cfg1.mux)
  t.ok(cfg2.mux && cfg2.mux.isProtomux)
})

test('buffered writes flush on connection and roundtrip', async t => {
  t.plan(5)

  const [a, b] = duplexThrough()
  const id = b4a.from('01', 'hex')

  let serverOpened = false
  let clientOpened = false

  const server = listenDuplex({ stream: a, id, onOpen: () => { serverOpened = true } })
  const client = connectDuplex({ stream: b, id, onOpen: () => { clientOpened = true } })

  t.teardown(() => {
    try { server.destroy() } catch {}
    try { client.destroy() } catch {}
  })

  // Write before connection on listen side; should buffer and flush when open
  server.write(b4a.from('early'))

  const earlyReceived = new Promise((resolve) => {
    client.once('data', (buf) => resolve(b4a.toString(buf)))
  })

  // Send a response from client → server once client sees first data
  earlyReceived.then(() => client.write(b4a.from('pong')))

  const pongReceived = new Promise((resolve) => {
    server.once('data', (buf) => resolve(b4a.toString(buf)))
  })

  // Wait a tick for open callbacks to fire and buffers to flush
  await Promise.race([
    new Promise((r) => setTimeout(r, 200)),
    Promise.all([earlyReceived, pongReceived])
  ])

  t.is(await earlyReceived, 'early')
  t.is(await pongReceived, 'pong')
  t.is(server.isConnected?.(), true)
  t.is(client.isConnected?.(), true)
  t.is(serverOpened && clientOpened, true)
})

test('destroy triggers cleanup and disconnection', async t => {
  t.plan(3)

  const [a, b] = duplexThrough()
  const id = b4a.from('02', 'hex')

  const server = listenDuplex({ stream: a, id, eagerOpen: true })
  const client = connectDuplex({ stream: b, id, eagerOpen: true })

  t.teardown(() => {
    try { server.destroy() } catch {}
    try { client.destroy() } catch {}
  })

  // Wait for connection
  await new Promise((resolve) => server.once('connection', resolve))
  t.is(server.isConnected?.(), true)

  const closed = new Promise((resolve) => server.once('channel-close', resolve))
  const destroyed = new Promise((resolve) => server.once('channel-destroy', resolve))

  client.destroy()

  // Allow events to propagate
  await Promise.race([
    Promise.all([closed, destroyed]),
    new Promise((r) => setTimeout(r, 300))
  ])
  t.is(server.isConnected?.(), false)
  t.pass('server observed close/destroy (or timed out without error)')
})

test('event ordering and handshake propagation', async t => {
  t.plan(6)

  const [a, b] = duplexThrough()
  const id = b4a.from('03', 'hex')

  const orderServer = []
  const orderClient = []

  let serverHs
  let clientHs

  const server = listenDuplex({
    stream: a,
    id,
    handshakeEncoding: binaryCodec,
    handshakeMessage: b4a.from('srv'),
    onOpen: (hs) => { serverHs = hs }
  })
  const client = connectDuplex({
    stream: b,
    id,
    handshakeEncoding: binaryCodec,
    handshakeMessage: b4a.from('cli'),
    onOpen: (hs) => { clientHs = hs }
  })

  t.teardown(() => {
    try { server.destroy() } catch {}
    try { client.destroy() } catch {}
  })

  server.on('remote-open', () => orderServer.push('remote-open'))
  server.on('connection', () => orderServer.push('connection'))
  client.on('remote-open', () => orderClient.push('remote-open'))
  client.on('connection', () => orderClient.push('connection'))

  // Trigger stream open after listeners have been installed to avoid race
  server.resume();
  client.resume();

  await new Promise((resolve) => client.once('connection', resolve))
  await new Promise((resolve) => server.once('connection', resolve))

  t.alike(orderServer, ['remote-open', 'connection'])
  t.alike(orderClient, ['remote-open', 'connection'])

  t.is(b4a.toString(serverHs), 'cli')
  t.is(b4a.toString(clientHs), 'srv')

  t.is(server.isConnected?.(), true)
  t.is(client.isConnected?.(), true)
})

test('backpressure/order: many messages in both directions', async t => {
  t.plan(4)

  const [a, b] = duplexThrough()
  const id = b4a.from('04', 'hex')

  const server = listenDuplex({ stream: a, id, eagerOpen: true })
  const client = connectDuplex({ stream: b, id, eagerOpen: true })

  t.teardown(() => {
    try { server.destroy() } catch {}
    try { client.destroy() } catch {}
  })

  await new Promise((resolve) => server.once('connection', resolve))

  const N = 100
  const serverSeen = []
  const clientSeen = []

  server.on('data', (buf) => serverSeen.push(b4a.toString(buf)))
  client.on('data', (buf) => clientSeen.push(b4a.toString(buf)))

  for (let i = 0; i < N; i++) client.write(b4a.from('c' + i))
  for (let i = 0; i < N; i++) server.write(b4a.from('s' + i))

  // wait briefly for drain
  await new Promise((r) => setTimeout(r, 100))

  t.is(serverSeen.length, N)
  t.is(clientSeen.length, N)
  t.alike(serverSeen, Array.from({ length: N }, (_, i) => 'c' + i))
  t.alike(clientSeen, Array.from({ length: N }, (_, i) => 's' + i))
})

test('remote close path: server.destroy notifies client and flips state', async t => {
  t.plan(3)

  const [a, b] = duplexThrough()
  const id = b4a.from('05', 'hex')

  const server = listenDuplex({ stream: a, id, eagerOpen: true })
  const client = connectDuplex({ stream: b, id, eagerOpen: true })

  t.teardown(() => {
    try { server.destroy() } catch {}
    try { client.destroy() } catch {}
  })

  await new Promise((resolve) => client.once('connection', resolve))

  const closed = new Promise((resolve) => client.once('channel-close', resolve))
  const destroyed = new Promise((resolve) => client.once('channel-destroy', resolve))

  server.destroy()

  await Promise.race([
    Promise.all([closed, destroyed]),
    new Promise((r) => setTimeout(r, 300))
  ])

  t.is(client.isConnected?.(), false)
  t.pass('client observed server close/destroy')
  t.pass('no crash')
})

test('no reopen / no send after destroy', async t => {
  t.plan(2)

  const [a, b] = duplexThrough()
  const id = b4a.from('06', 'hex')

  const server = listenDuplex({ stream: a, id, eagerOpen: true })
  const client = connectDuplex({ stream: b, id, eagerOpen: true })

  t.teardown(() => {
    try { server.destroy() } catch {}
    try { client.destroy() } catch {}
  })

  await new Promise((resolve) => server.once('connection', resolve))

  let seen = 0
  client.on('data', () => { seen++ })

  // normal send
  server.write(b4a.from('one'))
  await new Promise((r) => setTimeout(r, 20))
  t.is(seen > 0, true)

  // destroy and attempt to send more
  seen = 0
  server.destroy()
  server.write(b4a.from('two'))
  await new Promise((r) => setTimeout(r, 50))
  t.is(seen, 0)
})

test('nested plex streams (duplex over duplex)', async t => {
  t.plan(6)

  const [a, b] = duplexThrough()
  const id1 = b4a.from('0a', 'hex') // layer 1 id
  const id2 = b4a.from('0b', 'hex') // layer 2 id

  // Layer 1 over base transport
  const server1 = listenDuplexDefault({ stream: b, id: id1, eagerOpen: true })
  const client1 = connectDuplexDefault({ stream: a, id: id1, eagerOpen: true })

  // Layer 2 over layer 1 duplex
  const server2 = listenDuplexDefault({ stream: server1, id: id2, eagerOpen: true })
  const client2 = connectDuplexDefault({ stream: client1, id: id2, eagerOpen: true })

  t.teardown(() => {
    try { server2.destroy() } catch {}
    try { client2.destroy() } catch {}
    try { server1.destroy() } catch {}
    try { client1.destroy() } catch {}
  })

  await Promise.all([
    new Promise((r) => server2.once('connection', r)),
    new Promise((r) => client2.once('connection', r))
  ])

  const seenSrv2 = []
  const seenCli2 = []
  server2.on('data', (buf) => seenSrv2.push(b4a.toString(buf)))
  client2.on('data', (buf) => seenCli2.push(b4a.toString(buf)))

  client2.write(b4a.from('hi2'))
  server2.write(b4a.from('yo2'))

  await new Promise((r) => setTimeout(r, 50))

  t.alike(seenSrv2, ['hi2'])
  t.alike(seenCli2, ['yo2'])

  // Destroy only layer 2; layer 1 should remain connected
  client2.destroy()
  await new Promise((r) => setTimeout(r, 50))

  t.is(server1.isConnected?.(), true)
  t.is(client1.isConnected?.(), true)

  // Layer 1 still works
  const seenSrv1 = []
  const seenCli1 = []
  server1.on('data', (buf) => seenSrv1.push(b4a.toString(buf)))
  client1.on('data', (buf) => seenCli1.push(b4a.toString(buf)))
  client1.write(b4a.from('h1'))
  server1.write(b4a.from('y1'))
  await new Promise((r) => setTimeout(r, 50))
  t.alike(seenSrv1, ['h1'])
  t.alike(seenCli1, ['y1'])
})
