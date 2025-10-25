# Plex Architecture Notes

## Channel Lifecycle

The core `listen` / `connect` duplexes wrap a single Protomux channel. Both
peers must attach handlers before data starts flowing so no payloads are lost.

```
client.connect()                server.listen()
      │                                 │
      │ -- Protomux open (handshake) -->│
      │<-- pending until onopen hook ---│
      │                                 │
      │<------ 'remote-open' event -----│
      │                                 │
      │==== application writes =========│
      │                                 │
duplex.destroy()             channel.destroy/close()
      │                                 │
      │---- destroy notification  ----->│
      │<--- channel-close/destroy ----- │
```

- `remote-open` is emitted on both sides once Protomux reports the open
  handshake. Buffering stops once this event fires.
- `plexSend` (internal) always uses framed transports so byte boundaries are
  preserved.
- `destroy()` is symmetric: each side closes its channel and unpairs to notify
  the remote peer.

## Peer & Pool

```
 createPeer(stream) ───► Protomux mux (shared)
        │
        ├─ connectRpc(id)  → Plex duplex ('rpc' lane)
        ├─ listenRpc(id)   → Plex duplex ('rpc' lane)
        ├─ connectStream   → Plex duplex ('events' lane)
        └─ listenStream    → Plex duplex ('events' lane)

 createPeerPool()
        │
        ├─ add(peer, meta) ─┐
        │                   ├─> weighted/sticky/rr policy
        └─ connectStorePort ┘
             │
             └─ createStorePortProxyOverPlex(duplex)
                   |
                   ├─ unary helpers (get/put/del/append)
                   └─ streaming helper (scan AsyncIterable)
```

- The pool tracks inflight calls, latency EWMA, and optional locality metadata
  to select peers.
- Each RPC lane retains its own `createStorePortProxyOverPlex` instance cached
  by `[id :: lane]`, so repeated calls reuse the same multiplexed channel.

## Smoke Transport Expectations

- TCP smoke tests wrap plain sockets in `framed-stream` to ensure length-prefix
  framing (`FramedStream` mirrors the production deployments).
- WebSocket smoke tests convert `ws` sockets into streamx duplexes via
  `createWebSocketStream` and add DOM-style event shims when running under Node.
- Both scripts enforce a 20s timeout for the handshake + echo round trip.
