# Runtime Compatibility Audit

> Last updated: 2025-03-13  
> Scope: Node.js (LTS/current), Bare runtime, web browsers (ESM bundles).

## Summary

- **Core multiplexing (`duplex`, `channel`, `peer`, `service`, `bytes`, `codec`, `result`)** use plain ESM, `streamx`, `b4a`, and `protomux` — all runtime-agnostic provided that `Uint8Array`/streams exist.
- **Node-specific concerns** live in the optional layers (`log`, `env`, `pool`, `rpc`) because they reference `node:fs`, `node:path`, and `node:events` statically. Bare can satisfy these via import maps/aliases, but browsers need shims or stubs.
- **Dev tooling (`dev/*`, smoke scripts)** intentionally target Node for local debugging and can be excluded from production bundles.

## Module Matrix

| Module / Entry               | Node.js | Bare | Browser | Notes |
|------------------------------|:-------:|:----:|:-------:|-------|
| `index.js`, `duplex.js`      | ✅ | ✅ | ✅ | Pure ESM + `streamx`; no built-in imports. |
| `channel.js`, `config.js`    | ✅ | ✅ | ✅ | Uses `process.env`; provide shim in browsers. |
| `bytes/*`, `codec/*`, `result/*` | ✅ | ✅ | ✅ | No platform assumptions; depends on `b4a`. |
| `peer.js`, `service.js`      | ✅ | ✅ | ✅ | Works with any transport that fulfils `streamx` contracts. |
| `ws/*`                       | ✅ | ✅ | ⚠️ | Requires DOM-like WebSocket API; in Node we patch using `ws`. |
| `log/index.js`               | ✅ | ⚠️ | ⚠️ | Uses platform adapter that prefers `node:fs`/`bare-fs`; falls back to console-only logs when file IO is missing. Provide Bare aliases and browser stubs. |
| `pool.js`                    | ✅ | ⚠️ | ⚠️ | Platform adapters cover `fs`, `path`, `events`; tracing silently degrades when file IO/EventEmitter unavailable. |
| `rpc.js`                     | ✅ | ⚠️ | ⚠️ | Same adapters as `pool`; frame/trace files skipped when file IO missing. |
| `env/index.js`               | ✅ | ⚠️ | ⚠️ | `.env` loading now optional—fails quietly without `fs`. Bare/browser consumers can no-op the helper. |
| `dev/*`, `smoke-*`           | ✅ | 🚫 | 🚫 | Node-only tooling; safe to skip in Bare/browser bundles. |

Legend: ✅ works out-of-the-box, ⚠️ needs shims/aliases, 🚫 not supported.

## Bare Runtime Notes

- Bare exposes Node-compatible APIs through shim packages (`fs` → `bare-node-fs`) when declared in the consumer’s `package.json`.  
  Our current imports use the `node:` prefix, which Bare does **not** remap automatically. Converting to bare-friendly specifiers (`'fs'`, `'path'`, `'events'`) or offering a dedicated “bare” export will ease consumption.
- Environment variables (`process.env`) are available in Bare via `bare-process`. Continue to guard lookups (`process?.env?.FOO`) so bundlers can substitute.
- Dependencies to verify in Bare:
  - `protomux` and `streamx` have been reported to work across Node and Bare.
  - `framed-stream` relies on bare-compatible primitives (`streamx`, `b4a`).
  - `ws` is Node-only, but our WebSocket stream helper only pulls it in under smoke tests. Browser/Bare integrations should supply a compatible WebSocket implementation.

## Browser Considerations

- Static imports of `fs`/`path` break most bundlers unless stubbed. Options:
  1. Provide `"browser"` mappings in `package.json` to point to lightweight no-op modules (`log/browser.js`, `env/browser.js`).
  2. Export a tree-shakable surface where browser consumers avoid requiring Node-centric code paths entirely.
- `process.env` accesses can be replaced via bundler define plugins or by using `globalThis?.process`.

## Next Steps

1. **Refactor Node-prefixed imports** (`node:fs`, `node:path`, `node:events`) into platform adapters (lazy `try/catch` loads or optional dependencies).  
2. **Add import maps / conditional exports** for Bare & browser targets (e.g., `"exports": { "./log": { "default": "./log/index.js", "bare": "./log/bare.js", "browser": "./log/noop.js" } }`).  
3. **Automate smoke tests** for Bare via CI (run `bare test` once adapters are in place).  
4. **Document consumer guidance**: sample Bare `package.json` showing `imports` mapping, bundler hints for browsers.
5. **Create minimal browser demo** verifying `createWebSocketStream` + proxied transport once logging/env shims exist.

Track these follow-ups in `todo.md` for prioritization.
