#!/usr/bin/env node
// @ts-check
import assert from 'node:assert/strict'
import net from 'node:net'
import b4a from 'b4a'
import { listen, connect } from '../index.js'
import FramedStream from 'framed-stream'

const kId = b4a.from([0x9a, 0x01])
const kPayload = b4a.from('plex-smoke-tcp')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const startServer = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer((socket) => {
      const framed = new FramedStream(socket)
      const channel = listen({ stream: framed, id: kId })
      channel.on('data', (buf) => {
        channel.write(buf, (err) => {
          if (err) return channel.destroy(err)
          channel.end()
        })
      })
      channel.on('error', (err) => {
        console.error('[smoke:tcp] server channel error', err)
        channel.destroy(err)
      })
    })
    server.on('error', reject)
    server.listen(0, () => {
      const address = server.address()
      if (!address || typeof address !== 'object') reject(new Error('Server did not start'))
      else resolve({ server, port: address.port })
    })
  })

const withTimeout = (promise, ms, label) =>
  Promise.race([
    promise,
    sleep(ms).then(() => {
      throw new Error(`${label} timed out after ${ms}ms`)
    })
  ])

const main = async () => {
  const { server, port } = await startServer()
  console.log(`[smoke:tcp] listening on ${port}`)

  const socket = net.connect(port)
  const framed = new FramedStream(socket)
  const duplex = connect({ stream: framed, id: kId })

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
    'tcp smoke exchange'
  )

  assert.ok(b4a.equals(echoed, kPayload), 'echoed payload mismatch')
  console.log('[smoke:tcp] echo validated')

  duplex.destroy()
  framed.destroy()
  socket.destroy()

  await new Promise((resolve) => server.close(resolve))
  await sleep(20) // give sockets time to settle
  console.log('[smoke:tcp] success')
}

main().catch((err) => {
  console.error('[smoke:tcp] failed', err)
  process.exitCode = 1
})
