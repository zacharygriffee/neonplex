# Runtime Compatibility Audit

> Last updated: 2025-03-13  
> Scope: Node.js (LTS/current) and Bare runtime (experimental). Browser support is deferred.

## Summary

- **Core multiplexing (`duplex`, `channel`, `peer`, `service`, `bytes`, `codec`, `result`)** use plain ESM, `streamx`, `b4a`, and `protomux` — all runtime-agnostic provided that `Uint8Array`/streams exist.
- **Node-specific concerns** live in the optional layers (`log`, `env`, `pool`, `rpc`) because they reference `fs`, `path`, and `events` statically. Bare can satisfy these via import maps/aliases, but browsers need shims or stubs.
- **Dev tooling (`dev/*`, smoke scripts)** intentionally target Node for local debugging and can be excluded from production bundles.

## Module Matrix

| Module / Entry               | Node.js | Bare | Browser | Notes |
|------------------------------|:-------:|:----:|:-------:|-------|
| `index.js`, `duplex.js`      | ✅ | ✅ | 🚫 (planned) | Pure ESM + `streamx`; runtime-agnostic core. |
| `channel.js`, `config.js`    | ✅ | ✅ | 🚫 (planned) | Uses `process.env`; Bare can alias via `bare-process`. |
| `bytes/*`, `codec/*`, `result/*` | ✅ | ✅ | 🚫 (planned) | No platform assumptions; depends on `b4a`. |
| `peer.js`, `service.js`      | ✅ | ✅ | 🚫 (planned) | Works with any transport fulfilling `streamx` contracts. |
| `ws/*`                       | ✅ | ✅ | 🚫 (planned) | Requires DOM/WebSocket shim; revisit once browser target resumes. |
| `log/index.js`               | ✅ | ⚠️ | 🚫 (planned) | Uses platform adapter that prefers `fs`/`bare-fs`; falls back to console-only logs when file IO is missing. |
| `pool.js`                    | ✅ | ⚠️ | 🚫 (planned) | Platform adapters cover `fs`, `path`, `events`; tracing silently degrades when file IO/EventEmitter unavailable. |
| `rpc.js`                     | ✅ | ⚠️ | 🚫 (planned) | Same adapters as `pool`; frame/trace files skipped when file IO missing. |
| `env/index.js`               | ✅ | ⚠️ | 🚫 (planned) | `.env` loading now optional—fails quietly without `fs`. |
| `dev/*`, `smoke-*`           | ✅ | 🚫 | 🚫 | Node-only tooling; safe to skip outside Node. |

Legend: ✅ works out-of-the-box, ⚠️ needs shims/aliases, 🚫 not supported.

## Bare Runtime Notes

- Bare exposes Node-compatible APIs through shim packages (`fs` → `bare-node-fs`) when declared in the consumer’s `package.json`.  
  Our imports already use bare-friendly specifiers (`'fs'`, `'path'`, `'events'`), so Bare consumers can alias them to the corresponding `bare-*` packages without additional transforms.
- Environment variables (`process.env`) are available in Bare via `bare-process`. Continue to guard lookups (`process?.env?.FOO`) so bundlers can substitute.
- Dependencies to verify in Bare:
  - `protomux` and `streamx` have been reported to work across Node and Bare.
  - `framed-stream` relies on bare-compatible primitives (`streamx`, `b4a`).
  - `ws` is Node-only, but our WebSocket stream helper only pulls it in under smoke tests. Browser/Bare integrations should supply a compatible WebSocket implementation.

## Next Steps

1. **Monitor platform adapters** to ensure plain `'fs'`, `'path'`, and `'events'` specifiers stay optional via lazy imports or documented aliases.  
2. **Document consumer guidance** for Bare: sample `package.json` showing `imports` mapping / aliases to `bare-*` packages.  
3. **Automate smoke tests** for Bare via CI (run `bare` once adapters are in place).  
4. **Revisit browser support** after the initial Node/Bare release, including conditional exports and dedicated smoke tests.

Track these follow-ups in `todo.md` for prioritization.
