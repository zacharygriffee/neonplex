import { test } from 'brittle'
import duplexThrough from 'duplex-through'
import b4a from 'b4a'
import { createPeer } from '../peer.js'
import { createPeerPool } from '../pool.js'
import { exposeStorePort } from '../service.js'
import { ok } from '../result/index.js'

function createProbePort(tag) {
  const tagBuf = b4a.from(tag)
  return {
    async get() { return ok(tagBuf) },
    async put() { return ok() },
    async del() { return ok() },
    async *scan() {}
  }
}

test('pool policy: weighted favors higher-weight peers', async t => {
  const [a1, b1] = duplexThrough();
  const [a2, b2] = duplexThrough();
  const [a3, b3] = duplexThrough();
  const id = b4a.from('aa', 'hex')

  const srv1 = createPeer({ stream: a1 })
  const cli1 = createPeer({ stream: b1 })
  const srv2 = createPeer({ stream: a2 })
  const cli2 = createPeer({ stream: b2 })
  const srv3 = createPeer({ stream: a3 })
  const cli3 = createPeer({ stream: b3 })

  const h1 = exposeStorePort(srv1, { id }, createProbePort('p1'))
  const h2 = exposeStorePort(srv2, { id }, createProbePort('p2'))
  const h3 = exposeStorePort(srv3, { id }, createProbePort('p3'))

  const pool = createPeerPool()
  pool.add(cli1, { weight: 1, meta: { locality: 'wan' } })
  pool.add(cli2, { weight: 5, meta: { locality: 'wan' } })
  pool.add(cli3, { weight: 1, meta: { locality: 'wan' } })

  const store = pool.connectStorePort({ id, policy: 'weighted' })
  const counts = { p1: 0, p2: 0, p3: 0 }
  for (let i = 0; i < 60; i++) {
    const env = await store.get({})
    const tag = b4a.toString(env.value)
    counts[tag]++
  }
  t.ok(counts.p2 > counts.p1 && counts.p2 > counts.p3)
  t.teardown(() => { h1.dispose(); h2.dispose(); h3.dispose(); pool.destroy() })
})

test('pool policy: sticky maps same key to same peer', async t => {
  const [a1, b1] = duplexThrough();
  const [a2, b2] = duplexThrough();
  const id = b4a.from('bb', 'hex')

  const srv1 = createPeer({ stream: a1 })
  const cli1 = createPeer({ stream: b1 })
  const srv2 = createPeer({ stream: a2 })
  const cli2 = createPeer({ stream: b2 })

  const h1 = exposeStorePort(srv1, { id }, createProbePort('L'))
  const h2 = exposeStorePort(srv2, { id }, createProbePort('R'))

  const pool = createPeerPool()
  pool.add(cli1)
  pool.add(cli2)

  const store = pool.connectStorePort({ id, policy: 'sticky', keyFn: (opts) => opts.key })

  const k1 = b4a.from('key-a')
  const k2 = b4a.from('key-b')
  const res1 = await Promise.all(Array.from({ length: 5 }, () => store.get({ key: k1 })))
  const res2 = await Promise.all(Array.from({ length: 5 }, () => store.get({ key: k2 })))
  const tag1 = new Set(res1.map(e => b4a.toString(e.value)))
  const tag2 = new Set(res2.map(e => b4a.toString(e.value)))
  t.is(tag1.size, 1)
  t.is(tag2.size, 1)
  t.teardown(() => { h1.dispose(); h2.dispose(); pool.destroy() })
})
