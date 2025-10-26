#!/usr/bin/env node
// @ts-check
import assert from 'assert/strict'
import { WebSocketServer, WebSocket } from 'ws'
import b4a from 'b4a'
import { listen, connect, createWebSocketStream } from '../index.js'

const kId = b4a.from([0x9a, 0x02])
const kPayload = b4a.from('plex-smoke-ws')

const ensureDOMEvents = (socket) => {
  if (typeof socket.addEventListener !== 'function') {
    socket.addEventListener = (event, handler) => socket.on(event, handler)
    socket.removeEventListener = (event, handler) => socket.off(event, handler)
  }
  return socket
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const withTimeout = (promise, ms, label) =>
  Promise.race([
    promise,
    sleep(ms).then(() => {
      throw new Error(`${label} timed out after ${ms}ms`)
    })
  ])

const startServer = () =>
  new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ port: 0 })
    wss.on('error', reject)
    wss.on('connection', (rawSocket) => {
      const stream = createWebSocketStream(ensureDOMEvents(rawSocket))
      const channel = listen({ stream, id: kId })
      channel.on('data', (buf) => {
        channel.write(buf, (err) => {
          if (err) return channel.destroy(err)
          channel.end()
        })
      })
      channel.on('error', (err) => {
        console.error('[smoke:ws] server channel error', err)
        channel.destroy(err)
      })
    })
    wss.once('listening', () => {
      const address = wss.address()
      if (!address || typeof address !== 'object') reject(new Error('WebSocket server did not start'))
      else resolve({ wss, port: address.port })
    })
  })

const main = async () => {
  const { wss, port } = await startServer()
  console.log(`[smoke:ws] listening on ${port}`)

  const rawClient = new WebSocket(`ws://127.0.0.1:${port}`)
  const stream = createWebSocketStream(ensureDOMEvents(rawClient))
  const duplex = connect({ stream, id: kId })

  const echoed = await withTimeout(
    new Promise((resolve, reject) => {
      const cleanup = () => {
        duplex.removeListener('error', reject)
        duplex.removeListener('data', onData)
      }
      const onData = (buf) => {
        cleanup()
        resolve(buf)
      }
      duplex.once('error', (err) => {
        cleanup()
        reject(err)
      })
      duplex.once('remote-open', () => duplex.write(kPayload))
      duplex.on('data', onData)
    }),
    20_000,
    'ws smoke exchange'
  )

  assert.ok(b4a.equals(echoed, kPayload), 'echoed payload mismatch')
  console.log('[smoke:ws] echo validated')

  duplex.destroy()
  stream.destroy()

  await new Promise((resolve, reject) => {
    wss.close((err) => (err ? reject(err) : resolve()))
  })
  await sleep(20)
  console.log('[smoke:ws] success')
}

main().catch((err) => {
  console.error('[smoke:ws] failed', err)
  process.exitCode = 1
})
