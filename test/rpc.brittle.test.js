import process from 'process'
import { test } from 'brittle'
import duplexThrough from 'duplex-through'
import b4a from 'b4a'
import { ok, err, CODES, isOk } from '../result/index.js'
import { createPeer } from '../peer.js'
import { serveStorePortOverPlex, createStorePortProxyOverPlex } from '../rpc.js'
import { withStoreCaps } from '../service.js'

const setEnv = (key, value) => {
  process.env[key] = value
}

const restoreEnv = (key, original) => {
  if (original === undefined) {
    try {
      delete process.env[key]
    } catch {
      process.env[key] = ''
    }
  } else {
    process.env[key] = original
  }
}

const asap = typeof queueMicrotask === 'function'
  ? queueMicrotask
  : (fn) => Promise.resolve().then(fn)

const ensureAbortController = () => {
  if (typeof AbortController === 'function') return AbortController
class SimpleAbortSignal {
  constructor () {
    this.aborted = false
    this.reason = undefined
    this._listeners = new Set()
    this._listenerMap = new Map()
  }
  addEventListener (event, handler, opts) {
    if (event !== 'abort' || typeof handler !== 'function') return
    if (this.aborted) {
      asap(() => handler({ type: 'abort', target: this }))
      return
    }
    const wrapped = opts?.once
      ? (evt) => {
          this.removeEventListener('abort', handler)
          handler(evt)
        }
      : handler
    this._listenerMap.set(handler, wrapped)
    this._listeners.add(wrapped)
  }
  removeEventListener (_event, handler) {
    if (typeof handler !== 'function') return
    const wrapped = this._listenerMap.get(handler) || handler
    this._listenerMap.delete(handler)
    this._listeners.delete(wrapped)
  }
    _dispatch () {
      for (const handler of Array.from(this._listeners)) {
        try { handler({ type: 'abort', target: this }) } catch {}
      }
      this._listeners.clear()
    }
  }
  class SimpleAbortController {
    constructor () {
      this.signal = new SimpleAbortSignal()
    }
    abort (reason) {
      if (this.signal.aborted) return
      this.signal.aborted = true
      this.signal.reason = reason
      this.signal._dispatch()
    }
  }
  globalThis.AbortController = SimpleAbortController
  return SimpleAbortController
}

ensureAbortController()

function createMemoryPort () {
  /** @type {Map<string, Uint8Array>} */
  const m = new Map()
  const hex = (u8) => b4a.toString(u8, 'hex')
  const isBuf = (x) => b4a.isBuffer(x)
  let lastScanCancelled = false

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
    async *scan ({ prefix } = {}) {
      let emitted = 0
      const keys = Array.from(m.keys()).map(k => b4a.from(k, 'hex'))
      const matches = prefix ? keys.filter(k => k.byteLength >= prefix.byteLength && b4a.equals(k.subarray(0, prefix.byteLength), prefix)) : keys
      try {
        for (const k of matches) {
          const v = m.get(hex(k))
          await new Promise((r) => setTimeout(r, 2))
          emitted++
          yield ok(v, { meta: { key: k } })
        }
      } finally {
        lastScanCancelled = emitted < matches.length
      }
    },
    _debug: {
      m,
      get lastScanCancelled () {
        return lastScanCancelled
      }
    }
  }
}

test('rpc: withStoreCaps injects capability tokens', async t => {
  t.plan(6)
  const [a, b] = duplexThrough()
  const id = b4a.from('aa', 'hex')

  const srvPeer = createPeer({ stream: a })
  const cliPeer = createPeer({ stream: b })

  const token = 'caps-token'
  const tokenBytes = b4a.from(token)
  let seenCaps
  let lastKey

  const port = {
    async get ({ key, caps }) {
      lastKey = key
      seenCaps = caps
      return ok(b4a.from('value'))
    }
  }

  const srv = srvPeer.listenRpc(id, { eagerOpen: true })
  const cli = cliPeer.connectRpc(id, { eagerOpen: true })

  t.teardown(() => { try { srv.destroy() } catch {}; try { cli.destroy() } catch {} })

  serveStorePortOverPlex({ duplex: srv, port })
  const remote = withStoreCaps(createStorePortProxyOverPlex({ duplex: cli }), token)

  const res1 = await remote.get({ key: b4a.from('first') })
  t.is(res1.ok, true)
  t.ok(b4a.equals(seenCaps, tokenBytes))
  t.is(b4a.toString(lastKey), 'first')

  const res2 = await remote.get({ key: b4a.from('second'), caps: b4a.from('alt-token') })
  t.is(res2.ok, true)
  t.ok(b4a.equals(seenCaps, tokenBytes))
  t.is(b4a.toString(lastKey), 'second')
})

