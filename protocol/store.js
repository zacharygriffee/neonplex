// @ts-check
import c from 'compact-encoding';
import b4a from 'b4a';
import { makeCodec } from '../codec/index.js';

const U8 = c.uint8array;
const B = c.bool;

function capsToBytes(caps) {
  if (caps == null) return null;
  if (caps instanceof Uint8Array) return caps.byteLength ? caps : null;
  if (typeof caps === 'string') {
    const bytes = b4a.from(caps, 'utf8');
    return bytes.byteLength ? bytes : null;
  }
  if (b4a.isBuffer?.(caps)) {
    const buf = /** @type {Uint8Array} */ (caps);
    return buf.byteLength ? buf : null;
  }
  const bytes = b4a.from(String(caps));
  return bytes.byteLength ? bytes : null;
}

function capsPreencode(st, caps) {
  const bytes = capsToBytes(caps);
  B.preencode(st, !!bytes);
  if (bytes) U8.preencode(st, bytes);
}

function capsEncode(st, caps) {
  const bytes = capsToBytes(caps);
  B.encode(st, !!bytes);
  if (bytes) U8.encode(st, bytes);
}

function capsDecode(st) {
  if (st.end <= st.start) return undefined;
  const hasCaps = B.decode(st);
  if (!hasCaps) return undefined;
  const bytes = U8.decode(st) || new Uint8Array(0);
  return bytes.byteLength ? bytes : undefined;
}

// key-only request
const keyReq = {
  preencode(st, m) {
    U8.preencode(st, m?.key || new Uint8Array(0));
    capsPreencode(st, m?.caps);
  },
  encode(st, m) {
    U8.encode(st, m?.key || new Uint8Array(0));
    capsEncode(st, m?.caps);
  },
  decode(st) {
    const key = U8.decode(st) || new Uint8Array(0);
    const caps = capsDecode(st);
    return caps ? { key, caps } : { key };
  }
};

// put request { key, value }
const putReq = {
  preencode(st, m) {
    U8.preencode(st, m?.key || new Uint8Array(0));
    U8.preencode(st, m?.value || new Uint8Array(0));
    capsPreencode(st, m?.caps);
  },
  encode(st, m) {
    U8.encode(st, m?.key || new Uint8Array(0));
    U8.encode(st, m?.value || new Uint8Array(0));
    capsEncode(st, m?.caps);
  },
  decode(st) {
    const key = U8.decode(st) || new Uint8Array(0);
    const value = U8.decode(st) || new Uint8Array(0);
    const caps = capsDecode(st);
    return caps ? { key, value, caps } : { key, value };
  }
};

// append request { value }
const appendReq = {
  preencode(st, m) {
    U8.preencode(st, m?.value || new Uint8Array(0));
    capsPreencode(st, m?.caps);
  },
  encode(st, m) {
    U8.encode(st, m?.value || new Uint8Array(0));
    capsEncode(st, m?.caps);
  },
  decode(st) {
    const value = U8.decode(st) || new Uint8Array(0);
    const caps = capsDecode(st);
    return caps ? { value, caps } : { value };
  }
};

// scan request { prefix?, reverse?, range? {gte?,gt?,lte?,lt?} }
const scanReq = {
  preencode(st, m) {
    const hasPrefix = !!m?.prefix && m.prefix.byteLength > 0;
    B.preencode(st, hasPrefix);
    if (hasPrefix) U8.preencode(st, m.prefix);
    B.preencode(st, !!m?.reverse);
    const r = m?.range || {};
    const gp = !!r.gte; const gt = !!r.gt; const lp = !!r.lte; const lt = !!r.lt;
    B.preencode(st, gp); if (gp) U8.preencode(st, r.gte);
    B.preencode(st, gt); if (gt) U8.preencode(st, r.gt);
    B.preencode(st, lp); if (lp) U8.preencode(st, r.lte);
    B.preencode(st, lt); if (lt) U8.preencode(st, r.lt);
    capsPreencode(st, m?.caps);
  },
  encode(st, m) {
    const hasPrefix = !!m?.prefix && m.prefix.byteLength > 0;
    B.encode(st, hasPrefix);
    if (hasPrefix) U8.encode(st, m.prefix);
    B.encode(st, !!m?.reverse);
    const r = m?.range || {};
    const gp = !!r.gte; const gt = !!r.gt; const lp = !!r.lte; const lt = !!r.lt;
    B.encode(st, gp); if (gp) U8.encode(st, r.gte);
    B.encode(st, gt); if (gt) U8.encode(st, r.gt);
    B.encode(st, lp); if (lp) U8.encode(st, r.lte);
    B.encode(st, lt); if (lt) U8.encode(st, r.lt);
    capsEncode(st, m?.caps);
  },
  decode(st) {
    const out = {};
    const hasPrefix = B.decode(st);
    if (hasPrefix) out.prefix = U8.decode(st);
    out.reverse = B.decode(st);
    const gp = B.decode(st); const gt = B.decode(st); const lp = B.decode(st); const lt = B.decode(st);
    const range = {};
    if (gp) range.gte = U8.decode(st);
    if (gt) range.gt = U8.decode(st);
    if (lp) range.lte = U8.decode(st);
    if (lt) range.lt = U8.decode(st);
    if (Object.keys(range).length) out.range = range;
    const caps = capsDecode(st);
    if (caps) out.caps = caps;
    return out;
  }
};

export const getReqCodec = makeCodec(keyReq);
export const delReqCodec = makeCodec(keyReq);
export const putReqCodec = makeCodec(putReq);
export const appendReqCodec = makeCodec(appendReq);
export const scanReqCodec = makeCodec(scanReq);
