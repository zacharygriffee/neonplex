# Platform Adapters

Thin wrappers that abstract platform differences so Plex core can stay portable:
- `fs.js` — exposes `fs` or Bare’s `bare-fs`, guarded by an availability flag.
- `path.js` — resolves to Node `path` or Bare `bare-path`.
- `events.js` — EventEmitter shim (`eventemitter3`-compatible) wired through the platform import map.

Use these modules instead of importing Node built-ins directly in shared code; it keeps Bare compatibility without sprinkling conditionals. Node continues to receive the native implementations via `package.json#imports`.
