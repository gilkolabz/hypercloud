"use strict";
process.env.NAVI_LOCALNAVI = process.env.NAVI_LOCALNAVI || process.env.NAVI_NATIVE || "1";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// node_modules/eventemitter3/index.js
var require_eventemitter3 = __commonJS({
  "node_modules/eventemitter3/index.js"(exports, module2) {
    "use strict";
    var has = Object.prototype.hasOwnProperty;
    var prefix = "~";
    function Events() {
    }
    if (Object.create) {
      Events.prototype = /* @__PURE__ */ Object.create(null);
      if (!new Events().__proto__)
        prefix = false;
    }
    function EE(fn, context, once) {
      this.fn = fn;
      this.context = context;
      this.once = once || false;
    }
    function addListener(emitter, event, fn, context, once) {
      if (typeof fn !== "function") {
        throw new TypeError("The listener must be a function");
      }
      var listener = new EE(fn, context || emitter, once), evt = prefix ? prefix + event : event;
      if (!emitter._events[evt])
        emitter._events[evt] = listener, emitter._eventsCount++;
      else if (!emitter._events[evt].fn)
        emitter._events[evt].push(listener);
      else
        emitter._events[evt] = [emitter._events[evt], listener];
      return emitter;
    }
    function clearEvent(emitter, evt) {
      if (--emitter._eventsCount === 0)
        emitter._events = new Events();
      else
        delete emitter._events[evt];
    }
    function EventEmitter2() {
      this._events = new Events();
      this._eventsCount = 0;
    }
    EventEmitter2.prototype.eventNames = function eventNames() {
      var names = [], events, name;
      if (this._eventsCount === 0)
        return names;
      for (name in events = this._events) {
        if (has.call(events, name))
          names.push(prefix ? name.slice(1) : name);
      }
      if (Object.getOwnPropertySymbols) {
        return names.concat(Object.getOwnPropertySymbols(events));
      }
      return names;
    };
    EventEmitter2.prototype.listeners = function listeners(event) {
      var evt = prefix ? prefix + event : event, handlers = this._events[evt];
      if (!handlers)
        return [];
      if (handlers.fn)
        return [handlers.fn];
      for (var i = 0, l = handlers.length, ee = new Array(l); i < l; i++) {
        ee[i] = handlers[i].fn;
      }
      return ee;
    };
    EventEmitter2.prototype.listenerCount = function listenerCount(event) {
      var evt = prefix ? prefix + event : event, listeners = this._events[evt];
      if (!listeners)
        return 0;
      if (listeners.fn)
        return 1;
      return listeners.length;
    };
    EventEmitter2.prototype.emit = function emit(event, a1, a2, a3, a4, a5) {
      var evt = prefix ? prefix + event : event;
      if (!this._events[evt])
        return false;
      var listeners = this._events[evt], len = arguments.length, args, i;
      if (listeners.fn) {
        if (listeners.once)
          this.removeListener(event, listeners.fn, void 0, true);
        switch (len) {
          case 1:
            return listeners.fn.call(listeners.context), true;
          case 2:
            return listeners.fn.call(listeners.context, a1), true;
          case 3:
            return listeners.fn.call(listeners.context, a1, a2), true;
          case 4:
            return listeners.fn.call(listeners.context, a1, a2, a3), true;
          case 5:
            return listeners.fn.call(listeners.context, a1, a2, a3, a4), true;
          case 6:
            return listeners.fn.call(listeners.context, a1, a2, a3, a4, a5), true;
        }
        for (i = 1, args = new Array(len - 1); i < len; i++) {
          args[i - 1] = arguments[i];
        }
        listeners.fn.apply(listeners.context, args);
      } else {
        var length = listeners.length, j;
        for (i = 0; i < length; i++) {
          if (listeners[i].once)
            this.removeListener(event, listeners[i].fn, void 0, true);
          switch (len) {
            case 1:
              listeners[i].fn.call(listeners[i].context);
              break;
            case 2:
              listeners[i].fn.call(listeners[i].context, a1);
              break;
            case 3:
              listeners[i].fn.call(listeners[i].context, a1, a2);
              break;
            case 4:
              listeners[i].fn.call(listeners[i].context, a1, a2, a3);
              break;
            default:
              if (!args)
                for (j = 1, args = new Array(len - 1); j < len; j++) {
                  args[j - 1] = arguments[j];
                }
              listeners[i].fn.apply(listeners[i].context, args);
          }
        }
      }
      return true;
    };
    EventEmitter2.prototype.on = function on(event, fn, context) {
      return addListener(this, event, fn, context, false);
    };
    EventEmitter2.prototype.once = function once(event, fn, context) {
      return addListener(this, event, fn, context, true);
    };
    EventEmitter2.prototype.removeListener = function removeListener(event, fn, context, once) {
      var evt = prefix ? prefix + event : event;
      if (!this._events[evt])
        return this;
      if (!fn) {
        clearEvent(this, evt);
        return this;
      }
      var listeners = this._events[evt];
      if (listeners.fn) {
        if (listeners.fn === fn && (!once || listeners.once) && (!context || listeners.context === context)) {
          clearEvent(this, evt);
        }
      } else {
        for (var i = 0, events = [], length = listeners.length; i < length; i++) {
          if (listeners[i].fn !== fn || once && !listeners[i].once || context && listeners[i].context !== context) {
            events.push(listeners[i]);
          }
        }
        if (events.length)
          this._events[evt] = events.length === 1 ? events[0] : events;
        else
          clearEvent(this, evt);
      }
      return this;
    };
    EventEmitter2.prototype.removeAllListeners = function removeAllListeners(event) {
      var evt;
      if (event) {
        evt = prefix ? prefix + event : event;
        if (this._events[evt])
          clearEvent(this, evt);
      } else {
        this._events = new Events();
        this._eventsCount = 0;
      }
      return this;
    };
    EventEmitter2.prototype.off = EventEmitter2.prototype.removeListener;
    EventEmitter2.prototype.addListener = EventEmitter2.prototype.on;
    EventEmitter2.prefixed = prefix;
    EventEmitter2.EventEmitter = EventEmitter2;
    if ("undefined" !== typeof module2) {
      module2.exports = EventEmitter2;
    }
  }
});

// src/index.ts
var src_exports = {};
__export(src_exports, {
  naviStamp: () => naviStamp,
  naviStampTime: () => naviStampTime,
  naviStampUuid: () => naviStampUuid
});
module.exports = __toCommonJS(src_exports);

// node_modules/eventemitter3/index.mjs
var import_index = __toESM(require_eventemitter3(), 1);
var eventemitter3_default = import_index.default;

// ../C_devops/navi_redux/seed/navi.frame.json
var navi_frame_default = {
  ib: "navi",
  gib: "<seed-gib>",
  data: {
    parts: [
      "navi_park",
      "ibgib_frame",
      "manifest",
      "json"
    ],
    park: "defer",
    default_method: "GET",
    method: {
      GET: {
        kind: "frame",
        mode: "sync"
      },
      PUT: {
        kind: "commit",
        mode: "async"
      },
      PATCH: {
        kind: "commit",
        mode: "async"
      },
      DELETE: {
        kind: "tombstone",
        mode: "async"
      }
    },
    about: {
      label: "navi",
      description: "space root \u2014 install uuid + unit rel8ns"
    },
    timestamp: "<navi.stamp.time()>",
    uuid: "<navi.stamp.uuid()>"
  },
  rel8ns: {
    past: [],
    tjp: [],
    dna: [],
    unit: []
  }
};

// ../C_devops/navi_redux/seed/navi_mod.frame.json
var navi_mod_frame_default = {
  ib: "navi:mod",
  gib: "<seed-gib>",
  data: {
    parts: [
      "navi_mod_index",
      "ibgib_frame",
      "manifest",
      "json"
    ],
    park: "capture",
    default_method: "GET",
    method: {
      GET: {
        kind: "frame",
        mode: "sync"
      },
      PUT: {
        kind: "commit",
        mode: "async"
      },
      PATCH: {
        kind: "commit",
        mode: "async"
      },
      DELETE: {
        kind: "tombstone",
        mode: "async"
      }
    },
    about: {
      description: "registration ledger \u2014 parks[] ib^gib after first mount"
    },
    parks: [],
    timestamp: "<navi.stamp.time()>"
  },
  rel8ns: {
    past: [],
    tjp: [],
    dna: []
  }
};

// ../C_devops/navi_redux/seed/navi_relay.frame.json
var navi_relay_frame_default = {
  ib: "relay",
  gib: "<seed-gib>",
  data: {
    parts: [
      "navi_relay",
      "navi_park",
      "ibgib_frame",
      "manifest",
      "json"
    ],
    park: "capture",
    method: {
      GET: {
        kind: "relay",
        mode: "sync",
        commands: [
          "connect",
          "host",
          "status",
          "token",
          "advertise",
          "retire",
          "help"
        ]
      },
      POST: {
        kind: "relay",
        mode: "async",
        commands: [
          "connect",
          "host",
          "status",
          "token",
          "advertise",
          "retire",
          "help"
        ]
      },
      PUT: {
        kind: "commit",
        mode: "async"
      },
      PATCH: {
        kind: "commit",
        mode: "async"
      },
      DELETE: {
        kind: "tombstone",
        mode: "async"
      }
    },
    about: {
      description: "host relay \u2014 mutable host with navi.origin fallback; connect opens websocket; HTTP park callins after advertise"
    },
    timestamp: "<navi.stamp.time()>"
  },
  rel8ns: {
    past: [],
    tjp: [],
    dna: []
  }
};

// ../C_devops/navi_redux/seed/navi_init_script.frame.json
var navi_init_script_frame_default = {
  ib: "navi:init_script",
  gib: "<seed-gib>",
  data: {
    parts: [
      "navi_init_script",
      "ibgib_frame",
      "manifest",
      "json"
    ],
    park: "capture",
    default_method: "GET",
    method: {
      GET: {
        kind: "frame",
        mode: "sync"
      },
      PUT: {
        kind: "commit",
        mode: "async"
      },
      PATCH: {
        kind: "commit",
        mode: "async"
      },
      DELETE: {
        kind: "tombstone",
        mode: "async"
      }
    },
    about: {
      description: "boot commands after ensureUnit (mount surf, remount, \u2026)"
    },
    script: [
      'navi.callout("[script] Welcome to navi_shell \u2014 manifest-space tip+bin. Surf via mount.")',
      'await navi.mount(await navi.storage.bin.mediaFromTip("surf"))',
      'if (window.self == window.top && !document.body.innerHTML.trim()) { await navi("surf horizon/enter") }',
      "await navi.remount()"
    ],
    script_notes: "Browser-only third line. remount() mounts navi:mod.parks[] (skip already-live, except surf, which is reloaded from its park). Surf tip is bare `surf`.",
    timestamp: "<navi.stamp.time()>"
  },
  rel8ns: {
    past: [],
    tjp: [],
    dna: []
  }
};

// ../C_devops/navi_redux/seed/navi_surf.frame.json
var navi_surf_frame_default = {
  ib: "surf",
  gib: "<seed-gib>",
  data: {
    parts: [
      "navi_park",
      "ibgib_frame",
      "manifest",
      "json"
    ],
    park: "capture",
    default_method: "GET",
    method: {
      GET: {
        kind: "mod",
        target: "surf",
        command: "surf",
        mode: "async",
        commands: [
          "surf",
          "surf_settings"
        ]
      },
      POST: {
        kind: "mod",
        target: "surf",
        command: "surf",
        mode: "async",
        commands: [
          "surf",
          "surf_settings"
        ]
      },
      PUT: {
        kind: "commit",
        mode: "async"
      },
      PATCH: {
        kind: "commit",
        mode: "async"
      },
      DELETE: {
        kind: "tombstone",
        mode: "async"
      }
    },
    about: {
      label: "surf",
      description: "surf mod park \u2014 fetch/swap routes; install|mount|browse"
    },
    module: {
      name: "surf",
      subject_seed: "bin <sha of surf module media \u2014 set on plant>"
    },
    settings: {
      savesurfs: false
    },
    timestamp: "<navi.stamp.time()>"
  },
  rel8ns: {
    bin: [],
    past: [],
    tjp: [],
    dna: []
  }
};

// ../C_devops/navi_redux/seed/navi_mount.frame.json
var navi_mount_frame_default = {
  ib: "mount",
  gib: "<seed-gib>",
  data: {
    parts: [
      "navi_park",
      "ibgib_frame",
      "manifest",
      "json"
    ],
    park: "capture",
    default_method: "GET",
    method: {
      GET: {
        kind: "mod",
        target: "surf",
        command: "mount",
        mode: "async"
      },
      POST: {
        kind: "mod",
        target: "surf",
        command: "mount",
        mode: "async"
      },
      PUT: {
        kind: "commit",
        mode: "async"
      },
      PATCH: {
        kind: "commit",
        mode: "async"
      },
      DELETE: {
        kind: "tombstone",
        mode: "async"
      }
    },
    about: {
      description: "surf.mount callin \u2014 install+mount module tip+bin"
    },
    timestamp: "<navi.stamp.time()>"
  },
  rel8ns: {
    past: [],
    tjp: [],
    dna: []
  }
};

// ../C_devops/navi_redux/seed/navi_browse.frame.json
var navi_browse_frame_default = {
  ib: "browse",
  gib: "<seed-gib>",
  data: {
    parts: [
      "navi_park",
      "ibgib_frame",
      "manifest",
      "json"
    ],
    park: "capture",
    default_method: "GET",
    method: {
      GET: {
        kind: "mod",
        target: "surf",
        command: "browse",
        mode: "async"
      },
      POST: {
        kind: "mod",
        target: "surf",
        command: "browse",
        mode: "async"
      },
      PUT: {
        kind: "commit",
        mode: "async"
      },
      PATCH: {
        kind: "commit",
        mode: "async"
      },
      DELETE: {
        kind: "tombstone",
        mode: "async"
      }
    },
    about: {
      description: "surf.browse callin \u2014 fetch route text without mount"
    },
    timestamp: "<navi.stamp.time()>"
  },
  rel8ns: {
    past: [],
    tjp: [],
    dna: []
  }
};

// ../C_devops/navi_redux/seed/navi_unmount.frame.json
var navi_unmount_frame_default = {
  ib: "unmount",
  gib: "<seed-gib>",
  data: {
    parts: [
      "navi_park",
      "ibgib_frame",
      "manifest",
      "json"
    ],
    park: "capture",
    default_method: "GET",
    method: {
      GET: {
        kind: "mod",
        target: "surf",
        command: "unmount",
        mode: "async"
      },
      POST: {
        kind: "mod",
        target: "surf",
        command: "unmount",
        mode: "async"
      },
      PUT: {
        kind: "commit",
        mode: "async"
      },
      PATCH: {
        kind: "commit",
        mode: "async"
      },
      DELETE: {
        kind: "tombstone",
        mode: "async"
      }
    },
    about: {
      description: "surf.unmount callin \u2014 drop live mod claim on this unit"
    },
    timestamp: "<navi.stamp.time()>"
  },
  rel8ns: {
    past: [],
    tjp: [],
    dna: []
  }
};

// ../C_devops/navi_redux/seed/navi_surfrefresh.frame.json
var navi_surfrefresh_frame_default = {
  ib: "surfrefresh",
  gib: "<seed-gib>",
  data: {
    parts: [
      "navi_park",
      "ibgib_frame",
      "manifest",
      "json"
    ],
    park: "capture",
    default_method: "GET",
    method: {
      GET: {
        kind: "mod",
        target: "surf",
        command: "surfrefresh",
        mode: "async"
      },
      POST: {
        kind: "mod",
        target: "surf",
        command: "surfrefresh",
        mode: "async"
      },
      PUT: {
        kind: "commit",
        mode: "async"
      },
      PATCH: {
        kind: "commit",
        mode: "async"
      },
      DELETE: {
        kind: "tombstone",
        mode: "async"
      }
    },
    about: {
      label: "surfrefresh",
      description: "surf.surfrefresh callin \u2014 reload origin /"
    },
    timestamp: "<navi.stamp.time()>"
  },
  rel8ns: {
    past: [],
    tjp: [],
    dna: []
  }
};

// ../C_devops/navi_redux/seed/navi_storage.frame.json
var navi_storage_frame_default = {
  ib: "storage",
  gib: "<seed-gib>",
  data: {
    parts: [
      "navi_park",
      "ibgib_frame",
      "manifest",
      "json"
    ],
    park: "capture",
    default_method: "GET",
    method: {
      GET: {
        kind: "surface",
        target: "storage",
        mode: "sync"
      },
      POST: {
        kind: "surface",
        target: "storage",
        mode: "async"
      },
      PUT: {
        kind: "commit",
        mode: "async"
      },
      PATCH: {
        kind: "commit",
        mode: "async"
      },
      DELETE: {
        kind: "tombstone",
        mode: "async"
      }
    },
    about: {
      description: "tip+bin space \u2014 tip/bin/item/file; POST kill <ib>; file savefs <relpath> (native)"
    },
    timestamp: "<navi.stamp.time()>"
  },
  rel8ns: {
    past: [],
    tjp: [],
    dna: []
  }
};

// ../C_devops/navi_redux/seed/navi_relay_log.frame.json
var navi_relay_log_frame_default = {
  ib: "relay:log",
  gib: "<seed-gib>",
  data: {
    parts: [
      "ibgib_frame",
      "manifest",
      "json"
    ],
    about: {
      label: "navi:relay:log",
      description: "relay event log \u2014 one data.event per mut8; read via tip.span / past lineage"
    },
    timestamp: "<navi.stamp.time()>"
  },
  rel8ns: {
    past: [],
    tjp: [],
    dna: []
  }
};

// ../C_devops/navi_redux/seed/navi_stamp.frame.json
var navi_stamp_frame_default = {
  ib: "stamp",
  gib: "<seed-gib>",
  data: {
    parts: [
      "navi_park",
      "ibgib_frame",
      "manifest",
      "json"
    ],
    park: "capture",
    default_method: "GET",
    method: {
      GET: {
        kind: "surface",
        target: "stamp",
        mode: "sync"
      },
      POST: {
        kind: "surface",
        target: "stamp",
        mode: "async"
      },
      PUT: {
        kind: "commit",
        mode: "async"
      },
      PATCH: {
        kind: "commit",
        mode: "async"
      },
      DELETE: {
        kind: "tombstone",
        mode: "async"
      }
    },
    about: {
      description: "navi.stamp \u2014 time / uuid identity markers"
    },
    timestamp: "<navi.stamp.time()>"
  },
  rel8ns: {
    past: [],
    tjp: [],
    dna: []
  }
};

// ../C_devops/navi_redux/seed/navi_origin.frame.json
var navi_origin_frame_default = {
  ib: "origin",
  gib: "<seed-gib>",
  data: {
    parts: [
      "navi_park",
      "ibgib_frame",
      "manifest",
      "json"
    ],
    park: "capture",
    default_method: "GET",
    method: {
      GET: {
        kind: "surface",
        target: "origin",
        mode: "sync"
      },
      POST: {
        kind: "surface",
        target: "origin",
        mode: "async"
      },
      PUT: {
        kind: "commit",
        mode: "async"
      },
      PATCH: {
        kind: "commit",
        mode: "async"
      },
      DELETE: {
        kind: "tombstone",
        mode: "async"
      }
    },
    about: {
      description: "fetch base URL for park/network (navi.origin)"
    },
    timestamp: "<navi.stamp.time()>"
  },
  rel8ns: {
    past: [],
    tjp: [],
    dna: []
  }
};

// ../C_devops/navi_redux/seed/navi_park.frame.json
var navi_park_frame_default = {
  ib: "park",
  gib: "<seed-gib>",
  data: {
    parts: [
      "navi_park",
      "ibgib_frame",
      "manifest",
      "json"
    ],
    park: "capture",
    default_method: "GET",
    method: {
      GET: {
        kind: "surface",
        target: "park",
        mode: "sync"
      },
      POST: {
        kind: "surface",
        target: "park",
        mode: "async"
      },
      PUT: {
        kind: "commit",
        mode: "async"
      },
      PATCH: {
        kind: "commit",
        mode: "async"
      },
      DELETE: {
        kind: "tombstone",
        mode: "async"
      }
    },
    about: {
      description: "park.check \u2014 local tip before network; ib/slash helpers"
    },
    timestamp: "<navi.stamp.time()>"
  },
  rel8ns: {
    past: [],
    tjp: [],
    dna: []
  }
};

// ../C_devops/navi_redux/seed/navi_pwa.frame.json
var navi_pwa_frame_default = {
  ib: "pwa",
  gib: "<seed-gib>",
  data: {
    parts: [
      "navi_park",
      "ibgib_frame",
      "manifest",
      "json"
    ],
    park: "capture",
    default_method: "GET",
    method: {
      GET: {
        kind: "surface",
        target: "pwa",
        mode: "sync"
      },
      POST: {
        kind: "surface",
        target: "pwa",
        mode: "async"
      },
      PUT: {
        kind: "commit",
        mode: "async"
      },
      PATCH: {
        kind: "commit",
        mode: "async"
      },
      DELETE: {
        kind: "tombstone",
        mode: "async"
      }
    },
    about: {
      description: "PWA meta surface \u2014 set/apply/clear/get manifest fields"
    },
    timestamp: "<navi.stamp.time()>"
  },
  rel8ns: {
    past: [],
    tjp: [],
    dna: []
  }
};

// ../C_devops/navi_redux/seed/navi_sw.frame.json
var navi_sw_frame_default = {
  ib: "sw",
  gib: "<seed-gib>",
  data: {
    parts: [
      "navi_park",
      "ibgib_frame",
      "manifest",
      "json"
    ],
    park: "capture",
    default_method: "GET",
    method: {
      GET: {
        kind: "surface",
        target: "sw",
        mode: "sync"
      },
      POST: {
        kind: "surface",
        target: "sw",
        mode: "async"
      },
      PUT: {
        kind: "commit",
        mode: "async"
      },
      PATCH: {
        kind: "commit",
        mode: "async"
      },
      DELETE: {
        kind: "tombstone",
        mode: "async"
      }
    },
    about: {
      description: "service-worker bridge \u2014 handlers + plugin register/message"
    },
    timestamp: "<navi.stamp.time()>"
  },
  rel8ns: {
    past: [],
    tjp: [],
    dna: []
  }
};

// ../C_devops/navi_redux/seed/navi_fetch.frame.json
var navi_fetch_frame_default = {
  ib: "fetch",
  gib: "<seed-gib>",
  data: {
    parts: [
      "navi_park",
      "ibgib_frame",
      "manifest",
      "json"
    ],
    park: "capture",
    default_method: "GET",
    method: {
      GET: {
        kind: "surface",
        target: "fetch",
        mode: "sync"
      },
      POST: {
        kind: "surface",
        target: "fetch",
        mode: "async"
      },
      PUT: {
        kind: "commit",
        mode: "async"
      },
      PATCH: {
        kind: "commit",
        mode: "async"
      },
      DELETE: {
        kind: "tombstone",
        mode: "async"
      }
    },
    about: {
      description: "navi.fetch \u2014 GET a path against origin"
    },
    timestamp: "<navi.stamp.time()>"
  },
  rel8ns: {
    past: [],
    tjp: [],
    dna: []
  }
};

// ../C_devops/navi_redux/seed/navi_unit_profile.frame.json
var navi_unit_profile_frame_default = {
  ib: "unit",
  gib: "<seed-gib>",
  data: {
    parts: [
      "navi_park",
      "ibgib_frame",
      "manifest",
      "json"
    ],
    park: "capture",
    default_method: "GET",
    method: {
      GET: {
        kind: "surface",
        target: "unit",
        mode: "sync"
      },
      POST: {
        kind: "surface",
        target: "unit",
        mode: "async"
      },
      PUT: {
        kind: "commit",
        mode: "async"
      },
      PATCH: {
        kind: "commit",
        mode: "async"
      },
      DELETE: {
        kind: "tombstone",
        mode: "async"
      }
    },
    about: {
      description: "unit bookkeeping \u2014 list, aliases, resolution, heartbeat"
    },
    units: {
      next: 1,
      list: [],
      aliases: {},
      resolution: {
        mode: "default_unit",
        default: null
      },
      heartbeat: {
        interval_sec: 180,
        stale_sec: 240,
        n_max: 20
      }
    },
    timestamp: "<navi.stamp.time()>"
  },
  rel8ns: {
    past: [],
    tjp: [],
    dna: []
  }
};

// ../C_devops/navi_redux/seed/navi_plug.frame.json
var navi_plug_frame_default = {
  ib: "plug",
  gib: "<seed-gib>",
  data: {
    parts: [
      "navi_park",
      "ibgib_frame",
      "manifest",
      "json"
    ],
    park: "capture",
    default_method: "GET",
    method: {
      GET: {
        kind: "surface",
        target: "plug",
        mode: "sync"
      },
      POST: {
        kind: "surface",
        target: "plug",
        mode: "async"
      },
      PUT: {
        kind: "commit",
        mode: "async"
      },
      PATCH: {
        kind: "commit",
        mode: "async"
      },
      DELETE: {
        kind: "tombstone",
        mode: "async"
      }
    },
    about: {
      description: "entry-plug surface \u2014 GET presence; POST ping|touch|ensure"
    },
    timestamp: "<navi.stamp.time()>"
  },
  rel8ns: {
    past: [],
    tjp: [],
    dna: []
  }
};

// ../C_devops/navi_redux/seed/navi_native.frame.json
var navi_native_frame_default = {
  ib: "native",
  gib: "<seed-gib>",
  data: {
    parts: [
      "navi_park",
      "ibgib_frame",
      "manifest",
      "json"
    ],
    park: "capture",
    method: {
      GET: {
        kind: "surface",
        target: "native",
        mode: "sync"
      },
      POST: {
        kind: "surface",
        target: "native",
        mode: "async"
      },
      PUT: {
        kind: "commit",
        mode: "async"
      },
      PATCH: {
        kind: "commit",
        mode: "async"
      },
      DELETE: {
        kind: "tombstone",
        mode: "async"
      }
    },
    about: {
      description: "runtime surface \u2014 native to navi itself (navi.native: node / exe / browser)"
    },
    timestamp: "<navi.stamp.time()>"
  },
  rel8ns: {
    past: [],
    tjp: [],
    dna: []
  }
};

// ../C_devops/navi_redux/seed/navi_reseed.frame.json
var navi_reseed_frame_default = {
  ib: "reseed",
  gib: "<seed-gib>",
  data: {
    parts: [
      "navi_park",
      "ibgib_frame",
      "manifest",
      "json"
    ],
    park: "capture",
    default_method: "GET",
    method: {
      GET: {
        kind: "surface",
        target: "reseed",
        mode: "sync"
      },
      POST: {
        kind: "surface",
        target: "reseed",
        mode: "async"
      },
      PUT: {
        kind: "commit",
        mode: "async"
      },
      PATCH: {
        kind: "commit",
        mode: "async"
      },
      DELETE: {
        kind: "tombstone",
        mode: "async"
      }
    },
    about: {
      description: "plant missing seed tips; force replaces present ones"
    },
    timestamp: "<navi.stamp.time()>"
  },
  rel8ns: {
    past: [],
    tjp: [],
    dna: []
  }
};

// ../C_devops/navi_redux/seed/navi_factoryreset.frame.json
var navi_factoryreset_frame_default = {
  ib: "factoryreset",
  gib: "<seed-gib>",
  data: {
    parts: [
      "navi_park",
      "ibgib_frame",
      "manifest",
      "json"
    ],
    park: "capture",
    default_method: "GET",
    method: {
      GET: {
        kind: "surface",
        target: "factoryreset",
        mode: "sync"
      },
      POST: {
        kind: "surface",
        target: "factoryreset",
        mode: "async"
      },
      PUT: {
        kind: "commit",
        mode: "async"
      },
      PATCH: {
        kind: "commit",
        mode: "async"
      },
      DELETE: {
        kind: "tombstone",
        mode: "async"
      }
    },
    about: {
      description: "wipe tips+bins, clear entry-plug, reseed + remint unit"
    },
    gate: {
      entry_plug: true
    },
    timestamp: "<navi.stamp.time()>"
  },
  rel8ns: {
    past: [],
    tjp: [],
    dna: []
  }
};

// ../C_devops/navi_redux/seed/navi_alias.frame.json
var navi_alias_frame_default = {
  ib: "alias",
  gib: "<seed-gib>",
  data: {
    parts: [
      "navi_park",
      "ibgib_frame",
      "manifest",
      "json"
    ],
    park: "capture",
    default_method: "GET",
    method: {
      GET: {
        kind: "surface",
        target: "alias",
        mode: "sync"
      },
      POST: {
        kind: "surface",
        target: "alias",
        mode: "async"
      },
      PUT: {
        kind: "commit",
        mode: "async"
      },
      PATCH: {
        kind: "commit",
        mode: "async"
      },
      DELETE: {
        kind: "tombstone",
        mode: "async"
      }
    },
    about: {
      description: "rename unit tip navi:unit:NN \u2192 navi:<name>"
    },
    timestamp: "<navi.stamp.time()>"
  },
  rel8ns: {
    past: [],
    tjp: [],
    dna: []
  }
};

// ../C_devops/navi_redux/seed/navi_prune.frame.json
var navi_prune_frame_default = {
  ib: "prune",
  gib: "<seed-gib>",
  data: {
    parts: [
      "navi_park",
      "ibgib_frame",
      "manifest",
      "json"
    ],
    park: "capture",
    default_method: "GET",
    method: {
      GET: {
        kind: "surface",
        target: "prune",
        mode: "sync"
      },
      POST: {
        kind: "surface",
        target: "prune",
        mode: "async"
      },
      PUT: {
        kind: "commit",
        mode: "async"
      },
      PATCH: {
        kind: "commit",
        mode: "async"
      },
      DELETE: {
        kind: "tombstone",
        mode: "async"
      }
    },
    about: {
      description: "erase offline (or all) unit tips from space + list"
    },
    gate: {
      entry_plug: true
    },
    timestamp: "<navi.stamp.time()>"
  },
  rel8ns: {
    past: [],
    tjp: [],
    dna: []
  }
};

// ../C_devops/navi_redux/seed/navi_resolve.frame.json
var navi_resolve_frame_default = {
  ib: "resolve",
  gib: "<seed-gib>",
  data: {
    parts: [
      "navi_park",
      "ibgib_frame",
      "manifest",
      "json"
    ],
    park: "capture",
    default_method: "GET",
    method: {
      GET: {
        kind: "surface",
        target: "resolve",
        mode: "sync"
      },
      POST: {
        kind: "surface",
        target: "resolve",
        mode: "async"
      },
      PUT: {
        kind: "commit",
        mode: "async"
      },
      PATCH: {
        kind: "commit",
        mode: "async"
      },
      DELETE: {
        kind: "tombstone",
        mode: "async"
      }
    },
    about: {
      description: "set or read default unit for bare park paths"
    },
    timestamp: "<navi.stamp.time()>"
  },
  rel8ns: {
    past: [],
    tjp: [],
    dna: []
  }
};

// ../C_devops/navi_redux/seed/navi_heartbeat.frame.json
var navi_heartbeat_frame_default = {
  ib: "heartbeat",
  gib: "<seed-gib>",
  data: {
    parts: [
      "navi_park",
      "ibgib_frame",
      "manifest",
      "json"
    ],
    park: "capture",
    default_method: "GET",
    method: {
      GET: {
        kind: "surface",
        target: "heartbeat",
        mode: "sync"
      },
      POST: {
        kind: "surface",
        target: "heartbeat",
        mode: "async"
      },
      PUT: {
        kind: "commit",
        mode: "async"
      },
      PATCH: {
        kind: "commit",
        mode: "async"
      },
      DELETE: {
        kind: "tombstone",
        mode: "async"
      }
    },
    about: {
      description: "unit pulse \u2014 interval_sec / stale_sec / n_max on navi:unit"
    },
    timestamp: "<navi.stamp.time()>"
  },
  rel8ns: {
    past: [],
    tjp: [],
    dna: []
  }
};

// ../C_devops/navi_redux/seed/navi_reindex.frame.json
var navi_reindex_frame_default = {
  ib: "reindex",
  gib: "<seed-gib>",
  data: {
    parts: [
      "navi_park",
      "ibgib_frame",
      "manifest",
      "json"
    ],
    park: "capture",
    default_method: "GET",
    method: {
      GET: {
        kind: "surface",
        target: "reindex",
        mode: "sync"
      },
      POST: {
        kind: "surface",
        target: "reindex",
        mode: "async"
      },
      PUT: {
        kind: "commit",
        mode: "async"
      },
      PATCH: {
        kind: "commit",
        mode: "async"
      },
      DELETE: {
        kind: "tombstone",
        mode: "async"
      }
    },
    about: {
      description: "rewrite this unit's mods{} from live navi.mod.*"
    },
    timestamp: "<navi.stamp.time()>"
  },
  rel8ns: {
    past: [],
    tjp: [],
    dna: []
  }
};

// ../C_devops/navi_redux/seed/navi_tokens.frame.json
var navi_tokens_frame_default = {
  ib: "tokens",
  gib: "<seed-gib>",
  data: {
    parts: [
      "navi_park",
      "ibgib_frame",
      "manifest",
      "json"
    ],
    park: "capture",
    default_host: "",
    hosts: {},
    method: {
      POST: {
        kind: "use",
        about: "spend one unused token under a host (or host+path) nest; omit from unused"
      },
      PUT: {
        kind: "append",
        about: "body = newline-separated tokens; append under a host (or host+path) nest"
      }
    },
    about: {
      description: "Local usage-token nests keyed by host origin: hosts[origin].unused, and per path hosts[origin].paths['/seg'].unused (a path never falls back to the host list). Use navi.tokens.{count,look,take,giveBack,add}(host?, \u2026, path?) \u2014 calls are serialized so two spenders never get the same token."
    },
    timestamp: "<navi.stamp.time()>"
  },
  rel8ns: {
    past: [],
    tjp: [],
    dna: []
  }
};

