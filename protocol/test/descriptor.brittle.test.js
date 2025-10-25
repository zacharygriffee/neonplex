// @ts-check
import test from 'brittle';
import b4a from 'b4a';
import * as d from '../descriptor.js';

const toU8 = (v) => (v instanceof Uint8Array ? v : new Uint8Array(v));

test('descriptor encode/decode roundtrip', (t) => {
  const desc = {
    version: 1,
    name: 'hyperbee-driver',
    kind: 'driver',
    namespace: 'neonloom/driver/hyperbee',
    // Note: using JSON codec for v1 control plane; binary fields omitted in this roundtrip test
    ports: [],
    labels: []
  };
  const enc = d.descriptorCodec.encode(desc);
  t.ok(enc && enc.byteLength > 0, 'encoded bytes non-empty');
  const dec = d.descriptorCodec.decode(enc);
  t.is(dec.version, desc.version);
  t.is(dec.name, desc.name);
  t.is(dec.kind, desc.kind);
  t.is(dec.namespace, desc.namespace);
  // Binary fields intentionally not asserted here (JSON codec drops typed arrays)
});
