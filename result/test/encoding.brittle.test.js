import test from 'brittle'
import b4a from 'b4a'
import c from 'compact-encoding'
import { ok, err, CODES } from '../index.js'
import { okV1, errV1, resultV1, encodeOk, encodeErr, encodeResult, decodeResult } from '../encoding.js'

test('result CE: ok encode/decode roundtrip', (t) => {
  const env = ok(b4a.from('v'))
  const buf = c.encode(okV1, env)
  const dec = c.decode(okV1, buf)
  t.is(dec.ok, true)
  t.is(b4a.toString(dec.value || new Uint8Array(0)), 'v')
})

test('result CE: err encode/decode roundtrip', (t) => {
  const env = err(CODES.BadArg, 'nope', { details: { x: 1 }, cause: { name: 'E', stack: 's' }, meta: { k: 'v' } })
  const buf = c.encode(errV1, env)
  const dec = c.decode(errV1, buf)
  t.is(dec.ok, false)
  t.is(dec.code, CODES.BadArg)
  t.is(dec.message, 'nope')
  t.is(dec.details.x, 1)
  t.is(dec.cause.name, 'E')
})

test('result CE: discriminated union roundtrip', (t) => {
  const a = ok()
  const b = err(CODES.Unknown, 'uhoh')
  const ba = c.encode(resultV1, a)
  const bb = c.encode(resultV1, b)
  t.is(c.decode(resultV1, ba).ok, true)
  t.is(c.decode(resultV1, bb).ok, false)
})

