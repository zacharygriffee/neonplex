const tryImport = async (specifier) => {
  try {
    return await import(specifier)
  } catch {
    return null
  }
}

const moduleCandidate =
  (await tryImport('bare-path')) ??
  (await tryImport('path'))

const normalizeSlashes = (input = '') => input.replace(/[/\\]+/g, '/')
const stripTrailing = (input = '') => {
  if (!input || input === '/') return input || '/'
  return input.replace(/\/+$/g, '')
}

const fallbackDirname = (input = '.') => {
  const normalized = stripTrailing(normalizeSlashes(input))
  if (!normalized || normalized === '.') return '.'
  if (normalized === '/') return '/'
  const idx = normalized.lastIndexOf('/')
  if (idx === -1) return '.'
  if (idx === 0) return '/'
  return normalized.slice(0, idx)
}

const fallbackParse = (input = '') => {
  const normalized = stripTrailing(normalizeSlashes(input))
  const root = normalized.startsWith('/') ? '/' : ''
  const dir = normalized ? fallbackDirname(normalized) : '.'
  const base = normalized && normalized !== '/' ? normalized.slice(normalized.lastIndexOf('/') + 1) : '/'
  const idx = base.lastIndexOf('.')
  const ext = idx > 0 ? base.slice(idx) : ''
  const name = idx > 0 ? base.slice(0, idx) : base
  return { root, dir, base, ext, name }
}

const stub = {
  join: (...segments) => normalizeSlashes(segments.filter(Boolean).join('/')),
  dirname: fallbackDirname,
  resolve: (...segments) => {
    const parts = segments.filter(Boolean).map((seg) => normalizeSlashes(seg))
    if (!parts.length) return '.'
    let resolved = parts.pop()
    while (parts.length) {
      const part = parts.pop()
      if (part.startsWith('/')) {
        resolved = stripTrailing(part + '/' + resolved)
      } else if (!resolved.startsWith('/')) {
        resolved = stripTrailing(part + '/' + resolved)
      } else {
        resolved = stripTrailing(resolved + '/' + part)
      }
    }
    return resolved.startsWith('//') ? '/' + resolved.slice(2) : resolved
  },
  normalize: (input = '') => normalizeSlashes(input).replace(/\/{2,}/g, '/'),
  parse: fallbackParse,
  basename: (input = '') => input.split(/[/\\]+/).pop() ?? ''
}

const pathModule = moduleCandidate ? (moduleCandidate.default ?? moduleCandidate) : null
const normalizedModule =
  pathModule && (typeof pathModule === 'object' || typeof pathModule === 'function')
    ? pathModule
    : null

const basePath = normalizedModule ? { ...normalizedModule } : {}

for (const [key, value] of Object.entries(stub)) {
  if (typeof value === 'function') {
    if (typeof basePath[key] !== 'function') basePath[key] = value
  } else if (basePath[key] === undefined) {
    basePath[key] = value
  }
}

const path = Object.keys(basePath).length ? basePath : { ...stub }
const isPathAvailable = !!normalizedModule

export { path, isPathAvailable }
export default path
