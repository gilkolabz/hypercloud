/**
 * tinyviewport_manager — optional companion to the tinyviewport HTMF fragment.
 *
 * Plugins surface nodes + edges in navi's ibgib space; the fragment draws them
 * and keeps a preference stack for style (stroke/fill/text, legend colors,
 * plugin enablement). Node drag offsets are stored per view key (identical
 * views recall; different views do not share positions).
 *
 *   mount flowerpot/hypercloud/testkit/mods/legacy/tinyviewport_manager.js
 *   tinyviewport_manager status | help | plugins | plugin on|off <id>
 *
 * Other modules register plugins on mount, e.g. tinyviewport_flowchart.js /
 * tinyviewport_tip_verbs.js → navi.mod.tinyviewport_manager.registerPlugin({ … }).
 *
 * Plugin def:
 *   {
 *     id, label, description?,
 *     enabledByDefault?: boolean,
 *     legend?: [{ id, label, color }],
 *     // Band layout owned by the plugin; HTMF only consumes getLayoutPlan().
 *     // Nodes stamp layoutPrefix + layoutBand (+ layoutOrder); row=`${prefix}:${band}`.
 *     layout?: { prefix?: string, bands: string[], rev?: string },
 *     // async ({ baseIb, tipApi, itemApi, getFrame, looksLikeAddr, navi })
 *     //   → { nodes?: Node[], edges?: Edge[] }
 *     contribute?: async (ctx) => ({ nodes, edges }),
 *     // Preference stack: enabled plugins in register order overlay style.
 *     // Disable a plugin → its claim drops; previous enabled claim remains.
 *     // Lineage (builtin) is the base: black square + n label.
 *     styleNode?: (node, frame, style) => ({
 *       fill?, stroke?, text?, opacity?,
 *       label?, flair?, flairColor?, title?,
 *       width?, height?,  // logical px @ scale 100%; fragment scales + lays out
 *       // set width/height/flair to null to clear a prior claim
 *       detail?: { flair?, kind?, heading?, lines? }, // mouseover card
 *     }|null),
 *     overlayNode?: (node, frame, ctx) => ({
 *       actions?: Array<{
 *         id: string,
 *         label: string,
 *         title?: string,
 *         href?: string,
 *         run?: () => void | Promise<void>,
 *       }>,
 *       scrub?: {
 *         id?: string,
 *         label?: string,
 *         total: number,
 *         index?: number,
 *         step: (index: number) => Promise<{ frame?, detail?, tipText? }|null>
 *           | { frame?, detail?, tipText? }|null,
 *       },
 *     }|null|Promise<...>),
 *   }
 *
 * Node: { addr, ib?, frame?, kind?, row?, stub?, source?, layoutPrefix?, layoutBand?, layoutOrder? }
 * Edge: { from, to, rel, color?, source? }
 */
