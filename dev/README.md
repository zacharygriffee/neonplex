# Dev Helpers

Smoke tests
- `npm run smoke:tcp` → `node dev/smoke/tcp.js` (length-prefixed TCP echo using framed-stream)
- `npm run smoke:ws`  → `node dev/smoke/ws.js` (WebSocket echo via WebSocketStream)

Notes
- These scripts are Node-only and meant for quick manual checks; the brittle suite covers automated coverage.
- If you add new smoke cases, keep them under `dev/smoke/` and wire a matching `npm run smoke:*` entry.