test('rpc: unary put/get/del roundtrip', async t => {
  t.plan(5)
  const [a, b] = duplexThrough()
  const id = b4a.from('aa', 'hex')

  const srvPeer = createPeer({ stream: a })
  const cliPeer = createPeer({ stream: b })

  const port = createMemoryPort()
  const srv = srvPeer.listenRpc(id, { eagerOpen: true })
  const cli = cliPeer.connectRpc(id, { eagerOpen: true })

  t.teardown(() => { try { srv.destroy() } catch {}; try { cli.destroy() } catch {} })

  serveStorePortOverPlex({ duplex: srv, port })
  const remote = createStorePortProxyOverPlex({ duplex: cli })

  const putSeen = await remote.put({ key: b4a.from('k1'), value: b4a.from('v1') })
  t.is(putSeen.ok, true)

  const getOk = await remote.get({ key: b4a.from('k1') })
  t.is(getOk.ok, true)
  t.is(b4a.toString(getOk.value), 'v1')

  const delSeen = await remote.del({ key: b4a.from('k1') })
  t.is(delSeen.ok, true)

  const getEmpty = await remote.get({ key: b4a.from('k1') })
  t.is(getEmpty.ok, true)
})

test('rpc: scan streaming and cancel', async t => {
  t.plan(4)
  const [a, b] = duplexThrough()
  const id = b4a.from('bb', 'hex')

  const srvPeer = createPeer({ stream: a })
  const cliPeer = createPeer({ stream: b })

  const port = createMemoryPort()
  const srv = srvPeer.listenRpc(id, { eagerOpen: true })
  const cli = cliPeer.connectRpc(id, { eagerOpen: true })

  t.teardown(() => { try { srv.destroy() } catch {}; try { cli.destroy() } catch {} })

  serveStorePortOverPlex({ duplex: srv, port })
  const remote = createStorePortProxyOverPlex({ duplex: cli })

  for (let i = 0; i < 10; i++) {
    await port.put({ key: b4a.from('p/' + i), value: b4a.from('v' + i) })
  }

  const seen = []
  const iterator = remote.scan({ prefix: b4a.from('p/') })
  let count = 0
  for await (const env of iterator) {
    if (isOk(env) && env.value) seen.push(b4a.toString(env.value))
    count++
    if (count >= 3) {
      await iterator.return()
      break
    }
  }

  await new Promise(r => setTimeout(r, 10))
  t.ok(seen.length > 0)
  t.ok(seen.length < 10)
  t.is(port._debug.lastScanCancelled, true)
  t.pass('cancel propagated')
})

test('rpc: rejects oversized request payloads', async t => {
  t.plan(2)
  const [a, b] = duplexThrough()
  const id = b4a.from('cc', 'hex')

  const srvPeer = createPeer({ stream: a })
  const cliPeer = createPeer({ stream: b })

  const port = createMemoryPort()
  const srv = srvPeer.listenRpc(id, { eagerOpen: true })
  const cli = cliPeer.connectRpc(id, { eagerOpen: true })

  t.teardown(() => { try { srv.destroy() } catch {}; try { cli.destroy() } catch {} })

  serveStorePortOverPlex({ duplex: srv, port })
  const remote = createStorePortProxyOverPlex({ duplex: cli })

  const big = new Uint8Array((256 * 1024) + 1)
  let caught
  try {
    await remote.put({ key: b4a.from('large'), value: big })
  } catch (err) {
    caught = err
  }
  t.ok(caught instanceof Error)
  t.is(caught?.code || caught?.message, CODES.PayloadTooLarge)
})

test('rpc: client route limit closes connection', async t => {
  t.plan(4)
  const prevClientLimit = process.env.PLEX_RPC_MAX_CLIENT_ROUTES
  const prevServerLimit = process.env.PLEX_RPC_MAX_SERVER_ROUTES
  setEnv('PLEX_RPC_MAX_CLIENT_ROUTES', '1')
  setEnv('PLEX_RPC_MAX_SERVER_ROUTES', '0')

  const [a, b] = duplexThrough()
  const id = b4a.from('ee', 'hex')

  const srvPeer = createPeer({ stream: a })
  const cliPeer = createPeer({ stream: b })

  const port = {
    async get () {
      await new Promise((resolve) => setTimeout(resolve, 50))
      return ok(b4a.from('slow'))
    },
    async put ({ key, value }) {
      await new Promise((resolve) => setTimeout(resolve, 10))
      return ok()
    }
  }

  const srv = srvPeer.listenRpc(id, { eagerOpen: true })
  const cli = cliPeer.connectRpc(id, { eagerOpen: true })

  t.teardown(() => {
    restoreEnv('PLEX_RPC_MAX_CLIENT_ROUTES', prevClientLimit)
    restoreEnv('PLEX_RPC_MAX_SERVER_ROUTES', prevServerLimit)
    try { srv.destroy() } catch {}
    try { cli.destroy() } catch {}
  })

  serveStorePortOverPlex({ duplex: srv, port })
  const remote = createStorePortProxyOverPlex({ duplex: cli })

  const firstPromise = remote.get({ key: b4a.from('hold') }).catch((err) => err)

  let secondErr
  try {
    await remote.get({ key: b4a.from('next') })
  } catch (err) {
    secondErr = err
  }

  t.ok(secondErr instanceof Error)
  t.is(secondErr?.code || secondErr?.message, CODES.NotReady)

  const firstResult = await Promise.race([
    firstPromise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout waiting for first route close')), 200))
  ])
  t.ok(firstResult instanceof Error)

  t.ok(cli.destroyed === true || cli.closed === true || cli.stream?.destroyed === true)
})

