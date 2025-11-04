#!/usr/bin/env bare
import fs from 'fs';
import path from 'path';
import process from 'process';

const ROOT = process.cwd();
const FILE_EXTS = new Set(['.js', '.mjs', '.ts', '.tsx']);
const IGNORED_DIRS = new Set([
  'node_modules',
  'test',
  'tests',
  '.git',
  'docs'
]);

/** @type {{ file: string, reason: string }[]} */
const violations = [];

scan(ROOT);

if (violations.length) {
  console.error('\nBare guard failed: remove node:* specifiers or add import-map entries for:\n');
  for (const { file, reason } of violations) {
    console.error(` - ${path.relative(ROOT, file)} (${reason})`);
  }
  process.exitCode = 1;
} else {
  console.log('Bare guard passed (no node:* specifiers found).');
}

function scan(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (IGNORED_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scan(full);
      continue;
    }
    const ext = path.extname(entry.name);
    if (!FILE_EXTS.has(ext)) continue;
    check(full);
  }
}

function check(file) {
  const src = fs.readFileSync(file, 'utf8');
  if (/['"]node:[a-z0-9@/_-]+['"]/i.test(src)) {
    violations.push({ file, reason: 'node:* specifier' });
  }
}
