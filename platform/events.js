const tryImport = async (specifier) => {
  try {
    return await import(specifier)
  } catch {
    return null
  }
}

const moduleCandidate =
  (await tryImport('eventemitter3')) ??
  (await tryImport('node:events')) ??
  (await tryImport('events')) ??
  (await tryImport('bare-events'))

let EventEmitter
let isEventEmitterNative = false

if (moduleCandidate) {
  EventEmitter = moduleCandidate.EventEmitter ?? moduleCandidate.default ?? moduleCandidate
  isEventEmitterNative = true
  if (EventEmitter && EventEmitter.prototype && typeof EventEmitter.prototype.setMaxListeners !== 'function') {
    EventEmitter.prototype.setMaxListeners = function () { return this }
  }
  if (EventEmitter && EventEmitter.prototype && typeof EventEmitter.prototype.off !== 'function' && typeof EventEmitter.prototype.removeListener === 'function') {
    EventEmitter.prototype.off = EventEmitter.prototype.removeListener
  }
} else {
  class SimpleEmitter {
    constructor () {
      this._events = new Map()
      this._maxListeners = 0
    }

    setMaxListeners (n = 0) {
      this._maxListeners = n
      return this
    }

    on (event, listener) {
      const list = this._events.get(event) || []
      list.push(listener)
      this._events.set(event, list)
      return this
    }

    off (event, listener) {
      const list = this._events.get(event)
      if (!list) return this
      this._events.set(event, list.filter((fn) => fn !== listener))
      return this
    }

    once (event, listener) {
      const wrapped = (...args) => {
        this.off(event, wrapped)
        listener.apply(this, args)
      }
      return this.on(event, wrapped)
    }

    emit (event, ...args) {
      const list = this._events.get(event)
      if (!list || list.length === 0) return false
      for (const fn of [...list]) {
        try { fn.apply(this, args) } catch {}
      }
      return true
    }
  }

  EventEmitter = SimpleEmitter
}

export { EventEmitter, isEventEmitterNative }
export default EventEmitter
