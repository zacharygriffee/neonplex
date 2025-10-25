import test from 'brittle';
import b4a from 'b4a';
import { getReqCodec, delReqCodec, putReqCodec, appendReqCodec, scanReqCodec } from '../store.js';

function eqKey(t, got, exp, label) { t.is(b4a.toString(got), b4a.toString(exp), label); }

test('store CE: get/del/put/append roundtrip', (t) => {
  const k = b4a.from('key');
  const v = b4a.from('val');
  let enc = getReqCodec.encode({ key: k }); let dec = getReqCodec.decode(enc); eqKey(t, dec.key, k, 'get.key'); t.is(dec.caps, undefined, 'get.caps absent');
  enc = delReqCodec.encode({ key: k }); dec = delReqCodec.decode(enc); eqKey(t, dec.key, k, 'del.key'); t.is(dec.caps, undefined, 'del.caps absent');
  enc = putReqCodec.encode({ key: k, value: v }); dec = putReqCodec.decode(enc); eqKey(t, dec.key, k, 'put.key'); t.is(b4a.toString(dec.value), b4a.toString(v), 'put.value'); t.is(dec.caps, undefined, 'put.caps absent');
  enc = appendReqCodec.encode({ value: v }); dec = appendReqCodec.decode(enc); t.is(b4a.toString(dec.value), b4a.toString(v), 'append.value'); t.is(dec.caps, undefined, 'append.caps absent');
});

test('store CE: scan roundtrip basic', (t) => {
  const p = b4a.from('prefix');
  const enc = scanReqCodec.encode({ prefix: p, reverse: true });
  const dec = scanReqCodec.decode(enc);
  eqKey(t, dec.prefix, p, 'scan.prefix');
  t.is(dec.reverse, true);
  t.is(dec.caps, undefined, 'scan.caps absent');
});

test('store CE: capability tokens roundtrip', (t) => {
  const k = b4a.from('cap-key');
  const v = b4a.from('cap-value');
  const token = 'caps-token';
  const tokenBytes = b4a.from(token);

  let enc = getReqCodec.encode({ key: k, caps: token });
  let dec = getReqCodec.decode(enc);
  eqKey(t, dec.key, k, 'get.cap.key');
  t.ok(b4a.equals(dec.caps, tokenBytes), 'get.cap token bytes');

  enc = putReqCodec.encode({ key: k, value: v, caps: tokenBytes });
  dec = putReqCodec.decode(enc);
  eqKey(t, dec.key, k, 'put.cap.key');
  t.ok(b4a.equals(dec.caps, tokenBytes), 'put.cap token bytes');

  enc = appendReqCodec.encode({ value: v, caps: token });
  dec = appendReqCodec.decode(enc);
  t.ok(b4a.equals(dec.caps, tokenBytes), 'append.cap token bytes');

  enc = scanReqCodec.encode({ prefix: k, caps: tokenBytes, reverse: true });
  dec = scanReqCodec.decode(enc);
  eqKey(t, dec.prefix, k, 'scan.cap.prefix');
  t.is(dec.reverse, true, 'scan.cap reverse');
  t.ok(b4a.equals(dec.caps, tokenBytes), 'scan.cap token bytes');

  enc = delReqCodec.encode({ key: k, caps: token });
  dec = delReqCodec.decode(enc);
  eqKey(t, dec.key, k, 'del.cap.key');
  t.ok(b4a.equals(dec.caps, tokenBytes), 'del.cap token bytes');
});
