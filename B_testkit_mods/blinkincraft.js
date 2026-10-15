/**
 * blinkincraft — a small persistent strip in the top-right corner of the screen.
 *
 * Shows the current surf path by default. Plugins add rows: any mounted mod that exports
 *   blinkincraftPlugin = { id, order?, mount(slot, api) → cleanup? }   (or a list of them)
 * gets its own row (`slot`, an element it owns). Plugins mount and unmount with their mods.
 *   api.blink(el, color?)   flash an element briefly
 *   api.navi                the navi instance
 *
 * Lives on <html>, not <body>, so surfs (which replace the body) leave it in place.
 *
 * Callin:
 *   blinkincraft [show | hide | toggle | plugins | help]
 * Click the ◆ to fold it down to just the marker.
 */

const HELP = [
    "blinkincraft — a small strip in the top-right corner: surf path + plugin rows.",
    "use: blinkincraft show | hide | toggle | plugins",
    "     click ◆ to fold it; plugins are mods exporting blinkincraftPlugin (e.g. blinkincraft_sprinter_el).",
].join("\n");

export const register = (navi) => {
    const NAME = "blinkincraft";
    const VERSION = "0.1.2";
    const isBrowser = typeof document !== "undefined";
    const PREFS_KEY = "blinkincraft.prefs";
    /** Last surf seen this page load; kept on window so a remount doesn't lose it. */
    const LIVE_KEY = "__blinkincraftSurfPath";
    /** The init script surfs here when the page loads empty (before mods remount). */
    const START_SURF = "horizon/enter";
    const ROOT_ID = "blinkincraft";
    const STYLE_ID = "blinkincraft-style";
    const DISCOVER_MS = 2000;

    const CSS = `
#${ROOT_ID}{position:fixed;top:4px;right:4px;z-index:2147483000;max-width:min(42vw,420px);box-sizing:border-box;
  text-align:right;
  font:11px/1.35 ui-monospace,Consolas,monospace;color:#222;
  text-shadow:0 0 2px #fff,0 0 1px #fff;user-select:none;pointer-events:auto}
#${ROOT_ID} [data-bc-mark]{cursor:pointer;color:#c79a00;margin-right:4px}
#${ROOT_ID}[data-folded] [data-bc-rows]{display:none}
#${ROOT_ID} [data-bc-rows]{display:inline}
#${ROOT_ID} [data-bc-row]{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#${ROOT_ID} [data-bc-row="surf"]{display:inline}
#${ROOT_ID} [data-bc-label]{opacity:.55;margin-right:4px}
@keyframes blinkincraft-flash{0%{filter:brightness(2.2);text-shadow:0 0 6px currentColor}100%{filter:none;text-shadow:none}}
[data-bc-blink]{animation:blinkincraft-flash .6s ease-out}
`;

    let prefs = { hidden: false, folded: false };
    let surfPath = "";
    let root = null;
    let discoverTimer = null;
    /** plugin id → { def, slot, cleanup, owner } */
    const mounted = new Map();

    const savePrefs = () => navi.storage?.item?.set(PREFS_KEY, prefs);

    function blink(el, color) {
        if (!(el instanceof HTMLElement)) return;
        if (color) el.style.color = color;
        el.removeAttribute("data-bc-blink");
        void el.offsetWidth;
        el.setAttribute("data-bc-blink", "");
        setTimeout(() => el.removeAttribute("data-bc-blink"), 650);
    }

    const api = { navi, blink };

    function ensureStyle() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = CSS;
        document.head.appendChild(style);
    }

    function build() {
        const el = document.createElement("div");
        el.id = ROOT_ID;
        el.setAttribute("data-blinkincraft", "");
        el.innerHTML =
            '<span data-bc-mark title="blinkincraft — click to fold">◆</span>' +
            '<span data-bc-rows><span data-bc-row="surf"><span data-bc-label>surf</span><span data-bc-surf></span></span></span>';
        el.querySelector("[data-bc-mark]").addEventListener("click", () => {
            prefs.folded = !prefs.folded;
            el.toggleAttribute("data-folded", prefs.folded);
            void savePrefs();
        });
        return el;
    }

    function attach() {
        if (!isBrowser || prefs.hidden) return;
        ensureStyle();
        if (!root) root = build();
        root.toggleAttribute("data-folded", !!prefs.folded);
        if (!root.isConnected) document.documentElement.appendChild(root);
        renderSurf();
    }

    function detach() {
        root?.remove();
    }

    function renderSurf() {
        const el = root?.querySelector("[data-bc-surf]");
        if (!el) return;
        const text = surfPath ? "/" + surfPath : "—";
        if (el.textContent !== text) {
            el.textContent = text;
            el.title = text;
        }
    }

    function rowsEl() {
        return root?.querySelector("[data-bc-rows]") || null;
    }

    // ─── plugins ───────────────────────────────────────────────────────

    function exportedPlugins() {
        const out = [];
        const names = typeof navi.listModules === "function" ? navi.listModules() : Object.keys(navi.mod || {});
        for (const owner of names) {
            const exp = navi.mod?.[owner]?.blinkincraftPlugin;
            for (const def of Array.isArray(exp) ? exp : exp ? [exp] : []) {
                const id = String(def?.id || def?.name || owner);
                if (typeof def?.mount === "function") out.push({ id, def, owner });
            }
        }
        return out.sort((a, b) => (Number(a.def.order) || 10) - (Number(b.def.order) || 10));
    }

    function unmountPlugin(id) {
        const m = mounted.get(id);
        if (!m) return;
        try {
            m.cleanup?.();
        } catch (e) {
            console.warn(`[${NAME}] plugin ${id} cleanup:`, e);
        }
        m.slot.remove();
        mounted.delete(id);
    }

    function discover() {
        if (!isBrowser || prefs.hidden) return;
        attach();
        const rows = rowsEl();
        if (!rows) return;
        const live = exportedPlugins();
        const liveIds = new Set(live.map((p) => p.id));
        for (const [id, m] of mounted) {
            const now = live.find((p) => p.id === id);
            if (!liveIds.has(id) || now.def !== m.def) unmountPlugin(id);
        }
        for (const { id, def, owner } of live) {
            if (mounted.has(id)) continue;
            const slot = document.createElement("span");
            slot.setAttribute("data-bc-row", id);
            rows.appendChild(slot);
            let cleanup = null;
            try {
                const r = def.mount(slot, api);
                if (typeof r === "function") cleanup = r;
            } catch (e) {
                console.warn(`[${NAME}] plugin ${id} (${owner}) mount:`, e);
                slot.textContent = `${id}: mount failed`;
            }
            mounted.set(id, { def, slot, cleanup, owner });
        }
    }

    function unmountAll() {
        for (const id of [...mounted.keys()]) unmountPlugin(id);
    }

    // ─── surf path ─────────────────────────────────────────────────────

    /** "surf horizon/enter" / "navi/surf/x -k" → "horizon/enter" / "x"; "" when not a surf. */
    const surfTarget = (raw) => {
        const segs = String(raw || "")
            .trim()
            .replace(/^\/+/, "")
            .split(/[\/\s]+/)
            .filter(Boolean);
        let i = 0;
        if (segs[i] && /^navi$/i.test(segs[i])) i += 1;
        if (String(segs[i] || "").toLowerCase() !== "surf") return "";
        return segs
            .slice(i + 1)
            .filter((s) => !s.startsWith("-"))
            .join("/");
    };

    /** Where this page load started: the URL path, or the init script's start surf at "/". */
    const startPath = () => {
        if (!isBrowser || typeof location === "undefined") return "";
        let p = location.pathname || "";
        try {
            p = decodeURIComponent(p);
        } catch {
            /* keep */
        }
        p = p.replace(/^\/+|\/+$/g, "");
        if (!p) return START_SURF;
        return surfTarget(p) || p.replace(/^navi\//i, "");
    };

    const onCallin = (req) => {
        const raw = typeof req === "string" ? req : req?.path || req?.input || "";
        const path = surfTarget(raw);
        if (!path || path === surfPath) return;
        surfPath = path;
        if (isBrowser) window[LIVE_KEY] = surfPath;
        renderSurf();
        const label = root?.querySelector('[data-bc-row="surf"]');
        if (label) blink(label);
    };

    // ─── commands ──────────────────────────────────────────────────────

    async function run(...rawArgs) {
        const verb = String(rawArgs.flatMap((a) => String(a ?? "").split(/\s+/)).filter(Boolean)[0] || "").toLowerCase();
        if (verb === "show" || (verb === "toggle" && prefs.hidden)) {
            prefs.hidden = false;
            await savePrefs();
            discover();
            return "[blinkincraft] shown";
        }
        if (verb === "hide" || verb === "toggle") {
            prefs.hidden = true;
            await savePrefs();
            unmountAll();
            detach();
            return "[blinkincraft] hidden";
        }
        if (verb === "plugins") {
            const live = exportedPlugins();
            return live.length
                ? live.map((p) => `  ${p.id}  (from ${p.owner})${mounted.has(p.id) ? "" : "  — not mounted"}`).join("\n")
                : "  (no blinkincraft plugins mounted)";
        }
        return HELP;
    }

    return {
        name: NAME,
        version: VERSION,
        description: "Persistent top-right strip: surf path + plugin rows (blinkincraftPlugin)",
        moduleInfo: {
            name: NAME,
            version: VERSION,
            description: "Persistent top-right strip showing the surf path; mods add rows via blinkincraftPlugin",
        },
        commands: {
            [NAME]: { name: NAME, description: `${NAME} show|hide|toggle|plugins`, execute: run },
        },
        blink,
        get surfPath() {
            return surfPath;
        },
        onMount: async () => {
            const p = await navi.storage?.item?.get(PREFS_KEY);
            if (p && typeof p === "object") prefs = { ...prefs, ...p };
            surfPath = (isBrowser && window[LIVE_KEY]) || startPath();
            if (typeof navi.on === "function") navi.on("callin", onCallin);
            if (!isBrowser) return;
            discover();
            discoverTimer = setInterval(discover, DISCOVER_MS);
        },
        onUnmount: () => {
            clearInterval(discoverTimer);
            navi.off?.("callin", onCallin);
            if (!isBrowser) return;
            unmountAll();
            detach();
            document.getElementById(STYLE_ID)?.remove();
        },
    };
};
