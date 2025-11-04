// @ts-check
import process from 'process';
import { fs, isFsAvailable } from '../platform/fs.js';
import { path } from '../platform/path.js';
import { loadRootEnv } from '../env/index.js';
loadRootEnv();

const LEVEL_NAMES = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
const LEVEL_VALUES = Object.freeze({
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60
});
const RESERVED_FIELDS = new Set(['ts', 'time', 'level', 'levelValue', 'logger', 'msg', 'message', 'err']);

const ENV_DEFAULT_LEVEL = resolveLogLevelName(process.env.NL_LOG_LEVEL, 'info');
const ENV_STDERR_LEVEL = resolveLogLevelName(process.env.NL_LOG_STDERR_LEVEL, 'warn');
const ENV_DEFAULT_FORMAT = (process.env.NL_LOG_FORMAT || 'json').toLowerCase();
const ENV_PERSIST_PATH = process.env.NL_LOG_PATH;
const ENV_PERSIST_LEVEL = resolveLogLevelName(process.env.NL_LOG_PATH_LEVEL, ENV_DEFAULT_LEVEL);
const ENV_FILTER_INCLUDE = process.env.NL_LOG_FILTER_INCLUDE || '';
const ENV_FILTER_EXCLUDE = process.env.NL_LOG_FILTER_EXCLUDE || '';

function toIsoTime (value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number') return new Date(value).toISOString();
  if (typeof value === 'string' && value) return value;
  return new Date().toISOString();
}

function serializeError (err) {
  if (!err) return null;
  const base = {
    name: err.name || 'Error',
    message: err.message || String(err)
  };
  if (err.code && typeof err.code !== 'object') base.code = err.code;
  if (err.stack && typeof err.stack === 'string') base.stack = err.stack;
  if (typeof err.status === 'number') base.status = err.status;
  if (err.data && typeof err.data === 'object') base.data = err.data;
  return base;
}

function extractFields (args) {
  let msg;
  const fields = {};
  let err;
  const extra = [];
  for (const arg of args) {
    if (arg == null) continue;
    if (arg instanceof Error) {
      err = serializeError(arg);
      continue;
    }
    const t = typeof arg;
    if (t === 'string') {
      if (!msg) msg = arg;
      else extra.push(arg);
      continue;
    }
    if (t === 'number' || t === 'boolean' || t === 'bigint') {
      extra.push(arg);
      continue;
    }
    if (t === 'object') {
      const { msg: objMsg, message: objMessage, ...rest } = arg;
      if (!msg && typeof objMsg === 'string') msg = objMsg;
      else if (!msg && typeof objMessage === 'string') msg = objMessage;
      for (const [key, value] of Object.entries(rest)) fields[key] = value;
      continue;
    }
  }
  if (!msg && extra.length) {
    msg = String(extra.shift());
  }
  if (extra.length) {
    fields.extra = extra.length === 1 ? extra[0] : extra;
  }
  return { msg, fields, err };
}

function recordFields (target, data) {
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    if (RESERVED_FIELDS.has(key)) continue;
    target[key] = value;
  }
}

function parseFilterTokens (input) {
  if (!input) return [];
  return String(input).split(',').map((token) => token.trim()).filter(Boolean).map((token) => {
    const idx = token.indexOf('=');
    if (idx === -1) return { key: token, value: undefined };
    const key = token.slice(0, idx).trim();
    const value = token.slice(idx + 1).trim();
    return { key, value };
  }).filter((entry) => entry.key);
}

function matchesFilter (event, { key, value }) {
  const ev = event?.[key];
  if (value === undefined) return ev !== undefined && ev !== null;
  if (ev === undefined || ev === null) return false;
  if (typeof ev === 'string' || typeof ev === 'number' || typeof ev === 'boolean') {
    return String(ev) === value;
  }
  return JSON.stringify(ev) === value;
}

