import { test } from 'brittle'
import duplexThrough from 'duplex-through'
import b4a from 'b4a'
import { createPeer } from '../peer.js'
import { createPeerPool } from '../pool.js'
import { exposeStorePort } from '../service.js'
import { ok, err, CODES, isOk } from '../result/index.js'

function createMemoryPort () {
  /** @type {Map<string, Uint8Array>} */
  const m = new Map()
  const hex = (u8) => b4a.toString(u8, 'hex')
  const isBuf = (x) => b4a.isBuffer(x)
  return {
    async get ({ key }) {
      if (!isBuf(key)) return err(CODES.BadArg, 'get.key must be bytes')
      const v = m.get(hex(key))
      return v === undefined ? ok(undefined) : ok(v)
    },
    async put ({ key, value }) {
      if (!isBuf(key)) return err(CODES.BadArg, 'put.key must be bytes')
      if (!isBuf(value)) return err(CODES.BadArg, 'put.value must be bytes')
      m.set(hex(key), value)
      return ok()
    },
    async del ({ key }) {
      if (!isBuf(key)) return err(CODES.BadArg, 'del.key must be bytes')
      m.delete(hex(key))
      return ok()
    },
    async *scan () {}
  }
}

test('pool: round-robin across peers for unary calls', async t => {
  t.plan(2)
  const [a1, b1] = duplexThrough();
  const [a2, b2] = duplexThrough();
  const id = b4a.from('cc', 'hex')

  const peerSrv1 = createPeer({ stream: a1 })
  const peerCli1 = createPeer({ stream: b1 })
  const peerSrv2 = createPeer({ stream: a2 })
  const peerCli2 = createPeer({ stream: b2 })

  const port1 = createMemoryPort()
  const port2 = createMemoryPort()

  const h1 = exposeStorePort(peerSrv1, { id }, port1)
  const h2 = exposeStorePort(peerSrv2, { id }, port2)

  const pool = createPeerPool()
  pool.add(peerCli1)
  pool.add(peerCli2)

  t.teardown(() => {
    h1.dispose()
    h2.dispose()
    try {
      pool.destroy()
    } catch {}
  })

  const store = pool.connectStorePort({ id })

  const put = await store.put({ key: b4a.from('k0'), value: b4a.from('v0') })
  t.is(isOk(put), true)
  const get = await store.get({ key: b4a.from('k0') })
  t.is(isOk(get), true)
})

test('pool: stats and events expose peer health', async t => {
  const [a, b] = duplexThrough()
  const peerSrv = createPeer({ stream: a })
  const peerCli = createPeer({ stream: b })
  const id = b4a.from('dd', 'hex')
  const port = createMemoryPort()
  const handle = exposeStorePort(peerSrv, { id }, port)

  const pool = createPeerPool()
  const events = []
  pool.events.on('peer-add', (info) => events.push({ type: 'add', info }))
  pool.events.on('peer-remove', (info) => events.push({ type: 'remove', info }))
  pool.add(peerCli)

  const stats = pool.stats()
  t.is(stats.length, 1)
  t.is(stats[0].inFlight, 0)

  const store = pool.connectStorePort({ id })
  await store.put({ key: b4a.from('s'), value: b4a.from('v') })
  const after = pool.stats()[0]
  t.ok(after.successes >= 1)

  handle.dispose()
  pool.remove(peerCli)
  t.ok(events.some((e) => e.type === 'add'))
  t.ok(events.some((e) => e.type === 'remove'))
  pool.destroy()
})

test('pool: emits no-peer call events when pool is empty', async t => {
  t.plan(3)
  const pool = createPeerPool()
  const id = b4a.from('ee', 'hex')
  const store = pool.connectStorePort({ id, policy: 'round-robin' })

  const events = []
  pool.events.on('call', (ev) => events.push(ev))

  let error
  try {
    await store.get({ key: b4a.from('k0') })
  } catch (err) {
    error = err
  }

  t.ok(error instanceof Error)
  const noPeer = events.find((ev) => ev?.type === 'no-peer')
  t.ok(noPeer)
  t.is(noPeer?.method, 'get')
})