// src/navi_redux_seeds.ts
function normalizeTipIb(ib) {
  return String(ib || "").trim().replace(/^\/+/, "");
}
function canonicalizeTipIb(ib) {
  return normalizeTipIb(ib);
}
function isAbsoluteUrl(s) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(s);
}
function isAbsoluteHttpUrl(s) {
  return isAbsoluteUrl(s);
}
function pct20ToSpace(s) {
  return String(s || "").replace(/%20/gi, " ");
}
function tokenizeIb(ib) {
  const s = normalizeTipIb(pct20ToSpace(ib));
  const segments = [];
  const gaps = [];
  let buf = "";
  let i = 0;
  const pushSeg = () => {
    if (!buf)
      return;
    segments.push(buf);
    buf = "";
  };
  while (i < s.length) {
    if (s.startsWith("//", i)) {
      pushSeg();
      if (segments.length)
        gaps.push("//");
      i += 2;
      continue;
    }
    const c = s[i];
    if (c === ":" || c === "/" || /\s/.test(c)) {
      pushSeg();
      if (!segments.length) {
        i += 1;
        continue;
      }
      if (/\s/.test(c)) {
        while (i < s.length && /\s/.test(s[i]) && !s.startsWith("//", i)) {
          i += 1;
        }
        gaps.push(" ");
      } else {
        gaps.push(c);
        i += 1;
      }
      continue;
    }
    buf += c;
    i += 1;
  }
  pushSeg();
  while (gaps.length >= segments.length)
    gaps.pop();
  return { segments, gaps };
}
function joinIb(segments, gaps) {
  if (!segments.length)
    return "";
  let out = segments[0];
  const n = Math.min(gaps.length, segments.length - 1);
  for (let i = 0; i < n; i++) {
    out += gaps[i] + segments[i + 1];
  }
  for (let i = n + 1; i < segments.length; i++) {
    out += " " + segments[i];
  }
  return out;
}
function delimiterRaceSignature(ib) {
  const raw = normalizeTipIb(pct20ToSpace(ib));
  if (!raw)
    return "";
  if (isAbsoluteUrl(raw))
    return "abs:" + raw;
  const { segments, gaps } = tokenizeIb(raw);
  const marks = [];
  for (let i = 0; i < segments.length - 1; i++) {
    marks.push((gaps[i] || " ") === "//" ? "//" : "*");
  }
  return segments.join("\0") + "\n" + marks.join("\0");
}
function liveDelimiterHits(want, live) {
  const sig = delimiterRaceSignature(want);
  if (!sig)
    return [];
  const raw = normalizeTipIb(pct20ToSpace(want));
  const hits = live.filter((ib) => delimiterRaceSignature(ib) === sig);
  if (raw && hits.includes(raw)) {
    return [raw, ...hits.filter((h) => h !== raw)];
  }
  return hits;
}
function tipIbsMatch(a, b) {
  const sa = delimiterRaceSignature(a);
  return !!sa && sa === delimiterRaceSignature(b);
}
function slashJoinedIb(ib) {
  const raw = normalizeTipIb(ib);
  if (!raw || isAbsoluteUrl(raw))
    return raw;
  const { segments, gaps } = tokenizeIb(raw);
  if (segments.length <= 1)
    return raw;
  const next = gaps.slice();
  while (next.length < segments.length - 1)
    next.push("/");
  for (let i = 0; i < segments.length - 1; i++) {
    if (next[i] !== "//")
      next[i] = "/";
  }
  return joinIb(segments, next.slice(0, segments.length - 1));
}
function isTipGateTrue(data) {
  return !!(data && typeof data === "object" && data.gate === true);
}
function ibSegments(ib) {
  if (isAbsoluteUrl(ib))
    return [];
  return tokenizeIb(ib).segments;
}
function presumeNaviIb(key) {
  const k = normalizeTipIb(key);
  if (!k)
    return "navi";
  if (k === "navi" || /^navi[/:\s]/.test(k)) {
    return k;
  }
  return `navi:${k}`;
}
function storageItemTipIb(key) {
  return normalizeTipIb(key);
}
function storageFileTipIb(filePath) {
  return normalizeTipIb(filePath);
}
function relativeNaviKey(ib) {
  const c = normalizeTipIb(ib);
  if (c === "navi")
    return "";
  if (c.startsWith("navi:"))
    return c.slice("navi:".length);
  if (c.startsWith("navi/"))
    return c.slice("navi/".length);
  if (c.startsWith("navi "))
    return c.slice("navi ".length);
  return c;
}
var NAVI_REDUX_SEED_TIPS = [
  navi_frame_default,
  navi_mod_frame_default,
  navi_relay_frame_default,
  navi_init_script_frame_default,
  navi_surf_frame_default,
  navi_mount_frame_default,
  navi_browse_frame_default,
  navi_unmount_frame_default,
  navi_surfrefresh_frame_default,
  navi_storage_frame_default,
  navi_relay_log_frame_default,
  navi_stamp_frame_default,
  navi_origin_frame_default,
  navi_park_frame_default,
  navi_pwa_frame_default,
  navi_sw_frame_default,
  navi_fetch_frame_default,
  navi_unit_profile_frame_default,
  navi_plug_frame_default,
  navi_native_frame_default,
  navi_reseed_frame_default,
  navi_factoryreset_frame_default,
  navi_alias_frame_default,
  navi_prune_frame_default,
  navi_resolve_frame_default,
  navi_heartbeat_frame_default,
  navi_reindex_frame_default,
  navi_tokens_frame_default
];
var NAVI_ROOT_IB = "navi";
var NAVI_INIT_SCRIPT_IB = "navi:init_script";
var NAVI_MOD_INDEX_IB = "navi:mod";
var NAVI_SURF_IB = "surf";
var NAVI_RELAY_LOG_IB = "relay:log";
var NAVI_CALLIN_IB = "callin:log";
var NAVI_UNIT_SYSTEM_IB = "unit";
function unitParkIb(id) {
  const raw = String(id || "").trim();
  const n = /^\d+$/.test(raw) ? raw.padStart(2, "0") : raw;
  return `unit:${n}`;
}
function moduleParkIb(name) {
  const n = String(name || "").trim().replace(/^navi[/:]/, "").replace(/^mod[/:]/, "");
  if (!n || /[/:]/.test(n)) {
    throw new Error(
      `[navi] module park name must be a single segment (got '${name}')`
    );
  }
  return canonicalizeTipIb(n);
}
function parkMethodBlock(tip) {
  const block = tip?.data?.method;
  if (block && typeof block === "object" && !Array.isArray(block)) {
    return block;
  }
  const http = tip?.data?.http;
  if (!http || typeof http !== "object" || Array.isArray(http)) {
    return {};
  }
  const out = {};
  for (const [verb, ctrl] of Object.entries(http)) {
    if (!ctrl || typeof ctrl !== "object" || Array.isArray(ctrl))
      continue;
    const next = { ...ctrl };
    if (Array.isArray(next.actions) && !next.commands) {
      next.commands = next.actions.map(String);
      delete next.actions;
    }
    out[verb] = next;
  }
  return out;
}
var PARK_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE"
];
function normalizeParkMethod(raw, fallback = "POST") {
  const m = String(raw || fallback).trim().toUpperCase();
  if (PARK_METHODS.includes(m)) {
    return m;
  }
  return fallback;
}
function isStrictParkMethod(method) {
  const m = String(method || "").toUpperCase();
  return m === "PUT" || m === "PATCH" || m === "DELETE";
}
function parkMethodCtrl(tip, method) {
  const block = parkMethodBlock(tip);
  const m = String(method || "GET").toUpperCase();
  const exact = block[m];
  if (exact && typeof exact === "object")
    return exact;
  if (isStrictParkMethod(m))
    return void 0;
  const fb = block.GET || block.POST;
  return fb && typeof fb === "object" ? fb : void 0;
}
function selectParkBinRef(tip, ctrl, args = []) {
  const bins = Array.isArray(tip?.rel8ns?.bin) ? tip.rel8ns.bin.map(String) : [];
  if (!bins.length)
    return { error: "bin control requires rel8ns.bin" };
  const shaOf = (s) => String(s ?? "").replace(/^bin\s+/i, "").trim().toLowerCase();
  const pick = (v) => {
    if (v == null || v === "")
      return "";
    if (typeof v === "number" || /^\d+$/.test(String(v).trim())) {
      const ref = bins[Number(v)];
      return ref ? shaOf(ref) : "";
    }
    const want = shaOf(v);
    return bins.some((b) => shaOf(b) === want) ? want : "";
  };
  const key = String(args[0] ?? "");
  let chosen;
  if (ctrl?.select && typeof ctrl.select === "object") {
    if (key && Object.prototype.hasOwnProperty.call(ctrl.select, key)) {
      chosen = ctrl.select[key];
    } else if (ctrl.default != null) {
      chosen = ctrl.default;
    } else {
      return { error: key ? `no bin case '${key}'` : "bin case required" };
    }
  } else if (ctrl?.bin != null) {
    chosen = ctrl.bin;
  } else {
    return { sha: shaOf(bins[0]), selected: false };
  }
  const sha = pick(chosen);
  if (!sha)
    return { error: `bin selection '${chosen}' is not in rel8ns.bin` };
  return { sha, key, selected: true };
}
function defaultModuleCommand(name, allowed, prefer = "list") {
  if (!allowed.length)
    return "";
  const pick = String(prefer || "").trim();
  if (pick && allowed.includes(pick))
    return pick;
  if (allowed.includes(name))
    return name;
  return allowed[0];
}
function commandTransports(cmd) {
  const raw = cmd?.methods ?? cmd?.transport;
  if (raw == null)
    return null;
  const arr = Array.isArray(raw) ? raw : [raw];
  const out = arr.map((s) => String(s).toUpperCase()).filter((s) => s === "GET" || s === "POST");
  return out.length ? out : null;
}
function moduleCommandsForTransport(moduleObject, transport) {
  const commands = moduleObject?.commands;
  if (!commands || typeof commands !== "object")
    return [];
  const keys = Object.keys(commands);
  if (keys.length <= 1)
    return keys;
  const anyHint = keys.some((k) => commandTransports(commands[k]) != null);
  if (!anyHint)
    return keys;
  return keys.filter((k) => {
    const t = commandTransports(commands[k]);
    return t ? t.includes(transport) : false;
  });
}
function parkMethodCommands(tip, method) {
  if (method) {
    const ctrl = parkMethodCtrl(tip, method);
    return Array.isArray(ctrl?.commands) ? ctrl.commands.map(String) : [];
  }
  const block = parkMethodBlock(tip);
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const verb of ["GET", "POST"]) {
    const ctrl = block[verb];
    if (!ctrl || !Array.isArray(ctrl.commands))
      continue;
    for (const c of ctrl.commands.map(String)) {
      if (seen.has(c))
        continue;
      seen.add(c);
      out.push(c);
    }
  }
  return out;
}

// src/tip_span.ts
function normalizeTipSpanDir(raw) {
  const d = String(raw || "").trim().toLowerCase();
  if (d === "forward" || d === "all")
    return d;
  return "reverse";
}
async function walkTipLineage(ib, deps, max) {
  const want = canonicalizeTipIb(ib) || normalizeTipIb(ib);
  if (!want)
    return [];
  const cap = max != null && Number.isFinite(Number(max)) ? Math.max(0, Math.floor(Number(max))) : Infinity;
  if (cap === 0)
    return [];
  const head = await deps.getTip(want);
  if (!head)
    return [];
  const hits = [];
  const seen = /* @__PURE__ */ new Set();
  let frame = head;
  while (frame && hits.length < cap) {
    const tipIb = canonicalizeTipIb(frame.ib || want) || want;
    const gib = String(frame.gib || "").trim();
    if (!gib)
      break;
    const addr = `${tipIb}^${gib}`;
    if (seen.has(addr))
      break;
    seen.add(addr);
    hits.push({
      addr,
      ib: tipIb,
      gib,
      frame
    });
    if (hits.length >= cap)
      break;
    const past0 = Array.isArray(frame.rel8ns?.past) ? String(frame.rel8ns.past[0] || "").trim() : "";
    if (!past0)
      break;
    frame = await deps.getTipFrame(past0);
  }
  return hits;
}
function tipSpanWalkMax(opts = {}) {
  if (normalizeTipSpanDir(opts.dir) !== "reverse")
    return void 0;
  const limit = Number(opts.limit);
  if (opts.limit == null || !Number.isFinite(limit))
    return void 0;
  const offset = Math.max(0, Math.floor(Number(opts.offset) || 0));
  return offset + Math.max(0, Math.floor(limit));
}
function orderTipSpanHits(chain, opts = {}) {
  const dir = normalizeTipSpanDir(opts.dir);
  const offset = Math.max(0, Math.floor(Number(opts.offset) || 0));
  const ordered = dir === "reverse" ? chain : chain.slice().reverse();
  const limitRaw = opts.limit;
  if (limitRaw != null && Number.isFinite(Number(limitRaw))) {
    return ordered.slice(
      offset,
      offset + Math.max(0, Math.floor(Number(limitRaw)))
    );
  }
  return ordered.slice(offset);
}
async function tipSpan(ib, deps, opts = {}) {
  const chain = await walkTipLineage(ib, deps, tipSpanWalkMax(opts));
  const slice = orderTipSpanHits(chain, opts);
  if (opts.addrsOnly)
    return slice.map((h) => h.addr);
  return slice;
}
function opAction(entry) {
  const action = String(entry?.action || entry?.op || "").toLowerCase();
  if (action === "remove" || action === "del" || action === "delete") {
    return "remove";
  }
  return "add";
}
function parkKey(entry) {
  return String(entry?.name || "").trim() || String(entry?.["ib^gib"] || entry?.ib_gib || "").trim() || JSON.stringify(entry);
}
function extractHitDeltas(hit, depth, prev) {
  const data = hit.frame?.data || {};
  const out = [];
  const base = {
    addr: hit.addr,
    ib: hit.ib,
    depth
  };
  if (data.event && typeof data.event === "object") {
    const ev = data.event;
    out.push({
      ...base,
      kind: "event",
      key: String(ev.kind || depth),
      payload: ev
    });
    if (ev.kind === "ops-batch" && Array.isArray(ev.ops)) {
      const act = String(ev.action || "add").toLowerCase();
      for (const entry of ev.ops) {
        if (!entry || typeof entry !== "object")
          continue;
        out.push({
          ...base,
          kind: act === "remove" ? "op_remove" : "op_add",
          key: String(entry.id || entry.path || entry.target_ib || depth),
          path: entry.path ? String(entry.path) : void 0,
          payload: entry
        });
      }
    }
  }
  const pushOp = (entry) => {
    if (!entry || typeof entry !== "object")
      return;
    const act = opAction(entry);
    out.push({
      ...base,
      kind: act === "remove" ? "op_remove" : "op_add",
      key: String(entry.id || entry.path || entry.target_ib || depth),
      path: entry.path ? String(entry.path) : void 0,
      payload: entry
    });
  };
  if (data.op && typeof data.op === "object")
    pushOp(data.op);
  if (Array.isArray(data.ops)) {
    for (const entry of data.ops)
      pushOp(entry);
  }
  if (Array.isArray(data.op_deltas)) {
    for (const entry of data.op_deltas)
      pushOp(entry);
  }
  if (Array.isArray(data.op_remove)) {
    for (const entry of data.op_remove) {
      pushOp({ ...entry || {}, action: "remove" });
    }
  }
  const parks = Array.isArray(data.parks) ? data.parks : null;
  const prevParks = Array.isArray(prev?.data?.parks) ? prev.data.parks : null;
  if (parks && prevParks) {
    const prevMap = new Map(
      prevParks.map((p) => [parkKey(p), p])
    );
    const nextMap = new Map(parks.map((p) => [parkKey(p), p]));
    for (const [key, entry] of nextMap) {
      if (!prevMap.has(key)) {
        out.push({
          ...base,
          kind: "park_add",
          key,
          payload: entry
        });
      }
    }
    for (const [key, entry] of prevMap) {
      if (!nextMap.has(key)) {
        out.push({
          ...base,
          kind: "park_remove",
          key,
          payload: entry
        });
      }
    }
  } else if (parks && !prevParks && parks.length) {
    for (const entry of parks) {
      out.push({
        ...base,
        kind: "park_add",
        key: parkKey(entry),
        payload: entry
      });
    }
  }
  if (!out.length && data && Object.keys(data).length) {
    out.push({
      ...base,
      kind: "patch",
      key: String(depth),
      payload: data
    });
  }
  return out;
}
function foldTipSpanDeltas(deltas) {
  const folded = {
    events: [],
    ops: [],
    parks: {}
  };
  for (const d of deltas) {
    if (d.kind === "event" && d.payload) {
      folded.events.push(d.payload);
      continue;
    }
    if (d.kind === "op_add" || d.kind === "op") {
      const key = d.key || d.path || String(folded.ops.length);
      const idx = folded.ops.findIndex(
        (o) => String(o?.id || o?.path || "") === key
      );
      if (idx >= 0)
        folded.ops[idx] = d.payload;
      else
        folded.ops.push(d.payload);
      continue;
    }
    if (d.kind === "op_remove") {
      const key = d.key || d.path || "";
      folded.ops = folded.ops.filter(
        (o) => String(o?.id || o?.path || "") !== key
      );
      continue;
    }
    if (d.kind === "park_add" && d.key) {
      folded.parks[d.key] = d.payload;
      continue;
    }
    if (d.kind === "park_remove" && d.key) {
      delete folded.parks[d.key];
    }
  }
  return folded;
}
async function tipSpanDiff(ib, deps, opts = {}) {
  const spanOpts = {
    ...opts,
    dir: opts.dir === "reverse" ? "reverse" : opts.dir === "all" ? "all" : "forward"
  };
  const chain = await walkTipLineage(ib, deps, tipSpanWalkMax(spanOpts));
  const hits = orderTipSpanHits(chain, spanOpts);
  const chronological = opts.dir === "reverse" ? hits.slice().reverse() : hits;
  const depthOf = new Map(chain.map((h, i) => [h.addr, i]));
  const deltas = [];
  let prev = null;
  for (const hit of chronological) {
    deltas.push(...extractHitDeltas(hit, depthOf.get(hit.addr) ?? 0, prev));
    prev = hit.frame;
  }
  const result = {
    ib: canonicalizeTipIb(ib) || normalizeTipIb(ib),
    hits,
    deltas
  };
  if (opts.fold !== false) {
    result.folded = foldTipSpanDeltas(deltas);
  }
  return result;
}

