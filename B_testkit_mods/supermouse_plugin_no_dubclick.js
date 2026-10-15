// supermouse_plugin_no_dubclick — tiny supermouse testkit plugin
// Relies on supermouse doubleclick mode (second mousedown, detail>=2).
// Toggle: supermouse mode doubleclick off
// Edge: also blocks caret/"typing column" flash on click of non-writable text.

export const register = (navi) => {
    const isBrowser = typeof window !== "undefined" && typeof window.document !== "undefined";
    const PLUGIN_ID = "no_dubclick";
    let unregister = null;
    let hostEventHandler = null;
    let edgeStyleEl = null;
    let edgeSelectStart = null;
    let edgeMouseDown = null;

    const resolveSuperMouse = () => {
        const mod = navi?.mod || globalThis?.navi?.mod;
        if (!mod) return null;
        if (mod.supermouse?.supermouse) return mod.supermouse.supermouse;
        const hit = Object.values(mod).find(
            (entry) => entry?.supermouse && typeof entry.supermouse.registerPlugin === "function"
        );
        return hit?.supermouse || null;
    };

    /** Chromium Edge / EdgeHTML — caret flash on static text click. */
    const isEdge = () => {
        const ua = String(navigator.userAgent || "");
        return /\bEdg\//.test(ua) || /\bEdge\//.test(ua);
    };

    const isWritableTarget = (target) => {
        let el = target;
        if (el && el.nodeType === 3) el = el.parentElement;
        while (el && el.nodeType === 1) {
            if (el.isContentEditable) return true;
            const tag = el.tagName;
            if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
                return true;
            }
            el = el.parentElement;
        }
        return false;
    };

    const clearSelection = () => {
        try {
            window.getSelection()?.removeAllRanges();
        } catch (_) {
            /* ignore */
        }
    };

    const squashCaret = (ctx) => {
        ctx.preventDefault();
        ctx.stopPropagation();
        clearSelection();
    };

    const installEdgeCaretGuard = () => {
        if (!isBrowser || !isEdge()) return;

        if (!edgeStyleEl) {
            edgeStyleEl = document.createElement("style");
            edgeStyleEl.setAttribute("data-part", "no-dubclick-edge");
            edgeStyleEl.textContent =
                "*:not(input):not(textarea):not(select):not([contenteditable]):not([contenteditable='true']) {" +
                "-webkit-user-select:none!important;user-select:none!important;" +
                "}" +
                "input,textarea,select,[contenteditable],[contenteditable='true'] {" +
                "-webkit-user-select:text!important;user-select:text!important;" +
                "}";
            document.documentElement.appendChild(edgeStyleEl);
        }

        if (!edgeSelectStart) {
            edgeSelectStart = (e) => {
                if (isWritableTarget(e.target)) return;
                e.preventDefault();
                clearSelection();
            };
            document.addEventListener("selectstart", edgeSelectStart, true);
        }

        if (!edgeMouseDown) {
            edgeMouseDown = (e) => {
                if (e.button !== 0) return;
                if (isWritableTarget(e.target)) return;
                e.preventDefault();
                clearSelection();
            };
            document.addEventListener("mousedown", edgeMouseDown, true);
        }
    };

    const removeEdgeCaretGuard = () => {
        if (edgeSelectStart) {
            document.removeEventListener("selectstart", edgeSelectStart, true);
            edgeSelectStart = null;
        }
        if (edgeMouseDown) {
            document.removeEventListener("mousedown", edgeMouseDown, true);
            edgeMouseDown = null;
        }
        if (edgeStyleEl && edgeStyleEl.parentNode) {
            edgeStyleEl.parentNode.removeChild(edgeStyleEl);
        }
        edgeStyleEl = null;
    };

    const selfUnmount = (reason, { wtf = true } = {}) => {
        const msg = wtf
            ? `[supermouse_plugin_no_dubclick] WTF — ${reason}`
            : `[supermouse_plugin_no_dubclick] ${reason}`;
        if (typeof navi.callout === "function") navi.callout(msg);
        else console.warn(msg);
        const run = () => {
            const mod = navi?.mod?.supermouse_plugin_no_dubclick;
            if (mod && typeof navi.unmount === "function") navi.unmount(mod);
        };
        if (typeof queueMicrotask === "function") queueMicrotask(run);
        else setTimeout(run, 0);
    };

    const watchHost = () => {
        if (typeof navi?.on !== "function") return;
        hostEventHandler = (msg) => {
            if (msg?.kind === "unmount") {
                selfUnmount("supermouse unmounted — cascading", { wtf: false });
            }
        };
        navi.on("supermouse", hostEventHandler);
    };

    const unwatchHost = () => {
        if (hostEventHandler && typeof navi?.off === "function") {
            navi.off("supermouse", hostEventHandler);
        }
        hostEventHandler = null;
    };

    return {
        name: "supermouse_plugin_no_dubclick",
        version: "0.1.5",
        description:
            "Blocks double-click word select; Edge: no caret flash on non-writable clicks",

        moduleInfo: {
            name: "supermouse_plugin_no_dubclick",
            version: "0.1.5",
            description:
                "Blocks double-click word select; Edge: no caret flash on non-writable clicks"
        },

        PLUGIN_ID,

        onMount: async () => {
            if (!isBrowser) {
                selfUnmount("browser required");
                return;
            }
            const host = resolveSuperMouse();
            if (!host) {
                selfUnmount("supermouse must be mounted first");
                return;
            }

            const edge = isEdge();
            const modes = edge ? ["doubleclick", "leftclick"] : ["doubleclick"];

            unregister = host.registerPlugin({
                id: PLUGIN_ID,
                name: "no_dubclick",
                description: edge
                    ? "Blocks double-click select + Edge caret flash on non-writable text"
                    : "Blocks double-click word select while mode doubleclick is ON",
                modes,
                enabled: true,
                onDoubleClick: (ctx) => {
                    squashCaret(ctx);
                },
                // preventDefault only — stopPropagation would kill titlebar /
                // image-resize / other bubble+capture handlers on the same click.
                onLeftClick: edge
                    ? (ctx) => {
                          if (isWritableTarget(ctx.target)) return;
                          ctx.preventDefault();
                          clearSelection();
                      }
                    : null
            });

            installEdgeCaretGuard();
            watchHost();

            if (typeof navi.callout === "function") {
                navi.callout(
                    edge
                        ? "[supermouse_plugin_no_dubclick] mounted — Edge caret guard on (needs supermouse ≥0.1.2)"
                        : "[supermouse_plugin_no_dubclick] mounted — needs supermouse ≥0.1.2 (try: supermouse mode doubleclick off)"
                );
            }
        },

        onUnmount: () => {
            unwatchHost();
            removeEdgeCaretGuard();
            if (typeof unregister === "function") {
                try {
                    unregister();
                } catch (_) {
                    /* host may be gone */
                }
                unregister = null;
            }
        }
    };
};