const ENV_INCLUDE_FILTERS = parseFilterTokens(ENV_FILTER_INCLUDE);
const ENV_EXCLUDE_FILTERS = parseFilterTokens(ENV_FILTER_EXCLUDE);

function createEnvFilter () {
  if (!ENV_INCLUDE_FILTERS.length && !ENV_EXCLUDE_FILTERS.length) {
    return () => true;
  }
  return (event) => {
    if (ENV_INCLUDE_FILTERS.length && !ENV_INCLUDE_FILTERS.every((cond) => matchesFilter(event, cond))) {
      return false;
    }
    if (ENV_EXCLUDE_FILTERS.some((cond) => matchesFilter(event, cond))) {
      return false;
    }
    return true;
  };
}

export function resolveLogLevelName (level, fallback = 'info') {
  const fallbackName = typeof fallback === 'string' && LEVEL_VALUES[fallback] ? fallback : 'info';
  if (typeof level === 'string' && level.trim()) {
    const norm = level.trim().toLowerCase();
    if (LEVEL_VALUES[norm]) return norm;
    const num = Number(norm);
    if (Number.isFinite(num)) return resolveLogLevelName(num, fallbackName);
  }
  if (typeof level === 'number' && Number.isFinite(level)) {
    let candidate = null;
    for (const name of LEVEL_NAMES) {
      if (LEVEL_VALUES[name] <= level) candidate = name;
    }
    return candidate || fallbackName;
  }
  return fallbackName;
}

export function resolveLogLevelValue (level, fallback = LEVEL_VALUES.info) {
  const name = resolveLogLevelName(level, 'info');
  return LEVEL_VALUES[name] ?? fallback;
}

export function createJsonLineFormatter () {
  return (event) => JSON.stringify(event);
}

export function createHumanFormatter ({ upperCaseLevel = true } = {}) {
  return (event) => {
    const level = upperCaseLevel ? event.level.toUpperCase() : event.level;
    const head = `[${event.ts}] ${level} ${event.logger}`.trim();
    const parts = [];
    if (event.msg) parts.push(event.msg);
    const rest = {};
    for (const [key, value] of Object.entries(event)) {
      if (RESERVED_FIELDS.has(key)) continue;
      if (key === 'levelValue') continue;
      rest[key] = value;
    }
    if (Object.keys(rest).length) parts.push(JSON.stringify(rest));
    if (event.err) parts.push(JSON.stringify(event.err));
    return `${head} ${parts.join(' ')}`.trim();
  };
}

export function createConsoleSink ({ formatter = createJsonLineFormatter(), stderrLevel = 'warn' } = {}) {
  const thresholdName = resolveLogLevelName(stderrLevel, 'warn');
  const thresholdValue = LEVEL_VALUES[thresholdName];
  return (event, rendered) => {
    const line = typeof rendered === 'string' ? rendered : formatter(event);
    const method = event.levelValue >= thresholdValue ? 'error' : 'log';
    try { console[method](line); } catch {}
  };
}

export function createFileSink ({ path: filePath, level = 'info', formatter = createJsonLineFormatter() } = {}) {
  if (!filePath || !isFsAvailable) return null;
  const thresholdName = resolveLogLevelName(level, 'info');
  const thresholdValue = LEVEL_VALUES[thresholdName];
  let stream;

  function ensureStream () {
    if (stream) return stream;
    const dir = path.dirname(filePath);
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
    stream = fs.createWriteStream(filePath, { flags: 'a' });
    process.once('exit', () => {
      try { stream?.end(); } catch {}
    });
    return stream;
  }

  const sinkFn = (event, rendered) => {
    if (event.levelValue < thresholdValue) return;
    const writable = ensureStream();
    if (!writable) return;
    const line = typeof rendered === 'string' ? rendered : formatter(event);
    try { writable.write(`${line}\n`); } catch (err) {
      try { console.warn('[log] failed to persist log entry', err?.message || err); } catch {}
    }
  };
  sinkFn._isFileSink = true;
  return sinkFn;
}