// src/index.ts
var NAVI_ORIGIN = "https://foobarch.net";
var DEFAULT_RELAY_EXPIRES_SEC = 86400;
var RELAY_KEEPALIVE_MS = 45e3;
var RELAY_WELCOME_MS = 15e3;
var TOKEN_STASH_IB = "tokens";
var TOKEN_RESERVE_REL = "foobarch.token_reserve";
function noTokens(where) {
  const err = new Error(
    `no usage tokens for ${where} \u2014 relay tokens add <token\u2026> (or request some via hypertext/intro)`
  );
  err.code = "NO_TOKENS";
  throw err;
}
function relayWhitelistNorm(raw) {
  let s = String(raw ?? "").trim().split(/[?#]/)[0];
  try {
    s = decodeURIComponent(s);
  } catch {
  }
  return s.replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/^\/+|\/+$/g, "");
}
var RELAY_RECONNECT_BASE_MS = 2e3;
var RELAY_RECONNECT_MAX_MS = 6e4;
var ENTRY_PLUG_PROOF_NOTE = "Detached Ed25519 signature made with the in-memory entry-plug private key (non-extractable). Verify with publicKey; publicKey cannot produce this signature.";
function bytesToBase64Url(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++)
    bin += String.fromCharCode(bytes[i]);
  const b64 = typeof btoa === "function" ? btoa(bin) : Buffer.from(bytes).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function stableJson(value) {
  const walk = (v) => {
    if (v == null || typeof v !== "object")
      return v;
    if (Array.isArray(v))
      return v.map(walk);
    const out = {};
    for (const k of Object.keys(v).sort())
      out[k] = walk(v[k]);
    return out;
  };
  return JSON.stringify(walk(value));
}
function naviStampTime(when) {
  const date = when instanceof Date ? new Date(when.getTime()) : when === void 0 ? new Date() : new Date(when);
  if (Number.isNaN(date.getTime())) {
    throw new Error("[navi-error] navi.stamp.time requires a valid date");
  }
  const offsetMinutes = -date.getTimezoneOffset();
  const localIso = new Date(
    date.getTime() + offsetMinutes * 6e4
  ).toISOString().slice(0, -1);
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteOffset = Math.abs(offsetMinutes);
  const hours = String(Math.floor(absoluteOffset / 60)).padStart(2, "0");
  const minutes = String(absoluteOffset % 60).padStart(2, "0");
  return `${localIso}${sign}${hours}:${minutes}`;
}
function naviStampUuid() {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof cryptoApi?.getRandomValues === "function") {
    cryptoApi.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = bytes[6] & 15 | 64;
  bytes[8] = bytes[8] & 63 | 128;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join("")
  ].join("-");
}
function naviStamp(when) {
  return {
    timestamp: naviStampTime(when),
    uuid: naviStampUuid()
  };
}
naviStamp.time = naviStampTime;
naviStamp.uuid = naviStampUuid;
function isStampPlaceholder(value) {
  const s = String(value ?? "").trim();
  return /^<navi\.stamp\.\w+\(\)>$/.test(s);
}
function resolveStampedUuid(raw) {
  const s = String(raw ?? "").trim();
  return s && !isStampPlaceholder(s) ? s : "";
}
var FOOBARCH_PWA_DEFAULTS = {
  name: "Foobarch",
  short_name: "Foobarch",
  description: "Foobarch Network Client",
  start_url: "/",
  scope: "/",
  display: "standalone",
  background_color: "#ffffff",
  theme_color: "#ffffff",
  lang: "en",
  id: "/",
  icons: [
    {
      src: "/manifest.json/icon-192.png",
      sizes: "192x192",
      type: "image/png",
      purpose: "any"
    },
    {
      src: "/manifest.json/icon-512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "any"
    }
  ]
};
var PWA_MANAGED_ATTR = "data-navi-pwa-managed";
function normalizePwaAssetUrl(src) {
  const trimmed = String(src ?? "").trim();
  if (!trimmed) {
    return trimmed;
  }
  if (/^(https?:|data:|blob:)/i.test(trimmed)) {
    return trimmed;
  }
  if (typeof window !== "undefined" && window.location && window.location.origin && window.location.origin !== "null") {
    try {
      return new URL(trimmed, window.location.origin).href;
    } catch {
    }
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}
function buildWebManifest(config) {
  const manifest = {};
  const fields = [
    "name",
    "short_name",
    "description",
    "start_url",
    "scope",
    "display",
    "background_color",
    "theme_color",
    "lang",
    "orientation",
    "id"
  ];
  const urlFields = /* @__PURE__ */ new Set(["start_url", "scope", "id"]);
  for (const field of fields) {
    const value = config[field];
    if (value !== void 0 && value !== null && value !== "") {
      manifest[field] = urlFields.has(field) && typeof value === "string" ? normalizePwaAssetUrl(value) : value;
    }
  }
  if (Array.isArray(config.icons) && config.icons.length > 0) {
    manifest.icons = config.icons.map((icon) => ({
      ...icon,
      src: normalizePwaAssetUrl(icon.src)
    }));
  }
  return manifest;
}
function pickAppleTouchIcon(icons) {
  if (!icons || icons.length === 0) {
    return null;
  }
  const pngIcons = icons.filter((icon) => {
    const type = String(icon.type ?? "").toLowerCase();
    const src = String(icon.src ?? "").toLowerCase();
    return type.includes("png") || src.endsWith(".png");
  });
  const candidates = pngIcons.length > 0 ? pngIcons : icons;
  const ranked = [...candidates].sort((a, b) => {
    const largest = (sizes) => {
      const match = String(sizes ?? "").match(/(\d+)\s*x\s*(\d+)/i);
      return match ? Number(match[1]) : 0;
    };
    return largest(b.sizes) - largest(a.sizes);
  });
  return ranked[0] ?? null;
}
function isBrowserDocument() {
  return typeof window !== "undefined" && typeof document !== "undefined";
}
var NAVI_STANDALONE_MQ = "(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)";
var NAVI_DESKTOP_POINTER_MQ = "(hover: hover) and (pointer: fine)";
var NAVI_VIEWPORT_ORIG_ATTR = "data-navi-viewport-orig";
var naviMobileViewportBound = false;
function isStandalonePwa() {
  if (!isBrowserDocument()) {
    return false;
  }
  if (typeof window.matchMedia === "function") {
    if (window.matchMedia(NAVI_STANDALONE_MQ).matches) {
      return true;
    }
  }
  return window.navigator.standalone === true;
}
function isDesktopPointer() {
  if (!isBrowserDocument() || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(NAVI_DESKTOP_POINTER_MQ).matches;
}
function shouldFitPwaViewport() {
  return isStandalonePwa() && !isDesktopPointer();
}
function viewportMeta() {
  if (!isBrowserDocument() || !document.head) {
    return null;
  }
  return document.head.querySelector('meta[name="viewport"]');
}
function withoutCoverFit(content) {
  const raw = String(content || "").trim();
  if (!raw) {
    return "width=device-width, initial-scale=1, viewport-fit=auto";
  }
  if (/viewport-fit\s*=/i.test(raw)) {
    return raw.replace(/viewport-fit\s*=\s*cover/gi, "viewport-fit=auto");
  }
  return `${raw}, viewport-fit=auto`;
}
function applyNaviMobileViewport() {
  if (!isBrowserDocument() || !document.head) {
    return;
  }
  const sync = () => {
    let meta = viewportMeta();
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "viewport");
      document.head.appendChild(meta);
    }
    if (!meta.getAttribute(NAVI_VIEWPORT_ORIG_ATTR)) {
      meta.setAttribute(
        NAVI_VIEWPORT_ORIG_ATTR,
        meta.getAttribute("content") || ""
      );
    }
    const orig = meta.getAttribute(NAVI_VIEWPORT_ORIG_ATTR) || "";
    meta.setAttribute(
      "content",
      shouldFitPwaViewport() ? withoutCoverFit(orig) : orig
    );
  };
  if (!naviMobileViewportBound) {
    naviMobileViewportBound = true;
    for (const q of [NAVI_STANDALONE_MQ, NAVI_DESKTOP_POINTER_MQ]) {
      const mq = window.matchMedia(q);
      if (typeof mq.addEventListener === "function") {
        mq.addEventListener("change", sync);
      } else if (typeof mq.addListener === "function") {
        mq.addListener(sync);
      }
    }
  }
  sync();
}
function isNodeRuntime() {
  return typeof process !== "undefined" && !!process.versions?.node && (typeof window === "undefined" || typeof document === "undefined");
}
function isLocalnaviExe() {
  return isNodeRuntime() && (process.env.NAVI_LOCALNAVI === "1" || process.env.NAVI_NATIVE === "1");
}
var NAVI_SCRIPT_MIME = "application/navi-script";
var NAVI_SCRIPT_MAX_DEPTH = 8;
function naviScriptFromBin(media, mode) {
  const raw = String(media ?? "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const kept = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || t.startsWith("//"))
      continue;
    kept.push(mode === "callin" ? t : line.replace(/\s+$/, ""));
  }
  if (mode === "callin")
    return kept;
  const body = kept.join("\n").trim();
  return body ? [body] : [];
}
var SW_NAVI_CALL = "navi:call";
var SW_ALLOWED_CALLS = /* @__PURE__ */ new Set([
  "storage.file.load",
  "park.check",
  "callout"
]);
function formatCalloutMessage(data) {
  if (data === void 0 || data === null)
    return String(data);
  if (typeof data === "string")
    return data;
  if (data instanceof Error)
    return data.message || String(data);
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}
function toFileRecord(value) {
  if (!value || typeof value !== "object" || typeof value.media !== "string") {
    throw new Error("[navi-error] storage.file expects an object { media, mime }");
  }
  const mime = typeof value.mime === "string" && value.mime ? value.mime : "text/plain";
  return { media: value.media, mime };
}
function normalizeFileKey(filePath) {
  return String(filePath ?? "").trim().replace(/^\/+/, "");
}
var callinScope = (() => {
  if (typeof process === "undefined" || !process.versions?.node)
    return null;
  try {
    const { AsyncLocalStorage } = require("async_hooks");
    return new AsyncLocalStorage();
  } catch {
    return null;
  }
})();
var nodeFsPathOsPromise = null;
function getNodeFsPathOs() {
  if (!nodeFsPathOsPromise) {
    nodeFsPathOsPromise = (async () => {
      const fsMod = require("fs");
      const pathMod = require("path");
      const osMod = require("os");
      return {
        fs: fsMod.promises,
        join: pathMod.join,
        homedir: osMod.homedir,
        tmpdir: osMod.tmpdir
      };
    })();
  }
  return nodeFsPathOsPromise;
}
function naviDataDir(join, homedir) {
  return join(homedir(), ".navi_shell");
}
var localnaviJsonMapChains = /* @__PURE__ */ new Map();
function withLocalnaviJsonMapFile(path, fn) {
  const prev = localnaviJsonMapChains.get(path) || Promise.resolve();
  const run = prev.then(fn, fn);
  localnaviJsonMapChains.set(
    path,
    run.then(
      () => void 0,
      () => void 0
    )
  );
  return run;
}
async function readLocalnaviJsonMap(fs, path) {
  try {
    const raw = await fs.readFile(path, "utf8");
    if (!String(raw || "").trim())
      return {};
    const data = JSON.parse(raw);
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}
async function writeLocalnaviJsonMapAtomic(fs, path, data) {
  const body = JSON.stringify(data, null, 2);
  const stamp = `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  const tmp = `${path}.tmp.${stamp}`;
  const bak = `${path}.bak.${stamp}`;
  await fs.writeFile(tmp, body, "utf8");
  try {
    await fs.rename(tmp, path);
    return;
  } catch {
  }
  try {
    try {
      await fs.rename(path, bak);
    } catch {
    }
    await fs.rename(tmp, path);
    try {
      await fs.unlink(bak);
    } catch {
    }
  } catch (err) {
    try {
      await fs.access(path);
    } catch {
      try {
        await fs.rename(bak, path);
      } catch {
      }
    }
    try {
      await fs.unlink(tmp);
    } catch {
    }
    throw err;
  }
}
async function startLocalnaviRepl(shell) {
  await shell.runLocalnaviRepl();
}
async function main() {
  try {
    const shell = navi();
    shell.callout("[navi] Starting Navi Shell...");
    shell.on("error", (error) => {
      shell.callout("[navi] Shell error: " + (error?.message || error));
    });
    if (isLocalnaviExe()) {
      await shell.initialize();
      shell.callout("[navi] Shell ready!");
      await startLocalnaviRepl(shell);
      return;
    }
    shell.on("ready", () => {
      shell.callout("[navi] Shell ready!");
    });
  } catch (error) {
    console.error("[navi] Failed to start Shell:", error);
    if (isLocalnaviExe()) {
      process.exitCode = 1;
    }
  }
}
var _Navi = class extends eventemitter3_default {
  constructor() {
    super();
    this.idb = null;
    this.idbOpening = null;
    this.pwaBlobUrl = null;
    this.pwaConfig = null;
    this.pwaManifestRev = 0;
    this.hostManifestHref = null;
    this.swHandlers = /* @__PURE__ */ new Map();
    this.relayWs = null;
    this.relayHost = "";
    this.relayAlias = "";
    this.relayToken = "";
    this.relayConnecting = false;
    this.relayAutoReconnect = false;
    this.relayManualClose = false;
    this.relayEverConnected = false;
    this.relayReconnectAttempt = 0;
    this.relayPay = null;
    this.relayWelcomeTimer = null;
    this.tokenStashChain = Promise.resolve();
    this.relayReconnectTimer = null;
    this.relayKeepaliveTimer = null;
    this.relayPageLifecycleBound = false;
    this.relayPending = /* @__PURE__ */ new Map();
    this.callinSlot = null;
    this.installUuid = null;
    this.entryPlug = null;
    this.entryPlugSecret = null;
    this.unitHeartbeatTimer = null;
    this.callUnitIb = null;
    this.origin = NAVI_ORIGIN;
    this.moduleRegistry = /* @__PURE__ */ new Map();
    this.remountInProgress = false;
    this.tipMut8Chain = Promise.resolve();
    this.mod = {};
    this.storage = {
      item: {
        get: (key) => this.shimItemGet(key),
        set: (key, value) => this.shimItemSet(key, value),
        del: (key) => this.shimItemDel(key),
        list: (prefix) => this.shimItemList(prefix),
        getPath: (key, path) => this.getItemByPath(key, path),
        setPath: (key, path, value) => this.setItemByPath(key, path, value)
      },
      file: {
        load: (filePath) => this.shimFileLoad(normalizeFileKey(filePath)),
        save: (filePath, value) => this.shimFileSave(normalizeFileKey(filePath), value),
        get: (filePath) => this.shimFileGet(normalizeFileKey(filePath)),
        list: (directoryPath) => {
          const raw = directoryPath != null ? String(directoryPath).trim() : "";
          if (!raw)
            return this.shimFileList();
          return this.shimFileList(normalizeFileKey(raw));
        },
        del: (filePath) => this.shimFileDel(normalizeFileKey(filePath))
      },
      tip: {
        key: (ib) => canonicalizeTipIb(ib) || normalizeTipIb(ib),
        get: (ib) => this.getTip(ib),
        set: (frame) => this.setTip(frame),
        del: (ib) => this.deleteTip(ib),
        list: () => this.listTipIbs(),
        mut8: (ib, dataPatch = {}, opts) => this.mut8TipByIb(ib, dataPatch, opts),
        frame: {
          get: (addr) => this.getTipFrame(addr),
          put: (frame) => this.putTipFrame(frame),
          del: (addr) => this.deleteTipFrame(addr),
          list: (ib) => this.listTipFrames(ib)
        },
        span: (ib, opts) => this.tipSpan(ib, opts),
        spanDiff: (ib, opts) => this.tipSpanDiff(ib, opts),
        lineage: (ib) => this.walkTipLineage(ib),
        presume: (key) => presumeNaviIb(key)
      },
      bin: {
        ref: (sha) => `bin ${String(sha || "").trim().toLowerCase()}`,
        get: (sha) => this.getBin(sha),
        put: (sha, record) => this.putBin(sha, record),
        putMedia: (record) => this.putBinMedia(record),
        del: (sha) => this.deleteBin(sha),
        list: () => this.listBinShas(),
        mediaFromTip: (ib) => this.loadBinMediaFromTip(ib)
      },
      kill: (...parts) => {
        const ib = parts.map((p) => String(p ?? "").trim()).filter((s) => s.length > 0).join(":");
        return this.storageKill(ib);
      }
    };
    this.tokens = {
      count: (host, path) => this.withTokenStash(host, path, (list) => list.length),
      add: (host, tokens, path) => this.withTokenStash(host, path, (list) => {
        const incoming = (Array.isArray(tokens) ? tokens : String(tokens || "").split(/\s+/)).map((t) => String(t || "").trim()).filter(Boolean);
        const have = new Set(list);
        let added = 0;
        for (const t of incoming) {
          if (have.has(t))
            continue;
          have.add(t);
          list.push(t);
          added += 1;
        }
        return { added, count: list.length };
      }),
      look: (host, path) => this.withTokenStash(host, path, (list, where) => list[0] ?? noTokens(where)),
      take: (host, path) => this.withTokenStash(host, path, (list, where) => list.shift() ?? noTokens(where)),
      pay: (host, path) => this.withTokenStash(host, path, (list, where, reserve) => {
        const token = list.shift();
        if (token)
          return { mode: "header", token };
        if (reserve) {
          const parsed = this.splitReserveAddr(reserve);
          return {
            mode: "reserve",
            addr: parsed.addr,
            ib: parsed.ib
          };
        }
        return noTokens(where);
      }),
      reserve: (host) => this.readTokenReserve(host),
      hasReserve: (addr, host) => this.tokenReserveMatches(addr, host),
      setReserve: (addr, host) => this.writeTokenReserve(addr, host),
      attach: (frame, pay) => {
        if (!pay || pay.mode !== "reserve" || !frame || typeof frame !== "object") {
          return frame;
        }
        const ref = String(pay.addr || pay.ib || "").trim();
        if (!ref)
          return frame;
        const rel = frame.rel8ns && typeof frame.rel8ns === "object" ? frame.rel8ns : frame.rel8ns = {};
        const curRaw = rel[TOKEN_RESERVE_REL];
        const cur = Array.isArray(curRaw) ? curRaw.map((x) => String(x || "").trim()).filter(Boolean) : curRaw ? [String(curRaw).trim()].filter(Boolean) : [];
        if (cur.length)
          return frame;
        rel[TOKEN_RESERVE_REL] = [ref];
        return frame;
      },
      giveBack: (host, token, path) => this.withTokenStash(host, path, (list) => {
        const t = String(token || "").trim();
        if (t && !list.includes(t))
          list.unshift(t);
        return list.length;
      })
    };
    this.relayWhitelistMods = /* @__PURE__ */ new Map();
    this.relayWhitelist = {
      add: (owner, paths, opts) => {
        const key = String(owner || "").trim();
        if (!key)
          throw new Error("relayWhitelist.add(owner, paths) needs an owner (mod name)");
        const list = (Array.isArray(paths) ? paths : [paths]).map(relayWhitelistNorm).filter(Boolean);
        const alias = opts?.alias ? this.sanitizeRelayAlias(opts.alias) : "";
        this.relayWhitelistMods.set(key, { paths: [...new Set(list)], alias });
        return this.relayWhitelistMods.get(key);
      },
      remove: (owner) => this.relayWhitelistMods.delete(String(owner || "").trim()),
      on: () => this.saveRelayWhitelist({ on: true }),
      off: () => this.saveRelayWhitelist({ on: false }),
      isOn: async () => (await this.loadRelayWhitelist()).on,
      allows: (path, alias) => this.relayWhitelistAllows(path, alias),
      status: async () => {
        const w = await this.loadRelayWhitelist();
        return {
          on: w.on,
          paths: w.paths,
          via: w.via,
          trust: w.trust,
          mods: Object.fromEntries(this.relayWhitelistMods)
        };
      }
    };
    this.reseed = (force = false) => this.reseedTips(!!force);
    this.factoryreset = () => this.factoryResetSpace();
    this.park = {
      check: (input, opts) => this.parkCheck(input, opts),
      ib: (input) => this.pathToParkIb(input),
      slash: (input) => slashJoinedIb(this.pathToParkIb(input))
    };
    this.plug = {
      ping: () => this.revealEntryPlug(),
      ensure: () => this.ensureUnit(),
      touch: () => this.touchEntryPlug()
    };
    this.unit = {
      get: () => this.loadUnitsState()
    };
    this.replRl = null;
    this.replStack = [];
    this.replLineBusy = false;
    this.replResolveClose = null;
    this.repl = {
      push: (layer) => this.replPush(layer),
      pop: () => this.replPop(),
      depth: () => this.replStackLength(),
      prompt: () => this.replCurrentPrompt()
    };
    this.sw = {
      on: (name, handler, owner) => this.registerSwHandler(name, handler, owner),
      off: (name) => this.unregisterSwHandler(name),
      list: () => this.listSwHandlers(),
      registerPlugin: (id, url) => this.postToServiceWorker({ type: "REGISTER_PLUGIN", id, url }),
      registerPluginSource: (id, source) => this.postToServiceWorker({ type: "REGISTER_PLUGIN_SOURCE", id, source }),
      unregisterPlugin: (id) => this.postToServiceWorker({ type: "UNREGISTER_PLUGIN", id }),
      listPlugins: () => this.postToServiceWorker({ type: "LIST_PLUGINS" }),
      send: (id, payload) => this.postToServiceWorker({ type: "PLUGIN_MESSAGE", id, payload })
    };
    this.pwa = {
      set: (config) => this.setPwa(config),
      apply: (config) => this.setPwa(config),
      clear: () => this.clearPwa(),
      get: () => this.getPwaConfig(),
      shell: {
        status: () => this.shellCacheStatus(),
        list: () => this.shellCacheStatus(),
        refresh: (urls) => this.shellCacheRefresh(urls),
        warm: (urls) => this.shellCacheWarm(urls),
        put: (entry) => this.shellCachePut(entry),
        delete: (url) => this.shellCacheDelete(url),
        clear: () => this.shellCacheClear()
      }
    };
    this.fetch = (input, init) => this.fetchPath(input, init);
    this.callin = (input) => this.dispatchCallin(input);
    this.scriptDepth = 0;
    this.storageImpl = this.createStorage();
    this.on("callout", (data) => {
      console.log(data);
    });
    this.registerServiceWorkerBridge();
    applyNaviMobileViewport();
    this.applyFoobarchPwaDefaultsIfRoot();
  }
  get callinRequest() {
    return this.getCallinRequest();
  }
  getCallinRequest() {
    if (callinScope)
      return callinScope.getStore() ?? null;
    return this.callinSlot;
  }
  bindCallinRequest(req) {
    if (req && !callinScope)
      this.callinSlot = req;
  }
  get stamp() {
    return naviStamp;
  }
  tokenStashOrigin(host) {
    const raw = String(host || "").trim() || this.relayHost || this.origin || "";
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
      const u = new URL(withScheme.replace(/^ws/i, "http"));
      return u.origin;
    } catch {
      throw new Error(`token stash host not understood: ${raw || "(empty)"}`);
    }
  }
  tokenStashPath(path) {
    const segs = String(path || "").split(/[\\/]+/).map((s) => s.trim()).filter(Boolean);
    return segs.length ? "/" + segs.join("/") : "";
  }
  splitReserveAddr(raw) {
    const addr = String(raw || "").trim();
    const cut = addr.indexOf("^");
    const ib = (cut > 0 ? addr.slice(0, cut) : addr).trim();
    return { addr, ib };
  }
  tokenReserveAddr(tip, origin) {
    const raw = tip?.data?.reserves?.[origin];
    return String(raw || "").trim();
  }
  readTokenReserve(host) {
    const run = async () => {
      const origin = this.tokenStashOrigin(host);
      const tip = await this.getTip(TOKEN_STASH_IB);
      return this.tokenReserveAddr(tip, origin) || null;
    };
    const p = this.tokenStashChain.then(run, run);
    this.tokenStashChain = p.catch(() => void 0);
    return p;
  }
  tokenReserveMatches(addr, host) {
    const run = async () => {
      const origin = this.tokenStashOrigin(host);
      const tip = await this.getTip(TOKEN_STASH_IB);
      const cur = this.tokenReserveAddr(tip, origin);
      if (!cur)
        return false;
      const want = this.splitReserveAddr(addr);
      return !!want.ib && this.splitReserveAddr(cur).ib === want.ib;
    };
    const p = this.tokenStashChain.then(run, run);
    this.tokenStashChain = p.catch(() => void 0);
    return p;
  }
  writeTokenReserve(addr, host) {
    const run = async () => {
      const origin = this.tokenStashOrigin(host);
      const parsed = this.splitReserveAddr(addr);
      if (!parsed.ib)
        throw new Error("reserve addr required (ib or ib^gib)");
      const tip = await this.getTip(TOKEN_STASH_IB);
      const data = { ...tip?.data || {} };
      const reserves = data.reserves && typeof data.reserves === "object" ? { ...data.reserves } : {};
      const prev = String(reserves[origin] || "").trim();
      if (prev && this.splitReserveAddr(prev).ib === parsed.ib) {
        return { addr: prev, already: true, origin };
      }
      reserves[origin] = parsed.addr;
      const priorRel = tip?.rel8ns?.[TOKEN_RESERVE_REL];
      const kept = (Array.isArray(priorRel) ? priorRel : priorRel ? [priorRel] : []).map((r) => String(r || "").trim()).filter((r) => r && this.splitReserveAddr(r).ib !== parsed.ib);
      await this.mut8TipByIb(
        TOKEN_STASH_IB,
        {
          parts: data.parts || ["navi_park", "ibgib_frame", "manifest", "json"],
          hosts: data.hosts && typeof data.hosts === "object" ? data.hosts : {},
          reserves,
          default_host: data.default_host || origin
        },
        { create: true, rel8ns: { [TOKEN_RESERVE_REL]: [parsed.addr, ...kept] } }
      );
      return { addr: parsed.addr, already: false, origin };
    };
    const p = this.tokenStashChain.then(run, run);
    this.tokenStashChain = p.catch(() => void 0);
    return p;
  }
  withTokenStash(host, path, fn) {
    const run = async () => {
      const origin = this.tokenStashOrigin(host);
      const sub = this.tokenStashPath(path);
      const tip = await this.getTip(TOKEN_STASH_IB);
      const data = { ...tip?.data || {} };
      const hosts = data.hosts && typeof data.hosts === "object" ? { ...data.hosts } : {};
      const hostNest = { ...hosts[origin] || {} };
      const paths = hostNest.paths && typeof hostNest.paths === "object" ? { ...hostNest.paths } : {};
      const nest = sub ? { ...paths[sub] || {} } : hostNest;
      const list = String(nest.unused || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const before = list.join("\n");
      const reserve = this.tokenReserveAddr({ data }, origin);
      const out = fn(list, origin + sub, reserve);
      if (list.join("\n") !== before) {
        nest.unused = list.length ? list.join("\n") + "\n" : "";
        if (sub) {
          paths[sub] = nest;
          hostNest.paths = paths;
        }
        hosts[origin] = hostNest;
        await this.mut8TipByIb(
          TOKEN_STASH_IB,
          {
            parts: data.parts || ["navi_park", "ibgib_frame", "manifest", "json"],
            hosts,
            default_host: data.default_host || origin
          },
          { create: true }
        );
      }
      return out;
    };
    const p = this.tokenStashChain.then(run, run);
    this.tokenStashChain = p.catch(() => void 0);
    return p;
  }
  async loadRelayWhitelist() {
    const raw = await this.shimItemGet("relay_whitelist");
    const o = raw && typeof raw === "object" ? raw : {};
    const norm = (list) => Array.isArray(list) ? list.map(relayWhitelistNorm).filter(Boolean) : [];
    const via = {};
    if (o.via && typeof o.via === "object") {
      for (const [alias, list] of Object.entries(o.via)) {
        const a = this.sanitizeRelayAlias(alias);
        const paths = norm(list);
        if (a && paths.length)
          via[a] = paths;
      }
    }
    const trust = Array.isArray(o.trust) ? [...new Set(o.trust.map((a) => this.sanitizeRelayAlias(String(a || ""))).filter(Boolean))] : [];
    return { on: o.on === true, paths: norm(o.paths), via, trust };
  }
  async saveRelayWhitelist(patch) {
    const cur = await this.loadRelayWhitelist();
    const next = {
      on: patch.on ?? cur.on,
      paths: patch.paths ?? cur.paths,
      via: patch.via ?? cur.via,
      trust: patch.trust ?? cur.trust
    };
    await this.shimItemSet("relay_whitelist", next);
    return next;
  }
  async relayWhitelistAllows(path, alias) {
    const w = await this.loadRelayWhitelist();
    if (!w.on)
      return true;
    const p = relayWhitelistNorm(path);
    if (!p)
      return false;
    const via = alias ? this.sanitizeRelayAlias(alias) : "";
    if (via && w.trust.includes(via)) {
      const prefs = await this.loadRelayPrefs();
      if (prefs.aliasTokens[via])
        return true;
    }
    const all = [...w.paths, ...via ? w.via[via] || [] : []];
    for (const m of this.relayWhitelistMods.values()) {
      if (!m.alias || m.alias === via)
        all.push(...m.paths);
    }
    return all.some((a) => p === a || p.startsWith(a + "/"));
  }
  async relayWhitelistText() {
    const w = await this.loadRelayWhitelist();
    const lines = [
      `relay whitelist ${w.on ? "ON \u2014 only the paths below are callable through relay" : "off \u2014 every path is callable through relay"}`,
      `  yours (any alias): ${w.paths.join(", ") || "(none)"}`
    ];
    for (const [alias, list] of Object.entries(w.via)) {
      lines.push(`  yours via ${alias} only: ${list.join(", ")}`);
    }
    if (w.trust.length) {
      const prefs = await this.loadRelayPrefs();
      for (const alias of w.trust) {
        lines.push(
          `  trusted via ${alias}: ${prefs.aliasTokens[alias] ? "every path (alias token set)" : "INACTIVE \u2014 no alias token (relay alias-token " + alias + " new)"}`
        );
      }
    }
    for (const [owner, m] of this.relayWhitelistMods) {
      lines.push(`  ${owner}${m.alias ? ` (via ${m.alias} only)` : ""}: ${m.paths.join(", ") || "(none)"}`);
    }
    if (!this.relayWhitelistMods.size)
      lines.push("  mods: (none registered)");
    lines.push("  (bare /navi-<alias>/ ping always answers)");
    return lines.join("\n");
  }
  async relayOwnerSecret() {
    const cur = String(await this.shimItemGet("relay_owner") || "").trim();
    if (cur.length >= 32)
      return cur;
    const bytes = new Uint8Array(32);
    globalThis.crypto.getRandomValues(bytes);
    const next = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    await this.shimItemSet("relay_owner", next);
    return next;
  }
  replStackLength() {
    return this.replStack.length;
  }
  replCurrentPrompt() {
    const top = this.replStack[this.replStack.length - 1];
    return top?.prompt ?? "navi> ";
  }
  applyReplPrompt() {
    if (!this.replRl)
      return;
    this.replRl.setPrompt(this.replCurrentPrompt());
  }
  replPush(layer) {
    if (!this.replRl) {
      throw new Error(
        "[navi] repl.push requires localnavi REPL (navi_shell.exe)"
      );
    }
    if (!layer || typeof layer.onLine !== "function") {
      throw new Error("[navi] repl.push requires { prompt, onLine }");
    }
    const prompt = String(layer.prompt ?? "").trimEnd();
    this.replStack.push({
      prompt: prompt.endsWith(" ") ? prompt : `${prompt} `,
      onLine: layer.onLine
    });
    this.applyReplPrompt();
    this.replRl.prompt();
  }
  replPop() {
    if (!this.replStack.length)
      return null;
    const removed = this.replStack.pop() || null;
    this.applyReplPrompt();
    if (this.replRl)
      this.replRl.prompt();
    return removed;
  }
  async runLocalnaviRepl() {
    if (!isLocalnaviExe()) {
      throw new Error("[navi] runLocalnaviRepl is localnavi-only");
    }
    if (this.replRl) {
      throw new Error("[navi] localnavi REPL already running");
    }
    const readline = require("readline");
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: "navi> "
    });
    this.replRl = rl;
    this.replStack = [];
    this.callout(
      "[navi] Localnavi REPL ready. Enter callin commands (exit/quit to leave). Try: browse horizon/enter"
    );
    this.applyReplPrompt();
    rl.prompt();
    await new Promise((resolve) => {
      this.replResolveClose = resolve;
      rl.on("line", async (line) => {
        if (this.replLineBusy)
          return;
        this.replLineBusy = true;
        try {
          const top = this.replStack[this.replStack.length - 1];
          if (top) {
            await top.onLine(line);
          } else {
            const trimmed = String(line ?? "").trim();
            if (trimmed === "exit" || trimmed === "quit") {
              rl.close();
              return;
            }
            if (trimmed) {
              try {
                await this.dispatchCallin(trimmed);
              } catch (error) {
                this.callout(
                  "Error: " + formatCalloutMessage(error)
                );
              }
            }
          }
          if (this.replRl) {
            this.applyReplPrompt();
            this.replRl.prompt();
          }
        } finally {
          this.replLineBusy = false;
        }
      });
      rl.on("close", () => {
        this.replRl = null;
        this.replStack = [];
        const done = this.replResolveClose;
        this.replResolveClose = null;
        if (done)
          done();
      });
    });
  }
  currentUnitIb() {
    return this.callUnitIb || this.entryPlug?.unitIb || null;
  }
  attachIdb(db) {
    db.onclose = () => {
      if (this.idb === db)
        this.idb = null;
    };
    db.onversionchange = () => {
      db.close();
      if (this.idb === db)
        this.idb = null;
    };
    this.idb = db;
    return db;
  }
  async openIndexedDB() {
    if (this.idb)
      return this.idb;
    if (this.idbOpening)
      return this.idbOpening;
    this.idbOpening = new Promise((resolve, reject) => {
      const request = indexedDB.open("navi_shell", 5);
      request.onblocked = () => {
        this.callout(
          "[navi] IndexedDB open blocked \u2014 another connection holds navi_shell"
        );
      };
      request.onerror = () => {
        this.idbOpening = null;
        reject(request.error);
      };
      request.onsuccess = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("tip_frames")) {
          db.close();
          this.idbOpening = null;
          reject(
            new Error(
              "[navi] IndexedDB missing tip_frames \u2014 clear site data / reopen"
            )
          );
          return;
        }
        this.attachIdb(db);
        this.idbOpening = null;
        resolve(db);
      };
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (db.objectStoreNames.contains("items")) {
          db.deleteObjectStore("items");
        }
        if (db.objectStoreNames.contains("files")) {
          db.deleteObjectStore("files");
        }
        if (!db.objectStoreNames.contains("tips")) {
          db.createObjectStore("tips", { keyPath: "ib" });
        }
        if (!db.objectStoreNames.contains("tip_frames")) {
          db.createObjectStore("tip_frames", { keyPath: "addr" });
        }
        if (!db.objectStoreNames.contains("bins")) {
          db.createObjectStore("bins", { keyPath: "sha" });
        }
      };
    });
    try {
      return await this.idbOpening;
    } catch (err) {
      this.idbOpening = null;
      throw err;
    }
  }
  async idbStore(storeName, mode, exec) {
    const run = async () => {
      const db = await this.openIndexedDB();
      return await new Promise((resolve, reject) => {
        let settled = false;
        const fail = (err) => {
          if (settled)
            return;
          settled = true;
          reject(err);
        };
        try {
          const tx = db.transaction(storeName, mode);
          const req = exec(tx.objectStore(storeName));
          let value;
          req.onsuccess = () => {
            value = req.result;
          };
          req.onerror = () => fail(req.error);
          tx.oncomplete = () => {
            if (settled)
              return;
            settled = true;
            resolve(value);
          };
          tx.onerror = () => fail(tx.error);
          tx.onabort = () => fail(
            tx.error || new Error("[navi] IndexedDB transaction aborted")
          );
        } catch (err) {
          fail(err);
        }
      });
    };
    try {
      return await run();
    } catch (err) {
      const name = String(err?.name || "");
      if (name === "InvalidStateError" || name === "InvalidAccessError") {
        this.idb = null;
        return await run();
      }
      throw err;
    }
  }
  async getItemByPath(key, path) {
    const obj = await this.shimItemGet(key);
    if (!obj) {
      return null;
    }
    let current = obj;
    for (const part of path) {
      if (current === null || current === void 0 || typeof current !== "object") {
        return void 0;
      }
      current = current[part];
    }
    return current;
  }
  async setItemByPath(key, path, value) {
    let obj = {};
    const existingObj = await this.shimItemGet(key);
    if (existingObj && typeof existingObj === "object") {
      obj = existingObj;
    }
    let current = obj;
    for (let i = 0; i < path.length - 1; i++) {
      const part = path[i];
      if (current[part] === null || current[part] === void 0 || typeof current[part] !== "object") {
        current[part] = {};
      }
      current = current[part];
    }
    const finalKey = path[path.length - 1];
    current[finalKey] = value;
    await this.shimItemSet(key, obj);
  }
  async shimItemGet(key) {
    const tip = await this.getTip(storageItemTipIb(key));
    if (!tip?.data)
      return null;
    return tip.data.value !== void 0 ? tip.data.value : null;
  }
  async shimItemSet(key, value) {
    const ib = storageItemTipIb(key);
    const existing = await this.getTip(ib);
    const priorAddr = existing?.gib ? `${existing.ib}^${existing.gib}` : null;
    const frame = await this.stampTipFrame({
      ib,
      gib: "",
      data: {
        ...existing?.data && typeof existing.data === "object" ? existing.data : {},
        parts: ["storage_item", "ibgib_frame", "manifest", "json"],
        shim: "item",
        value,
        n: void 0
      },
      rel8ns: {
        ...existing?.rel8ns || {},
        past: priorAddr ? [priorAddr] : [],
        tjp: Array.isArray(existing?.rel8ns?.tjp) ? existing.rel8ns.tjp : [],
        dna: Array.isArray(existing?.rel8ns?.dna) ? existing.rel8ns.dna : []
      }
    });
    await this.setTip(frame);
  }
  async shimItemDel(key) {
    await this.deleteTip(storageItemTipIb(key));
  }
  async shimItemList(prefix) {
    const tips = await this.listTipIbs();
    const p = prefix != null ? String(prefix) : "";
    const pAlt = p.replace(/\//g, ":");
    const out = [];
    for (const ib of tips) {
      const tip = await this.getTipExact(ib);
      if (tip?.data?.shim !== "item")
        continue;
      const key = ib === "navi" || /^navi[:/\s]/.test(ib) ? relativeNaviKey(ib) : ib;
      if (p && !key.startsWith(p) && !key.startsWith(pAlt) && !ib.startsWith(p)) {
        continue;
      }
      out.push(key);
    }
    return out;
  }
  async shimFileSave(filePath, value) {
    const record = toFileRecord(value);
    const sha = await this.putBinMedia(record);
    const ref = `bin ${sha}`;
    const ib = storageFileTipIb(filePath);
    const existing = await this.getTip(ib);
    const priorAddr = existing?.gib ? `${existing.ib}^${existing.gib}` : null;
    const frame = await this.stampTipFrame({
      ib,
      gib: "",
      data: {
        ...existing?.data && typeof existing.data === "object" ? existing.data : {},
        parts: ["storage_file", "ibgib_frame", "manifest", "json"],
        shim: "file",
        content_type: record.mime,
        path: ib,
        n: void 0
      },
      rel8ns: {
        ...existing?.rel8ns || {},
        bin: [ref],
        past: priorAddr ? [priorAddr] : [],
        tjp: Array.isArray(existing?.rel8ns?.tjp) ? existing.rel8ns.tjp : [],
        dna: Array.isArray(existing?.rel8ns?.dna) ? existing.rel8ns.dna : []
      }
    });
    await this.setTip(frame);
  }
  async shimFileGet(filePath) {
    const tip = await this.getTip(storageFileTipIb(filePath));
    if (!tip?.data)
      return null;
    const sha = String(tip.rel8ns?.bin?.[0] || "").match(/^bin\s+([0-9a-fA-F]+)$/)?.[1]?.toLowerCase();
    if (!sha)
      return null;
    const bin = await this.getBin(sha);
    if (!bin)
      return null;
    return {
      media: bin.media,
      mime: tip.data.content_type || bin.mime || "text/plain"
    };
  }
  async shimFileLoad(filePath) {
    const entry = await this.shimFileGet(filePath);
    return entry?.media ?? null;
  }
  async shimFileList(directoryPath) {
    const tips = await this.listTipIbs();
    const withBin = [];
    for (const ib of tips) {
      const tip = await this.getTipExact(ib);
      if (tip?.data?.shim !== "file") {
        if (!(/^navi[:/\s]/.test(ib) || ib === "navi") || !Array.isArray(tip?.rel8ns?.bin) || !tip.rel8ns.bin.length) {
          continue;
        }
        withBin.push(relativeNaviKey(ib));
        continue;
      }
      if (!Array.isArray(tip?.rel8ns?.bin) || !tip.rel8ns.bin.length) {
        continue;
      }
      withBin.push(ib);
    }
    if (!directoryPath)
      return withBin;
    const prefix = normalizeTipIb(directoryPath);
    const prefixRel = relativeNaviKey(prefix);
    return withBin.filter(
      (rel) => rel === prefix || rel === prefixRel || rel.startsWith(prefix + ":") || rel.startsWith(prefix + "/") || prefixRel && (rel.startsWith(prefixRel + ":") || rel.startsWith(prefixRel + "/"))
    );
  }
  async shimFileDel(filePath) {
    const ib = storageFileTipIb(filePath);
    const tip = await this.getTip(ib);
    if (tip?.rel8ns?.bin?.[0]) {
      const sha = String(tip.rel8ns.bin[0]).match(/^bin\s+([0-9a-fA-F]+)$/)?.[1]?.toLowerCase();
      if (sha)
        await this.deleteBin(sha);
    }
    if (tip?.data && tip.data.value !== void 0) {
      const next = await this.stampTipFrame({
        ...tip,
        data: {
          ...tip.data,
          content_type: void 0,
          shim: "item",
          n: void 0
        },
        rel8ns: {
          ...tip.rel8ns || {},
          bin: [],
          past: tip.gib ? [`${tip.ib}^${tip.gib}`] : []
        }
      });
      await this.setTip(next);
      return;
    }
    await this.deleteTip(ib);
  }
  createStorage() {
    if (typeof window !== "undefined") {
      return {
        getTip: async (ib) => {
          try {
            const row = await this.idbStore(
              "tips",
              "readonly",
              (s) => s.get(ib)
            );
            return row || null;
          } catch (error) {
            this.callout("Failed to read tip: " + error);
            return null;
          }
        },
        putTip: async (frame) => {
          try {
            await this.idbStore(
              "tips",
              "readwrite",
              (s) => s.put(frame)
            );
          } catch (error) {
            this.callout("Failed to write tip: " + error);
            throw error;
          }
        },
        deleteTip: async (ib) => {
          try {
            await this.idbStore(
              "tips",
              "readwrite",
              (s) => s.delete(ib)
            );
          } catch (error) {
            this.callout("Failed to delete tip: " + error);
          }
        },
        listTips: async () => {
          try {
            const keys = await this.idbStore(
              "tips",
              "readonly",
              (s) => s.getAllKeys()
            );
            return (keys || []).map(String);
          } catch (error) {
            this.callout("Failed to list tips: " + error);
            return [];
          }
        },
        getTipFrame: async (addr) => {
          try {
            const key = String(addr || "").trim();
            if (!key || !key.includes("^"))
              return null;
            const row = await this.idbStore(
              "tip_frames",
              "readonly",
              (s) => s.get(key)
            );
            if (!row)
              return null;
            const { addr: _a, ...frame } = row;
            return frame;
          } catch (error) {
            this.callout("Failed to read tip frame: " + error);
            return null;
          }
        },
        putTipFrame: async (frame) => {
          try {
            const ib = String(frame?.ib || "").trim();
            const gib = String(frame?.gib || "").trim();
            if (!ib || !gib) {
              throw new Error("[navi] tip frame requires ib and gib");
            }
            const addr = `${ib}^${gib}`;
            await this.idbStore(
              "tip_frames",
              "readwrite",
              (s) => s.put({
                addr,
                ib,
                gib,
                data: frame.data,
                rel8ns: frame.rel8ns
              })
            );
          } catch (error) {
            this.callout("Failed to write tip frame: " + error);
            throw error;
          }
        },
        deleteTipFrame: async (addr) => {
          try {
            const key = String(addr || "").trim();
            if (!key || !key.includes("^"))
              return;
            await this.idbStore(
              "tip_frames",
              "readwrite",
              (s) => s.delete(key)
            );
          } catch (error) {
            this.callout("Failed to delete tip frame: " + error);
          }
        },
        listTipFrames: async (ib) => {
          try {
            const want = String(ib || "").trim();
            const keys = await this.idbStore(
              "tip_frames",
              "readonly",
              (s) => s.getAllKeys()
            );
            const addrs = (keys || []).map(String);
            if (!want)
              return addrs;
            return addrs.filter(
              (addr) => addr === want || addr.startsWith(want + "^")
            );
          } catch (error) {
            this.callout("Failed to list tip frames: " + error);
            return [];
          }
        },
        getBin: async (sha) => {
          try {
            const row = await this.idbStore(
              "bins",
              "readonly",
              (s) => s.get(sha)
            );
            return row || null;
          } catch (error) {
            this.callout("Failed to read bin: " + error);
            return null;
          }
        },
        putBin: async (sha, record) => {
          try {
            await this.idbStore(
              "bins",
              "readwrite",
              (s) => s.put({
                sha,
                media: record.media,
                mime: record.mime || "application/octet-stream"
              })
            );
          } catch (error) {
            this.callout("Failed to write bin: " + error);
            throw error;
          }
        },
        deleteBin: async (sha) => {
          try {
            await this.idbStore(
              "bins",
              "readwrite",
              (s) => s.delete(sha)
            );
          } catch (error) {
            this.callout("Failed to delete bin: " + error);
          }
        },
        listBins: async () => {
          try {
            const keys = await this.idbStore(
              "bins",
              "readonly",
              (s) => s.getAllKeys()
            );
            return (keys || []).map(String);
          } catch (error) {
            this.callout("Failed to list bins: " + error);
            return [];
          }
        }
      };
    } else {
      return {
        getTip: async (ib) => {
          try {
            const { fs, join, homedir } = await getNodeFsPathOs();
            const tipsFile = join(naviDataDir(join, homedir), "tips.json");
            return await withLocalnaviJsonMapFile(tipsFile, async () => {
              const data = await readLocalnaviJsonMap(fs, tipsFile);
              return data[ib] || null;
            });
          } catch (error) {
            this.callout("Failed to read tip: " + error);
            return null;
          }
        },
        putTip: async (frame) => {
          try {
            const { fs, join, homedir } = await getNodeFsPathOs();
            const storageDir = naviDataDir(join, homedir);
            const tipsFile = join(storageDir, "tips.json");
            await fs.mkdir(storageDir, { recursive: true });
            await withLocalnaviJsonMapFile(tipsFile, async () => {
              const data = await readLocalnaviJsonMap(fs, tipsFile);
              data[frame.ib] = frame;
              await writeLocalnaviJsonMapAtomic(fs, tipsFile, data);
            });
          } catch (error) {
            this.callout("Failed to write tip: " + error);
            throw error;
          }
        },
        deleteTip: async (ib) => {
          try {
            const { fs, join, homedir } = await getNodeFsPathOs();
            const tipsFile = join(naviDataDir(join, homedir), "tips.json");
            await withLocalnaviJsonMapFile(tipsFile, async () => {
              const data = await readLocalnaviJsonMap(fs, tipsFile);
              if (!(ib in data))
                return;
              delete data[ib];
              await writeLocalnaviJsonMapAtomic(fs, tipsFile, data);
            });
          } catch (error) {
            this.callout("Failed to delete tip: " + error);
          }
        },
        listTips: async () => {
          try {
            const { fs, join, homedir } = await getNodeFsPathOs();
            const tipsFile = join(naviDataDir(join, homedir), "tips.json");
            return await withLocalnaviJsonMapFile(tipsFile, async () => {
              const data = await readLocalnaviJsonMap(fs, tipsFile);
              return Object.keys(data || {});
            });
          } catch (error) {
            this.callout("Failed to list tips: " + error);
            return [];
          }
        },
        getTipFrame: async (addr) => {
          try {
            const key = String(addr || "").trim();
            if (!key || !key.includes("^"))
              return null;
            const { fs, join, homedir } = await getNodeFsPathOs();
            const framesFile = join(
              naviDataDir(join, homedir),
              "tip_frames.json"
            );
            return await withLocalnaviJsonMapFile(framesFile, async () => {
              const data = await readLocalnaviJsonMap(fs, framesFile);
              const row = data[key];
              if (!row || typeof row !== "object")
                return null;
              return {
                ib: String(row.ib || ""),
                gib: String(row.gib || ""),
                data: row.data,
                rel8ns: row.rel8ns
              };
            });
          } catch (error) {
            this.callout("Failed to read tip frame: " + error);
            return null;
          }
        },
        putTipFrame: async (frame) => {
          try {
            const ib = String(frame?.ib || "").trim();
            const gib = String(frame?.gib || "").trim();
            if (!ib || !gib) {
              throw new Error("[navi] tip frame requires ib and gib");
            }
            const addr = `${ib}^${gib}`;
            const { fs, join, homedir } = await getNodeFsPathOs();
            const storageDir = naviDataDir(join, homedir);
            const framesFile = join(storageDir, "tip_frames.json");
            await fs.mkdir(storageDir, { recursive: true });
            await withLocalnaviJsonMapFile(framesFile, async () => {
              const data = await readLocalnaviJsonMap(fs, framesFile);
              data[addr] = {
                ib,
                gib,
                data: frame.data,
                rel8ns: frame.rel8ns
              };
              await writeLocalnaviJsonMapAtomic(fs, framesFile, data);
            });
          } catch (error) {
            this.callout("Failed to write tip frame: " + error);
            throw error;
          }
        },
        deleteTipFrame: async (addr) => {
          try {
            const key = String(addr || "").trim();
            if (!key || !key.includes("^"))
              return;
            const { fs, join, homedir } = await getNodeFsPathOs();
            const framesFile = join(
              naviDataDir(join, homedir),
              "tip_frames.json"
            );
            await withLocalnaviJsonMapFile(framesFile, async () => {
              const data = await readLocalnaviJsonMap(fs, framesFile);
              if (!(key in data))
                return;
              delete data[key];
              await writeLocalnaviJsonMapAtomic(fs, framesFile, data);
            });
          } catch (error) {
            this.callout("Failed to delete tip frame: " + error);
          }
        },
        listTipFrames: async (ib) => {
          try {
            const want = String(ib || "").trim();
            const { fs, join, homedir } = await getNodeFsPathOs();
            const framesFile = join(
              naviDataDir(join, homedir),
              "tip_frames.json"
            );
            return await withLocalnaviJsonMapFile(framesFile, async () => {
              const data = await readLocalnaviJsonMap(fs, framesFile);
              return Object.keys(data || {}).filter((addr) => {
                if (!want)
                  return true;
                const row = data[addr];
                return String(row?.ib || "") === want || addr.startsWith(want + "^");
              });
            });
          } catch (error) {
            this.callout("Failed to list tip frames: " + error);
            return [];
          }
        },
        getBin: async (sha) => {
          try {
            const { fs, join, homedir } = await getNodeFsPathOs();
            const binPath = join(naviDataDir(join, homedir), "bins", sha + ".json");
            try {
              const row = JSON.parse(await fs.readFile(binPath, "utf8"));
              return {
                sha,
                media: String(row.media ?? ""),
                mime: String(row.mime || "application/octet-stream")
              };
            } catch {
              return null;
            }
          } catch (error) {
            this.callout("Failed to read bin: " + error);
            return null;
          }
        },
        putBin: async (sha, record) => {
          try {
            const { fs, join, homedir } = await getNodeFsPathOs();
            const binDir = join(naviDataDir(join, homedir), "bins");
            await fs.mkdir(binDir, { recursive: true });
            await fs.writeFile(
              join(binDir, sha + ".json"),
              JSON.stringify({
                sha,
                media: record.media,
                mime: record.mime || "application/octet-stream"
              }),
              "utf8"
            );
          } catch (error) {
            this.callout("Failed to write bin: " + error);
          }
        },
        deleteBin: async (sha) => {
          try {
            const { fs, join, homedir } = await getNodeFsPathOs();
            await fs.unlink(
              join(naviDataDir(join, homedir), "bins", sha + ".json")
            );
          } catch (error) {
            this.callout("Failed to delete bin: " + error);
          }
        },
        listBins: async () => {
          try {
            const { fs, join, homedir } = await getNodeFsPathOs();
            const binDir = join(naviDataDir(join, homedir), "bins");
            await fs.mkdir(binDir, { recursive: true });
            const names = await fs.readdir(binDir);
            return names.filter((n) => n.endsWith(".json")).map((n) => n.slice(0, -".json".length));
          } catch (error) {
            this.callout("Failed to list bins: " + error);
            return [];
          }
        }
      };
    }
  }
  registerServiceWorkerBridge() {
    if (_Navi.serviceWorkerBridgeRegistered) {
      return;
    }
    if (typeof navigator === "undefined" || !navigator.serviceWorker) {
      return;
    }
    _Navi.serviceWorkerBridgeRegistered = true;
    navigator.serviceWorker.addEventListener("message", async (event) => {
      const data = event.data;
      if (!data || data.type !== SW_NAVI_CALL) {
        return;
      }
      const port = event.ports?.[0];
      if (!port) {
        return;
      }
      const path = Array.isArray(data.path) ? data.path.map(String) : null;
      const args = Array.isArray(data.args) ? data.args : [];
      if (!path || path.length === 0) {
        port.postMessage({ ok: false, error: "navi:call requires a non-empty path" });
        return;
      }
      try {
        const result = await this.dispatchSwNaviCall(path, args);
        port.postMessage({ ok: true, result: result ?? null });
      } catch (error) {
        port.postMessage({ ok: false, error: formatCalloutMessage(error) });
      }
    });
  }
  async dispatchSwNaviCall(path, args) {
    if (path[0] === "handler") {
      if (path.length !== 2 || !path[1]) {
        throw new Error('navi:call handler path must be ["handler", name]');
      }
      const entry = this.swHandlers.get(path[1]);
      if (!entry) {
        throw new Error(`No SW handler registered: ${path[1]}`);
      }
      return await entry.handler(...args);
    }
    const pathKey = path.join(".");
    if (!SW_ALLOWED_CALLS.has(pathKey)) {
      throw new Error(`Service worker navi:call not allowed: ${pathKey}`);
    }
    return await this.resolveNaviCall(path, args);
  }
  registerSwHandler(name, handler, owner) {
    const key = String(name || "").trim();
    if (!key) {
      throw new Error("[navi-error] navi.sw.on requires a non-empty handler name");
    }
    if (typeof handler !== "function") {
      throw new Error(`[navi-error] navi.sw.on('${key}') requires a function`);
    }
    this.swHandlers.set(key, { handler, owner: owner ? String(owner) : void 0 });
  }
  unregisterSwHandler(name) {
    return this.swHandlers.delete(String(name || "").trim());
  }
  listSwHandlers() {
    return [...this.swHandlers.entries()].map(([name, entry]) => ({
      name,
      owner: entry.owner
    }));
  }
  clearSwHandlersForOwner(owner) {
    for (const [name, entry] of this.swHandlers) {
      if (entry.owner === owner) {
        this.swHandlers.delete(name);
      }
    }
  }
  async postToServiceWorker(message) {
    if (typeof navigator === "undefined" || !navigator.serviceWorker) {
      throw new Error("[navi-error] service worker unavailable");
    }
    const reg = await navigator.serviceWorker.ready;
    const worker = reg.active;
    if (!worker) {
      throw new Error("[navi-error] no active service worker");
    }
    return await new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const timeout = setTimeout(() => {
        reject(new Error("service worker message timed out"));
      }, 1e4);
      channel.port1.onmessage = (event) => {
        clearTimeout(timeout);
        const data = event.data;
        if (!data || data.ok === false) {
          reject(new Error(data?.error || "service worker message failed"));
          return;
        }
        resolve(data);
      };
      worker.postMessage({ ...message, expectResponse: true }, [channel.port2]);
    });
  }
  async registerServiceWorker() {
    if (typeof navigator === "undefined" || !navigator.serviceWorker) {
      return;
    }
    try {
      await navigator.serviceWorker.register("/sw.js");
    } catch (error) {
      this.callout("[navi] Service worker registration failed: " + formatCalloutMessage(error));
    }
  }
  resolveShellEntryPath() {
    const raw = this.pwaConfig?.start_url;
    if (raw != null && String(raw).trim()) {
      try {
        const s = String(raw).trim();
        if (/^[a-z][a-z0-9+.-]*:/i.test(s)) {
          return new URL(s).pathname || "/";
        }
        const path = s.startsWith("/") ? s : `/${s}`;
        return path.split("?")[0].split("#")[0] || "/";
      } catch {
      }
    }
    if (isBrowserDocument() && typeof window !== "undefined") {
      return window.location.pathname || "/";
    }
    return "/";
  }
  async shellCacheStatus() {
    return await this.postToServiceWorker({
      type: "NAVI_SHELL_CACHE",
      action: "status"
    });
  }
  async shellCacheRefresh(urls) {
    const list = Array.isArray(urls) && urls.length ? urls : ["/navi_shell.js"];
    return await this.postToServiceWorker({
      type: "NAVI_SHELL_CACHE",
      action: "refresh",
      urls: list
    });
  }
  async shellCacheWarm(urls) {
    const entry = this.resolveShellEntryPath();
    const list = Array.isArray(urls) && urls.length ? urls : [entry, entry === "/" ? null : "/"].filter(Boolean);
    return await this.postToServiceWorker({
      type: "NAVI_SHELL_CACHE",
      action: "warm",
      urls: list
    });
  }
  async shellCacheDelete(url) {
    if (!url)
      throw new Error("[navi.pwa.shell.delete] requires url");
    return await this.postToServiceWorker({
      type: "NAVI_SHELL_CACHE",
      action: "delete",
      url
    });
  }
  async shellCachePut(entry) {
    if (!entry || !entry.url) {
      throw new Error("[navi.pwa.shell.put] requires { url, body }");
    }
    return await this.postToServiceWorker({
      type: "NAVI_SHELL_CACHE",
      action: "put",
      url: entry.url,
      body: entry.body,
      contentType: entry.contentType
    });
  }
  async shellCacheClear() {
    return await this.postToServiceWorker({
      type: "NAVI_SHELL_CACHE",
      action: "clear"
    });
  }
  async ensureShellCache() {
    if (!isBrowserDocument())
      return;
    if (typeof navigator === "undefined" || !navigator.serviceWorker)
      return;
    try {
      await navigator.serviceWorker.ready;
      const entry = this.resolveShellEntryPath();
      const runtime = await this.shellCacheRefresh(["/navi_shell.js"]);
      const warm = await this.shellCacheWarm([entry, "/"]);
      const runtimeOk = (Array.isArray(runtime?.results) ? runtime.results : []).filter(
        (r) => r && r.ok
      ).length;
      const warmOk = (Array.isArray(warm?.results) ? warm.results : []).filter(
        (r) => r && r.ok
      ).length;
      const warmTotal = Array.isArray(warm?.results) ? warm.results.length : 0;
      this.callout(
        `[navi.pwa.shell] runtime navi_shell.js ${runtimeOk}/1; offline warm ${warmOk}/${warmTotal}`
      );
    } catch (error) {
      this.callout(
        "[navi.pwa.shell] cache refresh skipped: " + formatCalloutMessage(error)
      );
    }
  }
  resolveUrl(path) {
    const raw = String(path ?? "");
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
      return raw;
    }
    const rel = raw.startsWith("/") ? raw : `/${raw}`;
    return this.origin ? `${this.origin}${rel}` : rel;
  }
  pathToParkIb(input) {
    let raw = String(input ?? "").trim();
    if (!raw)
      return "";
    try {
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
        raw = new URL(raw).pathname;
      }
    } catch {
    }
    try {
      raw = decodeURIComponent(raw);
    } catch {
    }
    return normalizeTipIb(raw);
  }
  isNaviPrefixPath(input) {
    const ib = this.pathToParkIb(input);
    return ib === "navi" || /^navi[/:\s]/.test(ib);
  }
  gatePassthruFromInit(init) {
    if (!init?.headers)
      return false;
    const h = new Headers(init.headers);
    const v = String(
      h.get("X-Navi-Gate-Passthru") || h.get("x-navi-gate-passthru") || ""
    ).trim().toLowerCase();
    return v === "1" || v === "true" || v === "yes";
  }
  parkBypassFromHeaders(headers) {
    if (!headers || typeof headers !== "object")
      return false;
    const h = new Headers(headers);
    const v = String(
      h.get("X-Navi-Park-Bypass") || h.get("x-navi-park-bypass") || ""
    ).trim().toLowerCase();
    return v === "1" || v === "true" || v === "yes";
  }
  async fetchPath(input, init) {
    const path = String(input ?? "").trim();
    if (!path) {
      return new Response("navi.fetch: empty path", { status: 400 });
    }
    const local = await this.parkCheck(path, {
      gatePassthru: this.gatePassthruFromInit(init)
    });
    if (local.hit) {
      return new Response(local.body == null ? "" : String(local.body), {
        status: 200,
        headers: {
          "Content-Type": local.mime || "application/octet-stream",
          "X-Navi-Park-Ib": local.ib || "",
          "X-Navi-Park-Kind": local.kind || "",
          "X-Navi-Unit": local.unit || ""
        }
      });
    }
    if (typeof fetch !== "function") {
      return new Response(
        `navi.fetch: localpark miss for ${local.ib || path} and fetch is unavailable`,
        { status: 502 }
      );
    }
    const url = encodeURI(this.resolveUrl(path));
    return await fetch(url, init);
  }
  async parkCheck(input, opts) {
    const unit = this.currentUnitIb();
    const withUnit = (row) => ({
      ...row,
      unit: this.currentUnitIb() ?? unit
    });
    const ib = this.pathToParkIb(input);
    if (!ib) {
      return withUnit({ hit: false, reason: "empty path" });
    }
    if (ib === "navi") {
      return withUnit({
        hit: false,
        ib,
        reason: "root navi tip excluded from park GET"
      });
    }
    const gatePassthru = !!opts?.gatePassthru;
    const unitPeel = await this.peelUnitFromIb(ib);
    if (unitPeel) {
      const restSegs = unitPeel.restSegs;
      if (!restSegs.length) {
        const tip = await this.getTip(unitPeel.unitIb);
        if (!tip?.data) {
          return withUnit({
            hit: false,
            ib: unitPeel.unitIb,
            reason: "no local unit tip"
          });
        }
        return withUnit({
          hit: true,
          ib: tip.ib,
          kind: "frame",
          body: JSON.stringify(tip, null, 2),
          mime: "application/json; charset=utf-8"
        });
      }
      const restIb = restSegs.join("/");
      return await this.withCallUnit(
        unitPeel.unitIb,
        async () => this.parkCheck(restIb, opts)
      );
    }
    const headers = {};
    if (gatePassthru)
      headers["X-Navi-Gate-Passthru"] = "1";
    try {
      const result = await this.dispatchCallin({
        path: ib,
        method: "GET",
        headers,
        viaRelay: false,
        hostPin: false
      });
      const { media, mime } = this.coerceParkBody(result);
      const cap = await this.resolveModParkCapture(ib, {
        method: "GET",
        viaRelay: false,
        callin: true
      });
      if (cap) {
        return withUnit({
          hit: true,
          ib: cap.tipIb,
          kind: cap.kind || "mod",
          body: media,
          mime
        });
      }
      const tip = await this.getTip(ib, { gatePassthru });
      const ctrl = parkMethodCtrl(tip, "GET");
      const kind = String(ctrl?.kind || (tip?.data?.shim === "file" ? "bin" : "frame")).toLowerCase() || "frame";
      return withUnit({
        hit: true,
        ib: tip?.ib || ib,
        kind,
        body: media,
        mime
      });
    } catch (err) {
      const tip = await this.getTip(ib, { gatePassthru });
      const ctrl = parkMethodCtrl(tip, "GET");
      const kind = String(ctrl?.kind || "").toLowerCase();
      return withUnit({
        hit: false,
        ib: tip?.ib || ib,
        kind: kind || void 0,
        reason: tip?.data ? formatCalloutMessage(err) : "no local tip"
      });
    }
  }
  isParkCapture(tip) {
    return typeof tip?.data?.park === "string" && tip.data.park.trim().toLowerCase() === "capture";
  }
  async fetchHostParkGet(ib, accept, extraHeaders) {
    const want = canonicalizeTipIb(ib) || String(ib || "").trim();
    if (!want || typeof fetch !== "function")
      return null;
    try {
      const res = await fetch(encodeURI(this.resolveUrl(want)), {
        method: "GET",
        headers: {
          ...extraHeaders || {},
          Accept: accept,
          "X-Navi-Park-Bypass": "1"
        },
        cache: "no-store"
      });
      if (!res.ok)
        return null;
      const ct = String(res.headers.get("content-type") || "").toLowerCase();
      const buf = await res.arrayBuffer();
      if (!buf || buf.byteLength === 0)
        return null;
      let text = "";
      try {
        text = new TextDecoder("utf-8").decode(buf);
      } catch {
        text = "";
      }
      return { ct, text, buf, headers: res.headers };
    } catch {
      return null;
    }
  }
  parseNaviModMultipart(ct, buf, headers) {
    const ctLower = String(ct || "").toLowerCase();
    const bm = ctLower.match(/boundary\s*=\s*"?([^";\s]+)"?/i) || ctLower.match(/boundary\s*=\s*([^;\s]+)/i);
    if (!bm)
      return null;
    const boundary = bm[1];
    const decoder = new TextDecoder("utf-8");
    const asText = decoder.decode(new Uint8Array(buf));
    const delim = "--" + boundary;
    const chunks = asText.split(delim);
    let frame = null;
    let media = "";
    let mime = "application/navi-module";
    let sha = String(headers?.get("x-foobarch-bin") || "").trim().toLowerCase();
    for (const raw of chunks) {
      let part = raw;
      if (part.startsWith("--"))
        break;
      if (part.startsWith("\r\n"))
        part = part.slice(2);
      else if (part.startsWith("\n"))
        part = part.slice(1);
      if (!part.trim() || part.trim() === "--")
        continue;
      const sep = part.indexOf("\r\n\r\n");
      const sepN = part.indexOf("\n\n");
      const splitAt = sep >= 0 ? sep : sepN >= 0 ? sepN : -1;
      if (splitAt < 0)
        continue;
      const head = part.slice(0, splitAt);
      let body = part.slice(splitAt + (sep >= 0 ? 4 : 2));
      if (body.endsWith("\r\n"))
        body = body.slice(0, -2);
      else if (body.endsWith("\n"))
        body = body.slice(0, -1);
      const headL = head.toLowerCase();
      const partCt = (head.match(/content-type:\s*([^\r\n;]+)/i) || [])[1] || "";
      const partCtL = partCt.toLowerCase().trim();
      const binHdr = (head.match(/x-foobarch-bin:\s*([^\r\n]+)/i) || [])[1] || "";
      if (partCtL.includes("application/eframe") || partCtL.includes("ibgib+json") || headL.includes('name="eframe"') || headL.includes("content-id: <eframe>")) {
        try {
          const json = JSON.parse(body);
          const fr = json && typeof json === "object" && json.frame ? json.frame : json;
          if (fr && typeof fr === "object" && fr.data && typeof fr.data === "object") {
            frame = fr;
          }
        } catch {
        }
        continue;
      }
      if (headL.includes('name="bin"') || headL.includes("content-id: <bin>") || binHdr || partCtL.includes("navi-module") || partCtL.includes("javascript")) {
        media = body;
        if (partCtL)
          mime = partCt.trim();
        if (binHdr)
          sha = String(binHdr).trim().toLowerCase();
        const fn = (head.match(/filename="bin\s+([^"]+)"/i) || [])[1] || "";
        if (fn && !sha)
          sha = String(fn).trim().toLowerCase();
      }
    }
    if (!frame || !media.trim())
      return null;
    if (!sha) {
      const rel = frame.rel8ns?.bin?.[0];
      if (rel) {
        sha = String(rel).replace(/^bin\s+/i, "").trim().toLowerCase();
      }
    }
    if (!sha)
      return null;
    return { frame, sha, media, mime };
  }
  async fetchHostModPackage(ib) {
    const want = canonicalizeTipIb(ib) || String(ib || "").trim();
    if (!want)
      return null;
    const got = await this.fetchHostParkGet(
      want,
      "application/navi-mod, application/navi-mod+json;q=0.5"
    );
    if (!got)
      return null;
    const pkgHdr = String(
      got.headers.get("x-foobarch-package") || ""
    ).toLowerCase();
    const isMultipart = got.ct.includes("multipart/") || pkgHdr.includes("navi-mod") && got.ct.includes("boundary=");
    if (isMultipart) {
      return this.parseNaviModMultipart(got.ct, got.buf, got.headers);
    }
    if (!(got.ct.includes("navi-mod") || got.text.trim().startsWith("{"))) {
      return null;
    }
    let json;
    try {
      json = JSON.parse(got.text);
    } catch {
      return null;
    }
    if (!(json && typeof json === "object" && json.frame && json.bin)) {
      return null;
    }
    const frameRaw = json.frame;
    if (!(frameRaw && typeof frameRaw === "object" && frameRaw.data && typeof frameRaw.data === "object")) {
      return null;
    }
    const bin = json.bin && typeof json.bin === "object" ? json.bin : null;
    let media = "";
    if (bin && typeof bin.media === "string" && bin.media.trim()) {
      media = bin.media;
    } else if (bin && typeof bin.body_b64 === "string" && bin.body_b64) {
      try {
        if (typeof atob === "function") {
          media = atob(bin.body_b64);
        } else if (typeof Buffer !== "undefined" && typeof Buffer.from === "function") {
          media = Buffer.from(bin.body_b64, "base64").toString("utf8");
        }
      } catch {
        media = "";
      }
    }
    if (!media.trim())
      return null;
    let sha = String(bin?.sha256 || "").trim().toLowerCase();
    if (!sha) {
      const rel = frameRaw.rel8ns?.bin?.[0];
      if (rel) {
        sha = String(rel).replace(/^bin\s+/i, "").trim().toLowerCase();
      }
    }
    if (!sha)
      sha = await this.sha256Hex(media);
    const mime = String(
      bin?.content_type || frameRaw.data?.content_type || "application/navi-module"
    ) || "application/navi-module";
    const fib = canonicalizeTipIb(String(frameRaw.ib || want)) || want;
    return {
      frame: { ...frameRaw, ib: fib },
      sha,
      media,
      mime
    };
  }
  async fetchHostTipFrame(ib) {
    const want = canonicalizeTipIb(ib) || String(ib || "").trim();
    if (!want)
      return null;
    const got = await this.fetchHostParkGet(
      want,
      "application/eframe, application/ibgib+json;q=0.9"
    );
    if (!got)
      return null;
    if (got.ct.includes("multipart/") || got.ct.includes("navi-mod") && !got.ct.includes("navi-module")) {
      return null;
    }
    let json;
    try {
      json = JSON.parse(got.text);
    } catch {
      return null;
    }
    const frame = json && typeof json === "object" && json.frame ? json.frame : json;
    if (!(frame && typeof frame === "object" && frame.data && typeof frame.data === "object")) {
      return null;
    }
    const fib = canonicalizeTipIb(String(frame.ib || want)) || want;
    return { ...frame, ib: fib };
  }
  async fetchHostFrameSnapshot(ib, wantShas) {
    const want = canonicalizeTipIb(ib) || String(ib || "").trim();
    if (!want)
      return null;
    const extra = {};
    if (wantShas?.length)
      extra["X-Foobarch-Snapshot-Bins"] = wantShas.join(",");
    const got = await this.fetchHostParkGet(
      want,
      "application/eframe, multipart/related, application/ibgib+json;q=0.9",
      extra
    );
    if (!got)
      return null;
    const asFrame = (json) => {
      const fr = json && typeof json === "object" && json.frame ? json.frame : json;
      return fr && typeof fr === "object" && fr.data && typeof fr.data === "object" ? fr : null;
    };
    if (!got.ct.includes("multipart/")) {
      if (!(got.ct.includes("eframe") || got.ct.includes("json")))
        return null;
      try {
        const frame2 = asFrame(JSON.parse(got.text));
        return frame2 ? { frame: frame2, bins: [] } : null;
      } catch {
        return null;
      }
    }
    const bm = got.ct.match(/boundary\s*=\s*"?([^";\s]+)"?/i) || got.ct.match(/boundary\s*=\s*([^;\s]+)/i);
    if (!bm)
      return null;
    const chunks = got.text.split("--" + bm[1]);
    let frame = null;
    const bins = [];
    for (const raw of chunks) {
      let part = raw;
      if (part.startsWith("--"))
        break;
      if (part.startsWith("\r\n"))
        part = part.slice(2);
      else if (part.startsWith("\n"))
        part = part.slice(1);
      if (!part.trim())
        continue;
      const sep = part.indexOf("\r\n\r\n");
      const sepN = part.indexOf("\n\n");
      const splitAt = sep >= 0 ? sep : sepN;
      if (splitAt < 0)
        continue;
      const head = part.slice(0, splitAt);
      let body = part.slice(splitAt + (sep >= 0 ? 4 : 2));
      if (body.endsWith("\r\n"))
        body = body.slice(0, -2);
      else if (body.endsWith("\n"))
        body = body.slice(0, -1);
      const partCt = ((head.match(/content-type:\s*([^\r\n;]+)/i) || [])[1] || "").trim();
      const binSha = ((head.match(/x-foobarch-bin:\s*([^\r\n]+)/i) || [])[1] || "").trim().toLowerCase();
      if (binSha) {
        if (await this.sha256Hex(body) !== binSha)
          continue;
        bins.push({
          sha: binSha,
          media: body,
          mime: partCt || "application/octet-stream"
        });
        continue;
      }
      if (/application\/eframe|ibgib\+json/i.test(partCt) || /content-id:\s*<eframe>/i.test(head)) {
        try {
          frame = asFrame(JSON.parse(body)) || frame;
        } catch {
        }
      }
    }
    return frame ? { frame, bins } : null;
  }
  async fetchHostModuleMedia(ib) {
    const want = canonicalizeTipIb(ib) || String(ib || "").trim();
    if (!want)
      return null;
    const got = await this.fetchHostParkGet(
      want,
      "application/navi-module, application/javascript, text/javascript"
    );
    if (!got)
      return null;
    if (got.ct.includes("eframe") || got.ct.includes("ibgib+json") || got.ct.includes("multipart/") || got.ct.includes("navi-mod") && !got.ct.includes("navi-module") || got.ct.includes("application/json") && !got.ct.includes("navi-module")) {
      return null;
    }
    if (got.ct.includes("text/html")) {
      return null;
    }
    return got.text;
  }
  async fetchWarezSubjectMedia(tip) {
    if (!tip?.data || typeof fetch !== "function")
      return null;
    const about = tip.data.about && typeof tip.data.about === "object" ? tip.data.about : null;
    const raw = String(
      about?.warez_subject || about?.subject_ib || ""
    ).trim();
    if (!raw)
      return null;
    const subject = raw.replace(/^flowerpot\//i, "").replace(/^\/+/, "");
    if (!subject)
      return null;
    const tryUrls = [
      this.resolveUrl(`flowerpot/${subject}`),
      `https://foobarch.net/flowerpot/${subject}`
    ];
    for (const url of tryUrls) {
      try {
        const res = await fetch(encodeURI(url), {
          method: "GET",
          headers: {
            Accept: "application/navi-module, application/javascript, text/javascript"
          },
          cache: "no-store"
        });
        if (!res.ok)
          continue;
        const ct = String(
          res.headers.get("content-type") || ""
        ).toLowerCase();
        if (ct.includes("ibgib+json") || ct.includes("application/json") || ct.includes("text/html")) {
          continue;
        }
        const text = await res.text();
        if (text && text.trim())
          return text;
      } catch {
      }
    }
    return null;
  }
  hostPlantKinds(method) {
    const base = ["mod", "bin", "surface", "relay", "navi_root"];
    return method === "POST" ? [...base, "frame"] : base;
  }
  async plantHostTip(ib, opts) {
    const want = canonicalizeTipIb(ib) || String(ib || "").trim();
    if (!want)
      return null;
    const forceRefresh = !!opts?.forceRefresh;
    const method = normalizeParkMethod(opts?.method, "GET");
    const plantKinds = this.hostPlantKinds(method);
    if (!forceRefresh) {
      const existing = await this.getTip(want);
      if (existing?.data) {
        const ek = String(
          parkMethodCtrl(existing, method)?.kind || ""
        ).toLowerCase();
        return plantKinds.includes(ek) ? existing : null;
      }
    }
    if (method === "POST") {
      const snap = await this.fetchHostFrameSnapshot(want, opts?.wantShas);
      const snapIb = snap ? canonicalizeTipIb(String(snap.frame.ib || "")) : "";
      const snapKind = snap ? String(parkMethodCtrl(snap.frame, method)?.kind || "").toLowerCase() : "";
      if (snap && snapIb === want && snapKind && snapKind !== "mod" && plantKinds.includes(snapKind)) {
        for (const b of snap.bins) {
          await this.putBin(b.sha, { media: b.media, mime: b.mime });
        }
        const next2 = {
          ...snap.frame,
          ib: want,
          gib: "",
          rel8ns: {
            ...snap.frame.rel8ns || {},
            past: Array.isArray(snap.frame.rel8ns?.past) ? snap.frame.rel8ns.past : [],
            tjp: Array.isArray(snap.frame.rel8ns?.tjp) ? snap.frame.rel8ns.tjp : [],
            dna: Array.isArray(snap.frame.rel8ns?.dna) ? snap.frame.rel8ns.dna : [],
            bin: Array.isArray(snap.frame.rel8ns?.bin) ? snap.frame.rel8ns.bin.slice() : []
          }
        };
        await this.setTip(next2);
        return await this.getTip(want) || next2;
      }
      if (snap && snapIb && snapIb !== want)
        return null;
    }
    const frameIbMismatch = (frame2) => {
      const fib = canonicalizeTipIb(String(frame2?.ib || ""));
      return !!fib && fib !== want;
    };
    const pkg = await this.fetchHostModPackage(want);
    if (pkg && frameIbMismatch(pkg.frame))
      return null;
    if (pkg) {
      await this.putBin(pkg.sha, {
        media: pkg.media,
        mime: pkg.mime
      });
      const hostBin = Array.isArray(pkg.frame.rel8ns?.bin) ? pkg.frame.rel8ns.bin.slice() : [`bin ${pkg.sha}`];
      const next2 = {
        ...pkg.frame,
        ib: want,
        gib: "",
        data: {
          ...pkg.frame.data,
          content_type: pkg.frame.data?.content_type || pkg.mime
        },
        rel8ns: {
          ...pkg.frame.rel8ns || {},
          past: Array.isArray(pkg.frame.rel8ns?.past) ? pkg.frame.rel8ns.past : [],
          tjp: Array.isArray(pkg.frame.rel8ns?.tjp) ? pkg.frame.rel8ns.tjp : [],
          dna: Array.isArray(pkg.frame.rel8ns?.dna) ? pkg.frame.rel8ns.dna : [],
          bin: hostBin.length ? hostBin : [`bin ${pkg.sha}`]
        }
      };
      await this.setTip(next2);
      return await this.getTip(want) || next2;
    }
    const frame = await this.fetchHostTipFrame(want);
    if (!frame?.data)
      return null;
    if (frameIbMismatch(frame))
      return null;
    const ctrl = parkMethodCtrl(frame, "GET");
    const kind = String(ctrl?.kind || "").toLowerCase();
    if (kind !== "mod" && kind !== "bin" && kind !== "surface" && kind !== "relay" && kind !== "navi_root") {
      return null;
    }
    let next = { ...frame, ib: want };
    next.rel8ns = {
      ...frame.rel8ns || {},
      past: Array.isArray(frame.rel8ns?.past) ? frame.rel8ns.past : [],
      tjp: Array.isArray(frame.rel8ns?.tjp) ? frame.rel8ns.tjp : [],
      dna: Array.isArray(frame.rel8ns?.dna) ? frame.rel8ns.dna : [],
      bin: Array.isArray(frame.rel8ns?.bin) ? frame.rel8ns.bin.slice() : []
    };
    if (kind === "mod" || kind === "bin") {
      let media = await this.fetchHostModuleMedia(want);
      if (!media)
        media = await this.fetchWarezSubjectMedia(next);
      if (media) {
        const mime = String(
          next.data?.content_type || next.data?.mime || "application/navi-module"
        ) || "application/navi-module";
        const hostSha = String(next.rel8ns.bin?.[0] || "").replace(/^bin\s+/i, "").trim().toLowerCase();
        const sha = hostSha || await this.sha256Hex(media);
        await this.putBin(sha, { media, mime });
        next.rel8ns.bin = [`bin ${sha}`];
        next.data = {
          ...next.data,
          content_type: next.data?.content_type || "application/navi-module"
        };
      }
    }
    next.gib = "";
    await this.setTip(next);
    return await this.getTip(want) || next;
  }
  async tryHostParkPin(workIb, method, opts) {
    const rawSegs = ibSegments(workIb);
    if (!rawSegs.length)
      return null;
    const forceRefresh = !!opts?.forceRefresh;
    const dispatchKinds = method === "POST" ? ["mod", "surface", "relay", "navi_root", "frame", "bin"] : ["mod", "surface", "relay", "navi_root"];
    for (let len = rawSegs.length; len >= 1; len--) {
      const prefix = rawSegs.slice(0, len).join("/");
      const planted = await this.plantHostTip(prefix, {
        forceRefresh,
        method
      });
      if (!planted?.data)
        continue;
      if (len < rawSegs.length && !this.isParkCapture(planted))
        continue;
      const ctrl = parkMethodCtrl(planted, method);
      const kind = String(ctrl?.kind || "").toLowerCase();
      if (!dispatchKinds.includes(kind)) {
        continue;
      }
      const args = rawSegs.slice(len).map((s) => {
        try {
          return decodeURIComponent(s);
        } catch {
          return s;
        }
      });
      return {
        tip: planted,
        tipIb: planted.ib || prefix,
        args
      };
    }
    return null;
  }
  async resolveModParkCapture(rawIb, dispatch) {
    const method = dispatch.method;
    const index = await this.getTip(NAVI_MOD_INDEX_IB);
    const parks = Array.isArray(index?.data?.parks) ? index.data.parks : [];
    const rawSegs = ibSegments(rawIb);
    if (!rawSegs.length)
      return null;
    const candidates = [];
    const seen = /* @__PURE__ */ new Set();
    const consider = (parkIbRaw) => {
      const parkIb = normalizeTipIb(parkIbRaw);
      if (!parkIb || seen.has(parkIb))
        return;
      const parkSegs = ibSegments(parkIb);
      if (!parkSegs.length || parkSegs.length > rawSegs.length || !parkSegs.every((s, i) => s === rawSegs[i])) {
        return;
      }
      seen.add(parkIb);
      candidates.push({
        parkIb,
        remainder: rawSegs.slice(parkSegs.length),
        len: parkSegs.length
      });
    };
    for (const p of parks) {
      consider(String(p?.ib || ""));
    }
    const minLen = rawSegs[0] === "navi" ? 2 : 1;
    for (let len = rawSegs.length; len >= minLen; len--) {
      consider(rawSegs.slice(0, len).join(":"));
      consider(rawSegs.slice(0, len).join("/"));
      consider(rawSegs.slice(0, len).join(" "));
    }
    candidates.sort((a, b) => b.len - a.len);
    for (const best of candidates) {
      const tip = await this.getTip(best.parkIb);
      if (!tip?.data || !this.isParkCapture(tip))
        continue;
      const ctrl = parkMethodCtrl(tip, method);
      const kind = String(ctrl?.kind || "").toLowerCase();
      if (!kind)
        continue;
      const args = best.remainder.map((s) => {
        try {
          return decodeURIComponent(s);
        } catch {
          return s;
        }
      });
      return {
        tipIb: tip.ib || best.parkIb,
        tip,
        args,
        kind
      };
    }
    return null;
  }
  coerceParkBody(result, opts) {
    if (result == null) {
      return { media: "", mime: "text/plain; charset=utf-8" };
    }
    if (typeof result === "string") {
      return { media: result, mime: "text/plain; charset=utf-8" };
    }
    if (typeof result === "object" && typeof result.media === "string") {
      return {
        media: result.media,
        mime: String(result.mime || "application/octet-stream")
      };
    }
    try {
      return {
        media: opts?.compact ? JSON.stringify(result) : JSON.stringify(result, null, 2),
        mime: "application/json; charset=utf-8"
      };
    } catch {
      return { media: String(result), mime: "text/plain; charset=utf-8" };
    }
  }
  normalizeRelayHost(raw) {
    const h = String(raw ?? "").trim();
    if (!h || h === "-" || /^none$/i.test(h) || /^clear$/i.test(h)) {
      return "";
    }
    return h;
  }
  async loadRelayPrefs() {
    const raw = await this.shimItemGet("relay");
    const o = raw && typeof raw === "object" ? raw : {};
    const parksRaw = o.parks && typeof o.parks === "object" ? o.parks : {};
    const parks = {};
    for (const [k, v] of Object.entries(parksRaw)) {
      const ib = String(v || "").trim();
      if (ib)
        parks[String(k).trim()] = ib;
    }
    const legacyIb = String(o.advertisedIb || "").trim();
    const alias = String(o.alias || o.nick || "").trim();
    if (legacyIb && alias && !parks[alias]) {
      parks[alias] = legacyIb;
    }
    const framesRaw = o.frames && typeof o.frames === "object" ? o.frames : {};
    const frames = {};
    for (const [k, v] of Object.entries(framesRaw)) {
      if (!v || typeof v !== "object")
        continue;
      const row = v;
      const ib = String(row.ib || "").trim();
      const frame = row.frame;
      if (ib && frame && typeof frame === "object") {
        frames[String(k).trim()] = {
          ib,
          addr: String(row.addr || "").trim() || void 0,
          frame
        };
      }
    }
    const aliasTokens = {};
    if (o.aliasTokens && typeof o.aliasTokens === "object") {
      for (const [k, v] of Object.entries(o.aliasTokens)) {
        const t = String(v || "").trim();
        if (t)
          aliasTokens[String(k).trim()] = t;
      }
    }
    const rawHost = String(o.host || "").trim();
    const host = this.normalizeRelayHost(rawHost);
    if (rawHost && rawHost !== host) {
      void this.shimItemSet("relay", {
        ...o,
        host,
        token: String(o.token || "").trim(),
        alias,
        expiresSec: Number(o.expiresSec) > 0 ? Math.floor(Number(o.expiresSec)) : DEFAULT_RELAY_EXPIRES_SEC,
        parks,
        frames,
        aliasTokens
      });
    }
    return {
      host,
      token: String(o.token || "").trim(),
      alias,
      expiresSec: Number(o.expiresSec) > 0 ? Math.floor(Number(o.expiresSec)) : DEFAULT_RELAY_EXPIRES_SEC,
      parks,
      frames,
      aliasTokens
    };
  }
  async saveRelayPrefs(patch) {
    const cur = await this.loadRelayPrefs();
    const host = this.normalizeRelayHost(patch.host ?? cur.host);
    await this.shimItemSet("relay", {
      host,
      token: patch.token ?? cur.token,
      alias: patch.alias ?? cur.alias,
      expiresSec: patch.expiresSec ?? cur.expiresSec,
      parks: patch.parks ? { ...cur.parks, ...patch.parks } : cur.parks,
      frames: patch.frames ? { ...cur.frames, ...patch.frames } : cur.frames,
      aliasTokens: patch.aliasTokens ?? cur.aliasTokens
    });
    if (patch.host != null || host !== this.relayHost) {
      this.relayHost = host;
    }
    if (patch.token != null)
      this.relayToken = String(patch.token);
    if (patch.alias != null)
      this.relayAlias = String(patch.alias);
  }
  relayExpiresAt(expiresSec) {
    const sec = Math.max(
      60,
      Math.floor(expiresSec || DEFAULT_RELAY_EXPIRES_SEC)
    );
    return naviStampTime(new Date(Date.now() + sec * 1e3));
  }
  async ensureRelayLogTip() {
    let tip = await this.getTip(NAVI_RELAY_LOG_IB);
    if (!tip?.data) {
      tip = await this.stampTipFrame({
        ib: NAVI_RELAY_LOG_IB,
        gib: "",
        data: {
          parts: ["ibgib_frame", "manifest", "json"],
          about: {
            label: NAVI_RELAY_LOG_IB,
            description: "relay event log \u2014 unbounded delta tip (one event per mut8; lineage via past)"
          }
        },
        rel8ns: { past: [], tjp: [], dna: [] }
      });
      await this.setTip(tip);
    }
    return tip;
  }
  formatRelayEventRow(row) {
    return JSON.stringify({
      at: row.at,
      kind: row.kind,
      ...row.alias != null ? { alias: row.alias } : {},
      ...row.ib != null ? { ib: row.ib } : {},
      ...row.remainder != null ? { remainder: row.remainder } : {},
      ...row.method != null ? { method: row.method } : {},
      ...row.path != null ? { path: row.path } : {},
      ...row.headers != null ? { headers: row.headers } : {},
      ...row.ok != null ? { ok: row.ok } : {},
      ...row.error != null ? { error: row.error } : {}
    });
  }
  extractRelayEvent(frame) {
    const ev = frame?.data?.event;
    return ev && typeof ev === "object" ? ev : null;
  }
  async logRelayUse(kind, detail = {}) {
    try {
      const tip = await this.ensureRelayLogTip();
      const event = {
        at: naviStamp.time(),
        kind: String(kind || "").trim() || "event",
        ...detail
      };
      const patch = { event };
      if (tip.data?.parts)
        patch.parts = tip.data.parts;
      if (tip.data?.about)
        patch.about = tip.data.about;
      await this.mut8Tip(tip, patch, { replaceData: true });
    } catch (err) {
      this.callout(
        "[navi] relay log failed: " + formatCalloutMessage(err)
      );
    }
  }
  async ensureCallinLogTip() {
    let tip = await this.getTip(NAVI_CALLIN_IB);
    if (!tip?.data) {
      tip = await this.stampTipFrame({
        ib: NAVI_CALLIN_IB,
        gib: "",
        data: {
          parts: ["ibgib_frame", "manifest", "json"],
          about: {
            label: NAVI_CALLIN_IB,
            description: "callin event log \u2014 unbounded delta tip (one callin per mut8; lineage via past)"
          }
        },
        rel8ns: { past: [], tjp: [], dna: [] }
      });
      await this.setTip(tip);
    }
    return tip;
  }
  async logCallin(detail = {}) {
    try {
      const tip = await this.ensureCallinLogTip();
      const event = {
        at: naviStamp.time(),
        ...detail
      };
      const patch = { event };
      if (tip.data?.parts)
        patch.parts = tip.data.parts;
      if (tip.data?.about)
        patch.about = tip.data.about;
      await this.mut8Tip(tip, patch, { replaceData: true });
    } catch (err) {
      this.callout(
        "[navi] callin log failed: " + formatCalloutMessage(err)
      );
    }
  }
  async relayLogTail(limit = 10) {
    const ib = NAVI_RELAY_LOG_IB;
    const want = Math.max(1, limit);
    const hits = await this.tipSpan(ib, {
      dir: "reverse",
      limit: want
    });
    const events = hits.map((h) => this.extractRelayEvent(h.frame)).filter((row) => !!row);
    if (!events.length) {
      const tip = await this.getTip(ib);
      const legacy = Array.isArray(tip?.data?.events) ? tip.data.events : [];
      if (!legacy.length)
        return "relay log (empty)";
      const tail = legacy.slice(-want);
      return [
        `relay log (last ${tail.length}/${legacy.length}, legacy snapshot)`,
        ...tail.map((row) => this.formatRelayEventRow(row))
      ].join("\n");
    }
    const total = (await this.listTipFrames(ib)).length || events.length;
    return [
      `relay log (last ${events.length}/${total})`,
      ...events.map((row) => this.formatRelayEventRow(row))
    ].join("\n");
  }
  relayHostBase(host) {
    const base = this.normalizeRelayHost(host) || this.normalizeRelayHost(this.origin);
    if (!base) {
      throw new Error(
        "relay host empty \u2014 run relay host <url> or set navi.origin"
      );
    }
    const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(base) ? base : `https://${base}`;
    return withScheme.replace(/\/+$/, "");
  }
  relayRequireOpen() {
    if (!this.relayWs || this.relayWs.readyState !== 1) {
      throw new Error(
        "relay not connected \u2014 run relay connect first"
      );
    }
  }
  relayRequestId() {
    return naviStamp.uuid().replace(/-/g, "").slice(0, 16);
  }
  relayRequest(msg, timeoutMs = 15e3) {
    this.relayRequireOpen();
    const id = this.relayRequestId();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.relayPending.delete(id);
        reject(new Error("relay request timeout"));
      }, timeoutMs);
      this.relayPending.set(id, { resolve, reject, timer });
      this.relaySend({ ...msg, id });
    });
  }
  relayResolvePending(msg) {
    const id = String(msg?.id || "");
    if (!id)
      return;
    const pending = this.relayPending.get(id);
    if (!pending)
      return;
    clearTimeout(pending.timer);
    this.relayPending.delete(id);
    if (msg.ok === false) {
      pending.reject(new Error(String(msg.error || "relay failed")));
      return;
    }
    pending.resolve(msg);
  }
  relayWsUrl(host, uuid, token) {
    const u = new URL(`${this.relayHostBase(host)}/_foobarch/navi_shell`);
    u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
    u.searchParams.set("uuid", uuid);
    if (token)
      u.searchParams.set("token", token);
    return u.toString();
  }
  relaySend(obj) {
    if (!this.relayWs || this.relayWs.readyState !== 1)
      return;
    this.relayWs.send(JSON.stringify(obj));
  }
  clearRelayReconnectTimer() {
    if (this.relayReconnectTimer) {
      clearTimeout(this.relayReconnectTimer);
      this.relayReconnectTimer = null;
    }
  }
  stopRelayKeepalive() {
    if (this.relayKeepaliveTimer) {
      clearInterval(this.relayKeepaliveTimer);
      this.relayKeepaliveTimer = null;
    }
  }
  startRelayKeepalive() {
    this.stopRelayKeepalive();
    this.relayKeepaliveTimer = setInterval(() => {
      if (!this.relayWs || this.relayWs.readyState !== 1)
        return;
      this.relaySend({ type: "hello", uuid: this.installUuid || "" });
    }, RELAY_KEEPALIVE_MS);
  }
  rejectRelayPending(reason) {
    for (const pending of this.relayPending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    this.relayPending.clear();
  }
  scheduleRelayReconnect(reason) {
    if (!this.relayAutoReconnect || this.relayManualClose)
      return;
    if (this.relayReconnectTimer)
      return;
    const delay = Math.min(
      RELAY_RECONNECT_MAX_MS,
      RELAY_RECONNECT_BASE_MS * 2 ** this.relayReconnectAttempt
    );
    this.relayReconnectAttempt += 1;
    this.callout(
      `[navi] relay reconnect in ${Math.round(delay / 1e3)}s (${reason})`
    );
    this.relayReconnectTimer = setTimeout(() => {
      this.relayReconnectTimer = null;
      void this.relayConnectAuto();
    }, delay);
  }
  async relayConnectAuto() {
    if (!this.relayAutoReconnect || this.relayManualClose)
      return;
    if (this.relayWs && this.relayWs.readyState === 1)
      return;
    try {
      await this.openRelaySocket();
    } catch (err) {
      if (err?.code === "NO_TOKENS") {
        this.relayAutoReconnect = false;
        this.callout(
          `[navi] relay stays down: ${formatCalloutMessage(err)}, then relay connect`
        );
        return;
      }
      this.callout(
        `[navi] relay reconnect failed: ${formatCalloutMessage(err)}`
      );
      this.scheduleRelayReconnect("retry");
    }
  }
  clearRelayWelcomeTimer() {
    if (this.relayWelcomeTimer) {
      clearTimeout(this.relayWelcomeTimer);
      this.relayWelcomeTimer = null;
    }
  }
  returnRelayPay(ws, why) {
    const pay = this.relayPay;
    if (!pay || pay.ws !== ws)
      return;
    this.relayPay = null;
    this.clearRelayWelcomeTimer();
    void this.tokens.giveBack(pay.host, pay.token).then(
      (n) => {
        if (why)
          this.callout(`[navi] relay token returned to stash (${why}; ${n} unused)`);
      },
      () => void 0
    );
  }
  onRelayWelcome(ws, msg) {
    const pay = this.relayPay && this.relayPay.ws === ws ? this.relayPay : null;
    this.clearRelayWelcomeTimer();
    this.relayPay = null;
    if (msg.ok) {
      if (!pay)
        return;
      void this.tokens.count(pay.host).then(
        (n) => this.callout(`[navi] relay connect paid 1 token (${pay.token.slice(0, 16)}\u2026; ${n} unused)`),
        () => void 0
      );
      return;
    }
    const error = String(msg.error || "relay refused");
    const status = Number(msg.status) || 0;
    if (pay && !/consumed|invalid usage token/i.test(error)) {
      void this.tokens.giveBack(pay.host, pay.token);
    }
    if (status === 403 && /owner/i.test(error)) {
      this.relayAutoReconnect = false;
    }
    this.callout(`[navi] relay refused (${status || "?"}): ${error}`);
  }
  async openRelaySocket() {
    const uuid = await this.getInstallUuid();
    if (!uuid)
      throw new Error("no navi install uuid \u2014 reseed navi tip");
    const WS = globalThis.WebSocket;
    if (typeof WS !== "function") {
      throw new Error("WebSocket not available in this runtime");
    }
    if (this.relayWs) {
      this.relayManualClose = true;
      try {
        this.relayWs.close();
      } catch {
      }
      this.relayWs = null;
    }
    this.relayManualClose = false;
    this.relayConnecting = true;
    this.relayHost = this.normalizeRelayHost(this.relayHost) || this.normalizeRelayHost(this.origin);
    const url = this.relayWsUrl(
      this.relayHost,
      uuid,
      this.relayToken
    );
    const owner = await this.relayOwnerSecret();
    const payHost = this.tokenStashOrigin(this.relayHost);
    let pay;
    try {
      pay = await this.tokens.take(payHost);
    } catch (err) {
      this.relayConnecting = false;
      throw err;
    }
    let ws;
    try {
      ws = new WS(url);
    } catch (err) {
      this.relayConnecting = false;
      await this.tokens.giveBack(payHost, pay);
      throw err;
    }
    this.relayPay = { ws, host: payHost, token: pay };
    this.attachRelaySocket(ws, owner);
  }
  relayTeardown(manual) {
    if (manual) {
      this.relayAutoReconnect = false;
      this.relayManualClose = true;
    }
    this.clearRelayReconnectTimer();
    this.stopRelayKeepalive();
    this.rejectRelayPending(
      manual ? "relay disconnected" : "relay socket closed"
    );
  }
  relayUseCallout(msg) {
    const method = String(msg.method || "").trim().toUpperCase() || "GET";
    const path = String(msg.path || "").trim() || `/${String(msg.remainder || "")}`;
    const lines = [
      `[navi] relay ${method} ${path}`,
      `at ${naviStamp.time()}`
    ];
    if (!msg.ok && msg.error) {
      lines.push(`error: ${msg.error}`);
    }
    this.callout(lines.join("\n"));
  }
  relayFailStatus(error) {
    const low = String(error || "").toLowerCase();
    if (low.includes("empty remainder"))
      return 400;
    if (low.includes("blocked from relay") || low.includes("privileged")) {
      return 403;
    }
    if (low.includes("no navi park"))
      return 404;
    return 502;
  }
  async handleRelayCallin(msg) {
    const id = String(msg.id || "");
    const remainder = String(msg.remainder || "").replace(/^\/+/, "").trim();
    const method = normalizeParkMethod(msg.method || "GET", "GET");
    const path = String(msg.path || "").trim();
    const body = msg.body == null ? "" : String(msg.body);
    const headers = msg.headers && typeof msg.headers === "object" ? { ...msg.headers } : {};
    const relayAlias = String(msg.alias || "").trim() || (path.match(/^\/?navi-([a-zA-Z0-9._-]+)/)?.[1] ?? "");
    try {
      if (!remainder) {
        const uuid = await this.getInstallUuid();
        const prefs = await this.loadRelayPrefs();
        const payload = {
          ok: true,
          ping: true,
          uuid: uuid || null,
          alias: String(prefs.alias || this.relayAlias || "").trim() || null,
          host: String(
            this.relayHost || prefs.host || this.origin || ""
          ).trim() || null,
          at: new Date().toISOString()
        };
        const media2 = JSON.stringify(payload);
        this.relayUseCallout({ ...msg, remainder: "", ok: true });
        void this.logRelayUse("callin", {
          remainder: "",
          method,
          path: path || void 0,
          ok: true,
          ping: true
        });
        this.relaySend({
          type: "result",
          id,
          ok: true,
          media: media2,
          mime: "application/json; charset=utf-8"
        });
        return;
      }
      this.relayUseCallout({ ...msg, remainder, ok: true });
      const result = await this.dispatchCallin({
        path: remainder,
        method,
        headers,
        body,
        viaRelay: true,
        relayAlias
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      const { media, mime } = this.coerceParkBody(result, { compact: true });
      void this.logRelayUse("callin", {
        remainder,
        method,
        path: path || void 0,
        headers: msg.headers,
        body_bytes: body.length || void 0,
        ok: true
      });
      this.relaySend({ type: "result", id, ok: true, media, mime });
    } catch (err) {
      const error = formatCalloutMessage(err);
      const status = this.relayFailStatus(error);
      const media = JSON.stringify(
        {
          error,
          via: "navi_shell",
          method,
          path: path || void 0,
          remainder
        },
        null,
        2
      );
      void this.logRelayUse("callin", {
        remainder,
        method,
        path: path || void 0,
        headers: msg.headers,
        body_bytes: body.length || void 0,
        ok: false,
        error
      });
      this.relayUseCallout({ ...msg, remainder, ok: false, error });
      this.relaySend({
        type: "result",
        id,
        ok: false,
        error,
        status,
        media,
        mime: "application/json; charset=utf-8"
      });
    }
  }
  bindRelayPageLifecycle() {
    if (this.relayPageLifecycleBound || !isBrowserDocument())
      return;
    this.relayPageLifecycleBound = true;
    window.addEventListener("pagehide", (ev) => {
      if (!ev.persisted || !this.relayAutoReconnect)
        return;
      this.clearRelayReconnectTimer();
      const ws = this.relayWs;
      if (!ws || ws.readyState > 1)
        return;
      this.relayManualClose = true;
      try {
        ws.close(1e3, "page hidden");
      } catch {
      }
    });
    window.addEventListener("pageshow", (ev) => {
      if (!ev.persisted || !this.relayAutoReconnect)
        return;
      this.relayManualClose = false;
      this.relayReconnectAttempt = 0;
      this.clearRelayReconnectTimer();
      void this.relayConnectAuto();
    });
  }
  attachRelaySocket(ws, owner) {
    this.bindRelayPageLifecycle();
    this.relayWs = ws;
    ws.addEventListener("open", () => {
      this.relayConnecting = false;
      this.relayReconnectAttempt = 0;
      this.clearRelayReconnectTimer();
      const pay = this.relayPay && this.relayPay.ws === ws ? this.relayPay.token : "";
      this.relaySend({ type: "hello", uuid: this.installUuid || "", owner, pay });
      this.clearRelayWelcomeTimer();
      this.relayWelcomeTimer = setTimeout(() => {
        this.relayWelcomeTimer = null;
        this.returnRelayPay(ws, "host did not charge for connect (older host)");
      }, RELAY_WELCOME_MS);
      this.startRelayKeepalive();
      const reconnect = this.relayEverConnected;
      this.relayEverConnected = true;
      void this.logRelayUse(reconnect ? "reconnect" : "connect", {
        host: this.relayHost,
        token: this.relayToken ? "(set)" : "(none)"
      });
      this.callout(
        reconnect ? `[navi] relay reconnected ${this.relayHost}` : `[navi] relay connected ${this.relayHost}`
      );
    });
    ws.addEventListener("message", (ev) => {
      let msg;
      try {
        msg = JSON.parse(String(ev.data || ""));
      } catch {
        return;
      }
      if (msg && msg.type === "welcome") {
        this.onRelayWelcome(ws, msg);
        return;
      }
      if (msg && msg.type === "result" && msg.id) {
        this.relayResolvePending(msg);
        return;
      }
      if (msg && msg.type === "callin") {
        setTimeout(() => {
          void this.handleRelayCallin(msg);
        }, 0);
      }
    });
    ws.addEventListener("close", () => {
      this.returnRelayPay(ws, "socket closed before the host answered");
      if (this.relayWs !== ws)
        return;
      this.relayWs = null;
      this.relayConnecting = false;
      this.stopRelayKeepalive();
      const manual = this.relayManualClose;
      this.rejectRelayPending(
        manual ? "relay disconnected" : "relay socket closed"
      );
      if (!manual) {
        void this.logRelayUse("disconnect", { host: this.relayHost });
        this.callout("[navi] relay disconnected");
        this.scheduleRelayReconnect("socket closed");
      }
      this.relayManualClose = false;
    });
    ws.addEventListener("error", () => {
      if (this.relayWs !== ws)
        return;
      this.callout("[navi] relay socket error");
      this.scheduleRelayReconnect("socket error");
    });
  }
  async adminRelayStatus() {
    const uuid = await this.getInstallUuid();
    const prefs = await this.loadRelayPrefs();
    const state = this.relayWs && this.relayWs.readyState === 1 ? "connected" : this.relayConnecting ? "connecting" : "disconnected";
    return [
      `relay ${state}`,
      `channel ${state === "disconnected" ? "none" : "ws"}`,
      `uuid ${uuid || "(none)"}`,
      `host ${prefs.host || this.origin}`,
      `alias ${prefs.alias || "(none)"}`,
      `token ${prefs.token ? prefs.token.slice(0, 8) + "\u2026" : "(none)"}`,
      `expires ${prefs.expiresSec}s`,
      `parks ${Object.keys(prefs.parks).length ? JSON.stringify(prefs.parks) : "(none)"}`,
      `alias tokens ${Object.keys(prefs.aliasTokens).join(", ") || "(none)"}`,
      `usage tokens ${await this.tokens.count(prefs.host || this.origin).catch(() => "?")} unused (1 spent per connect)`,
      `whitelist ${(await this.loadRelayWhitelist()).on ? "ON (relay whitelist)" : "off"}`
    ].join("\n");
  }
  sanitizeRelayAlias(raw) {
    const alias = String(raw || "").trim();
    if (!alias || alias === "-" || alias === "none")
      return "";
    if (/[\s/:]/.test(alias)) {
      throw new Error(
        "relay alias must not contain spaces, /, or : (e.g. phone, laptop)"
      );
    }
    return alias;
  }
  parseRelayConnectArgs(args) {
    let token = String(args[1] ?? "").trim();
    let alias = String(args[2] || "").trim();
    if (token && (isAbsoluteHttpUrl(token) || /^[a-z][a-z0-9+.-]*:\/\//i.test(token) || /^[a-z0-9.-]+\.[a-z]{2,}(?::\d+)?$/i.test(token) && !/^(new|clear|none|-)$/i.test(token))) {
      token = String(args[2] ?? "").trim();
      alias = String(args[3] || "").trim();
    }
    if (token === "-" || token === "none")
      token = "";
    if (alias === "-" || alias === "none")
      alias = "";
    if (token && !alias) {
      const tokenShaped = token === "new" || token.length >= 32 || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        token
      );
      if (!tokenShaped) {
        alias = token;
        token = "";
      }
    }
    return { token, alias };
  }
  relayAdvertiseFrame(alias, uuid, expiresSec, tokenSha = "") {
    const leaf = `navi-${alias}`;
    const relay_expires_at = this.relayExpiresAt(expiresSec);
    return {
      ib: leaf,
      data: {
        parts: ["network_proposal", "ibgib_frame", "manifest", "json"],
        park: "capture",
        default_method: "GET",
        navi_shell_uuid: uuid,
        relay_expires_at,
        ...tokenSha ? { relay_token_sha256: tokenSha } : {},
        method: {
          GET: { kind: "navi_shell", target: uuid, mode: "async" },
          POST: { kind: "navi_shell", target: uuid, mode: "async" }
        },
        about: {
          label: `navi_shell relay ${alias}`,
          description: "GET or POST remainder is a navi park path under navi/ (e.g. surf/browse/horizon/enter \u2192 navi/surf/\u2026). Bare /navi-{alias}/ returns an inherent ping JSON. Header X-Navi-Shell-Usage-Token: the alias token when relay_token_sha256 is set, else the shell token if the shell registered with one. Host rejects callins after relay_expires_at."
        }
      },
      rel8ns: { past: [], tjp: [], dna: [] }
    };
  }
  async relayCallin(args) {
    const sub = String(args[0] || "help").trim().toLowerCase();
    if (sub === "help" || sub === "-h") {
      return [
        "relay \u2014 foobarch host park callins (HTTP) + reverse websocket",
        "",
        "  relay status",
        "  relay host [url|origin]     show / set host (fallback navi.origin)",
        "  relay token [new|<token>|clear]",
        "  relay expire [seconds]     default park TTL for advertise (86400)",
        "  relay connect [token|-] [alias]   open websocket to saved relay host (spends 1 usage token)",
        "  relay tokens [add <token\u2026> | file <path>]   usage tokens stashed for the relay host (tip tokens)",
        '  relay whitelist [on|off|allow <path> [via <alias>]|drop <path> [via <alias>]]   limit which park paths relay callers may reach (default off; mods add theirs; "via" = only through that alias)',
        "  relay whitelist trust|untrust <alias>   callers holding that alias token skip the whitelist (needs relay alias-token <alias>)",
        "  relay disconnect            close websocket (prefs kept)",
        "  relay advertise <alias> [expiresSec]   needs connect; re-advertise after host/shell update",
        "  relay alias-token [<alias> [new|<token>|clear]]   per-alias callin token (host checks its sha256)",
        "  relay retire [alias]        tombstone stored park on host (needs connect)",
        "  relay log [count]           tail relay:log (lineage, delta/event frames)"
      ].join("\n");
    }
    if (sub === "status")
      return await this.adminRelayStatus();
    if (sub === "whitelist") {
      const verb = String(args[1] || "").trim().toLowerCase();
      const usage = "usage: relay whitelist [on|off|allow <park/path> [via <alias>]|drop <park/path> [via <alias>]|trust <alias>|untrust <alias>]";
      if (verb === "trust" || verb === "untrust") {
        const alias = this.sanitizeRelayAlias(String(args[2] || ""));
        if (!alias)
          return usage;
        const w = await this.loadRelayWhitelist();
        const trust = verb === "trust" ? [.../* @__PURE__ */ new Set([...w.trust, alias])] : w.trust.filter((a) => a !== alias);
        await this.saveRelayWhitelist({ trust });
        return await this.relayWhitelistText();
      }
      const rest = args.slice(2).map((a) => String(a));
      const viaAt = rest.findIndex((a) => a.toLowerCase() === "via");
      const path = relayWhitelistNorm((viaAt >= 0 ? rest.slice(0, viaAt) : rest).join("/"));
      const via = viaAt >= 0 ? this.sanitizeRelayAlias(rest[viaAt + 1] || "") : "";
      if (verb === "on")
        await this.relayWhitelist.on();
      else if (verb === "off")
        await this.relayWhitelist.off();
      else if (verb === "allow" || verb === "drop") {
        if (!path || viaAt >= 0 && !via)
          return usage;
        const w = await this.loadRelayWhitelist();
        const edit = (list) => verb === "allow" ? [.../* @__PURE__ */ new Set([...list, path])] : list.filter((p) => p !== path);
        if (via) {
          const nextVia = { ...w.via, [via]: edit(w.via[via] || []) };
          if (!nextVia[via].length)
            delete nextVia[via];
          await this.saveRelayWhitelist({ via: nextVia });
        } else {
          await this.saveRelayWhitelist({ paths: edit(w.paths) });
        }
      } else if (verb && verb !== "status") {
        return usage;
      }
      return await this.relayWhitelistText();
    }
    if (sub === "tokens") {
      const prefs = await this.loadRelayPrefs();
      const host = this.tokenStashOrigin(prefs.host || this.origin);
      const verb = String(args[1] || "").trim().toLowerCase();
      if (verb === "add") {
        const r = await this.tokens.add(host, args.slice(2));
        return `relay tokens ${host}: +${r.added} (${r.count} unused)`;
      }
      if (verb === "file") {
        const segs = args.slice(2).map((s) => String(s ?? "")).filter((s) => s !== "");
        if (!segs.length)
          return "usage: relay tokens file <path>  (one token per line)";
        const file = /^[A-Za-z]$/.test(segs[0]) && segs.length > 1 ? `${segs[0]}:${segs.slice(1).join("/")}` : /^(\.{1,2}|~)$/.test(segs[0]) ? segs.join("/") : "/" + segs.join("/");
        const text = String(this.require("fs").readFileSync(file, "utf8"));
        const r = await this.tokens.add(host, text);
        return `relay tokens ${host}: +${r.added} from ${file} (${r.count} unused) \u2014 delete the file now`;
      }
      if (verb)
        return "usage: relay tokens [add <token\u2026> | file <path>]";
      return `relay tokens ${host}: ${await this.tokens.count(host)} unused`;
    }
    if (sub === "host") {
      const next = String(args[1] || "").trim();
      if (!next) {
        const prefs = await this.loadRelayPrefs();
        return prefs.host || this.normalizeRelayHost(this.origin) || "(none)";
      }
      if (next === "-" || /^origin$/i.test(next) || /^clear$/i.test(next) || /^none$/i.test(next)) {
        await this.saveRelayPrefs({ host: "" });
        this.relayHost = this.normalizeRelayHost(this.origin);
        return `relay host ${this.relayHost || "(none)"} (navi.origin)`;
      }
      const host = this.normalizeRelayHost(next);
      if (!/^(?:https?|wss?):\/\//i.test(host)) {
        throw new Error(
          "relay host must start with http://, https://, ws://, or wss://"
        );
      }
      await this.saveRelayPrefs({ host });
      this.relayHost = host;
      return `relay host ${host}`;
    }
    if (sub === "log") {
      const n = Math.max(1, Number(args[1]) || 10);
      return await this.relayLogTail(n);
    }
    if (sub === "expire") {
      const raw = String(args[1] || "").trim();
      if (!raw) {
        const prefs = await this.loadRelayPrefs();
        return String(prefs.expiresSec);
      }
      const sec = Math.max(60, Math.floor(Number(raw) || 0));
      if (!Number.isFinite(sec) || sec < 60) {
        throw new Error(
          "relay expire requires seconds >= 60 (e.g. relay expire 3600)"
        );
      }
      await this.saveRelayPrefs({ expiresSec: sec });
      return `relay expire ${sec}s`;
    }
    if (sub === "token") {
      const next = String(args[1] || "").trim();
      if (!next) {
        const prefs = await this.loadRelayPrefs();
        return prefs.token || "(none)";
      }
      if (next === "clear" || next === "-" || next === "none") {
        await this.saveRelayPrefs({ token: "" });
        this.relayToken = "";
        return "relay token cleared";
      }
      const token = next === "new" ? naviStamp.uuid() : next;
      await this.saveRelayPrefs({ token });
      return `relay token set (${token.slice(0, 8)}\u2026)`;
    }
    if (sub === "disconnect") {
      this.relayTeardown(true);
      try {
        this.relayWs?.close();
      } catch {
      }
      this.relayWs = null;
      this.relayConnecting = false;
      void this.logRelayUse("disconnect", {
        host: this.relayHost,
        manual: true
      });
      return "relay disconnected";
    }
    if (sub === "advertise") {
      const uuid = await this.getInstallUuid();
      if (!uuid) {
        throw new Error(
          "no navi install uuid \u2014 run reseed force first"
        );
      }
      this.relayRequireOpen();
      const prefs = await this.loadRelayPrefs();
      const alias = this.sanitizeRelayAlias(args[1] || prefs.alias || "");
      if (!alias) {
        throw new Error(
          "relay advertise requires an alias (e.g. relay advertise vip)"
        );
      }
      const expiresArg = String(args[2] || "").trim();
      const expiresSec = expiresArg ? Math.max(60, Math.floor(Number(expiresArg) || 0)) : prefs.expiresSec;
      if (expiresArg && (!Number.isFinite(expiresSec) || expiresSec < 60)) {
        throw new Error(
          "relay advertise expiresSec must be >= 60 seconds"
        );
      }
      const aliasToken = prefs.aliasTokens[alias] || "";
      const tokenSha = aliasToken ? await this.sha256Hex(aliasToken) : "";
      const stamped = await this.stampTipFrame(
        this.relayAdvertiseFrame(alias, uuid, expiresSec, tokenSha)
      );
      let result;
      try {
        result = await this.relayRequest({
          type: "advertise",
          frame: stamped
        });
      } catch (err) {
        throw new Error(
          `relay advertise ${alias} failed: ${formatCalloutMessage(err)}`
        );
      }
      const ib = String(stamped.ib || `navi-${alias}`);
      const addr = String(result.addr || "").trim();
      if (!addr) {
        throw new Error(
          `relay advertise ${alias} failed: host returned no tip addr (commit did not land)`
        );
      }
      await this.saveRelayPrefs({
        alias,
        parks: { ...prefs.parks, [alias]: ib },
        frames: {
          ...prefs.frames,
          [alias]: { ib, addr, frame: stamped }
        }
      });
      void this.logRelayUse("advertise", {
        alias,
        ib,
        addr,
        relay_expires_at: stamped.data?.relay_expires_at
      });
      return `advertised ${ib} \u2192 ${addr} (expires ${stamped.data?.relay_expires_at})${tokenSha ? " [alias token required]" : ""}`;
    }
    if (sub === "alias-token") {
      const prefs = await this.loadRelayPrefs();
      const alias = this.sanitizeRelayAlias(args[1] || "");
      if (!alias) {
        const rows = Object.keys(prefs.aliasTokens);
        return rows.length ? rows.map((a) => `${a}: token set`).join("\n") : "no alias tokens (relay alias-token <alias> new)";
      }
      const next = String(args[2] || "").trim();
      if (!next) {
        const t = prefs.aliasTokens[alias];
        return t ? t : `${alias}: no alias token`;
      }
      const tokens = { ...prefs.aliasTokens };
      let msg;
      if (next === "clear" || next === "-" || next === "none") {
        delete tokens[alias];
        msg = `${alias}: alias token cleared`;
      } else {
        const token = next === "new" ? naviStamp.uuid() : next;
        tokens[alias] = token;
        msg = `${alias}: alias token set \u2192 ${token}`;
      }
      await this.saveRelayPrefs({ aliasTokens: tokens });
      if (prefs.parks[alias] && this.relayWs && this.relayWs.readyState === 1) {
        try {
          return `${msg}
${await this.relayCallin(["advertise", alias])}`;
        } catch (err) {
          return `${msg}
re-advertise failed (${formatCalloutMessage(err)}) \u2014 run relay advertise ${alias}`;
        }
      }
      return `${msg}
apply with: relay advertise ${alias}`;
    }
    if (sub === "retire") {
      this.relayRequireOpen();
      const prefs = await this.loadRelayPrefs();
      const alias = this.sanitizeRelayAlias(
        args[1] || prefs.alias || ""
      );
      if (!alias) {
        throw new Error(
          "relay retire [alias] \u2014 alias from arg or saved relay prefs"
        );
      }
      const stored = prefs.frames[alias];
      const ib = stored?.ib || prefs.parks[alias] || `navi-${alias}`;
      let result;
      try {
        result = await this.relayRequest({ type: "retire", ib });
      } catch (err) {
        throw new Error(
          `relay retire ${alias} failed: ${formatCalloutMessage(err)}`
        );
      }
      const addr = String(result.addr || "").trim();
      const parks = { ...prefs.parks };
      const frames = { ...prefs.frames };
      delete parks[alias];
      if (frames[alias]) {
        frames[alias] = {
          ib,
          addr: addr || frames[alias].addr,
          frame: {
            ...frames[alias].frame,
            data: {
              ...frames[alias].frame?.data || {},
              tombstone: true,
              retired: true
            }
          }
        };
      }
      await this.saveRelayPrefs({
        parks,
        frames,
        alias: prefs.alias === alias ? "" : prefs.alias
      });
      void this.logRelayUse("retire", { alias, ib, addr: addr || void 0 });
      return addr ? `retired ${ib} \u2192 ${addr}` : `retired ${ib}`;
    }
    if (sub === "connect") {
      const prefs = await this.loadRelayPrefs();
      const parsed = this.parseRelayConnectArgs(args);
      const host = this.normalizeRelayHost(prefs.host) || this.normalizeRelayHost(this.origin);
      if (!host) {
        throw new Error(
          "relay connect needs relay host <url> or navi.origin"
        );
      }
      const token = args[1] != null && String(args[1]).trim() !== "" ? parsed.token : prefs.token;
      const alias = parsed.alias || prefs.alias || "";
      const uuid = await this.getInstallUuid();
      if (!uuid)
        throw new Error("no navi install uuid \u2014 reseed navi tip");
      await this.saveRelayPrefs({ host, token, alias });
      this.relayHost = host;
      this.relayToken = token;
      this.relayAlias = alias;
      this.relayAutoReconnect = true;
      this.relayReconnectAttempt = 0;
      this.clearRelayReconnectTimer();
      await this.openRelaySocket();
      const url = this.relayWsUrl(host, uuid, token);
      const shown = token ? url.replace(/([?&])token=[^&]+/, "$1token=\u2026") : url;
      return `relay connecting ${shown} (paying 1 usage token)`;
    }
    if (sub === "connectws") {
      return [
        "relay connectws removed \u2014 use relay connect [token|-] [alias]",
        "set the host separately with relay host <url>"
      ].join("\n");
    }
    return `unknown relay subcommand: ${sub}

${await this.relayCallin(["help"])}`;
  }
  applyFoobarchPwaDefaultsIfRoot() {
    if (!isBrowserDocument()) {
      return;
    }
    const path = window.location.pathname;
    if (path !== "/" && path !== "") {
      return;
    }
    this.setPwa(FOOBARCH_PWA_DEFAULTS);
  }
  clearPwaManagedNodes() {
    if (!isBrowserDocument()) {
      return;
    }
    document.querySelectorAll(`[${PWA_MANAGED_ATTR}]`).forEach((node) => {
      node.remove();
    });
  }
  revokePwaBlobUrl() {
    if (this.pwaBlobUrl) {
      URL.revokeObjectURL(this.pwaBlobUrl);
      this.pwaBlobUrl = null;
    }
  }
  ensureManifestLink(href) {
    if (!isBrowserDocument()) {
      return;
    }
    let link = document.head.querySelector('link[rel="manifest"]');
    if (!link) {
      link = document.createElement("link");
      link.setAttribute("rel", "manifest");
      document.head.appendChild(link);
    }
    link.removeAttribute(PWA_MANAGED_ATTR);
    link.setAttribute("href", href);
  }
  publishPwaManifestToSw(manifest) {
    if (typeof navigator === "undefined" || !navigator.serviceWorker) {
      return;
    }
    const manifestJson = manifest == null ? null : JSON.stringify(manifest);
    void this.postToServiceWorker({
      type: "NAVI_PWA_MANIFEST",
      manifestJson
    }).catch((error) => {
      this.callout(
        "[navi.pwa] SW manifest publish failed: " + formatCalloutMessage(error)
      );
    });
  }
  upsertManagedMeta(name, content) {
    if (!isBrowserDocument()) {
      return;
    }
    let meta = document.head.querySelector(`meta[name="${name}"][${PWA_MANAGED_ATTR}]`);
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", name);
      meta.setAttribute(PWA_MANAGED_ATTR, "1");
      document.head.appendChild(meta);
    }
    meta.setAttribute("content", content);
  }
  upsertManagedLink(rel, href, extra = {}) {
    if (!isBrowserDocument()) {
      return;
    }
    let link = document.head.querySelector(`link[rel="${rel}"][${PWA_MANAGED_ATTR}]`);
    if (!link) {
      link = document.createElement("link");
      link.setAttribute("rel", rel);
      link.setAttribute(PWA_MANAGED_ATTR, "1");
      document.head.appendChild(link);
    }
    link.setAttribute("href", href);
    for (const [key, value] of Object.entries(extra)) {
      link.setAttribute(key, value);
    }
  }
  updateURL(config) {
    if (!isBrowserDocument() || config.replace_url === void 0 || config.replace_url === false) {
      return;
    }
    const targetPath = typeof config.replace_url === "string" ? config.replace_url : config.start_url;
    if (!targetPath) {
      return;
    }
    const normalized = targetPath.startsWith("/") ? targetPath : `/${targetPath}`;
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (current === normalized || window.location.pathname === normalized) {
      return;
    }
    window.history.replaceState(window.history.state, "", normalized);
  }
  setPwa(config) {
    if (!isBrowserDocument()) {
      this.callout("[navi.pwa] set ignored \u2014 browser document required");
      return;
    }
    const resolved = { ...config };
    if ((resolved.start_url == null || String(resolved.start_url).trim() === "") && typeof window !== "undefined") {
      resolved.start_url = window.location.pathname || "/";
    }
    this.revokePwaBlobUrl();
    this.clearPwaManagedNodes();
    this.pwaConfig = { ...resolved };
    const manifest = buildWebManifest(resolved);
    if (Object.keys(manifest).length === 0) {
      throw new Error("[navi-error] [navi-error]navi.pwa.set requires at least one manifest field");
    }
    const icons = resolved.icons ?? [];
    const badIcon = icons.find((icon) => /^(blob:|data:)/i.test(String(icon.src ?? "")));
    if (badIcon) {
      this.callout(
        "[navi.pwa] icon src must be same-origin http(s) path for installability (not blob:/data:)"
      );
    }
    this.pwaManifestRev += 1;
    this.ensureManifestLink(`/manifest.json?navi=${this.pwaManifestRev}`);
    this.publishPwaManifestToSw(manifest);
    const title = resolved.title ?? resolved.name;
    if (title) {
      document.title = title;
    }
    if (resolved.theme_color) {
      this.upsertManagedMeta("theme-color", resolved.theme_color);
      document.head.querySelectorAll('meta[name="theme-color"]').forEach((el) => {
        el.setAttribute("content", resolved.theme_color);
      });
    }
    const appName = resolved.short_name ?? resolved.name;
    if (appName) {
      this.upsertManagedMeta("application-name", appName);
    }
    const appleTitle = resolved.apple_mobile_web_app_title ?? resolved.short_name ?? resolved.name;
    if (appleTitle) {
      this.upsertManagedMeta("apple-mobile-web-app-title", appleTitle);
    }
    const appleCapable = resolved.apple_mobile_web_app_capable ?? true;
    if (appleCapable) {
      this.upsertManagedMeta("apple-mobile-web-app-capable", "yes");
      this.upsertManagedMeta("mobile-web-app-capable", "yes");
    }
    if (icons.length > 0) {
      const primaryIcon = icons[0];
      this.upsertManagedLink("icon", normalizePwaAssetUrl(primaryIcon.src), {
        type: primaryIcon.type ?? "image/png"
      });
    }
    const appleTouchIcon = pickAppleTouchIcon(icons);
    if (appleTouchIcon) {
      this.upsertManagedLink("apple-touch-icon", normalizePwaAssetUrl(appleTouchIcon.src), {
        ...appleTouchIcon.sizes ? { sizes: appleTouchIcon.sizes } : {}
      });
    }
    this.updateURL(resolved);
    this.emit("pwa", { action: "set", config: { ...resolved } });
    this.callout(
      `[navi.pwa] Applied PWA identity: ${resolved.name ?? resolved.short_name ?? "unnamed"} (start_url ${resolved.start_url})`
    );
    void this.ensureShellCache();
  }
  clearPwa() {
    this.revokePwaBlobUrl();
    this.clearPwaManagedNodes();
    this.pwaConfig = null;
    this.hostManifestHref = null;
    if (isBrowserDocument()) {
      this.ensureManifestLink("/manifest.json");
      this.publishPwaManifestToSw(null);
      this.emit("pwa", { action: "clear" });
    }
  }
  getPwaConfig() {
    return this.pwaConfig ? { ...this.pwaConfig } : null;
  }
  callout(data) {
    this.emit("callout", data);
  }
  require(id) {
    if (!isNodeRuntime()) {
      throw new Error("[navi-error] navi.require is Node/localnavi-only");
    }
    if (typeof id !== "string" || !id.trim()) {
      throw new Error("[navi-error] navi.require(id) needs a non-empty module id");
    }
    return require(id);
  }
  async resolveNaviCall(path, args) {
    let current = this;
    for (let i = 0; i < path.length - 1; i++) {
      const key = path[i];
      if (current == null || current[key] === void 0) {
        throw new Error(`Unknown navi path segment: ${path.slice(0, i + 1).join(".")}`);
      }
      current = current[key];
    }
    const methodName = path[path.length - 1];
    const method = current?.[methodName];
    if (typeof method !== "function") {
      throw new Error(`navi:${path.join(".")} is not callable`);
    }
    return await method.apply(current, args);
  }
  async dispatchCallin(input) {
    const req = this.normalizeCallinInput(input);
    this.emit("callin", req);
    const bodyBytes = req.body != null && String(req.body).length ? String(req.body).length : void 0;
    const baseLog = {
      method: req.method,
      path: req.path || "",
      viaRelay: !!req.viaRelay,
      ...bodyBytes != null ? { body_bytes: bodyBytes } : {}
    };
    if (!req.path) {
      void this.logCallin({ ...baseLog, ok: true, skipped: "empty" });
      return void 0;
    }
    if (req.viaRelay && !await this.relayWhitelistAllows(req.path, req.relayAlias)) {
      const error = `blocked from relay: ${relayWhitelistNorm(req.path) || "(empty)"} is not on the relay whitelist${req.relayAlias ? ` for alias ${req.relayAlias}` : ""}`;
      void this.logCallin({ ...baseLog, ok: false, error });
      throw new Error(error);
    }
    return callinScope ? await callinScope.run(req, () => this.runCallin(req, baseLog)) : await this.runCallin(req, baseLog);
  }
  async runCallin(req, baseLog) {
    const prev = this.callinSlot;
    this.callinSlot = req;
    const streamCallout = req.method === "POST" && !req.viaRelay;
    try {
      const result = await this.dispatchParkPath(req.path, {
        method: req.method,
        viaRelay: req.viaRelay,
        callin: true,
        hostPin: req.hostPin !== false,
        parkBypass: !!req.parkBypass,
        headers: req.headers,
        body: req.body,
        request: req
      });
      void this.logCallin({ ...baseLog, ok: true });
      if (result !== void 0 && streamCallout) {
        this.emit("callout", result);
      }
      return result;
    } catch (error) {
      void this.logCallin({
        ...baseLog,
        ok: false,
        error: formatCalloutMessage(error)
      });
      if (streamCallout) {
        this.callout("Error: " + formatCalloutMessage(error));
      }
      throw error;
    } finally {
      if (this.callinSlot === req)
        this.callinSlot = prev;
    }
  }
  normalizeCallinInput(input) {
    if (typeof input === "string") {
      const trimmed = String(input ?? "").trim();
      return {
        method: "POST",
        headers: {},
        body: "",
        viaRelay: false,
        hostPin: true,
        parkBypass: false,
        path: trimmed ? this.callinToParkPath(trimmed) : ""
      };
    }
    const method = normalizeParkMethod(input?.method, "POST");
    const headers = input?.headers && typeof input.headers === "object" ? { ...input.headers } : {};
    const body = input?.body == null ? "" : String(input.body);
    const viaRelay = !!input?.viaRelay;
    const hostPin = input?.hostPin !== false;
    const parkBypass = !!input?.parkBypass || this.parkBypassFromHeaders(headers);
    const relayAlias = viaRelay ? String(input?.relayAlias || "").trim() : "";
    const extra = relayAlias ? { relayAlias } : {};
    if (input?.path != null && String(input.path).trim()) {
      let lit = String(input.path).trim().replace(/^\/+/, "");
      try {
        lit = decodeURIComponent(lit);
      } catch {
      }
      return {
        method,
        headers,
        body,
        viaRelay,
        hostPin,
        parkBypass,
        ...extra,
        path: lit ? normalizeTipIb(lit) : ""
      };
    }
    const raw = String(input?.input ?? "").trim();
    return {
      method,
      headers,
      body,
      viaRelay,
      hostPin,
      parkBypass,
      ...extra,
      path: raw ? this.callinToParkPath(raw) : ""
    };
  }
  callinToParkPath(trimmed) {
    let raw = String(trimmed || "").trim().replace(/^\/+/, "");
    if (!raw)
      return "";
    try {
      raw = decodeURIComponent(raw);
    } catch {
    }
    const tokens = raw.split(/\s+/).filter((t) => t.length > 0);
    const segs = [];
    for (const t of tokens) {
      if (isAbsoluteHttpUrl(t)) {
        segs.push(encodeURIComponent(t));
        continue;
      }
      const parts = ibSegments(t);
      if (parts.length)
        segs.push(...parts);
      else
        segs.push(t);
    }
    return segs.join("/");
  }
  async dispatchParkPath(rawIb, opts) {
    const ib = normalizeTipIb(rawIb);
    if (!ib)
      throw new Error("empty park path");
    const method = normalizeParkMethod(opts?.method, "GET");
    const viaRelay = !!opts?.viaRelay;
    const hostPin = opts?.hostPin !== false;
    const parkBypass = !!opts?.parkBypass || this.parkBypassFromHeaders(opts?.headers);
    const gatePassthru = this.gatePassthruFromInit({
      headers: opts?.headers
    });
    const miss = (label) => viaRelay ? new Error(`no navi park for ${label}`) : new Error(`no tip frame for park ${label}`);
    const unitPeel = await this.peelUnitFromIb(ib);
    const workIb = unitPeel ? unitPeel.restSegs.length ? unitPeel.restSegs.join("/") : unitPeel.unitIb : ib;
    const explicitUnit = unitPeel?.unitIb || null;
    const execOpts = {
      method,
      viaRelay,
      callin: !!opts?.callin,
      request: opts?.request
    };
    return await this.withCallUnit(explicitUnit, async () => {
      if (unitPeel && !unitPeel.restSegs.length) {
        const tip2 = await this.getTip(unitPeel.unitIb);
        if (!tip2?.data)
          throw miss(unitPeel.unitIb);
        return tip2;
      }
      if (parkBypass) {
        if (!hostPin) {
          throw miss(workIb);
        }
        const hostCap = await this.tryHostParkPin(workIb, method, {
          forceRefresh: true
        });
        if (hostCap) {
          return await this.executeParkTip(
            hostCap.tip,
            hostCap.tipIb,
            hostCap.args,
            execOpts
          );
        }
        throw miss(workIb);
      }
      const cap = await this.resolveModParkCapture(workIb, {
        method,
        viaRelay,
        callin: !!opts?.callin
      });
      if (cap) {
        return await this.executeParkTip(
          cap.tip,
          cap.tipIb,
          cap.args,
          execOpts
        );
      }
      let tip = await this.getTip(workIb, { gatePassthru });
      if (!tip?.data) {
        if (hostPin) {
          const hostCap = await this.tryHostParkPin(workIb, method);
          if (hostCap) {
            return await this.executeParkTip(
              hostCap.tip,
              hostCap.tipIb,
              hostCap.args,
              execOpts
            );
          }
        }
        throw miss(workIb);
      }
      const ctrl = parkMethodCtrl(tip, method);
      if (!ctrl && isStrictParkMethod(method)) {
        throw new Error(
          `park ${tip.ib || workIb} has no method.${method}`
        );
      }
      return await this.executeParkTip(tip, tip.ib || workIb, [], execOpts);
    });
  }
  async executeParkTip(tip, tipIb, args, opts) {
    const { method, viaRelay } = opts;
    const ctrl = parkMethodCtrl(tip, method);
    const kind = String(ctrl?.kind || "").toLowerCase();
    if (kind === "mod" || kind === "surface" || kind === "relay" || kind === "navi_root") {
      return await this.executeModPark(tip, tipIb, args, null, {
        method,
        viaRelay,
        callin: opts.callin,
        denyKinds: viaRelay ? ["navi_root"] : void 0,
        request: opts.request
      });
    }
    const hasBin = Array.isArray(tip.rel8ns?.bin) && tip.rel8ns.bin.length > 0;
    const fileGet = !kind && method === "GET" && hasBin && tip.data?.shim === "file";
    if (kind === "frame" || !kind && !fileGet) {
      return tip;
    }
    if (kind !== "bin" && !hasBin) {
      throw new Error(`park ${tipIb} kind '${kind}' is not dispatchable`);
    }
    const pick = selectParkBinRef(tip, kind === "bin" ? ctrl : null, args);
    if ("error" in pick) {
      throw new Error(`park ${tipIb}: ${pick.error}`);
    }
    let media;
    let binMime = "";
    if (pick.selected) {
      let bin = await this.getBin(pick.sha);
      if (!bin?.media) {
        const snap = await this.fetchHostFrameSnapshot(tipIb, [pick.sha]);
        const got = snap?.bins.find((b) => b.sha === pick.sha);
        if (got) {
          await this.putBin(got.sha, { media: got.media, mime: got.mime });
          bin = { ...got };
        }
      }
      if (!bin?.media) {
        throw new Error(`[navi] missing bin ${pick.sha} for park ${tipIb}`);
      }
      media = bin.media;
      binMime = bin.mime;
    } else {
      media = await this.loadBinMediaFromTip(tip.ib || tipIb);
    }
    const mime = String(
      ctrl?.content_type || tip.data?.content_type || tip.data?.mime || binMime || "application/octet-stream"
    ) || "application/octet-stream";
    if (method === "POST" && mime.split(";")[0].trim().toLowerCase() === NAVI_SCRIPT_MIME) {
      const mode = String(ctrl?.script_mode || tip.data?.script_mode || "js").toLowerCase() === "callin" ? "callin" : "js";
      this.bindCallinRequest(opts.request);
      const run = await this.script(naviScriptFromBin(media, mode), {
        mode,
        args: ctrl?.select ? args.slice(1) : args,
        onError: String(ctrl?.on_error || "").toLowerCase() === "continue" ? "continue" : "stop",
        viaRelay,
        label: tipIb
      });
      return { script: true, mode, ...run };
    }
    return { media, mime };
  }
  async executeModPark(tipIn, tipIb, args, commandOverride, opts) {
    const method = normalizeParkMethod(opts?.method, "GET");
    const viaRelay = !!opts?.viaRelay;
    let tip = tipIn;
    const ctrl = parkMethodCtrl(tip, method);
    if (!ctrl) {
      throw new Error(`park ${tipIb} has no method.${method}`);
    }
    const kind = String(ctrl.kind || "").toLowerCase();
    if (opts?.denyKinds?.includes(kind)) {
      throw new Error(
        `kind=${kind} is blocked from this access path`
      );
    }
    if (kind === "relay") {
      if (viaRelay) {
        return "relay is local-only.";
      }
      return await this.relayCallin(args);
    }
    if (kind === "navi_root") {
      throw new Error(
        `kind=navi_root retired \u2014 use flat tips (navi:reseed, navi:factoryreset, \u2026)`
      );
    }
    if (kind === "surface") {
      this.bindCallinRequest(opts?.request);
      return await this.executeSurfacePark(tip, tipIb, args, {
        method
      });
    }
    if (kind === "frame") {
      return tip;
    }
    if (kind !== "mod") {
      throw new Error(
        `park ${tipIb} method.${method}.kind is '${ctrl.kind}', expected 'mod' or 'surface'`
      );
    }
    const index = await this.getTip(NAVI_MOD_INDEX_IB);
    if (!index?.data) {
      throw new Error(`navi:mod tip missing \u2014 cannot dispatch ${tipIb}`);
    }
    const target = String(ctrl.target || "").trim();
    if (!target) {
      throw new Error(`park ${tipIb} method.${method} must set target`);
    }
    if (!this.mod?.[target]) {
      let media = null;
      try {
        media = await this.loadBinMediaFromTip(tipIb);
      } catch {
        media = null;
      }
      if (!media) {
        try {
          media = await this.loadBinMediaFromTip(moduleParkIb(target));
        } catch {
          media = null;
        }
      }
      if (!media) {
        media = await this.fetchHostModuleMedia(tipIb);
      }
      if (!media) {
        throw new Error(
          `navi.mod.${target} not mounted and no tip+bin to remount for ${tipIb}`
        );
      }
      await this.mount(media, {
        record: true,
        parkTipIb: tipIb
      });
      const refreshed = await this.getTip(tipIb);
      if (refreshed?.data)
        tip = refreshed;
    }
    const liveCtrl = parkMethodCtrl(tip, method) || ctrl;
    const altCommands = parkMethodCommands(tip, method);
    let commandName = commandOverride || String(liveCtrl.command || "").trim();
    let cmdArgs = args.slice();
    if (!commandOverride && cmdArgs.length && altCommands.includes(cmdArgs[0])) {
      commandName = cmdArgs[0];
      cmdArgs = cmdArgs.slice(1);
    }
    if (!commandName) {
      throw new Error(
        `park ${tipIb} method.${method} must set command`
      );
    }
    if (altCommands.length && !altCommands.includes(commandName)) {
      throw new Error(
        `command '${commandName}' not in ${tipIb} data.method.${method}.commands`
      );
    }
    const mod = this.mod?.[target];
    const command = mod?.commands?.[commandName];
    if (!mod || !command || typeof command.execute !== "function") {
      throw new Error(
        `navi.mod.${target}.commands.${commandName} not available`
      );
    }
    this.bindCallinRequest(opts?.request);
    return await command.execute(...cmdArgs);
  }
  async executeSurfacePark(tip, tipIb, args, opts) {
    const method = normalizeParkMethod(opts?.method, "GET");
    const ctrl = parkMethodCtrl(tip, method);
    const target = String(ctrl?.target || "").trim();
    if (!target) {
      throw new Error(`park ${tipIb} surface control must set target`);
    }
    const live = this.resolveSurfaceTarget(target);
    const about = tip.data.about || null;
    if (method === "GET") {
      if (target === "plug")
        return await this.plugPresence();
      return this.surfaceSnapshot(target, live, about);
    }
    const snapshot = target === "plug" ? await this.plugPresence() : this.surfaceSnapshot(target, live, about);
    const isVerb = this.surfaceTargetIsVerb(target);
    if (!args.length && !isVerb) {
      return snapshot;
    }
    if (target === "reseed") {
      return await this.reseedTips(String(args[0] || "") === "force");
    }
    if (target === "factoryreset") {
      return await this.factoryResetSpace();
    }
    if (target === "reindex") {
      return await this.reindexUnitMods();
    }
    if (target === "alias") {
      return await this.aliasUnit(args[0], args[1]);
    }
    if (target === "prune") {
      return await this.pruneUnits(String(args[0] || "offline"));
    }
    if (target === "resolve") {
      return await this.resolveUnitDefault(args[0]);
    }
    if (target === "heartbeat") {
      return await this.heartbeatUnitControl(args[0]);
    }
    if (target === "storage") {
      const verb = String(args[0] || "").trim();
      if (verb === "kill") {
        return await this.storage.kill(...args.slice(1));
      }
      return snapshot;
    }
    if (target === "plug") {
      const verb = String(args[0] || "").trim() || "ping";
      if (verb === "ensure")
        return await this.ensureUnit();
      if (verb === "touch") {
        return await this.touchEntryPlug();
      }
      if (verb === "ping") {
        return await this.revealEntryPlug();
      }
      return await this.plugPresence();
    }
    if (target === "unit") {
      const verb = String(args[0] || "").trim();
      if (verb === "list" || !verb) {
        return { units: await this.loadUnitsState() };
      }
      return snapshot;
    }
    if (typeof live === "function") {
      return await live(...args);
    }
    if (live && typeof live === "object") {
      const methodName = String(args[0] || "").trim();
      const rest = args.slice(1);
      if (methodName && typeof live[methodName] === "function") {
        return await live[methodName](...rest);
      }
      const nested = methodName ? live[methodName] : null;
      if (nested && typeof nested === "object") {
        const sub = String(rest[0] || "").trim();
        if (sub && typeof nested[sub] === "function") {
          return await nested[sub](...rest.slice(1));
        }
        if (!sub) {
          return {
            ...snapshot,
            methods: Object.keys(nested).filter(
              (k) => typeof nested[k] === "function"
            )
          };
        }
      }
      if (target === "origin" && args[0] != null) {
        this.origin = String(args[0]);
        return this.origin;
      }
      if (target === "stamp") {
        if (methodName === "time")
          return naviStamp.time(rest[0]);
        if (methodName === "uuid")
          return naviStamp.uuid();
        if (!methodName)
          return naviStamp();
      }
    }
    return snapshot;
  }
  surfaceTargetIsVerb(target) {
    return [
      "reseed",
      "factoryreset",
      "reindex",
      "alias",
      "prune",
      "resolve",
      "heartbeat",
      "plug",
      "unit"
    ].includes(target);
  }
  surfaceTargetIsExecutable(target) {
    return this.surfaceTargetIsVerb(target) || [
      "storage",
      "stamp",
      "origin",
      "park",
      "pwa",
      "sw",
      "fetch"
    ].includes(target);
  }
  async isEntryPlugBonded() {
    if (!this.entryPlug?.unitIb || !this.entryPlug?.hash)
      return false;
    const sys = await this.loadUnitsState();
    return !!(sys.list || []).find(
      (r) => r && tipIbsMatch(String(r.ib || ""), this.entryPlug.unitIb) && String(r.hash || "") === String(this.entryPlug.hash)
    );
  }
  async requireEntryPlugGate(op) {
    if (!this.entryPlug?.unitIb || !this.entryPlug?.hash) {
      throw new Error(`[${op}] entry-plug required`);
    }
    if (!await this.isEntryPlugBonded()) {
      throw new Error(
        `[${op}] entry-plug not bonded on ${NAVI_UNIT_SYSTEM_IB}`
      );
    }
    if (typeof globalThis.confirm === "function") {
      if (!globalThis.confirm(
        `[navi] allow ${op} via entry-plug of ${this.entryPlug.unitIb}?`
      )) {
        throw new Error(`[${op}] aborted \u2014 entry-plug access rejected`);
      }
    }
  }
  resolveSurfaceTarget(target) {
    switch (target) {
      case "stamp":
        return this.stamp;
      case "origin":
        return this.origin;
      case "park":
        return this.park;
      case "pwa":
        return this.pwa;
      case "sw":
        return this.sw;
      case "fetch":
        return this.fetchPath.bind(this);
      case "unit":
        return { tip: NAVI_UNIT_SYSTEM_IB };
      case "plug":
        return this.plug;
      case "native":
      case "localnavi":
        return {
          node: isNodeRuntime(),
          exe: isLocalnaviExe(),
          browser: isBrowserDocument()
        };
      case "storage":
        return this.storage;
      case "reseed":
        return this.reseed;
      case "factoryreset":
        return this.factoryreset;
      case "alias":
      case "prune":
      case "resolve":
      case "heartbeat":
      case "reindex":
        return { target };
      default:
        throw new Error(`unknown surface target '${target}'`);
    }
  }
  async plugPresence() {
    return this.signedEntryPlugView({ reveal: false });
  }
  async revealEntryPlug() {
    if (!this.entryPlug)
      return null;
    if (typeof globalThis.confirm === "function") {
      if (!globalThis.confirm(
        `[navi:plug] reveal entry-plug of ${this.entryPlug.unitIb}?`
      )) {
        throw new Error("[plug ping] aborted \u2014 confirmation failed");
      }
    }
    const now = naviStamp();
    this.entryPlug = {
      ...this.entryPlug,
      stamp: now,
      last_seen: now.timestamp
    };
    return this.signedEntryPlugView({ reveal: true });
  }
  surfaceSnapshot(target, live, about) {
    const base = {
      kind: "surface",
      target,
      about
    };
    if (target === "origin") {
      base.value = String(live ?? "");
      return base;
    }
    if (target === "stamp") {
      base.api = ["time", "uuid"];
      return base;
    }
    if (target === "unit") {
      base.tip = NAVI_UNIT_SYSTEM_IB;
      base.access = { GET: "snapshot", POST: "list" };
      return base;
    }
    if (target === "plug") {
      return {
        kind: "surface",
        target: "plug",
        about,
        note: "use GET/POST plug for signed presence"
      };
    }
    if (target === "native" || target === "localnavi") {
      return {
        kind: "surface",
        target: "native",
        node: isNodeRuntime(),
        exe: isLocalnaviExe(),
        browser: isBrowserDocument(),
        access: {
          GET: "snapshot",
          POST: "snapshot"
        }
      };
    }
    if (target === "pwa") {
      base.methods = ["set", "apply", "clear", "get"];
      return base;
    }
    if (target === "park") {
      base.methods = ["check", "ib", "slash"];
      return base;
    }
    if (target === "sw") {
      base.methods = Object.keys(this.sw || {});
      return base;
    }
    if (target === "fetch") {
      base.api = "fetch";
      return base;
    }
    if (target === "storage") {
      base.methods = ["tip", "bin", "item", "file", "kill"];
      base.access = {
        GET: "snapshot",
        POST: "kill <ib> \u2014 entry-plug"
      };
      return base;
    }
    if ([
      "reseed",
      "factoryreset",
      "alias",
      "prune",
      "resolve",
      "heartbeat",
      "reindex"
    ].includes(target)) {
      base.access = { GET: "snapshot", POST: "execute" };
      return base;
    }
    if (live && typeof live === "object") {
      base.keys = Object.keys(live);
    } else if (typeof live === "function") {
      base.type = "function";
    } else {
      base.value = live;
    }
    return base;
  }
  async hardEraseTip(ibRaw) {
    const ib = canonicalizeTipIb(ibRaw);
    if (!ib) {
      throw new Error("Usage: storage.kill(<ib>)");
    }
    const tip = await this.getTip(ib);
    if (!tip) {
      throw new Error(`no tip ${ib}`);
    }
    const refs = Array.isArray(tip.rel8ns?.bin) ? tip.rel8ns.bin : [];
    for (const ref of refs) {
      const sha = String(ref || "").trim().match(/^bin\s+([0-9a-fA-F]+)$/)?.[1]?.toLowerCase();
      if (sha)
        await this.deleteBin(sha);
    }
    await this.deleteTip(ib);
    const index = await this.getTip(NAVI_MOD_INDEX_IB);
    if (index?.data && Array.isArray(index.data.parks)) {
      const next = index.data.parks.filter(
        (p) => p && !tipIbsMatch(this.parkEntryIb(p), ib)
      );
      if (next.length !== index.data.parks.length) {
        await this.mut8Tip(index, { parks: next });
      }
    }
    return `[kill] erased ${ib}`;
  }
  async storageKill(ibRaw) {
    const want = canonicalizeTipIb(ibRaw);
    if (!want) {
      throw new Error("Usage: navi.storage.kill(<ib>)");
    }
    const tip = await this.getTip(want);
    if (!tip) {
      throw new Error(`no tip ${want}`);
    }
    const ib = canonicalizeTipIb(tip.ib || want) || want;
    await this.requireEntryPlugGate("storage.kill");
    const prompt = `HARD ERASE tip "${ib}" from local tip space. Type the ib to confirm.`;
    if (typeof globalThis.prompt === "function") {
      const typed = globalThis.prompt(prompt, "");
      if (typed == null || !tipIbsMatch(typed, ib)) {
        throw new Error("[kill] aborted \u2014 confirmation failed");
      }
    } else if (typeof globalThis.confirm === "function") {
      if (!globalThis.confirm(
        `HARD ERASE tip "${ib}" from local tip space via entry-plug of ${this.entryPlug.unitIb}?`
      )) {
        throw new Error("[kill] aborted \u2014 confirmation failed");
      }
    }
    return await this.hardEraseTip(ib);
  }
  async factoryResetSpace() {
    await this.requireEntryPlugGate("factoryreset");
    if (this.unitHeartbeatTimer) {
      clearInterval(this.unitHeartbeatTimer);
      this.unitHeartbeatTimer = null;
    }
    this.entryPlug = null;
    this.entryPlugSecret = null;
    this.callUnitIb = null;
    this.installUuid = null;
    for (const name of this.listModules()) {
      delete this.mod[name];
      this.moduleRegistry.delete(name);
    }
    const tipIbs = await this.storageImpl.listTips();
    for (const ib of tipIbs) {
      await this.storageImpl.deleteTip(ib);
    }
    const frames = await this.storageImpl.listTipFrames();
    for (const addr of frames) {
      await this.storageImpl.deleteTipFrame(addr);
    }
    const bins = await this.storageImpl.listBins();
    for (const sha of bins) {
      await this.storageImpl.deleteBin(sha);
    }
    await this.ensureNaviReduxSeeds();
    await this.ensureUnit();
    await this.createDefaultModule();
    return "[navi] factoryreset complete";
  }
  async reseedTips(force = false) {
    const planted = [];
    for (const seed of NAVI_REDUX_SEED_TIPS) {
      const ib = canonicalizeTipIb(seed.ib);
      if (!ib)
        continue;
      const existing = await this.getTip(ib);
      if (existing?.ib && !force) {
        continue;
      }
      const priorAddr = existing?.gib && force ? `${existing.ib}^${existing.gib}` : null;
      let frame = await this.stampTipFrame(seed);
      if (priorAddr) {
        frame = {
          ...frame,
          rel8ns: {
            ...frame.rel8ns || {},
            past: [priorAddr]
          }
        };
        frame = await this.stampTipFrame(frame);
      }
      await this.setTip(frame);
      planted.push(ib);
    }
    await this.createDefaultModule();
    return planted.length ? `[navi] reseeded: ${planted.join(", ")}` : "[navi] reseed: nothing to plant (use force to overwrite)";
  }
  async reindexUnitMods() {
    const unitIb = await this.requireCallUnitIb();
    const unitTip = await this.getTip(unitIb);
    if (!unitTip?.data)
      throw new Error(`unit tip missing ${unitIb}`);
    const mods = {};
    const parks = [];
    for (const name of this.listModules()) {
      const parkIb = moduleParkIb(name);
      const tip = await this.getTip(parkIb);
      if (!tip?.data) {
        throw new Error(
          `mounted module '${name}' has no park tip ${parkIb}`
        );
      }
      const mod = this.mod[name];
      const commands = mod?.commands ? Object.keys(mod.commands) : parkMethodCommands(tip);
      const entry = await this.parkRegistrationEntry(
        tip,
        name,
        commands
      );
      mods[name] = entry;
      parks.push(entry);
    }
    await this.mut8Tip(unitTip, {
      unit: {
        ...unitTip.data.unit || {},
        mods
      }
    });
    const index = await this.getTip(NAVI_MOD_INDEX_IB);
    if (index?.data) {
      const prior = Array.isArray(index.data.parks) ? index.data.parks.slice() : [];
      for (const entry of parks) {
        const i = prior.findIndex(
          (p) => p && (p.name === entry.name || tipIbsMatch(this.parkEntryIb(p), this.parkEntryIb(entry)))
        );
        if (i >= 0)
          prior[i] = entry;
        else
          prior.push(entry);
      }
      await this.mut8Tip(index, { parks: prior });
    }
    return `[navi] reindexed unit ${unitIb} mods (${Object.keys(mods).length})`;
  }
  async mut8TipByIb(ib, dataPatch = {}, opts) {
    let tip = await this.getTip(ib);
    if (!tip?.data) {
      if (!opts?.create) {
        throw new Error(`no tip ${canonicalizeTipIb(ib)}`);
      }
      const seed = opts.create === true ? {} : opts.create || {};
      tip = {
        ib: canonicalizeTipIb(ib),
        gib: "",
        data: {
          ...seed.data && typeof seed.data === "object" ? seed.data : {}
        },
        rel8ns: {
          past: [],
          tjp: [],
          dna: [],
          ...seed.rel8ns && typeof seed.rel8ns === "object" ? seed.rel8ns : {}
        }
      };
    }
    return await this.mut8Tip(tip, dataPatch || {}, opts);
  }
  async putBinMedia(record) {
    if (!record || typeof record.media !== "string") {
      throw new Error("[navi] putBinMedia requires { media, mime }");
    }
    const sha = await this.sha256Hex(record.media);
    await this.putBin(sha, {
      media: record.media,
      mime: record.mime || "application/octet-stream"
    });
    return sha;
  }
  async plantModulePark(opts) {
    const name = String(opts?.name || "").trim().replace(/^navi[/:]/, "").replace(/^mod[/:]/, "");
    if (!name || /[/:]/.test(name)) {
      throw new Error(
        "[navi] plantModulePark name must be a single segment (e.g. potter)"
      );
    }
    const sha = await this.putBinMedia({
      media: opts.media,
      mime: opts.mime || "application/navi-module"
    });
    const ref = `bin ${sha}`;
    const ib = moduleParkIb(name);
    const existing = await this.getTip(ib);
    const priorAddr = existing?.gib ? `${existing.ib}^${existing.gib}` : null;
    const defaultCmd = name;
    const methodBlock = {
      GET: {
        kind: "mod",
        target: name,
        command: defaultCmd,
        mode: "async"
      },
      POST: {
        kind: "mod",
        target: name,
        command: defaultCmd,
        mode: "async"
      },
      PUT: { kind: "commit", mode: "async" },
      PATCH: { kind: "commit", mode: "async" },
      DELETE: { kind: "tombstone", mode: "async" }
    };
    const altCommands = Array.isArray(opts.commands) && opts.commands.length > 1 ? opts.commands.map(String) : [];
    if (altCommands.length) {
      methodBlock.GET.commands = altCommands;
      methodBlock.POST.commands = altCommands;
    }
    const frame = await this.stampTipFrame({
      ib,
      gib: "",
      data: {
        parts: ["navi_park", "ibgib_frame", "manifest", "json"],
        park: "capture",
        default_method: "GET",
        content_type: opts.mime || "application/navi-module",
        method: methodBlock,
        module: { name, subject_seed: ref },
        about: {
          label: `navi mod ${name} park`,
          description: `Planted module park for ${name} at ${ib} (provision + verbs).`,
          navi_name: name,
          name
        }
      },
      rel8ns: {
        bin: [ref],
        past: priorAddr ? [priorAddr] : [],
        tjp: [],
        dna: []
      }
    });
    await this.setTip(frame);
    return { ib, sha, ref };
  }
  async peelUnitFromIb(ib) {
    const segs = ibSegments(ib);
    if (!segs.length)
      return null;
    if (segs[0] === "navi" && segs[1] === "unit" && segs[2]) {
      return {
        unitIb: unitParkIb(segs[2]),
        restSegs: segs.slice(3)
      };
    }
    if (segs[0] === "unit" && segs[1]) {
      return {
        unitIb: unitParkIb(segs[1]),
        restSegs: segs.slice(2)
      };
    }
    const aliasIdx = segs[0] === "navi" ? 1 : 0;
    if (segs.length <= aliasIdx)
      return null;
    const aliasName = segs[aliasIdx];
    let tip = await this.getTip(aliasName);
    if (!tip?.data?.unit?.hash) {
      const presumed = await this.getTip(presumeNaviIb(aliasName));
      if (presumed?.data?.unit?.hash)
        tip = presumed;
    }
    if (tip?.data?.unit?.hash) {
      return {
        unitIb: String(tip.ib || aliasName),
        restSegs: segs.slice(aliasIdx + 1)
      };
    }
    const units = await this.loadUnitsState();
    const aliases = units.aliases && typeof units.aliases === "object" ? units.aliases : {};
    const mapped = aliases[aliasName];
    if (mapped) {
      return {
        unitIb: canonicalizeTipIb(String(mapped)),
        restSegs: segs.slice(aliasIdx + 1)
      };
    }
    return null;
  }
  async withCallUnit(explicitUnitIb, fn) {
    const prev = this.callUnitIb;
    try {
      if (explicitUnitIb) {
        this.callUnitIb = canonicalizeTipIb(explicitUnitIb);
      } else if (!this.callUnitIb) {
        this.callUnitIb = await this.resolveDefaultUnitIb();
      }
      return await fn();
    } finally {
      this.callUnitIb = prev;
    }
  }
  async resolveDefaultUnitIb() {
    if (this.entryPlug?.unitIb)
      return this.entryPlug.unitIb;
    const units = await this.loadUnitsState();
    const def = units.resolution?.default;
    if (def)
      return canonicalizeTipIb(String(def));
    const list = Array.isArray(units.list) ? units.list : [];
    const online = list.find((r) => r?.online !== false && r?.ib);
    if (online?.ib)
      return canonicalizeTipIb(String(online.ib));
    if (list[0]?.ib)
      return canonicalizeTipIb(String(list[0].ib));
    return null;
  }
  async requireCallUnitIb() {
    const ib = this.callUnitIb || this.entryPlug?.unitIb || await this.resolveDefaultUnitIb();
    if (!ib)
      throw new Error("no unit context \u2014 ensureUnit first");
    return ib;
  }
  async getUnitMountEntry(name) {
    const unitIb = this.callUnitIb || this.entryPlug?.unitIb;
    if (!unitIb)
      return null;
    const tip = await this.getTip(unitIb);
    const mods = this.readUnitMods(tip);
    if (!mods)
      return null;
    const entry = mods[name];
    return entry && typeof entry === "object" ? entry : null;
  }
  readUnitMods(tip) {
    const u = tip?.data?.unit;
    if (!u || typeof u !== "object")
      return null;
    if (u.mods && typeof u.mods === "object")
      return u.mods;
    return null;
  }
  async mut8Tip(tip, dataPatch, opts) {
    const run = this.tipMut8Chain.then(
      () => this.mut8TipUnlocked(tip, dataPatch, opts)
    );
    this.tipMut8Chain = run.then(
      () => void 0,
      () => void 0
    );
    return run;
  }
  async mut8TipUnlocked(tip, dataPatch, opts) {
    const tipIb = canonicalizeTipIb(tip.ib || "") || String(tip.ib || "").trim();
    const priorGib = String(tip.gib || "").trim();
    const priorAddr = priorGib ? `${tipIb}^${priorGib}` : null;
    if (priorGib) {
      await this.putTipFrame({ ...tip, ib: tipIb, gib: priorGib });
      await this.liftNestedFramesIntoSpace(tip);
    }
    const patch = dataPatch && typeof dataPatch === "object" ? dataPatch : {};
    const { frames: _dropFrames, ...restPatch } = patch;
    const baseData = tip.data && typeof tip.data === "object" ? { ...tip.data } : {};
    delete baseData.frames;
    delete baseData.n;
    const nextData = opts?.replaceData ? { ...restPatch } : {
      ...baseData,
      ...restPatch
    };
    delete nextData.frames;
    const relPatch = opts?.rel8ns && typeof opts.rel8ns === "object" ? opts.rel8ns : {};
    const nextRel8ns = {
      ...tip.rel8ns || {},
      ...relPatch,
      past: this.resolveMut8Past(tip, priorAddr, relPatch)
    };
    const next = await this.stampTipFrame({
      ...tip,
      ib: tipIb,
      data: nextData,
      rel8ns: nextRel8ns
    });
    await this.setTip(next);
    if (priorAddr) {
      const check = await this.storageImpl.getTipFrame(priorAddr);
      if (!check) {
        await this.putTipFrame({ ...tip, ib: tipIb, gib: priorGib });
        const again = await this.storageImpl.getTipFrame(priorAddr);
        if (!again) {
          this.callout(
            `[navi] tip.frame missing after mut8: ${priorAddr}`
          );
        }
      }
    }
    return next;
  }
  resolveMut8Past(tip, priorAddr, relPatch) {
    const pastExplicit = Object.prototype.hasOwnProperty.call(
      relPatch,
      "past"
    );
    if (!pastExplicit) {
      return priorAddr ? [priorAddr] : [];
    }
    const override = relPatch.past;
    if (!priorAddr)
      return override;
    const tipPast = Array.isArray(tip.rel8ns?.past) ? tip.rel8ns.past.map(String) : [];
    const overList = Array.isArray(override) ? override.map(String) : null;
    if (overList && overList.length === tipPast.length && overList.every((v, i) => v === tipPast[i])) {
      return [priorAddr];
    }
    return override;
  }
  async parkRegistrationEntry(tip, name, commands) {
    const parkIb = canonicalizeTipIb(String(tip.ib || "")) || moduleParkIb(name);
    let gib = String(tip.gib || "").trim();
    if (!gib) {
      const row = await this.storageImpl.getTip(
        canonicalizeTipIb(tip.ib || parkIb) || parkIb
      );
      if (this.isTipPointer(row)) {
        const pointerAddr = String(row.addr || "").trim();
        const caret = pointerAddr.indexOf("^");
        if (caret > 0)
          gib = pointerAddr.slice(caret + 1).trim();
      }
    }
    if (!gib) {
      throw new Error(
        `park ${parkIb} has no gib \u2014 cannot register on navi:mod`
      );
    }
    return {
      "ib^gib": `${parkIb}^${gib}`,
      name,
      commands,
      registered_at: naviStamp.time()
    };
  }
  parkEntryIb(entry) {
    const full = String(
      entry?.["ib^gib"] || entry?.addr || ""
    ).trim();
    const caret = full.indexOf("^");
    if (caret > 0) {
      return canonicalizeTipIb(full.slice(0, caret)) || "";
    }
    return canonicalizeTipIb(String(entry?.ib || "")) || "";
  }
  parkEntryAddr(entry) {
    return String(entry?.["ib^gib"] || entry?.addr || "").trim();
  }
  async syncModIndexOnMount(moduleObject, opts) {
    const name = String(moduleObject?.name || "").trim();
    if (!name)
      return;
    const liveCommands = moduleObject.commands ? Object.keys(moduleObject.commands) : [];
    const parkIb = moduleParkIb(name);
    const altIb = (() => {
      const raw = String(opts?.parkTipIb || "").trim();
      if (!raw)
        return "";
      const c = canonicalizeTipIb(raw) || raw;
      return c && c !== parkIb ? c : "";
    })();
    const getAllowed = moduleCommandsForTransport(moduleObject, "GET");
    const postAllowed = moduleCommandsForTransport(moduleObject, "POST");
    const singleCommand = liveCommands.length <= 1;
    const getDefault = singleCommand ? liveCommands.includes(name) ? name : liveCommands[0] || "" : defaultModuleCommand(name, getAllowed, "list");
    const postDefault = singleCommand ? getDefault : defaultModuleCommand(name, postAllowed, "list");
    const getCommands = singleCommand ? [] : getAllowed;
    const postCommands = singleCommand ? [] : postAllowed;
    const patchTipMethods = async (syncIb) => {
      let tip2 = await this.getTip(syncIb);
      if (!tip2?.data)
        return null;
      const tipGetCommands = parkMethodCommands(tip2, "GET");
      const tipPostCommands = parkMethodCommands(tip2, "POST");
      const tipGetDefault = String(
        parkMethodCtrl(tip2, "GET")?.command || ""
      );
      const tipPostDefault = String(
        parkMethodCtrl(tip2, "POST")?.command || ""
      );
      const needsMethodMigrate = !!(tip2.data?.http && typeof tip2.data.http === "object" && !Array.isArray(tip2.data.http) && !tip2.data?.method);
      const commandsChanged = needsMethodMigrate || tipGetCommands.length !== getCommands.length || tipPostCommands.length !== postCommands.length || tipGetCommands.some((c, i2) => c !== getCommands[i2]) || tipPostCommands.some((c, i2) => c !== postCommands[i2]) || tipGetDefault !== getDefault || tipPostDefault !== postDefault;
      if (commandsChanged) {
        const method = { ...parkMethodBlock(tip2) };
        delete method.commands;
        for (const verb of ["GET", "POST"]) {
          let ctrl = method[verb];
          if (!ctrl || typeof ctrl !== "object") {
            ctrl = { kind: "mod", target: name, mode: "async" };
          }
          const allowed = verb === "GET" ? getAllowed : postAllowed;
          const defaultCmd = verb === "GET" ? getDefault : postDefault;
          const next = { ...ctrl, kind: "mod", target: name };
          if (liveCommands.length)
            next.command = defaultCmd;
          if (!singleCommand && allowed.length > 1) {
            next.commands = allowed;
          } else {
            delete next.commands;
          }
          method[verb] = next;
        }
        const patch = {
          method,
          content_type: tip2.data.content_type || "application/navi-module",
          module: {
            ...tip2.data.module && typeof tip2.data.module === "object" ? tip2.data.module : {},
            name
          },
          about: {
            ...tip2.data.about && typeof tip2.data.about === "object" ? tip2.data.about : {},
            navi_name: name
          }
        };
        delete patch.module.commands;
        if (tip2.data?.http)
          patch.http = null;
        tip2 = await this.mut8Tip(tip2, patch);
      }
      return tip2;
    };
    let tip = await patchTipMethods(parkIb);
    if (altIb)
      await patchTipMethods(altIb);
    if (!tip?.data && altIb)
      tip = await this.getTip(altIb);
    if (!tip?.data) {
      throw new Error(
        `park tip ${parkIb} missing \u2014 plant failed for ${name}`
      );
    }
    const index = await this.getTip(NAVI_MOD_INDEX_IB);
    if (!index?.data) {
      throw new Error("navi:mod tip missing \u2014 cannot record mount");
    }
    const parks = Array.isArray(index.data.parks) ? index.data.parks.slice() : [];
    const canonical = await this.getTip(parkIb);
    const ledgerTip = canonical?.data ? canonical : tip;
    const entry = await this.parkRegistrationEntry(
      ledgerTip,
      name,
      liveCommands
    );
    const i = parks.findIndex(
      (p) => p && (p.name === name || tipIbsMatch(this.parkEntryIb(p), parkIb) || altIb && tipIbsMatch(this.parkEntryIb(p), altIb))
    );
    if (i >= 0)
      parks[i] = entry;
    else
      parks.push(entry);
    await this.mut8Tip(index, { parks });
    const unitIb = this.callUnitIb || this.entryPlug?.unitIb || await this.resolveDefaultUnitIb();
    if (unitIb) {
      const unitTip = await this.getTip(unitIb);
      if (unitTip?.data) {
        const prior = this.readUnitMods(unitTip) || {};
        const mods = {
          ...prior,
          [name]: entry
        };
        const unitData = { ...unitTip.data.unit || {}, mods };
        await this.mut8Tip(unitTip, { unit: unitData });
      }
    }
    this.callout(
      `[navi] mounted ${name} (${this.parkEntryAddr(entry)})` + (unitIb ? ` on ${unitIb}` : "")
    );
  }
  async syncModIndexOnUnmount(name) {
    const modName = String(name || "").trim();
    if (!modName)
      return;
    if (!this.remountInProgress) {
      const index = await this.getTip(NAVI_MOD_INDEX_IB);
      if (index?.data && Array.isArray(index.data.parks)) {
        const parks = index.data.parks.filter(
          (p) => !(p && (String(p.name || "").trim() === modName || tipIbsMatch(
            this.parkEntryIb(p),
            moduleParkIb(modName)
          )))
        );
        if (parks.length !== index.data.parks.length) {
          await this.mut8Tip(index, { parks });
        }
      }
    }
    const unitIb = this.callUnitIb || this.entryPlug?.unitIb || await this.resolveDefaultUnitIb();
    if (unitIb) {
      const unitTip = await this.getTip(unitIb);
      const prior = this.readUnitMods(unitTip);
      if (unitTip?.data && prior) {
        const mods = { ...prior };
        delete mods[modName];
        const unitData = { ...unitTip.data.unit || {}, mods };
        await this.mut8Tip(unitTip, { unit: unitData });
      }
    }
    this.callout(
      `[navi] unmounted ${modName}` + (unitIb ? ` from ${unitIb}` : "")
    );
  }
  async initialize() {
    await this.registerServiceWorker();
    void this.ensureShellCache();
    await this.ensureNaviReduxSeeds();
    await this.ensureEntryPlugSecret();
    await this.ensureUnit();
    const commands = await this.ensureInitScript();
    await this.script(commands);
    this.emit("ready");
  }
  async sha256Hex(text) {
    const data = new TextEncoder().encode(text);
    if (typeof globalThis.crypto?.subtle?.digest === "function") {
      const buf = await globalThis.crypto.subtle.digest("SHA-256", data);
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
    }
    try {
      const nodeCrypto = await import("crypto");
      return nodeCrypto.createHash("sha256").update(text, "utf8").digest("hex");
    } catch {
      let h = 0;
      for (let i = 0; i < text.length; i++) {
        h = Math.imul(31, h) + text.charCodeAt(i) | 0;
      }
      return `fallback${(h >>> 0).toString(16).padStart(8, "0")}`;
    }
  }
  async getInstallUuid() {
    if (this.installUuid && !isStampPlaceholder(this.installUuid)) {
      return this.installUuid;
    }
    const root = await this.getTip("navi");
    const u = resolveStampedUuid(root?.data?.uuid);
    if (u) {
      this.installUuid = u;
      return u;
    }
    this.installUuid = null;
    return null;
  }
  async stampTipFrame(raw, timestamp = naviStamp.time()) {
    const isNaviRoot = canonicalizeTipIb(raw.ib || "") === "navi";
    const incoming = resolveStampedUuid(raw.data?.uuid);
    const uuid = isNaviRoot ? incoming || await this.getInstallUuid() || naviStamp.uuid() : await this.getInstallUuid() || incoming || "";
    if (uuid)
      this.installUuid = uuid;
    const data = {
      ...raw.data && typeof raw.data === "object" ? raw.data : {},
      timestamp,
      ...uuid ? { uuid } : {}
    };
    if (data.n == null)
      delete data.n;
    const gib = (await this.sha256Hex(JSON.stringify(data))).toUpperCase();
    const priorPast = Array.isArray(raw.rel8ns?.past) ? raw.rel8ns.past : [];
    return {
      ib: canonicalizeTipIb(raw.ib || ""),
      gib,
      data,
      rel8ns: {
        tjp: Array.isArray(raw.rel8ns?.tjp) ? raw.rel8ns.tjp : [],
        dna: Array.isArray(raw.rel8ns?.dna) ? raw.rel8ns.dna : [],
        ...raw.rel8ns && typeof raw.rel8ns === "object" ? raw.rel8ns : {},
        past: priorPast
      }
    };
  }
  async getTipExact(ib) {
    const key = canonicalizeTipIb(ib) || String(ib || "").trim();
    if (!key)
      return null;
    const row = await this.storageImpl.getTip(key);
    if (!row || typeof row !== "object")
      return null;
    if (this.isTipPointer(row)) {
      const addr = String(row.addr || "").trim();
      const frame = addr ? await this.storageImpl.getTipFrame(addr) : null;
      if (frame)
        return this.stripNestedFrames(frame);
      return null;
    }
    const legacy = row;
    const gib = String(legacy.gib || "").trim();
    if (!gib)
      return null;
    const tipIb = canonicalizeTipIb(legacy.ib || key) || key;
    const cleaned = this.stripNestedFrames({ ...legacy, ib: tipIb });
    try {
      await this.putTipFrame(cleaned);
      await this.liftNestedFramesIntoSpace(legacy);
      await this.storageImpl.putTip({
        ib: tipIb,
        addr: `${tipIb}^${gib}`,
        pointer: true
      });
    } catch (error) {
      this.callout("Failed to migrate tip pointer: " + error);
    }
    return cleaned;
  }
  async loadDelimiterRaceSet(want) {
    const live = await this.listTipIbs();
    let keys = liveDelimiterHits(want, live);
    if (!keys.length && want)
      keys = [want];
    const frames = await Promise.all(keys.map((k) => this.getTipExact(k)));
    return { keys, frames };
  }
  async getTip(ib, opts) {
    const want = canonicalizeTipIb(ib) || String(ib || "").trim();
    if (!want)
      return null;
    const { keys, frames } = await this.loadDelimiterRaceSet(want);
    const present = [];
    for (let i = 0; i < keys.length; i++) {
      const t = frames[i];
      if (t)
        present.push(t);
    }
    if (!present.length)
      return null;
    if (!opts?.gatePassthru) {
      const gated = present.find((t) => isTipGateTrue(t.data));
      if (gated)
        return gated;
    }
    return present[0];
  }
  async assertDelimiterGate(ib, data) {
    if (!isTipGateTrue(data))
      return;
    const want = canonicalizeTipIb(ib) || String(ib || "").trim();
    const { keys, frames } = await this.loadDelimiterRaceSet(want);
    for (let i = 0; i < keys.length; i++) {
      if (keys[i] === want)
        continue;
      const other = frames[i];
      if (other && isTipGateTrue(other.data)) {
        const otherIb = canonicalizeTipIb(other.ib || keys[i]) || keys[i];
        throw new Error(
          `[navi] cannot gate '${want}': race set already has gate frame '${otherIb}'. Mut8 that park to gate=false (or omit gate) first.`
        );
      }
    }
  }
  async setTip(frame) {
    const ib = canonicalizeTipIb(frame?.ib);
    if (!ib)
      throw new Error("[navi] tip.ib required");
    let next = { ...frame, ib };
    await this.assertDelimiterGate(ib, next.data);
    if (!String(next.gib || "").trim()) {
      next = await this.stampTipFrame(next);
    }
    const gib = String(next.gib || "").trim();
    if (!gib)
      throw new Error("[navi] tip.gib required after stamp");
    await this.liftNestedFramesIntoSpace(next);
    const cleaned = this.stripNestedFrames(next);
    await this.putTipFrame(cleaned);
    await this.storageImpl.putTip({
      ib,
      addr: `${ib}^${gib}`,
      pointer: true
    });
  }
  async deleteTip(ib) {
    const want = canonicalizeTipIb(ib) || String(ib || "").trim();
    if (!want)
      return;
    const addrs = await this.storageImpl.listTipFrames(want);
    for (const addr of addrs) {
      await this.storageImpl.deleteTipFrame(addr);
    }
    await this.storageImpl.deleteTip(want);
  }
  async listTipIbs() {
    return await this.storageImpl.listTips();
  }
  async getTipFrame(addr) {
    const a = String(addr || "").trim();
    if (!a || !a.includes("^"))
      return null;
    const hit = await this.storageImpl.getTipFrame(a);
    if (hit)
      return this.stripNestedFrames(hit);
    const caret = a.indexOf("^");
    const ib = a.slice(0, caret);
    const gib = a.slice(caret + 1);
    const live = await this.listTipIbs();
    const keys = liveDelimiterHits(ib, live);
    if (!keys.includes(ib))
      keys.unshift(ib);
    for (const key of keys) {
      const row = await this.storageImpl.getTip(key);
      if (!row || typeof row !== "object" || this.isTipPointer(row)) {
        continue;
      }
      const tip = row;
      if (String(tip.gib || "").toUpperCase() === String(gib).toUpperCase()) {
        const tipIb = canonicalizeTipIb(tip.ib || key) || key;
        const cleaned = this.stripNestedFrames({ ...tip, ib: tipIb });
        try {
          await this.putTipFrame(cleaned);
          await this.liftNestedFramesIntoSpace(tip);
          await this.storageImpl.putTip({
            ib: tipIb,
            addr: `${tipIb}^${String(tip.gib).trim()}`,
            pointer: true
          });
        } catch {
        }
        return cleaned;
      }
    }
    return null;
  }
  async putTipFrame(frame) {
    const ib = canonicalizeTipIb(frame?.ib);
    const gib = String(frame?.gib || "").trim();
    if (!ib || !gib) {
      throw new Error("[navi] tip.frame.put requires ib and gib");
    }
    const cleaned = this.stripNestedFrames({ ...frame, ib, gib });
    await this.storageImpl.putTipFrame(cleaned);
  }
  async deleteTipFrame(addr) {
    const a = String(addr || "").trim();
    if (!a || !a.includes("^"))
      return;
    await this.storageImpl.deleteTipFrame(a);
  }
  async listTipFrames(ib) {
    const want = canonicalizeTipIb(String(ib || "").trim());
    return await this.storageImpl.listTipFrames(want || void 0);
  }
  tipSpanDeps() {
    return {
      getTip: (ib) => this.getTip(ib),
      getTipFrame: (addr) => this.getTipFrame(addr)
    };
  }
  async walkTipLineage(ib) {
    return walkTipLineage(ib, this.tipSpanDeps());
  }
  async tipSpan(ib, opts = {}) {
    return tipSpan(ib, this.tipSpanDeps(), opts);
  }
  async tipSpanDiff(ib, opts = {}) {
    return tipSpanDiff(ib, this.tipSpanDeps(), opts);
  }
  isTipPointer(row) {
    return !!(row && typeof row === "object" && row.pointer === true && typeof row.addr === "string" && String(row.addr).includes("^"));
  }
  stripNestedFrames(frame) {
    if (!frame?.data || typeof frame.data !== "object")
      return frame;
    if (!Object.prototype.hasOwnProperty.call(frame.data, "frames")) {
      return frame;
    }
    const data = { ...frame.data };
    delete data.frames;
    return { ...frame, data };
  }
  async liftNestedFramesIntoSpace(frame) {
    const nested = frame?.data?.frames;
    if (!nested || typeof nested !== "object")
      return;
    for (const fr of Object.values(nested)) {
      if (fr && typeof fr === "object" && fr.ib && fr.gib) {
        try {
          await this.putTipFrame(fr);
        } catch {
        }
      }
    }
  }
  async getBin(sha) {
    const key = String(sha || "").trim().toLowerCase();
    if (!key)
      return null;
    return await this.storageImpl.getBin(key);
  }
  async putBin(sha, record) {
    const key = String(sha || "").trim().toLowerCase();
    if (!key)
      throw new Error("[navi] bin sha required");
    if (!record || typeof record.media !== "string") {
      throw new Error("[navi] bin requires { media, mime }");
    }
    await this.storageImpl.putBin(key, {
      media: record.media,
      mime: record.mime || "application/octet-stream"
    });
  }
  async deleteBin(sha) {
    const key = String(sha || "").trim().toLowerCase();
    if (!key)
      return;
    await this.storageImpl.deleteBin(key);
  }
  async listBinShas() {
    return await this.storageImpl.listBins();
  }
  async loadBinMediaFromTip(ib) {
    const tip = await this.getTip(ib);
    if (!tip?.data) {
      const hostMedia = await this.fetchHostModuleMedia(ib);
      if (hostMedia)
        return hostMedia;
      throw new Error(`[navi] no tip for ${normalizeTipIb(ib)}`);
    }
    const refs = Array.isArray(tip.rel8ns?.bin) ? tip.rel8ns.bin : [];
    const ref = refs[0];
    const sha = String(ref || "").trim().match(/^bin\s+([0-9a-fA-F]+)$/)?.[1]?.toLowerCase();
    if (!sha) {
      const hostMedia = await this.fetchHostModuleMedia(ib) || await this.fetchWarezSubjectMedia(tip);
      if (hostMedia)
        return hostMedia;
      throw new Error(
        `[navi] tip ${normalizeTipIb(ib)} has no rel8ns.bin (plant module bin first)`
      );
    }
    const bin = await this.getBin(sha);
    if (!bin?.media) {
      const hostMedia = await this.fetchHostModuleMedia(ib) || await this.fetchWarezSubjectMedia(tip);
      if (hostMedia)
        return hostMedia;
      throw new Error(`[navi] missing bin ${sha} for tip ${normalizeTipIb(ib)}`);
    }
    return bin.media;
  }
  async ensureUnit() {
    await this.ensureEntryPlugSecret();
    if (this.entryPlug) {
      const view2 = await this.touchEntryPlug();
      return { ...view2, created: false };
    }
    const root = await this.getTip(NAVI_ROOT_IB);
    if (!root?.data) {
      throw new Error("navi root tip missing \u2014 cannot mint unit");
    }
    const units = await this.loadUnitsState();
    if (!Array.isArray(units.list))
      units.list = [];
    if (!units.aliases || typeof units.aliases !== "object") {
      units.aliases = {};
    }
    const nextNum = Math.max(
      1,
      Number(units.next) || units.list.length + 1
    );
    const unitId = String(nextNum).padStart(2, "0");
    const unitIb = unitParkIb(unitId);
    const mintMaterial = `${await this.getInstallUuid() || ""}|${unitIb}|${naviStamp.time()}|${Math.random()}`;
    const hash = (await this.sha256Hex(mintMaterial)).toLowerCase();
    const now = naviStamp.time();
    const unitFrame = {
      ib: unitIb,
      gib: "<seed-gib>",
      data: {
        parts: ["navi_unit", "navi_park", "ibgib_frame", "manifest", "json"],
        park: "capture",
        default_method: "GET",
        method: {
          GET: { kind: "frame", mode: "sync" },
          PUT: { kind: "commit", mode: "async" },
          PATCH: { kind: "commit", mode: "async" },
          DELETE: { kind: "tombstone", mode: "async" }
        },
        about: {
          label: unitIb,
          description: "runtime unit tip \u2014 hash, online, mods claim"
        },
        unit: {
          id: unitId,
          hash,
          alias: null,
          online: true,
          last_entry_plug_at: now,
          mods: {}
        },
        timestamp: now
      },
      rel8ns: {
        past: [],
        tjp: [],
        dna: [],
        root: [NAVI_ROOT_IB]
      }
    };
    const stamped = await this.stampTipFrame(unitFrame, now);
    await this.setTip(stamped);
    const listRow = {
      id: unitId,
      ib: unitIb,
      hash,
      online: true,
      heartbeat_at: now,
      created_at: now
    };
    units.list = [...units.list, listRow];
    units.next = nextNum + 1;
    if (!units.resolution) {
      units.resolution = { mode: "default_unit", default: null };
    }
    if (!units.resolution.default) {
      units.resolution.default = unitIb;
    }
    const priorUnitRel = Array.isArray(root.rel8ns?.unit) ? root.rel8ns.unit.slice() : [];
    if (!priorUnitRel.includes(unitIb))
      priorUnitRel.push(unitIb);
    await this.saveUnitsState(units);
    await this.mut8Tip(root, {}, { rel8ns: { unit: priorUnitRel } });
    this.entryPlug = {
      unitIb,
      unitId,
      hash,
      stamp: naviStamp(),
      last_seen: now
    };
    this.callout(`[navi] unit bound ${unitIb} (hash ${hash.slice(0, 8)}\u2026)`);
    this.armUnitHeartbeat();
    const view = await this.signedEntryPlugView({ reveal: true });
    return { ...view, created: true };
  }
  async loadUnitsState() {
    const empty = this.emptyUnitsState();
    const sys = await this.getTip(NAVI_UNIT_SYSTEM_IB);
    let units = sys?.data?.units && typeof sys.data.units === "object" ? { ...empty, ...sys.data.units } : { ...empty };
    const root = await this.getTip(NAVI_ROOT_IB);
    if (root?.data?.units && typeof root.data.units === "object" && (!Array.isArray(units.list) || units.list.length === 0) && Array.isArray(root.data.units.list) && root.data.units.list.length) {
      units = { ...empty, ...root.data.units };
      await this.saveUnitsState(units);
      return this.normalizeUnitsState(units);
    }
    return this.normalizeUnitsState(units);
  }
  emptyUnitsState() {
    return {
      next: 1,
      list: [],
      aliases: {},
      resolution: {
        mode: "default_unit",
        default: null
      },
      heartbeat: {
        interval_sec: 180,
        stale_sec: 240,
        n_max: 20
      }
    };
  }
  normalizeUnitsState(raw) {
    const empty = this.emptyUnitsState();
    const units = { ...empty, ...raw };
    if (!Array.isArray(units.list))
      units.list = [];
    if (!units.aliases || typeof units.aliases !== "object") {
      units.aliases = {};
    }
    units.heartbeat = this.normalizeHeartbeat(units.heartbeat);
    return units;
  }
  normalizeHeartbeat(raw) {
    const h = raw && typeof raw === "object" ? raw : {};
    let interval = Number(h.interval_sec);
    const legacyMutate = Number(h.mutate_interval_sec);
    if (Number.isFinite(legacyMutate) && legacyMutate >= 60) {
      interval = legacyMutate;
    } else if (!Number.isFinite(interval) || interval < 60) {
      interval = 180;
    }
    let stale = Number(h.stale_sec);
    if (!Number.isFinite(stale) || stale < interval) {
      stale = Math.max(interval + 60, 240);
    }
    const nMax = Number(h.n_max);
    return {
      interval_sec: Math.max(60, Math.floor(interval)),
      stale_sec: Math.max(60, Math.floor(stale)),
      n_max: Number.isFinite(nMax) && nMax >= 1 ? Math.floor(nMax) : 20,
      ...h.note != null ? { note: String(h.note) } : {}
    };
  }
  async saveUnitsState(units) {
    const normalized = this.normalizeUnitsState(units);
    let sys = await this.getTip(NAVI_UNIT_SYSTEM_IB);
    if (!sys?.data) {
      throw new Error(`${NAVI_UNIT_SYSTEM_IB} tip missing`);
    }
    sys = await this.mut8Tip(sys, { units: normalized });
    const hb = this.normalizeHeartbeat(normalized.heartbeat);
    if (hb.n_max >= 1) {
      const count = (await this.listTipFrames(NAVI_UNIT_SYSTEM_IB)).length;
      if (count >= hb.n_max)
        await this.rolloverUnitSystem();
    }
  }
  async rolloverUnitSystem() {
    const sys = await this.getTip(NAVI_UNIT_SYSTEM_IB);
    const hb = this.normalizeHeartbeat(
      sys?.data?.units?.heartbeat || (await this.loadUnitsState()).heartbeat
    );
    const count = (await this.listTipFrames(NAVI_UNIT_SYSTEM_IB)).length;
    if (count < hb.n_max)
      return;
    const units = sys?.data?.units && typeof sys.data.units === "object" ? this.normalizeUnitsState(sys.data.units) : await this.loadUnitsState();
    await this.rolloverUnitSystemTip(units);
  }
  async rolloverUnitSystemTip(units) {
    const tip = await this.getTip(NAVI_UNIT_SYSTEM_IB);
    if (!tip?.data) {
      throw new Error(`${NAVI_UNIT_SYSTEM_IB} tip missing`);
    }
    const tipIb = NAVI_UNIT_SYSTEM_IB;
    const priorGib = String(tip.gib || "").trim();
    const priorAddr = priorGib ? `${tipIb}^${priorGib}` : null;
    if (priorGib) {
      await this.putTipFrame({ ...tip, ib: tipIb, gib: priorGib });
      await this.liftNestedFramesIntoSpace(tip);
    }
    const prunedFrames = (await this.listTipFrames(tipIb)).length;
    const now = naviStamp.time();
    const nextUnits = this.normalizeUnitsState(units);
    const rollover = {
      of: priorAddr,
      pruned_frames: prunedFrames,
      at: now
    };
    const baseData = tip.data && typeof tip.data === "object" ? { ...tip.data } : {};
    delete baseData.n;
    const frame = {
      ...tip,
      ib: tipIb,
      gib: "<seed-gib>",
      data: {
        ...baseData,
        units: nextUnits,
        timestamp: now,
        rollover
      },
      rel8ns: {
        ...tip.rel8ns || {},
        past: priorAddr ? [priorAddr] : []
      }
    };
    const stamped = await this.stampTipFrame(frame, now);
    await this.setTip(stamped);
    const liveAddr = `${tipIb}^${String(stamped.gib || "").trim()}`;
    await this.pruneUnitSystemFrameIndex(tip, {
      keep: [priorAddr, liveAddr].filter(Boolean)
    });
  }
  async pruneUnitSystemFrameIndex(tip, opts) {
    const tipIb = NAVI_UNIT_SYSTEM_IB;
    const keep = new Set(
      (opts.keep || []).map((a) => String(a || "").trim()).filter((a) => a.includes("^"))
    );
    const seen = /* @__PURE__ */ new Set();
    const drop = async (addr) => {
      const a = String(addr || "").trim();
      if (!a || !a.includes("^") || seen.has(a) || keep.has(a))
        return;
      seen.add(a);
      await this.deleteTipFrame(a);
    };
    const addrs = await this.listTipFrames(tipIb);
    for (const addr of addrs) {
      await drop(addr);
    }
    const past = Array.isArray(tip.rel8ns?.past) ? tip.rel8ns.past : [];
    for (const addr of past) {
      await drop(String(addr || ""));
    }
  }
  async resolveUnitDefault(arg) {
    const units = await this.loadUnitsState();
    const next = String(arg || "").trim();
    if (!next) {
      return units.resolution || null;
    }
    const ib = canonicalizeTipIb(
      next.startsWith("navi") ? next : unitParkIb(next)
    );
    units.resolution = {
      ...units.resolution || {},
      mode: "default_unit",
      default: ib
    };
    await this.saveUnitsState(units);
    return units.resolution;
  }
  async heartbeatUnitControl(arg) {
    const units = await this.loadUnitsState();
    const sec = Number(arg);
    if (!Number.isFinite(sec)) {
      return units.heartbeat || this.emptyUnitsState().heartbeat;
    }
    const next = Math.max(60, Math.floor(sec));
    units.heartbeat = {
      ...this.normalizeHeartbeat(units.heartbeat),
      interval_sec: next,
      stale_sec: Math.max(next + 60, 240)
    };
    await this.saveUnitsState(units);
    this.armUnitHeartbeat();
    return units.heartbeat;
  }
  async touchEntryPlug() {
    await this.ensureEntryPlugSecret();
    if (!this.entryPlug) {
      throw new Error("[plug touch] entry-plug not bound \u2014 plug ensure first");
    }
    const stamp = naviStamp();
    this.entryPlug = {
      ...this.entryPlug,
      stamp,
      last_seen: stamp.timestamp
    };
    return this.signedEntryPlugView({ reveal: false });
  }
  armUnitHeartbeat() {
    if (this.unitHeartbeatTimer) {
      clearInterval(this.unitHeartbeatTimer);
      this.unitHeartbeatTimer = null;
    }
    const tick = async () => {
      try {
        await this.unitHeartbeatSweep();
      } catch (e) {
        this.callout(
          `[navi] unit heartbeat: ${formatCalloutMessage(e)}`
        );
      }
    };
    void (async () => {
      const units = await this.loadUnitsState();
      const sec = this.normalizeHeartbeat(units.heartbeat).interval_sec;
      await tick();
      this.unitHeartbeatTimer = setInterval(tick, sec * 1e3);
    })();
  }
  async unitHeartbeatSweep() {
    const units = await this.loadUnitsState();
    const hb = this.normalizeHeartbeat(units.heartbeat);
    const now = naviStamp.time();
    const cutoff = Date.now() - hb.stale_sec * 1e3;
    const bonded = await this.isEntryPlugBonded();
    const selfIb = bonded ? this.entryPlug.unitIb : null;
    if (selfIb && this.entryPlug) {
      this.entryPlug = {
        ...this.entryPlug,
        stamp: naviStamp(),
        last_seen: now
      };
    }
    const list = (units.list || []).map((row) => {
      if (!row?.ib)
        return row;
      if (selfIb && tipIbsMatch(String(row.ib), selfIb)) {
        return {
          ...row,
          online: true,
          heartbeat_at: now
        };
      }
      const last = row.heartbeat_at;
      const t = last ? Date.parse(String(last)) : NaN;
      if (!Number.isFinite(t) || t < cutoff) {
        return { ...row, online: false };
      }
      return row;
    });
    units.list = list;
    units.heartbeat = hb;
    await this.saveUnitsState(units);
  }
  async ensureEntryPlugSecret() {
    if (this.entryPlugSecret)
      return;
    const subtle = globalThis.crypto?.subtle;
    if (subtle && typeof subtle.generateKey === "function") {
      try {
        const pair = await subtle.generateKey(
          { name: "Ed25519" },
          false,
          ["sign", "verify"]
        );
        const raw = new Uint8Array(
          await subtle.exportKey("raw", pair.publicKey)
        );
        this.entryPlugSecret = {
          privateKey: pair.privateKey,
          subtlePublic: pair.publicKey,
          publicKeyRaw: bytesToBase64Url(raw),
          backend: "subtle"
        };
        return;
      } catch {
      }
    }
    try {
      const nodeCrypto = await import("crypto");
      const { publicKey, privateKey } = nodeCrypto.generateKeyPairSync(
        "ed25519"
      );
      const spki = publicKey.export({ type: "spki", format: "der" });
      const raw = spki.length >= 32 ? Uint8Array.from(spki).subarray(spki.length - 32) : Uint8Array.from(spki);
      this.entryPlugSecret = {
        privateKey,
        nodePublic: publicKey,
        publicKeyRaw: bytesToBase64Url(raw),
        backend: "node"
      };
    } catch (err) {
      throw new Error(
        `[navi] entry-plug Ed25519 keygen failed: ${formatCalloutMessage(err)}`
      );
    }
  }
  async signEntryPlugBytes(data) {
    await this.ensureEntryPlugSecret();
    const secret = this.entryPlugSecret;
    if (secret.backend === "subtle") {
      const sig2 = await globalThis.crypto.subtle.sign(
        { name: "Ed25519" },
        secret.privateKey,
        data
      );
      return new Uint8Array(sig2);
    }
    const nodeCrypto = await import("crypto");
    const sig = nodeCrypto.sign(
      null,
      Buffer.from(data),
      secret.privateKey
    );
    return new Uint8Array(sig);
  }
  async signedEntryPlugView(opts) {
    await this.ensureEntryPlugSecret();
    const secret = this.entryPlugSecret;
    const bound = !!(this.entryPlug?.unitIb && this.entryPlug?.hash);
    const body = {
      alg: "Ed25519",
      bound,
      kind: "surface",
      publicKey: secret.publicKeyRaw,
      target: "plug",
      unitIb: bound ? this.entryPlug.unitIb : null
    };
    if (bound && this.entryPlug) {
      body.last_seen = this.entryPlug.last_seen;
      body.stamp = this.entryPlug.stamp;
      body.unitId = this.entryPlug.unitId;
      if (opts.reveal)
        body.hash = this.entryPlug.hash;
    }
    if (opts.created != null)
      body.created = opts.created;
    if (!opts.reveal) {
      body.access = {
        GET: "presence (signed)",
        POST: "ping|touch|ensure \u2014 ping confirms before hash reveal"
      };
    }
    const signed = stableJson(body);
    const signature = bytesToBase64Url(
      await this.signEntryPlugBytes(new TextEncoder().encode(signed))
    );
    return {
      ...body,
      signed,
      signature,
      proof: {
        scheme: "Ed25519-detached",
        signed_by: "entry-plug private key",
        verify_with: "publicKey",
        note: ENTRY_PLUG_PROOF_NOTE
      }
    };
  }
  async aliasUnit(unitRef, aliasRaw) {
    const alias = String(aliasRaw || "").trim().replace(/^navi[/:]/, "");
    if (!alias || /[/:]/.test(alias)) {
      throw new Error(
        "Usage: alias <unitIb|01> <name>  (single segment, no / or :)"
      );
    }
    const reserved = /* @__PURE__ */ new Set([
      "mod",
      "relay",
      "storage",
      "init_script",
      "unit",
      "plug",
      "admin",
      "shell",
      "surf",
      "mount",
      "browse",
      "unmount",
      "surfrefresh",
      "stamp",
      "origin",
      "park",
      "pwa",
      "sw",
      "fetch",
      "reseed",
      "factoryreset",
      "alias",
      "prune",
      "resolve",
      "heartbeat",
      "reindex"
    ]);
    if (reserved.has(alias)) {
      throw new Error(`alias '${alias}' is reserved`);
    }
    const fromIb = canonicalizeTipIb(
      String(unitRef || "").startsWith("navi") ? String(unitRef) : unitParkIb(unitRef)
    );
    const from = await this.getTip(fromIb);
    if (!from?.data?.unit?.hash) {
      throw new Error(`not a unit tip: ${fromIb}`);
    }
    const toIb = presumeNaviIb(alias);
    if (await this.getTip(toIb)) {
      throw new Error(`tip already exists: ${toIb}`);
    }
    const now = naviStamp.time();
    const stamped = await this.stampTipFrame(
      {
        ib: toIb,
        gib: "<seed-gib>",
        data: {
          ...from.data,
          unit: {
            ...from.data.unit,
            alias,
            id: from.data.unit.id,
            hash: from.data.unit.hash
          },
          timestamp: now,
          n: void 0
        },
        rel8ns: {
          past: [],
          tjp: [],
          dna: [],
          root: [NAVI_ROOT_IB],
          was: [fromIb]
        }
      },
      now
    );
    await this.setTip(stamped);
    await this.hardEraseTip(fromIb);
    const root = await this.getTip(NAVI_ROOT_IB);
    if (!root?.data)
      throw new Error("navi root missing");
    const units = await this.loadUnitsState();
    units.aliases = { ...units.aliases || {}, [alias]: toIb };
    units.list = Array.isArray(units.list) ? units.list.map(
      (row) => row && tipIbsMatch(String(row.ib || ""), fromIb) ? { ...row, ib: toIb, alias } : row
    ) : [];
    if (units.resolution?.default && tipIbsMatch(String(units.resolution.default), fromIb)) {
      units.resolution = { ...units.resolution, default: toIb };
    }
    const priorUnitRel = Array.isArray(root.rel8ns?.unit) ? root.rel8ns.unit.filter(
      (u) => !tipIbsMatch(String(u), fromIb)
    ) : [];
    priorUnitRel.push(toIb);
    await this.saveUnitsState(units);
    await this.mut8Tip(root, {}, { rel8ns: { unit: priorUnitRel } });
    if (this.entryPlug && tipIbsMatch(this.entryPlug.unitIb, fromIb)) {
      this.entryPlug = {
        ...this.entryPlug,
        unitIb: toIb
      };
    }
    return `[navi] aliased ${fromIb} \u2192 ${toIb}`;
  }
  async pruneUnits(mode) {
    await this.requireEntryPlugGate("prune");
    const root = await this.getTip(NAVI_ROOT_IB);
    if (!root?.data)
      throw new Error("navi root missing");
    const units = await this.loadUnitsState();
    const list = Array.isArray(units.list) ? units.list.slice() : [];
    const wantAll = mode === "all";
    const victims = list.filter((row) => {
      if (!row?.ib)
        return false;
      if (wantAll)
        return true;
      return row.online === false;
    });
    if (!victims.length) {
      return `[navi] prune: nothing to remove (${mode})`;
    }
    const removed = [];
    for (const row of victims) {
      const ib = canonicalizeTipIb(String(row.ib));
      if (this.entryPlug && tipIbsMatch(this.entryPlug.unitIb, ib)) {
        throw new Error(
          `cannot prune live entry-plug unit ${ib} \u2014 close that instance first`
        );
      }
      try {
        await this.hardEraseTip(ib);
      } catch (e) {
      }
      removed.push(ib);
      if (row.alias && units.aliases) {
        delete units.aliases[row.alias];
      }
    }
    units.list = list.filter(
      (row) => !victims.some(
        (v) => tipIbsMatch(String(v.ib || ""), String(row.ib || ""))
      )
    );
    if (units.resolution?.default && removed.some(
      (ib) => tipIbsMatch(ib, String(units.resolution.default))
    )) {
      units.resolution = {
        ...units.resolution,
        default: units.list[0]?.ib || null
      };
    }
    const priorUnitRel = Array.isArray(root.rel8ns?.unit) ? root.rel8ns.unit.filter(
      (u) => !removed.some((ib) => tipIbsMatch(ib, String(u)))
    ) : [];
    await this.saveUnitsState(units);
    await this.mut8Tip(root, {}, { rel8ns: { unit: priorUnitRel } });
    return `[navi] pruned ${removed.join(", ")}`;
  }
  async ensureNaviReduxSeeds() {
    const planted = [];
    const skipped = [];
    for (const seed of NAVI_REDUX_SEED_TIPS) {
      const ib = String(seed.ib || "").trim();
      if (!ib)
        continue;
      const existing = await this.getTip(ib);
      if (existing?.ib) {
        skipped.push(ib);
        continue;
      }
      const isNaviRoot = canonicalizeTipIb(ib) === "navi";
      const rootStamp = isNaviRoot ? naviStamp() : null;
      const seedWithIdentity = rootStamp ? {
        ...seed,
        data: {
          ...seed.data || {},
          ...rootStamp
        }
      } : seed;
      const frame = await this.stampTipFrame(
        seedWithIdentity,
        rootStamp?.timestamp
      );
      await this.setTip(frame);
      planted.push(ib);
    }
    if (planted.length) {
      this.callout(`[navi] Planted tip seeds: ${planted.join(", ")}`);
    }
    return { planted, skipped };
  }
  filterInitScriptLines(lines) {
    const isDom = typeof window !== "undefined" && typeof document !== "undefined";
    if (isDom)
      return lines.map(String);
    return lines.map(String).filter((line) => !/\bwindow\b/.test(line) && !/\bdocument\b/.test(line));
  }
  async ensureInitScript() {
    try {
      await this.createDefaultModule();
      const tip = await this.getTip(NAVI_INIT_SCRIPT_IB);
      if (!tip?.data || !Array.isArray(tip.data.script) || !tip.data.script.length) {
        throw new Error(
          `${NAVI_INIT_SCRIPT_IB} tip missing or empty data.script \u2014 plant seeds first`
        );
      }
      const lines = this.filterInitScriptLines(tip.data.script);
      this.callout(
        `[navi] Loaded init_script from tip ${NAVI_INIT_SCRIPT_IB} (${lines.length} commands)`
      );
      return lines;
    } catch (error) {
      this.callout("[navi] Failed to load init_script: " + error);
      throw error;
    }
  }
  async saveInitScript(commands) {
    const tip = await this.getTip(NAVI_INIT_SCRIPT_IB);
    if (!tip) {
      throw new Error("navi:init_script tip missing");
    }
    const next = await this.stampTipFrame({
      ...tip,
      data: {
        ...tip.data,
        script: commands,
        n: void 0
      },
      rel8ns: {
        ...tip.rel8ns || {},
        past: tip.gib ? [tip.ib + "^" + tip.gib] : []
      }
    });
    await this.setTip(next);
  }
  async script(commands, opts = {}) {
    const mode = opts.mode === "callin" ? "callin" : "js";
    const args = (opts.args || []).map(String);
    const onError = opts.onError === "stop" ? "stop" : "continue";
    const label = opts.label ? ` ${opts.label}` : "";
    let d = new Date();
    let hh = String(d.getHours()).padStart(2, "0");
    let mm = String(d.getMinutes()).padStart(2, "0");
    let ss = String(d.getSeconds()).padStart(2, "0");
    let tag = `${hh}${mm}${ss}`;
    const scriptCallout = (data) => {
      this.emit("callout", `[SCRIPT:${tag}${label}] ${formatCalloutMessage(data)}`);
    };
    const lines = (commands || []).map((c) => String(c ?? "").replace(/^\uFEFF/, "").trim()).filter((c) => c && !c.startsWith("#") && !c.startsWith("//")).map(
      (c) => mode === "callin" ? c.replace(/\$@/g, args.join(" ")).replace(/\$(\d+)/g, (_m, n) => args[Number(n) - 1] ?? "").trim() : c
    ).filter(Boolean);
    const out = { ran: 0, results: [] };
    if (lines.length === 0) {
      scriptCallout("[navi] No commands in script to execute");
      return out;
    }
    if (this.scriptDepth >= NAVI_SCRIPT_MAX_DEPTH) {
      throw new Error(`navi.script${label}: nesting exceeds ${NAVI_SCRIPT_MAX_DEPTH}`);
    }
    scriptCallout(`[navi] Executing ${lines.length} ${mode} commands from script...`);
    this.scriptDepth++;
    try {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        try {
          scriptCallout(`[navi] Executing command ${i + 1}/${lines.length}`);
          const result = mode === "callin" ? await this.dispatchCallin({
            input: line,
            method: "POST",
            viaRelay: !!opts.viaRelay
          }) : await this.executeCommand(line, args);
          out.results.push({ line, ok: true, result });
          out.ran++;
          scriptCallout(`[navi] Command ${i + 1} executed successfully`);
        } catch (error) {
          const msg = formatCalloutMessage(error);
          out.results.push({ line, ok: false, error: msg });
          scriptCallout(`[navi] Command ${i + 1} failed: ${line} \u2014 ${msg}`);
          if (onError === "stop") {
            throw new Error(`navi.script${label}: '${line}' failed: ${msg}`);
          }
        }
      }
    } finally {
      this.scriptDepth--;
    }
    scriptCallout("[navi] Script execution completed");
    return out;
  }
  async addToInitScript(command) {
    const commands = await this.getInitScript();
    commands.push(command);
    await this.saveInitScript(commands);
    this.callout(`[navi] Added command to init_script: ${command}`);
  }
  async clearInitScript() {
    await this.saveInitScript([]);
    this.callout("[navi] init_script cleared");
  }
  async getInitScript() {
    const tip = await this.getTip(NAVI_INIT_SCRIPT_IB);
    const script = tip?.data?.script;
    return Array.isArray(script) ? script.map(String) : [];
  }
  async executeCommand(command, args) {
    const prevArgs = globalThis.__naviScriptArgs;
    try {
      let trimmed = String(command ?? "").replace(/^\uFEFF/, "").trim();
      if (!trimmed) {
        this.callout("[navi] Empty command provided; skipping");
        return;
      }
      if (args?.length && !/(^|\s)(import\s|export\s)/.test(trimmed)) {
        globalThis.__naviScriptArgs = args.slice();
        trimmed = "const args = (globalThis.__naviScriptArgs || []).slice(); const [$1, $2, $3, $4, $5, $6, $7, $8, $9] = args;\n" + trimmed;
      }
      const isBrowser = typeof window !== "undefined" && typeof window.document !== "undefined";
      if (!isBrowser && /\b(?:window|document|htmx)\b/.test(trimmed)) {
        this.callout("[navi] Skipping browser-only init command in Node");
        return;
      }
      const hasTopLevelModuleSyntax = /(^|\s)(import\s|export\s)/.test(trimmed);
      if (!isBrowser) {
        if (!hasTopLevelModuleSyntax) {
          const runner = new Function(`"use strict"; return (async () => {
${trimmed}
})();`);
          await runner();
          return;
        } else {
          try {
            const { fs, join, tmpdir } = await getNodeFsPathOs();
            const filePath = join(tmpdir(), `navi-cmd-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`);
            const moduleSource = `${trimmed}

export default undefined;`;
            await fs.writeFile(filePath, moduleSource, "utf8");
            const fileUrl = `file:///${filePath.replace(/\\/g, "/")}`;
            await import(fileUrl);
            return;
          } catch (nodeExecErr) {
            this.callout("[navi] Node file-based execution failed: " + nodeExecErr);
            throw nodeExecErr;
          }
        }
      }
      const once = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      const moduleCode = hasTopLevelModuleSyntax ? `${trimmed}

export default undefined;
// ${once}
` : `export default (async () => {
${trimmed}
})();
// ${once}
`;
      let moduleUrl;
      try {
        const base64 = typeof Buffer !== "undefined" ? Buffer.from(moduleCode, "utf8").toString("base64") : btoa(moduleCode);
        moduleUrl = `data:text/javascript;charset=utf-8;base64,${base64}`;
      } catch {
        moduleUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(moduleCode)}`;
      }
      const mod = await import(moduleUrl);
      if (mod && "default" in mod) {
        await mod.default;
      }
    } catch (error) {
      this.callout("[navi] Error executing command: " + error);
      throw error;
    } finally {
      globalThis.__naviScriptArgs = prevArgs;
    }
  }
  async createDefaultModule() {
    try {
      const surfModuleCode = `export const register = (navi) => {
                const SURF_TIP = "surf";
                const NAVI_MODULE_MIME = "application/navi-module";
                const IB_GIB_HEADER = "x-ib^gib";
                const DEFAULT_SETTINGS = { savesurfs: false, proscene: false };
                const SHELTER_PART = "surf-shelter";
                /** @type {Set<Element>} insertion-ordered immune nodes (strong refs). */
                const persisted = new Set();
                let shelterEl = null;

                function getBaseMime(contentType) {
                    return String(contentType || "").split(";")[0].trim().toLowerCase();
                }

                function isNaviModuleMime(contentType) {
                    return getBaseMime(contentType) === NAVI_MODULE_MIME;
                }

                function isJavaScriptMime(contentType) {
                    const base = getBaseMime(contentType);
                    return base === "text/javascript" || base === "application/javascript" || base === "application/x-javascript";
                }

                function isNaviModuleSource(content) {
                    const hasRegister = /export\\s+(?:const|function)\\s+register\\s*[=({]/.test(content);
                    const hasModuleInfo = /export\\s+const\\s+moduleInfo\\s*=\\s*\\{[^}]*\\bname\\s*:\\s*["'][^"']+["']/.test(content);
                    const hasDefaultExport = /export\\s+default\\s+\\{[^}]*\\bname\\s*:\\s*["'][^"']+["']/.test(content);
                    return hasRegister || (hasModuleInfo && hasDefaultExport);
                }

                function isNaviModule(content, contentType) {
                    if (isNaviModuleMime(contentType)) return true;
                    return isJavaScriptMime(contentType) && isNaviModuleSource(content);
                }

                /**
                 * slashfold \u2014 typed whitespace \u2192 / (like surf/browse arg join).
                 * Does NOT fold :, so navi:hypertext welcome \u2192 navi:hypertext/welcome.
                 * Preserves // stage delimiters. Absolute URLs unchanged.
                 * String \u2192 string; Uint8Array/ArrayBufferView \u2192 same type (utf-8).
                 * @see A_document/slashfold.md
                 */
                function slashfoldString(raw) {
                    let s = String(raw == null ? "" : raw).trim();
                    if (!s) return "";
                    if (/^[a-z][a-z0-9+.-]*:\\/\\//i.test(s)) return s;
                    return s
                        .replace(/\\s+/g, "/")
                        .replace(/^\\/+/, "")
                        .replace(/\\/{3,}/g, "//");
                }

                async function storageKeyExists(s) {
                    try {
                        if (navi.storage && navi.storage.tip && typeof navi.storage.tip.get === "function") {
                            const tip = await navi.storage.tip.get(s);
                            if (tip) return true;
                        }
                    } catch (e) { /* ignore */ }
                    return false;
                }

                /**
                 * slashfold \u2014 typed whitespace \u2192 / unless the exact storage key exists.
                 * If the string has whitespace and that tip/file key is present, keep it.
                 * Else whitespace \u2192 / (keeps navi: and //). Absolute URLs unchanged.
                 * Async. @see A_document/slashfold.md
                 */
                async function slashfold(input) {
                    if (input == null) return input;
                    const foldText = async (text) => {
                        const s = String(text == null ? "" : text).trim();
                        if (!s) return "";
                        if (/^[a-z][a-z0-9+.-]*:\\/\\//i.test(s)) return s;
                        if (/\\s/.test(s) && await storageKeyExists(s)) return s;
                        return slashfoldString(s);
                    };
                    if (typeof input === "string") return await foldText(input);
                    if (typeof Uint8Array !== "undefined" && input instanceof Uint8Array) {
                        const text = new TextDecoder().decode(input);
                        return new TextEncoder().encode(await foldText(text));
                    }
                    if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView && ArrayBuffer.isView(input)) {
                        const u8 = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
                        const text = new TextDecoder().decode(u8);
                        const out = new TextEncoder().encode(await foldText(text));
                        if (input instanceof Uint8Array) return out;
                        return out;
                    }
                    return await foldText(String(input));
                }

                async function ensureSettings() {
                    const tip = await navi.storage.tip.get(SURF_TIP);
                    if (!tip || !tip.data) {
                        throw new Error("[surf] " + SURF_TIP + " tip missing");
                    }
                    if (!tip.data.settings || typeof tip.data.settings !== "object") {
                        await navi.storage.tip.mut8(SURF_TIP, {
                            settings: Object.assign({}, DEFAULT_SETTINGS)
                        });
                        navi.callout("[surf] Initialized settings on " + SURF_TIP);
                        const again = await navi.storage.tip.get(SURF_TIP);
                        return again.data.settings;
                    }
                    return tip.data.settings;
                }

                async function saveSettings(settings) {
                    await navi.storage.tip.mut8(SURF_TIP, { settings: settings });
                }

                async function saveResourceBin(media, mime) {
                    return await navi.storage.bin.putMedia({ media: media, mime: mime });
                }

                /** Sync install id for data-hash (same scheme as horizon_stagedir). */
                function hashContentSync(text) {
                    const s = String(text == null ? "" : text);
                    let h = 0x811c9dc5;
                    for (let i = 0; i < s.length; i++) {
                        h ^= s.charCodeAt(i);
                        h = Math.imul(h, 0x01000193);
                    }
                    const stamp =
                        Date.now().toString(16) +
                        (Math.floor(Math.random() * 0x10000) >>> 0)
                            .toString(16)
                            .padStart(4, "0");
                    return (
                        (h >>> 0).toString(16).padStart(8, "0") +
                        s.length.toString(16).padStart(6, "0") +
                        stamp
                    );
                }

                function stampDataHash(el, contentHash) {
                    if (!el || el.nodeType !== 1 || !contentHash) return;
                    if (el.hasAttribute("data-hash")) return;
                    el.setAttribute("data-hash", String(contentHash));
                }

                async function loadResourceFromTip(ib) {
                    const media = await navi.storage.bin.mediaFromTip(ib);
                    return { mime: NAVI_MODULE_MIME, media: media };
                }

                async function makeRequest(path, options = {}) {
                    const raw = String(path == null ? "" : path).trim();
                    const local = await navi.park.check(raw, {
                        gatePassthru: (function (h) {
                            if (!h) return false;
                            const v = String(h["X-Navi-Gate-Passthru"] || h["x-navi-gate-passthru"] || "").trim().toLowerCase();
                            return v === "1" || v === "true" || v === "yes";
                        })(options && options.headers)
                    });
                    if (local && local.hit) {
                        return {
                            content: local.body,
                            contentType: local.mime || "application/octet-stream",
                            ibGib: local.ib || null
                        };
                    }

                    const url = encodeURI(navi.resolveUrl(path));
                    const headers = Object.assign({
                        "Accept": "text/plain, text/javascript, application/javascript, application/navi-module",
                        "Content-Type": "text/plain"
                    }, options && options.headers ? options.headers : {});

                    const response = await globalThis.fetch(url, {
                        method: options.method || "GET",
                        headers
                    });
                    if (!response.ok) {
                        throw new Error("HTTP " + response.status + ": " + response.statusText);
                    }

                    const content = await response.text();
                    const contentType = response.headers.get("content-type") || "";
                    const ibGib = response.headers.get(IB_GIB_HEADER);
                    return { content, contentType, ibGib };
                }

                function ensureShelter() {
                    if (typeof document === "undefined" || !document.documentElement) {
                        throw new Error("[surf] persist shelter requires a document");
                    }
                    if (shelterEl && shelterEl.isConnected) return shelterEl;
                    shelterEl = document.createElement("div");
                    shelterEl.setAttribute("data-part", SHELTER_PART);
                    shelterEl.setAttribute("hidden", "");
                    shelterEl.style.display = "none";
                    document.documentElement.appendChild(shelterEl);
                    return shelterEl;
                }

                /** Move a live node via moveBefore() when both ends are connected, so iframes/video keep state. */
                function placeLive(parent, el, ref) {
                    const before = ref || null;
                    if (typeof parent.moveBefore === "function" && el.isConnected && parent.isConnected) {
                        try {
                            parent.moveBefore(el, before);
                            return;
                        } catch { /* fall through */ }
                    }
                    parent.insertBefore(el, before);
                }

                function persist(el) {
                    if (!el || el.nodeType !== 1) {
                        throw new Error("[surf] persist requires an Element");
                    }
                    persisted.add(el);
                    return el;
                }

                function unpersist(el) {
                    return persisted.delete(el);
                }

                function isPersisted(el) {
                    return persisted.has(el);
                }

                function listPersisted() {
                    return Array.from(persisted);
                }

                function parkPersisted() {
                    if (!document.body || persisted.size === 0) return;
                    const shelter = ensureShelter();
                    for (const el of Array.from(persisted)) {
                        if (document.body.contains(el)) {
                            shelter.appendChild(el);
                        }
                    }
                }

                function restorePersisted() {
                    if (!document.body) return;
                    for (const el of Array.from(persisted)) {
                        if (el.isConnected) {
                            document.body.appendChild(el);
                        } else {
                            persisted.delete(el);
                        }
                    }
                }

                /** stagejockey's prosceneBody(nodes) \u2192 CS element, or null when not mounted. */
                function findProsceneBody() {
                    const mods = navi.mod || {};
                    const direct = mods.supermouse_plugin_stagejockey;
                    if (direct && typeof direct.prosceneBody === "function") return direct.prosceneBody;
                    for (const key of Object.keys(mods)) {
                        if (typeof mods[key]?.prosceneBody === "function") return mods[key].prosceneBody;
                    }
                    return null;
                }

                /** First hypertext htmf path in a fetched page, as a URL (/hypertext/enter). */
                function hypertextUrlFromHtml(html) {
                    const m = String(html || "").match(/data-path="(hypertext/[^"]+)"/);
                    if (!m) return "";
                    const at = m.index || 0;
                    const around = String(html).slice(Math.max(0, at - 120), at + m[0].length + 80);
                    if (!around.includes('data-part="htmf"') && !around.includes("data-part='htmf'")) return "";
                    return "/" + m[1].replace(/^/+/, "");
                }

                function currentHistoryPath() {
                    try {
                        const stored = sessionStorage.getItem("htmx-current-path-for-history");
                        if (stored) return stored;
                    } catch { /* ignore */ }
                    return (location.pathname || "/") + (location.search || "");
                }

                /** Same snapshot HTMX writes before hx-push-url: body HTML, title, scroll. */
                function snapshotHtmxHistory() {
                    if (typeof sessionStorage === "undefined" || typeof document === "undefined") return;
                    if (document.querySelector('[hx-history="false" i],[data-hx-history="false" i]')) return;
                    const historyElt = document.querySelector("[hx-history-elt],[data-hx-history-elt]") || document.body;
                    if (!historyElt) return;
                    const path = currentHistoryPath();
                    const clone = historyElt.cloneNode(true);
                    const requestClass = "htmx-request";
                    clone.querySelectorAll("." + requestClass).forEach((el) => el.classList.remove(requestClass));
                    clone.querySelectorAll("[data-disabled-by-htmx]").forEach((el) => el.removeAttribute("disabled"));
                    const item = { url: path, content: clone.innerHTML, title: document.title, scroll: window.scrollY };
                    let cache = [];
                    try {
                        cache = JSON.parse(sessionStorage.getItem("htmx-history-cache") || "[]") || [];
                    } catch { cache = []; }
                    if (!Array.isArray(cache)) cache = [];
                    for (let i = 0; i < cache.length; i++) {
                        if (cache[i] && cache[i].url === path) {
                            cache.splice(i, 1);
                            break;
                        }
                    }
                    cache.push(item);
                    const cap = (globalThis.htmx && globalThis.htmx.config && globalThis.htmx.config.historyCacheSize) || 10;
                    while (cache.length > cap) cache.shift();
                    try { sessionStorage.setItem("htmx-history-cache", JSON.stringify(cache)); } catch { /* quota */ }
                    try { history.replaceState({ htmx: true }, document.title, location.href); } catch { /* ignore */ }
                }

                function planHypertextHistory(url) {
                    if (!url || typeof location === "undefined" || typeof history === "undefined") return null;
                    const here = (location.pathname || "/") + (location.search || "");
                    if (here === url || location.pathname === url) return null;
                    const atRoot = location.pathname === "/" || location.pathname === "";
                    if (!atRoot) snapshotHtmxHistory();
                    return { url: url, replace: atRoot };
                }

                function commitHypertextHistory(plan) {
                    if (!plan) return;
                    try {
                        if (plan.replace) history.replaceState({ htmx: true }, document.title, plan.url);
                        else history.pushState({ htmx: true }, "", plan.url);
                        sessionStorage.setItem("htmx-current-path-for-history", plan.url);
                    } catch { /* ignore */ }
                }

                async function surf(path, opts = {}) {
                    if (typeof document === "undefined" || !document.body) {
                        navi.callout("[surf] surf requires a browser document");
                        throw new Error("[surf] surf requires a browser document");
                    }
                    // HTTP fetch: spaces become %20 on the wire; park lookup turns them back.
                    // Do not park-check in-page \u2014 SW observers (snoopy) must see the GET.
                    // opts.host: X-Navi-Park-Bypass \u2192 SW skips localpark, answer comes from the host.
                    const url = encodeURI(navi.resolveUrl(path));
                    const headers = { Accept: "text/html, text/plain, image/*" };
                    if (opts.host) headers["X-Navi-Park-Bypass"] = "1";
                    const response = await globalThis.fetch(url, { headers });
                    if (!response.ok) {
                        throw new Error("HTTP " + response.status + ": " + response.statusText);
                    }
                    const parkIb = response.headers.get("X-Navi-Park-Ib");
                    const parkKind = response.headers.get("X-Navi-Park-Kind");
                    if (parkIb) {
                        navi.callout(
                            "[surf] park hit " + parkIb + " (" + (parkKind || "?") + ")"
                        );
                    }
                    const responseMime = String(response.headers.get("content-type") || "")
                        .split(";")[0].trim().toLowerCase();
                    let html;
                    if (responseMime.startsWith("image/")) {
                        // A picture on its own. Localpark file bins may hold a data: URL string.
                        const blob = await response.blob();
                        const head = await blob.slice(0, 5).text();
                        const src = head === "data:" ? await blob.text() : URL.createObjectURL(blob);
                        const img = document.createElement("img");
                        img.src = src;
                        img.alt = String(path || "").split("/").pop() || "image";
                        img.setAttribute("data-path", String(path || "").replace(/^\\/+/, ""));
                        html = img.outerHTML;
                    } else {
                        html = await response.text();
                    }
                    const contentHash = hashContentSync(html);
                    const hypertextPlan = planHypertextHistory(hypertextUrlFromHtml(html));
                    parkPersisted();
                    const template = document.createElement("template");
                    template.innerHTML = html;
                    const nodes = Array.from(template.content.childNodes);
                    let wantStage = opts.proscene;
                    if (wantStage === undefined) {
                        try {
                            wantStage = !!(await ensureSettings()).proscene;
                        } catch {
                            wantStage = false;
                        }
                    }
                    // Content that brings its own stage (horizon/v1, jockeystage) lands as-is.
                    const ownStage = nodes.some((n) => n.nodeType === 1 && (
                        n.matches('[data-part~="stage"]') || n.querySelector('[data-part~="stage"]')
                    ));
                    const prosceneBody = wantStage && !ownStage ? findProsceneBody() : null;
                    if (wantStage && !ownStage && !prosceneBody) {
                        navi.callout("[surf] proscene needs supermouse_plugin_stagejockey mounted; surfing into body");
                    }
                    let holder = document.body;
                    if (prosceneBody) {
                        holder = prosceneBody(nodes);
                    } else {
                        document.body.replaceChildren(...nodes);
                    }
                    for (const node of Array.from(holder.children)) {
                        if (node.nodeType === 1) {
                            stampDataHash(node, contentHash);
                            // Nested data-part roots (e.g. enter htmf inside horizon/v1)
                            // get their own install hash from their outerHTML.
                            try {
                                for (const part of Array.from(
                                    node.querySelectorAll("[data-part]")
                                )) {
                                    if (
                                        part instanceof HTMLElement &&
                                        !part.hasAttribute("data-hash")
                                    ) {
                                        stampDataHash(
                                            part,
                                            hashContentSync(part.outerHTML)
                                        );
                                    }
                                }
                            } catch {
                                /* ignore */
                            }
                        }
                    }
                    holder.querySelectorAll("script").forEach((oldScript) => {
                        const script = document.createElement("script");
                        for (const attr of oldScript.attributes) {
                            script.setAttribute(attr.name, attr.value);
                        }
                        script.textContent = oldScript.textContent;
                        oldScript.replaceWith(script);
                    });
                    const htmxApi = globalThis.htmx;
                    if (htmxApi && typeof htmxApi.process === "function") {
                        for (const node of Array.from(holder.children)) {
                            if (node.nodeType === 1) {
                                htmxApi.process(node);
                            }
                        }
                    }
                    restorePersisted();
                    commitHypertextHistory(hypertextPlan);
                    // Page landed. Settings and other surf commands never reach here.
                    try { navi.emit?.("surf", String(path || "").replace(/^\\/+/, "")); } catch { /* ignore */ }
                    return "[surf] Surfing " + (parkIb || url);
                }

                /**
                 * Full document load of origin / \u2014 PWA stand-in for a hard
                 * browser navigate/reload of the shell (re-run navi_shell + init).
                 */
                function surfrefresh() {
                    if (typeof window === "undefined" || !window.location) {
                        throw new Error("[surf] surfrefresh requires a browser window");
                    }
                    const root = window.location.origin + "/";
                    const atRoot =
                        (window.location.pathname === "/" || window.location.pathname === "")
                        && !window.location.search
                        && !window.location.hash;
                    if (atRoot) {
                        window.location.reload();
                    } else {
                        window.location.replace(root);
                    }
                    return "[surf] surfrefresh " + root;
                }

                async function browse(route, options = {}) {
                    try {
                        const { content, contentType, ibGib } = await makeRequest(route, options);
                        const settings = await ensureSettings();
                        const baseMime = getBaseMime(contentType);
                        const naviModule = isNaviModule(content, contentType);
                        const saveMime = naviModule ? NAVI_MODULE_MIME : baseMime || "text/plain";

                        // browse is text-only: modules reveal their source, never auto-mount.
                        if (settings.savesurfs) {
                            const sha = await saveResourceBin(content, saveMime);
                            navi.callout("[surf] saved bin " + sha + (naviModule ? " (module)" : ""));
                        }

                        return content;
                    } catch (error) {
                        const msg = error && error.message ? error.message : String(error);
                        return "Error fetching " + route + ": " + msg;
                    }
                }

                function calloutMountError(summary, explain) {
                    const line = explain ? summary + " \u2014 " + explain : summary;
                    navi.callout(line);
                    return line;
                }

                async function mountFromTip(ib) {
                    const tipIb = String(ib || "").replace(/^\\/+/, "");
                    try {
                        navi.callout("[surf] Loading tip: " + tipIb);
                        const entry = await loadResourceFromTip(tipIb);
                        if (!entry || !entry.media) {
                            return calloutMountError(
                                "Error: no bin on tip: " + tipIb,
                                "remount needs a planted park (tip navi:<name> with a bin); install via mount <route> first"
                            );
                        }
                        if (!isNaviModuleSource(entry.media)) {
                            return calloutMountError(
                                "Error: " + tipIb + " bin is not a Navi module",
                                "bin must export register (or moduleInfo + default export with name); browse the tip media to inspect"
                            );
                        }
                        await navi.mount(entry.media);
                        return "[surf] Mounted " + tipIb;
                    } catch (error) {
                        const msg = error && error.message ? error.message : String(error);
                        return calloutMountError(
                            "Error mounting tip " + tipIb + ": " + msg,
                            "loads tip bin, runs register(), syncs navi:mod; check syntax, register() return { name }, and park tips"
                        );
                    }
                }

                async function mount(target, options = {}) {
                    const raw = String(target || "").trim();
                    if (/^navi(?:[/:\\s]|$)/.test(raw)) {
                        return await mountFromTip(raw);
                    }
                    // Route install: mount runs register() first, then plants tip+bin
                    // under the live moduleObject.name (no source-scrape name).
                    try {
                        const { content, contentType } = await makeRequest(target, options);
                        if (!isNaviModule(content, contentType)) {
                            return calloutMountError(
                                "Error: " + target + " is not a Navi module",
                                "expected MIME application/navi-module or JS with export register; use browse to read the text (mount does not install HTML/JSON)"
                            );
                        }
                        const mod = await navi.mount(content);
                        const name = mod && mod.name ? String(mod.name) : "";
                        return name
                            ? "[surf] Installed & mounted navi:" + name
                            : "[surf] Installed & mounted " + target;
                    } catch (error) {
                        const msg = error && error.message ? error.message : String(error);
                        return calloutMountError(
                            "Error mounting " + target + ": " + msg,
                            "install fetches the route, runs register(), then plants tip+bin as navi:<name> from the live name"
                        );
                    }
                }

                async function unmount(modName, opts) {
                    const name = String(modName || "").trim();
                    const kill = !!(opts && opts.kill);
                    if (!name) {
                        return "Usage: unmount [-k] <modname>  (e.g. unmount pecklogger; -k also storage kills its park tip)";
                    }
                    const mod = navi.mod && navi.mod[name];
                    if (!mod) {
                        const known = typeof navi.listModules === "function"
                            ? navi.listModules().join(", ")
                            : Object.keys(navi.mod || {}).join(", ");
                        return calloutMountError(
                            "Error: navi.mod." + name + " is not mounted"
                                + (known ? " (mounted: " + known + ")" : ""),
                            "unmount drops a live register() module and removes it from the remount ledger (navi:mod); remount with mount navi:" +
                                name +
                                " if the park tip still exists"
                        );
                    }
                    try {
                        await navi.unmount(mod);
                    } catch (error) {
                        const msg = error && error.message ? error.message : String(error);
                        return calloutMountError(
                            "Error unmounting " + name + ": " + msg,
                            "onUnmount runs then the module is removed from navi.mod / navi:mod index"
                        );
                    }
                    if (!kill) return "[surf] Unmounted " + name;
                    try {
                        const killed = await navi.storage.kill(name);
                        return "[surf] Unmounted " + name + "\\n" + killed;
                    } catch (error) {
                        const msg = error && error.message ? error.message : String(error);
                        return "[surf] Unmounted " + name + "\\n[kill] not done: " + msg;
                    }
                }

                return {
                    name: "surf",
                    version: "1.8.15",
                    description: "Interactive CLI to interact with foobarch routing system",

                    moduleInfo: {
                        name: "surf",
                        version: "1.8.15",
                        description: "surf + tip/bin settings + plantModulePark; data-hash FNV+ts+entropy"
                    },

                    commands: {
                        surf: {
                            name: "surf",
                            description: "Navigate to a foobarch route (fetch HTML, then swap)",
                            execute: async (segment, ...args) => {
                                if (!segment) {
                                    return [
                                        "surf v1.8.15",
                                        "",
                                        "Usage:",
                                        "  surf <route>              Navigate to route, render HTML (images shown on their own)",
                                        "  surf -h <route>           Same, but skip localpark: render what the host serves",
                                        "  surf -p <route>           Surf onto an empty proscene stage: content lands in Center Stage",
                                        "  surf --no-p <route>       Plain body surf even when surf_settings proscene is on",
                                        "  surfrefresh               Hard reload origin / (PWA page reload)",
                                        "  browse <route>            Fetch text; modules show source (no mount)",
                                        "  mount <route|navi:name> Plant tip+bin & mount, or remount from tip",
                                        "  unmount [-k] <modname>    Unmount navi.mod.<modname> (-k: then storage kill its tip)",
                                        "  surf/surf_settings        Show settings (on tip surf)",
                                        "  surf/surf_settings savesurfs <true|false>",
                                        "  surf/surf_settings proscene <true|false>   every surf acts like -p (default false)",
                                        "",
                                        "DOM (programmatic on navi.mod.surf):",
                                        "  persist(el) / unpersist(el) / isPersisted(el) / listPersisted()",
                                        "  slashfold(str|bytes)      optional fold; surf/browse passthru is not folded",
                                        "  X-Navi-Gate-Passthru      skip data.gate winner in delimiter race",
                                        "",
                                        "Modules live as tip+bin (navi:<name>), including surf."
                                    ].join("\\n");
                                }
                                const words = [segment, ...args].filter(Boolean);
                                const flags = new Set(["-h", "--host", "-p", "--proscene", "--no-p"]);
                                const host = words.some((w) => w === "-h" || w === "--host");
                                const proscene = words.includes("--no-p")
                                    ? false
                                    : words.some((w) => w === "-p" || w === "--proscene") || undefined;
                                const joined = words.filter((w) => !flags.has(w)).join("/");
                                if (!joined) return "Usage: surf [-h] [-p|--no-p] <route>";
                                const path = "/" + String(joined || "").replace(/^\\/+/, "");
                                return await surf(path, { host, proscene });
                            }
                        },
                        browse: {
                            name: "browse",
                            description: "Fetch a foobarch route and return its text (modules show source, no mount)",
                            execute: async (route, ...args) => {
                                if (!route) {
                                    return "Usage: browse <route>  (e.g. browse manifest)";
                                }
                                const joined = [route, ...args].join(" ").trim();
                                return await browse(joined, {});
                            }
                        },
                        surfrefresh: {
                            name: "surfrefresh",
                            description: "Hard reload origin / (PWA stand-in for a browser reload of the shell)",
                            execute: async () => {
                                return surfrefresh();
                            }
                        },
                        mount: {
                            name: "mount",
                            description: "Install & mount a Navi module (route \u2192 tip+bin, or remount navi:name)",
                            execute: async (target, ...args) => {
                                if (!target) {
                                    return "Usage: mount <route|navi:name>  (e.g. mount potter/x, or mount navi:potter)";
                                }
                                const joined = [target, ...args].join(" ").trim();
                                return await mount(joined);
                            }
                        },
                        unmount: {
                            name: "unmount",
                            description: "Unmount a registered module by name (navi.mod.<modname>); -k also storage kills its park tip",
                            execute: async (...args) => {
                                const words = args.map((a) => String(a ?? "").trim()).filter(Boolean);
                                const kill = words.some((w) => w === "-k" || w === "--kill");
                                const rest = words.filter((w) => w !== "-k" && w !== "--kill");
                                return await unmount(rest[0], { kill });
                            }
                        },
                        surf_settings: {
                            name: "surf_settings",
                            description: "View or update surf settings",
                            execute: async (key, value) => {
                                const settings = await ensureSettings();
                                if (!key) {
                                    return "surf_settings:\\n" + JSON.stringify(settings, null, 2);
                                }
                                if (key === "savesurfs") {
                                    if (value === undefined) {
                                        return "savesurfs: " + settings.savesurfs;
                                    }
                                    const enabled = value === "true" || value === "1" || value === "on";
                                    settings.savesurfs = enabled;
                                    await saveSettings(settings);
                                    return "savesurfs set to " + enabled;
                                }
                                if (key === "proscene") {
                                    if (value === undefined) {
                                        return "proscene: " + !!settings.proscene;
                                    }
                                    const enabled = value === "true" || value === "1" || value === "on";
                                    settings.proscene = enabled;
                                    await saveSettings(settings);
                                    return "proscene set to " + enabled + (enabled ? " (surf lands in Center Stage; surf --no-p for body)" : "");
                                }
                                return "Unknown setting: " + key;
                            }
                        }
                    },

                    surf,
                    surfrefresh,
                    browse,
                    mount,
                    unmount,
                    ensureSettings,
                    persist,
                    unpersist,
                    isPersisted,
                    listPersisted,
                    slashfold,

                    onMount: async () => {
                        await ensureSettings();
                        navi.callout("[surf] Ready (v1.8.15)");
                    },

                    onUnmount: () => {
                        navi.callout("[surf] Module unmounted");
                    }
                };
            };`;
      await this.plantSurfModuleBin(surfModuleCode);
      this.callout("[navi] Surf module planted as tip+bin (surf)");
    } catch (error) {
      this.callout("[navi] Failed to create default module: " + error);
    }
  }
  async plantSurfModuleBin(surfModuleCode) {
    const sha = await this.sha256Hex(surfModuleCode);
    await this.putBin(sha, {
      media: surfModuleCode,
      mime: "application/navi-module"
    });
    const ref = `bin ${sha}`;
    const tip = await this.getTip(NAVI_SURF_IB);
    if (!tip) {
      throw new Error(
        `park tip ${NAVI_SURF_IB} missing \u2014 plant navi_redux seeds before surf bin`
      );
    }
    const current = Array.isArray(tip.rel8ns?.bin) ? tip.rel8ns.bin : [];
    if (current[0]) {
      const shaKey = String(current[0]).replace(/^bin\s+/i, "").trim();
      const bin = shaKey ? await this.getBin(shaKey) : null;
      const media = String(bin?.media || "");
      if (!media || media === surfModuleCode)
        return;
      if (/keepstage|branch:\s*"stage"/.test(media))
        return;
    }
    const priorAddr = tip.gib ? `${tip.ib}^${tip.gib}` : null;
    const next = await this.stampTipFrame({
      ...tip,
      data: {
        ...tip.data,
        module: {
          ...tip.data.module || {},
          subject_seed: ref
        },
        n: void 0
      },
      rel8ns: {
        ...tip.rel8ns || {},
        bin: [ref],
        past: priorAddr ? [priorAddr] : []
      }
    });
    await this.setTip(next);
  }
  registerModule(name, moduleObject) {
    if (this.moduleRegistry.has(name)) {
      throw new Error(`Module '${name}' is already registered`);
    }
    this.moduleRegistry.set(name, moduleObject);
    this.mod[name] = moduleObject;
  }
  rollbackFailedMount(name, moduleObject) {
    try {
      moduleObject?.onUnmount?.();
    } catch {
    }
    try {
      moduleObject?.cleanup?.();
    } catch {
    }
    this.clearSwHandlersForOwner(name);
    if (this.moduleRegistry.get(name) === moduleObject) {
      this.moduleRegistry.delete(name);
      delete this.mod[name];
    }
  }
  listModules() {
    return Array.from(this.moduleRegistry.keys());
  }
  async unmount(moduleObject) {
    const name = moduleObject.name;
    if (!name || !this.moduleRegistry.has(name)) {
      throw new Error(`Module '${name}' is not registered`);
    }
    if (moduleObject.onUnmount) {
      moduleObject.onUnmount();
    }
    if (moduleObject.cleanup) {
      moduleObject.cleanup();
    }
    this.clearSwHandlersForOwner(name);
    this.relayWhitelistMods.delete(name);
    this.moduleRegistry.delete(name);
    delete this.mod[name];
    await this.syncModIndexOnUnmount(name);
    this.callout(`[navi] Unmounted module: ${name}`);
  }
  async remount() {
    const index = await this.getTip(NAVI_MOD_INDEX_IB);
    if (!index?.data) {
      throw new Error("navi:mod tip missing \u2014 cannot remount");
    }
    const parks = Array.isArray(index.data.parks) ? index.data.parks : [];
    const mounted = [];
    const skipped = [];
    const failed = /* @__PURE__ */ new Map();
    this.remountInProgress = true;
    try {
      let pending = parks.filter((entry) => {
        if (!entry || typeof entry !== "object")
          return false;
        const name = String(entry.name || "").trim();
        if (!this.parkEntryIb(entry) || !name)
          return false;
        if (this.moduleRegistry.has(name) && name !== "surf") {
          skipped.push(name);
          return false;
        }
        return true;
      });
      while (pending.length) {
        const next = [];
        for (const entry of pending) {
          const name = String(entry.name || "").trim();
          try {
            await this.remountLedgerEntry(entry);
            failed.delete(name);
            mounted.push(name);
          } catch (err) {
            failed.set(name, String(err?.message || err));
            next.push(entry);
          }
        }
        if (next.length === pending.length)
          break;
        pending = next;
      }
    } finally {
      this.remountInProgress = false;
    }
    const msg = `[navi] remount ledger: +${mounted.length}` + (mounted.length ? ` (${mounted.join(", ")})` : "") + (skipped.length ? `; skip live ${skipped.join(", ")}` : "") + (failed.size ? `; failed ${[...failed].map(([n, e]) => `${n} (${e.replace(/^\[navi\] mount failed: [^ ]+ — /, "")})`).join(", ")}` : "");
    this.callout(msg);
    return msg;
  }
  async remountLedgerEntry(entry) {
    const ib = this.parkEntryIb(entry);
    const name = String(entry.name || "").trim();
    await this.mount(await this.loadBinMediaFromTip(ib), {
      record: false
    });
    const unitIb = this.callUnitIb || this.entryPlug?.unitIb || await this.resolveDefaultUnitIb();
    if (unitIb) {
      const unitTip = await this.getTip(unitIb);
      if (unitTip?.data) {
        const prior = this.readUnitMods(unitTip) || {};
        const clean = {
          "ib^gib": this.parkEntryAddr(entry),
          name,
          commands: Array.isArray(entry.commands) ? entry.commands.map(String) : [],
          registered_at: String(entry.registered_at || "") || naviStamp.time()
        };
        if (!clean["ib^gib"]) {
          const tip = await this.getTip(ib);
          if (tip?.gib) {
            clean["ib^gib"] = `${ib}^${tip.gib}`;
          }
        }
        await this.mut8Tip(unitTip, {
          unit: {
            ...unitTip.data.unit || {},
            mods: { ...prior, [name]: clean }
          }
        });
      }
    }
  }
  async finalizeMountedModule(mod, opts) {
    if (mod && typeof mod.register === "function") {
      const moduleObject = mod.register(this);
      if (moduleObject && moduleObject.name) {
        const name = String(moduleObject.name).trim();
        if (!name || /[/:]/.test(name)) {
          throw new Error(
            `[navi] register() returned invalid name '${name}' (single segment required)`
          );
        }
        if (this.moduleRegistry.has(name)) {
          await this.unmount(this.moduleRegistry.get(name));
        }
        this.registerModule(name, moduleObject);
        if (moduleObject.onMount) {
          try {
            await moduleObject.onMount();
          } catch (err) {
            this.rollbackFailedMount(name, moduleObject);
            throw new Error(
              `[navi] mount failed: ${name} \u2014 ${err?.message || err}`
            );
          }
        }
        this.emit("mounted", { name });
        if (opts?.record !== false) {
          const media = String(opts?.media ?? "").trim();
          if (!media) {
            throw new Error(
              `[navi] cannot plant park for '${name}' \u2014 mount media missing`
            );
          }
          await this.plantModulePark({
            name,
            media,
            mime: "application/navi-module"
          });
        }
        await this.syncModIndexOnMount(moduleObject, {
          parkTipIb: opts?.parkTipIb
        });
        this.callout(`[navi] Registered module: ${name}`);
        return moduleObject;
      }
      throw new Error(
        "[navi] register() must return an object with a string name"
      );
    }
    if (mod && "default" in mod) {
      return await mod.default;
    }
    return mod;
  }
  async mount(code, opts) {
    try {
      const trimmed = String(code ?? "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").trim();
      if (!trimmed) {
        throw new Error("[navi-error] Empty code provided to mount");
      }
      const mountOpts = { ...opts, media: trimmed };
      const isBrowser = typeof window !== "undefined" && typeof window.document !== "undefined";
      const hasTopLevelModuleSyntax = /(^|\s)(import\s|export\s)/.test(trimmed);
      if (!isBrowser) {
        if (!hasTopLevelModuleSyntax) {
          const runner = new Function(`"use strict"; return (async () => {
${trimmed}
})();`);
          return await runner();
        }
        const isRegisterModule = /export\s+(?:const|function|async\s+function)\s+register\b/.test(trimmed) || /export\s+\{[^}]*\bregister\b/.test(trimmed);
        if (isRegisterModule) {
          const body = trimmed.replace(/export\s+async\s+function\s+register\b/, "async function register").replace(/export\s+function\s+register\b/, "function register").replace(/export\s+const\s+register\s*=/, "const register =").replace(/export\s*\{[^}]*\bregister\b[^}]*\}\s*;?/, "");
          const mod2 = new Function(`"use strict";
${body}
; return { register };`)();
          return await this.finalizeMountedModule(mod2, mountOpts);
        }
        try {
          const { fs, join, tmpdir } = await getNodeFsPathOs();
          const filePath = join(tmpdir(), `navi-mount-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`);
          await fs.writeFile(filePath, trimmed, "utf8");
          const fileUrl = `file:///${filePath.split("\\").join("/")}`;
          const mod2 = await import(fileUrl);
          try {
            await fs.unlink(filePath);
          } catch {
          }
          return await this.finalizeMountedModule(mod2, mountOpts);
        } catch (nodeExecErr) {
          throw new Error(
            "Node file-based mounting failed: " + formatCalloutMessage(nodeExecErr) + " (prefer export register so the Function rewrite path is used)"
          );
        }
      }
      const moduleCode = hasTopLevelModuleSyntax ? trimmed : `export default (async () => {
${trimmed}
})();`;
      let moduleUrl;
      try {
        const base64 = typeof Buffer !== "undefined" ? Buffer.from(moduleCode, "utf8").toString("base64") : btoa(moduleCode);
        moduleUrl = `data:text/javascript;charset=utf-8;base64,${base64}`;
      } catch {
        moduleUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(moduleCode)}`;
      }
      const mod = await import(moduleUrl);
      return await this.finalizeMountedModule(mod, mountOpts);
    } catch (error) {
      this.callout(
        "[navi] Module mount failed: " + formatCalloutMessage(error) + " \u2014 expect export register returning { name }; with record, plants tip+bin and syncs navi:mod"
      );
      throw error;
    }
  }
};
var Navi = _Navi;
Navi.serviceWorkerBridgeRegistered = false;
var naviInstance = null;
navi.callout = function callout(data) {
  if (arguments.length === 0) {
    throw new Error("[navi-error] navi.callout requires data. Usage: navi.callout(data)");
  }
  const instance = ensureNaviInstance();
  instance.emit("callout", data);
  return Promise.resolve(data);
};
function ensureNaviInstance() {
  if (!naviInstance) {
    naviInstance = new Navi();
    if (!isLocalnaviExe()) {
      naviInstance.initialize().catch((err) => {
        naviInstance?.callout("[navi] Auto-initialize failed: " + err);
      });
    }
    if (typeof globalThis !== "undefined") {
      globalThis.navi = navi;
    }
  }
  return naviInstance;
}
function navi(input) {
  if (arguments.length === 0) {
    return ensureNaviInstance();
  }
  if (typeof input === "string" || input && typeof input === "object") {
    const instance = ensureNaviInstance();
    return instance.dispatchCallin(input);
  }
  return naviInstance;
}
Object.defineProperty(navi, "origin", {
  get() {
    return ensureNaviInstance().origin;
  },
  set(value) {
    ensureNaviInstance().origin = value;
  }
});
Object.defineProperty(navi, "resolveUrl", {
  get() {
    return naviInstance?.resolveUrl.bind(naviInstance);
  }
});
Object.defineProperty(navi, "fetch", {
  get() {
    const instance = ensureNaviInstance();
    return instance.fetchPath.bind(instance);
  }
});
Object.defineProperty(navi, "storage", {
  get() {
    return naviInstance?.storage;
  }
});
Object.defineProperty(navi, "park", {
  get() {
    return ensureNaviInstance().park;
  }
});
Object.defineProperty(navi, "tokens", {
  get() {
    return ensureNaviInstance().tokens;
  }
});
Object.defineProperty(navi, "mount", {
  get() {
    return naviInstance?.mount.bind(naviInstance);
  }
});
Object.defineProperty(navi, "native", {
  get() {
    return {
      node: isNodeRuntime(),
      exe: isLocalnaviExe(),
      browser: isBrowserDocument()
    };
  }
});
Object.defineProperty(navi, "remount", {
  get() {
    return naviInstance?.remount.bind(naviInstance);
  }
});
Object.defineProperty(navi, "initialize", {
  get() {
    return naviInstance?.initialize.bind(naviInstance);
  }
});
Object.defineProperty(navi, "on", {
  get() {
    return naviInstance?.on.bind(naviInstance);
  }
});
Object.defineProperty(navi, "repl", {
  get() {
    return ensureNaviInstance().repl;
  }
});
Object.defineProperty(navi, "callinRequest", {
  get() {
    return naviInstance?.getCallinRequest?.() ?? null;
  }
});
Object.defineProperty(navi, "callin", {
  get() {
    return ensureNaviInstance().callin.bind(ensureNaviInstance());
  }
});
Object.defineProperty(navi, "unmount", {
  get() {
    return naviInstance?.unmount.bind(naviInstance);
  }
});
Object.defineProperty(navi, "listModules", {
  get() {
    return naviInstance?.listModules.bind(naviInstance);
  }
});
Object.defineProperty(navi, "mod", {
  get() {
    return naviInstance?.mod;
  }
});
Object.defineProperty(navi, "stamp", {
  get() {
    return ensureNaviInstance().stamp;
  }
});
Object.defineProperty(navi, "script", {
  get() {
    return naviInstance?.script.bind(naviInstance);
  }
});
Object.defineProperty(navi, "addToInitScript", {
  get() {
    return naviInstance?.addToInitScript.bind(naviInstance);
  }
});
Object.defineProperty(navi, "clearInitScript", {
  get() {
    return naviInstance?.clearInitScript.bind(naviInstance);
  }
});
Object.defineProperty(navi, "getInitScript", {
  get() {
    return naviInstance?.getInitScript.bind(naviInstance);
  }
});
Object.defineProperty(navi, "reseed", {
  get() {
    return ensureNaviInstance().reseed;
  }
});
Object.defineProperty(navi, "factoryreset", {
  get() {
    return ensureNaviInstance().factoryreset;
  }
});
Object.defineProperty(navi, "plug", {
  get() {
    return ensureNaviInstance().plug;
  }
});
Object.defineProperty(navi, "unit", {
  get() {
    return ensureNaviInstance().unit;
  }
});
Object.defineProperty(navi, "pwa", {
  get() {
    const instance = ensureNaviInstance();
    return instance.pwa;
  }
});
Object.defineProperty(navi, "sw", {
  get() {
    return ensureNaviInstance().sw;
  }
});
navi.require = function requireModule(id) {
  return ensureNaviInstance().require(id);
};
main().catch((error) => {
  console.error("[shell] UNHANDLED ERROR:", error);
});
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  naviStamp,
  naviStampTime,
  naviStampUuid
});
