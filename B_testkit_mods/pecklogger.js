/**
 * pecklogger — viewport logger for navi callouts (console secondary) and dock callins.
 *
 * Tip lineages
 *   - navi:pecklog:callouts
 *   - navi:pecklog:callins
 * Each new log is tip.mut8(ib, data, { replaceData: true, create: true }) whose
 * data is only that log: message, type, timestamp (navi.stamp.time()), parts.
 * Generations are pruned when tip.frame.list(ib).length exceeds the cache
 * setting: delete oldest (past chain, then timestamp); never delete the live tip gib.
 *
 * Settings
 *   - callouts visible (UI window, default 12) vs cache (tip frame retention, default 24)
 *   - callins cache (default 24)
 *   - temp on/off scroll (temp OFF: sliding visible window; temp ON: pointer scrub + fade)
 *   - scrubMode: callouts | callins (dock wheel)
 *   - middle-click dock pauses/unpauses temp fading
 *
 * Panel nodes (#peck-log-container + restore chip) mount on documentElement
 * (sibling of body), same pattern as scrollball — not surf.persist'd. Body
 * transform / document scroll must not drag them off the viewport.
 *
 * Command: pecklogger
 */

export const register = (navi) => {
    const isBrowser =
        typeof window !== "undefined" && typeof window.document !== "undefined";

    const eventListeners = [];
    const createdElements = [];
    const addedStyles = [];
    const observers = [];
    const timers = [];

    const LOG_TYPES = ["container", "log", "error", "warn", "info", "callout"];
    const DECAY_MS = 3000;
    const DEFAULT_TEMP_SECONDS = 3;
    const DEFAULT_VISIBLE = 12;
    const DEFAULT_CACHE = 24;
    const DEFAULT_CALLIN_CACHE = 24;
    const CALLIN_PREVIEW_MS = 3000;
    const DEFAULT_AUTOMIN_SECONDS = 12;
    const INPUT_EXPAND_PX = 10;
    const SUBMIT_FLASH_MS = 280;

    const CALLOUTS_IB = "navi:pecklog:callouts";
    const CALLINS_IB = "navi:pecklog:callins";

    const DEFAULT_COLORS = {
        container: { text: "black", bg: "white" },
        log: { text: "#555555", bg: "transparent" },
        error: { text: "#ff5555", bg: "#550000" },
        warn: { text: "#ffff55", bg: "#555500" },
        info: { text: "#55ffff", bg: "#005555" },
        callout: { text: "black", bg: "transparent" },
    };

    const trackTimeout = (fn, ms) => {
        const id = setTimeout(fn, ms);
        timers.push({ type: "timeout", id });
        return id;
    };

    const trackInterval = (fn, ms) => {
        const id = setInterval(fn, ms);
        timers.push({ type: "interval", id });
        return id;
    };

    const clearTrackedTimeout = (id) => {
        if (id == null) return;
        clearTimeout(id);
        const idx = timers.findIndex((t) => t.type === "timeout" && t.id === id);
        if (idx >= 0) timers.splice(idx, 1);
    };

    /** Best-effort CSS color + opacity → usable background. */
    const withOpacity = (color, opacity) => {
        const o = Math.max(0, Math.min(1, Number(opacity)));
        const c = String(color || "transparent").trim();
        if (c === "transparent" || o >= 1) return c;
        if (o <= 0) return "transparent";

        const hex = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
        if (hex) {
            let h = hex[1];
            if (h.length === 3) {
                h = h
                    .split("")
                    .map((ch) => ch + ch)
                    .join("");
            }
            const r = parseInt(h.slice(0, 2), 16);
            const g = parseInt(h.slice(2, 4), 16);
            const b = parseInt(h.slice(4, 6), 16);
            return `rgba(${r},${g},${b},${o})`;
        }

        const rgb = c.match(
            /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i
        );
        if (rgb) {
            return `rgba(${rgb[1]},${rgb[2]},${rgb[3]},${o})`;
        }

        return `color-mix(in srgb, ${c} ${Math.round(o * 100)}%, transparent)`;
    };

    const stampNow = () => {
        if (typeof navi.stamp?.time === "function") return navi.stamp.time();
        return new Date().toISOString();
    };

    const displayTime = (ts) => {
        if (ts == null || ts === "") return new Date().toLocaleTimeString();
        const s = String(ts);
        // Prefer a short local clock when stamp looks ISO-like.
        const d = Date.parse(s);
        if (Number.isFinite(d)) return new Date(d).toLocaleTimeString();
        return s.length > 24 ? s.slice(0, 24) : s;
    };

    class PeckLogger {
        constructor() {
            this.CALLOUTS_IB = CALLOUTS_IB;
            this.CALLINS_IB = CALLINS_IB;

            /** Callouts newest-first (mirror of tip lineage). */
            this.logs = [];
            /** Callin strings/entries newest-first { id, message, timestamp }. */
            this.callins = [];

            this.visibleSize = DEFAULT_VISIBLE;
            this.cacheSize = DEFAULT_CACHE;
            this.callinCacheSize = DEFAULT_CALLIN_CACHE;

            /** Temp OFF: how many newest entries are skipped (0 = latest window). */
            this.viewOffset = 0;
            /** Temp ON: index into logs being scrubbed (0 = newest). */
            this.tempPointer = 0;
            this.fadePaused = false;
            this.scrubMode = "callouts";

            this._callinPreviewActive = false;
            this._callinPreviewTimer = null;
            this._callinScrubIndex = -1;

            this.maxHeightVh = 30;
            this.fontSizePx = 11;
            this.bgOpacity = 1;
            this.tempMode = false;
            this.tempSeconds = DEFAULT_TEMP_SECONDS;
            /** When true, panel does not steal clicks on overlapped page content. */
            this.clickthru = false;
            /** Preference: after empty dock idle, shrink into minimize. */
            this.autominimize = false;
            this.autominimizeSeconds = DEFAULT_AUTOMIN_SECONDS;
            /** Lowercase dock input before navi callin (default on). */
            this.lowercaseCallin = true;
            this.isEnabled = true;
            this.isMinimized = true;
            this.inputOpen = false;
            this.logContainer = null;
            this.entriesEl = null;
            this.dockEl = null;
            this.inputEl = null;
            this.minimizeButton = null;
            this.restoreButton = null;
            this.originalConsoleLog = null;
            this.originalConsoleError = null;
            this.originalConsoleWarn = null;
            this.originalConsoleInfo = null;
            this.calloutHandler = null;
            this._lastConsoleLogMessage = null;
            this._lastConsoleLogTime = 0;
            this._nextId = 1;
            this._decayTimers = new Map(); // entryId -> { holdId, removeId }
            this._emptySince = null;
            this._autominTimer = null;
            this._autominAnimating = false;
            this._submitBusy = false;
            this.storageKey = "pecklogger_settings";
            this.colors = structuredClone(DEFAULT_COLORS);
        }

        async initialize() {
            if (!isBrowser) {
                console.log("[pecklogger] Browser environment required for viewport display");
                return;
            }

            await this.loadSettings();
            await this.saveSettings();

            this.logs = await this._loadLogTip(CALLOUTS_IB);
            this.callins = await this._loadLogTip(CALLINS_IB);

            this.createLogContainer();
            this.setupCalloutListener();
            this.overrideConsoleLog();
            this.setupStyles();
            this.applyChrome();
            this.applyClickthru();
            if (this.isMinimized) {
                if (this.logContainer) this.logContainer.style.display = "none";
                if (this.restoreButton) this.restoreButton.style.display = "block";
            } else {
                this.render();
            }
            this._startAutominWatcher();

            navi.callout("[pecklogger] initialized");
        }

        // ── Tip log API ──────────────────────────────────────────────────────

        async _appendLogTip(tipIb, { message, type }, cacheLimit) {
            if (typeof navi.storage?.tip?.mut8 !== "function") {
                console.warn("[pecklogger] navi.storage.tip.mut8 unavailable");
                return null;
            }
            const data = {
                message: String(message ?? ""),
                type: String(type || "callout"),
                timestamp: stampNow(),
                parts: ["pecklog", String(type || "callout")],
            };
            try {
                const frame = await navi.storage.tip.mut8(tipIb, data, {
                    replaceData: true,
                    create: true,
                });
                await this._pruneLogTip(tipIb, cacheLimit);
                return frame;
            } catch (err) {
                console.warn("[pecklogger] tip.mut8 failed:", err);
                return null;
            }
        }

        async _pruneLogTip(tipIb, cacheLimit) {
            const tipApi = navi.storage?.tip;
            if (!tipApi?.frame?.list || !tipApi.frame?.get || !tipApi.frame?.del) {
                return;
            }
            const limit = Math.max(0, Math.floor(Number(cacheLimit) || 0));
            let addrs;
            try {
                addrs = (await tipApi.frame.list(tipIb)) || [];
            } catch {
                return;
            }
            if (addrs.length <= limit) return;

            let liveGib = "";
            try {
                const tip = await tipApi.get(tipIb);
                liveGib = String(tip?.gib || "").trim();
            } catch {
                /* ignore */
            }
            const liveAddr = liveGib ? `${tipIb}^${liveGib}` : "";

            const frames = (await this._framesNewestFirst(tipIb, addrs)).reverse();

            let count = frames.length;
            for (const fr of frames) {
                if (count <= limit) break;
                if (liveAddr && fr.addr === liveAddr) continue;
                if (
                    liveGib &&
                    fr.addr.toUpperCase() === `${tipIb}^${liveGib}`.toUpperCase()
                ) {
                    continue;
                }
                try {
                    await tipApi.frame.del(fr.addr);
                    count -= 1;
                } catch (err) {
                    console.warn("[pecklogger] frame.del failed:", err);
                }
            }
        }

        /**
         * Frame index for tipIb ordered newest-first: past chain from the live
         * tip, then off-chain frames by data.timestamp.
         * @returns {Promise<Array<{ addr: string, frame: any }>>}
         */
        async _framesNewestFirst(tipIb, addrs) {
            const tipApi = navi.storage?.tip;
            const pending = new Map();
            for (const addr of addrs || []) {
                let f = null;
                try {
                    f = await tipApi.frame.get(addr);
                } catch {
                    /* ignore */
                }
                pending.set(String(addr).toUpperCase(), {
                    addr: String(addr),
                    frame: f && typeof f === "object" ? f : null,
                });
            }
            const out = [];
            let frame = null;
            try {
                frame = await tipApi.get(tipIb);
            } catch {
                /* ignore */
            }
            const seen = new Set();
            while (frame?.gib) {
                const key = `${tipIb}^${frame.gib}`.toUpperCase();
                if (seen.has(key)) break;
                seen.add(key);
                const hit = pending.get(key);
                out.push(hit || { addr: `${tipIb}^${frame.gib}`, frame });
                pending.delete(key);
                const past =
                    Array.isArray(frame.rel8ns?.past) && frame.rel8ns.past[0]
                        ? String(frame.rel8ns.past[0])
                        : "";
                if (!past) break;
                const next = pending.get(past.toUpperCase());
                if (next?.frame) {
                    frame = next.frame;
                    continue;
                }
                try {
                    frame = await tipApi.frame.get(past);
                } catch {
                    frame = null;
                }
            }
            const stamp = (e) => Date.parse(e.frame?.data?.timestamp) || 0;
            const rest = [...pending.values()].sort((a, b) => stamp(b) - stamp(a));
            return out.concat(rest);
        }

        /**
         * Load tip lineage newest-first for the in-memory mirror.
         * @returns {Array<{ id, type, message, timestamp, shownAt, faded }>}
         */
        async _loadLogTip(tipIb) {
            const tipApi = navi.storage?.tip;
            if (!tipApi?.get) return [];

            const out = [];
            try {
                if (tipApi.frame?.list && tipApi.frame?.get) {
                    const addrs = (await tipApi.frame.list(tipIb)) || [];
                    const entries = await this._framesNewestFirst(tipIb, addrs);
                    for (const { frame: f } of entries) {
                        if (!f) continue;
                        const d = f.data || {};
                        out.push({
                            id: this._nextId++,
                            type: String(d.type || "callout"),
                            message: String(d.message ?? ""),
                            timestamp: d.timestamp != null ? String(d.timestamp) : "",
                            shownAt: null,
                            faded: true,
                        });
                    }
                    return out;
                }

                // Fallback: walk past chain from live tip.
                let frame = await tipApi.get(tipIb);
                let guard = 0;
                while (frame && guard < 500) {
                    const d = frame.data || {};
                    out.push({
                        id: this._nextId++,
                        type: String(d.type || "callout"),
                        message: String(d.message ?? ""),
                        timestamp: d.timestamp != null ? String(d.timestamp) : "",
                        shownAt: null,
                        faded: true,
                    });
                    const past =
                        Array.isArray(frame.rel8ns?.past) && frame.rel8ns.past[0]
                            ? String(frame.rel8ns.past[0])
                            : "";
                    if (!past || !tipApi.frame?.get) break;
                    guard += 1;
                    frame = await tipApi.frame.get(past);
                }
            } catch (err) {
                console.warn("[pecklogger] _loadLogTip failed:", err);
            }
            return out;
        }

        async _clearLogTip(tipIb) {
            if (typeof navi.storage?.tip?.del !== "function") return;
            try {
                await navi.storage.tip.del(tipIb);
            } catch (err) {
                console.warn("[pecklogger] tip.del failed:", err);
            }
        }

        // ── Settings ─────────────────────────────────────────────────────────

        async loadSettings() {
            try {
                this.colors = structuredClone(DEFAULT_COLORS);
                const settings = await navi.storage.item.get(this.storageKey);
                if (!settings) return;
                const parsed =
                    typeof settings === "string" ? JSON.parse(settings) : settings;

                // Migrate old maxLogs → visibleSize
                if (parsed.visibleSize != null) {
                    this.visibleSize = Math.max(
                        1,
                        Math.min(200, Number(parsed.visibleSize) || DEFAULT_VISIBLE)
                    );
                } else if (parsed.maxLogs != null) {
                    this.visibleSize = Math.max(
                        1,
                        Math.min(200, Number(parsed.maxLogs) || DEFAULT_VISIBLE)
                    );
                }

                // Old cacheSize (fade revive) becomes tip cache
                if (parsed.cacheSize != null) {
                    this.cacheSize = Math.max(
                        0,
                        Math.min(500, Number(parsed.cacheSize) || DEFAULT_CACHE)
                    );
                }
                if (parsed.callinCacheSize != null) {
                    this.callinCacheSize = Math.max(
                        0,
                        Math.min(500, Number(parsed.callinCacheSize) || DEFAULT_CALLIN_CACHE)
                    );
                }

                if (parsed.scrubMode === "callouts" || parsed.scrubMode === "callins") {
                    this.scrubMode = parsed.scrubMode;
                }

                if (parsed.maxHeightVh != null) {
                    this.maxHeightVh = Math.max(5, Math.min(100, Number(parsed.maxHeightVh) || 30));
                }
                if (parsed.fontSizePx != null) {
                    this.fontSizePx = Math.max(8, Math.min(48, Number(parsed.fontSizePx) || 11));
                }
                if (parsed.bgOpacity != null) {
                    let o = Number(parsed.bgOpacity);
                    if (o > 1) o = o / 100;
                    this.bgOpacity = Math.max(0, Math.min(1, Number.isFinite(o) ? o : 1));
                }
                if (parsed.tempMode != null) this.tempMode = !!parsed.tempMode;
                if (parsed.tempSeconds != null) {
                    this.tempSeconds = Math.max(0, Number(parsed.tempSeconds) || DEFAULT_TEMP_SECONDS);
                }
                if (parsed.clickthru != null) this.clickthru = !!parsed.clickthru;
                if (parsed.autominimize != null) this.autominimize = !!parsed.autominimize;
                if (parsed.autominimizeSeconds != null) {
                    this.autominimizeSeconds = Math.max(
                        0,
                        Number(parsed.autominimizeSeconds) || DEFAULT_AUTOMIN_SECONDS
                    );
                }
                this.lowercaseCallin = parsed.lowercaseCallin !== false;
                this.isEnabled = parsed.isEnabled !== false;

                if (parsed.colors) {
                    for (const type of LOG_TYPES) {
                        if (parsed.colors[type]) {
                            this.colors[type] = {
                                ...this.colors[type],
                                ...parsed.colors[type],
                            };
                        }
                    }
                }
                if (parsed.textColor) this.colors.container.text = parsed.textColor;
                if (parsed.bgColor) this.colors.container.bg = parsed.bgColor;
            } catch (error) {
                console.error("[pecklogger] Failed to load settings:", error);
            }
        }

        async saveSettings() {
            try {
                const settings = {
                    visibleSize: this.visibleSize,
                    cacheSize: this.cacheSize,
                    callinCacheSize: this.callinCacheSize,
                    scrubMode: this.scrubMode,
                    maxHeightVh: this.maxHeightVh,
                    fontSizePx: this.fontSizePx,
                    bgOpacity: this.bgOpacity,
                    tempMode: this.tempMode,
                    tempSeconds: this.tempSeconds,
                    clickthru: this.clickthru,
                    autominimize: this.autominimize,
                    autominimizeSeconds: this.autominimizeSeconds,
                    lowercaseCallin: this.lowercaseCallin,
                    isEnabled: this.isEnabled,
                    colors: this.colors,
                    textColor: this.colors.container.text,
                    bgColor: this.colors.container.bg,
                };
                await navi.storage.item.set(this.storageKey, JSON.stringify(settings));
            } catch (error) {
                console.error("[pecklogger] Failed to save settings:", error);
            }
        }

        // ── DOM / chrome ─────────────────────────────────────────────────────

        createLogContainer() {
            const existing = document.getElementById("peck-log-container");
            if (existing) {
                existing.remove();
            }
            if (this.restoreButton) {
                this.restoreButton.remove();
                this.restoreButton = null;
            }

            this.logContainer = document.createElement("div");
            this.logContainer.id = "peck-log-container";
            this.logContainer.style.cssText = `
                position: fixed;
                bottom: 0;
                left: 0;
                right: 0;
                max-height: ${this.maxHeightVh}vh;
                display: flex;
                flex-direction: column;
                overflow: hidden;
                background: ${withOpacity(this.colors.container.bg, this.bgOpacity)};
                color: ${this.colors.container.text};
                font-family: 'MS Sans Serif', 'Fixedsys', 'Terminal', monospace;
                font-size: ${this.fontSizePx}px;
                line-height: 1.1;
                padding: 0;
                z-index: 10000;
                pointer-events: auto;
                border-top: 2px inset #c0c0c0;
                border-left: 2px inset #c0c0c0;
                border-right: 2px outset #808080;
                border-bottom: 2px outset #808080;
                box-sizing: border-box;
                transform-origin: bottom right;
                transition: transform 0.55s ease, opacity 0.55s ease, max-height 0.35s ease, padding 0.2s ease;
            `;

            this.minimizeButton = document.createElement("div");
            this.minimizeButton.className = "peck-chrome";
            this.minimizeButton.textContent = "minimize";
            this.minimizeButton.style.cssText = `
                position: absolute;
                top: 2px;
                right: 4px;
                background: #c0c0c0;
                color: #000000;
                padding: 1px 4px;
                font-size: 9px;
                cursor: pointer;
                border: 1px outset #c0c0c0;
                font-family: 'MS Sans Serif', sans-serif;
                user-select: none;
                z-index: 2;
                pointer-events: auto;
                display: none;
            `;
            const minimizeHandler = (e) => {
                e.stopPropagation();
                this.minimize();
            };
            this.minimizeButton.addEventListener("click", minimizeHandler);
            this.logContainer.appendChild(this.minimizeButton);
            eventListeners.push({
                element: this.minimizeButton,
                event: "click",
                handler: minimizeHandler,
            });

            this.entriesEl = document.createElement("div");
            this.entriesEl.id = "peck-log-entries";
            this.entriesEl.style.cssText = `
                flex: 0 0 auto;
                overflow-y: auto;
                overflow-x: hidden;
                min-height: 0;
                height: 0;
                display: none;
                padding: 0 4px;
                box-sizing: border-box;
            `;
            this.logContainer.appendChild(this.entriesEl);

            const lineH = this._dockLinePx();
            this.dockEl = document.createElement("div");
            this.dockEl.id = "peck-log-dock";
            this._updateDockTitle();
            this.dockEl.style.cssText = `
                flex: 0 0 auto;
                min-height: ${lineH}px;
                height: ${lineH}px;
                box-sizing: border-box;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: text;
                pointer-events: auto;
                transition: height 0.28s ease, min-height 0.28s ease;
                overflow: hidden;
                padding: 0 4px;
            `;

            this.inputEl = document.createElement("input");
            this.inputEl.id = "peck-log-input";
            this.inputEl.type = "text";
            this.inputEl.autocomplete = "off";
            this.inputEl.spellcheck = false;
            this.inputEl.setAttribute("aria-label", "navi callin");
            this.inputEl.style.cssText = `
                display: none;
                width: calc(100% - 16px);
                margin: 0 8px;
                box-sizing: border-box;
                background: #f4f4f4;
                color: #000;
                border: 1px solid silver;
                outline: none;
                font-family: 'Fixedsys', 'Terminal', 'Courier New', monospace;
                font-size: inherit;
                line-height: 1.2;
                padding: 2px 6px;
                text-align: center;
                transform: scaleX(0.04);
                transform-origin: center center;
                transition:
                    transform 0.28s ease,
                    border-color 0.15s ease,
                    color 0.12s ease;
                pointer-events: auto;
            `;
            this.dockEl.appendChild(this.inputEl);
            this.logContainer.appendChild(this.dockEl);

            const dockClick = (e) => {
                if (e.target === this.inputEl && !this._callinPreviewActive) return;
                if (this._submitBusy) return;
                if (this._callinPreviewActive) {
                    e.preventDefault();
                    e.stopPropagation();
                    this._promoteCallinPreview();
                    return;
                }
                this.openInput();
            };
            this.dockEl.addEventListener("click", dockClick);
            eventListeners.push({
                element: this.dockEl,
                event: "click",
                handler: dockClick,
            });

            const dockAuxClick = (e) => {
                if (e.button !== 1) return;
                e.preventDefault();
                e.stopPropagation();
                this.toggleFadePaused();
            };
            this.dockEl.addEventListener("auxclick", dockAuxClick);
            eventListeners.push({
                element: this.dockEl,
                event: "auxclick",
                handler: dockAuxClick,
            });
            const dockMiddleDown = (e) => {
                if (e.button !== 1) return;
                e.preventDefault();
            };
            this.dockEl.addEventListener("mousedown", dockMiddleDown);
            eventListeners.push({
                element: this.dockEl,
                event: "mousedown",
                handler: dockMiddleDown,
            });

            const dockWheel = (e) => {
                const onDock = this.dockEl.contains(e.target);
                const visible = this._visibleEntryCount();
                if (!onDock && visible > 0 && this.scrubMode === "callouts" && !this.tempMode) {
                    // Allow native scroll inside entry list when temp OFF and entries visible.
                    return;
                }
                if (!onDock && visible > 0 && this.scrubMode === "callouts") return;

                if (this.scrubMode === "callins") {
                    if (this._scrubCallinsWheel(e.deltaY)) {
                        e.preventDefault();
                        this._bumpActivity();
                    }
                    return;
                }

                // scrubMode === callouts
                if (this._scrubCalloutsWheel(e.deltaY)) {
                    e.preventDefault();
                    this._bumpActivity();
                }
            };
            this.logContainer.addEventListener("wheel", dockWheel, { passive: false });
            eventListeners.push({
                element: this.logContainer,
                event: "wheel",
                handler: dockWheel,
            });

            const onKey = (e) => {
                if (!this.inputOpen && !this._callinPreviewActive) return;
                if (e.key === "Escape") {
                    e.preventDefault();
                    if (this._callinPreviewActive) this._hideCallinPreview();
                    else this.closeInput({ animate: true });
                    return;
                }
                if (e.key === "Enter" && this.inputOpen && !this._callinPreviewActive) {
                    e.preventDefault();
                    this.submitInput();
                }
            };
            this.inputEl.addEventListener("keydown", onKey);
            eventListeners.push({
                element: this.inputEl,
                event: "keydown",
                handler: onKey,
            });

            const entriesClick = (e) => e.stopPropagation();
            this.entriesEl.addEventListener("click", entriesClick);
            eventListeners.push({
                element: this.entriesEl,
                event: "click",
                handler: entriesClick,
            });

            this.restoreButton = document.createElement("div");
            this.restoreButton.id = "peck-log-restore";
            this.restoreButton.className = "peck-chrome";
            this.restoreButton.textContent = "peck";
            this.restoreButton.style.cssText = `
                position: fixed;
                bottom: 10px;
                right: 10px;
                background: #c0c0c0;
                color: #000000;
                padding: 4px 8px;
                font-size: 10px;
                cursor: pointer;
                border: 2px outset #c0c0c0;
                font-family: 'MS Sans Serif', sans-serif;
                user-select: none;
                z-index: 10001;
                display: none;
                pointer-events: auto;
            `;
            const restoreHandler = () => this.restore();
            this.restoreButton.addEventListener("click", restoreHandler);
            // Sibling of body — viewport chrome (like scrollball), not surf.persist.
            document.documentElement.appendChild(this.restoreButton);
            eventListeners.push({
                element: this.restoreButton,
                event: "click",
                handler: restoreHandler,
            });

            document.documentElement.appendChild(this.logContainer);
            this._bindViewportGlue();
            createdElements.push(this.logContainer, this.restoreButton);
        }

        /**
         * Keep panel/restore as direct children of <html> with position:fixed.
         * If something reparents them under body (or a scrollport), remount.
         */
        _ensureViewportHost() {
            if (!isBrowser || !document.documentElement) return;
            const host = document.documentElement;
            for (const el of [this.logContainer, this.restoreButton]) {
                if (!(el instanceof HTMLElement) || !el.isConnected) continue;
                if (el.parentElement !== host) {
                    host.appendChild(el);
                }
                if (el.style.position !== "fixed") {
                    el.style.position = "fixed";
                }
            }
        }

        _bindViewportGlue() {
            if (!isBrowser || this._viewportGlueBound) return;
            this._viewportGlueBound = true;
            const glue = () => this._ensureViewportHost();
            window.addEventListener("scroll", glue, true);
            window.addEventListener("resize", glue);
            document.addEventListener("scroll", glue, true);
            eventListeners.push(
                { element: window, event: "scroll", handler: glue, opts: true },
                { element: window, event: "resize", handler: glue },
                { element: document, event: "scroll", handler: glue, opts: true }
            );
            // Capture reparent after layout / other mods.
            const mo = new MutationObserver(glue);
            mo.observe(document.documentElement, { childList: true, subtree: true });
            observers.push(mo);
            glue();
        }

        _updateDockTitle() {
            if (!this.dockEl) return;
            const scrub = this.scrubMode === "callins" ? "callins" : "callouts";
            const pause = this.fadePaused ? "paused" : "running";
            this.dockEl.title =
                `scrub: ${scrub} · wheel: scrub · middle-click: pause fade (${pause}) · click: navi input`;
        }

        setupStyles() {
            const existing = document.querySelector("style[data-pecklogger]");
            if (existing) {
                const idx = addedStyles.indexOf(existing);
                if (idx >= 0) addedStyles.splice(idx, 1);
                existing.remove();
            }

            const style = document.createElement("style");
            style.setAttribute("data-pecklogger", "true");
            style.textContent = `
                #peck-log-container {
                    position: fixed !important;
                    bottom: 0 !important;
                    left: 0 !important;
                    right: 0 !important;
                    z-index: 10000 !important;
                }
                #peck-log-restore {
                    position: fixed !important;
                    bottom: 10px !important;
                    right: 10px !important;
                    z-index: 10001 !important;
                }
                .peck-log-entry {
                    margin: 0;
                    padding: 1px 2px;
                    word-wrap: break-word;
                    white-space: pre-wrap;
                    font-family: inherit;
                    border: none;
                    font-size: inherit;
                    line-height: inherit;
                    overflow: hidden;
                    max-height: 40em;
                    opacity: 1;
                    box-sizing: border-box;
                    transition:
                        max-height ${DECAY_MS}ms ease,
                        opacity ${DECAY_MS}ms ease,
                        padding ${DECAY_MS}ms ease,
                        margin ${DECAY_MS}ms ease,
                        background-color ${DECAY_MS}ms ease;
                }

                .peck-log-entry.peck-decay {
                    max-height: 0 !important;
                    opacity: 0;
                    padding-top: 0 !important;
                    padding-bottom: 0 !important;
                    margin: 0 !important;
                    background-color: transparent !important;
                    pointer-events: none;
                }

                .peck-log-entry.log {
                    color: ${this.colors.log.text};
                    background: ${this.colors.log.bg};
                }
                .peck-log-entry.error {
                    color: ${this.colors.error.text};
                    background: ${this.colors.error.bg};
                }
                .peck-log-entry.warn {
                    color: ${this.colors.warn.text};
                    background: ${this.colors.warn.bg};
                }
                .peck-log-entry.info {
                    color: ${this.colors.info.text};
                    background: ${this.colors.info.bg};
                }
                .peck-log-entry.callout {
                    color: ${this.colors.callout.text};
                    background: ${this.colors.callout.bg};
                }

                .peck-log-timestamp {
                    color: color-mix(in srgb, ${this.colors.container.text} 55%, transparent);
                    font-size: 0.9em;
                    margin-right: 4px;
                    font-weight: bold;
                }

                .peck-log-message {
                    white-space: pre-wrap;
                    word-break: break-word;
                    font-family: 'Fixedsys', 'Terminal', 'Courier New', monospace;
                }

                #peck-log-entries::-webkit-scrollbar {
                    width: 16px;
                    background: #c0c0c0;
                }
                #peck-log-entries::-webkit-scrollbar-thumb {
                    background: #808080;
                    border: 1px outset #c0c0c0;
                }
                #peck-log-entries::-webkit-scrollbar-track {
                    background: #c0c0c0;
                    border: 1px inset #c0c0c0;
                }

                #peck-log-container.peck-clickthru .peck-log-entry {
                    pointer-events: none;
                }
            `;
            document.head.appendChild(style);
            addedStyles.push(style);
        }

        applyChrome() {
            if (!this.logContainer) return;
            this.logContainer.style.maxHeight = `${this.maxHeightVh}vh`;
            this.logContainer.style.fontSize = `${this.fontSizePx}px`;
            this.logContainer.style.background = withOpacity(
                this.colors.container.bg,
                this.bgOpacity
            );
            this.logContainer.style.color = this.colors.container.text;
        }

        applyClickthru() {
            if (!this.logContainer) return;
            if (this.clickthru) {
                this.logContainer.classList.add("peck-clickthru");
                this.logContainer.style.pointerEvents = "none";
                if (this.minimizeButton) this.minimizeButton.style.pointerEvents = "auto";
                if (this.dockEl) this.dockEl.style.pointerEvents = "auto";
                if (this.inputEl) this.inputEl.style.pointerEvents = "auto";
                if (this.entriesEl) this.entriesEl.style.pointerEvents = "none";
            } else {
                this.logContainer.classList.remove("peck-clickthru");
                this.logContainer.style.pointerEvents = "auto";
                if (this.minimizeButton) this.minimizeButton.style.pointerEvents = "auto";
                if (this.dockEl) this.dockEl.style.pointerEvents = "auto";
                if (this.inputEl) this.inputEl.style.pointerEvents = "auto";
                if (this.entriesEl) this.entriesEl.style.pointerEvents = "auto";
            }
        }

        formatCalloutMessage(data) {
            if (data === undefined || data === null) return String(data);
            if (typeof data === "string") return data;
            if (data instanceof Error) return data.message || String(data);
            try {
                return JSON.stringify(data, null, 2);
            } catch {
                return String(data);
            }
        }

        formatConsoleArgs(args) {
            return args
                .map((arg) => {
                    if (arg instanceof Error) return arg.message || String(arg);
                    if (typeof arg === "object") {
                        try {
                            return JSON.stringify(arg, null, 2);
                        } catch {
                            return String(arg);
                        }
                    }
                    return String(arg);
                })
                .join(" ");
        }

        setupCalloutListener() {
            if (typeof navi.on !== "function") return;

            this.calloutHandler = (data) => {
                if (!this.isEnabled) return;
                const message = this.formatCalloutMessage(data);
                const now = Date.now();
                if (
                    this._lastConsoleLogMessage === message &&
                    now - this._lastConsoleLogTime < 50
                ) {
                    if (
                        this.logs[0] &&
                        this.logs[0].type === "log" &&
                        this.logs[0].message === message
                    ) {
                        const dup = this.logs.shift();
                        this._removeEntryNode(dup.id, { markFaded: true });
                    }
                }
                this.addMessage("callout", message);
            };

            navi.on("callout", this.calloutHandler);
        }

        overrideConsoleLog() {
            if (!isBrowser) return;

            this.originalConsoleLog = console.log.bind(console);
            this.originalConsoleError = console.error.bind(console);
            this.originalConsoleWarn = console.warn.bind(console);
            this.originalConsoleInfo = console.info.bind(console);

            console.log = (...args) => {
                this.originalConsoleLog(...args);
                if (this.isEnabled) {
                    const message = this.formatConsoleArgs(args);
                    this._lastConsoleLogMessage = message;
                    this._lastConsoleLogTime = Date.now();
                    this.addMessage("log", message);
                }
            };
            console.error = (...args) => {
                this.originalConsoleError(...args);
                if (this.isEnabled) this.addMessage("error", this.formatConsoleArgs(args));
            };
            console.warn = (...args) => {
                this.originalConsoleWarn(...args);
                if (this.isEnabled) this.addMessage("warn", this.formatConsoleArgs(args));
            };
            console.info = (...args) => {
                this.originalConsoleInfo(...args);
                if (this.isEnabled) this.addMessage("info", this.formatConsoleArgs(args));
            };
        }

        _entriesHost() {
            return this.entriesEl || this.logContainer;
        }

        _clampViewOffset() {
            const maxOffset = Math.max(0, this.logs.length - this.visibleSize);
            this.viewOffset = Math.max(0, Math.min(this.viewOffset, maxOffset));
        }

        _clampTempPointer() {
            if (this.logs.length === 0) {
                this.tempPointer = 0;
                return;
            }
            this.tempPointer = Math.max(0, Math.min(this.tempPointer, this.logs.length - 1));
        }

        _capLogsMemory() {
            const cap = Math.max(0, this.cacheSize);
            if (this.logs.length > cap) {
                const removed = this.logs.splice(cap);
                removed.forEach((r) => this._cancelDecay(r.id));
            }
        }

        _capCallinsMemory() {
            const cap = Math.max(0, this.callinCacheSize);
            if (this.callins.length > cap) {
                this.callins.length = cap;
            }
        }

        addMessage(type, message) {
            const ts = stampNow();
            const entry = {
                id: this._nextId++,
                type,
                message: String(message),
                timestamp: ts,
                shownAt: null,
                faded: false,
            };
            this.logs.unshift(entry);
            this._capLogsMemory();
            this.viewOffset = 0;
            this.tempPointer = 0;

            void this._appendLogTip(
                CALLOUTS_IB,
                { message: entry.message, type: entry.type },
                this.cacheSize
            );

            this._bumpActivity();

            if (!this.logContainer || this.isMinimized) return;

            if (this.tempMode) {
                entry.shownAt = Date.now();
                entry.faded = false;
                const host = this._entriesHost();
                const el = this._buildEntryEl(entry);
                const firstEntry = host.querySelector(".peck-log-entry");
                if (firstEntry) host.insertBefore(el, firstEntry);
                else host.appendChild(el);
                if (!this.fadePaused) this._scheduleDecay(entry.id, el);
                host.scrollTop = 0;
                this._noteVisibility();
            } else {
                this.render();
            }
        }

        _buildEntryEl(entry) {
            const logEntry = document.createElement("div");
            logEntry.className = `peck-log-entry ${entry.type}`;
            logEntry.dataset.peckId = String(entry.id);

            const timestampSpan = document.createElement("span");
            timestampSpan.className = "peck-log-timestamp";
            timestampSpan.textContent = `[${displayTime(entry.timestamp)}]`;

            const messageSpan = document.createElement("span");
            messageSpan.className = "peck-log-message";
            messageSpan.textContent = entry.message;

            logEntry.appendChild(timestampSpan);
            logEntry.appendChild(messageSpan);
            return logEntry;
        }

        _cancelDecay(entryId) {
            const t = this._decayTimers.get(entryId);
            if (!t) return;
            clearTrackedTimeout(t.holdId);
            clearTrackedTimeout(t.removeId);
            this._decayTimers.delete(entryId);
        }

        _cancelAllDecay() {
            for (const id of [...this._decayTimers.keys()]) this._cancelDecay(id);
        }

        _findEntry(entryId) {
            return this.logs.find((e) => e.id === entryId) || null;
        }

        _markFaded(entryId) {
            const entry = this._findEntry(entryId);
            if (entry) {
                entry.faded = true;
            }
        }

        /** Remove one entry's DOM + timer without rebuilding the panel. */
        _removeEntryNode(entryId, { markFaded = false } = {}) {
            this._cancelDecay(entryId);
            if (markFaded) this._markFaded(entryId);
            const host = this._entriesHost();
            if (!host) return;
            const el = host.querySelector(`.peck-log-entry[data-peck-id="${entryId}"]`);
            el?.remove();
            this._noteVisibility();
        }

        _remainingHoldMs(entry) {
            const hold = Math.max(0, this.tempSeconds * 1000);
            if (!entry?.shownAt) return hold;
            return Math.max(0, hold - (Date.now() - entry.shownAt));
        }

        _scheduleDecay(entryId, el, holdMs) {
            this._cancelDecay(entryId);
            if (!el || !this.tempMode || this.fadePaused) return;

            const ms =
                holdMs != null
                    ? Math.max(0, holdMs)
                    : this._remainingHoldMs(this._findEntry(entryId));

            const holdId = trackTimeout(() => {
                if (!el.isConnected) {
                    this._decayTimers.delete(entryId);
                    return;
                }
                if (this.fadePaused) {
                    this._decayTimers.delete(entryId);
                    return;
                }
                this._markFaded(entryId);
                el.classList.add("peck-decay");
                const removeId = trackTimeout(() => {
                    if (el.isConnected) el.remove();
                    this._decayTimers.delete(entryId);
                    this._noteVisibility();
                }, DECAY_MS);
                const cur = this._decayTimers.get(entryId);
                if (cur) cur.removeId = removeId;
                this._noteVisibility();
            }, ms);

            this._decayTimers.set(entryId, { holdId, removeId: null });
        }

        _resumeIndependentTempDecays() {
            const host = this._entriesHost();
            if (!host || !this.tempMode || this.fadePaused) return;
            const nodes = [...host.querySelectorAll(".peck-log-entry:not(.peck-decay)")];
            for (const el of nodes) {
                const id = Number(el.dataset.peckId);
                if (!id) continue;
                const entry = this._findEntry(id);
                if (!entry || entry.faded) continue;
                if (!entry.shownAt) entry.shownAt = Date.now();
                this._scheduleDecay(id, el, this._remainingHoldMs(entry));
            }
        }

        toggleFadePaused() {
            this.fadePaused = !this.fadePaused;
            this._updateDockTitle();
            if (this.fadePaused) {
                // Cancel timers; leave visible entry nodes as-is.
                this._cancelAllDecay();
            } else if (this.tempMode) {
                this._resumeIndependentTempDecays();
            }
            this._bumpActivity();
            if (typeof navi.callout === "function") {
                navi.callout(
                    `[pecklogger] fade ${this.fadePaused ? "paused" : "resumed"}`
                );
            }
            return this.fadePaused;
        }

        _visibleEntryCount() {
            const host = this._entriesHost();
            if (!host) return 0;
            return host.querySelectorAll(".peck-log-entry:not(.peck-decay)").length;
        }

        /** Any entry node still in DOM (including mid-fade) — keep panel open for smooth decay. */
        _entryNodeCount() {
            const host = this._entriesHost();
            if (!host) return 0;
            return host.querySelectorAll(".peck-log-entry").length;
        }

        /** One-line dock when idle; grow only for entries (incl. fading) or input. */
        _syncCollapsedLayout() {
            if (!this.logContainer || this.isMinimized) return;
            const hasNodes = this._entryNodeCount() > 0;
            const expanded = hasNodes || this.inputOpen || this._callinPreviewActive;

            if (this.entriesEl) {
                if (hasNodes) {
                    this.entriesEl.style.display = "block";
                    this.entriesEl.style.flex = "1 1 auto";
                    this.entriesEl.style.height = "auto";
                    this.entriesEl.style.minHeight = "0";
                    this.entriesEl.style.paddingTop = "18px";
                } else {
                    this.entriesEl.style.display = "none";
                    this.entriesEl.style.flex = "0 0 auto";
                    this.entriesEl.style.height = "0";
                    this.entriesEl.style.paddingTop = "0";
                }
            }

            if (this.minimizeButton) {
                this.minimizeButton.style.display = expanded ? "block" : "none";
            }

            if (this.dockEl && !this.inputOpen && !this._callinPreviewActive) {
                const lineH = this._dockLinePx();
                this.dockEl.style.height = `${lineH}px`;
                this.dockEl.style.minHeight = `${lineH}px`;
            }

            this.logContainer.style.padding = "0";
        }

        // ── Scrub / scroll ───────────────────────────────────────────────────

        _scrubCalloutsWheel(deltaY) {
            if (this.isMinimized || this.logs.length === 0) return false;

            if (!this.tempMode) {
                // Temp OFF: sliding window over newest-first logs
                const before = this.viewOffset;
                if (deltaY > 0) {
                    // show older; latest falls off
                    this.viewOffset += 1;
                } else if (deltaY < 0) {
                    this.viewOffset -= 1;
                } else {
                    return false;
                }
                this._clampViewOffset();
                if (this.viewOffset === before) return false;
                this.render();
                return true;
            }

            // Temp ON: pointer scrub — reveal that log with fresh fade hold
            const before = this.tempPointer;
            if (deltaY > 0) {
                this.tempPointer += 1;
            } else if (deltaY < 0) {
                this.tempPointer -= 1;
            } else {
                return false;
            }
            this._clampTempPointer();
            if (this.tempPointer === before && deltaY !== 0) {
                // Still reveal if at edge and entry exists
                if (this.logs[this.tempPointer]) {
                    this._revealTempEntry(this.logs[this.tempPointer]);
                    return true;
                }
                return false;
            }
            const entry = this.logs[this.tempPointer];
            if (!entry) return false;
            this._revealTempEntry(entry);
            return true;
        }

        _revealTempEntry(entry) {
            if (!entry || this.isMinimized || !this._entriesHost()) return;
            entry.faded = false;
            entry.shownAt = Date.now();

            const host = this._entriesHost();
            let el = host.querySelector(`.peck-log-entry[data-peck-id="${entry.id}"]`);
            if (el) {
                el.classList.remove("peck-decay");
            } else {
                el = this._buildEntryEl(entry);
                const first = host.querySelector(".peck-log-entry");
                if (first) host.insertBefore(el, first);
                else host.appendChild(el);
            }
            if (!this.fadePaused) this._scheduleDecay(entry.id, el, this.tempSeconds * 1000);
            else this._cancelDecay(entry.id);
            host.scrollTop = 0;
            this._noteVisibility();
        }

        _scrubCallinsWheel(deltaY) {
            if (this.callins.length === 0) {
                if (this._callinPreviewActive) {
                    this._hideCallinPreview();
                    return true;
                }
                return false;
            }

            let idx = this._callinScrubIndex;
            if (deltaY < 0) {
                // toward older (increase index from 0=newest)
                if (idx < 0) idx = 0;
                else idx = Math.min(this.callins.length - 1, idx + 1);
            } else if (deltaY > 0) {
                // toward newer until -1 / empty
                if (idx < 0) return false;
                idx -= 1;
            } else {
                return false;
            }

            this._callinScrubIndex = idx;
            if (idx < 0) {
                this._hideCallinPreview();
                return true;
            }
            this._showCallinPreview(this.callins[idx]);
            return true;
        }

        _showCallinPreview(entry) {
            if (!this.dockEl || !this.inputEl || this.isMinimized || !entry) return;
            this._clearCallinPreviewTimer();
            this._callinPreviewActive = true;
            this.inputOpen = false;

            const h = this._dockLinePx() + INPUT_EXPAND_PX;
            this.dockEl.style.height = `${h}px`;
            this.dockEl.style.minHeight = `${h}px`;
            this.inputEl.style.display = "block";
            this.inputEl.style.transform = "scaleX(1)";
            this.inputEl.style.borderColor = "gold";
            this.inputEl.style.color = "#cc0000";
            this.inputEl.value = String(entry.message ?? "");
            this.inputEl.readOnly = true;
            this.inputEl.blur();
            this._syncCollapsedLayout();

            this._callinPreviewTimer = trackTimeout(() => {
                this._hideCallinPreview();
            }, CALLIN_PREVIEW_MS);
        }

        _clearCallinPreviewTimer() {
            if (this._callinPreviewTimer != null) {
                clearTrackedTimeout(this._callinPreviewTimer);
                this._callinPreviewTimer = null;
            }
        }

        _hideCallinPreview() {
            this._clearCallinPreviewTimer();
            if (!this._callinPreviewActive) return;
            this._callinPreviewActive = false;
            this._callinScrubIndex = -1;
            if (this.inputEl) {
                this.inputEl.readOnly = false;
                this.inputEl.style.display = "none";
                this.inputEl.value = "";
                this.inputEl.style.transform = "scaleX(0.04)";
                this.inputEl.style.borderColor = "silver";
                this.inputEl.style.color = "#000";
            }
            if (this.dockEl && !this.inputOpen) {
                const lineH = this._dockLinePx();
                this.dockEl.style.height = `${lineH}px`;
                this.dockEl.style.minHeight = `${lineH}px`;
            }
            this._syncCollapsedLayout();
            this._noteVisibility();
        }

        /** Left-click preview → live editable input with that text. */
        _promoteCallinPreview() {
            if (!this._callinPreviewActive || !this.inputEl) return;
            const text = String(this.inputEl.value ?? "");
            this._clearCallinPreviewTimer();
            this._callinPreviewActive = false;
            this._callinScrubIndex = -1;
            this.inputEl.readOnly = false;
            this.inputEl.style.borderColor = "silver";
            this.inputEl.style.color = "#000";
            this.inputOpen = true;
            this.inputEl.value = text;
            const h = this._dockLinePx() + INPUT_EXPAND_PX;
            this.dockEl.style.height = `${h}px`;
            this.dockEl.style.minHeight = `${h}px`;
            this.inputEl.style.display = "block";
            this.inputEl.style.transform = "scaleX(1)";
            this._syncCollapsedLayout();
            this._bumpActivity();
            requestAnimationFrame(() => {
                this.inputEl.focus();
                try {
                    const len = this.inputEl.value.length;
                    this.inputEl.setSelectionRange(len, len);
                } catch {
                    /* ignore */
                }
            });
        }

        /**
         * Temp OFF: show logs.slice(viewOffset, viewOffset + visibleSize).
         * Temp ON: show currently non-faded / actively shown entries.
         */
        render() {
            const host = this._entriesHost();
            if (!host) return;
            this._cancelAllDecay();

            [...host.querySelectorAll(".peck-log-entry")].forEach((n) => n.remove());

            if (!this.tempMode) {
                this._clampViewOffset();
                const windowLogs = this.logs.slice(
                    this.viewOffset,
                    this.viewOffset + this.visibleSize
                );
                for (const entry of windowLogs) {
                    entry.faded = false;
                    entry.shownAt = null;
                    host.appendChild(this._buildEntryEl(entry));
                }
            } else {
                const visible = this.logs.filter((e) => !e.faded);
                for (const entry of visible) {
                    if (!entry.shownAt) entry.shownAt = Date.now();
                    const el = this._buildEntryEl(entry);
                    host.appendChild(el);
                    if (!this.fadePaused) {
                        this._scheduleDecay(entry.id, el, this._remainingHoldMs(entry));
                    }
                }
            }

            host.scrollTop = 0;
            this._noteVisibility();
        }

        async clearCallouts() {
            this._cancelAllDecay();
            this.logs = [];
            this.viewOffset = 0;
            this.tempPointer = 0;
            const host = this._entriesHost();
            if (host) {
                [...host.querySelectorAll(".peck-log-entry")].forEach((n) => n.remove());
            }
            await this._clearLogTip(CALLOUTS_IB);
            this._noteVisibility();
        }

        async clearCallins() {
            this.callins = [];
            this._hideCallinPreview();
            await this._clearLogTip(CALLINS_IB);
        }

        /** Alias: clear callouts UI + tip. */
        clear() {
            void this.clearCallouts();
        }

        _dockLinePx() {
            return Math.max(14, Math.round(this.fontSizePx * 1.25));
        }

        openInput() {
            if (!this.dockEl || !this.inputEl || this.isMinimized || this._submitBusy) return;
            if (this._callinPreviewActive) {
                this._promoteCallinPreview();
                return;
            }
            if (this.inputOpen) {
                this.inputEl.focus();
                return;
            }
            this.inputOpen = true;
            this._bumpActivity();
            const h = this._dockLinePx() + INPUT_EXPAND_PX;
            this.dockEl.style.height = `${h}px`;
            this.dockEl.style.minHeight = `${h}px`;
            this._syncCollapsedLayout();
            this.inputEl.readOnly = false;
            this.inputEl.style.display = "block";
            this.inputEl.style.borderColor = "silver";
            this.inputEl.style.color = "#000";
            this.inputEl.value = "";
            requestAnimationFrame(() => {
                this.inputEl.style.transform = "scaleX(1)";
                this.inputEl.focus();
            });
        }

        closeInput({ animate = true } = {}) {
            if (!this.dockEl || !this.inputEl) return;
            if (this._callinPreviewActive) {
                this._hideCallinPreview();
                return;
            }
            this.inputOpen = false;
            const finish = () => {
                this.inputEl.readOnly = false;
                this.inputEl.style.display = "none";
                this.inputEl.value = "";
                this.inputEl.style.transform = "scaleX(0.04)";
                this.inputEl.style.borderColor = "silver";
                this.inputEl.style.color = "#000";
                const lineH = this._dockLinePx();
                this.dockEl.style.height = `${lineH}px`;
                this.dockEl.style.minHeight = `${lineH}px`;
                this._syncCollapsedLayout();
            };
            if (!animate) {
                finish();
                return;
            }
            this.inputEl.style.transform = "scaleX(0.04)";
            trackTimeout(finish, 280);
        }

        async submitInput() {
            if (!this.inputEl || this._submitBusy) return;
            if (this._callinPreviewActive) return;
            const text = String(this.inputEl.value ?? "");
            if (!text.trim()) {
                this.closeInput({ animate: true });
                return;
            }
            this._submitBusy = true;
            const callinText = this.lowercaseCallin ? text.toLowerCase() : text;
            if (this.lowercaseCallin) this.inputEl.value = callinText;
            this.inputEl.style.borderColor = "gold";
            this.inputEl.style.color = "#cc0000";
            this.inputEl.blur();

            try {
                if (typeof navi.dispatchCallin === "function") {
                    await navi.dispatchCallin(callinText);
                } else if (typeof globalThis.navi === "function") {
                    await globalThis.navi(callinText);
                }
            } catch (err) {
                console.warn("[pecklogger] callin failed:", err);
            }

            const callinEntry = {
                id: this._nextId++,
                message: callinText,
                timestamp: stampNow(),
                type: "callin",
            };
            this.callins.unshift(callinEntry);
            this._capCallinsMemory();
            void this._appendLogTip(
                CALLINS_IB,
                { message: callinText, type: "callin" },
                this.callinCacheSize
            );

            trackTimeout(() => {
                this._submitBusy = false;
                this.closeInput({ animate: true });
                this._bumpActivity();
            }, SUBMIT_FLASH_MS);
        }

        _bumpActivity() {
            this._emptySince = null;
            this._cancelAutominAnim();
        }

        _noteVisibility() {
            if (this.isMinimized || this._autominAnimating) {
                if (this._entryNodeCount() > 0) this._emptySince = null;
                this._syncCollapsedLayout();
                return;
            }
            if (this._entryNodeCount() > 0 || this.inputOpen || this._callinPreviewActive) {
                this._emptySince = null;
                this._syncCollapsedLayout();
                return;
            }
            if (this._emptySince == null) this._emptySince = Date.now();
            this._syncCollapsedLayout();
        }

        _startAutominWatcher() {
            if (this._autominTimer) return;
            this._autominTimer = trackInterval(() => {
                if (!this.autominimize || this.isMinimized || this.inputOpen) return;
                if (this._callinPreviewActive) return;
                if (this._autominAnimating) return;
                if (this._entryNodeCount() > 0) {
                    this._emptySince = null;
                    return;
                }
                if (this._emptySince == null) {
                    this._emptySince = Date.now();
                    return;
                }
                const wait = Math.max(0, this.autominimizeSeconds) * 1000;
                if (Date.now() - this._emptySince >= wait) {
                    this._runAutominimize();
                }
            }, 500);
        }

        _cancelAutominAnim() {
            if (!this.logContainer) return;
            this._autominAnimating = false;
            this.logContainer.style.transform = "";
            this.logContainer.style.opacity = "";
        }

        _runAutominimize() {
            if (!this.logContainer || this.isMinimized || !this.autominimize) return;
            this._autominAnimating = true;
            this._hideCallinPreview();
            this.closeInput({ animate: false });
            this.logContainer.style.transform = "scaleX(0.08) scaleY(0.15)";
            this.logContainer.style.opacity = "0";
            trackTimeout(() => {
                this._autominAnimating = false;
                if (this.logContainer) {
                    this.logContainer.style.transform = "";
                    this.logContainer.style.opacity = "";
                }
                this.minimize();
            }, 560);
        }

        toggle() {
            this.isEnabled = !this.isEnabled;
            this.saveSettings();
            return `Pecklogger ${this.isEnabled ? "enabled" : "disabled"}`;
        }

        setVisibleSize(count) {
            const num = parseInt(count, 10);
            if (isNaN(num) || num < 1) return "Invalid number. Must be a positive integer.";
            this.visibleSize = Math.min(200, num);
            this._clampViewOffset();
            this.saveSettings();
            if (!this.tempMode) this.render();
            return `[pecklogger] callouts visible ${this.visibleSize}`;
        }

        setCacheSize(n) {
            const num = Number(n);
            if (!Number.isFinite(num) || num < 0 || num > 500) {
                return "Usage: pecklogger callouts cache <0-500>  (tip frame retention; default 24)";
            }
            this.cacheSize = Math.floor(num);
            this._capLogsMemory();
            this.saveSettings();
            void this._pruneLogTip(CALLOUTS_IB, this.cacheSize);
            return `[pecklogger] callouts cache ${this.cacheSize}`;
        }

        setCallinCacheSize(n) {
            const num = Number(n);
            if (!Number.isFinite(num) || num < 0 || num > 500) {
                return "Usage: pecklogger callins cache <0-500>  (tip frame retention; default 24)";
            }
            this.callinCacheSize = Math.floor(num);
            this._capCallinsMemory();
            this.saveSettings();
            void this._pruneLogTip(CALLINS_IB, this.callinCacheSize);
            return `[pecklogger] callins cache ${this.callinCacheSize}`;
        }

        setScrubMode(mode) {
            if (mode == null || mode === "") {
                return `[pecklogger] scrub mode: ${this.scrubMode}`;
            }
            const s = String(mode).toLowerCase();
            if (s !== "callouts" && s !== "callins") {
                return "Usage: pecklogger scrub [callouts|callins]";
            }
            this.scrubMode = s;
            if (s !== "callins") this._hideCallinPreview();
            this._updateDockTitle();
            this.saveSettings();
            return `[pecklogger] scrub mode ${this.scrubMode}`;
        }

        setMaxHeightVh(pct) {
            const num = Number(pct);
            if (!Number.isFinite(num) || num < 5 || num > 100) {
                return "Usage: pecklogger height <5-100>  (viewport % max height)";
            }
            this.maxHeightVh = num;
            this.saveSettings();
            this.applyChrome();
            return `[pecklogger] max height ${this.maxHeightVh}vh`;
        }

        setFontSize(px) {
            const num = Number(px);
            if (!Number.isFinite(num) || num < 8 || num > 48) {
                return "Usage: pecklogger textsize <8-48>  (pixels)";
            }
            this.fontSizePx = num;
            this.saveSettings();
            this.applyChrome();
            this._syncCollapsedLayout();
            return `[pecklogger] text size ${this.fontSizePx}px`;
        }

        setBgOpacity(raw) {
            let o = Number(raw);
            if (!Number.isFinite(o)) {
                return "Usage: pecklogger opacity <0-1|0-100>";
            }
            if (o > 1) o = o / 100;
            if (o < 0 || o > 1) return "Opacity must be 0–1 or 0–100";
            this.bgOpacity = o;
            this.saveSettings();
            this.applyChrome();
            return `[pecklogger] background opacity ${this.bgOpacity}`;
        }

        setClickthru(next) {
            let want;
            if (next === undefined || next === null || next === "") {
                want = !this.clickthru;
            } else {
                const s = String(next).toLowerCase();
                if (s === "on" || s === "true" || s === "1") want = true;
                else if (s === "off" || s === "false" || s === "0") want = false;
                else if (s === "toggle") want = !this.clickthru;
                else return "Usage: pecklogger clickthru [on|off|toggle]";
            }
            this.clickthru = want;
            this.saveSettings();
            this.applyClickthru();
            return `[pecklogger] clickthru ${this.clickthru ? "ON" : "OFF"}`;
        }

        setAutominimize(next) {
            let want;
            if (next === undefined || next === null || next === "") {
                want = !this.autominimize;
            } else {
                const s = String(next).toLowerCase();
                if (s === "on" || s === "true" || s === "1") want = true;
                else if (s === "off" || s === "false" || s === "0") want = false;
                else if (s === "toggle") want = !this.autominimize;
                else return "Usage: pecklogger automin [on|off|toggle]";
            }
            this.autominimize = want;
            this.saveSettings();
            if (!want) {
                this._emptySince = null;
                this._cancelAutominAnim();
            } else {
                this._noteVisibility();
            }
            return `[pecklogger] autominimize ${this.autominimize ? "ON" : "OFF"} (after ${this.autominimizeSeconds}s empty)`;
        }

        setAutominimizeSeconds(sec) {
            const num = Number(sec);
            if (!Number.isFinite(num) || num < 0) {
                return "Usage: pecklogger automintime <seconds>  (empty idle before auto-minimize; default 12)";
            }
            this.autominimizeSeconds = num;
            this.saveSettings();
            this._emptySince = null;
            this._noteVisibility();
            return `[pecklogger] autominimize idle ${this.autominimizeSeconds}s`;
        }

        setLowercaseCallin(next) {
            let want;
            if (next === undefined || next === null || next === "") {
                want = !this.lowercaseCallin;
            } else {
                const s = String(next).toLowerCase();
                if (s === "on" || s === "true" || s === "1") want = true;
                else if (s === "off" || s === "false" || s === "0") want = false;
                else if (s === "toggle") want = !this.lowercaseCallin;
                else return "Usage: pecklogger lowercase [on|off|toggle]";
            }
            this.lowercaseCallin = want;
            this.saveSettings();
            return `[pecklogger] lowercase callin ${this.lowercaseCallin ? "ON" : "OFF"}`;
        }

        setTempMode(next) {
            let want;
            if (next === undefined || next === null || next === "") {
                want = !this.tempMode;
            } else {
                const s = String(next).toLowerCase();
                if (s === "on" || s === "true" || s === "1") want = true;
                else if (s === "off" || s === "false" || s === "0") want = false;
                else if (s === "toggle") want = !this.tempMode;
                else return "Usage: pecklogger temp [on|off|toggle]";
            }

            const was = this.tempMode;
            this.tempMode = want;
            this.saveSettings();

            if (!was && want) {
                // Entering temp: mark current window as shown; others faded.
                const now = Date.now();
                this.viewOffset = 0;
                this.tempPointer = 0;
                for (let i = 0; i < this.logs.length; i++) {
                    const entry = this.logs[i];
                    if (i === 0) {
                        entry.faded = false;
                        entry.shownAt = now;
                    } else {
                        entry.faded = true;
                        entry.shownAt = null;
                    }
                }
                this.render();
            } else if (was && !want) {
                for (const entry of this.logs) {
                    entry.faded = false;
                    entry.shownAt = null;
                }
                this.viewOffset = 0;
                this.render();
            }

            this._noteVisibility();
            return `[pecklogger] temp mode ${this.tempMode ? "ON" : "OFF"} (hold ${this.tempSeconds}s → ${DECAY_MS / 1000}s fade)${this.fadePaused ? " [fade paused]" : ""}`;
        }

        setTempSeconds(sec) {
            const num = Number(sec);
            if (!Number.isFinite(num) || num < 0) {
                return "Usage: pecklogger temptime <seconds>  (hold before fade; default 3)";
            }
            this.tempSeconds = num;
            this.saveSettings();
            if (this.tempMode && !this.fadePaused) this._resumeIndependentTempDecays();
            return `[pecklogger] temp hold ${this.tempSeconds}s`;
        }

        setTextColor(color, type = "container") {
            return this.setTypeColor(type, "text", color);
        }

        setBgColor(color, type = "container") {
            return this.setTypeColor(type, "bg", color);
        }

        setTypeColor(type, field, color) {
            const t = String(type || "container").toLowerCase();
            if (!color || typeof color !== "string") {
                return 'Invalid color (e.g. "red", "#ff0000")';
            }
            if (t === "all" || t === "*") {
                for (const key of LOG_TYPES) {
                    this.colors[key][field] = color;
                }
                this.saveSettings();
                this.applyColors();
                return `all ${field === "text" ? "text" : "background"} → ${color}`;
            }
            if (!LOG_TYPES.includes(t)) {
                return `Unknown type: ${type}. Valid: all, ${LOG_TYPES.join(", ")}`;
            }
            this.colors[t][field] = color;
            this.saveSettings();
            this.applyColors();
            return `${t} ${field === "text" ? "text" : "background"} → ${color}`;
        }

        applyColors() {
            this.applyChrome();
            this.setupStyles();
        }

        minimize() {
            if (this.logContainer && !this.isMinimized) {
                this._hideCallinPreview();
                this.closeInput({ animate: false });
                this._cancelAutominAnim();
                this.logContainer.style.display = "none";
                this.restoreButton.style.display = "block";
                this.isMinimized = true;
                this._emptySince = null;
            }
        }

        restore() {
            if (this.logContainer && this.isMinimized) {
                this.logContainer.style.display = "flex";
                this.restoreButton.style.display = "none";
                this.isMinimized = false;
                this._cancelAutominAnim();
                this.render();
                this.applyClickthru();
                this._bumpActivity();
            }
        }

        getStatus() {
            return {
                enabled: this.isEnabled,
                minimized: this.isMinimized,
                visibleSize: this.visibleSize,
                cacheSize: this.cacheSize,
                callinCacheSize: this.callinCacheSize,
                scrubMode: this.scrubMode,
                fadePaused: this.fadePaused,
                viewOffset: this.viewOffset,
                tempPointer: this.tempPointer,
                maxHeightVh: this.maxHeightVh,
                fontSizePx: this.fontSizePx,
                bgOpacity: this.bgOpacity,
                tempMode: this.tempMode,
                tempSeconds: this.tempSeconds,
                clickthru: this.clickthru,
                autominimize: this.autominimize,
                autominimizeSeconds: this.autominimizeSeconds,
                lowercaseCallin: this.lowercaseCallin,
                decaySeconds: DECAY_MS / 1000,
                calloutCount: this.logs.length,
                callinCount: this.callins.length,
                visibleCount: this._visibleEntryCount(),
                environment: isBrowser ? "browser" : "node",
                colors: this.colors,
            };
        }
    }

    const logger = new PeckLogger();

    const HELP = [
        "Pecklogger v1.2.3 — viewport callouts (+ console) and dock callins",
        "",
        "Tips: navi:pecklog:callouts | navi:pecklog:callins",
        "  each log = tip.mut8 replaceData+create; prune oldest (past chain) when over cache",
        "",
        "  pecklogger callouts visible <n>    UI window size (default 12)",
        "  pecklogger callouts cache <n>      Tip/frame retention (default 24)",
        "  pecklogger callouts clear          Clear callouts tip + memory",
        "  pecklogger callins cache <n>       Callin tip retention (default 24)",
        "  pecklogger callins clear           Clear callins tip + memory",
        "  pecklogger scrub [callouts|callins]  Dock wheel scrub mode",
        "  pecklogger max <n>                 Alias → callouts visible",
        "  pecklogger cache <n>               Alias → callouts cache",
        "  pecklogger clear                   Clear callouts (same as callouts clear)",
        "  pecklogger toggle",
        "  pecklogger height <5-100>          Max panel height as % of viewport",
        "  pecklogger textsize <8-48>         Font size in px",
        "  pecklogger opacity <0-1|0-100>     Container background opacity",
        "  pecklogger temp [on|off|toggle]    Temp decay mode",
        "  pecklogger temptime <seconds>      Hold before fade (default 3; fade 3s)",
        "  pecklogger clickthru [on|off|toggle]  Pass clicks through log rows",
        "  pecklogger automin [on|off|toggle] Auto-minimize after empty idle",
        "  pecklogger automintime <seconds>   Empty idle before automin (default 12)",
        "  pecklogger lowercase [on|off|toggle]  Lowercase dock input before callin",
        "  pecklogger textcolor [type] <c>    Default type=container",
        "  pecklogger textcolor all <c>",
        "  pecklogger bgcolor [type] <c>",
        "  pecklogger bgcolor all <c>",
        "  pecklogger minimize | restore",
        "  pecklogger status",
        "",
        "Temp OFF: wheel slides visible window (viewOffset) over callouts.",
        "Temp ON:  wheel scrubs tempPointer; reveals that log with a fresh fade.",
        "Callins scrub: wheel previews history in the dock (gold/red); click to edit+Enter.",
        "Middle-click dock: pause/unpause temp fading (timers cancel; nodes stay).",
        "Types: all, container, log, error, warn, info, callout",
        "Dock: click → navi callin; automin off until enabled; panel on <html> (viewport chrome).",
    ].join("\n");

    return {
        name: "pecklogger",
        version: "1.2.3",
        description:
            "Viewport logger: tip-backed callouts/callins, scrub modes, temp fade, dock callin",

        moduleInfo: {
            name: "pecklogger",
            version: "1.2.3",
            description:
                "Viewport logger; tip lineages navi:pecklog:callouts|callins; panel on documentElement",
        },

        logger,

        commands: {
            pecklogger: {
                name: "pecklogger",
                description:
                    "pecklogger <callouts|callins|scrub|clear|toggle|max|cache|height|temp|status|...>",
                execute: async (action, ...args) => {
                    if (!action) return HELP;

                    try {
                        const act = String(action).toLowerCase();
                        switch (act) {
                            case "help":
                                return HELP;

                            case "callouts": {
                                const sub = String(args[0] || "").toLowerCase();
                                if (sub === "visible") {
                                    if (args[1] == null) {
                                        return `callouts visible: ${logger.visibleSize} (usage: pecklogger callouts visible <n>)`;
                                    }
                                    return logger.setVisibleSize(args[1]);
                                }
                                if (sub === "cache") {
                                    if (args[1] == null) {
                                        return `callouts cache: ${logger.cacheSize} (usage: pecklogger callouts cache <n>)`;
                                    }
                                    return logger.setCacheSize(args[1]);
                                }
                                if (sub === "clear") {
                                    await logger.clearCallouts();
                                    return "Callouts cleared";
                                }
                                return "Usage: pecklogger callouts <visible|cache|clear> …";
                            }

                            case "callins": {
                                const sub = String(args[0] || "").toLowerCase();
                                if (sub === "cache") {
                                    if (args[1] == null) {
                                        return `callins cache: ${logger.callinCacheSize} (usage: pecklogger callins cache <n>)`;
                                    }
                                    return logger.setCallinCacheSize(args[1]);
                                }
                                if (sub === "clear") {
                                    await logger.clearCallins();
                                    return "Callins cleared";
                                }
                                return "Usage: pecklogger callins <cache|clear> …";
                            }

                            case "scrub":
                                return logger.setScrubMode(args[0]);

                            case "clear":
                                await logger.clearCallouts();
                                return "Callouts cleared";

                            case "toggle":
                                return logger.toggle();

                            case "max":
                                if (!args[0]) return "Usage: pecklogger max <number>";
                                return logger.setVisibleSize(args[0]);

                            case "cache":
                            case "fadecache":
                                if (args[0] == null) {
                                    return `callouts cache: ${logger.cacheSize} (usage: pecklogger cache <n>)`;
                                }
                                return logger.setCacheSize(args[0]);

                            case "height":
                            case "maxheight":
                                if (!args[0]) return "Usage: pecklogger height <5-100>";
                                return logger.setMaxHeightVh(args[0]);

                            case "textsize":
                            case "fontsize":
                                if (!args[0]) return "Usage: pecklogger textsize <8-48>";
                                return logger.setFontSize(args[0]);

                            case "opacity":
                            case "bgopacity":
                                if (args[0] == null) return "Usage: pecklogger opacity <0-1|0-100>";
                                return logger.setBgOpacity(args[0]);

                            case "temp":
                                return logger.setTempMode(args[0]);

                            case "temptime":
                            case "tempseconds":
                                if (args[0] == null) {
                                    return `temptime: ${logger.tempSeconds}s (usage: pecklogger temptime <seconds>)`;
                                }
                                return logger.setTempSeconds(args[0]);

                            case "clickthru":
                            case "clickthrough":
                                return logger.setClickthru(args[0]);

                            case "automin":
                            case "autominimize":
                                return logger.setAutominimize(args[0]);

                            case "automintime":
                            case "autominimizesec":
                            case "autominseconds":
                                if (args[0] == null) {
                                    return `automintime: ${logger.autominimizeSeconds}s (usage: pecklogger automintime <seconds>)`;
                                }
                                return logger.setAutominimizeSeconds(args[0]);

                            case "lowercase":
                            case "lower":
                                return logger.setLowercaseCallin(args[0]);

                            case "textcolor":
                                if (!args[0]) return "Usage: pecklogger textcolor [type] <color>";
                                if (args.length === 1) return logger.setTextColor(args[0], "container");
                                return logger.setTextColor(args[1], args[0]);

                            case "bgcolor":
                                if (!args[0]) return "Usage: pecklogger bgcolor [type] <color>";
                                if (args.length === 1) return logger.setBgColor(args[0], "container");
                                return logger.setBgColor(args[1], args[0]);

                            case "minimize":
                                logger.minimize();
                                return "Minimized";

                            case "restore":
                                logger.restore();
                                return "Restored";

                            case "status": {
                                const s = logger.getStatus();
                                const colorLines = LOG_TYPES.map((type) => {
                                    const c = s.colors[type];
                                    return `  ${type}: text=${c.text}, bg=${c.bg}`;
                                });
                                return [
                                    "Pecklogger status:",
                                    `  Enabled: ${s.enabled}`,
                                    `  Minimized: ${s.minimized}`,
                                    `  Visible: ${s.visibleSize}`,
                                    `  Cache: ${s.cacheSize}`,
                                    `  Callin cache: ${s.callinCacheSize}`,
                                    `  Scrub: ${s.scrubMode}`,
                                    `  Fade paused: ${s.fadePaused ? "YES" : "NO"}`,
                                    `  View offset: ${s.viewOffset}`,
                                    `  Temp pointer: ${s.tempPointer}`,
                                    `  Max height: ${s.maxHeightVh}vh`,
                                    `  Text size: ${s.fontSizePx}px`,
                                    `  Bg opacity: ${s.bgOpacity}`,
                                    `  Temp: ${s.tempMode ? "ON" : "OFF"} (hold ${s.tempSeconds}s, fade ${s.decaySeconds}s)`,
                                    `  Clickthru: ${s.clickthru ? "ON" : "OFF"}`,
                                    `  Autominimize: ${s.autominimize ? "ON" : "OFF"} (idle ${s.autominimizeSeconds}s)`,
                                    `  Lowercase callin: ${s.lowercaseCallin ? "ON" : "OFF"}`,
                                    `  Callouts / callins / visible: ${s.calloutCount} / ${s.callinCount} / ${s.visibleCount}`,
                                    `  Environment: ${s.environment}`,
                                    "  Colors:",
                                    ...colorLines,
                                ].join("\n");
                            }

                            default:
                                return `Unknown: ${action}. Type pecklogger help.`;
                        }
                    } catch (error) {
                        console.error("[pecklogger] Command failed:", error);
                        return `Error: ${error.message || error}`;
                    }
                },
            },
        },

        onMount: async () => {
            await logger.initialize();
            if (typeof navi.callout === "function") {
                navi.callout("[pecklogger] module loaded — type pecklogger help");
            }
        },

        onUnmount: () => {
            if (logger.calloutHandler && typeof navi.off === "function") {
                navi.off("callout", logger.calloutHandler);
                logger.calloutHandler = null;
            }

            if (logger.originalConsoleLog) console.log = logger.originalConsoleLog;
            if (logger.originalConsoleError) console.error = logger.originalConsoleError;
            if (logger.originalConsoleWarn) console.warn = logger.originalConsoleWarn;
            if (logger.originalConsoleInfo) console.info = logger.originalConsoleInfo;

            logger._clearCallinPreviewTimer();
            logger._callinPreviewActive = false;
            logger._cancelAllDecay();

            eventListeners.forEach(({ element, event, handler, opts }) => {
                element.removeEventListener(event, handler, opts);
            });
            eventListeners.length = 0;

            createdElements.forEach((el) => {
                el.remove();
            });
            createdElements.length = 0;

            addedStyles.forEach((style) => style.remove());
            addedStyles.length = 0;

            observers.forEach((observer) => observer.disconnect());
            observers.length = 0;

            timers.forEach(({ type, id }) => {
                if (type === "interval") clearInterval(id);
                if (type === "timeout") clearTimeout(id);
            });
            timers.length = 0;

            if (logger.logContainer) logger.logContainer.remove();
            if (logger.restoreButton) logger.restoreButton.remove();
            logger._viewportGlueBound = false;

            const existingStyle = document.querySelector("style[data-pecklogger]");
            if (existingStyle) existingStyle.remove();

            if (typeof navi.callout === "function") {
                navi.callout("[pecklogger] unmounted");
            }
        },
    };
};
