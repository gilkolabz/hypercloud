// supermouse — mouse + touch trigger host for navi plugins
// Modes gate capture; plugins consume and combine them into UI/tooling.
// Right-button gestures are split so plugins need not fight:
//   rightclick = button DOWN
//   rightup    = button UP (always, after a down)
//   righttap   = DOWN+UP with almost no movement (menu click)
//
// Touch is additive and non-hijacking:
//   short tap / scroll / buttons → browser defaults (no preventDefault)
//   long-press (≥LONG_PRESS_MS) → rightclick; lift → rightup;
//     still lift (no TOUCH_MOVE_PX) also → righttap (same as mouse menu click)
//   claim (≥TOUCH_CLAIM_MS) blocks browser select/search callout
//   no touch synthesis of right-hold `move` / hover-tracking mouseover

export const register = (navi) => {
    const isBrowser = typeof window !== "undefined" && typeof window.document !== "undefined";

    const RIGHT_MOVE_PX = 5;
    /** Fat-finger slop before a touch cancels pending long-press. */
    const TOUCH_MOVE_PX = 18;
    /**
     * Hold before touch becomes a right-button gesture.
     * Must fire at/before typical mobile browser long-press (~500ms).
     */
    const LONG_PRESS_MS = 420;
    /**
     * After this still-hold, claim the gesture (preventDefault on move/end)
     * so the browser never opens select/search callout. Short taps lift sooner.
     */
    const TOUCH_CLAIM_MS = 160;
    /** Ignore synthesized mouse events only after a claimed long-press. */
    const MOUSE_SUPPRESS_MS = 650;

    const MODE_KEYS = [
        "move",
        "mouseover",
        "leftclick",
        "middleclick",
        "middleup",
        "doubleclick",
        "rightclick",
        "rightup",
        "righttap",
        "scroll"
    ];

    // Human-readable trigger catalog (also used by `supermouse triggers`).
    const TRIGGER_INFO = {
        move: {
            when: "pointer moves (mouse)",
            note: "Continuous; pairs with holds."
        },
        mouseover: {
            when: "pointer enters an element",
            note: "Element-targeted; useful during rightclick hold."
        },
        leftclick: {
            when: "left button DOWN (incl. claimed touch tap)",
            note: "Chord-friendly with an active mouse right hold. Short taps stay native until claim."
        },
        middleclick: {
            when: "wheel / middle button DOWN",
            note: "Arm an action while another button is held. Claims middle so links do not open a new tab."
        },
        middleup: {
            when: "wheel / middle button UP",
            note: "Complete a middle-armed action (pairs with middleclick)."
        },
        doubleclick: {
            when: "left button DOWN with detail>=2",
            note: "Fires early enough to cancel word-select."
        },
        rightclick: {
            when: "right button DOWN — or long-press threshold on touch",
            note: "Start of a right gesture. Does NOT imply a menu open."
        },
        rightup: {
            when: "right button UP (after a right down) — or finger-up after long-press",
            note: "Always ends the right gesture. Overlaps neither righttap nor rightclick."
        },
        righttap: {
            when: `right DOWN+UP with little movement (mouse <${RIGHT_MOVE_PX}px; touch long-press still-lift)`,
            note: "Menu/click gesture. Touch: fires on long-press lift when the finger stayed put."
        },
        scroll: {
            when: "wheel — or 2nd-finger drag while right-hold on touch",
            note: "Independent of click gestures (except touch chord above)."
        }
    };

    // Direct DOM bindings (gesture modes are handled by the right-button engine).
    const MODE_TO_DOM = {
        move: { event: "mousemove", capture: false },
        mouseover: { event: "mouseover", capture: false },
        leftclick: { event: "mousedown", capture: true, button: 0 },
        middleclick: { event: "mousedown", capture: true, button: 1 },
        middleup: { event: "mouseup", capture: true, button: 1 },
        doubleclick: { event: "mousedown", capture: true, button: 0, detailMin: 2 },
        // passive:false so plugins can preventDefault during holds (e.g. stagejockey).
        scroll: { event: "wheel", capture: false, passive: false }
    };

    const GESTURE_MODES = new Set(["rightclick", "rightup", "righttap"]);

    class SuperMouse {
        constructor() {
            this.isActive = false;
            this.modes = Object.fromEntries(MODE_KEYS.map((k) => [k, true]));
            this.plugins = new Map();
            this._domBindings = new Map();
            this._contextMenuBlocker = null;
            this._auxclickBlocker = null;
            this._rightGesture = null; // { x, y, moved, target }
            this._rightBindings = []; // raw listeners for gesture engine
            /** @type {null | { id: number, x: number, y: number, target: EventTarget, moved: boolean, longPressed: boolean, timer: any, lastEl: Element|null }} */
            this._touch = null;
            /** Secondary finger while primary is in right-hold. */
            this._touch2 = null; // { id, x, y, moved }
            this._touchBindings = [];
            this._suppressMouseUntil = 0;
            this._touchStyleEl = null;
            this._selectStartBlocker = null;
            /** When false, left pointer stays native — capture gate + no left dispatch. */
            this.preventLeftDefault = true;
            this._leftDragBlocker = null;
            /** @type {((e: Event) => void)|null} */
            this._leftNativeGateHandler = null;
            /** @type {{ element: EventTarget, event: string, handler: EventListener, capture: boolean }[]} */
            this._leftNativeGateBindings = [];
        }

        init() {
            if (!isBrowser) throw new Error("supermouse only works in a browser");
            this.isActive = true;
            // Must register before plugins mount their capture handlers.
            this._installLeftNativeGate();
            for (const key of MODE_KEYS) {
                if (!this.modes[key]) continue;
                if (key === "leftclick" || key === "doubleclick") continue;
                this._bindMode(key);
            }
            this._syncRightGestureEngine();
            this._syncTouchEngine();
            this._syncContextMenuBlock();
            this._syncAuxclickBlock();
            this._syncLeftCapture();
            this._syncLeftDragBlock();
            this._syncLeftNativeEnvironment();
        }

        shutdown() {
            for (const key of [...this._domBindings.keys()]) this._unbindMode(key);
            this._removeLeftNativeGate();
            this._removeRightGestureEngine();
            this._removeTouchEngine();
            this._removeContextMenuBlock();
            this._removeAuxclickBlock();
            this._removeLeftDragBlock();
            for (const plugin of this.plugins.values()) {
                if (plugin.enabled && typeof plugin.onDisable === "function") {
                    try {
                        plugin.onDisable(this._pluginApi(plugin));
                    } catch (err) {
                        console.error(`[supermouse] plugin "${plugin.id}" onDisable failed`, err);
                    }
                }
            }
            this.plugins.clear();
            this.isActive = false;
        }

        // --- modes / triggers ---

        listModes() {
            return MODE_KEYS.map((id) => ({ id, enabled: !!this.modes[id] }));
        }

        listTriggers() {
            return MODE_KEYS.map((id) => {
                const info = TRIGGER_INFO[id] || { when: id, note: "" };
                const listeners = [...this.plugins.values()]
                    .filter((p) => p.enabled && p.modes.includes(id))
                    .map((p) => p.id);
                return {
                    id,
                    enabled: !!this.modes[id],
                    when: info.when,
                    note: info.note,
                    plugins: listeners
                };
            });
        }

        isModeEnabled(mode) {
            return !!this.modes[mode];
        }

        enableMode(mode) {
            this._assertMode(mode);
            if (this.modes[mode]) return true;
            this.modes[mode] = true;
            if (this.isActive) {
                if (mode === "leftclick" || mode === "doubleclick") {
                    this._syncLeftCapture();
                } else {
                    this._bindMode(mode);
                }
                this._syncRightGestureEngine();
                this._syncTouchEngine();
                this._syncContextMenuBlock();
                this._syncAuxclickBlock();
            }
            this._emitHost("mode", { mode, enabled: true });
            return true;
        }

        disableMode(mode) {
            this._assertMode(mode);
            if (!this.modes[mode]) return false;
            this.modes[mode] = false;
            this._unbindMode(mode);
            this._syncRightGestureEngine();
            this._syncTouchEngine();
            this._syncContextMenuBlock();
            this._syncAuxclickBlock();
            this._emitHost("mode", { mode, enabled: false });
            return false;
        }

        toggleMode(mode) {
            return this.isModeEnabled(mode) ? this.disableMode(mode) : this.enableMode(mode);
        }

        setModes(partial = {}) {
            for (const [mode, value] of Object.entries(partial)) {
                if (!MODE_KEYS.includes(mode)) continue;
                if (value) this.enableMode(mode);
                else this.disableMode(mode);
            }
            return this.listModes();
        }

        // --- left-click / left-drag default prevention ---

        isPreventLeftDefault() {
            return !!this.preventLeftDefault;
        }

        setPreventLeftDefault(on) {
            const next = !!on;
            if (this.preventLeftDefault === next) return next;
            this.preventLeftDefault = next;
            if (this.isActive) {
                this._syncLeftCapture();
                this._syncLeftDragBlock();
                this._syncLeftNativeEnvironment();
            }
            this._emitHost("preventLeftDefault", { enabled: next });
            this._emitHost("leftNative", { enabled: !next });
            return next;
        }

        togglePreventLeftDefault() {
            return this.setPreventLeftDefault(!this.preventLeftDefault);
        }

        // --- plugins ---

        registerPlugin(def = {}) {
            const id = def.id || def.name;
            if (!id || typeof id !== "string") {
                throw new Error("[supermouse] plugin requires a string id");
            }
            if (this.plugins.has(id)) {
                throw new Error(`[supermouse] plugin "${id}" is already registered`);
            }

            const modes = Array.isArray(def.modes)
                ? def.modes.filter((m) => MODE_KEYS.includes(m))
                : [...MODE_KEYS];

            const plugin = {
                id,
                name: def.name || id,
                description: def.description || "",
                modes,
                enabled: def.enabled !== false,
                onEnable: typeof def.onEnable === "function" ? def.onEnable : null,
                onDisable: typeof def.onDisable === "function" ? def.onDisable : null,
                onEvent: typeof def.onEvent === "function" ? def.onEvent : null,
                handlers: {
                    move: def.onMove || null,
                    mouseover: def.onMouseover || null,
                    leftclick: def.onLeftClick || null,
                    middleclick: def.onMiddleClick || null,
                    middleup: def.onMiddleUp || null,
                    doubleclick: def.onDoubleClick || null,
                    rightclick: def.onRightClick || null,
                    rightup: def.onRightUp || null,
                    righttap: def.onRightTap || null,
                    scroll: def.onScroll || null
                },
                meta: def.meta || {}
            };

            this.plugins.set(id, plugin);

            if (plugin.enabled && typeof plugin.onEnable === "function") {
                try {
                    plugin.onEnable(this._pluginApi(plugin));
                } catch (err) {
                    console.error(`[supermouse] plugin "${id}" onEnable failed`, err);
                }
            }

            this._emitHost("plugin", { id, action: "register", enabled: plugin.enabled });
            return () => this.unregisterPlugin(id);
        }

        unregisterPlugin(id) {
            const plugin = this.plugins.get(id);
            if (!plugin) return false;
            if (plugin.enabled && typeof plugin.onDisable === "function") {
                try {
                    plugin.onDisable(this._pluginApi(plugin));
                } catch (err) {
                    console.error(`[supermouse] plugin "${id}" onDisable failed`, err);
                }
            }
            this.plugins.delete(id);
            this._emitHost("plugin", { id, action: "unregister" });
            return true;
        }

        enablePlugin(id) {
            const plugin = this.plugins.get(id);
            if (!plugin) return false;
            if (plugin.enabled) return true;
            plugin.enabled = true;
            if (typeof plugin.onEnable === "function") {
                try {
                    plugin.onEnable(this._pluginApi(plugin));
                } catch (err) {
                    console.error(`[supermouse] plugin "${id}" onEnable failed`, err);
                }
            }
            this._emitHost("plugin", { id, action: "enable" });
            return true;
        }

        disablePlugin(id) {
            const plugin = this.plugins.get(id);
            if (!plugin) return false;
            if (!plugin.enabled) return true;
            if (typeof plugin.onDisable === "function") {
                try {
                    plugin.onDisable(this._pluginApi(plugin));
                } catch (err) {
                    console.error(`[supermouse] plugin "${id}" onDisable failed`, err);
                }
            }
            plugin.enabled = false;
            this._emitHost("plugin", { id, action: "disable" });
            return true;
        }

        togglePlugin(id) {
            const plugin = this.plugins.get(id);
            if (!plugin) return null;
            return plugin.enabled ? (this.disablePlugin(id), false) : (this.enablePlugin(id), true);
        }

        getPlugin(id) {
            const plugin = this.plugins.get(id);
            if (!plugin) return null;
            return {
                id: plugin.id,
                name: plugin.name,
                description: plugin.description,
                enabled: plugin.enabled,
                modes: [...plugin.modes]
            };
        }

        listPlugins() {
            return [...this.plugins.values()].map((p) => ({
                id: p.id,
                name: p.name,
                description: p.description,
                enabled: p.enabled,
                modes: [...p.modes]
            }));
        }

        _assertMode(mode) {
            if (!MODE_KEYS.includes(mode)) {
                throw new Error(`unknown supermouse mode "${mode}"`);
            }
        }

        _pluginApi(plugin) {
            return {
                id: plugin.id,
                supermouse: this,
                navi,
                isModeEnabled: (m) => this.isModeEnabled(m),
                listModes: () => this.listModes(),
                isPreventLeftDefault: () => this.isPreventLeftDefault()
            };
        }

        _emitHost(kind, detail) {
            try {
                if (typeof navi?.emit === "function") {
                    navi.emit("supermouse", { kind, ...detail });
                }
            } catch (_) {
                /* ignore */
            }
        }

        _anyRightMode() {
            return !!(this.modes.rightclick || this.modes.rightup || this.modes.righttap);
        }

        _anyMiddleMode() {
            return !!(this.modes.middleclick || this.modes.middleup);
        }

        _anyTouchMappedMode() {
            // Touch engine only exists to synthesize right-* from long-press.
            // Taps/scroll/buttons stay with the browser.
            return this._anyRightMode();
        }

        /** Ignore mouse while a touch right-hold is active, or briefly after (ghost click). */
        _shouldIgnoreMouse(_e) {
            if (this._touch?.longPressed) return true;
            return performance.now() < this._suppressMouseUntil;
        }

        _suppressMouseGhosts() {
            this._suppressMouseUntil = performance.now() + MOUSE_SUPPRESS_MS;
        }

        /**
         * Synthetic UIEvent-shaped object so plugins see the same ctx as mouse.
         */
        _synthPointerEvent({
            type,
            target,
            clientX,
            clientY,
            button = 0,
            buttons = 0,
            detail = 1,
            deltaX = 0,
            deltaY = 0,
            fromTouch = false,
        }) {
            const el =
                target && target.nodeType === 1
                    ? target
                    : target?.parentElement || document.elementFromPoint(clientX, clientY) || document.body;
            return {
                type,
                target: el,
                currentTarget: document,
                clientX,
                clientY,
                pageX: clientX + (window.scrollX || 0),
                pageY: clientY + (window.scrollY || 0),
                button,
                buttons,
                detail,
                deltaX,
                deltaY,
                fromTouch: !!fromTouch,
                pointerType: fromTouch ? "touch" : "mouse",
                isTrusted: false,
                bubbles: true,
                cancelable: true,
                defaultPrevented: false,
                preventDefault() {
                    this.defaultPrevented = true;
                },
                stopPropagation() {},
                stopImmediatePropagation() {},
            };
        }

        _targetAt(x, y, fallback) {
            try {
                const el = document.elementFromPoint(x, y);
                if (el) return el;
            } catch (_) {
                /* ignore */
            }
            return fallback || document.body;
        }

        /** When true, left mousedown/drag stays entirely native (no capture, no plugin dispatch). */
        _leftPassthrough() {
            return !this.preventLeftDefault;
        }

        _shouldSkipLeftDispatch(type, event) {
            if (!this._leftPassthrough()) return false;
            if (type === "leftclick" || type === "doubleclick") return true;
            if (type === "move" && event && (event.buttons & 1)) return true;
            return false;
        }

        _syncLeftCapture() {
            if (!isBrowser || !this.isActive) return;
            this._unbindMode("leftclick");
            this._unbindMode("doubleclick");
            if (!this.preventLeftDefault) return;
            if (this.modes.leftclick) this._bindMode("leftclick");
            if (this.modes.doubleclick) this._bindMode("doubleclick");
        }

        /**
         * Left-native: drop touch user-select guards; ON restore if touch engine active.
         */
        _syncLeftNativeEnvironment() {
            if (!isBrowser || !this.isActive) return;
            if (this._leftPassthrough()) {
                this._removeTouchGuards();
                try {
                    document.documentElement.setAttribute(
                        "data-supermouse-left-native",
                        "1"
                    );
                } catch (_) {
                    /* ignore */
                }
            } else {
                try {
                    document.documentElement.removeAttribute(
                        "data-supermouse-left-native"
                    );
                } catch (_) {
                    /* ignore */
                }
                if (this._touchBindings.length) this._installTouchGuards();
            }
        }

        _isLeftNativeGateEvent(e) {
            if (!e) return false;
            const btn = typeof e.button === "number" ? e.button : null;
            const t = e.type;
            if (t === "click" || t === "dblclick" || t === "dragstart") {
                return btn == null || btn === 0;
            }
            if (
                t === "mousedown" ||
                t === "mouseup" ||
                t === "pointerdown" ||
                t === "pointerup" ||
                t === "pointercancel"
            ) {
                return btn === 0;
            }
            return false;
        }

        /**
         * Registered at init (before plugins). When preventLeftDefault is OFF,
         * stopImmediatePropagation on left pointer events so later capture
         * handlers (plugin guards) never run — without preventDefault.
         */
        _installLeftNativeGate() {
            if (!isBrowser || this._leftNativeGateHandler) return;
            this._leftNativeGateHandler = (e) => {
                if (this.preventLeftDefault) return;
                if (!this._isLeftNativeGateEvent(e)) return;
                e.stopImmediatePropagation();
            };
            const types = [
                "mousedown",
                "mouseup",
                "pointerdown",
                "pointerup",
                "pointercancel",
                "dragstart",
            ];
            for (const t of types) {
                window.addEventListener(t, this._leftNativeGateHandler, true);
                this._leftNativeGateBindings.push({
                    element: window,
                    event: t,
                    handler: this._leftNativeGateHandler,
                    capture: true,
                });
                document.addEventListener(t, this._leftNativeGateHandler, true);
                this._leftNativeGateBindings.push({
                    element: document,
                    event: t,
                    handler: this._leftNativeGateHandler,
                    capture: true,
                });
            }
        }

        _removeLeftNativeGate() {
            for (const { element, event, handler, capture } of this
                ._leftNativeGateBindings) {
                element.removeEventListener(event, handler, capture);
            }
            this._leftNativeGateBindings = [];
            this._leftNativeGateHandler = null;
            try {
                document.documentElement.removeAttribute(
                    "data-supermouse-left-native"
                );
            } catch (_) {
                /* ignore */
            }
        }

        _bindMode(mode) {
            if (!isBrowser || GESTURE_MODES.has(mode) || this._domBindings.has(mode)) return;
            const spec = MODE_TO_DOM[mode];
            if (!spec) return;

            const handler = (e) => {
                if (!this.modes[mode]) return;
                if (this._shouldIgnoreMouse(e)) return;
                if (spec.button !== undefined && e.button !== spec.button) return;
                if (spec.detailMin !== undefined && (e.detail || 0) < spec.detailMin) return;
                if (this._shouldSkipLeftDispatch(mode, e)) return;
                // While right-held, movement marks the gesture as a hold (kills righttap).
                if (mode === "move" && this._rightGesture && !this._rightGesture.moved) {
                    const dx = e.clientX - this._rightGesture.x;
                    const dy = e.clientY - this._rightGesture.y;
                    if (Math.hypot(dx, dy) >= RIGHT_MOVE_PX) this._rightGesture.moved = true;
                }
                this._dispatch(mode, e);
            };

            const opts =
                typeof spec.passive === "boolean"
                    ? { capture: !!spec.capture, passive: spec.passive }
                    : !!spec.capture;
            document.addEventListener(spec.event, handler, opts);
            this._domBindings.set(mode, {
                element: document,
                event: spec.event,
                handler,
                opts
            });
        }

        _unbindMode(mode) {
            const binding = this._domBindings.get(mode);
            if (!binding) return;
            binding.element.removeEventListener(binding.event, binding.handler, binding.opts);
            this._domBindings.delete(mode);
        }

        _syncRightGestureEngine() {
            if (!isBrowser) return;
            if (this._anyRightMode()) this._installRightGestureEngine();
            else this._removeRightGestureEngine();
        }

        _installRightGestureEngine() {
            if (this._rightBindings.length) return;

            const onDown = (e) => {
                if (e.button !== 2) return;
                if (this._shouldIgnoreMouse(e)) return;
                this._rightGesture = {
                    x: e.clientX,
                    y: e.clientY,
                    moved: false,
                    target: e.target
                };
                // Claim browser context-menu path for the gesture.
                e.preventDefault();
                e.stopPropagation();
                if (this.modes.rightclick) this._dispatch("rightclick", e);
            };

            const onMove = (e) => {
                if (!this._rightGesture || this._rightGesture.moved) return;
                if (this._shouldIgnoreMouse(e)) return;
                const dx = e.clientX - this._rightGesture.x;
                const dy = e.clientY - this._rightGesture.y;
                if (Math.hypot(dx, dy) >= RIGHT_MOVE_PX) this._rightGesture.moved = true;
            };

            const onUp = (e) => {
                if (e.button !== 2 || !this._rightGesture) return;
                if (this._shouldIgnoreMouse(e)) {
                    // Still clear gesture if a ghost arrives after touch rightup.
                    this._rightGesture = null;
                    return;
                }
                const gesture = this._rightGesture;
                this._rightGesture = null;
                e.preventDefault();
                e.stopPropagation();
                if (this.modes.rightup) this._dispatch("rightup", e, { moved: gesture.moved });
                // righttap only when the pointer barely moved — exclusive of hold/drag.
                if (this.modes.righttap && !gesture.moved) {
                    this._dispatch("righttap", e, { moved: false });
                }
            };

            document.addEventListener("mousedown", onDown, true);
            document.addEventListener("mousemove", onMove, true);
            document.addEventListener("mouseup", onUp, true);
            this._rightBindings = [
                { element: document, event: "mousedown", handler: onDown, capture: true },
                { element: document, event: "mousemove", handler: onMove, capture: true },
                { element: document, event: "mouseup", handler: onUp, capture: true }
            ];
        }

        _removeRightGestureEngine() {
            this._rightBindings.forEach(({ element, event, handler, capture }) => {
                element.removeEventListener(event, handler, capture);
            });
            this._rightBindings = [];
            this._rightGesture = null;
        }

        _isNativeTouchTarget(target) {
            let el =
                target && target.nodeType === 1
                    ? target
                    : target?.parentElement;
            while (el && el !== document.documentElement) {
                if (el.getAttribute?.("data-supermouse-native") != null) {
                    return true;
                }
                const tag = String(el.tagName || "").toLowerCase();
                if (
                    tag === "input" ||
                    tag === "textarea" ||
                    tag === "select" ||
                    tag === "option"
                ) {
                    return true;
                }
                if (el.isContentEditable) return true;
                el = el.parentElement;
            }
            return false;
        }

        _installTouchGuards() {
            if (!isBrowser || this._touchStyleEl) return;
            const style = document.createElement("style");
            style.setAttribute("data-supermouse-touch", "1");
            style.textContent = `
html.supermouse-touch, html.supermouse-touch body {
  -webkit-user-select: none !important;
  user-select: none !important;
  -webkit-touch-callout: none !important;
}
html.supermouse-touch input,
html.supermouse-touch textarea,
html.supermouse-touch select,
html.supermouse-touch [contenteditable=""],
html.supermouse-touch [contenteditable="true"],
html.supermouse-touch [data-supermouse-native],
html.supermouse-touch [data-supermouse-native] * {
  -webkit-user-select: text !important;
  user-select: text !important;
  -webkit-touch-callout: default !important;
}
`.trim();
            (document.head || document.documentElement).appendChild(style);
            this._touchStyleEl = style;
            document.documentElement.classList.add("supermouse-touch");

            this._selectStartBlocker = (e) => {
                if (this._isNativeTouchTarget(e.target)) return;
                e.preventDefault();
            };
            document.addEventListener(
                "selectstart",
                this._selectStartBlocker,
                true
            );
        }

        _removeTouchGuards() {
            if (this._selectStartBlocker) {
                document.removeEventListener(
                    "selectstart",
                    this._selectStartBlocker,
                    true
                );
                this._selectStartBlocker = null;
            }
            document.documentElement.classList.remove("supermouse-touch");
            if (this._touchStyleEl) {
                this._touchStyleEl.remove();
                this._touchStyleEl = null;
            }
        }

        _clearSelection() {
            try {
                const sel = window.getSelection?.();
                if (sel && sel.rangeCount) sel.removeAllRanges();
            } catch (_) {
                /* ignore */
            }
        }

        _syncTouchEngine() {
            if (!isBrowser) return;
            if (this._anyTouchMappedMode()) this._installTouchEngine();
            else this._removeTouchEngine();
        }

        _clearTouchTimer() {
            if (this._touch?.timer != null) {
                clearTimeout(this._touch.timer);
                this._touch.timer = null;
            }
            if (this._touch?.claimTimer != null) {
                clearTimeout(this._touch.claimTimer);
                this._touch.claimTimer = null;
            }
        }

        _claimTouchGesture() {
            const t = this._touch;
            if (!t || t.moved || t.claimed) return;
            t.claimed = true;
            t.claimTimer = null;
            this._clearSelection();
        }

        _fireLongPress() {
            const t = this._touch;
            if (!t || t.moved || t.longPressed) return;
            t.longPressed = true;
            t.claimed = true;
            t.timer = null;
            this._clearSelection();
            const target = this._targetAt(t.x, t.y, t.target);
            t.target = target;
            // Block ghost mouse for the rest of this hold.
            this._suppressMouseGhosts();
            this._rightGesture = {
                x: t.x,
                y: t.y,
                moved: false,
                target,
                fromTouch: true,
            };
            try {
                if (typeof navigator !== "undefined" && navigator.vibrate) {
                    navigator.vibrate(12);
                }
            } catch (_) {
                /* ignore */
            }
            if (this.modes.rightclick) {
                const ev = this._synthPointerEvent({
                    type: "mousedown",
                    target,
                    clientX: t.x,
                    clientY: t.y,
                    button: 2,
                    buttons: 2,
                    fromTouch: true,
                });
                this._dispatch("rightclick", ev);
            }
            // Deliberately no move / mouseover from touch — mouse owns
            // right-hold pointer tracking.
        }

        _installTouchEngine() {
            if (this._touchBindings.length) return;
            this._installTouchGuards();

            const onStart = (e) => {
                if (!e.changedTouches?.length) return;

                // Second finger while primary is in right-hold → leftclick chord.
                if (this._touch?.longPressed && !this._touch2) {
                    const finger = e.changedTouches[0];
                    this._touch2 = {
                        id: finger.identifier,
                        x: finger.clientX,
                        y: finger.clientY,
                        moved: false,
                    };
                    try {
                        e.preventDefault();
                    } catch (_) {
                        /* ignore */
                    }
                    if (this.modes.leftclick && this.preventLeftDefault) {
                        const target = this._targetAt(
                            finger.clientX,
                            finger.clientY,
                            finger.target
                        );
                        const ev = this._synthPointerEvent({
                            type: "mousedown",
                            target,
                            clientX: finger.clientX,
                            clientY: finger.clientY,
                            button: 0,
                            buttons: 3,
                            fromTouch: true,
                        });
                        this._dispatch("leftclick", ev);
                    }
                    return;
                }

                if (this._touch) return;
                if (e.touches && e.touches.length > 1) return;

                const finger = e.changedTouches[0];
                const target = finger.target;
                // Inputs/editors: leave entirely to the browser (no timers).
                if (this._isNativeTouchTarget(target)) return;

                this._touch = {
                    id: finger.identifier,
                    x: finger.clientX,
                    y: finger.clientY,
                    startX: finger.clientX,
                    startY: finger.clientY,
                    target,
                    moved: false,
                    claimed: false,
                    longPressed: false,
                    timer: null,
                    claimTimer: null,
                };
                // Claim before browser long-press UI (~500ms) so select/search never arms.
                this._touch.claimTimer = setTimeout(() => {
                    this._claimTouchGesture();
                }, TOUCH_CLAIM_MS);
                this._touch.timer = setTimeout(() => {
                    this._fireLongPress();
                }, LONG_PRESS_MS);
            };

            const onMove = (e) => {
                if (!e.changedTouches?.length) return;

                if (this._touch2 && this._touch?.longPressed) {
                    for (const finger of e.changedTouches) {
                        if (finger.identifier !== this._touch2.id) continue;
                        const dx = finger.clientX - this._touch2.x;
                        const dy = finger.clientY - this._touch2.y;
                        if (Math.hypot(dx, dy) >= TOUCH_MOVE_PX) {
                            this._touch2.moved = true;
                        }
                        this._touch2.x = finger.clientX;
                        this._touch2.y = finger.clientY;
                        try {
                            e.preventDefault();
                        } catch (_) {
                            /* ignore */
                        }
                        if (this.modes.scroll && (dx || dy)) {
                            const target = this._targetAt(
                                finger.clientX,
                                finger.clientY,
                                this._touch.target
                            );
                            const ev = this._synthPointerEvent({
                                type: "wheel",
                                target,
                                clientX: finger.clientX,
                                clientY: finger.clientY,
                                button: 0,
                                buttons: 2,
                                deltaX: dx,
                                deltaY: dy,
                                fromTouch: true,
                            });
                            this._dispatch("scroll", ev);
                        }
                        return;
                    }
                }

                const t = this._touch;
                if (!t) return;
                let finger = null;
                for (const f of e.changedTouches) {
                    if (f.identifier === t.id) {
                        finger = f;
                        break;
                    }
                }
                if (!finger) return;

                const distFromStart = Math.hypot(
                    finger.clientX - t.startX,
                    finger.clientY - t.startY
                );
                if (!t.moved && distFromStart >= TOUCH_MOVE_PX) {
                    t.moved = true;
                    if (!t.longPressed) {
                        this._clearTouchTimer();
                        t.claimed = false;
                    }
                    if (this._rightGesture && !this._rightGesture.moved) {
                        this._rightGesture.moved = true;
                    }
                }

                // Claimed or long-pressed: own the gesture (block browser callout).
                if (t.claimed || t.longPressed) {
                    try {
                        e.preventDefault();
                    } catch (_) {
                        /* ignore */
                    }
                    t.x = finger.clientX;
                    t.y = finger.clientY;
                    t.target = this._targetAt(t.x, t.y, t.target);
                    if (this._rightGesture) {
                        this._rightGesture.x = t.x;
                        this._rightGesture.y = t.y;
                        this._rightGesture.target = t.target;
                    }
                    // No `move` / mouseover dispatch on touch — mouse owns
                    // right-hold pointer tracking.
                }
            };

            const onEnd = (e) => {
                if (!e.changedTouches?.length) return;

                if (this._touch2) {
                    for (const finger of e.changedTouches) {
                        if (finger.identifier !== this._touch2.id) continue;
                        this._touch2 = null;
                        this._suppressMouseGhosts();
                        try {
                            e.preventDefault();
                        } catch (_) {
                            /* ignore */
                        }
                        return;
                    }
                }

                const t = this._touch;
                if (!t) return;
                let finger = null;
                for (const f of e.changedTouches) {
                    if (f.identifier === t.id) {
                        finger = f;
                        break;
                    }
                }
                if (!finger) return;

                this._clearTouchTimer();
                const x = finger.clientX;
                const y = finger.clientY;
                const target = this._targetAt(x, y, t.target);
                const moved = t.moved;
                const longPressed = t.longPressed;
                const claimed = t.claimed;
                this._touch = null;
                this._touch2 = null;

                if (longPressed) {
                    this._suppressMouseGhosts();
                    this._clearSelection();
                    try {
                        e.preventDefault();
                    } catch (_) {
                        /* ignore */
                    }
                    const gestureMoved = !!(this._rightGesture?.moved || moved);
                    this._rightGesture = null;
                    const ev = this._synthPointerEvent({
                        type: "mouseup",
                        target,
                        clientX: x,
                        clientY: y,
                        button: 2,
                        buttons: 0,
                        fromTouch: true,
                    });
                    if (this.modes.rightup) {
                        this._dispatch("rightup", ev, {
                            moved: gestureMoved,
                            fromTouch: true,
                        });
                    }
                    // Same as mouse: still lift → righttap (dropdown / menu).
                    // Moved hold stays rightclick+rightup only (hold tools).
                    if (this.modes.righttap && !gestureMoved) {
                        this._dispatch("righttap", ev, {
                            moved: false,
                            fromTouch: true,
                        });
                    }
                    return;
                }

                // Held past claim but released before long-press: we may have
                // blocked the browser click — synthesize a real click + leftclick.
                if (claimed && !moved && this.preventLeftDefault) {
                    this._suppressMouseGhosts();
                    try {
                        e.preventDefault();
                    } catch (_) {
                        /* ignore */
                    }
                    if (this.modes.leftclick) {
                        const ev = this._synthPointerEvent({
                            type: "mousedown",
                            target,
                            clientX: x,
                            clientY: y,
                            button: 0,
                            buttons: 1,
                            fromTouch: true,
                        });
                        this._dispatch("leftclick", ev, { fromTouch: true });
                    }
                    try {
                        const el =
                            target?.nodeType === 1
                                ? target
                                : target?.parentElement;
                        el?.dispatchEvent?.(
                            new MouseEvent("click", {
                                bubbles: true,
                                cancelable: true,
                                view: window,
                                clientX: x,
                                clientY: y,
                            })
                        );
                    } catch (_) {
                        /* ignore */
                    }
                    return;
                }

                // Quick tap or pan: do not preventDefault — native click/scroll.
            };

            const opts = { capture: true, passive: false };
            document.addEventListener("touchstart", onStart, opts);
            document.addEventListener("touchmove", onMove, opts);
            document.addEventListener("touchend", onEnd, opts);
            document.addEventListener("touchcancel", onEnd, opts);
            this._touchBindings = [
                { element: document, event: "touchstart", handler: onStart, opts },
                { element: document, event: "touchmove", handler: onMove, opts },
                { element: document, event: "touchend", handler: onEnd, opts },
                { element: document, event: "touchcancel", handler: onEnd, opts },
            ];
        }

        _removeTouchEngine() {
            this._clearTouchTimer();
            this._touchBindings.forEach(({ element, event, handler, opts }) => {
                element.removeEventListener(event, handler, opts);
            });
            this._touchBindings = [];
            this._touch = null;
            this._touch2 = null;
            this._removeTouchGuards();
        }

        _syncContextMenuBlock() {
            if (!isBrowser) return;
            if (this._anyRightMode()) this._installContextMenuBlock();
            else this._removeContextMenuBlock();
        }

        _installContextMenuBlock() {
            if (this._contextMenuBlocker) return;
            this._contextMenuBlocker = (e) => {
                e.preventDefault();
            };
            document.addEventListener("contextmenu", this._contextMenuBlocker, true);
        }

        _removeContextMenuBlock() {
            if (!this._contextMenuBlocker) return;
            document.removeEventListener("contextmenu", this._contextMenuBlocker, true);
            this._contextMenuBlocker = null;
        }

        // Mirror of contextmenu claim: browsers open a new tab on middle-click
        // links via auxclick, not mousedown. Modes default ON at init.
        _syncAuxclickBlock() {
            if (!isBrowser) return;
            if (this._anyMiddleMode()) this._installAuxclickBlock();
            else this._removeAuxclickBlock();
        }

        _installAuxclickBlock() {
            if (this._auxclickBlocker) return;
            this._auxclickBlocker = (e) => {
                if (e.button !== 1) return;
                e.preventDefault();
            };
            document.addEventListener("auxclick", this._auxclickBlocker, true);
        }

        _removeAuxclickBlock() {
            if (!this._auxclickBlocker) return;
            document.removeEventListener("auxclick", this._auxclickBlocker, true);
            this._auxclickBlocker = null;
        }

        _syncLeftDragBlock() {
            if (!isBrowser) return;
            if (this.preventLeftDefault) this._installLeftDragBlock();
            else this._removeLeftDragBlock();
        }

        _installLeftDragBlock() {
            if (this._leftDragBlocker) return;
            this._leftDragBlocker = (e) => {
                if (!this.preventLeftDefault) return;
                if (this._shouldIgnoreMouse(e)) return;
                if ((e.buttons & 1) !== 1) return;
                if (this._isNativeTouchTarget(e.target)) return;
                e.preventDefault();
            };
            document.addEventListener("mousemove", this._leftDragBlocker, true);
        }

        _removeLeftDragBlock() {
            if (!this._leftDragBlocker) return;
            document.removeEventListener("mousemove", this._leftDragBlocker, true);
            this._leftDragBlocker = null;
        }

        _makeContext(type, event, extra = {}) {
            let defaultPrevented = false;
            let propagationStopped = false;
            const host = this;
            const fromTouch = !!(
                extra.fromTouch ||
                event?.fromTouch ||
                event?.pointerType === "touch"
            );
            return {
                type,
                event,
                target: event.target,
                x: event.clientX,
                y: event.clientY,
                deltaX: event.deltaX,
                deltaY: event.deltaY,
                moved: extra.moved,
                fromTouch,
                pointerType:
                    extra.pointerType ||
                    event?.pointerType ||
                    (fromTouch ? "touch" : "mouse"),
                supermouse: this,
                preventDefault() {
                    defaultPrevented = true;
                    if (
                        (type === "leftclick" || type === "move") &&
                        !host.preventLeftDefault
                    ) {
                        return;
                    }
                    event.preventDefault();
                },
                stopPropagation() {
                    propagationStopped = true;
                    if (
                        (type === "leftclick" || type === "move") &&
                        !host.preventLeftDefault
                    ) {
                        return;
                    }
                    event.stopPropagation();
                },
                get defaultPrevented() {
                    return defaultPrevented || event.defaultPrevented;
                },
                get propagationStopped() {
                    return propagationStopped;
                }
            };
        }

        _dispatch(type, event, extra = {}) {
            if (this._leftPassthrough()) {
                if (this._shouldSkipLeftDispatch(type, event)) return;
                // While left-native, plugins only receive right/middle/scroll triggers.
                const leftAssociated = new Set([
                    "leftclick",
                    "doubleclick",
                    "move",
                    "mouseover",
                ]);
                if (leftAssociated.has(type)) return;
            } else if (this._shouldSkipLeftDispatch(type, event)) {
                return;
            }
            const ctx = this._makeContext(type, event, extra);

            for (const plugin of this.plugins.values()) {
                if (!plugin.enabled) continue;
                if (!plugin.modes.includes(type)) continue;

                try {
                    if (plugin.onEvent) plugin.onEvent(type, ctx);
                    const specific = plugin.handlers[type];
                    if (typeof specific === "function") specific(ctx);
                } catch (err) {
                    console.error(`[supermouse] plugin "${plugin.id}" handler failed (${type})`, err);
                }

                if (ctx.propagationStopped) break;
            }
        }
    }

    const supermouse = new SuperMouse();

    const formatModes = () =>
        supermouse
            .listModes()
            .map((m) => `  ${m.id}: ${m.enabled ? "ON" : "OFF"}`)
            .join("\n");

    const formatPlugins = () => {
        const list = supermouse.listPlugins();
        if (!list.length) return "  (none)";
        return list
            .map((p) => `  ${p.enabled ? "[x]" : "[ ]"} ${p.id} — ${p.name}${p.description ? ` (${p.description})` : ""}`)
            .join("\n");
    };

    const formatTriggers = () =>
        supermouse
            .listTriggers()
            .map((t) => {
                const plugs = t.plugins.length ? t.plugins.join(", ") : "(no plugins)";
                return [
                    `  ${t.id} [${t.enabled ? "ON" : "OFF"}] ← ${plugs}`,
                    `    when: ${t.when}`,
                    `    note: ${t.note}`
                ].join("\n");
            })
            .join("\n");

    return {
        name: "supermouse",
        version: "0.4.10",
        description:
            "Mouse+touch host — long-press→rightclick/up; still lift→righttap",

        moduleInfo: {
            name: "supermouse",
            version: "0.4.10",
            description: "Mouse+touch mode host for navi UI plugins"
        },

        supermouse,
        MODE_KEYS,
        TRIGGER_INFO,
        RIGHT_MOVE_PX,
        TOUCH_MOVE_PX,
        LONG_PRESS_MS,
        TOUCH_CLAIM_MS,

        commands: {
            supermouse: {
                name: "supermouse",
                description: "supermouse <status|triggers|mode|plugin|preventleft|help>",
                execute: async (subcommand, ...args) => {
                    if (!subcommand || subcommand === "help") {
                        return [
                            "supermouse v0.4.10 — mouse + touch trigger host",
                            "",
                            "  supermouse status",
                            "  supermouse triggers     — catalog + which plugins listen (see non-overlap notes)",
                            "  supermouse mode [name] [on|off|toggle]",
                            "  supermouse preventleft [on|off|toggle] — OFF: native left click (capture gate)",
                            "  supermouse plugin list",
                            "  supermouse plugin enable <id>",
                            "  supermouse plugin disable <id>",
                            "  supermouse plugin toggle <id>",
                            "  supermouse help",
                            "",
                            `Modes: ${MODE_KEYS.join(", ")}`,
                            "",
                            "Right-button split:",
                            "  rightclick = DOWN",
                            "  rightup    = UP (always)",
                            `  righttap   = DOWN+UP with little move (menu) — skipped if moved`,
                            "",
                            "Touch:",
                            "  short tap / scroll     → native until claim;",
                            `  still-hold ≥${TOUCH_CLAIM_MS}ms → claim (kill select/search UI)`,
                            `  still-hold ≥${LONG_PRESS_MS}ms → rightclick; lift → rightup; still → righttap`,
                            "  2nd finger while hold  → leftclick; drag → scroll",
                            "  (no touch synthesis of right-hold move/mouseover)"
                        ].join("\n");
                    }

                    if (subcommand === "status") {
                        return [
                            `supermouse: ${supermouse.isActive ? "ACTIVE" : "INACTIVE"}`,
                            `preventLeftDefault: ${supermouse.isPreventLeftDefault() ? "ON" : "OFF"}`,
                            "modes:",
                            formatModes(),
                            "plugins:",
                            formatPlugins()
                        ].join("\n");
                    }

                    if (
                        subcommand === "preventleft" ||
                        subcommand === "prevent-left" ||
                        subcommand === "leftdefault"
                    ) {
                        const [action] = args;
                        if (!action || action === "status") {
                            return `preventLeftDefault: ${supermouse.isPreventLeftDefault() ? "ON" : "OFF"}`;
                        }
                        if (action === "on" || action === "enable" || action === "true" || action === "1") {
                            supermouse.setPreventLeftDefault(true);
                            return "preventLeftDefault: ON";
                        }
                        if (action === "off" || action === "disable" || action === "false" || action === "0") {
                            supermouse.setPreventLeftDefault(false);
                            return "preventLeftDefault: OFF";
                        }
                        if (action === "toggle") {
                            const on = supermouse.togglePreventLeftDefault();
                            return `preventLeftDefault: ${on ? "ON" : "OFF"}`;
                        }
                        return `Unknown preventleft action "${action}". Use on|off|toggle`;
                    }

                    if (subcommand === "triggers" || subcommand === "trigger") {
                        return [
                            "supermouse triggers — when each fires, and who listens",
                            "",
                            "Non-overlap (right button):",
                            "  • rightclick fires on DOWN only",
                            "  • rightup fires on UP always (after a down)",
                            `  • righttap fires on UP only if movement < ${RIGHT_MOVE_PX}px`,
                            "  • if the pointer moved during the hold, righttap does NOT fire",
                            "  → dropdown (righttap) and hold tools (rightclick+rightup+move) do not claim the same completion",
                            "",
                            "Touch:",
                            `  • ≥${TOUCH_CLAIM_MS}ms still → claim (user-select/callout suppressed)`,
                            `  • ≥${LONG_PRESS_MS}ms → rightclick; lift → rightup; still lift → righttap`,
                            "  • quick tap / pan before claim → native browser",
                            "  • 2nd finger during right-hold → leftclick / scroll",
                            "  • no right-hold move/mouseover from touch (mouse only)",
                            "",
                            formatTriggers()
                        ].join("\n");
                    }

                    if (subcommand === "mode") {
                        const [name, action] = args;
                        if (!name) {
                            return `modes:\n${formatModes()}`;
                        }
                        try {
                            if (!action || action === "status") {
                                return `mode ${name}: ${supermouse.isModeEnabled(name) ? "ON" : "OFF"}`;
                            }
                            if (action === "on" || action === "enable" || action === "true" || action === "1") {
                                supermouse.enableMode(name);
                                return `mode ${name}: ON`;
                            }
                            if (action === "off" || action === "disable" || action === "false" || action === "0") {
                                supermouse.disableMode(name);
                                return `mode ${name}: OFF`;
                            }
                            if (action === "toggle") {
                                const on = supermouse.toggleMode(name);
                                return `mode ${name}: ${on ? "ON" : "OFF"}`;
                            }
                            return `Unknown mode action "${action}". Use on|off|toggle`;
                        } catch (err) {
                            return `Error: ${err.message}`;
                        }
                    }

                    if (subcommand === "plugin" || subcommand === "plugins") {
                        const [action, id] = args;
                        if (!action || action === "list" || action === "index") {
                            return `plugins:\n${formatPlugins()}`;
                        }
                        if (!id) return "Usage: supermouse plugin <enable|disable|toggle> <id>";
                        if (action === "enable" || action === "on") {
                            const ok = supermouse.enablePlugin(id);
                            return ok ? `plugin ${id}: enabled` : `plugin "${id}" not found`;
                        }
                        if (action === "disable" || action === "off") {
                            const found = !!supermouse.getPlugin(id);
                            if (!found) return `plugin "${id}" not found`;
                            supermouse.disablePlugin(id);
                            return `plugin ${id}: disabled`;
                        }
                        if (action === "toggle") {
                            const result = supermouse.togglePlugin(id);
                            if (result === null) return `plugin "${id}" not found`;
                            return `plugin ${id}: ${result ? "enabled" : "disabled"}`;
                        }
                        return `Unknown plugin action "${action}". Use list|enable|disable|toggle`;
                    }

                    return `Unknown command "${subcommand}". Type 'supermouse help'.`;
                }
            }
        },

        onMount: async () => {
            if (isBrowser) {
                supermouse.init();
                if (typeof navi.callout === "function") {
                    navi.callout("[supermouse] mounted — try: supermouse triggers");
                } else {
                    console.log("[supermouse] mounted — try: supermouse triggers");
                }
            } else {
                console.log("[supermouse] browser required — inactive");
            }
        },

        onUnmount: () => {
            supermouse._emitHost("unmount", {});
            if (supermouse.isActive) supermouse.shutdown();
            if (typeof navi.callout === "function") {
                navi.callout("[supermouse] unmounted");
            } else {
                console.log("[supermouse] unmounted");
            }
        }
    };
};
