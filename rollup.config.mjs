import resolve from '@rollup/plugin-node-resolve'
import commonjs from '@rollup/plugin-commonjs'
import json from '@rollup/plugin-json'

const EXTERNALS = [
  'bare-fs',
  'bare-path',
  'bare-events',
  'events'
]

export default {
  input: 'browser/index.js',
  output: {
    file: 'dist/plex.browser.js',
    format: 'esm',
    sourcemap: true
  },
  plugins: [
    resolve({
      browser: true,
      preferBuiltins: false
    }),
    commonjs(),
    json()
  ],
  external: EXTERNALS,
  onwarn (warning, warn) {
    if (warning.code === 'CIRCULAR_DEPENDENCY') return
    warn(warning)
  }
}
