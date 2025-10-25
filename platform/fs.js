const tryImport = async (specifier) => {
  try {
    return await import(specifier)
  } catch {
    return null
  }
}

const moduleCandidate =
  (await tryImport('node:fs')) ??
  (await tryImport('bare-fs'))

const fsModule = moduleCandidate ? (moduleCandidate.default ?? moduleCandidate) : null

const noop = () => {}
const notAvailable = () => {
  throw new Error('fs module is not available in this runtime')
}

const stub = {
  existsSync: () => false,
  readFileSync: notAvailable,
  mkdirSync: noop,
  createWriteStream: () => ({
    write: noop,
    end: noop,
    destroy: noop
  }),
  promises: {
    readFile: async () => notAvailable(),
    writeFile: async () => notAvailable()
  }
}

const fs = fsModule ?? stub
const isFsAvailable = !!fsModule

export { fs, isFsAvailable }
export default fs
