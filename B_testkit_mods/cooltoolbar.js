/**
 * cooltoolbar — a bookmarks-style bar at the top of the viewport.
 *
 * Pushes page content down (~30px). Other mods hook in while it is mounted:
 *   cooltoolbarPlugin = { id, order?, mount?(slot, api), renderItem?(item, el, api), expand?(item, api, live) }
 *     (or a list of them)
 *
 * Docked chips persist across reloads in the local tip `navi:cooltoolbar:frame` (`data.items`,
 * each `state` is arbitrary JSON the plugin owns). The bar (and docked live nodes
 * held under it) are surf.persist()'d so navi surf() keeps them.
 *
 *   navi.mod.cooltoolbar.minimize(el, { plugin, title, icon, state })
 *   navi.mod.cooltoolbar.expand(id)
 *   navi.mod.cooltoolbar.dock({ plugin, title, icon, state, el? })
 *
 * Draggem wrappers get a minimize button (from supermouse_plugin_draggem_div).
 * Stages / draggem / htmf also get -1 "toolbar-minimize" on stagejockey.
 *
 * Callin: cooltoolbar show | hide | toggle | list | plugins | help
 */

const NAME = "cooltoolbar";
const VERSION = "0.1.3";
/** Local state tip — not `cooltoolbar` / `navi:cooltoolbar` (those are the module park). */
const TIP_IB = "navi:cooltoolbar:frame";
const ROOT_ID = "cooltoolbar";
const HOLD_ID = "cooltoolbar-hold";
const STYLE_ID = "cooltoolbar-style";
const HEIGHT_PX = 30;
const DISCOVER_MS = 2000;

const HELP = [
    "cooltoolbar — bookmarks-style bar at the top of the viewport (pads the page ~30px).",
    "use: cooltoolbar                 this help",
    "     cooltoolbar show | hide     hide leaves a ☰ stub; click it to show again",
    "     cooltoolbar list | plugins",
    "     ☰ folds the chips and bar to that same stub (click again to unfold).",
    "     -1 toolbar-minimize on a stage, draggem, or htmf; click a chip to restore, × to forget.",
    "     draggem titlebar _ docks the window here when this mod is mounted.",
    "     other mods: cooltoolbarPlugin { id, mount?, renderItem?, expand? }",
    "     navi.mod.cooltoolbar.minimize(el, { plugin, title, state })",
    "needs: nothing (draggem_div optional). items live on tip navi:cooltoolbar:frame; the bar is surf-persisted.",
].join("\n");

function partList(n) {
    return String(n?.getAttribute?.("data-part") || "")
        .trim()
        .split(/\s+/)
        .filter(Boolean);
}

