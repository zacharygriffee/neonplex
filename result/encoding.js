// @ts-check
/**
 * Compact-encoding codecs for Result envelopes (v1).
 * No Buffer usage; only compact-encoding primitives.
 *
 * On-wire layout (discriminated union):
 *   uint  : v              // schema version (1)
 *   bool  : ok
 *   if ok === true:
 *     bool : hasValue
 *     [value] : uint8array
 *     bool : hasVer
 *       if hasVer:
 *         bool : verIsObj
 *         if verIsObj: uint feed, uint seq
 *         else       : uint verNumber
 *     bool : hasPos
 *       if hasPos: uint pos
 *     bool : hasMeta
 *       if hasMeta: json meta
 *   else (ok === false):
 *     string : code
 *     string : message
 *     bool   : hasDetails
 *       if hasDetails: json details
 *     bool   : hasCause
 *       if hasCause:
 *         string : cause.name
 *         bool   : hasStack
 *           if hasStack: string cause.stack
 *     bool   : hasMeta
 *       if hasMeta: json meta
 */
import c from 'compact-encoding'
import b4a from "b4a";

// Duped constant to avoid circular import with index.js
const V = 1

/** @typedef {{ v:1, ok:true, value?:Uint8Array, ver?:number|{feed:number,seq:number}, pos?:number, meta?:any }} OkEnv */
/** @typedef {{ v:1, ok:false, code:string, message:string, details?:any, cause?:{name:string, stack?:string}, meta?:any }} ErrEnv */

/** Encoder for success envelopes (v1) */
export const okV1 = {
  preencode (st, env /** @type {OkEnv} */) {
    c.uint.preencode(st, V)
    c.bool.preencode(st, true)
    const hasValue = b4a.isBuffer(env.value)
    c.bool.preencode(st, hasValue)
    if (hasValue) c.binary.preencode(st, env.value)

    const hasVer = env.ver !== undefined && env.ver !== null
    c.bool.preencode(st, hasVer)
    if (hasVer) {
      const isObj = typeof env.ver === 'object'
      c.bool.preencode(st, isObj)
      if (isObj) {
        const ver = /** @type {{feed:number,seq:number}} */ (env.ver)
        c.uint.preencode(st, ver.feed >>> 0)
        c.uint.preencode(st, ver.seq >>> 0)
      } else {
        c.uint.preencode(st, /** @type {number} */ (env.ver) >>> 0)
      }
    }

    const hasPos = typeof env.pos === 'number'
    c.bool.preencode(st, hasPos)
    if (hasPos) c.uint.preencode(st, env.pos >>> 0)

    const hasMeta = env.meta !== undefined
    c.bool.preencode(st, hasMeta)
    if (hasMeta) c.json.preencode(st, env.meta)
  },
  encode (st, env /** @type {OkEnv} */) {
    c.uint.encode(st, V)
    c.bool.encode(st, true)

    const hasValue = b4a.isBuffer(env.value)
    c.bool.encode(st, hasValue)
    if (hasValue) c.binary.encode(st, env.value)

    const hasVer = env.ver !== undefined && env.ver !== null
    c.bool.encode(st, hasVer)
    if (hasVer) {
      const isObj = typeof env.ver === 'object'
      c.bool.encode(st, isObj)
      if (isObj) {
        const ver = /** @type {{feed:number,seq:number}} */ (env.ver)
        c.uint.encode(st, ver.feed >>> 0)
        c.uint.encode(st, ver.seq >>> 0)
      } else {
        c.uint.encode(st, /** @type {number} */ (env.ver) >>> 0)
      }
    }

    const hasPos = typeof env.pos === 'number'
    c.bool.encode(st, hasPos)
    if (hasPos) c.uint.encode(st, env.pos >>> 0)

    const hasMeta = env.meta !== undefined
    c.bool.encode(st, hasMeta)
    if (hasMeta) c.json.encode(st, env.meta)
  },
  decode (st) {
    const v = c.uint.decode(st)
    if (v !== V) throw new Error(`result.ok: unsupported version ${v}`)
    const ok = c.bool.decode(st)
    if (ok !== true) throw new Error('result.ok: expected ok=true')

    /** @type {OkEnv} */
    const out = { v: V, ok: true }

    const hasValue = c.bool.decode(st)
    if (hasValue) out.value = c.binary.decode(st)

    const hasVer = c.bool.decode(st)
    if (hasVer) {
      const isObj = c.bool.decode(st)
      if (isObj) {
        out.ver = { feed: c.uint.decode(st) >>> 0, seq: c.uint.decode(st) >>> 0 }
      } else {
        out.ver = c.uint.decode(st) >>> 0
      }
    }

    const hasPos = c.bool.decode(st)
    if (hasPos) out.pos = c.uint.decode(st) >>> 0

    const hasMeta = c.bool.decode(st)
    if (hasMeta) out.meta = c.json.decode(st)

    return out
  }
}

