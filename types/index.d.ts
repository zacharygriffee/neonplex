import type Protomux from 'protomux'
import type { Duplex } from 'streamx'

export interface PlexBaseConfig {
  stream?: any
  mux?: Protomux
  id: Uint8Array
  protocol?: string
  encoding?: any
  handshakeEncoding?: any
  handshakeMessage?: any
  onError?: (error: unknown) => unknown
}

export interface PlexChannelHandlers {
  onmessage?: (message: any) => void
  onopen?: (handshake: any) => void
  onclose?: () => void
  ondestroy?: (error?: unknown) => void
}

export interface PlexDuplexHooks {
  onOpen?: (handshake: Uint8Array) => void
  onPair?: (cfg: PlexNormalizedConfig) => void
}

export interface PlexDuplexOptions {
  highWaterMark?: number
  map?: (data: any) => any
  byteLength?: (data: any) => number
  signal?: AbortSignal
  eagerOpen?: boolean
  mapWritable?: (data: any) => any
  byteLengthWritable?: (data: any) => number
  mapReadable?: (data: any) => any
  byteLengthReadable?: (data: any) => number
}

export type PlexDuplexConfig =
  & PlexBaseConfig
  & PlexChannelHandlers
  & PlexDuplexHooks
  & PlexDuplexOptions

export interface PlexNormalizedConfig extends PlexDuplexConfig {
  mux: Protomux
  plexChannel?: any
  plexSend?: (data: any) => boolean
}

export interface PlexDuplex extends Duplex {
  isConnected(): boolean
  readonly config: PlexNormalizedConfig
  getConfig(): PlexNormalizedConfig
  userData: Record<string, unknown>
}

export function listen(cfg?: Partial<PlexDuplexConfig>): PlexDuplex
export function connect(cfg?: Partial<PlexDuplexConfig>): PlexDuplex
export { listen as listenDuplex, connect as connectDuplex }

export function listenChannel(cfg?: Partial<PlexDuplexConfig>, onPair?: (cfg: PlexNormalizedConfig) => void): PlexNormalizedConfig
export function connectChannel(cfg?: Partial<PlexDuplexConfig>): PlexNormalizedConfig

export function createWebSocketStream(socket: any): Duplex

export type { PlexDuplexConfig as PlexConfig, PlexNormalizedConfig as NormalizedPlexConfig }

declare module '@neonloom/plex/channel' {
  import type { PlexDuplexConfig, PlexNormalizedConfig } from '@neonloom/plex'

  export function listenChannel(cfg?: Partial<PlexDuplexConfig>, onPair?: (cfg: PlexNormalizedConfig) => void): PlexNormalizedConfig
  export function connectChannel(cfg?: Partial<PlexDuplexConfig>): PlexNormalizedConfig
  export function ensurePlexChannel(cfg?: Partial<PlexDuplexConfig>): PlexNormalizedConfig
  export function openPlexChannel(cfg?: Partial<PlexDuplexConfig>): PlexNormalizedConfig
  export function pairPlexChannel(cfg?: Partial<PlexDuplexConfig>, onPair?: (cfg: PlexNormalizedConfig) => void): PlexNormalizedConfig
  export function unpairPlexChannel(cfg?: Partial<PlexDuplexConfig>): void
  export function getChannel(cfg?: Partial<PlexDuplexConfig>): any
  export function isChannelOpen(cfg?: Partial<PlexDuplexConfig>): boolean
}

declare module '@neonloom/plex/config' {
  import type { PlexNormalizedConfig } from '@neonloom/plex'
  import type Protomux from 'protomux'

  export const defaultProtocol: string
  export const zeroBuff: Uint8Array
  export const defaultCodec: any
  export const streamMuxSymbol: unique symbol

  export function getMuxFromStream(stream: unknown): Protomux | undefined
  export function fromStream<T extends Record<string, unknown>>(cfg?: T): T & { mux: any }
  export function normalizeCfg<T extends Record<string, unknown>>(cfg?: T): PlexNormalizedConfig & T
}

declare module '@neonloom/plex/duplex' {
  export { connect, listen, connectDuplex, listenDuplex } from '@neonloom/plex'
}

declare module '@neonloom/plex/ws' {
  import type { Duplex } from 'streamx'
  export function createWebSocketStream(socket: any): Duplex
}

