/**
 * supermouse_plugin_draggem_div — free-floating / stage-wrap drag chrome.
 *
 * Supermouse dropdown root menu (needs supermouse_plugin_dropdown): "draggem_div…" —
 * click → path input → Enter fetches path HTML into a new wrapper on body.
 * Wrapper is navi.mod.surf.persist()'d so stage surfs keep it; stage-member
 * wraps (stage_draggem) do NOT persist and surf away with the stage.
 *
 * Prefs live in navi.storage.item key `draggem` (color, gradient, opacity,
 * titleHeight, showClose, showMaximize, showTitle). Settings: dropdown → plugins → draggem_div.
 *
 * Exposes wrapElement / unwrapElement / createFromPath for stage_draggem.
 *
 * v0.1.1: fixed positioning + titlebar drag + SE resize handle (capture phase).
 * v0.1.2: wrapElement opts.onClose for custom close (stage remove occupant).
 * v0.1.3: path input uses surf/potter hyperuri normalize (`:` / spaces → `/`).
 * v0.1.4: createFromPath constrains width + htmx.process/script activate (like stagedir).
 * v0.2.0: `draggem` prefs storage + fit wrapper to first-load content size.
 * v0.2.4: pointer capture + gesture teardown; delegated chrome hit-testing.
 * v0.3.0: on mount, reinit x-draggem-div wrappers already in the DOM.
 * v0.3.1: wrap/unwrap move the element with moveBefore() so iframes/video keep playing.
 * v0.3.2: titlebar minimize docks the wrapper into cooltoolbar when that mod is mounted.
 */