export const register = (navi) => {
    const VERSION = "0.2.8";
    const PREFS_KEY = "navi:tinyviewport_manager:prefs";
    /** Soft cap on prefs tip frames; over this, drop an early intermediary batch. */
    const PREFS_FRAME_SOFT_MAX = 30;
    /** How many non-root, non-tip frames to drop per prune. */
    const PREFS_FRAME_PRUNE_BATCH = 20;
    const WAREZ_SUBJECT =
        "flowerpot/hypercloud/testkit/mods/legacy/tinyviewport_manager.js";
    const WAREZ_MANIFEST = "flowerpot/hypercloud/testkit/mods/tinyviewport_manager";

    /** @type {Map<string, any>} */
    const plugins = new Map();
    /** @type {Map<string, any>} */
    const modes = new Map();
    /** @type {Set<() => void>} */
    const listeners = new Set();

    const DEFAULT_PREFS = {
        plugins: {}, // id → boolean (omit = use enabledByDefault)
        /** Active presentation mode id (sidebar_v1 | graph_v1 | …) — legacy; fragment uses nesting */
        activeMode: "graph_v1",
        /** Nested tip-list by path segments (delimiter-nest checkbox) */
        nesting: false,
        /** Mode enable overrides (omit = enabledByDefault) */
        modes: {},
        /** @deprecated flat bags — cleared; use viewOffsets */
        offsets: {},
        /** @deprecated see offsets */
        offsetsMass: {},
        /**
         * Per-view drag bags: viewKey → { addr → { dx, dy } }.
         * viewKey from buildViewKey — mass/iso scope + sorted enabled plugin ids.
         */
        viewOffsets: {},
        /** When true, frame/bin preview overlays the HTMF; false = inline below graph */
        previewOverlay: true,
        /** Graph node scale percent (0–200). Fragment slider; 100 = default. */
        scale: 100,
        /**
         * Lineage time scrub ISO (fragment). null = show through latest stamp.
         */
        timelineAt: null,
        /** Tip-list / chrome colors (prefs-host; always collected) */
        border: "#c0c0c0",
        hostpark: "#8e44ad",
        text: "#111111",
        bg: "#ffffff",
        node: {
            fill: "#000000",
            text: "#ffffff",
            stroke: "#000000",
            strokeTip: "#000000",
            strokeCascade: "#000000",
            strokeOrphan: "#000000",
            strokeStub: "#000000",
        },
        edge: {
            past: "#888888",
            cascade: "#2ecc71",
            other: "#c0392b",
        },
    };

    let prefsCache = null;

    const tipApi = () => {
        const tip = navi.storage?.tip;
        if (!tip || typeof tip.get !== "function") {
            throw new Error("navi.storage.tip unavailable");
        }
        return tip;
    };

    const itemApi = () => {
        const item = navi.storage?.item;
        if (!item || typeof item.get !== "function") {
            throw new Error("navi.storage.item unavailable");
        }
        return item;
    };

    const notify = () => {
        for (const fn of [...listeners]) {
            try {
                fn();
            } catch (err) {
                console.error("[tinyviewport_manager] listener failed", err);
            }
        }
    };

    const deepMerge = (base, patch) => {
        if (!patch || typeof patch !== "object") return { ...base };
        const out = { ...base };
        for (const [k, v] of Object.entries(patch)) {
            if (
                v &&
                typeof v === "object" &&
                !Array.isArray(v) &&
                base[k] &&
                typeof base[k] === "object" &&
                !Array.isArray(base[k])
            ) {
                out[k] = deepMerge(base[k], v);
            } else {
                out[k] = v;
            }
        }
        return out;
    };

    const loadPrefs = async () => {
        if (prefsCache) return prefsCache;
        try {
            const raw = await itemApi().get(PREFS_KEY);
            if (raw && typeof raw === "object") {
                prefsCache = deepMerge(DEFAULT_PREFS, raw);
                return prefsCache;
            }
        } catch {
            /* default */
        }
        prefsCache = deepMerge(DEFAULT_PREFS, {});
        return prefsCache;
    };

    const prefsTipIb = () => {
        try {
            const presume = navi.storage?.tip?.presume;
            if (typeof presume === "function") return String(presume(PREFS_KEY));
        } catch {
            /* fall through */
        }
        return PREFS_KEY;
    };

    /**
     * When prefs tip has >30 frames, delete ~20 earliest intermediaries.
     * Keeps root (n=0) and the live tip pointer. Does not mut8 or retarget tip.
     * Past links through deleted gens go dangling; tip.get + root stay intact.
     */
    const maybePrunePrefsFrames = async () => {
        const tip = tipApi();
        if (
            typeof tip.frame?.list !== "function" ||
            typeof tip.frame?.del !== "function" ||
            typeof tip.frame?.get !== "function"
        ) {
            return { pruned: 0, total: 0 };
        }
        const ib = prefsTipIb();
        const addrs = ((await tip.frame.list(ib)) || [])
            .map(String)
            .filter((a) => a.includes("^"));
        const total = addrs.length;
        if (total <= PREFS_FRAME_SOFT_MAX) {
            return { pruned: 0, total };
        }

        let tipAddr = "";
        try {
            const live = await tip.get(ib);
            if (live?.ib && live?.gib) tipAddr = `${live.ib}^${live.gib}`;
        } catch {
            tipAddr = "";
        }

        const ranked = [];
        for (const addr of addrs) {
            let frame = null;
            try {
                frame = await tip.frame.get(addr);
            } catch {
                frame = null;
            }
            const at = Date.parse(frame?.data?.timestamp);
            ranked.push({
                addr,
                at: Number.isFinite(at) ? at : Number.POSITIVE_INFINITY,
                genesis:
                    !!frame &&
                    !(Array.isArray(frame.rel8ns?.past) && frame.rel8ns.past.length),
            });
        }
        ranked.sort((a, b) => {
            if (a.at !== b.at) return a.at - b.at;
            return a.addr.localeCompare(b.addr);
        });

        const root =
            ranked.find((r) => r.genesis) || ranked[0] || null;
        const keep = new Set(
            [root?.addr, tipAddr].filter((a) => a && typeof a === "string")
        );

        const victims = ranked
            .filter((r) => !keep.has(r.addr))
            .slice(0, PREFS_FRAME_PRUNE_BATCH);

        for (const v of victims) {
            try {
                await tip.frame.del(v.addr);
            } catch (err) {
                console.warn(
                    "[tinyviewport_manager] prefs frame prune failed",
                    v.addr,
                    err
                );
            }
        }

        if (victims.length && typeof navi.callout === "function") {
            navi.callout(
                `[tinyviewport_manager] pruned ${victims.length}/${total} prefs frames (kept root + tip)`
            );
        }
        return { pruned: victims.length, total };
    };

    const savePrefs = async (next, opts = {}) => {
        prefsCache = deepMerge(DEFAULT_PREFS, next || {});
        await itemApi().set(PREFS_KEY, prefsCache);
        if (!opts.skipPrune) {
            try {
                await maybePrunePrefsFrames();
            } catch (err) {
                console.warn("[tinyviewport_manager] prefs prune skipped", err);
            }
        }
        if (!opts.silent) notify();
        return prefsCache;
    };

    /** Wipe prefs tip (+ frames) and reset cache to defaults. Does not save. */
    const clearPrefs = async () => {
        prefsCache = null;
        try {
            if (typeof itemApi().del === "function") {
                await itemApi().del(PREFS_KEY);
            }
        } catch {
            /* tip may already be gone */
        }
        // Belt: drop any leftover frames if del left orphans.
        try {
            const tip = tipApi();
            const ib = prefsTipIb();
            if (typeof tip.frame?.list === "function") {
                for (const a of (await tip.frame.list(ib)) || []) {
                    try {
                        await tip.frame.del(String(a));
                    } catch {
                        /* ignore */
                    }
                }
            }
            if (typeof tip.del === "function") await tip.del(ib);
        } catch {
            /* ignore */
        }
        prefsCache = deepMerge(DEFAULT_PREFS, {});
        notify();
        return prefsCache;
    };

    let offsetSaveTimer = null;
    /** @type {{ viewKey: string, bag: Record<string, { dx: number, dy: number }> } | null} */
    let offsetSavePending = null;

    const flushOffsetSave = async () => {
        offsetSaveTimer = null;
        const pending = offsetSavePending;
        offsetSavePending = null;
        if (!pending?.viewKey) return;
        const prefs = await loadPrefs();
        const viewOffsets = { ...(prefs.viewOffsets || {}) };
        if (!pending.bag || !Object.keys(pending.bag).length) {
            delete viewOffsets[pending.viewKey];
        } else {
            viewOffsets[pending.viewKey] = pending.bag;
        }
        await savePrefs({ ...prefs, viewOffsets }, { silent: true });
    };

    const patchPrefs = async (patch) => {
        const cur = await loadPrefs();
        return savePrefs(deepMerge(cur, patch));
    };

    const splitAddr = (addr) => {
        const a = String(addr || "");
        const i = a.indexOf("^");
        if (i <= 0) return { ib: a, gib: "" };
        return { ib: a.slice(0, i), gib: a.slice(i + 1) };
    };

    const frameAddr = (frame) => {
        if (!frame || !frame.ib) return "";
        return frame.gib ? `${frame.ib}^${frame.gib}` : String(frame.ib);
    };

    const looksLikeAddr = (s) => {
        const t = String(s || "").trim();
        const i = t.indexOf("^");
        return i > 0 && i < t.length - 1;
    };

    const framesMapGet = (map, addr) => {
        if (!map || typeof map !== "object") return null;
        const a = String(addr || "").trim();
        if (!a) return null;
        if (map[a] && typeof map[a] === "object") return map[a];
        const want = a.toUpperCase();
        for (const [k, v] of Object.entries(map)) {
            if (String(k).toUpperCase() === want && v && typeof v === "object") {
                return v;
            }
        }
        return null;
    };

    const getFrame = async (addr) => {
        const a = String(addr || "").trim();
        if (!a) return null;
        const { ib, gib } = splitAddr(a);
        try {
            const f = await tipApi().frame?.get?.(a);
            if (f && typeof f === "object") return f;
        } catch {
            /* ignore */
        }
        try {
            const tip = await tipApi().get(ib);
            if (tip && typeof tip === "object") {
                if (
                    gib &&
                    String(tip.gib || "").toUpperCase() === gib.toUpperCase()
                ) {
                    return tip;
                }
                const fromMap = framesMapGet(tip.data?.frames, a);
                if (fromMap) return fromMap;
                if (!gib) return tip;
            }
        } catch {
            /* ignore */
        }
        return null;
    };

    const isCascadeFrame = (frame) => {
        if (!frame || typeof frame !== "object") return false;
        if (String(frame?.data?.source || "") === "cascade") return true;
        const c = frame?.rel8ns?.cascade_of;
        return Array.isArray(c) && c.length > 0;
    };

    const isPluginEnabled = (id, prefs) => {
        const p = plugins.get(id);
        if (!p) return false;
        const override = prefs?.plugins?.[id];
        if (typeof override === "boolean") return override;
        return p.enabledByDefault !== false;
    };

    const isModeEnabled = (id, prefs) => {
        const m = modes.get(id);
        if (!m) return false;
        const override = prefs?.modes?.[id];
        if (typeof override === "boolean") return override;
        return m.enabledByDefault !== false;
    };

    const registerMode = (def = {}) => {
        const id = String(def.id || "").trim();
        if (!id) throw new Error("[tinyviewport_manager] mode requires id");
        if (modes.has(id)) modes.delete(id);
        modes.set(id, {
            id,
            label: String(def.label || id),
            description: String(def.description || ""),
            enabledByDefault: def.enabledByDefault !== false,
            kind: String(def.kind || "view"),
            source: def.source || "mode",
        });
        notify();
        return () => unregisterMode(id);
    };

    const unregisterMode = (id) => {
        const key = String(id || "").trim();
        if (!modes.has(key)) return false;
        modes.delete(key);
        notify();
        return true;
    };

    const listModes = () =>
        [...modes.values()].map((m) => ({
            id: m.id,
            label: m.label,
            description: m.description,
            enabledByDefault: m.enabledByDefault,
            kind: m.kind,
            source: m.source,
        }));

    const getActiveMode = async () => {
        const prefs = await loadPrefs();
        const want = String(prefs.activeMode || DEFAULT_PREFS.activeMode).trim();
        if (want && isModeEnabled(want, prefs)) return want;
        for (const m of modes.values()) {
            if (isModeEnabled(m.id, prefs)) return m.id;
        }
        return DEFAULT_PREFS.activeMode;
    };

    const setActiveMode = async (id) => {
        const key = String(id || "").trim();
        if (!key || !modes.has(key)) {
            throw new Error(`unknown mode: ${id}`);
        }
        const prefs = await loadPrefs();
        if (!isModeEnabled(key, prefs)) {
            throw new Error(`mode disabled: ${key}`);
        }
        await savePrefs({ ...prefs, activeMode: key });
        return key;
    };

    /**
     * Split an ib into hierarchy segments.
     * Delimiters: `:`, `/`, whitespace, literal `%20`.
     */
    const segmentIb = (ib) =>
        String(ib || "")
            .split(/[:/\s]+|%20/i)
            .map((s) => s.trim())
            .filter(Boolean);

    /**
     * Split keeping the real delimiter that follows each segment.
     * @returns {{ seg: string, delimAfter: string }[]}
     */
    const segmentIbParts = (ib) => {
        const s = String(ib || "");
        const parts = [];
        const re = /[:/\s]+|%20/gi;
        let last = 0;
        let m;
        while ((m = re.exec(s))) {
            const rawSeg = s.slice(last, m.index);
            const seg = rawSeg.trim();
            if (seg) parts.push({ seg, delimAfter: m[0] });
            else if (parts.length) {
                parts[parts.length - 1].delimAfter += m[0];
            }
            last = m.index + m[0].length;
        }
        const tail = s.slice(last).trim();
        if (tail) parts.push({ seg: tail, delimAfter: "" });
        return parts;
    };

    /**
     * Collapse chains of non-tip, single-child folders into one label that
     * keeps the real delimiters from the tip ibs (e.g. navi → mod → foo becomes
     * one row "navi:mod:foo" when only that tip exists under navi).
     */
    const collapseUnaryFolders = (node) => {
        if (!node || !(node.children instanceof Map)) return;
        for (const child of node.children.values()) {
            collapseUnaryFolders(child);
        }
        while (!node.tipIb && node.children.size === 1 && node.segment) {
            const only = [...node.children.values()][0];
            const delim = only.leadDelim != null ? only.leadDelim : ":";
            node.segment = `${node.segment}${delim}${only.segment}`;
            node.path = only.path;
            node.tipIb = only.tipIb;
            node.children = only.children;
        }
    };

    /**
     * True when ib equals prefix or continues after a real path delimiter
     * (`:`, `/`, whitespace, `%20`). So `navi:tipunch` matches
     * `navi:tipunch:jobs` but not `navi:tipunch_manager`.
     */
    const ibUnderPrefix = (ib, prefix) => {
        const p = String(prefix || "").trim();
        const s = String(ib || "").trim();
        if (!p) return true;
        if (!s) return false;
        if (s.length < p.length) return false;
        if (s.slice(0, p.length).toLowerCase() !== p.toLowerCase()) return false;
        if (s.length === p.length) return true;
        return /^([:/\s]+|%20)/i.test(s.slice(p.length));
    };

    /**
     * Drop an active tip-prefix (+ its trailing delimiter) so nest labels
     * show only the remainder under that prefix.
     */
    const stripPrefixFromIb = (ib, prefix) => {
        const p = String(prefix || "").trim();
        const s = String(ib || "").trim();
        if (!p || !s || !ibUnderPrefix(s, p)) return s;
        if (s.length === p.length) return "";
        const rest = s.slice(p.length);
        const m = rest.match(/^([:/\s]+|%20)([\s\S]*)$/i);
        if (m) return m[2];
        return s;
    };

    /**
     * Fold tip ib strings into a nested tree.
     * Unary non-ib folders collapse so remaining path shows with true delimiters.
     * opts.stripPrefix — omit that prefix (+ delim) from nest labels.
     * @returns {{ segment: string, path: string, tipIb: string|null, children: Map<string, any> }}
     */
    const foldIbsToTree = (ibs, opts = {}) => {
        const stripPrefix = String(opts.stripPrefix || "").trim();
        const root = {
            segment: "",
            path: "",
            tipIb: null,
            children: new Map(),
        };
        for (const raw of ibs || []) {
            const tipIb = String(raw || "").trim();
            if (!tipIb) continue;
            const forSegs = stripPrefix
                ? stripPrefixFromIb(tipIb, stripPrefix)
                : tipIb;
            const parts = segmentIbParts(forSegs || "");
            if (!parts.length) {
                // Exact prefix tip (or empty remainder) — single · leaf.
                const seg = "·";
                if (!root.children.has(seg)) {
                    root.children.set(seg, {
                        segment: seg,
                        path: seg,
                        tipIb: null,
                        leadDelim: "",
                        children: new Map(),
                    });
                }
                root.children.get(seg).tipIb = tipIb;
                continue;
            }
            let node = root;
            let pathAcc = "";
            for (let i = 0; i < parts.length; i++) {
                const { seg } = parts[i];
                const leadDelim = i === 0 ? "" : parts[i - 1].delimAfter;
                pathAcc = pathAcc ? `${pathAcc}/${seg}` : seg;
                if (!node.children.has(seg)) {
                    node.children.set(seg, {
                        segment: seg,
                        path: pathAcc,
                        tipIb: null,
                        leadDelim,
                        children: new Map(),
                    });
                }
                node = node.children.get(seg);
            }
            node.tipIb = tipIb;
        }
        for (const child of root.children.values()) {
            collapseUnaryFolders(child);
        }
        return root;
    };

    const registerPlugin = (def = {}) => {
        const id = String(def.id || "").trim();
        if (!id) throw new Error("[tinyviewport_manager] plugin requires id");
        // Replace if already present (reindex / remount companions).
        if (plugins.has(id)) plugins.delete(id);
        const entry = {
            id,
            label: String(def.label || id),
            description: String(def.description || ""),
            enabledByDefault: def.enabledByDefault !== false,
            legend: Array.isArray(def.legend) ? def.legend : [],
            layout: normalizePluginLayout(def.layout, id),
            contribute:
                typeof def.contribute === "function" ? def.contribute : null,
            styleNode:
                typeof def.styleNode === "function" ? def.styleNode : null,
            overlayNode:
                typeof def.overlayNode === "function" ? def.overlayNode : null,
            contributeSidebar:
                typeof def.contributeSidebar === "function"
                    ? def.contributeSidebar
                    : null,
            styleListRow:
                typeof def.styleListRow === "function"
                    ? def.styleListRow
                    : null,
            prefsChrome:
                typeof def.prefsChrome === "function" ? def.prefsChrome : null,
            /** Chrome-only: always on, hidden from legend plugin checkboxes. */
            chromeOnly: !!def.chromeOnly,
            source: def.source || "plugin",
        };
        plugins.set(id, entry);
        notify();
        return () => unregisterPlugin(id);
    };

    const normalizePluginLayout = (raw, pluginId) => {
        if (!raw || typeof raw !== "object") return null;
        const bands = Array.isArray(raw.bands)
            ? raw.bands.map((b) => String(b || "").trim()).filter(Boolean)
            : [];
        if (!bands.length) return null;
        return {
            prefix: String(raw.prefix || pluginId || "plugin").trim() || "plugin",
            bands,
            rev: String(raw.rev != null ? raw.rev : "1"),
        };
    };

    /**
     * Enabled plugins that declare a band layout (register order).
     * Fragment lays rows from this plan — no plugin-specific hardcoding.
     */
    const getLayoutPlan = async () => {
        const prefs = await loadPrefs();
        const plans = [];
        for (const p of plugins.values()) {
            if (!isPluginEnabled(p.id, prefs) || !p.layout) continue;
            plans.push({
                pluginId: p.id,
                prefix: p.layout.prefix,
                bands: [...p.layout.bands],
                rev: p.layout.rev,
            });
        }
        return plans;
    };

    const unregisterPlugin = (id) => {
        const key = String(id || "").trim();
        if (!plugins.has(key)) return false;
        plugins.delete(key);
        notify();
        return true;
    };

    const listPlugins = (opts = {}) => {
        const includeChrome = !!opts.includeChrome;
        return [...plugins.values()]
            .filter((p) => includeChrome || !p.chromeOnly)
            .map((p) => ({
                id: p.id,
                label: p.label,
                description: p.description,
                enabledByDefault: p.enabledByDefault,
                legend: p.legend,
                chromeOnly: !!p.chromeOnly,
                layout: p.layout
                    ? {
                          prefix: p.layout.prefix,
                          bands: [...p.layout.bands],
                          rev: p.layout.rev,
                      }
                    : null,
                source: p.source,
            }));
    };

    /** List + graph prefs chrome (always present; not a legend plugin). */
    const buildListPrefsChrome = (ctx = {}) => {
        if (typeof document === "undefined") return null;
        const prefs = ctx.prefs || DEFAULT_PREFS;
        const wrap = document.createElement("div");
        wrap.setAttribute("data-part", "list-style-prefs");
        wrap.style.cssText =
            "font:11px/1.35 monospace;display:flex;flex-direction:column;gap:6px;margin:0.35rem 0;";

        const section = (title) => {
            const box = document.createElement("div");
            box.setAttribute("data-part", `prefs-section-${title}`);
            box.style.cssText = "display:block;";
            const head = document.createElement("div");
            head.setAttribute("data-part", "prefs-section-head");
            head.textContent = title;
            head.style.cssText =
                "font:11px/1.2 monospace;font-weight:700;letter-spacing:0.04em;opacity:0.85;margin:0 0 3px 0;";
            box.appendChild(head);
            const row = document.createElement("div");
            row.style.cssText =
                "display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;";
            box.appendChild(row);
            return { box, row };
        };

        const addColor = (row, key, label, title, value) => {
            if (label) row.appendChild(document.createTextNode(label + " "));
            const inp = document.createElement("input");
            inp.type = "color";
            inp.setAttribute("data-part", `pref-${key}`);
            inp.setAttribute("data-prefs-key", key);
            inp.title = title;
            inp.value = value || "#000000";
            row.appendChild(inp);
        };

        const list = section("list");
        const nestLab = document.createElement("label");
        nestLab.style.cssText = "cursor:pointer;font:inherit;";
        nestLab.title =
            "Delimiter-nest tip list by path segments; omit active prefix from labels; unary folders collapse with true delimiters";
        const nestCb = document.createElement("input");
        nestCb.type = "checkbox";
        nestCb.setAttribute("data-part", "pref-nesting");
        nestCb.checked = !!prefs.nesting;
        nestLab.appendChild(nestCb);
        nestLab.appendChild(document.createTextNode(" delimiter-nest"));
        list.row.appendChild(nestLab);
        list.row.appendChild(document.createTextNode(" · "));
        addColor(
            list.row,
            "border",
            "border",
            "list border color",
            prefs.border || "#c0c0c0"
        );
        addColor(
            list.row,
            "hostpark",
            "hostpark",
            "hostpark mirrored border",
            prefs.hostpark || "#8e44ad"
        );
        addColor(
            list.row,
            "text",
            "text",
            "list text color",
            prefs.text || "#111111"
        );
        addColor(
            list.row,
            "bg",
            "bg",
            "list background",
            prefs.bg || "#ffffff"
        );
        wrap.appendChild(list.box);

        const graph = section("graph");
        graph.row.appendChild(document.createTextNode("node "));
        addColor(
            graph.row,
            "node-fill",
            "",
            "node fill",
            prefs.node?.fill || "#000000"
        );
        addColor(
            graph.row,
            "node-text",
            "",
            "node text",
            prefs.node?.text || "#ffffff"
        );
        addColor(
            graph.row,
            "node-stroke",
            "",
            "node stroke",
            prefs.node?.stroke || "#000000"
        );
        const lab = document.createElement("label");
        lab.style.cssText =
            "margin-left:0.5rem;cursor:pointer;font:inherit;";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.setAttribute("data-part", "pref-preview-overlay");
        cb.checked = prefs.previewOverlay !== false;
        lab.appendChild(cb);
        lab.appendChild(document.createTextNode(" preview overlay"));
        graph.row.appendChild(lab);
        wrap.appendChild(graph.box);

        return wrap;
    };

    /**
     * Ask already-mounted companion mods to (re)attach.
     * Companions expose `attachTinyviewportPlugin()` (e.g. flowchart).
     * Registry is in-memory only — prefs only store on/off overrides.
     */
    const reindexPlugins = () => {
        const bag = navi?.mod || globalThis?.navi?.mod || {};
        const attached = [];
        const failed = [];
        for (const [name, mod] of Object.entries(bag)) {
            if (!mod || name === "tinyviewport_manager") continue;
            if (typeof mod.attachTinyviewportPlugin !== "function") continue;
            try {
                const ok = mod.attachTinyviewportPlugin();
                if (ok) attached.push(name);
                else failed.push(name);
            } catch (err) {
                failed.push(name);
                console.warn(
                    `[tinyviewport_manager] reindex ${name} failed`,
                    err
                );
            }
        }
        return { attached, failed, plugins: [...plugins.keys()] };
    };

    /**
     * Preference stack for a node (enabled plugins, register order):
     *   defaults → kind strokes → each plugin.styleNode overlay.
     * When a plugin is disabled, its claim drops and the previous enabled
     * claim remains (lineage is the base: black square + n).
     */
    const resolveNodeStyle = async (node, frame, base = {}) => {
        const prefs = await loadPrefs();
        const n = prefs.node || DEFAULT_PREFS.node;
        let style = {
            fill: n.fill,
            text: n.text,
            stroke: n.stroke,
            opacity: 1,
            ...base,
        };
        const kind = String(node?.kind || "");
        if (kind === "tip") style.stroke = n.strokeTip;
        else if (kind === "cascade") style.stroke = n.strokeCascade;
        else if (kind === "leaf" || node?.row === "orphan")
            style.stroke = n.strokeOrphan;
        else if (node?.stub) style.stroke = n.strokeStub;

        for (const p of plugins.values()) {
            if (!isPluginEnabled(p.id, prefs) || !p.styleNode) continue;
            try {
                const patch = p.styleNode(node, frame, { ...style });
                if (patch && typeof patch === "object") {
                    style = { ...style, ...patch };
                    // Drop size/flair when a later claim sets them null explicitly
                    if (patch.width == null && "width" in patch) delete style.width;
                    if (patch.height == null && "height" in patch) delete style.height;
                    if (patch.flair == null && "flair" in patch) delete style.flair;
                }
            } catch (err) {
                console.error(
                    `[tinyviewport_manager] styleNode failed (${p.id})`,
                    err
                );
            }
        }
        return style;
    };

    /**
     * Enabled plugins may contribute actions for the node selection overlay
     * (preview float). Register order; each plugin may return multiple actions.
     */
    const resolveNodeOverlay = async (node, frame) => {
        const prefs = await loadPrefs();
        const out = { actions: [], scrub: null };
        const ctx = { navi, prefs, node, frame };
        for (const p of plugins.values()) {
            if (!isPluginEnabled(p.id, prefs) || !p.overlayNode) continue;
            try {
                let hit = p.overlayNode(node, frame, ctx);
                if (hit && typeof hit.then === "function") hit = await hit;
                const actions = hit?.actions;
                if (Array.isArray(actions) && actions.length) {
                    for (const a of actions) {
                        const id = String(a?.id || "").trim();
                        const label = String(a?.label || id || "action").trim();
                        if (!id && !label) continue;
                        out.actions.push({
                            id: id || `${p.id}:${out.actions.length}`,
                            label,
                            title: a?.title != null ? String(a.title) : "",
                            href: a?.href != null ? String(a.href) : "",
                            run: typeof a?.run === "function" ? a.run : null,
                            plugin: p.id,
                        });
                    }
                }
                if (!out.scrub && hit?.scrub && typeof hit.scrub === "object") {
                    out.scrub = { ...hit.scrub, plugin: p.id };
                }
            } catch (err) {
                console.error(
                    `[tinyviewport_manager] overlayNode failed (${p.id})`,
                    err
                );
            }
        }
        return out;
    };

    /**
     * Enabled plugins contribute sidebar action/folder nodes (register order).
     * ctx: { ibs, tipApi, getFrame, navi, prefs, prefix }
     */
    const collectSidebar = async (ctx = {}) => {
        const prefs = await loadPrefs();
        const nodes = [];
        const fullCtx = {
            tipApi,
            itemApi,
            getFrame,
            navi,
            prefs,
            ibs: Array.isArray(ctx.ibs) ? ctx.ibs : [],
            prefix: String(ctx.prefix || ""),
            ...ctx,
        };
        for (const p of plugins.values()) {
            if (!isPluginEnabled(p.id, prefs) || !p.contributeSidebar) continue;
            try {
                let hit = p.contributeSidebar(fullCtx);
                if (hit && typeof hit.then === "function") hit = await hit;
                const list = hit?.nodes;
                if (!Array.isArray(list)) continue;
                for (const n of list) {
                    const id = String(n?.id || "").trim();
                    const label = String(n?.label || id || "").trim();
                    if (!id && !label) continue;
                    nodes.push({
                        id: id || `${p.id}:${nodes.length}`,
                        underPath:
                            n?.underPath != null ? String(n.underPath) : "",
                        underIb: n?.underIb != null ? String(n.underIb) : "",
                        label,
                        kind: String(n?.kind || "action"),
                        title: n?.title != null ? String(n.title) : "",
                        order: Number.isFinite(Number(n?.order))
                            ? Number(n.order)
                            : 0,
                        run: typeof n?.run === "function" ? n.run : null,
                        href: n?.href != null ? String(n.href) : "",
                        plugin: p.id,
                    });
                }
            } catch (err) {
                console.error(
                    `[tinyviewport_manager] contributeSidebar failed (${p.id})`,
                    err
                );
            }
        }
        nodes.sort((a, b) => {
            if (a.order !== b.order) return a.order - b.order;
            return String(a.label).localeCompare(String(b.label));
        });
        return { nodes };
    };

    const resolveListRowStyle = async (row, base = {}) => {
        const prefs = await loadPrefs();
        let style = {
            border: prefs.border || DEFAULT_PREFS.border,
            text: prefs.text || DEFAULT_PREFS.text,
            bg: prefs.bg || DEFAULT_PREFS.bg,
            hostpark: prefs.hostpark || DEFAULT_PREFS.hostpark,
            ...base,
        };
        for (const p of plugins.values()) {
            if (!isPluginEnabled(p.id, prefs) || !p.styleListRow) continue;
            try {
                const patch = p.styleListRow(row, { ...style });
                if (patch && typeof patch === "object") {
                    style = { ...style, ...patch };
                }
            } catch (err) {
                console.error(
                    `[tinyviewport_manager] styleListRow failed (${p.id})`,
                    err
                );
            }
        }
        return style;
    };

    /** Collect prefs chrome: always nesting/colors, then enabled plugin chrome. */
    const collectPrefsChrome = async (ctx = {}) => {
        const prefs = await loadPrefs();
        const els = [];
        const fullCtx = { navi, prefs, tipApi, itemApi, ...ctx };
        try {
            const base = buildListPrefsChrome(fullCtx);
            if (base && base.nodeType === 1) {
                base.setAttribute("data-prefs-plugin", "list_prefs");
                els.push(base);
            }
        } catch (err) {
            console.error("[tinyviewport_manager] list prefs chrome failed", err);
        }
        for (const p of plugins.values()) {
            if (p.chromeOnly) continue;
            if (!isPluginEnabled(p.id, prefs) || !p.prefsChrome) continue;
            try {
                let el = p.prefsChrome(fullCtx);
                if (el && typeof el.then === "function") el = await el;
                if (el && el.nodeType === 1) {
                    el.setAttribute("data-prefs-plugin", p.id);
                    els.push(el);
                }
            } catch (err) {
                console.error(
                    `[tinyviewport_manager] prefsChrome failed (${p.id})`,
                    err
                );
            }
        }
        return els;
    };

    /**
     * Stable key for one open graph view.
     * mode + scope (prefix or ib) + sorted enabled plugin ids — any plugin
     * combo that changes the graph gets its own offset bag.
     */
    const buildViewKey = async (opts = {}) => {
        const mode = opts.prefixView ? "mass" : "iso";
        const scope = String(opts.scope ?? opts.prefix ?? opts.ib ?? "*")
            .trim()
            .replace(/\|/g, "/") || "*";
        const prefs = await loadPrefs();
        const enabled = [...plugins.values()]
            .filter((p) => isPluginEnabled(p.id, prefs))
            .map((p) => p.id)
            .sort((a, b) => String(a).localeCompare(String(b)));
        return `${mode}:${scope}|p:${enabled.join(",") || "-"}`;
    };

    /** Offsets for one view key (identical views share this bag). */
    const getViewOffsets = async (viewKey) => {
        const key = String(viewKey || "").trim();
        if (!key) return {};
        const prefs = await loadPrefs();
        const bag = prefs.viewOffsets?.[key];
        return bag && typeof bag === "object" ? { ...bag } : {};
    };

    const getNodeOffset = async (addr, opts = {}) => {
        const key = String(opts.viewKey || "").trim();
        if (!key) return { dx: 0, dy: 0 };
        const bag = await getViewOffsets(key);
        const o = bag[String(addr || "")];
        if (!o || typeof o !== "object") return { dx: 0, dy: 0 };
        return { dx: Number(o.dx) || 0, dy: Number(o.dy) || 0 };
    };

    const setNodeOffset = async (addr, { dx, dy } = {}, opts = {}) => {
        const a = String(addr || "").trim();
        const viewKey = String(opts.viewKey || "").trim();
        if (!a || !viewKey) return;
        const prefs = await loadPrefs();
        const viewOffsets = { ...(prefs.viewOffsets || {}) };
        const bag = { ...(viewOffsets[viewKey] || {}) };
        const x = Number(dx) || 0;
        const y = Number(dy) || 0;
        if (!x && !y) delete bag[a];
        else bag[a] = { dx: x, dy: y };
        if (!Object.keys(bag).length) delete viewOffsets[viewKey];
        else viewOffsets[viewKey] = bag;
        prefsCache = { ...prefs, viewOffsets };
        offsetSavePending = { viewKey, bag: { ...bag } };
        if (offsetSaveTimer) clearTimeout(offsetSaveTimer);
        offsetSaveTimer = setTimeout(() => {
            void flushOffsetSave();
        }, 400);
    };

    /** Drop flat legacy bags (iso/mass). Keeps viewOffsets. */
    const clearLegacyOffsets = async () => {
        try {
            const prefs = await loadPrefs();
            const nIso = Object.keys(prefs.offsets || {}).length;
            const nMass = Object.keys(prefs.offsetsMass || {}).length;
            if (!nIso && !nMass) return;
            await savePrefs(
                { ...prefs, offsets: {}, offsetsMass: {} },
                { silent: true }
            );
        } catch {
            /* ignore */
        }
    };

    /** Lineage base claim: black (prefs.node) square labeled with chain position
     *  (oldest = 0); foreign rows (other ib than the tip being viewed) paint grey. */
    const lineageStyleNode = (node, frame, styleSoFar = {}) => {
        const n = node?.seq != null ? node.seq : null;
        const foreign =
            node?.row === "foreign" ||
            String(node?.row || "").startsWith("foreign");
        const face = foreign
            ? "#888888"
            : styleSoFar.fill || DEFAULT_PREFS.node.fill;
        const stroke = foreign
            ? "#888888"
            : styleSoFar.stroke || DEFAULT_PREFS.node.stroke;
        return {
            fill: face,
            text: styleSoFar.text || DEFAULT_PREFS.node.text,
            stroke,
            label: n != null ? String(n) : node?.stub ? "?" : "·",
            // Clear any prior size/flair so default square wins when we are top claim
            width: null,
            height: null,
            flair: null,
        };
    };

    /**
     * Merge enabled plugin contributions for one open tip ib.
     * Returns { nodes: Map, edges: [], legend: [], sources: string[] }
     */
    const collectGraph = async (baseIb, opts = {}) => {
        const base = String(baseIb || "").trim();
        const prefs = await loadPrefs();
        const viewIbs = Array.isArray(opts.viewIbs)
            ? new Set(opts.viewIbs.map((x) => String(x || "").trim()).filter(Boolean))
            : null;
        const nodes = new Map();
        const edges = [];
        const edgeKey = new Set();
        const legend = [];
        const sources = [];

        const addNode = (raw, patch = {}) => {
            const addr = String(raw?.addr || raw || "").trim();
            if (!addr) return null;
            const prev = nodes.get(addr) || {
                addr,
                ib: splitAddr(addr).ib,
                frame: null,
                stub: true,
                kind: "frame",
                seq: null,
                row: "main",
                source: "unknown",
            };
            const next = {
                ...prev,
                ...(typeof raw === "object" ? raw : {}),
                ...patch,
                addr,
            };
            if (next.frame) {
                next.stub = false;
                next.ib = String(next.frame.ib || next.ib || splitAddr(addr).ib);
                if (isCascadeFrame(next.frame)) next.kind = "cascade";
            }
            nodes.set(addr, next);
            return next;
        };

        const addEdge = (e) => {
            const from = String(e?.from || "").trim();
            const to = String(e?.to || "").trim();
            const rel = String(e?.rel || "rel");
            if (!from || !to || from === to) return;
            const k = `${from}|${to}|${rel}|${e?.source || ""}`;
            if (edgeKey.has(k)) return;
            edgeKey.add(k);
            const edge = {
                from,
                to,
                rel,
                color: e.color || prefs.edge?.other || DEFAULT_PREFS.edge.other,
                source: e.source || "plugin",
            };
            if (e.dash) edge.dash = String(e.dash);
            edges.push(edge);
            addNode(from, { source: e.source || "plugin" });
            addNode(to, { source: e.source || "plugin" });
        };

        const ctx = {
            baseIb: base,
            navi,
            tipApi,
            itemApi,
            getFrame,
            looksLikeAddr,
            splitAddr,
            frameAddr,
            isCascadeFrame,
            prefs,
            viewIbs,
        };

        for (const p of plugins.values()) {
            if (!isPluginEnabled(p.id, prefs)) continue;
            sources.push(p.id);
            for (const L of p.legend || []) {
                legend.push({ ...L, plugin: p.id });
            }
            if (!p.contribute) continue;
            try {
                const contrib = await p.contribute(ctx);
                if (!contrib || typeof contrib !== "object") continue;
                for (const n of contrib.nodes || []) {
                    addNode(n, { source: n.source || p.id });
                }
                for (const e of contrib.edges || []) {
                    addEdge({ ...e, source: e.source || p.id });
                }
                // Allow contribute() to declare/override band layout for this pass.
                if (contrib.layout) {
                    const L = normalizePluginLayout(contrib.layout, p.id);
                    if (L) {
                        p.layout = L;
                    }
                }
            } catch (err) {
                console.error(
                    `[tinyviewport_manager] contribute failed (${p.id})`,
                    err
                );
            }
        }

        // Resolve stubs
        for (const [addr, node] of [...nodes.entries()]) {
            if (!node.stub && node.frame) continue;
            const f = await getFrame(addr);
            if (f) {
                addNode(addr, { frame: f, stub: false });
            }
        }
        for (const [addr, node] of [...nodes.entries()]) {
            if (node.stub || !node.frame) nodes.delete(addr);
        }
        for (let i = edges.length - 1; i >= 0; i--) {
            const e = edges[i];
            if (!nodes.has(e.from) || !nodes.has(e.to)) edges.splice(i, 1);
        }

        return { base, nodes, edges, legend, sources, prefs, layout: await getLayoutPlan() };
    };

    // ─── Built-in: lineage (same-ib past / cascade / other rel8ns) ─────────

    const lineageContribute = async (ctx) => {
        const base = ctx.baseIb;
        const prefs = ctx.prefs || DEFAULT_PREFS;
        const EDGE = { ...DEFAULT_PREFS.edge, ...(prefs.edge || {}) };
        const nodes = [];
        const edges = [];
        const seenN = new Set();
        const seenE = new Set();

        const pushNode = (addr, patch = {}) => {
            const a = String(addr || "").trim();
            if (!a || seenN.has(a)) {
                if (a && patch.frame) {
                    const i = nodes.findIndex((n) => n.addr === a);
                    if (i >= 0) nodes[i] = { ...nodes[i], ...patch, addr: a };
                }
                return;
            }
            seenN.add(a);
            nodes.push({
                addr: a,
                ib: ctx.splitAddr(a).ib,
                stub: !patch.frame,
                kind: "frame",
                row: "main",
                source: "lineage",
                ...patch,
            });
        };

        const pushEdge = (from, to, rel) => {
            const f = String(from || "").trim();
            const t = String(to || "").trim();
            if (!f || !t || f === t) return;
            const k = `${f}|${t}|${rel}`;
            if (seenE.has(k)) return;
            seenE.add(k);
            let color = EDGE.other;
            if (rel === "past") color = EDGE.past;
            else if (
                rel === "cascade_of" ||
                rel === "mutation_of" ||
                rel === "htmf_ibgib"
            ) {
                color = EDGE.cascade;
            }
            edges.push({ from: f, to: t, rel, color, source: "lineage" });
            pushNode(f, { source: "lineage" });
            pushNode(t, { source: "lineage" });
        };

        const collectRelEdges = (addr, frame) => {
            if (!frame?.rel8ns || typeof frame.rel8ns !== "object") return;
            for (const [rel, vals] of Object.entries(frame.rel8ns)) {
                if (rel === "bin" || rel === "dna" || rel === "tjp") continue;
                const list = Array.isArray(vals) ? vals : [];
                for (const v of list) {
                    if (ctx.looksLikeAddr(v)) pushEdge(addr, String(v), rel);
                }
            }
            const htmf = frame?.data?.htmf_ibgib;
            if (htmf && ctx.looksLikeAddr(htmf)) {
                pushEdge(addr, String(htmf), "htmf_ibgib");
            }
        };

        let tip = null;
        try {
            tip = await ctx.tipApi().get(base);
        } catch {
            tip = null;
        }
        if (!tip || typeof tip !== "object") {
            return { nodes, edges };
        }
        const tipAddr = ctx.frameAddr(tip);
        const frameMap = new Map();
        if (tipAddr) frameMap.set(tipAddr, tip);

        try {
            const listed = ((await ctx.tipApi().frame?.list?.(base)) || []).map(
                String
            );
            for (const addr of listed) {
                if (!addr || frameMap.has(addr)) continue;
                const f = await ctx.getFrame(addr);
                if (f) frameMap.set(addr, f);
            }
        } catch {
            /* optional */
        }

        let cur = tip;
        let guard = 0;
        while (cur && guard++ < 64) {
            const past =
                Array.isArray(cur.rel8ns?.past) && cur.rel8ns.past[0]
                    ? String(cur.rel8ns.past[0])
                    : "";
            if (!past || frameMap.has(past)) break;
            const f = await ctx.getFrame(past);
            if (!f) break;
            frameMap.set(past, f);
            cur = f;
        }

        const chain = [];
        for (let f = tip, g = 0; f && g < 512; g++) {
            const a = g === 0 ? tipAddr : ctx.frameAddr(f);
            if (!a || chain.includes(a)) break;
            chain.push(a);
            const past =
                Array.isArray(f.rel8ns?.past) && f.rel8ns.past[0]
                    ? String(f.rel8ns.past[0])
                    : "";
            f = past ? frameMap.get(past) : null;
        }
        chain.reverse();
        const seqOf = new Map(chain.map((a, i) => [a, i]));
        const frameOf = (a) =>
            frameMap.get(a) || nodes.find((n) => n.addr === a)?.frame || null;
        const stampOf = (a) => {
            const t = Date.parse(frameOf(a)?.data?.timestamp);
            return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
        };
        const byOrder = (a, b) => {
            const sa = seqOf.get(a);
            const sb = seqOf.get(b);
            if (sa != null && sb != null) return sa - sb;
            const ta = stampOf(a);
            const tb = stampOf(b);
            if (ta !== tb) return ta - tb;
            return String(a).localeCompare(String(b));
        };
        const addrs = [...frameMap.keys()].sort(byOrder);

        for (const addr of addrs) {
            const frame = frameMap.get(addr);
            pushNode(addr, {
                frame,
                seq: seqOf.get(addr),
                stub: false,
                kind:
                    addr === tipAddr
                        ? "tip"
                        : ctx.isCascadeFrame(frame)
                          ? "cascade"
                          : "main",
                row: "main",
                source: "lineage",
            });
            if (frame) collectRelEdges(addr, frame);
        }

        // Same-ib frames from global frame list
        try {
            const frameKeys = ((await ctx.tipApi().frame?.list?.()) || []).map(
                String
            );
            for (const addr of frameKeys) {
                if (ctx.splitAddr(addr).ib !== base) continue;
                if (seenN.has(addr)) continue;
                const frame = await ctx.getFrame(addr);
                if (!frame) continue;
                pushNode(addr, {
                    frame,
                    stub: false,
                    kind: ctx.isCascadeFrame(frame) ? "cascade" : "frame",
                    row: ctx.isCascadeFrame(frame) ? "orphan" : "main",
                    source: "lineage",
                });
                collectRelEdges(addr, frame);
            }
        } catch {
            /* optional */
        }

        // Lineage row split by live past connectivity (same-ib only)
        const sameIb = nodes
            .filter((n) => String(n.ib || "") === base)
            .map((n) => n.addr);
        const set = new Set(sameIb);
        const adj = new Map();
        for (const a of sameIb) adj.set(a, new Set());
        for (const e of edges) {
            if (e.rel !== "past") continue;
            if (!set.has(e.from) || !set.has(e.to)) continue;
            adj.get(e.from).add(e.to);
            adj.get(e.to).add(e.from);
        }
        const seen = new Set();
        const comps = [];
        for (const start of sameIb.slice().sort(byOrder)) {
            if (seen.has(start)) continue;
            const stack = [start];
            const comp = [];
            seen.add(start);
            while (stack.length) {
                const x = stack.pop();
                comp.push(x);
                for (const y of adj.get(x) || []) {
                    if (seen.has(y)) continue;
                    seen.add(y);
                    stack.push(y);
                }
            }
            comp.sort(byOrder);
            comps.push(comp);
        }
        comps.sort((a, b) => byOrder(a[0], b[0]));
        comps.forEach((line, i) => {
            const rowKey = i === 0 ? "main" : `lineage:${i}`;
            for (const a of line) {
                const n = nodes.find((x) => x.addr === a);
                if (n) n.row = rowKey;
            }
        });

        // Cross-ib targets from rel8ns stay as foreign nodes (plugins may add more)
        for (const n of nodes) {
            if (String(n.ib || "") !== base && !n.row?.startsWith?.("foreign")) {
                n.row = n.row === "orphan" ? "orphan" : "foreign";
            }
        }

        return { nodes, edges };
    };

    // ─── Built-in: htmf_href (off by default) — bin HTML → hyperlink edges ─

    const HREF_RE =
        /(?:hx-get|href)\s*=\s*["']([^"']+)["']/gi;

    const hrefToParkIb = (raw) => {
        let p = String(raw || "").trim();
        if (!p || p.startsWith("#") || p.startsWith("javascript:")) return null;
        if (/^https?:\/\//i.test(p)) return null;
        p = p.replace(/^\/+/, "").replace(/^navi[/:]/, "");
        if (p.startsWith("htmf:")) p = p.slice("htmf:".length);
        p = p.replace(/\\/g, "/").replace(/\/+$/, "");
        return p || null;
    };

    const parkIbCandidates = (park) => {
        const p = String(park || "").trim();
        if (!p) return [];
        const out = [p];
        if (p.endsWith(".html")) {
            const bare = p.slice(0, -".html".length);
            if (bare && !out.includes(bare)) out.push(bare);
        } else {
            const withHtml = `${p}.html`;
            if (!out.includes(withHtml)) out.push(withHtml);
        }
        return out;
    };

    const htmfHrefContribute = async (ctx) => {
        const base = ctx.baseIb;
        const nodes = [];
        const edges = [];
        const tip = ctx.tipApi();
        const viewSet = ctx.viewIbs;
        let tipFrame = null;
        try {
            tipFrame = await tip.get(base);
        } catch {
            tipFrame = null;
        }
        if (!tipFrame) return { nodes, edges };

        const addrs = new Set();
        const tipA = ctx.frameAddr(tipFrame);
        if (tipA) addrs.add(tipA);
        try {
            for (const a of (await tip.frame?.list?.(base)) || []) {
                addrs.add(String(a));
            }
        } catch {
            /* optional */
        }

        const resolveTarget = async (rawHref) => {
            const park = hrefToParkIb(rawHref);
            if (!park) return null;
            for (const ib of parkIbCandidates(park)) {
                if (viewSet && !viewSet.has(ib)) continue;
                try {
                    const targetTip = await tip.get(ib);
                    if (!targetTip) continue;
                    const toAddr = ctx.frameAddr(targetTip);
                    if (!toAddr) continue;
                    return { ib, targetTip, toAddr };
                } catch {
                    /* try next candidate */
                }
            }
            return null;
        };

        for (const addr of addrs) {
            const frame = await ctx.getFrame(addr);
            if (!frame) continue;
            const ref = Array.isArray(frame.rel8ns?.bin)
                ? frame.rel8ns.bin[0]
                : null;
            const sha = String(ref || "")
                .trim()
                .match(/^bin\s+([0-9a-fA-F]+)$/)?.[1]
                ?.toLowerCase();
            let html = frame.data?.html != null ? String(frame.data.html) : "";
            if (sha && navi.storage?.bin?.get) {
                try {
                    const bin = await navi.storage.bin.get(sha);
                    if (bin?.media != null) html = String(bin.media);
                } catch {
                    /* keep data.html */
                }
            }
            if (!html) continue;
            HREF_RE.lastIndex = 0;
            let m;
            const seenTargets = new Set();
            while ((m = HREF_RE.exec(html))) {
                const hit = await resolveTarget(m[1]);
                if (!hit || seenTargets.has(hit.toAddr)) continue;
                seenTargets.add(hit.toAddr);
                if (hit.toAddr === addr) continue;
                edges.push({
                    from: addr,
                    to: hit.toAddr,
                    rel: "htmf_href",
                    color: "#e67e22",
                    source: "htmf_href",
                });
                nodes.push({
                    addr: hit.toAddr,
                    ib: hit.ib,
                    frame: hit.targetTip,
                    stub: false,
                    kind: "tip",
                    row: "foreign",
                    source: "htmf_href",
                });
            }
        }
        return { nodes, edges };
    };

    const registerBuiltins = () => {
        registerMode({
            id: "sidebar_v1",
            label: "sidebar v1",
            description:
                "Nested tip index by path segments; no lineage graphs under rows.",
            enabledByDefault: true,
            kind: "index",
            source: "builtin",
        });
        registerMode({
            id: "graph_v1",
            label: "graph v1",
            description:
                "Prefix/mass and tip iso lineage graphs (classic tinyviewport view).",
            enabledByDefault: true,
            kind: "view",
            source: "builtin",
        });

        // Nesting + colors chrome is always via collectPrefsChrome (not a
        // legend plugin). Tip methods = tinyviewport_tip_verbs companion.

        if (!plugins.has("lineage")) {
            registerPlugin({
                id: "lineage",
                label: "lineage (past / cascade / rel8n)",
                description:
                    "Same-ib mutation ancestry plus rel8n edges (past, cascade, other).",
                enabledByDefault: true,
                source: "builtin",
                legend: [
                    { id: "tip", label: "tip", color: "#4a90d9" },
                    { id: "past", label: "past", color: "#888888" },
                    {
                        id: "cascade",
                        label: "cascade / mutation_of",
                        color: "#2ecc71",
                    },
                    { id: "other", label: "other rel8n", color: "#c0392b" },
                    { id: "foreign", label: "other ib", color: "#888888" },
                    { id: "orphan", label: "orphan", color: "#9b59b6" },
                ],
                contribute: lineageContribute,
                styleNode: lineageStyleNode,
            });
        }
        if (!plugins.has("htmf_href")) {
            registerPlugin({
                id: "htmf_href",
                label: "htmf hyperlinks",
                description:
                    "Scan tip/frame HTML (bin or data.html) for href/hx-get → other park tips in the current view.",
                enabledByDefault: false,
                source: "builtin",
                legend: [
                    {
                        id: "htmf_href",
                        label: "htmf href",
                        color: "#e67e22",
                    },
                ],
                contribute: htmfHrefContribute,
            });
        }

        // tip_verbs lives in companion tinyviewport_tip_verbs.js (nesting
        // contributeSidebar), same pattern as tinyviewport_flowchart.
    };

    const run = async (...args) => {
        const [cmd, a, b] = args.map((x) => String(x ?? "").trim());
        if (!cmd || cmd === "help") {
            return [
                `tinyviewport_manager v${VERSION}`,
                "",
                "  status",
                "  modes",
                "  mode <id>           — set active presentation mode",
                "  mode on|off <id>    — enable/disable a mode in the picker",
                "  plugins",
                "  plugins reindex — re-attach companions already in navi.mod",
                "  plugin on|off <id>",
                "  preview overlay|inline",
                "  offsets clear [addr-prefix]",
                "  prefs prune   — drop early prefs frames if >30 (keep root+tip)",
                "  prefs clear   — wipe prefs tip + reset defaults in memory",
                "",
                `Subject: ${WAREZ_SUBJECT}`,
                `Manifest: ${WAREZ_MANIFEST}`,
            ].join("\n");
        }
        if (cmd === "status") {
            const prefs = await loadPrefs();
            const active = await getActiveMode();
            const lines = [
                `tinyviewport_manager v${VERSION}`,
                `activeMode: ${active}`,
                "modes:",
            ];
            for (const m of modes.values()) {
                const on = isModeEnabled(m.id, prefs);
                lines.push(
                    `  ${on ? "on " : "off"} ${m.id}${m.id === active ? " *" : ""} — ${m.label}`
                );
            }
            lines.push("plugins:");
            for (const p of plugins.values()) {
                const on = isPluginEnabled(p.id, prefs);
                lines.push(`  ${on ? "on " : "off"} ${p.id} — ${p.label}`);
            }
            const nViews = Object.keys(prefs.viewOffsets || {}).length;
            lines.push(`view offset bags: ${nViews}`);
            lines.push(
                `preview: ${prefs.previewOverlay !== false ? "overlay" : "inline"}`
            );
            lines.push(`scale: ${Number(prefs.scale) || 100}%`);
            if (prefs.timelineAt) {
                lines.push(`timelineAt: ${prefs.timelineAt}`);
            }
            const n = prefs.node || DEFAULT_PREFS.node;
            lines.push(`node: fill ${n.fill} text ${n.text} stroke ${n.stroke}`);
            try {
                const tip = tipApi();
                const ib = prefsTipIb();
                const nFrames = ((await tip.frame?.list?.(ib)) || []).length;
                lines.push(`prefs frames: ${nFrames} (soft max ${PREFS_FRAME_SOFT_MAX})`);
            } catch {
                /* ignore */
            }
            return lines.join("\n");
        }
        if (cmd === "prefs") {
            const sub = String(a || "").toLowerCase();
            if (sub === "prune") {
                const r = await maybePrunePrefsFrames();
                return r.pruned
                    ? `pruned ${r.pruned} prefs frames (had ${r.total})`
                    : `no prune (prefs frames=${r.total}, soft max ${PREFS_FRAME_SOFT_MAX})`;
            }
            if (sub === "clear") {
                await clearPrefs();
                return "prefs cleared (defaults in memory; tip wiped)";
            }
            return "usage: tinyviewport_manager prefs prune|clear";
        }
        if (cmd === "modes") {
            const prefs = await loadPrefs();
            const active = await getActiveMode();
            const lines = [`activeMode: ${active}`];
            for (const m of modes.values()) {
                const on = isModeEnabled(m.id, prefs);
                lines.push(
                    `  ${on ? "on " : "off"} ${m.id}${m.id === active ? " *" : ""} — ${m.label}`
                );
            }
            return lines.join("\n");
        }
        if (cmd === "mode") {
            const sub = String(a || "").toLowerCase();
            if (sub === "on" || sub === "off") {
                const id = String(b || "").trim();
                if (!id || !modes.has(id)) return `unknown mode: ${b}`;
                const prefs = await loadPrefs();
                await savePrefs({
                    ...prefs,
                    modes: { ...(prefs.modes || {}), [id]: sub === "on" },
                });
                return `mode ${id} → ${sub}`;
            }
            const id = String(a || "").trim();
            if (!id) return "usage: tinyviewport_manager mode <id> | mode on|off <id>";
            try {
                const set = await setActiveMode(id);
                return `activeMode → ${set}`;
            } catch (err) {
                return String(err?.message || err);
            }
        }
        if (cmd === "plugins") {
            if (String(a || "").toLowerCase() === "reindex") {
                registerBuiltins();
                const r = reindexPlugins();
                return [
                    `reindexed — attached: ${r.attached.join(", ") || "(none)"}`,
                    r.failed.length
                        ? `failed/skipped: ${r.failed.join(", ")}`
                        : null,
                    `registry: ${r.plugins.join(", ")}`,
                ]
                    .filter(Boolean)
                    .join("\n");
            }
            const prefs = await loadPrefs();
            return listPlugins()
                .map((p) => {
                    const on = isPluginEnabled(p.id, prefs);
                    return `${on ? "[x]" : "[ ]"} ${p.id} — ${p.label}`;
                })
                .join("\n");
        }
        if (cmd === "plugin") {
            const mode = String(a || "").toLowerCase();
            const id = String(b || "").trim();
            if ((mode !== "on" && mode !== "off") || !id) {
                return "usage: tinyviewport_manager plugin on|off <id>";
            }
            if (!plugins.has(id)) return `unknown plugin: ${id}`;
            const prefs = await loadPrefs();
            await savePrefs({
                ...prefs,
                plugins: { ...(prefs.plugins || {}), [id]: mode === "on" },
            });
            return `plugin ${id} → ${mode}`;
        }
        if (cmd === "preview") {
            const mode = String(a || "").toLowerCase();
            if (mode !== "overlay" && mode !== "inline") {
                return "usage: tinyviewport_manager preview overlay|inline";
            }
            const prefs = await loadPrefs();
            await savePrefs({
                ...prefs,
                previewOverlay: mode === "overlay",
            });
            return `preview → ${mode}`;
        }
        if (cmd === "offsets" && a === "clear") {
            const prefs = await loadPrefs();
            const prefix = String(b || "").trim();
            if (!prefix) {
                await savePrefs({
                    ...prefs,
                    offsets: {},
                    offsetsMass: {},
                    viewOffsets: {},
                });
                return "cleared all node offsets (legacy + view bags)";
            }
            const viewOffsets = { ...(prefs.viewOffsets || {}) };
            for (const vk of Object.keys(viewOffsets)) {
                if (vk.startsWith(prefix) || vk.includes(prefix)) {
                    delete viewOffsets[vk];
                    continue;
                }
                const bag = { ...(viewOffsets[vk] || {}) };
                for (const addr of Object.keys(bag)) {
                    if (addr.startsWith(prefix)) delete bag[addr];
                }
                if (!Object.keys(bag).length) delete viewOffsets[vk];
                else viewOffsets[vk] = bag;
            }
            await savePrefs({
                ...prefs,
                offsets: {},
                offsetsMass: {},
                viewOffsets,
            });
            return `cleared view offsets matching ${prefix}`;
        }
        return `Unknown: ${cmd}. Type 'tinyviewport_manager help'.`;
    };

    return {
        name: "tinyviewport_manager",
        version: VERSION,
        description:
            "Plugin host for tinyviewport — connection sources + render preference stack",

        moduleInfo: {
            name: "tinyviewport_manager",
            version: VERSION,
            description:
                "Optional manager: plugins surface ibgib connections for tinyviewport",
        },

        warezSubject: WAREZ_SUBJECT,
        warezManifest: WAREZ_MANIFEST,

        registerPlugin,
        unregisterPlugin,
        listPlugins,
        reindexPlugins,
        registerMode,
        unregisterMode,
        listModes,
        getActiveMode,
        setActiveMode,
        isModeEnabled: async (id) =>
            isModeEnabled(id, await loadPrefs()),
        setModeEnabled: async (id, on) => {
            const prefs = await loadPrefs();
            await savePrefs({
                ...prefs,
                modes: { ...(prefs.modes || {}), [id]: !!on },
            });
        },
        segmentIb,
        ibUnderPrefix,
        foldIbsToTree,
        collectSidebar,
        resolveListRowStyle,
        collectPrefsChrome,
        getLayoutPlan,
        loadPrefs,
        savePrefs,
        clearPrefs,
        prunePrefsFrames: maybePrunePrefsFrames,
        patchPrefs,
        isPluginEnabled: async (id) =>
            isPluginEnabled(id, await loadPrefs()),
        setPluginEnabled: async (id, on) => {
            const prefs = await loadPrefs();
            await savePrefs({
                ...prefs,
                plugins: { ...(prefs.plugins || {}), [id]: !!on },
            });
        },
        getNodeOffset,
        setNodeOffset,
        getViewOffsets,
        buildViewKey,
        getPreviewOverlay: async () => {
            const prefs = await loadPrefs();
            return prefs.previewOverlay !== false;
        },
        setPreviewOverlay: async (on) => {
            const prefs = await loadPrefs();
            await savePrefs({ ...prefs, previewOverlay: !!on });
        },
        getScale: async () => {
            const prefs = await loadPrefs();
            const n = Number(prefs.scale);
            if (!Number.isFinite(n)) return DEFAULT_PREFS.scale;
            return Math.max(0, Math.min(200, Math.round(n)));
        },
        setScale: async (pct) => {
            const n = Number(pct);
            const scale = Number.isFinite(n)
                ? Math.max(0, Math.min(200, Math.round(n)))
                : DEFAULT_PREFS.scale;
            return patchPrefs({ scale });
        },
        resolveNodeStyle,
        resolveNodeOverlay,
        collectGraph,
        getFrame,
        onChange: (fn) => {
            if (typeof fn !== "function") return () => {};
            listeners.add(fn);
            return () => listeners.delete(fn);
        },

        commands: {
            tinyviewport_manager: {
                name: "tinyviewport_manager",
                description: "tinyviewport plugin host",
                execute: async (...args) => run(...args),
            },
        },

        onMount: async () => {
            registerBuiltins();
            const reidx = reindexPlugins();
            try {
                await loadPrefs();
                await clearLegacyOffsets();
            } catch {
                /* ignore */
            }
            if (typeof navi.callout === "function") {
                const active = await getActiveMode().catch(() => "?");
                navi.callout(
                    `[tinyviewport_manager] mounted — mode ${active}; plugins: ${[...plugins.keys()].join(", ")}` +
                        (reidx.attached.length
                            ? ` (reattached ${reidx.attached.join(", ")})`
                            : "")
                );
            }
        },

        onUnmount: async () => {
            listeners.clear();
            plugins.clear();
            modes.clear();
        },
    };
};
