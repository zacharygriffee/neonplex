// @ts-check
import { test } from 'brittle';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLogger, resolveLogLevelName } from '../index.js';

test('logger emits structured events', (t) => {
  t.plan(5);
  const events = [];
  const log = createLogger({
    name: 'log-test',
    level: 'debug',
    sink: (event) => { events.push(event); }
  });
  log.info('hello world', { foo: 41 });
  t.is(events.length, 1);
  const evt = events[0];
  t.is(evt.level, 'info');
  t.is(evt.logger, 'log-test');
  t.is(evt.msg, 'hello world');
  t.is(evt.foo, 41);
});

test('level filtering suppresses lower severity', (t) => {
  t.plan(2);
  const events = [];
  const log = createLogger({
    name: 'filter-test',
    level: 'warn',
    sink: (event) => events.push(event)
  });
  log.info('ignored');
  log.error('included');
  t.is(events.length, 1);
  t.is(events[0].level, 'error');
});

test('child logger merges context and keeps sink', (t) => {
  t.plan(4);
  const events = [];
  const parent = createLogger({
    name: 'parent',
    context: { service: 'core' },
    sink: (event) => events.push(event)
  });
  const child = parent.child({ component: 'child' });
  child.warn('warned');
  t.is(events.length, 1);
  const evt = events[0];
  t.is(evt.level, 'warn');
  t.is(evt.service, 'core');
  t.is(evt.component, 'child');
});

test('errors capture stack metadata', (t) => {
  t.plan(3);
  const events = [];
  const log = createLogger({ sink: (event) => events.push(event) });
  const err = new Error('boom');
  err.code = 'EFAIL';
  log.error('failed', err);
  t.is(events.length, 1);
  const evt = events[0];
  t.is(evt.err.code, 'EFAIL');
  t.ok(typeof evt.err.stack === 'string');
});

test('resolves numeric levels', (t) => {
  t.plan(2);
  t.is(resolveLogLevelName(10), 'trace');
  t.is(resolveLogLevelName(55), 'error');
});

test('file sink persists entries respecting level', async (t) => {
  t.plan(4);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neonloom-log-test-'));
  const filePath = path.join(tmpDir, 'log.jsonl');
  const loggerName = `file-test-${Math.random().toString(16).slice(2)}`;
  const events = [];
  const log = createLogger({
    name: loggerName,
    sink: (event) => {
      if (event.logger === loggerName) events.push(event);
    },
    persistPath: filePath,
    persistLevel: 'info'
  });
  log.debug('skip debug');
  log.info('persist info', { foo: 'bar' });
  log.error('persist error');
  await new Promise((resolve) => setTimeout(resolve, 25));
  const raw = fs.readFileSync(filePath, 'utf8').trim().split('\n');
  const parsed = raw.map((line) => JSON.parse(line)).filter((entry) => entry.logger === loggerName);
  try {
    t.ok(events.length >= 2);
    t.ok(parsed.length >= 2);
    const info = parsed.find((entry) => entry.msg === 'persist info');
    const error = parsed.find((entry) => entry.msg === 'persist error');
    t.ok(Boolean(info));
    t.ok(Boolean(error));
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
});

test('custom filter suppresses matching events', (t) => {
  t.plan(1);
  const events = [];
  const log = createLogger({
    sink: (event) => events.push(event),
    filter: (event) => event.level !== 'debug'
  });
  log.debug('filtered');
  log.info('included');
  t.is(events.length, 1);
});
