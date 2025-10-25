// @ts-check
import c from 'compact-encoding';
import { makeCodec } from '../codec/index.js';

// Helper encoders
const U = c.uint;
const S = c.utf8;
const B = c.uint8array; // length-prefixed Uint8Array
const A = (enc) => c.array(enc);

// labels as a JSON object: { k: v, ... }
const labelsEncoding = {
  preencode (state, o) {
    const entries = Object.entries(o || {});
    U.preencode(state, entries.length);
    for (const [k, v] of entries) { S.preencode(state, k); S.preencode(state, v); }
  },
  encode (state, o) {
    const entries = Object.entries(o || {});
    U.encode(state, entries.length);
    for (const [k, v] of entries) { S.encode(state, k); S.encode(state, v); }
  },
  decode (state) {
    let len = U.decode(state);
    const out = {};
    while (len-- > 0) { const k = S.decode(state); const v = S.decode(state); out[k] = v; }
    return out;
  }
};

// Descriptor v1 (CE): bytes-first, optional fields encoded as empty values when absent
const descriptorEncoding = {
  preencode (state, d) {
    U.preencode(state, d?.version ?? 1);
    S.preencode(state, d?.name || '');
    S.preencode(state, d?.kind || '');
    S.preencode(state, d?.namespace || '');
    B.preencode(state, d?.publicKey || new Uint8Array(0));
    B.preencode(state, d?.discoveryKey || new Uint8Array(0));
    B.preencode(state, d?.devPubKey || new Uint8Array(0));
    B.preencode(state, d?.codeHash || new Uint8Array(0));
    S.preencode(state, d?.protoVersion || '');
    A(S).preencode(state, d?.ports || []);
    labelsEncoding.preencode(state, d?.labels || {});
  },
  encode (state, d) {
    U.encode(state, d?.version ?? 1);
    S.encode(state, d?.name || '');
    S.encode(state, d?.kind || '');
    S.encode(state, d?.namespace || '');
    B.encode(state, d?.publicKey || new Uint8Array(0));
    B.encode(state, d?.discoveryKey || new Uint8Array(0));
    B.encode(state, d?.devPubKey || new Uint8Array(0));
    B.encode(state, d?.codeHash || new Uint8Array(0));
    S.encode(state, d?.protoVersion || '');
    A(S).encode(state, d?.ports || []);
    labelsEncoding.encode(state, d?.labels || {});
  },
  decode (state) {
    const d = {};
    d.version = U.decode(state);
    d.name = S.decode(state);
    d.kind = S.decode(state);
    d.namespace = S.decode(state);
    d.publicKey = B.decode(state) || new Uint8Array(0);
    d.discoveryKey = B.decode(state) || new Uint8Array(0);
    d.devPubKey = B.decode(state) || new Uint8Array(0);
    d.codeHash = B.decode(state) || new Uint8Array(0);
    d.protoVersion = S.decode(state);
    d.ports = A(S).decode(state);
    d.labels = labelsEncoding.decode(state);
    return d;
  }
};

export const descriptorCodec = makeCodec(descriptorEncoding);

const challengeEncoding = {
  preencode (state, m) { B.preencode(state, m?.nonce || new Uint8Array(0)); S.preencode(state, m?.ctx || ''); },
  encode (state, m) { B.encode(state, m?.nonce || new Uint8Array(0)); S.encode(state, m?.ctx || ''); },
  decode (state) { return { nonce: B.decode(state) || new Uint8Array(0), ctx: S.decode(state) }; }
};
export const challengeCodec = makeCodec(challengeEncoding);

const signedDescriptorEncoding = {
  preencode (state, m) { descriptorEncoding.preencode(state, m?.descriptor || {}); B.preencode(state, m?.nonce || new Uint8Array(0)); B.preencode(state, m?.sig || new Uint8Array(0)); },
  encode (state, m) { descriptorEncoding.encode(state, m?.descriptor || {}); B.encode(state, m?.nonce || new Uint8Array(0)); B.encode(state, m?.sig || new Uint8Array(0)); },
  decode (state) { return { descriptor: descriptorEncoding.decode(state), nonce: B.decode(state) || new Uint8Array(0), sig: B.decode(state) || new Uint8Array(0) }; }
};
export const signedDescriptorCodec = makeCodec(signedDescriptorEncoding);