test('rpc: server route limit closes connection', async t => {
  t.plan(5)
  const prevServerLimit = process.env.PLEX_RPC_MAX_SERVER_ROUTES
  const prevClientLimit = process.env.PLEX_RPC_MAX_CLIENT_ROUTES
  setEnv('PLEX_RPC_MAX_SERVER_ROUTES', '1')
  setEnv('PLEX_RPC_MAX_CLIENT_ROUTES', '0')

  const [a, b] = duplexThrough()
  const id = b4a.from('ef', 'hex')

  const srvPeer = createPeer({ stream: a })
  const cliPeer = createPeer({ stream: b })

  const port = {
    async get () {
      await new Promise((resolve) => setTimeout(resolve, 50))
      return ok(b4a.from('slow'))
    },
    async put () {
      await new Promise((resolve) => setTimeout(resolve, 10))
      return ok()
    }
  }

  const srv = srvPeer.listenRpc(id, { eagerOpen: true })
  const cli = cliPeer.connectRpc(id, { eagerOpen: true })

  t.teardown(() => {
    restoreEnv('PLEX_RPC_MAX_SERVER_ROUTES', prevServerLimit)
    restoreEnv('PLEX_RPC_MAX_CLIENT_ROUTES', prevClientLimit)
    try { srv.destroy() } catch {}
    try { cli.destroy() } catch {}
  })

  serveStorePortOverPlex({ duplex: srv, port })
  const remote = createStorePortProxyOverPlex({ duplex: cli })

  const firstPromise = remote.get({ key: b4a.from('hold') }).catch((err) => err)

  const second = await remote.get({ key: b4a.from('second') })
  t.is(second.ok, false)
  t.is(second.code, CODES.NotReady)

  const firstResult = await Promise.race([
    firstPromise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout waiting for first route close')), 200))
  ])
  t.ok(firstResult instanceof Error)

  t.ok(cli.destroyed === true || cli.closed === true || cli.stream?.destroyed === true)

  t.pass('server closed connection after limit hit')
})

test('rpc: unary timeout produces Timeout envelope', async t => {
  t.plan(5)
  const [a, b] = duplexThrough()
  const id = b4a.from('dd', 'hex')

  const srvPeer = createPeer({ stream: a })
  const cliPeer = createPeer({ stream: b })

  let getInvoked = 0
  let getSettled = 0
  let lastKey
  const port = {
    async get ({ key }) {
      getInvoked++
      lastKey = key
      await new Promise((resolve) => setTimeout(resolve, 25))
      getSettled++
      return ok(b4a.from('late'))
    }
  }

  const srv = srvPeer.listenRpc(id, { eagerOpen: true })
  const cli = cliPeer.connectRpc(id, { eagerOpen: true })

  t.teardown(() => { try { srv.destroy() } catch {}; try { cli.destroy() } catch {} })

  serveStorePortOverPlex({ duplex: srv, port })
  const remote = createStorePortProxyOverPlex({ duplex: cli })

  const res = await remote.get({ key: b4a.from('slow'), timeoutMs: 5 })
  t.is(res.ok, false)
  t.is(res.code, CODES.Timeout)
  t.is(getInvoked, 1)

  await new Promise((resolve) => setTimeout(resolve, 40))
  t.is(getSettled, 1)
  t.is(b4a.toString(lastKey), 'slow')
})

test('rpc: abort signal cancels unary request with Destroyed envelope', async t => {
  t.plan(4)
  const [a, b] = duplexThrough()
  const id = b4a.from('ee', 'hex')

  const srvPeer = createPeer({ stream: a })
  const cliPeer = createPeer({ stream: b })

  let seenKey
  let seenValue
  const port = {
    async put ({ key, value }) {
      seenKey = key
      seenValue = value
      await new Promise((resolve) => setTimeout(resolve, 25))
      return ok()
    }
  }

  const srv = srvPeer.listenRpc(id, { eagerOpen: true })
  const cli = cliPeer.connectRpc(id, { eagerOpen: true })

  t.teardown(() => { try { srv.destroy() } catch {}; try { cli.destroy() } catch {} })

  serveStorePortOverPlex({ duplex: srv, port })
  const remote = createStorePortProxyOverPlex({ duplex: cli })

  const controller = new AbortController()
  setTimeout(() => controller.abort(new Error('stop')), 5)
  const res = await remote.put({ key: b4a.from('abort'), value: b4a.from('value'), signal: controller.signal })
  t.is(res.ok, false)
  t.is(res.code, CODES.Destroyed)
  t.is(b4a.toString(seenKey), 'abort')
  t.is(b4a.toString(seenValue), 'value')
})
