import test from 'brittle'
import c from 'compact-encoding'
import { makeCodec, getRawCodec } from '../index.js'

test('makeCodec: wraps CE bytes', (t) => {
  const bytes = makeCodec('uint8array')
  const buf = bytes.encode(new Uint8Array([1,2,3]))
  const out = bytes.decode(buf)
  t.is(out.length, 3)
})

test('makeCodec: custom object encoding', (t) => {
  const pair = makeCodec({
    preencode (st, m) { c.uint.preencode(st, m.a); c.uint.preencode(st, m.b) },
    encode (st, m) { c.uint.encode(st, m.a); c.uint.encode(st, m.b) },
    decode (st) { return { a: c.uint.decode(st), b: c.uint.decode(st) } }
  })
  const buf = pair.encode({ a: 7, b: 9 })
  const out = pair.decode(buf)
  t.is(out.a, 7)
  t.is(out.b, 9)
})