declare module '@neonloom/plex/ws/index' {
  export { createWebSocketStream } from '@neonloom/plex/ws'
}

declare module '@neonloom/plex/ws/WebSocketStream' {
  import type { Duplex } from 'streamx'
  export class WebSocketStream extends Duplex {
    constructor(socket: any)
  }
  export function createWebSocketStream(socket: any): WebSocketStream
}

declare module '@neonloom/plex/ws/isWebSocket' {
  export function isWebSocket(value: unknown): boolean
}

declare module '@neonloom/plex/ws/symbol' {
  export const WEBSOCKET: unique symbol
}

declare module '@neonloom/plex/peer' {
  import type { PlexDuplex, PlexDuplexConfig } from '@neonloom/plex'

  export interface PeerTransport extends PlexDuplex {
    write(buf: Uint8Array, cb?: (err?: Error | null) => void): void
    destroy(err?: Error | null): void
  }

  export interface Peer {
    connectRpc(id: Uint8Array, opts?: Partial<PlexDuplexConfig>): PlexDuplex
    listenRpc(id: Uint8Array, opts?: Partial<PlexDuplexConfig>): PlexDuplex
    connectStream(id: Uint8Array, opts?: Partial<PlexDuplexConfig>): PlexDuplex
    listenStream(id: Uint8Array, opts?: Partial<PlexDuplexConfig>): PlexDuplex
    connectLane(id: Uint8Array, lane: string, opts?: Partial<PlexDuplexConfig>): PlexDuplex
    listenLane(id: Uint8Array, lane: string, opts?: Partial<PlexDuplexConfig>): PlexDuplex
    getTransport(): PeerTransport
    getConfig(): {
      protocolBase: string
      mux: any
      transport: PeerTransport
      websocket?: any
    }
  }

  export function createPeer(cfg: { stream: any; protocolBase?: string }): Peer
}

declare module '@neonloom/plex/pool' {
  import type { EventEmitter } from 'events'

  export interface PeerPoolStatsEntry {
    id: number
    weight: number
    meta?: Record<string, any>
    inFlight: number
    failures: number
    successes: number
    latencyMs: number
    cooldownUntil: number
  }

  export interface StorePortClient {
    get(opts: any): Promise<any>
    put(opts: any): Promise<any>
    del(opts: any): Promise<any>
    append(opts: any): Promise<any>
    scan(opts: any): AsyncIterable<any>
    waitReady(): Promise<void>
    close(): Promise<any>
    destroy(): Promise<any>
  }

  export interface PeerPool {
    add(peer: any, opts?: { weight?: number; meta?: Record<string, any> }): { dispose(): void }
    remove(peer: any): void
    connectStorePort(opts: {
      id: Uint8Array
      lane?: string
      eagerOpen?: boolean
      policy?: 'round-robin' | 'weighted' | 'sticky'
      keyFn?: (input: any) => any
      prefer?: 'local' | 'lan'
    }): StorePortClient
    close(): void
    destroy(): void
    stats(): PeerPoolStatsEntry[]
    events: EventEmitter
  }

  export function createPeerPool(): PeerPool
}

declare module '@neonloom/plex/rpc' {
  export const METHOD: {
    GET: number
    PUT: number
    DEL: number
    SCAN: number
  }

  export interface StorePortServer {
    close(): void
  }

  export function serveStorePortOverPlex(args: {
    duplex: any
    port: {
      get?(opts: any): Promise<any>
      put?(opts: any): Promise<any>
      del?(opts: any): Promise<any>
      append?(opts: any): Promise<any>
      scan?(opts: any): AsyncIterable<any>
    }
  }): StorePortServer

  export function createStorePortProxyOverPlex(args: { duplex: any }): {
    get(opts: any): Promise<any>
    put(opts: any): Promise<any>
    del(opts: any): Promise<any>
    append(opts: any): Promise<any>
    scan(opts: any): AsyncIterable<any>
    close(): Promise<any>
    destroy(): Promise<any>
  }
}

declare module '@neonloom/plex/service' {
  import type { Peer } from '@neonloom/plex/peer'

  export function deriveId(namespace: string | Uint8Array, name: string | Uint8Array, version: string | number | Uint8Array): Uint8Array

