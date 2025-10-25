# @neonloom/core/result

**Sharp-Edges & Boring Envelope helpers.** These small utilities construct and inspect the uniform envelopes used across drivers, features, and the network.

## Envelope v1 (uniform)

```js
// Success
{ v:1, ok:true, value?:Uint8Array, ver?:number|{feed:number,seq:number}, pos?:number, meta?:any }

// Failure (domain)
{ v:1, ok:false,
  code:'BadArg'|'CodecError'|'CASFailed'|'CapabilityDenied'|'Timeout'|'DriverError'|'CryptoError'|'NotAvailable'|'NotReady'|'Unknown',
  message:string,
  details?:any,
  cause?:{ name:string, stack?:string },
  meta?:any
}
```

## API

```js
import { ok, err, fromThrowable, isOk, isErr, badArg, CODES, V } from '@neonloom/core/result';
```

- `ok(value?, extra?)` → success envelope.
- `err(code, message, extra?)` → failure envelope.
- `fromThrowable(e, code='DriverError', meta?)` → failure envelope from an exception.
- `isOk(env)` / `isErr(env)` → boolean guards.
- `badArg(at, expected, received)` → convenience creator for strict validation.
- `CODES` (frozen) and `V = 1` (schema/version tag).

**Notes**
- Use these in drivers/features to avoid ad-hoc result shapes.
- Do **not** coerce inputs here; validation should return `badArg(...)` envelopes rather than guessing.

### Compact-encoding helpers

Re-exports:
`okV1`, `errV1`, `resultV1`, `encodeOk`, `encodeErr`, `encodeResult`, **`decodeResult`**.


### Compact-encoding helpers

Re-exports:
`okV1`, `errV1`, `resultV1`, `encodeOk`, `encodeErr`, `encodeResult`, **`decodeResult`**.


## Compact-encoding support

We provide `compact-encoding` codecs for v1 envelopes. They carry the same shape on decode, but are serialized as a compact discriminated union on wire.

```js
import c from 'compact-encoding'
import {
  ok, err, isOk, isErr,
  resultV1, okV1, errV1,
  encodeOk, encodeErr, encodeResult, decodeResult
} from '@neonloom/core/result'

const env = ok(new Uint8Array([1,2,3]), { ver: 1 })

// Encode/decode (union)
const buf  = c.encode(resultV1, env)
const back = c.decode(resultV1, buf)

// Convenience helpers
const bOk  = encodeOk(env)             // wraps c.encode(okV1, env)
const bRes = encodeResult(env)         // wraps c.encode(resultV1, env)
const out  = decodeResult(bRes)        // wraps c.decode(resultV1, buf)
```
