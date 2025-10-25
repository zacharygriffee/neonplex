// @ts-check
// Minimal .env loader geared for monorepos.
// - Walks up from a starting directory to find the nearest `.env`.
// - Parses KEY=VALUE lines (no interpolation). Quoted values are unwrapped.
// - Does not override existing process.env keys by default.
import fs from 'node:fs';
import path from 'node:path';

/**
 * Locate a .env file by walking up parent directories.
 * @param {string} startDir
 * @param {string} [envFile='.env']
 */
function findEnvPaths(startDir, envFile = '.env') {
  let dir = startDir;
  const root = path.parse(dir).root;
  const paths = [];
  while (true) {
    const p = path.join(dir, envFile);
    if (fs.existsSync(p)) paths.push(p);
    if (dir === root) break;
    dir = path.dirname(dir);
  }
  return paths; // closest first
}

/** Unwrap simple single/double quoted strings */
function unquote(s) {
  if (!s) return s;
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
  return s;
}

/**
 * Load environment variables from a .env file into process.env.
 * - Does not override existing keys unless override=true.
 * - Returns the resolved env file path or null if not found.
 *
 * @param {{ from?: string, envFile?: string, override?: boolean }} [opts]
 */
export function loadRootEnv(opts = {}) {
  const from = opts.from || process.cwd();
  const files = findEnvPaths(from, opts.envFile || '.env');
  if (!files.length) return null;
  // Load root-most first so nearer files can override
  const chain = [...files].reverse();
  let used = null;
  for (let i = 0; i < chain.length; i++) {
    const p = chain[i];
    try {
      const txt = fs.readFileSync(p, 'utf8');
      const lines = txt.split(/\r?\n/);
      for (const raw of lines) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const idx = line.indexOf('=');
        if (idx <= 0) continue;
        const key = line.slice(0, idx).trim();
        const val = unquote(line.slice(idx + 1).trim());
        // Allow nearer files to override by default
        if (process.env[key] == null || i === chain.length - 1 || opts.override) process.env[key] = val;
      }
      used = p;
    } catch {}
  }
  return used;
}

export default { loadRootEnv };