function newId() {
    return `ct-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function cleanPath(raw) {
    return String(raw || "")
        .trim()
        .replace(/^navi:/i, "")
        .replace(/^\/+|\/+$/g, "")
        .replace(/\/+/g, "/");
}

export const register = (navi) => {
    const isBrowser = typeof document !== "undefined";
    const CSS = `
#${ROOT_ID}{position:fixed;top:0;left:0;right:0;z-index:2147483001;height:${HEIGHT_PX}px;
  display:flex;align-items:stretch;gap:0;box-sizing:border-box;
  font:12px/1.2 system-ui,Segoe UI,sans-serif;color:#222;user-select:none;
  background:linear-gradient(#f7f7f7,#e2e2e2);border-bottom:1px solid #b0b0b0;
  box-shadow:0 1px 0 #fff inset}
#${ROOT_ID} [data-ct-mark]{flex:0 0 auto;width:22px;display:flex;align-items:center;justify-content:center;
  cursor:pointer;color:#555;font-size:11px;border-right:1px solid #ccc}
#${ROOT_ID} [data-ct-mark]:hover{background:rgba(0,0,0,.06)}
#${ROOT_ID} [data-ct-items]{flex:1 1 auto;display:flex;align-items:center;gap:2px;padding:2px 4px;
  overflow-x:auto;overflow-y:hidden}
#${ROOT_ID} [data-ct-item]{flex:0 0 auto;display:inline-flex;align-items:center;gap:4px;
  max-width:168px;height:22px;padding:0 8px;border-radius:3px;border:1px solid transparent;
  overflow:hidden;white-space:nowrap;text-overflow:ellipsis;cursor:pointer;color:#222}
#${ROOT_ID} [data-ct-item]:hover{background:#fff;border-color:#c8c8c8;box-shadow:0 1px 0 #ddd}
#${ROOT_ID} [data-ct-item] [data-ct-ico]{opacity:.75;flex:0 0 auto}
#${ROOT_ID} [data-ct-item] [data-ct-x]{margin-left:2px;opacity:.35;font-size:11px;flex:0 0 auto}
#${ROOT_ID} [data-ct-item] [data-ct-x]:hover{opacity:1;color:#800}
#${ROOT_ID} [data-ct-plugins]{flex:0 0 auto;display:flex;align-items:center;gap:4px;padding:0 6px;
  border-left:1px solid #ccc}
#${HOLD_ID}{display:none !important}
#${ROOT_ID}[data-stub]{width:22px;right:auto;border-right:1px solid #b0b0b0}
#${ROOT_ID}[data-stub] [data-ct-items],#${ROOT_ID}[data-stub] [data-ct-plugins]{display:none}
html[data-cooltoolbar]{padding-top:${HEIGHT_PX}px !important;box-sizing:border-box}
`;

    let hidden = false;
    let root = null;
    let discoverTimer = null;
    /** @type {{ items: object[] }} */
    let frame = { items: [] };
    /** plugin id → { def, slot, cleanup, owner } */
    const hooked = new Map();
    /** item id → live Element parked in the hold */
    const live = new Map();
    let saveTimer = 0;

    const tipApi = () => navi?.storage?.tip || null;
    const surfApi = () => navi?.mod?.surf || null;

    const placeLive = (parent, el, ref = null) => {
        if (!parent || !el) return;
        if (typeof parent.moveBefore === "function" && el.isConnected && parent.isConnected) {
            try {
                parent.moveBefore(el, ref);
                return;
            } catch {
                /* fall through */
            }
        }
        parent.insertBefore(el, ref);
    };

    const persistBar = () => {
        const surf = surfApi();
        if (!root || !surf?.persist) return;
        try {
            if (!surf.isPersisted?.(root)) surf.persist(root);
        } catch {
            /* ignore */
        }
    };

    async function loadFrame() {
        const tip = await tipApi()?.get?.(TIP_IB).catch(() => null);
        const items = Array.isArray(tip?.data?.items) ? tip.data.items : [];
        hidden = !!(tip?.data?.hidden || tip?.data?.folded);
        frame = { items: items.map((x) => ({ ...x })) };
    }

    function scheduleSave() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => void saveFrame(), 180);
    }

    async function saveFrame() {
        const api = tipApi();
        if (!api?.mut8) return;
        await api.mut8(
            TIP_IB,
            {
                parts: ["ibgib_frame", "cooltoolbar"],
                items: frame.items,
                hidden,
                updated_at: new Date().toISOString(),
            },
            { create: true, replaceData: true }
        );
    }

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
        el.setAttribute("data-part", "cooltoolbar");
        el.setAttribute("data-jockey-ui", "cooltoolbar");
        el.innerHTML =
            '<div data-ct-mark title="fold to stub — click again to show chips">☰</div>' +
            '<div data-ct-items></div>' +
            '<div data-ct-plugins></div>';
        const mark = el.querySelector("[data-ct-mark]");
        const swallow = (e) => {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation?.();
        };
        mark.addEventListener(
            "pointerdown",
            (e) => {
                swallow(e);
                void onMarkClick();
            },
            true
        );
        mark.addEventListener("click", swallow, true);
        mark.addEventListener("pointerup", swallow, true);
        el.querySelector("[data-ct-items]").addEventListener("click", (e) => {
            const x = e.target.closest?.("[data-ct-x]");
            const chip = e.target.closest?.("[data-ct-item]");
            if (!chip) return;
            const id = chip.getAttribute("data-ct-id");
            if (!id) return;
            e.stopPropagation();
            if (x) void forget(id);
            else void expand(id);
        });
        return el;
    }

    function applyChrome() {
        if (!root) return;
        root.toggleAttribute("data-stub", !!hidden);
        if (hidden) document.documentElement.removeAttribute("data-cooltoolbar");
        else document.documentElement.setAttribute("data-cooltoolbar", "");
    }

    async function onMarkClick() {
        hidden = !hidden;
        applyChrome();
        if (!hidden) discover();
        scheduleSave();
    }

    function attach() {
        if (!isBrowser) return;
        ensureStyle();
        if (!root) root = build();
        if (!root.isConnected) document.documentElement.appendChild(root);
        holdEl();
        applyChrome();
        persistBar();
        renderItems();
    }

    function detach() {
        document.documentElement.removeAttribute("data-cooltoolbar");
        root?.remove();
        document.getElementById(HOLD_ID)?.remove();
    }

    function holdEl() {
        if (!isBrowser) return null;
        let h = document.getElementById(HOLD_ID);
        if (!h) {
            h = document.createElement("div");
            h.id = HOLD_ID;
            h.setAttribute("data-ct-hold", "");
            h.setAttribute("data-jockey-ui", "cooltoolbar-hold");
            h.setAttribute("hidden", "");
            document.documentElement.appendChild(h);
        }
        const surf = surfApi();
        try {
            if (surf?.persist && !surf.isPersisted?.(h)) surf.persist(h);
        } catch {
            /* ignore */
        }
        return h;
    }
    function itemsEl() {
        return root?.querySelector("[data-ct-items]") || null;
    }
    function pluginsEl() {
        return root?.querySelector("[data-ct-plugins]") || null;
    }

    function pluginOf(id) {
        const name = String(id || "");
        for (const m of hooked.values()) {
            if (m.id === name || m.def?.id === name) return m.def;
        }
        const mod = navi.mod?.[name];
        const exp = mod?.cooltoolbarPlugin;
        const list = Array.isArray(exp) ? exp : exp ? [exp] : [];
        return list.find((p) => String(p.id || name) === name) || list[0] || null;
    }

    function defaultIcon(plugin) {
        if (plugin === "stage") return "▤";
        if (plugin === "draggem") return "▣";
        if (plugin === "htmf") return "▢";
        return "•";
    }

    function paintChip(item, el) {
        el.replaceChildren();
        el.setAttribute("data-ct-id", item.id);
        el.title = item.title || item.plugin || item.id;
        const def = pluginOf(item.plugin);
        if (typeof def?.renderItem === "function") {
            try {
                def.renderItem(item, el, publicApi);
                return;
            } catch (e) {
                console.warn(`[${NAME}] renderItem ${item.plugin}:`, e);
            }
        }
        const ico = document.createElement("span");
        ico.setAttribute("data-ct-ico", "");
        ico.textContent = item.icon || defaultIcon(item.plugin);
        const lab = document.createElement("span");
        lab.textContent = item.title || item.plugin || "item";
        const x = document.createElement("span");
        x.setAttribute("data-ct-x", "");
        x.title = "remove from toolbar";
        x.textContent = "×";
        el.append(ico, lab, x);
    }

    function renderItems() {
        const row = itemsEl();
        if (!row) return;
        const have = new Map([...row.querySelectorAll("[data-ct-item]")].map((n) => [n.getAttribute("data-ct-id"), n]));
        const keep = new Set();
        for (const item of frame.items) {
            keep.add(item.id);
            let chip = have.get(item.id);
            if (!chip) {
                chip = document.createElement("span");
                chip.setAttribute("data-ct-item", item.plugin || "");
                row.appendChild(chip);
            }
            paintChip(item, chip);
        }
        for (const [id, chip] of have) {
            if (!keep.has(id)) chip.remove();
        }
    }

    function exportedPlugins() {
        const out = [];
        const names = typeof navi.listModules === "function" ? navi.listModules() : Object.keys(navi.mod || {});
        for (const owner of names) {
            const exp = navi.mod?.[owner]?.cooltoolbarPlugin;
            for (const def of Array.isArray(exp) ? exp : exp ? [exp] : []) {
                const id = String(def?.id || def?.name || owner);
                out.push({ id, def, owner });
            }
        }
        return out.sort((a, b) => (Number(a.def.order) || 10) - (Number(b.def.order) || 10));
    }

    function unhook(id) {
        const m = hooked.get(id);
        if (!m) return;
        try {
            m.cleanup?.();
        } catch (e) {
            console.warn(`[${NAME}] plugin ${id} cleanup:`, e);
        }
        m.slot.remove();
        hooked.delete(id);
    }

    function discover() {
        if (!isBrowser) return;
        attach();
        if (hidden) return;
        persistBar();
        const tray = pluginsEl();
        if (!tray) return;
        const liveP = exportedPlugins();
        const liveIds = new Set(liveP.map((p) => p.id));
        for (const [id, m] of hooked) {
            const now = liveP.find((p) => p.id === id);
            if (!liveIds.has(id) || now.def !== m.def) unhook(id);
        }
        for (const { id, def, owner } of liveP) {
            if (hooked.has(id)) continue;
            const slot = document.createElement("span");
            slot.setAttribute("data-ct-plugin", id);
            tray.appendChild(slot);
            let cleanup = null;
            if (typeof def.mount === "function") {
                try {
                    const r = def.mount(slot, publicApi);
                    if (typeof r === "function") cleanup = r;
                } catch (e) {
                    console.warn(`[${NAME}] plugin ${id} (${owner}) mount:`, e);
                    slot.textContent = "!";
                    slot.title = `${id}: mount failed`;
                }
            } else if (!slot.childNodes.length) {
                slot.remove();
            }
            hooked.set(id, { id, def, slot, cleanup, owner });
        }
        renderItems();
    }

    function snapshotBox(el) {
        if (!(el instanceof HTMLElement)) return {};
        return {
            left: el.style.left || "",
            top: el.style.top || "",
            width: el.style.width || "",
            height: el.style.height || "",
            zIndex: el.style.zIndex || "",
            path: cleanPath(el.getAttribute("data-path") || el.getAttribute("data-draggem-path") || ""),
            part: el.getAttribute("data-part") || "",
            tag: String(el.tagName || "").toLowerCase(),
        };
    }

    function guessPlugin(el) {
        if (!(el instanceof HTMLElement)) return "item";
        const tag = String(el.tagName || "").toLowerCase();
        if (tag === "x-draggem-div" || partList(el).includes("draggemdiv")) return "draggem";
        if (partList(el).includes("htmf")) return "htmf";
        if (partList(el).includes("stage") || el.hasAttribute("data-stage-slot")) return "stage";
        const stage = el.closest?.('[data-part~="stage"]');
        if (stage) return "stage";
        const wrap = el.closest?.("x-draggem-div");
        if (wrap) return "draggem";
        return "item";
    }

    function targetEl(el, plugin) {
        if (!(el instanceof HTMLElement)) return null;
        if (plugin === "draggem") return el.closest?.("x-draggem-div") || el;
        if (plugin === "stage") return el.closest?.('[data-part~="stage"]') || el;
        if (plugin === "htmf") return el.closest?.('[data-part~="htmf"]') || el;
        return el;
    }

    function isForbiddenDock(el) {
        if (!(el instanceof HTMLElement)) return true;
        if (el === document.documentElement || el === document.body) return true;
        if (el.id === ROOT_ID || el.id === HOLD_ID) return true;
        if (root && el.contains(root)) return true;
        const hold = document.getElementById(HOLD_ID);
        if (hold && el.contains(hold)) return true;
        return false;
    }

    function revealBar() {
        hidden = false;
        attach();
    }

    function titleFor(el, plugin) {
        if (!(el instanceof HTMLElement)) return plugin || "item";
        if (plugin === "draggem") {
            return (
                el.querySelector?.(".draggem-title-label")?.textContent?.trim() ||
                el.getAttribute("data-draggem-path") ||
                "draggem"
            );
        }
        return (
            cleanPath(el.getAttribute("data-path") || "") ||
            el.getAttribute("data-part") ||
            plugin ||
            el.tagName.toLowerCase()
        );
    }

    function dock(spec = {}) {
        const plugin = String(spec.plugin || guessPlugin(spec.el) || "item");
        const el = spec.el instanceof HTMLElement ? targetEl(spec.el, plugin) : null;
        const item = {
            id: String(spec.id || newId()),
            plugin,
            title: String(spec.title || (el ? titleFor(el, plugin) : plugin)),
            icon: spec.icon != null ? String(spec.icon) : defaultIcon(plugin),
            state: spec.state && typeof spec.state === "object" ? spec.state : el ? snapshotBox(el) : {},
            at: new Date().toISOString(),
        };
        const idx = frame.items.findIndex((x) => x.id === item.id);
        if (idx >= 0) frame.items[idx] = item;
        else frame.items.push(item);
        revealBar();
        renderItems();
        const node = el && !isForbiddenDock(el) ? el : null;
        if (node) {
            const surf = surfApi();
            try {
                surf?.unpersist?.(node);
            } catch {
                /* ignore */
            }
            const hold = holdEl();
            if (hold) {
                try {
                    placeLive(hold, node);
                    live.set(item.id, node);
                    node.setAttribute("data-cooltoolbar-id", item.id);
                } catch (e) {
                    console.warn(`[${NAME}] hold ${item.plugin}:`, e);
                }
            }
        }
        scheduleSave();
        return item;
    }

    function minimize(el, opts = {}) {
        if (!(el instanceof HTMLElement)) throw new Error("cooltoolbar.minimize needs an element");
        const plugin = String(opts.plugin || guessPlugin(el));
        const node = targetEl(el, plugin);
        if (!node) throw new Error("nothing to minimize");
        const existing = node.getAttribute("data-cooltoolbar-id");
        if (existing && frame.items.some((x) => x.id === existing)) return frame.items.find((x) => x.id === existing);
        return dock({
            plugin,
            title: opts.title,
            icon: opts.icon,
            state: { ...snapshotBox(node), ...(opts.state && typeof opts.state === "object" ? opts.state : {}) },
            el: node,
        });
    }

    async function expand(id) {
        const item = frame.items.find((x) => x.id === id);
        if (!item) throw new Error(`no toolbar item ${id}`);
        const def = pluginOf(item.plugin);
        let node = live.get(id) || null;
        if (node && !node.isConnected) {
            live.delete(id);
            node = null;
        }
        if (typeof def?.expand === "function") {
            await def.expand(item, publicApi, node);
        } else if (node) {
            const box = item.state || {};
            document.body.appendChild(node);
            if (box.left) node.style.left = box.left;
            if (box.top) node.style.top = box.top;
            if (box.width) node.style.width = box.width;
            if (box.height) node.style.height = box.height;
            if (box.zIndex) node.style.zIndex = box.zIndex;
            node.removeAttribute("data-cooltoolbar-id");
            if (item.plugin === "draggem") {
                try {
                    surfApi()?.persist?.(node);
                    node.setAttribute("data-draggem-persisted", "true");
                } catch {
                    /* ignore */
                }
            }
        } else if (item.plugin === "draggem" && item.state?.path && navi.mod?.supermouse_plugin_draggem_div?.createFromPath) {
            await navi.mod.supermouse_plugin_draggem_div.createFromPath(item.state.path, {
                x: parseFloat(item.state.left) || 40,
                y: parseFloat(item.state.top) || 40,
            });
        } else if (item.state?.path) {
            const surf = navi.mod?.surf?.commands?.surf?.execute;
            if (typeof surf === "function") await surf(item.state.path);
            else if (typeof navi.callin === "function") await navi.callin({ path: item.state.path, method: "GET" });
        }
        live.delete(id);
        frame.items = frame.items.filter((x) => x.id !== id);
        renderItems();
        scheduleSave();
        return item;
    }

    async function forget(id) {
        const node = live.get(id);
        if (node) {
            try {
                node.remove();
            } catch {
                /* ignore */
            }
            live.delete(id);
        }
        frame.items = frame.items.filter((x) => x.id !== id);
        renderItems();
        scheduleSave();
    }

    const publicApi = {
        get active() {
            return isBrowser && !hidden && !!root?.isConnected;
        },
        get height() {
            return hidden ? 0 : HEIGHT_PX;
        },
        items: () => frame.items.slice(),
        dock,
        minimize,
        expand,
        forget,
        patch(id, patch) {
            const item = frame.items.find((x) => x.id === id);
            if (!item) return null;
            if (patch.title != null) item.title = String(patch.title);
            if (patch.icon != null) item.icon = String(patch.icon);
            if (patch.state && typeof patch.state === "object") item.state = { ...item.state, ...patch.state };
            renderItems();
            scheduleSave();
            return item;
        },
        navi,
    };

    function hasType(context, name) {
        const types = Array.isArray(context?.types) ? context.types : [];
        return types.includes(name) || context?.kind === name;
    }

    const scrollbufferPlugin = {
        id: NAME,
        name: NAME,
        claims: [
            {
                id: "cooltoolbar-minimize",
                direction: -1,
                types: ["stage", "stage-member", "draggemdiv", "htmf"],
                color: "#5a5a5a",
                describe: () => ({
                    text: "toolbar-minimize",
                    color: "#444",
                    textShadow: "0 1px 0 #fff",
                }),
                matches: (context) => {
                    if (!publicApi.active) return false;
                    const el = context?.element;
                    if (!(el instanceof HTMLElement)) return false;
                    if (el.closest?.("#cooltoolbar")) return false;
                    return (
                        hasType(context, "stage") ||
                        hasType(context, "stage-member") ||
                        hasType(context, "draggemdiv") ||
                        hasType(context, "htmf")
                    );
                },
                execute: (context, api) => {
                    const el = context?.element;
                    if (!(el instanceof HTMLElement)) throw new Error("no element");
                    const plugin = hasType(context, "htmf")
                        ? "htmf"
                        : hasType(context, "draggemdiv")
                          ? "draggem"
                          : hasType(context, "stage") || hasType(context, "stage-member")
                            ? "stage"
                            : undefined;
                    const item = minimize(el, plugin ? { plugin } : {});
                    navi.callout?.(`[cooltoolbar] docked ${item.title}`);
                    api?.terminate?.();
                    return undefined;
                },
            },
        ],
    };

    async function run(...rawArgs) {
        const verb = String(rawArgs.flatMap((a) => String(a ?? "").split(/\s+/)).filter(Boolean)[0] || "").toLowerCase();
        if (!verb || verb === "help" || verb === "-h" || verb === "--help" || verb === NAME) {
            return HELP;
        }
        if (verb === "show") {
            hidden = false;
            await saveFrame();
            discover();
            return "[cooltoolbar] shown";
        }
        if (verb === "hide") {
            hidden = true;
            await saveFrame();
            applyChrome();
            return "[cooltoolbar] hidden — click ☰ to show";
        }
        if (verb === "toggle") {
            hidden = !hidden;
            await saveFrame();
            if (hidden) applyChrome();
            else discover();
            return hidden ? "[cooltoolbar] hidden — click ☰ to show" : "[cooltoolbar] shown";
        }
        if (verb === "list") {
            if (!frame.items.length) return "  (empty)";
            return frame.items.map((x) => `  ${x.id}  ${x.plugin}  ${x.title}`).join("\n");
        }
        if (verb === "plugins") {
            const liveP = exportedPlugins();
            return liveP.length
                ? liveP.map((p) => `  ${p.id}  (from ${p.owner})`).join("\n")
                : "  (no cooltoolbar plugins mounted)";
        }
        return HELP;
    }

    return {
        name: NAME,
        version: VERSION,
        description: "Top bookmarks-style toolbar; docked items persist in the cooltoolbar frame and survive surf",
        moduleInfo: {
            name: NAME,
            version: VERSION,
            description: "Viewport-top toolbar; plugins hook via cooltoolbarPlugin; items stored on tip navi:cooltoolbar:frame",
        },
        commands: {
            [NAME]: { name: NAME, description: `${NAME} show|hide|toggle|list|plugins`, execute: run },
        },
        scrollbufferPlugin,
        ...publicApi,
        onMount: async () => {
            await loadFrame();
            if (!isBrowser) return;
            discover();
            discoverTimer = setInterval(discover, DISCOVER_MS);
        },
        onUnmount: () => {
            clearInterval(discoverTimer);
            clearTimeout(saveTimer);
            if (!isBrowser) return;
            for (const id of [...hooked.keys()]) unhook(id);
            try {
                surfApi()?.unpersist?.(root);
                surfApi()?.unpersist?.(document.getElementById(HOLD_ID));
            } catch {
                /* ignore */
            }
            detach();
            document.getElementById(STYLE_ID)?.remove();
        },
    };
};