export const register = (navi) => {
    const isBrowser =
        typeof window !== "undefined" && typeof window.document !== "undefined";

    /** Move a live node via moveBefore() when both ends are connected, so iframes/video keep state. */
    const placeLive = (parent, el, ref = null) => {
        if (
            typeof parent.moveBefore === "function" &&
            el.isConnected &&
            parent.isConnected
        ) {
            try {
                parent.moveBefore(el, ref);
                return;
            } catch {
                /* fall through */
            }
        }
        parent.insertBefore(el, ref);
    };

    const STYLE_ID = "draggem-div-style";
    const WRAP_TAG = "x-draggem-div";
    const PART = "draggemdiv";
    const PREFS_KEY = "draggem";
    const CONTENT_PAD = 8;
    /** Extra room beyond content measure so title/resize chrome doesn’t crowd. */
    const FIT_SLACK = 24;

    const DEFAULT_PREFS = {
        color: "gold",
        contentColor: "silver",
        gradient: true,
        opacity: 1,
        titleHeight: 32,
        showClose: true,
        showMaximize: true,
        showTitle: true,
    };

    const eventListeners = [];
    const addedStyles = [];
    let highestZ = 40;
    let dragReady = new WeakSet();
    let unrootDropdown = null;
    let unmenuDropdown = null;
    let dropdownMountHandler = null;
    /** @type {typeof DEFAULT_PREFS} */
    let prefs = { ...DEFAULT_PREFS };

    const resolveDropdown = () => navi?.mod?.supermouse_plugin_dropdown || null;
    const resolveSurf = () => navi?.mod?.surf || null;

    const callout = (msg) => {
        if (typeof navi.callout === "function") navi.callout(msg);
        else console.warn(msg);
    };

    const clampOpacity = (v) => {
        const n = Number(v);
        if (!Number.isFinite(n)) return DEFAULT_PREFS.opacity;
        return Math.min(1, Math.max(0.15, n));
    };

    const clampTitleHeight = (v) => {
        const n = Math.round(Number(v));
        if (!Number.isFinite(n)) return DEFAULT_PREFS.titleHeight;
        return Math.min(72, Math.max(20, n));
    };

    const normalizePrefs = (raw) => {
        const src = raw && typeof raw === "object" ? raw : {};
        return {
            color: String(src.color || DEFAULT_PREFS.color).trim() || DEFAULT_PREFS.color,
            contentColor:
                String(src.contentColor || DEFAULT_PREFS.contentColor).trim() ||
                DEFAULT_PREFS.contentColor,
            gradient: src.gradient !== false,
            opacity: clampOpacity(
                src.opacity != null ? src.opacity : DEFAULT_PREFS.opacity
            ),
            titleHeight: clampTitleHeight(
                src.titleHeight != null ? src.titleHeight : DEFAULT_PREFS.titleHeight
            ),
            showClose: src.showClose !== false,
            showMaximize: src.showMaximize !== false,
            showTitle: src.showTitle !== false,
        };
    };

    const loadPrefs = async () => {
        try {
            const stored = await navi.storage.item.get(PREFS_KEY);
            prefs = normalizePrefs(stored);
        } catch (err) {
            console.error("[supermouse_plugin_draggem_div] loadPrefs failed", err);
            prefs = { ...DEFAULT_PREFS };
        }
        return prefs;
    };

    const savePrefs = async () => {
        prefs = normalizePrefs(prefs);
        try {
            await navi.storage.item.set(PREFS_KEY, { ...prefs });
        } catch (err) {
            console.error("[supermouse_plugin_draggem_div] savePrefs failed", err);
        }
        applyPrefsStyles();
        refreshLiveWrappers();
        return prefs;
    };

    const titlebarBackground = () => {
        const c = prefs.color;
        if (prefs.gradient) {
            return `linear-gradient(${c}, color-mix(in srgb, ${c} 65%, black))`;
        }
        return c;
    };

    const ensureStyles = () => {
        if (!isBrowser) return;
        let style = document.getElementById(STYLE_ID);
        if (!style) {
            style = document.createElement("style");
            style.id = STYLE_ID;
            document.head.appendChild(style);
            addedStyles.push(style);
        }
        applyPrefsStyles();
    };

    const applyPrefsStyles = () => {
        if (!isBrowser) return;
        let style = document.getElementById(STYLE_ID);
        if (!style) return;
        const titleH = prefs.titleHeight;
        style.textContent = `
            ${WRAP_TAG} {
                display: block;
                background-color: ${prefs.color};
                line-height: normal;
                position: fixed;
                box-sizing: border-box;
                min-width: 220px;
                min-height: ${titleH + 80}px;
                z-index: 40;
                overflow: hidden;
                border: 2px solid color-mix(in srgb, ${prefs.color} 55%, black);
                opacity: ${prefs.opacity};
            }
            ${WRAP_TAG}[data-maximized="true"] {
                inset: 0 !important;
                left: 0 !important;
                top: 0 !important;
                width: 100vw !important;
                height: 100vh !important;
                z-index: 9999 !important;
                min-width: 0 !important;
                min-height: 0 !important;
            }
            ${WRAP_TAG} .draggem-titlebar {
                position: absolute;
                top: 0; left: 0; right: 0;
                height: ${titleH}px;
                box-sizing: border-box;
                padding: 2px 4px;
                background: ${titlebarBackground()};
                cursor: move;
                user-select: none;
                display: flex;
                align-items: center;
                gap: 4px;
                z-index: 2;
            }
            ${WRAP_TAG} .draggem-titlebar button {
                margin: 0;
                font: 12px/1 sans-serif;
                cursor: pointer;
            }
            ${WRAP_TAG} .draggem-title-label {
                flex: 1;
                font: 11px/1.2 sans-serif;
                color: #333;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                pointer-events: none;
            }
            ${WRAP_TAG} .draggem-content {
                position: absolute;
                top: ${titleH}px;
                left: 0; right: 0; bottom: 0;
                padding: ${CONTENT_PAD}px;
                background-color: ${prefs.contentColor};
                cursor: auto;
                user-select: text;
                overflow: auto;
                box-sizing: border-box;
            }
            ${WRAP_TAG} .draggem-content textarea {
                max-width: 100%;
                box-sizing: border-box;
            }
            ${WRAP_TAG} .draggem-resize {
                position: absolute;
                right: 0; bottom: 0;
                width: 18px; height: 18px;
                cursor: nwse-resize;
                z-index: 3;
                background: linear-gradient(135deg, transparent 55%, #555 55%);
            }
            ${WRAP_TAG}[data-maximized="true"] .draggem-resize {
                display: none;
            }
            ${WRAP_TAG}[data-draggem-show-close="false"] .draggem-close {
                display: none !important;
            }
            ${WRAP_TAG}[data-draggem-show-max="false"] .draggem-max {
                display: none !important;
            }
            ${WRAP_TAG}[data-draggem-show-title="false"] .draggem-title-label {
                display: none !important;
            }
            html:not([data-cooltoolbar]) ${WRAP_TAG} .draggem-min {
                display: none !important;
            }
        `;
    };

    const refreshLiveWrappers = () => {
        if (!isBrowser) return;
        document.querySelectorAll(WRAP_TAG).forEach((wrapper) => {
            wrapper.setAttribute(
                "data-draggem-show-close",
                prefs.showClose ? "true" : "false"
            );
            wrapper.setAttribute(
                "data-draggem-show-max",
                prefs.showMaximize ? "true" : "false"
            );
            wrapper.setAttribute(
                "data-draggem-show-title",
                prefs.showTitle ? "true" : "false"
            );
        });
    };

    const clearSelection = () => {
        try {
            window.getSelection()?.removeAllRanges();
        } catch (_) {
            /* ignore */
        }
    };

    const readPx = (el, prop) => {
        const n = parseFloat(el.style[prop]);
        return Number.isFinite(n) ? n : 0;
    };

    const listen = (element, event, handler, capture = false) => {
        element.addEventListener(event, handler, capture);
        eventListeners.push({ element, event, handler, capture });
    };

    const wireInteractions = (wrapper) => {
        if (!(wrapper instanceof HTMLElement) || dragReady.has(wrapper)) return;
        dragReady.add(wrapper);

        /** Active pointer gesture teardown (shared so lost mouseup can't stick). */
        let gestureCleanup = null;
        const endGesture = () => {
            if (typeof gestureCleanup === "function") {
                const fn = gestureCleanup;
                gestureCleanup = null;
                try {
                    fn();
                } catch (_) {
                    /* ignore */
                }
            }
        };

        const pointFrom = (e) => {
            if (e.touches && e.touches[0]) {
                return { x: e.touches[0].clientX, y: e.touches[0].clientY };
            }
            return { x: e.clientX, y: e.clientY };
        };

        const bindGesture = (onMove) => {
            endGesture();
            const moveOpts = { capture: true, passive: false };
            const onEnd = () => endGesture();
            document.addEventListener("pointermove", onMove, moveOpts);
            document.addEventListener("pointerup", onEnd, true);
            document.addEventListener("pointercancel", onEnd, true);
            document.addEventListener("mousemove", onMove, true);
            document.addEventListener("mouseup", onEnd, true);
            document.addEventListener("touchmove", onMove, moveOpts);
            document.addEventListener("touchend", onEnd, true);
            window.addEventListener("blur", onEnd);
            gestureCleanup = () => {
                document.removeEventListener("pointermove", onMove, moveOpts);
                document.removeEventListener("pointerup", onEnd, true);
                document.removeEventListener("pointercancel", onEnd, true);
                document.removeEventListener("mousemove", onMove, true);
                document.removeEventListener("mouseup", onEnd, true);
                document.removeEventListener("touchmove", onMove, moveOpts);
                document.removeEventListener("touchend", onEnd, true);
                window.removeEventListener("blur", onEnd);
            };
        };

        const startDrag = (e) => {
            if (wrapper.hasAttribute("data-maximized")) return;
            if (e.target.closest("button")) return;
            // Ignore non-primary mouse; allow touch/pen.
            if (e.pointerType === "mouse" && e.button !== 0) return;
            if (typeof e.button === "number" && e.button !== 0 && !e.touches) return;
            e.preventDefault();
            e.stopPropagation();
            clearSelection();
            wrapper.style.zIndex = String(++highestZ);

            const start = pointFrom(e);
            const originLeft = readPx(wrapper, "left");
            const originTop = readPx(wrapper, "top");
            if (typeof e.pointerId === "number" && e.target?.setPointerCapture) {
                try {
                    e.target.setPointerCapture(e.pointerId);
                } catch (_) {
                    /* ignore */
                }
            }

            bindGesture((moveEvent) => {
                moveEvent.preventDefault();
                const p = pointFrom(moveEvent);
                wrapper.style.left = `${originLeft + (p.x - start.x)}px`;
                wrapper.style.top = `${originTop + (p.y - start.y)}px`;
            });
        };

        const startResize = (e) => {
            if (wrapper.hasAttribute("data-maximized")) return;
            if (e.pointerType === "mouse" && e.button !== 0) return;
            if (typeof e.button === "number" && e.button !== 0 && !e.touches) return;
            e.preventDefault();
            e.stopPropagation();
            clearSelection();
            wrapper.style.zIndex = String(++highestZ);

            const start = pointFrom(e);
            const originW = wrapper.offsetWidth;
            const originH = wrapper.offsetHeight;
            const minH = prefs.titleHeight + 80;
            if (typeof e.pointerId === "number" && e.target?.setPointerCapture) {
                try {
                    e.target.setPointerCapture(e.pointerId);
                } catch (_) {
                    /* ignore */
                }
            }

            bindGesture((moveEvent) => {
                moveEvent.preventDefault();
                const p = pointFrom(moveEvent);
                wrapper.style.width = `${Math.max(220, originW + (p.x - start.x))}px`;
                wrapper.style.height = `${Math.max(minH, originH + (p.y - start.y))}px`;
            });
        };

        listen(wrapper, "click", (e) => {
            const btn = e.target.closest?.("button");
            if (!btn || btn.closest(WRAP_TAG) !== wrapper) return;
            if (btn.classList.contains("draggem-close")) {
                e.stopPropagation();
                closeWrapper(wrapper);
            } else if (btn.classList.contains("draggem-max")) {
                e.stopPropagation();
                toggleMaximize(wrapper);
            } else if (btn.classList.contains("draggem-min")) {
                e.stopPropagation();
                minimizeToToolbar(wrapper);
            }
        });

        // Delegate from wrapper so chrome still works if nodes are rebuilt.
        listen(
            wrapper,
            "pointerdown",
            (e) => {
                if (e.target.closest(".draggem-resize")) startResize(e);
                else if (
                    e.target.closest(".draggem-titlebar") &&
                    !e.target.closest("button")
                ) {
                    startDrag(e);
                }
            },
            true
        );
        // Fallback for environments without PointerEvent.
        listen(
            wrapper,
            "mousedown",
            (e) => {
                if (window.PointerEvent) return;
                if (e.target.closest(".draggem-resize")) startResize(e);
                else if (
                    e.target.closest(".draggem-titlebar") &&
                    !e.target.closest("button")
                ) {
                    startDrag(e);
                }
            },
            true
        );
        listen(
            wrapper,
            "touchstart",
            (e) => {
                if (window.PointerEvent) return;
                if (e.target.closest(".draggem-resize")) startResize(e);
                else if (
                    e.target.closest(".draggem-titlebar") &&
                    !e.target.closest("button")
                ) {
                    startDrag(e);
                }
            },
            true
        );
    };

    const destroyWrapper = (wrapper) => {
        if (!(wrapper instanceof HTMLElement)) return;
        const surf = resolveSurf();
        if (surf && typeof surf.unpersist === "function") {
            try {
                surf.unpersist(wrapper);
            } catch (_) {
                /* ignore */
            }
        }
        wrapper.remove();
    };

    /** Custom close lives on the element so it survives a plugin remount. */
    const ON_CLOSE_PROP = "__draggemOnClose";

    const minimizeToToolbar = (wrapper) => {
        const bar = navi?.mod?.cooltoolbar;
        if (!bar || typeof bar.minimize !== "function" || !bar.active) {
            callout("[supermouse_plugin_draggem_div] mount cooltoolbar to minimize here");
            return;
        }
        try {
            bar.minimize(wrapper, { plugin: "draggem" });
        } catch (err) {
            callout(
                `[supermouse_plugin_draggem_div] minimize failed: ${err?.message || err}`
            );
        }
    };

    const closeWrapper = (wrapper) => {
        const onClose = wrapper[ON_CLOSE_PROP];
        if (typeof onClose === "function") {
            Promise.resolve(onClose(wrapper)).catch((err) => {
                callout(
                    `[supermouse_plugin_draggem_div] close failed: ${err?.message || err}`
                );
            });
            return;
        }
        destroyWrapper(wrapper);
    };

    const toggleMaximize = (wrapper) => {
        if (wrapper.hasAttribute("data-maximized")) {
            wrapper.removeAttribute("data-maximized");
            const left = wrapper.getAttribute("data-restore-left");
            const top = wrapper.getAttribute("data-restore-top");
            const width = wrapper.getAttribute("data-restore-width");
            const height = wrapper.getAttribute("data-restore-height");
            if (left != null) wrapper.style.left = left;
            if (top != null) wrapper.style.top = top;
            if (width != null) wrapper.style.width = width;
            if (height != null) wrapper.style.height = height;
        } else {
            wrapper.setAttribute("data-restore-left", wrapper.style.left || "");
            wrapper.setAttribute("data-restore-top", wrapper.style.top || "");
            wrapper.setAttribute("data-restore-width", wrapper.style.width || "");
            wrapper.setAttribute("data-restore-height", wrapper.style.height || "");
            wrapper.setAttribute("data-maximized", "true");
        }
    };

    const buildChrome = (wrapper, { closable, label, onClose, closeTitle } = {}) => {
        const titlebar = document.createElement("div");
        titlebar.className = "draggem-titlebar";
        titlebar.setAttribute("data-part", "draggem-titlebar");
        titlebar.setAttribute("data-jockey-ui", "draggem-titlebar");

        if (typeof onClose === "function") wrapper[ON_CLOSE_PROP] = onClose;

        if (closable) {
            const closeBtn = document.createElement("button");
            closeBtn.type = "button";
            closeBtn.className = "draggem-close";
            closeBtn.textContent = "x";
            closeBtn.title =
                closeTitle ||
                (typeof onClose === "function"
                    ? "close"
                    : "close (unpersist + remove)");
            titlebar.appendChild(closeBtn);
        }

        const maxBtn = document.createElement("button");
        maxBtn.type = "button";
        maxBtn.className = "draggem-max";
        maxBtn.textContent = "□";
        maxBtn.title = "maximize / restore";
        titlebar.appendChild(maxBtn);

        const minBtn = document.createElement("button");
        minBtn.type = "button";
        minBtn.className = "draggem-min";
        minBtn.textContent = "_";
        minBtn.title = "minimize to cooltoolbar";
        titlebar.appendChild(minBtn);

        const lab = document.createElement("span");
        lab.className = "draggem-title-label";
        lab.textContent = label || "draggem";
        titlebar.appendChild(lab);

        const content = document.createElement("div");
        content.className = "draggem-content";
        content.setAttribute("data-part", "draggem-content");

        const resizeEl = document.createElement("div");
        resizeEl.className = "draggem-resize";
        resizeEl.title = "resize";
        resizeEl.setAttribute("data-part", "draggem-resize");
        resizeEl.setAttribute("data-jockey-ui", "draggem-resize");

        wrapper.appendChild(titlebar);
        wrapper.appendChild(content);
        wrapper.appendChild(resizeEl);

        wrapper.setAttribute(
            "data-draggem-show-close",
            prefs.showClose ? "true" : "false"
        );
        wrapper.setAttribute(
            "data-draggem-show-max",
            prefs.showMaximize ? "true" : "false"
        );
        wrapper.setAttribute(
            "data-draggem-show-title",
            prefs.showTitle ? "true" : "false"
        );

        return content;
    };

    /**
     * Adopt a wrapper already in the DOM (earlier mount, persisted surf HTML):
     * strip stale per-button listeners from older builds, then wire this instance.
     */
    const reviveWrapper = (wrapper) => {
        if (!(wrapper instanceof HTMLElement)) return;
        if (!wrapper.querySelector(".draggem-titlebar")) return;
        const bar = wrapper.querySelector(":scope > .draggem-titlebar");
        if (bar && !bar.querySelector(".draggem-min")) {
            const minBtn = document.createElement("button");
            minBtn.type = "button";
            minBtn.className = "draggem-min";
            minBtn.textContent = "_";
            minBtn.title = "minimize to cooltoolbar";
            const maxBtn = bar.querySelector(".draggem-max");
            if (maxBtn) maxBtn.after(minBtn);
            else bar.appendChild(minBtn);
        }
        for (const btn of wrapper.querySelectorAll(
            ":scope > .draggem-titlebar > .draggem-close, :scope > .draggem-titlebar > .draggem-max, :scope > .draggem-titlebar > .draggem-min"
        )) {
            btn.replaceWith(btn.cloneNode(true));
        }
        const z = parseInt(wrapper.style.zIndex, 10);
        if (Number.isFinite(z) && z > highestZ) highestZ = z;
        wireInteractions(wrapper);
    };

    const reviveExistingWrappers = () => {
        if (!isBrowser) return 0;
        const found = [...document.querySelectorAll(WRAP_TAG)];
        found.forEach(reviveWrapper);
        refreshLiveWrappers();
        return found.length;
    };

    /**
     * Size the fixed wrapper so its content box fits the inner element's
     * laid-out / scroll size (titlebar + padding included).
     */
    const fitWrapperToContent = (wrapper, element) => {
        if (!(wrapper instanceof HTMLElement) || !(element instanceof HTMLElement)) {
            return;
        }
        if (wrapper.hasAttribute("data-maximized")) return;

        const titleH = prefs.titleHeight;
        const pad = CONTENT_PAD * 2;
        const border = 4;
        const slack = FIT_SLACK;
        const rect = element.getBoundingClientRect();
        const innerW = Math.max(
            element.scrollWidth || 0,
            element.offsetWidth || 0,
            rect.width || 0
        );
        const innerH = Math.max(
            element.scrollHeight || 0,
            element.offsetHeight || 0,
            rect.height || 0
        );

        const maxW =
            typeof window !== "undefined"
                ? Math.max(220, Math.floor(window.innerWidth * 0.95))
                : 960;
        const maxH =
            typeof window !== "undefined"
                ? Math.max(titleH + 80, Math.floor(window.innerHeight * 0.95))
                : 720;

        const width = Math.min(
            Math.max(Math.ceil(innerW + pad + border + slack), 220),
            maxW
        );
        const height = Math.min(
            Math.max(Math.ceil(innerH + pad + border + titleH + slack), titleH + 80),
            maxH
        );

        wrapper.style.width = `${width}px`;
        wrapper.style.height = `${height}px`;
    };

    /**
     * Wrap a live element (parent stays the same in the DOM).
     * Uses position:fixed + explicit box so drag/resize work over the stage.
     * @param {HTMLElement} element
     * @param {{ persist?: boolean, closable?: boolean, path?: string, onClose?: Function, closeTitle?: string }} [opts]
     */
    const wrapElement = (element, opts = {}) => {
        if (!isBrowser || !(element instanceof HTMLElement)) return null;
        ensureStyles();

        const already = element.closest(WRAP_TAG);
        if (already) {
            if (typeof opts.onClose === "function") already[ON_CLOSE_PROP] = opts.onClose;
            reviveWrapper(already);
            return already;
        }

        const parent = element.parentNode;
        if (!parent) return null;

        const rect = element.getBoundingClientRect();
        const titleH = prefs.titleHeight;
        const left = Number.isFinite(rect.left) ? rect.left : 24;
        const top = Math.max(
            0,
            (Number.isFinite(rect.top) ? rect.top : 24) - titleH
        );

        const wrapper = document.createElement(WRAP_TAG);
        wrapper.setAttribute("data-part", PART);
        if (opts.path) wrapper.setAttribute("data-draggem-path", String(opts.path));

        const priorPart = element.getAttribute("data-part");
        if (priorPart) {
            wrapper.setAttribute("data-draggem-inner-part", priorPart);
        }

        parent.insertBefore(wrapper, element);
        const content = buildChrome(wrapper, {
            closable: opts.closable === true || opts.persist === true,
            label: opts.path || priorPart || "draggem",
            onClose: typeof opts.onClose === "function" ? opts.onClose : null,
            closeTitle: opts.closeTitle,
        });
        placeLive(content, element);

        wrapper.style.left = `${left}px`;
        wrapper.style.top = `${top}px`;
        wrapper.style.zIndex = String(++highestZ);
        fitWrapperToContent(wrapper, element);

        // Second pass after layout / images / form controls settle.
        requestAnimationFrame(() => {
            if (wrapper.isConnected) fitWrapperToContent(wrapper, element);
        });

        wireInteractions(wrapper);

        if (opts.persist) {
            const surf = resolveSurf();
            if (!surf || typeof surf.persist !== "function") {
                callout(
                    "[supermouse_plugin_draggem_div] surf.persist unavailable — wrapper will not survive surf()"
                );
            } else {
                surf.persist(wrapper);
                wrapper.setAttribute("data-draggem-persisted", "true");
            }
        }

        return wrapper;
    };

    const unwrapElement = (node) => {
        if (!isBrowser || !(node instanceof HTMLElement)) return null;
        const wrapper = node.matches?.(WRAP_TAG)
            ? node
            : node.closest?.(WRAP_TAG);
        if (!wrapper || !wrapper.parentNode) return null;

        const content = wrapper.querySelector(".draggem-content");
        const inner = content?.firstElementChild || null;
        const parent = wrapper.parentNode;

        if (inner) {
            const saved = wrapper.getAttribute("data-draggem-inner-part");
            if (saved != null) inner.setAttribute("data-part", saved);
            placeLive(parent, inner, wrapper);
        }

        const surf = resolveSurf();
        if (
            wrapper.getAttribute("data-draggem-persisted") === "true" &&
            surf &&
            typeof surf.unpersist === "function"
        ) {
            try {
                surf.unpersist(wrapper);
            } catch (_) {
                /* ignore */
            }
        }

        wrapper.remove();
        return inner;
    };

    /** Peek the fragment inside .draggem-content (does not unwrap). */
    const getContentElement = (node) => {
        if (!isBrowser || !(node instanceof HTMLElement)) return null;
        const wrapper = node.matches?.(WRAP_TAG)
            ? node
            : node.closest?.(WRAP_TAG);
        if (!wrapper) return null;
        return wrapper.querySelector(".draggem-content")?.firstElementChild || null;
    };

    /** slashfold via surf when mounted; local fallback. @see A_document/slashfold.md */
    const slashfoldLocal = (raw) => {
        let s = String(raw || "").trim();
        if (!s) return "";
        if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s;
        return s
            .replace(/\s+/g, "/")
            .replace(/^\/+/, "")
            .replace(/\/{3,}/g, "//");
    };
    const normalizePath = (raw) => {
        const fn = navi?.mod?.surf?.slashfold;
        if (typeof fn === "function") {
            try {
                const out = fn(raw);
                return typeof out === "string" ? out : slashfoldLocal(raw);
            } catch {
                /* fall through */
            }
        }
        return slashfoldLocal(raw);
    };

    const fetchPathHtml = async (path) => {
        const p = normalizePath(path);
        if (!p) throw new Error("empty path");
        const url =
            typeof navi.resolveUrl === "function" ? navi.resolveUrl(p) : `/${p}`;
        const res = await fetch(url, {
            headers: { Accept: "text/html, text/plain, */*" },
        });
        if (!res.ok) throw new Error(`GET ${p} → ${res.status}`);
        return { path: p, html: await res.text() };
    };

    /**
     * Make fetched markup live (scripts + hx-*), same idea as horizon_stagedir.activate
     * / surf post-swap. Without this, hx-* links fall through as normal navigations.
     */
    const activateHtml = (el) => {
        if (!isBrowser || !el || el.nodeType !== 1) return;
        const scripts =
            el.tagName === "SCRIPT"
                ? [el]
                : Array.from(
                      el.querySelectorAll ? el.querySelectorAll("script") : []
                  );
        for (const oldScript of scripts) {
            const script = document.createElement("script");
            for (const attr of oldScript.attributes) {
                script.setAttribute(attr.name, attr.value);
            }
            script.textContent = oldScript.textContent;
            oldScript.replaceWith(script);
        }
        const htmxApi = globalThis.htmx;
        if (
            el.tagName !== "SCRIPT" &&
            htmxApi &&
            typeof htmxApi.process === "function"
        ) {
            try {
                htmxApi.process(el);
            } catch (err) {
                console.error(
                    "[supermouse_plugin_draggem_div] htmx.process failed",
                    err
                );
            }
        }
    };

    const createFromPath = async (path, at = {}) => {
        if (!isBrowser) throw new Error("browser required");
        ensureStyles();
        const { path: p, html } = await fetchPathHtml(path);

        const shell = document.createElement("div");
        shell.setAttribute("data-part", "htmf");
        shell.setAttribute("data-path", p);
        shell.innerHTML = html;

        let contentEl = shell;
        if (shell.childElementCount === 1 && shell.firstElementChild) {
            contentEl = shell.firstElementChild;
            if (!contentEl.getAttribute("data-part")) {
                contentEl.setAttribute("data-part", "htmf");
            }
            if (!contentEl.getAttribute("data-path")) {
                contentEl.setAttribute("data-path", p);
            }
        }

        // Shrink-wrap for measure; fitWrapperToContent expands to real content.
        contentEl.style.display = "inline-block";
        contentEl.style.boxSizing = "border-box";
        contentEl.style.maxWidth = "min(95vw, 48rem)";
        contentEl.style.width = "max-content";

        document.body.appendChild(contentEl);
        const wrapper = wrapElement(contentEl, {
            persist: true,
            closable: true,
            path: p,
        });
        if (wrapper) {
            const inner =
                wrapper.querySelector(".draggem-content")?.firstElementChild ||
                contentEl;
            activateHtml(inner);
            requestAnimationFrame(() => {
                if (wrapper.isConnected) fitWrapperToContent(wrapper, inner);
            });
        }
        const x = Number(at.x);
        const y = Number(at.y);
        if (wrapper && Number.isFinite(x) && Number.isFinite(y)) {
            wrapper.style.left = `${Math.max(0, x)}px`;
            wrapper.style.top = `${Math.max(0, y)}px`;
        }
        return wrapper;
    };

    const activatePathInput = (row, menuApi) => {
        if (!row || row.dataset.draggemInput === "1") return;
        row.dataset.draggemInput = "1";
        row.classList.add("smd-input-row");
        row.textContent = "";

        const input = document.createElement("input");
        input.placeholder =
            "path (manifest hypertext welcome / flowerpot/… / mimex:…)";
        input.setAttribute("aria-label", "draggem path");
        input.style.cssText =
            "width:100%;padding:2px 4px;border:1px inset #f0f0f0;background:white;font-family:monospace;font-size:12px;outline:none;box-sizing:border-box";
        row.appendChild(input);
        input.focus();

        input.addEventListener("click", (e) => e.stopPropagation());
        input.addEventListener("mousedown", (e) => e.stopPropagation());

        const reset = () => {
            row.dataset.draggemInput = "0";
            row.classList.remove("smd-input-row");
            row.textContent = "draggem_div…";
        };

        input.addEventListener("keydown", (e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
                const path = input.value.trim();
                const ptr =
                    typeof menuApi?.pointer === "function"
                        ? menuApi.pointer()
                        : { x: 24, y: 24 };
                if (typeof menuApi?.close === "function") menuApi.close();
                if (!path) return;
                void (async () => {
                    try {
                        const wrapper = await createFromPath(path, ptr);
                        const opened =
                            wrapper?.getAttribute?.("data-path") ||
                            normalizePath(path);
                        callout(
                            `[supermouse_plugin_draggem_div] opened ${opened}`
                        );
                    } catch (err) {
                        callout(
                            `[supermouse_plugin_draggem_div] ${err && err.message ? err.message : err}`
                        );
                    }
                })();
            } else if (e.key === "Escape") {
                e.preventDefault();
                reset();
            }
        });

        input.addEventListener("blur", () => {
            setTimeout(() => {
                if (row.isConnected && row.dataset.draggemInput === "1") reset();
            }, 10);
        });
    };

    const buildRootMenu = (api) => {
        const row = api.item("draggem_div…");
        row.title = "Path → free-floating surf-persisted draggem div";
        row.addEventListener("click", (e) => {
            e.stopPropagation();
            activatePathInput(row, api);
        });
        api.insertAfter(row);
    };

    const buildPrefsMenu = (api) => {
        api.insertAfter(
            api.inputRow("color", prefs.color, (v) => {
                prefs.color = v || DEFAULT_PREFS.color;
                void savePrefs();
            })
        );
        api.insertAfter(
            api.inputRow("content", prefs.contentColor, (v) => {
                prefs.contentColor = v || DEFAULT_PREFS.contentColor;
                void savePrefs();
            })
        );
        api.insertAfter(
            api.inputRow("opacity", String(prefs.opacity), (v) => {
                prefs.opacity = clampOpacity(v);
                void savePrefs();
            })
        );
        api.insertAfter(
            api.inputRow("titleHeight", String(prefs.titleHeight), (v) => {
                prefs.titleHeight = clampTitleHeight(v);
                void savePrefs();
            })
        );

        const gradMark = prefs.gradient ? "[x]" : "[ ]";
        const gradRow = api.item(`${gradMark} gradient`, { checkbox: true });
        gradRow.title = "Titlebar gradient vs flat color";
        gradRow.addEventListener("click", (e) => {
            e.stopPropagation();
            prefs.gradient = !prefs.gradient;
            void savePrefs();
            gradRow.textContent = `${prefs.gradient ? "[x]" : "[ ]"} gradient`;
        });
        api.insertAfter(gradRow);

        const closeMark = prefs.showClose ? "[x]" : "[ ]";
        const closeRow = api.item(`${closeMark} show X`, { checkbox: true });
        closeRow.title = "Show close button when chrome is closable";
        closeRow.addEventListener("click", (e) => {
            e.stopPropagation();
            prefs.showClose = !prefs.showClose;
            void savePrefs();
            closeRow.textContent = `${prefs.showClose ? "[x]" : "[ ]"} show X`;
        });
        api.insertAfter(closeRow);

        const maxMark = prefs.showMaximize ? "[x]" : "[ ]";
        const maxRow = api.item(`${maxMark} show □`, { checkbox: true });
        maxRow.title = "Show maximize / restore button";
        maxRow.addEventListener("click", (e) => {
            e.stopPropagation();
            prefs.showMaximize = !prefs.showMaximize;
            void savePrefs();
            maxRow.textContent = `${prefs.showMaximize ? "[x]" : "[ ]"} show □`;
        });
        api.insertAfter(maxRow);

        const titleMark = prefs.showTitle ? "[x]" : "[ ]";
        const titleRow = api.item(`${titleMark} show title`, { checkbox: true });
        titleRow.title = "Show titlebar path / label text";
        titleRow.addEventListener("click", (e) => {
            e.stopPropagation();
            prefs.showTitle = !prefs.showTitle;
            void savePrefs();
            titleRow.textContent = `${prefs.showTitle ? "[x]" : "[ ]"} show title`;
        });
        api.insertAfter(titleRow);
    };

    const rootDropdownMenu = {
        id: "draggem_div",
        label: "draggem_div",
        build: buildRootMenu,
    };

    const dropdownMenu = {
        id: "draggem_div",
        label: "draggem_div",
        build: buildPrefsMenu,
    };

    const hookDropdown = () => {
        const dd = resolveDropdown();
        if (!dd) return false;
        if (!unmenuDropdown && typeof dd.registerPluginMenu === "function") {
            unmenuDropdown = dd.registerPluginMenu(dropdownMenu);
        }
        if (!unrootDropdown && typeof dd.registerRootMenu === "function") {
            unrootDropdown = dd.registerRootMenu(rootDropdownMenu);
        }
        return !!(unmenuDropdown || unrootDropdown);
    };

    const unhookDropdown = () => {
        if (typeof unmenuDropdown === "function") {
            try {
                unmenuDropdown();
            } catch (_) {
                /* ignore */
            }
            unmenuDropdown = null;
        }
        if (typeof unrootDropdown === "function") {
            try {
                unrootDropdown();
            } catch (_) {
                /* ignore */
            }
            unrootDropdown = null;
        }
    };

    return {
        name: "supermouse_plugin_draggem_div",
        version: "0.3.2",
        description:
            "Draggem chrome with prefs (navi.storage draggem) + fit-to-content wrap",

        moduleInfo: {
            name: "supermouse_plugin_draggem_div",
            version: "0.3.2",
            description:
                "Draggem chrome with prefs (navi.storage draggem) + fit-to-content wrap",
        },

        PART,
        WRAP_TAG,
        PREFS_KEY,
        wrapElement,
        unwrapElement,
        getContentElement,
        createFromPath,
        destroyWrapper,
        fitWrapperToContent,
        getPrefs: () => ({ ...prefs }),
        setPrefs: async (next) => {
            prefs = normalizePrefs({ ...prefs, ...(next || {}) });
            return savePrefs();
        },
        loadPrefs,
        savePrefs,
        rootDropdownMenu,
        dropdownMenu,

        onMount: async () => {
            if (!isBrowser) {
                callout("[supermouse_plugin_draggem_div] browser required");
                return;
            }
            await loadPrefs();
            ensureStyles();
            const revived = reviveExistingWrappers();
            hookDropdown();
            if (typeof navi?.on === "function") {
                dropdownMountHandler = (msg) => {
                    if (msg?.kind === "mount" || msg?.kind === "unmount") {
                        unhookDropdown();
                        hookDropdown();
                    }
                };
                navi.on("supermouse_plugin_dropdown", dropdownMountHandler);
            }
            callout(
                "[supermouse_plugin_draggem_div] mounted — prefs key `draggem`; plugins ▸ draggem_div" +
                    (revived ? ` (reinit ${revived} existing)` : "")
            );
        },

        onUnmount: () => {
            unhookDropdown();
            if (dropdownMountHandler && typeof navi?.off === "function") {
                navi.off("supermouse_plugin_dropdown", dropdownMountHandler);
                dropdownMountHandler = null;
            }
            for (const { element, event, handler, capture } of eventListeners) {
                try {
                    element.removeEventListener(event, handler, !!capture);
                } catch (_) {
                    /* ignore */
                }
            }
            eventListeners.length = 0;
            for (const s of addedStyles) {
                try {
                    s.remove();
                } catch (_) {
                    /* ignore */
                }
            }
            addedStyles.length = 0;
        },
    };
};