  export function exposeStorePort(
    peer: Peer,
    cfg: { id: Uint8Array; lane?: string; eagerOpen?: boolean },
    port: {
      get?(opts: any): Promise<any>
      put?(opts: any): Promise<any>
      del?(opts: any): Promise<any>
      append?(opts: any): Promise<any>
      scan?(opts: any): AsyncIterable<any>
    }
  ): { dispose(): void }

  export function connectStorePort(peer: Peer, cfg: { id: Uint8Array; lane?: string; eagerOpen?: boolean }): any

  export function withStoreCaps<T extends Record<string, any>>(store: T, token: Uint8Array | string): T & {
    unwrap(): any
  }
}

declare module '@neonloom/plex/codec' {
  export type Codec<T = any> = {
    encode(value: T): Uint8Array
    decode(buf: Uint8Array): T
  }

  export function makeCodec<T = any>(name: string): Codec<T>
  export function getRawCodec<T = any>(codec?: Codec<T> | string): Codec<T>
}

declare module '@neonloom/plex/bytes' {
  export function isU8(value: unknown): value is Uint8Array
  export function toU8(value: any): Uint8Array
  export function equal(a: Uint8Array, b: Uint8Array): boolean
  export function startsWith(a: Uint8Array, prefix: Uint8Array): boolean
  export function toHex(u8: Uint8Array): string
  export function fromHex(hex: string): Uint8Array
  export const utf8: {
    encode(value: string): Uint8Array
    decode(value: Uint8Array): string
  }
  export function encodeU16LE(value: number): Uint8Array
  export function decodeU16LE(buf: Uint8Array, offset?: number): number
  export function encodeU32LE(value: number): Uint8Array
  export function decodeU32LE(buf: Uint8Array, offset?: number): number
  export function encodeBool(value: boolean): Uint8Array
  export function decodeBool(buf: Uint8Array, offset?: number): boolean
}

declare module '@neonloom/plex/result' {
  export interface ResultOk<T = any> {
    ok: true
    value: T
    meta?: Record<string, any>
  }

  export interface ResultErr {
    ok: false
    code: string
    message?: string
    meta?: Record<string, any>
  }

  export type Result<T = any> = ResultOk<T> | ResultErr

  export const CODES: Record<string, string>

  export function ok<T = any>(value?: T, meta?: Record<string, any>): ResultOk<T>
  export function err(code: string, message?: string, meta?: Record<string, any>): ResultErr
}

declare module '@neonloom/plex/log' {
  export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'

  export interface Logger {
    child(bindings: Record<string, any>): Logger
    trace(msg: any, obj?: any): void
    debug(msg: any, obj?: any): void
    info(msg: any, obj?: any): void
    warn(msg: any, obj?: any): void
    error(msg: any, obj?: any): void
    fatal?(msg: any, obj?: any): void
  }

  export function createLogger(opts?: { name?: string; level?: LogLevel; context?: Record<string, any> }): Logger
}

declare module '@neonloom/plex/env' {
  export function loadRootEnv(): void
}

declare module '@neonloom/plex/dev/pair' {
  import type { Duplex } from 'streamx'

  export function createDuplexPair(): [Duplex, Duplex]
}

declare module '@neonloom/plex/dev/broker' {
  export function listen(
    opts: { id: string | Uint8Array },
    accept: (ctx: { stream: any; ready(): void; close(): void }) => void
  ): { dispose(): void }

  export function connectNow(opts: { id: string | Uint8Array }): any

  export const broker: {
    listen: typeof listen
    connectNow: typeof connectNow
  }
}

declare module '@neonloom/plex/protocol/store' {
  export const getReqCodec: any
  export const delReqCodec: any
  export const putReqCodec: any
  export const appendReqCodec: any
  export const scanReqCodec: any
}

declare module '@neonloom/plex/codec/index' {
  export * from '@neonloom/plex/codec'
}

declare module '@neonloom/plex/bytes/index' {
  export * from '@neonloom/plex/bytes'
}

declare module '@neonloom/plex/result/index' {
  export * from '@neonloom/plex/result'
}

declare module '@neonloom/plex/log/index' {
  export * from '@neonloom/plex/log'
}

declare module '@neonloom/plex/env/index' {
  export * from '@neonloom/plex/env'
}
