import { test } from 'brittle'
import duplexThrough from 'duplex-through'
import b4a from 'b4a'
import * as duplexExports from '../duplex.js'
import * as channelExports from '../channel.js'
import * as wsExports from '../ws/index.js'
import * as logExports from '../log/index.js'
import * as configExports from '../config.js'
import * as codecExports from '../codec/index.js'

console.log('bare import sanity', {
  duplexThrough: typeof duplexThrough,
  b4aAlloc: typeof b4a.alloc,
  duplexKeys: Object.keys(duplexExports),
  channelKeys: Object.keys(channelExports),
  wsKeys: Object.keys(wsExports),
  logKeys: Object.keys(logExports),
  configKeys: Object.keys(configExports),
  codecKeys: Object.keys(codecExports)
})

test('bare brittle sanity', t => {
  t.is('hello', 'hello')
})
