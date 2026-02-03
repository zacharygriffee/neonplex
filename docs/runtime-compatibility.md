# Runtime Compatibility Audit

> Last updated: 2025-03-13  
> Scope: Node.js (LTS/current) and Bare runtime (experimental). Browser support is deferred.

## Summary

- **Core multiplexing (`duplex`, `channel`, `peer`, `service`, `bytes`, `codec`, `result`)** use plain ESM, `streamx`, `b4a`, and `protomux` — all runtime-agnostic provided that `Uint8Array`/streams exist.
- **Node-specific concerns** live in the optional layers (`log`, `env`, `pool`, `rpc`) because they reference `fs`, `path`, and `events` statically. Bare can satisfy these via import maps/aliases, but browsers need shims or stubs.
- **Dev tooling (`dev/*`, smoke scripts)** intentionally target Node for local debugging and can be excluded from production bundles.
- **Dual runtime guard**: the root `package.json` now ships a Bare-friendly import map plus `npm run check:bare`, preventing `node:*` specifiers from landing on main.

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
| `dev/*`, `dev/smoke/*`       | ✅ | 🚫 | 🚫 | Node-only tooling; safe to skip outside Node. |

Legend: ✅ works out-of-the-box, ⚠️ needs shims/aliases, 🚫 not supported.

## Bare Runtime Notes

- Bare exposes Node-compatible APIs through shim packages (`fs` → `bare-node-fs`) when declared in the consumer’s `package.json`.  
  Our imports already use bare-friendly specifiers (`'fs'`, `'path'`, `'events'`), so Bare consumers can alias them to the corresponding `bare-*` packages without additional transforms.
- The repo now includes the import map directly in `package.json`, mapping `fs`, `fs/promises`, `path`, `process`, and `process/global` to their Bare counterparts. Node ignores these entries while Bare consumes them.
- `npm run check:bare` runs `scripts/enforce/check-bare-imports.mjs`, which scans for `node:*` specifiers before the brittle suite. CI should call this script (already part of `npm test`).
- Need another shim? See the Bare module matrix in `docs/bare-standards.md#bare-module-matrix` for the full list of Node → Bare mappings.
- Environment variables (`process.env`) are available in Bare via `bare-process`. Continue to guard lookups (`process?.env?.FOO`) so bundlers can substitute.
- Dependencies to verify in Bare:
  - `protomux` and `streamx` have been reported to work across Node and Bare.
  - `framed-stream` relies on bare-compatible primitives (`streamx`, `b4a`).
  - `ws` is Node-only, but our WebSocket stream helper only pulls it in under smoke tests. Browser/Bare integrations should supply a compatible WebSocket implementation.

## Next Steps

1. **Monitor platform adapters** to ensure `'fs'`, `'path'`, and `'events'` usage stays lazy so browser bundles can tree-shake them.
2. **Automate smoke tests** for Bare via CI (run a minimal `bare node dev/smoke/*.js` flow or similar harness).  
3. **Revisit browser support** after the initial Node/Bare release, including conditional exports and dedicated smoke tests.

Track these follow-ups in `todo.md` for prioritization.