function resolveFormatter (format) {
  if (typeof format === 'function') return format;
  if (typeof format === 'string') {
    const norm = format.toLowerCase();
    if (norm === 'human' || norm === 'pretty') return createHumanFormatter();
    if (norm === 'json' || norm === 'jsonl') return createJsonLineFormatter();
  }
  return createJsonLineFormatter();
}

export function createLogger (options = {}) {
  const {
    name = process.env.NL_LOGGER_NAME || 'neonloom',
    context = {},
    level = ENV_DEFAULT_LEVEL,
    stderrLevel = ENV_STDERR_LEVEL,
    format = ENV_DEFAULT_FORMAT,
    formatter,
    sink,
    sinks,
    persistPath = ENV_PERSIST_PATH,
    persistLevel = ENV_PERSIST_LEVEL,
    filter,
    timeSource
  } = options;

  const formatFn = typeof formatter === 'function' ? formatter : resolveFormatter(format);
  const sinkList = Array.isArray(sinks) ? [...sinks] : [];
  if (typeof sink === 'function') sinkList.push(sink);
    if (!sinkList.length) sinkList.push(createConsoleSink({ formatter: formatFn, stderrLevel }));
    if (persistPath && isFsAvailable && !sinkList.some((fn) => fn?._isFileSink)) {
      const fileSink = createFileSink({ path: persistPath, level: persistLevel });
      if (fileSink) sinkList.push(fileSink);
    }
  const baseContext = { ...context };
  const now = typeof timeSource === 'function' ? timeSource : () => new Date();

  let levelName = resolveLogLevelName(level, ENV_DEFAULT_LEVEL);
  let levelValue = LEVEL_VALUES[levelName];
  const filterFn = typeof filter === 'function' ? filter : createEnvFilter();

  function emit (lvl, args) {
    if (!isLevelEnabled(lvl)) return;
    const { msg, fields, err } = extractFields(args);
    const ts = toIsoTime(now());
    const event = { ts, level: lvl, levelValue: LEVEL_VALUES[lvl], logger: name };
    recordFields(event, baseContext);
    if (msg) event.msg = msg;
    recordFields(event, fields);
    if (err) event.err = err;
    if (!filterFn(event)) return;
    try {
      const rendered = formatFn(event);
      for (const s of sinkList) {
        try { s?.(event, rendered); } catch {}
      }
    } catch {}
  }

  function isLevelEnabled (lvl) {
    return LEVEL_VALUES[lvl] >= levelValue;
  }

  function setLevel (next) {
    levelName = resolveLogLevelName(next, levelName);
    levelValue = LEVEL_VALUES[levelName];
  }

  const logger = {
    get level () { return levelName; },
    setLevel,
    isLevelEnabled,
    log (lvl, ...args) {
      if (!LEVEL_VALUES[lvl]) return;
      emit(lvl, args);
    },
    child (childContext = {}, overrides = {}) {
      const hasPersistOverride = Object.prototype.hasOwnProperty.call(overrides, 'persistPath');
      const inheritedSinks = hasPersistOverride ? sinkList.filter((fn) => !fn?._isFileSink) : sinkList;
      return createLogger({
        name: overrides.name || name,
        context: { ...baseContext, ...childContext },
        level: overrides.level || levelName,
        stderrLevel: overrides.stderrLevel || stderrLevel,
        formatter: formatFn,
        sinks: inheritedSinks,
        persistPath: hasPersistOverride ? overrides.persistPath : persistPath,
        persistLevel: overrides.persistLevel || persistLevel,
        filter: overrides.filter || filterFn,
        timeSource: overrides.timeSource || now
      });
    }
  };

  for (const lvl of LEVEL_NAMES) {
    logger[lvl] = (...args) => emit(lvl, args);
  }

  return logger;
}

export const LOG_LEVELS = Object.freeze({ ...LEVEL_VALUES });