/** Encoder for failure envelopes (v1) */
export const errV1 = {
  preencode (st, env /** @type {ErrEnv} */) {
    c.uint.preencode(st, V)
    c.bool.preencode(st, false)
    c.string.preencode(st, String(env.code ?? 'Unknown'))
    c.string.preencode(st, String(env.message ?? ''))

    const hasDetails = env.details !== undefined
    c.bool.preencode(st, hasDetails)
    if (hasDetails) c.json.preencode(st, env.details)

    const hasCause = env.cause !== undefined && env.cause !== null
    c.bool.preencode(st, hasCause)
    if (hasCause) {
      const name = String(env.cause?.name ?? 'Error')
      c.string.preencode(st, name)
      const hasStack = typeof env.cause?.stack === 'string'
      c.bool.preencode(st, hasStack)
      if (hasStack) c.string.preencode(st, /** @type {string} */ (env.cause?.stack))
    }

    const hasMeta = env.meta !== undefined
    c.bool.preencode(st, hasMeta)
    if (hasMeta) c.json.preencode(st, env.meta)
  },
  encode (st, env /** @type {ErrEnv} */) {
    c.uint.encode(st, V)
    c.bool.encode(st, false)
    c.string.encode(st, String(env.code ?? 'Unknown'))
    c.string.encode(st, String(env.message ?? ''))

    const hasDetails = env.details !== undefined
    c.bool.encode(st, hasDetails)
    if (hasDetails) c.json.encode(st, env.details)

    const hasCause = env.cause !== undefined && env.cause !== null
    c.bool.encode(st, hasCause)
    if (hasCause) {
      const name = String(env.cause?.name ?? 'Error')
      c.string.encode(st, name)
      const hasStack = typeof env.cause?.stack === 'string'
      c.bool.encode(st, hasStack)
      if (hasStack) c.string.encode(st, /** @type {string} */ (env.cause?.stack))
    }

    const hasMeta = env.meta !== undefined
    c.bool.encode(st, hasMeta)
    if (hasMeta) c.json.encode(st, env.meta)
  },
  decode (st) {
    const v = c.uint.decode(st)
    if (v !== V) throw new Error(`result.err: unsupported version ${v}`)
    const ok = c.bool.decode(st)
    if (ok !== false) throw new Error('result.err: expected ok=false')

    /** @type {ErrEnv} */
    const out = { v: V, ok: false, code: c.string.decode(st), message: c.string.decode(st) }

    const hasDetails = c.bool.decode(st)
    if (hasDetails) out.details = c.json.decode(st)

    const hasCause = c.bool.decode(st)
    if (hasCause) {
      const name = c.string.decode(st)
      const hasStack = c.bool.decode(st)
      out.cause = hasStack ? { name, stack: c.string.decode(st) } : { name }
    }

    const hasMeta = c.bool.decode(st)
    if (hasMeta) out.meta = c.json.decode(st)

    return out
  }
}

/** Discriminated union (ok/err) */
export const resultV1 = {
  preencode (st, env /** @type {OkEnv|ErrEnv} */) {
    if (env && env.ok === true) okV1.preencode(st, /** @type {OkEnv} */ (env))
    else errV1.preencode(st, /** @type {ErrEnv} */ (env))
  },
  encode (st, env /** @type {OkEnv|ErrEnv} */) {
    if (env && env.ok === true) okV1.encode(st, /** @type {OkEnv} */ (env))
    else errV1.encode(st, /** @type {ErrEnv} */ (env))
  },
  decode (st) {
    // Peek by decoding then rewinding start.
    const start0 = st.start
    const v = c.uint.decode(st)
    const ok = c.bool.decode(st)
    st.start = start0
    return ok ? okV1.decode(st) : errV1.decode(st)
  }
}

export const encodeOk = (env) => c.encode(okV1, env)
export const encodeErr = (env) => c.encode(errV1, env)
export const encodeResult = (env) => c.encode(resultV1, env)
export const decodeResult = (buf) => c.decode(resultV1, buf)