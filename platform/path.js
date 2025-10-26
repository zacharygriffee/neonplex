const tryImport = async (specifier) => {
  try {
    return await import(specifier)
  } catch {
    return null
  }
}

const moduleCandidate =
  (await tryImport('path')) ??
  (await tryImport('bare-path'))

const fallbackDirname = (input = '.') => {
  if (!input) return '.'
  const parts = input.split(/[/\\]+/)
  parts.pop()
  return parts.length ? parts.join('/') : '.'
}

const fallbackParse = (input = '') => {
  const dir = fallbackDirname(input)
  const base = input.slice(dir.length + (dir === '.' ? 0 : 1))
  const idx = base.lastIndexOf('.')
  const ext = idx > 0 ? base.slice(idx) : ''
  const name = idx > 0 ? base.slice(0, idx) : base
  return { root: '', dir, base, ext, name }
}

const stub = {
  join: (...segments) => segments.filter(Boolean).join('/'),
  dirname: fallbackDirname,
  resolve: (...segments) => segments.filter(Boolean).join('/'),
  normalize: (input = '') => input.replace(/[/\\]+/g, '/'),
  parse: fallbackParse,
  basename: (input = '') => input.split(/[/\\]+/).pop() ?? ''
}

const pathModule = moduleCandidate ? (moduleCandidate.default ?? moduleCandidate) : null

const path = pathModule ?? stub
const isPathAvailable = !!pathModule

export { path, isPathAvailable }
export default path
