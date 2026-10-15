// supermouse_plugin_stagejockey — pick stage occupants while holding right-click.
// Needs supermouse + stagedir. Settings live under dropdown → plugins → stagejockey ▸
// Formal top-level menu: dropdown → stagejockey ▸ →
//   [proscene | move on/off stage |] [plugin rows |] claims: * ▸ |
// stage-member add ▸
// `proscene` appears only when body has neither horizon/v1 nor jockeystage/v1;
// it builds jockeystage/v1 (same 3×3 as Horizon, spacers in empty zones) and
// moves body children into CS; stamps data-part=stage + data-path (from prior
// stage/htmf path when possible, else proscene-<16hex>).
// Idle righttap (dropdown): parks red+green select of the click target and
// exposes matching scrollbuffer claims under `claims: <leftmost-type>`.
//
// Nested elements: −1 "select children" on htm-element arms child pick
// (orchid nest colors). No settings toggle — claim-armed nest session only.
// Type fan-out always uses nesting layers when a child is picked.
//
// Scrollbuffer extensions may call registerScrollPlugin(def), or expose a
// module-level `scrollbufferPlugin` definition for pull discovery. A definition
// (or each entry in `claims`) has:
//   direction: 1|-1
//   types: string[] | "*"   — which context.types entries this claim binds to
//   matches(context, api): boolean
//   describe(context, api): string | { text, color, textShadow }
//   (textShadow optional — else stagejockey picks a contrast shadow from color)
//   execute(context, api): object | Promise<object> | undefined
// Claims matching leftmost context.types sit closer to 0; rightmost / universal
// (`*`) sit at higher |distance| from 0.
// After a successful claim, scrollbuffer returns to position 0. If the claim
// mutates the origin red-select object, call api.terminate() so the hold ends
// (same as releasing right-click).
//
// stage-member add claims (dropdown): expose `stageMemberAddPlugin` with
//   { id, claims: [{ id, label?, matches?(api), execute(api), activate?(row, menuApi, addApi) }] }
// or push via registerAddClaim(def). Built-ins: `upload:media` (file picker →
// navi.storage by path), then `path:media` (path → localpark → hostpark → cast → move).
// ("media" in those claim ids is a label only — keys are bare paths, not media:…).
//
// top-level stagejockey ▸ rows: expose `stagejockeyMenuPlugin` with
//   { id, items: [{ id, label, title?, matches?({ stage }), action({ pointer, stage }) }] }
// stage is { el, path } when the righttap is inside data-part=stage with a
// data-path, else null (menu closes before action runs; rows sit above "claims ▸").
// claims like ring-phonebook.

export const register = (navi) => {
    const isBrowser = typeof window !== "undefined" && typeof window.document !== "undefined";

    const PLUGIN_ID = "stagejockey";
    const SETTINGS_KEY = "supermouse_stagejockey_settings";
    const LIVE_KEY = "supermouse_stagejockey_live";
    /** navi.storage.item key: preferred path prefix for path:media input */
    const PREF_IX_KEY = "navi:pref:ix";
    const OLD_PREF_IX_KEY = "flowerpot/pref/ix";

    const SLOT_IDS = ["USL", "USC", "USR", "SL", "CS", "SR", "DSL", "DSC", "DSR"];
    const LEFT_SLOTS = new Set(["USL", "SL", "DSL"]);
    const zoneSlotOf = (el) => {
        if (!(el instanceof HTMLElement)) return null;
        const staged = navi?.mod?.stagedir?.stage;
        if (typeof staged?.zoneSlotOf === "function") {
            const k = staged.zoneSlotOf(el);
            if (k) return k;
        }
        const stamped = String(el.getAttribute?.("data-stage-slot") || "").trim();
        if (stamped) return stamped;
        return el.id && SLOT_IDS.includes(el.id) ? el.id : null;
    };
    const isLeftZone = (slot) => {
        if (LEFT_SLOTS.has(slot)) return true;
        const last = String(slot || "").split("/").pop();
        return last === "L" || last === "UL" || last === "DL";
    };
    const zoneColumns = () => {
        if (!isBrowser) return [];
        const seen = new Set();
        const out = [];
        for (const el of document.querySelectorAll("[data-stage-slot]")) {
            if (!(el instanceof HTMLElement) || seen.has(el)) continue;
            seen.add(el);
            out.push(el);
        }
        for (const id of SLOT_IDS) {
            const el = document.getElementById(id);
            if (el instanceof HTMLElement && !seen.has(el)) {
                seen.add(el);
                out.push(el);
            }
        }
        return out;
    };
    /** Canonical stage occupant role type (dash, not underscore). */
    const STAGE_MEMBER = "stage-member";
    const isStageMemberContext = (context) =>
        context?.kind === STAGE_MEMBER ||
        (Array.isArray(context?.types) && context.types.includes(STAGE_MEMBER));
    const stripStageMember = (list) =>
        (Array.isArray(list) ? list : []).filter((t) => t !== STAGE_MEMBER);
    /** Nest / text layer boundary in type fan-out display & claim lists. */
    const NEST_BREAK = ">>";
    const formatTypeFanout = (types) =>
        (Array.isArray(types) ? types : [])
            .filter((t) => t != null && String(t).length)
            .join(" · ")
            .replace(/\s*·\s*>>\s*·\s*/g, " >> ");

    const typesForClaims = (types) =>
        (Array.isArray(types) ? types : []).filter((t) => t && t !== NEST_BREAK);

    const htmTagType = (tag) => {
        const t = String(tag || "div")
            .trim()
            .toLowerCase()
            .replace(/^<|>$/g, "");
        return t ? `htm-${t}` : "htm-element";
    };
    /**
     * One nesting layer's bindable types (deepest index 0 → host last).
     * Leaf:    parts · htm-<tag> · htm-element
     * Ancestor: htm-<tag> · parts · htm-element
     * Host also appends stage-member.
     * htm-element may appear once per layer (not deduped across layers).
     */
    const layerBindTypes = (layer, layerIndex, nestingLength) => {
        const types = [];
        if (!layer) return types;
        const parts = [];
        for (const p of layer.parts || []) {
            if (p) parts.push(String(p));
        }
        const tag = layer.tagPart || null;
        if (layerIndex === 0) {
            for (const p of parts) types.push(p);
            if (tag) types.push(tag);
            types.push("htm-element");
        } else {
            if (tag) types.push(tag);
            for (const p of parts) types.push(p);
            types.push("htm-element");
        }
        if (layerIndex === nestingLength - 1) {
            types.push(STAGE_MEMBER);
        }
        return types;
    };
    /** Concatenate every nesting layer deepest→host for display / claim order. */
    const typesFromNesting = (nesting) => {
        const layers = Array.isArray(nesting) ? nesting : [];
        const n = layers.length;
        const types = [];
        for (let i = 0; i < n; i++) {
            types.push(...layerBindTypes(layers[i], i, n));
        }
        return types.filter(Boolean);
    };

    /** Tags that cannot host meaningful innerHTML (void / replaced). */
    const VOID_OR_EMPTY_HTML = new Set([
        "area",
        "base",
        "br",
        "col",
        "embed",
        "hr",
        "img",
        "input",
        "link",
        "meta",
        "param",
        "source",
        "track",
        "wbr",
    ]);
    /** tag → virtual part for select-src (paths as text). */
    const HTM_SRC_PART = {
        img: "htm-img-src",
        iframe: "htm-iframe-src",
        frame: "htm-frame-src",
        video: "htm-video-src",
        audio: "htm-audio-src",
        source: "htm-source-src",
        embed: "htm-embed-src",
        script: "htm-script-src",
        track: "htm-track-src",
        input: "htm-input-src",
    };
    /** tag → virtual part for select-href. */
    const HTM_HREF_PART = {
        a: "htm-a-href",
        area: "htm-area-href",
        link: "htm-link-href",
        base: "htm-base-href",
    };

    const liveContextEl = (context) => {
        const el = context?.element;
        return el instanceof HTMLElement ? el : null;
    };

    const contextTagName = (context) => {
        const el = liveContextEl(context);
        if (el) return String(el.tagName || "").toLowerCase();
        const bt = String(context?.boundType || "");
        const m = /^htm-([a-z][a-z0-9]*)$/i.exec(bt);
        return m ? m[1].toLowerCase() : "";
    };

    /** True for real element picks (not virtual text/attr selects). */
    const isHtmElementPick = (context) => {
        if (context?.virtual) return false;
        const types = Array.isArray(context?.types) ? context.types : [];
        return types.some(
            (t) =>
                t === "htm-element" ||
                (/^htm-[a-z][a-z0-9]*$/i.test(String(t)) &&
                    !/-src$/i.test(String(t)) &&
                    !/-href$/i.test(String(t)))
        );
    };

    const prependVirtualTypes = (prior, ...heads) => {
        const headSet = new Set(heads.filter(Boolean));
        const rest = (Array.isArray(prior) ? prior : []).filter(
            (t) => t && !headSet.has(t)
        );
        return [...heads.filter(Boolean), ...rest];
    };

    /**
     * Virtual jockey object: text (+ attr part) leftmost, then >> boundary,
     * then prior types. Keeps element so later claims can write back.
     */
    const virtualTextSelectContext = (base, { attrPart, value, virtual, label, extraHeads }) => {
        const heads = ["text", attrPart, ...(extraHeads || [])].filter(Boolean);
        // Prefer: text · attr · [extra…] >> …prior (prior may already contain >>)
        const prior = (Array.isArray(base?.types) ? base.types : []).filter(
            (t) => t && !heads.includes(t)
        );
        const types = [...heads, NEST_BREAK, ...prior];
        // Dedup accidental double breaks
        const cleaned = [];
        for (const t of types) {
            if (t === NEST_BREAK && cleaned[cleaned.length - 1] === NEST_BREAK) {
                continue;
            }
            cleaned.push(t);
        }
        const text = value == null ? "" : String(value);
        return {
            ...base,
            types: cleaned,
            kind: "text",
            label: label || attrPart || "text",
            virtual: virtual || attrPart || "text",
            part: heads.join(" "),
            text,
            value: text,
            presentation: {
                type: heads.join(" "),
                value: text,
            },
            element: base?.element,
            hostElement: base?.hostElement,
            nesting: [],
            slot: base?.slot,
            index: base?.index,
            zoneElement: base?.zoneElement,
            path: base?.path,
            dataPath: base?.dataPath,
            nest: base?.nest || null,
            textSpan: base?.textSpan || null,
            wordSpan: base?.wordSpan || null,
            phraseSpan: base?.phraseSpan || null,
            charIndex: base?.charIndex ?? null,
        };
    };

    /** Built-in −1 selects: nest html, innerHTML / src / href → virtual contexts. */
    const builtInSelectPlugin = {
        id: "stagejockey-select",
        name: "stagejockey-select",
        claims: [
            {
                id: "select-nest-html",
                direction: -1,
                types: ["htm-element"],
                color: "#da70d6",
                describe: () => ({
                    text: "select children",
                    color: "#da70d6",
                    textShadow: "0 1px 2px #220022, 0 0 2px #000, 0 0 1px #000",
                }),
                matches: (context) => {
                    if (context?.nest?.kind === "html" || context?.virtual) {
                        return false;
                    }
                    if (!isHtmElementPick(context)) return false;
                    const el = liveContextEl(context);
                    if (!el) return false;
                    // Need a real child element to dive into.
                    return !!el.querySelector?.("*");
                },
                execute: (context, api) => {
                    const el = liveContextEl(context);
                    if (!el) throw new Error("no element for select children");
                    const hostTypes = typesForClaims(context.types || []);
                    const nest = {
                        kind: "html",
                        hostElement: el,
                        hostTypes,
                    };
                    if (api?.jockey) {
                        api.jockey.armNest(nest);
                    }
                    return {
                        ...context,
                        kind: "nest",
                        nest,
                        nestArmed: true,
                        types: ["nest", "html", NEST_BREAK, ...hostTypes],
                        label: context.label || "select children",
                        element: el,
                        hostElement: context.hostElement || el,
                        nesting: Array.isArray(context.nesting)
                            ? context.nesting
                            : [],
                    };
                },
            },
            {
                id: "select-innerhtml",
                direction: -1,
                types: ["htm-element"],
                color: "#7fffd4",
                describe: () => ({
                    text: "select innerHTML",
                    color: "#7fffd4",
                    textShadow: "0 1px 2px #003322, 0 0 2px #000, 0 0 1px #000",
                }),
                matches: (context) => {
                    if (!isHtmElementPick(context)) return false;
                    const el = liveContextEl(context);
                    if (!el) return false;
                    const tag = contextTagName(context);
                    return tag && !VOID_OR_EMPTY_HTML.has(tag);
                },
                execute: (context, api) => {
                    const el = liveContextEl(context);
                    if (!el) throw new Error("no element for innerHTML");
                    const full = String(el.textContent || "");
                    const next = virtualTextSelectContext(context, {
                        attrPart: "inner-html",
                        value: el.innerHTML,
                        virtual: "inner-html",
                        label: "innerHTML",
                    });
                    next.textRoot = el;
                    next.textSpan = {
                        start: 0,
                        end: full.length,
                        text: full,
                    };
                    if (api?.jockey) {
                        // Full-text default: same as scrubbing every character.
                        // Returns committed context (word·text·inner-html when
                        // one word) — executeEntry rebuilds once.
                        if (full.length > 0) {
                            return api.jockey.commitFullInnerHtmlSelect(next);
                        }
                        api.jockey.armTextProbe(next);
                    }
                    return next;
                },
            },
            {
                id: "select-src",
                direction: -1,
                types: Object.keys(HTM_SRC_PART).map((t) => htmTagType(t)),
                color: "#66cdaa",
                describe: () => ({
                    text: "select src",
                    color: "#66cdaa",
                    textShadow:
                        "0 1px 2px #003322, 0 0 2px #000, 0 0 1px #000",
                }),
                matches: (context) => {
                    if (!isHtmElementPick(context)) return false;
                    const el = liveContextEl(context);
                    if (!el) return false;
                    const tag = contextTagName(context);
                    if (!HTM_SRC_PART[tag]) return false;
                    if (tag === "input") {
                        const typ = String(el.getAttribute("type") || "")
                            .toLowerCase();
                        return typ === "image" || el.hasAttribute("src");
                    }
                    return true;
                },
                execute: (context) => {
                    const el = liveContextEl(context);
                    if (!el) throw new Error("no element for src");
                    const tag = contextTagName(context);
                    const attrPart = HTM_SRC_PART[tag];
                    if (!attrPart) throw new Error(`no src select for <${tag}>`);
                    const value =
                        el.getAttribute("src") != null
                            ? el.getAttribute("src")
                            : el.src != null
                              ? String(el.src)
                              : "";
                    return virtualTextSelectContext(context, {
                        attrPart,
                        value,
                        virtual: attrPart,
                        label: `${tag} src`,
                    });
                },
            },
            {
                id: "select-href",
                direction: -1,
                types: Object.keys(HTM_HREF_PART).map((t) => htmTagType(t)),
                color: "#40e0d0",
                describe: () => ({
                    text: "select href",
                    color: "#40e0d0",
                    textShadow: "0 1px 2px #003333, 0 0 2px #000, 0 0 1px #000",
                }),
                matches: (context) => {
                    if (!isHtmElementPick(context)) return false;
                    const el = liveContextEl(context);
                    if (!el) return false;
                    return !!HTM_HREF_PART[contextTagName(context)];
                },
                execute: (context) => {
                    const el = liveContextEl(context);
                    if (!el) throw new Error("no element for href");
                    const tag = contextTagName(context);
                    const attrPart = HTM_HREF_PART[tag];
                    if (!attrPart) throw new Error(`no href select for <${tag}>`);
                    const value =
                        el.getAttribute("href") != null
                            ? el.getAttribute("href")
                            : el.href != null
                              ? String(el.href)
                              : "";
                    return virtualTextSelectContext(context, {
                        attrPart,
                        value,
                        virtual: attrPart,
                        label: `${tag} href`,
                    });
                },
            },
        ],
    };

    /** Nearest ancestor (or self) with data-part including "stage". */
    const resolveStageHost = (from) => {
        let node =
            from instanceof HTMLElement
                ? from
                : from?.hostElement instanceof HTMLElement
                  ? from.hostElement
                  : from?.element instanceof HTMLElement
                    ? from.element
                    : from?.target instanceof HTMLElement
                      ? from.target
                      : null;
        while (node && node !== document.documentElement) {
            if (node instanceof HTMLElement) {
                const parts = partNamesFrom(
                    node.getAttribute?.("data-part") || ""
                );
                if (parts.includes("stage")) return node;
            }
            node = node.parentElement;
        }
        return null;
    };

    const random16Hex = () => {
        let out = "";
        for (let i = 0; i < 4; i++) {
            out += Math.floor(Math.random() * 0x10000)
                .toString(16)
                .padStart(4, "0");
        }
        return out;
    };

    /**
     * Prefer data-path from prior body content being proscened
     * (stage root, else a single unique top-level data-path).
     */
    const resolveProsceneDataPath = (prior) => {
        const nodes = Array.isArray(prior) ? prior : [];
        for (const n of nodes) {
            if (!(n instanceof HTMLElement)) continue;
            const parts = partNamesFrom(n.getAttribute?.("data-part") || "");
            const p = String(n.getAttribute?.("data-path") || "")
                .trim()
                .replace(/^\/+/, "");
            if (parts.includes("stage") && p) return p;
        }
        const paths = [];
        for (const n of nodes) {
            if (!(n instanceof HTMLElement)) continue;
            const p = String(n.getAttribute?.("data-path") || "")
                .trim()
                .replace(/^\/+/, "");
            if (p) paths.push(p);
        }
        const uniq = [...new Set(paths)];
        if (uniq.length === 1) return uniq[0];
        return `proscene-${random16Hex()}`;
    };

    const HORIZON_ROOT_NAME = "horizon/v1";
    const JOCKEY_STAGE_NAME = "jockeystage/v1";
    const JOCKEY_ROOT_STYLE =
        "margin:0;min-height:100vh;overflow:none;display:flex;flex-direction:column;justify-content:space-evenly;";
    const BAND_LAYOUT = [
        { id: "US", name: "Upstage", left: "USL", center: "USC", right: "USR" },
        { id: "S", name: "Stage", left: "SL", center: "CS", right: "SR" },
        { id: "DS", name: "Downstage", left: "DSL", center: "DSC", right: "DSR" },
    ];
    /** Paint depth, all positive: US front, S mid, DS back (DS stays interactive). */
    const BAND_Z = { US: 3, S: 2, DS: 1 };
    const bandStyle = (bandId) => {
        const z = BAND_Z[bandId] ?? 0;
        return `display:flex;flex-direction:row;position:relative;z-index:${z}`;
    };
    const SLOT_LABELS = {
        USL: "Upstage Left",
        USC: "Upstage Center",
        USR: "Upstage Right",
        SL: "Stage Left",
        CS: "Center Stage",
        SR: "Stage Right",
        DSL: "Downstage Left",
        DSC: "Downstage Center",
        DSR: "Downstage Right",
    };

    // Real HTML / CSS Level 3 color names (defaults for inputs too).
    const DEFAULT_SETTINGS = {
        pick: true,
        /** When true, path:media input is prefixed with navi:pref:ix if set. */
        prefPrefix: true,
        /**
         * Persist selection / claim / textselect graphs on tip
         * supermouse_stagejockey_live (serialized mut8; no hover spam).
         */
        liveTrace: true,
        /**
         * Drop frames from interactions older than this many *newer*
         * interactions (default 3). 0 = never auto-forget.
         */
        liveForgetAfter: 3,
        colorZone: "lightblue",
        colorItem: "blue",
        colorSelect: "red",
        colorElementHover: "green",
        colorElementHoverBlue: "darkgreen",
        colorElementSelect: "lime",
        colorNestHover: "mediumorchid",
        colorNestSelect: "orchid",
    };
    /** Host/plugin chrome — opt in via data-jockey-ui (not class names). */
    const CHROME_SEL = "[data-jockey-ui]";

    let unregister = null;
    let hostEventHandler = null;
    let dropdownMountHandler = null;
    let unmenuDropdown = null;
    let unrootDropdown = null;
    const hookTimers = [];
    /** @type {Map<string, { id: string, label?: string, matches?: Function, execute: Function, activate?: Function, source?: string }>} */
    const addClaims = new Map();

    const findScrollClaim = (modName, claimId) => {
        const plug = navi.mod?.[modName]?.scrollbufferPlugin;
        if (!plug || !Array.isArray(plug.claims)) return null;
        return plug.claims.find((c) => c.id === claimId) || null;
    };

    /** slashfold via surf when mounted; local fallback (keeps //). @see A_document/slashfold.md */
    const normalizeHyperPath = async (raw) => String(raw || "").trim();

    const readPrefIx = async () => {
        try {
            let v = await navi.storage.item.get(PREF_IX_KEY);
            if (v == null || v === "") {
                const old = await navi.storage.item.get(OLD_PREF_IX_KEY);
                if (old != null && old !== "") {
                    await navi.storage.item.set(PREF_IX_KEY, old);
                    await navi.storage.item.del(OLD_PREF_IX_KEY);
                    v = old;
                }
            }
            if (v == null || v === "") return "";
            return String(v)
                .trim()
                .replace(/^\/+|\/+$/g, "");
        } catch {
            return "";
        }
    };

    const writePrefIx = async (value) => {
        const s = String(value || "")
            .trim()
            .replace(/^\/+|\/+$/g, "");
        if (!s) {
            await navi.storage.item.del(PREF_IX_KEY);
            return "";
        }
        await navi.storage.item.set(PREF_IX_KEY, s);
        return s;
    };

    /**
     * If prefPrefix is on and navi:pref:ix is set, join prefix + input
     * ("a" + "b/c" → "b/c/a"). Skips absolute URLs / mimex: / already-prefixed.
     */
    const applyPrefIx = async (raw) => {
        let s = String(raw || "").trim();
        if (!s) return s;
        if (jockey.settings.prefPrefix === false) return s;
        if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s;
        if (/^mimex:/i.test(s)) return s;
        const ix = await readPrefIx();
        if (!ix) return s;
        const rest = s.replace(/^\/+/, "");
        if (rest === ix || rest.startsWith(`${ix}/`)) return rest;
        return `${ix}/${rest}`;
    };

    const bytesToBase64 = (buf) => {
        const bytes = new Uint8Array(buf);
        let bin = "";
        for (let i = 0; i < bytes.length; i += 0x8000) {
            bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        }
        return btoa(bin);
    };

    /**
     * path:media — GET through the park pipeline: localpark (storage.file
     * saves are bare bin tips, so uploads hit here) → hostpark on miss.
     * navi.fetch runs park.check itself; raw fetch only does when the SW
     * controls the page.
     */
    const fetchPathMedia = async (rawPath) => {
        const path = (await normalizeHyperPath(await applyPrefIx(rawPath))).replace(
            /^\/+/,
            ""
        );
        if (!path) throw new Error("empty media path");
        const init = { headers: { Accept: "text/html, text/plain, image/*, */*" } };
        const res =
            typeof navi.fetch === "function"
                ? await navi.fetch(path, init)
                : await fetch(
                      encodeURI(
                          typeof navi.resolveUrl === "function"
                              ? navi.resolveUrl(path)
                              : `/${path}`
                      ),
                      init
                  );
        if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
        const headerMime = String(res.headers.get("content-type") || "")
            .split(";")[0]
            .trim()
            .toLowerCase();
        const mime =
            headerMime && headerMime !== "application/octet-stream"
                ? headerMime
                : mimeFromFilename(path, "text/html");
        let part = "text";
        let value;
        if (mime.startsWith("image/") && mime !== "image/svg+xml") {
            // Local bin tips hold data: URLs / base64 text; host sends bytes.
            const buf = await res.arrayBuffer();
            const text = new TextDecoder().decode(buf).trim();
            const src = text.startsWith("data:")
                ? text
                : /^[A-Za-z0-9+/=\s]+$/.test(text) && text.length > 16
                  ? `data:${mime};base64,${text.replace(/\s+/g, "")}`
                  : `data:${mime};base64,${bytesToBase64(buf)}`;
            const alt = path.split(/[/\\]/).pop() || path;
            part = `${imagePartFromMime(mime)} htmf`;
            value = `<img src="${src.replace(/"/g, "&quot;")}" alt="${alt.replace(/"/g, "&quot;")}">`;
        } else {
            value = await res.text();
            if (mime.includes("html") || mime === "image/svg+xml") part = "htmf";
        }
        const parts = partNamesFrom(part);
        const local = !!res.headers.get("x-navi-park-ib");
        return {
            types: parts,
            kind: parts[parts.length - 1] || part,
            part,
            label: `path:media ${path}`,
            html: value,
            value,
            presentation: { type: part, value, path },
            path,
            href: path,
            mediaPath: path,
            mime,
            via: local ? "localpark" : "hostpark",
        };
    };

    const castAndMove = async (addApi, htmlCtx, tag) => {
        const stagemaker = findScrollClaim("stage_casting", "stagemaker");
        if (!stagemaker) {
            throw new Error("stage_casting (stagemaker) not mounted");
        }
        const move = findScrollClaim("jockey_move", "move");
        if (!move) {
            throw new Error("jockey_move not mounted");
        }
        if (typeof navi.callout === "function") {
            navi.callout(`[stagejockey] ${tag} ${htmlCtx.path}…`);
        }
        const offstage = await stagemaker.execute(htmlCtx, addApi);
        if (!offstage) return undefined;
        return move.execute(offstage, addApi);
    };

    const runPathMediaAdd = async (addApi, rawPath) => {
        const htmlCtx = await fetchPathMedia(rawPath);
        return castAndMove(addApi, htmlCtx, `path:media (${htmlCtx.via})`);
    };

    /** Load from navi.storage.file by path (same keys as navi-orient /upload). */
    const MIME_BY_EXT = {
        txt: "text/plain",
        md: "text/markdown",
        html: "text/html",
        htm: "text/html",
        css: "text/css",
        js: "text/javascript",
        mjs: "text/javascript",
        json: "application/json",
        csv: "text/csv",
        xml: "application/xml",
        svg: "image/svg+xml",
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        gif: "image/gif",
        webp: "image/webp",
        ico: "image/x-icon",
    };

    const mimeFromFilename = (filename, fallback = "") => {
        const base = String(filename || "").split(/[/\\]/).pop() || "";
        const ext = base.includes(".")
            ? base.slice(base.lastIndexOf(".") + 1).toLowerCase()
            : "";
        if (ext && MIME_BY_EXT[ext]) return MIME_BY_EXT[ext];
        const fb = String(fallback || "").trim();
        return fb || "application/octet-stream";
    };

    /** Caller path → storage.file key, used as-is for the cast path too. */
    const toMediaKey = (rawName) => {
        const name = String(rawName || "")
            .trim()
            .replace(/^\/+/, "");
        if (!name) throw new Error("empty media filename");
        return name;
    };

    const imagePartFromMime = (mime) => {
        const sub = String(mime || "")
            .split("/")[1]
            ?.split(";")[0]
            ?.trim()
            .toLowerCase();
        if (!sub) return "image";
        if (sub === "jpeg" || sub === "jpg") return "jpeg";
        if (sub === "png" || sub === "gif" || sub === "webp") return sub;
        if (sub === "svg+xml" || sub === "svg") return "svg";
        return sub.replace(/\+xml$/, "") || "image";
    };

    const partNamesFrom = (raw) =>
        String(raw || "")
            .trim()
            .toLowerCase()
            .split(/\s+/)
            .filter(Boolean);

    const loadMediaFile = async (rawName) => {
        const mediaKey = toMediaKey(rawName);
        const path = mediaKey;
        const file = navi?.storage?.file;
        if (!file || typeof file.get !== "function") {
            throw new Error("navi.storage.file unavailable");
        }
        const entry = await file.get(mediaKey);
        if (!entry || entry.media == null) {
            throw new Error(`media not found: ${path}`);
        }
        const body = String(entry.media);
        const mime = String(entry.mime || "text/plain").toLowerCase();
        let part = "text";
        let value = body;
        if (mime.includes("html")) {
            part = "htmf";
        } else if (mime.startsWith("image/")) {
            const imagePart = imagePartFromMime(mime);
            part = `${imagePart} htmf`;
            const src = body.startsWith("data:")
                ? body
                : `data:${mime};base64,${body}`;
            const alt = mediaKey.split(/[/\\]/).pop() || mediaKey;
            value = `<img src="${src.replace(/"/g, "&quot;")}" alt="${alt.replace(/"/g, "&quot;")}">`;
        }
        const parts = partNamesFrom(part);
        return {
            types: parts,
            kind: parts[parts.length - 1] || part,
            part,
            label: `media ${path}`,
            html: value,
            value,
            presentation: { type: part, value, path },
            path,
            mediaPath: path,
            mime,
        };
    };

    /** Just-uploaded file: read storage.file directly (no pref ix, no host). */
    const runMediaAdd = async (addApi, rawName) =>
        castAndMove(addApi, await loadMediaFile(rawName), "upload:media");

    const readLocalFile = (file) =>
        new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () =>
                reject(reader.error || new Error("file read failed"));
            reader.onload = () => resolve(String(reader.result ?? ""));
            const mime = mimeFromFilename(file.name, file.type);
            if (
                mime.startsWith("text/") ||
                mime === "application/json" ||
                mime === "application/xml" ||
                mime === "image/svg+xml"
            ) {
                reader.readAsText(file);
            } else {
                reader.readAsDataURL(file);
            }
        });

    const pickLocalFile = () =>
        new Promise((resolve) => {
            if (typeof document === "undefined") {
                resolve(null);
                return;
            }
            const input = document.createElement("input");
            input.type = "file";
            input.style.cssText = "position:fixed;left:-9999px;top:0";
            const done = (file) => {
                try {
                    input.remove();
                } catch {
                    /* ignore */
                }
                resolve(file || null);
            };
            input.addEventListener("change", () => {
                done(input.files && input.files[0] ? input.files[0] : null);
            });
            input.addEventListener("cancel", () => done(null));
            document.body.appendChild(input);
            input.click();
        });

    const runUploadMediaAdd = async (addApi) => {
        const file = await pickLocalFile();
        if (!file) return undefined;
        const base = String(file.name || "upload.bin")
            .split(/[/\\]/)
            .pop()
            .replace(/^\/+/, "");
        if (!base) throw new Error("empty upload filename");
        const mediaKey = toMediaKey(base);
        const mime = mimeFromFilename(base, file.type);
        const body = await readLocalFile(file);
        const store = navi?.storage?.file;
        if (!store || typeof store.save !== "function") {
            throw new Error("navi.storage.file unavailable");
        }
        await store.save(mediaKey, { media: body, mime });
        if (typeof navi.callout === "function") {
            navi.callout(`[stagejockey] upload:media → ${mediaKey}`);
        }
        return runMediaAdd(addApi, mediaKey);
    };

    const activateInlineAddInput = (row, menuApi, addApi, opts) => {
        const {
            flag,
            label,
            placeholder,
            ariaLabel,
            run,
            logTag,
        } = opts;
        if (!row || row.dataset[flag] === "1") return;
        row.dataset[flag] = "1";
        row.classList.add("smd-input-row");
        row.textContent = "";

        const input = document.createElement("input");
        input.placeholder = placeholder;
        input.setAttribute("aria-label", ariaLabel);
        input.style.cssText =
            "width:100%;padding:2px 4px;border:1px inset #f0f0f0;background:white;font-family:monospace;font-size:12px;outline:none;box-sizing:border-box";
        row.appendChild(input);
        try {
            input.focus();
        } catch {
            /* ignore */
        }

        input.addEventListener("click", (e) => e.stopPropagation());
        input.addEventListener("mousedown", (e) => e.stopPropagation());

        const reset = () => {
            row.dataset[flag] = "0";
            row.classList.remove("smd-input-row");
            row.textContent = label;
        };

        input.addEventListener("keydown", (e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
                const raw = input.value.trim();
                if (!raw) return;
                if (typeof menuApi?.close === "function") menuApi.close();
                void (async () => {
                    try {
                        await run(addApi, raw);
                    } catch (err) {
                        console.error(`[stagejockey] ${logTag} failed`, err);
                        if (typeof navi.callout === "function") {
                            navi.callout(
                                `[stagejockey] ${logTag}: ${err?.message || err}`
                            );
                        }
                    }
                })();
            } else if (e.key === "Escape") {
                e.preventDefault();
                reset();
            }
        });

        input.addEventListener("blur", () => {
            setTimeout(() => {
                if (row.isConnected && row.dataset[flag] === "1") {
                    reset();
                }
            }, 10);
        });
        return input;
    };

    const runIframeAdd = async (addApi, rawSrc) => {
        const moveMod =
            navi?.mod?.jockey_move || globalThis?.navi?.mod?.jockey_move;
        const moveClaim = findScrollClaim("jockey_move", "move");
        if (
            typeof moveMod?.moveOnstage !== "function" &&
            !moveClaim
        ) {
            throw new Error("jockey_move not mounted");
        }
        if (typeof document === "undefined" || !document.body) {
            throw new Error("browser document.body required");
        }
        let src = String(rawSrc || "").trim();
        if (!src) throw new Error("iframe src required");
        // Allow bare paths / relative; leave absolute http(s) alone.
        if (!/^[a-z][a-z0-9+.-]*:/i.test(src) && !src.startsWith("//")) {
            src = src.replace(/^\/+/, "");
            if (src && !src.startsWith("./") && !src.startsWith("../")) {
                src = "/" + src;
            }
        }

        const iframe = document.createElement("iframe");
        iframe.setAttribute("data-part", "iframe");
        iframe.setAttribute("data-path", src.replace(/^\/+/, ""));
        iframe.setAttribute("src", src);
        iframe.setAttribute("title", src);
        iframe.setAttribute("loading", "lazy");
        iframe.setAttribute("referrerpolicy", "no-referrer-when-downgrade");
        iframe.setAttribute("frameborder", "0");
        // Compact, quiet chrome — no border / padding, modest default size.
        iframe.style.cssText = [
            "display:block",
            "box-sizing:border-box",
            "border:0",
            "outline:none",
            "margin:0",
            "padding:0",
            "background:transparent",
            "width:min(36vw,22rem)",
            "height:min(28vh,14rem)",
            "max-width:100%",
            "vertical-align:top",
            "overflow:hidden",
        ].join(";");

        document.body.appendChild(iframe);
        if (typeof navi.callout === "function") {
            navi.callout(`[stagejockey] iframe ${src} — pick a zone`);
        }

        if (typeof moveMod?.moveOnstage === "function") {
            return moveMod.moveOnstage(iframe, addApi);
        }
        return moveClaim.execute(
            {
                types: ["offstage-member", "iframe", "htm-element"],
                kind: "offstage-member",
                liveElement: iframe,
                element: iframe,
                label: `iframe ${src}`,
                part: "iframe",
                path: src.replace(/^\/+/, ""),
            },
            addApi
        );
    };

    const activateIframeInput = (row, menuApi, addApi) => {
        activateInlineAddInput(row, menuApi, addApi, {
            flag: "iframeSrcInput",
            label: "iframe",
            placeholder: "src url (https://… or /path)",
            ariaLabel: "iframe src url",
            run: runIframeAdd,
            logTag: "iframe",
        });
    };

    const activatePathMediaInput = (row, menuApi, addApi) => {
        const input = activateInlineAddInput(row, menuApi, addApi, {
            flag: "pathMediaInput",
            label: "path:media",
            placeholder: "path (welcome.html / horizon/enter / …)",
            ariaLabel: "path:media path",
            run: runPathMediaAdd,
            logTag: "path:media",
        });
        if (!input) return;
        void (async () => {
            if (jockey.settings.prefPrefix === false) return;
            const ix = await readPrefIx();
            if (ix) input.placeholder = `path under ${ix}/ …`;
        })();
    };

    const activateUploadMedia = (row, menuApi, addApi) => {
        if (!row || row.dataset.uploadMediaArmed === "1") return;
        row.dataset.uploadMediaArmed = "1";
        if (typeof menuApi?.close === "function") menuApi.close();
        void (async () => {
            try {
                await runUploadMediaAdd(addApi);
            } catch (err) {
                console.error("[stagejockey] upload:media failed", err);
                if (typeof navi.callout === "function") {
                    navi.callout(
                        `[stagejockey] upload:media: ${err?.message || err}`
                    );
                }
            } finally {
                row.dataset.uploadMediaArmed = "0";
            }
        })();
    };

    const resolveSuperMouse = () => {
        const mod = navi?.mod || globalThis?.navi?.mod;
        if (!mod) return null;
        if (mod.supermouse?.supermouse) return mod.supermouse.supermouse;
        const hit = Object.values(mod).find(
            (entry) => entry?.supermouse && typeof entry.supermouse.registerPlugin === "function"
        );
        return hit?.supermouse || null;
    };

    const resolveStageDir = () => {
        const mod = navi?.mod || globalThis?.navi?.mod;
        return mod?.stagedir || null;
    };

    const isStageMemberSeparator = (el) => {
        const stage = resolveStageDir()?.stage;
        if (stage && typeof stage.isMemberSeparator === "function") {
            return stage.isMemberSeparator(el);
        }
        return (
            !!el &&
            el.nodeType === 1 &&
            String(el.tagName || "").toUpperCase() === "BR" &&
            el.getAttribute?.("data-stagedir-sep") === "br"
        );
    };

    const resolveDropdown = () => {
        const mod = navi?.mod || globalThis?.navi?.mod;
        return mod?.supermouse_plugin_dropdown || null;
    };

    /** True when Horizon's live root is already in document.body. */
    const hasHorizonV1 = () => {
        if (!isBrowser || !document.body) return false;
        return !!document.body.querySelector(`div[name="${HORIZON_ROOT_NAME}"]`);
    };

    /** True when a jockeystage/v1 proscenium is already in document.body. */
    const hasJockeyStageV1 = () => {
        if (!isBrowser || !document.body) return false;
        return !!document.body.querySelector(`div[name="${JOCKEY_STAGE_NAME}"]`);
    };

    /** proscene menu only when neither Horizon nor jockeystage root is present. */
    const canOfferProscene = () => !hasHorizonV1() && !hasJockeyStageV1();

    /** Detached jockeystage/v1 root: three bands of three empty columns. */
    const buildJockeyStageRoot = (stagePath) => {
        const root = document.createElement("div");
        root.setAttribute("name", JOCKEY_STAGE_NAME);
        root.setAttribute("data-part", "stage");
        root.setAttribute("data-path", stagePath);
        root.setAttribute("style", JOCKEY_ROOT_STYLE);
        for (const band of BAND_LAYOUT) {
            const bandEl = document.createElement("div");
            bandEl.id = band.id;
            bandEl.setAttribute("name", band.name);
            bandEl.setAttribute("style", bandStyle(band.id));
            for (const slot of [band.left, band.center, band.right]) {
                const col = document.createElement("div");
                col.id = slot;
                col.setAttribute("name", SLOT_LABELS[slot] || slot);
                col.setAttribute("style", "margin:auto;position:relative");
                bandEl.appendChild(col);
            }
            root.appendChild(bandEl);
        }
        return root;
    };

    const activateJockeyStage = (root) => {
        const stage = resolveStageDir()?.stage;
        if (stage && typeof stage.activate === "function") {
            try {
                stage.activate(root);
            } catch (err) {
                console.error("[stagejockey] proscene activate failed", err);
            }
        }
    };

    /**
     * surf -p: replace body with an empty jockeystage/v1 whose Center Stage
     * already holds `nodes` (one swap, no flicker). Returns the CS element.
     */
    const prosceneBody = (nodes) => {
        if (!isBrowser || !document.body) {
            throw new Error("proscene requires a browser document.body");
        }
        const list = Array.from(nodes || []).filter(
            (n) => !(n.nodeType === 3 && !String(n.textContent || "").trim())
        );
        const root = buildJockeyStageRoot(resolveProsceneDataPath(list));
        const cs = root.querySelector("#CS");
        for (const n of list) cs.appendChild(n);
        document.body.replaceChildren(root);
        activateJockeyStage(root);
        return cs;
    };

    /**
     * Build a Horizon-shaped proscenium named jockeystage/v1: three bands,
     * nine margin:auto columns (spacers where empty), move prior body children
     * into Center Stage (CS). No-op if horizon/v1 is present or stage exists.
     */
    const createJockeyStageV1 = () => {
        if (!isBrowser || !document.body) {
            throw new Error("proscene requires a browser document.body");
        }
        if (hasHorizonV1()) {
            throw new Error("horizon_v1 already in body — proscene skipped");
        }
        if (hasJockeyStageV1()) {
            throw new Error("jockeystage_v1 already in body — proscene skipped");
        }

        const prior = Array.from(document.body.childNodes).filter((n) => {
            if (n.nodeType === 3 && !String(n.textContent || "").trim()) {
                return false;
            }
            return true;
        });

        const stagePath = resolveProsceneDataPath(prior);
        const root = buildJockeyStageRoot(stagePath);
        document.body.appendChild(root);
        const cs = root.querySelector("#CS");
        if (cs) {
            for (const n of prior) {
                if (n.parentNode === document.body) cs.appendChild(n);
            }
        }
        activateJockeyStage(root);

        if (typeof navi.callout === "function") {
            navi.callout(
                `[stagejockey] proscene → jockeystage/v1 @ ${stagePath} (body → CS)`
            );
        }
        return root;
    };

    const selfUnmount = (reason, { wtf = true } = {}) => {
        const msg = wtf
            ? `[supermouse_plugin_stagejockey] WTF — ${reason}`
            : `[supermouse_plugin_stagejockey] ${reason}`;
        if (typeof navi.callout === "function") navi.callout(msg);
        else console.warn(msg);

        const run = () => {
            const mod = navi?.mod?.supermouse_plugin_stagejockey;
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

    class ScrollBuffer {
        constructor(owner) {
            this.owner = owner;
            this.plugins = new Map();
            this.entries = new Map();
            this.context = null;
            this.position = 0;
            this.history = [];
            this.overlay = null;
            this.executing = false;
            this.armed = false;
            this._savedPosition = null;
            this._terminateAfterExecute = false;
            this._rebuildGen = 0;
        }

        registerPlugin(def = {}) {
            const id = def.id || def.name;
            if (!id || typeof id !== "string") {
                throw new Error("[stagejockey] scrollbuffer plugin requires a string id");
            }
            if (this.plugins.has(id)) {
                throw new Error(`[stagejockey] scrollbuffer plugin "${id}" is already registered`);
            }
            this.plugins.set(id, { ...def, id });
            if (this.context) this.rebuild(this.context);
            return () => this.unregisterPlugin(id);
        }

        unregisterPlugin(id) {
            const removed = this.plugins.delete(id);
            if (removed && this.context) this.rebuild(this.context);
            return removed;
        }

        getPlugin(id) {
            const def = this.plugins.get(id);
            return def ? { id: def.id, name: def.name || def.id } : null;
        }

        listPlugins() {
            return this._definitions().map((def) => ({
                id: def.id,
                name: def.name || def.id
            }));
        }

        _definitions() {
            const defs = new Map(this.plugins);
            try {
                const names =
                    typeof navi.listModules === "function"
                        ? navi.listModules()
                        : Object.keys(navi.mod || {});
                for (const name of names) {
                    const exported = navi.mod?.[name]?.scrollbufferPlugin;
                    const candidates = Array.isArray(exported) ? exported : exported ? [exported] : [];
                    for (const def of candidates) {
                        const id = def?.id || def?.name;
                        if (id && typeof id === "string" && !defs.has(id)) {
                            defs.set(id, { ...def, id });
                        }
                    }
                }
            } catch (err) {
                console.error("[stagejockey] scrollbuffer plugin discovery failed", err);
            }
            return [...defs.values()];
        }

        _claims(def) {
            const source = Array.isArray(def.claims) && def.claims.length ? def.claims : [def];
            return source.map((claim, index) => ({
                ...def,
                ...claim,
                pluginId: def.id,
                claimId: claim.id || `${def.id}:${index}`
            }));
        }

        _matches(claim, context) {
            const predicate = claim.matches || claim.match || claim.when;
            if (typeof predicate !== "function") return true;
            try {
                return predicate(context, this._api(null, claim));
            } catch (err) {
                console.error(`[stagejockey] scrollbuffer match failed (${claim.claimId})`, err);
                return false;
            }
        }

        async _claimMatches(claim, context) {
            const result = this._matches(claim, context);
            const resolved =
                result && typeof result.then === "function"
                    ? await result
                    : result;
            return resolved !== false;
        }

        /** Most-specific → least-specific type names for fan-out. */
        _contextTypes(context) {
            if (Array.isArray(context?.types) && context.types.length) {
                return context.types.map(String);
            }
            if (isStageMemberContext(context)) {
                return [STAGE_MEMBER];
            }
            if (context?.kind === "stage_zone" || context?.kind === "stage-zone") {
                return ["stage_zone"];
            }
            if (context?.kind) return [String(context.kind)];
            return ["object"];
        }

        /** Claim bind sites ignore nest-break markers. */
        _bindableContextTypes(context) {
            return typesForClaims(this._contextTypes(context));
        }

        /**
         * Claim type affinity. null ⇒ universal (`*` / omitted).
         * @returns {string[]|null}
         */
        _claimTypeSpec(claim) {
            const raw = claim.types ?? claim.type ?? claim.for;
            if (raw == null) return null;
            if (raw === "*" || raw === "any") return null;
            const list = Array.isArray(raw) ? raw.map(String) : [String(raw)];
            if (!list.length || list.includes("*") || list.includes("any")) return null;
            return list;
        }

        /** First context type (deepest→shallow) that the claim's types bind to. */
        _boundTypeForClaim(claim, typeOrder) {
            const spec = this._claimTypeSpec(claim);
            if (!spec) return null;
            const order = Array.isArray(typeOrder) ? typeOrder : [];
            for (const t of order) {
                if (spec.includes(t)) return t;
            }
            return spec[0] || null;
        }

        /**
         * Bindable types contributed by one nesting layer (deepest index 0).
         * Leaf: parts · htm-<tag> · htm-element; ancestors: htm-<tag> · parts · htm-element;
         * host also ends with stage-member.
         */
        _layerBindTypes(layer, layerIndex, nestingLength) {
            return layerBindTypes(layer, layerIndex, nestingLength);
        }

        _layerHasType(layerTypes, name) {
            return (layerTypes || []).includes(name);
        }

        /**
         * Sites a claim can bind to — one per bindable type in left→right
         * fan-out order (ord 0 = leftmost). Nesting still attaches layerIndex
         * / el for scoped execute, but does not collapse a layer's types into
         * one site (that made htm-element and stage-member share an ord so
         * stage-member claims sorted nearer 0 than select innerHTML).
         */
        _bindSitesFromContext(context) {
            const nesting = Array.isArray(context?.nesting)
                ? context.nesting
                : [];
            const types = this._bindableContextTypes(context);
            /** @type {Array<{ type: string, layerIndex: number|null, el: Element|null, layerTypes: string[], ord: number, label: string|null }>} */
            const sites = [];
            /** nth occurrence of a type → nth nesting layer that offers it */
            const seen = new Map();
            for (let i = 0; i < types.length; i++) {
                const type = types[i];
                let layerIndex = null;
                let el = context?.element || null;
                let label = null;
                if (nesting.length) {
                    const nth = seen.get(type) || 0;
                    seen.set(type, nth + 1);
                    let found = 0;
                    for (let li = 0; li < nesting.length; li++) {
                        const layer = nesting[li];
                        const layerTypes = this._layerBindTypes(
                            layer,
                            li,
                            nesting.length
                        );
                        if (!layerTypes.includes(type)) continue;
                        if (found === nth) {
                            layerIndex = li;
                            el = layer?.el || el;
                            label = layer?.label || null;
                            break;
                        }
                        found++;
                    }
                }
                sites.push({
                    type,
                    layerIndex,
                    el,
                    layerTypes: [type],
                    ord: i,
                    label,
                });
            }
            return sites;
        }

        /**
         * Scope context so the bound nesting layer is the leaf (for tip ibs /
         * execute element). Legend still uses root context.nesting + layerIndex.
         */
        _contextForBindSite(base, site, boundType) {
            if (
                !site ||
                site.layerIndex == null ||
                !Array.isArray(base?.nesting) ||
                !base.nesting[site.layerIndex]
            ) {
                return {
                    ...base,
                    boundType: boundType || site?.type || null,
                    boundLayerIndex: site?.layerIndex ?? null,
                };
            }
            const i = site.layerIndex;
            const layer = base.nesting[i];
            const subNesting = base.nesting.slice(i);
            const types = this.owner._typesFromNesting(subNesting);
            let pathAttr = "";
            for (const L of subNesting) {
                if (L.path) {
                    pathAttr = L.path;
                    break;
                }
            }
            if (!pathAttr) {
                pathAttr = String(base.path || base.dataPath || "")
                    .trim()
                    .replace(/^\/+/, "");
            }
            const kind =
                boundType === STAGE_MEMBER
                    ? STAGE_MEMBER
                    : boundType === "htm-element"
                      ? "htm-element"
                      : boundType || base.kind;
            const basePres =
                base.presentation && typeof base.presentation === "object"
                    ? base.presentation
                    : {};
            const baseVal = basePres.value;
            // Keep non-HTML presentation values (e.g. href route strings).
            // Nested bind otherwise overwrites value with outerHTML and sniff loses the path.
            const keepScalarValue =
                typeof baseVal === "string" &&
                !!String(baseVal).trim() &&
                !/^\s*</.test(String(baseVal));
            const hrefFromBase =
                String(base.href || basePres.href || "").trim() ||
                (keepScalarValue &&
                (boundType === "href" ||
                    basePres.type === "href" ||
                    String(base.part || "")
                        .split(/\s+/)
                        .includes("href"))
                    ? String(baseVal).trim()
                    : "");
            if (!pathAttr && hrefFromBase) {
                pathAttr = String(hrefFromBase)
                    .trim()
                    .replace(/^\/+/, "");
            }
            return {
                ...base,
                types,
                kind,
                element: layer.el,
                nesting: subNesting,
                path: pathAttr || undefined,
                dataPath: pathAttr || undefined,
                ...(hrefFromBase ? { href: hrefFromBase.replace(/^\/+/, "") } : {}),
                presentation: {
                    ...basePres,
                    type: keepScalarValue
                        ? basePres.type || boundType || "href"
                        : stripStageMember(types).join(" "),
                    value: keepScalarValue
                        ? baseVal
                        : layer.el && layer.el.outerHTML != null
                          ? layer.el.outerHTML
                          : baseVal,
                    ...(pathAttr ? { path: pathAttr } : {}),
                    ...(hrefFromBase
                        ? { href: hrefFromBase.replace(/^\/+/, "") }
                        : {}),
                },
                label: layer.label || base.label,
                boundType: boundType || null,
                boundLayerIndex: i,
            };
        }

        /** Prefer claim.types order among types this layer offers. */
        _boundTypeForSite(claim, site) {
            const spec = this._claimTypeSpec(claim);
            if (!spec) return null;
            const layerTypes = site.layerTypes || (site.type ? [site.type] : []);
            for (const t of spec) {
                if (layerTypes.includes(t)) return t;
            }
            return null;
        }

        _baseEntry(context) {
            let text = context?.label;
            if (!text && isStageMemberContext(context)) {
                const type = context.presentation?.type || context.part;
                text = `${context.slot}[${context.index}]${type ? ` ${type}` : ""}`;
            }
            if (!text) text = context?.kind || "context";

            // Show nesting fan-out (deepest→host) so scrollbuffer 0
            // reflects what claims will match — e.g. rec-dot · htm-button ·
            // htm-element · htm-div · htmf · htm-element · stage-member
            const types = this._contextTypes(context);
            if (types.length) {
                const shown = formatTypeFanout(types);
                if (!String(text).includes(shown)) {
                    text = `${text}  [${shown}]`;
                }
            }

            return {
                position: 0,
                pluginId: null,
                claimId: "context",
                text: String(text),
                color: "white",
                textShadow: "0 1px 3px black",
                context
            };
        }

        /**
         * Default claim text-shadow so light/dark claim colors stay legible.
         * Claims may override via describe().textShadow or claim.textShadow.
         */
        _contrastTextShadow(color) {
            const c = String(color || "white")
                .toLowerCase()
                .replace(/\s+/g, "");
            if (
                /^(black|navy|maroon|indigo|olive|teal|midnightblue)/.test(c) ||
                /^dark/.test(c) ||
                /seagreen|saddlebrown|sienna|dimgr[ae]y|slategr[ae]y|forestgreen|midnight/.test(
                    c
                )
            ) {
                return "0 0 3px #fff, 0 0 1px #fff, 0 1px 2px #000";
            }
            if (
                /tomato|firebrick|crimson|brown|chocolate|peru|tan|rosybrown|indianred/.test(
                    c
                )
            ) {
                return "0 1px 2px #000, 0 0 2px #300, 0 0 1px #000";
            }
            if (/gold|goldenrod|khaki|yellow|orange|moccasin|wheat/.test(c)) {
                return "0 1px 2px #221100, 0 0 2px #000, 0 0 1px #000";
            }
            if (
                /orchid|thistle|violet|magenta|fuchsia|plum|mediumpurple|blueviolet/.test(
                    c
                )
            ) {
                return "0 1px 2px #1a0022, 0 0 2px #000, 0 0 1px #000";
            }
            if (
                /dodger|deepsky|skyblue|cyan|aqua|turquoise|steelblue|cornflower/.test(
                    c
                )
            ) {
                return "0 1px 2px #001433, 0 0 2px #000, 0 0 1px #000";
            }
            if (
                /lime|chartreuse|springgreen|lawngreen|greenyellow|lightgreen|palegreen/.test(
                    c
                )
            ) {
                return "0 1px 2px #001a00, 0 0 2px #000, 0 0 1px #000";
            }
            // coral / salmon / medium greens / default bright
            return "0 1px 2px #000, 0 0 3px #000, 0 0 1px #000";
        }

        _describe(claim, context, position) {
            const describe =
                claim.describe ||
                claim.text ||
                claim.label ||
                claim.name ||
                claim.pluginId;
            let value = describe;
            if (typeof describe === "function") {
                try {
                    value = describe(context, this._api(position, claim));
                } catch (err) {
                    console.error(
                        `[stagejockey] scrollbuffer describe failed (${claim.claimId})`,
                        err
                    );
                    value = claim.name || claim.pluginId;
                }
            }
            const styled =
                value && typeof value === "object" ? value : { text: value };
            const color = styled.color || claim.color || "white";
            return {
                text: String(styled.text ?? claim.name ?? claim.pluginId),
                color,
                textShadow:
                    styled.textShadow ||
                    claim.textShadow ||
                    this._contrastTextShadow(color),
            };
        }

        rebuild(context = this.context) {
            if (!context) return;
            // Paint position 0 immediately so text/char commits update the
            // jockey line without waiting on async claim discovery.
            this.context = context;
            this.armed = false;
            this.entries.set(0, this._baseEntry(context));
            this.position = 0;
            this.render();
            void this._rebuildAsync(context);
        }

        async _rebuildAsync(context = this.context) {
            if (!context) return;
            const gen = ++this._rebuildGen;
            this.context = context;
            this.entries.clear();
            this.armed = false;
            this.entries.set(0, this._baseEntry(context));

            const listed = await this._collectClaimBindings(context, () =>
                gen !== this._rebuildGen
            );
            if (gen !== this._rebuildGen) return;

            for (const entry of listed) {
                this.entries.set(entry.position, entry);
            }

            if (gen !== this._rebuildGen) return;
            this.position = 0;
            this.render();
            this.owner.persistLive({
                via: { kind: "scrollbuffer-rebuild" },
            });
        }

        /**
         * Match + order claims for a context (scrollbuffer fan-out, no overlay).
         * @returns {Promise<Array<object>>}
         */
        async listClaimEntries(context) {
            if (!context) return [];
            return this._collectClaimBindings(context, () => false);
        }

        async _collectClaimBindings(context, cancelled) {
            const sites = this._bindSitesFromContext(context);
            /** @type {Array<{ claim: object, scopedCtx: object, boundType: string|null, boundLayerIndex: number|null, layerIndex: number, siteOrd: number, direction: number }>} */
            const bindings = [];

            for (const def of this._definitions()) {
                for (const claim of this._claims(def)) {
                    if (cancelled()) return [];
                    const spec = this._claimTypeSpec(claim);
                    const direction =
                        Number(claim.direction ?? claim.offset ?? 1) < 0
                            ? -1
                            : 1;

                    if (spec === null) {
                        if (!(await this._claimMatches(claim, context))) {
                            continue;
                        }
                        bindings.push({
                            claim,
                            scopedCtx: context,
                            boundType: null,
                            boundLayerIndex: null,
                            layerIndex: 9999,
                            siteOrd: 9999,
                            direction,
                        });
                        continue;
                    }

                    for (const site of sites) {
                        const boundType = this._boundTypeForSite(claim, site);
                        if (!boundType) continue;
                        const scopedCtx = this._contextForBindSite(
                            context,
                            site,
                            boundType
                        );
                        if (!(await this._claimMatches(claim, scopedCtx))) {
                            continue;
                        }
                        if (cancelled()) return [];
                        bindings.push({
                            claim,
                            scopedCtx,
                            boundType,
                            boundLayerIndex:
                                site.layerIndex != null
                                    ? site.layerIndex
                                    : null,
                            layerIndex:
                                site.layerIndex != null
                                    ? site.layerIndex
                                    : site.ord,
                            siteOrd: site.ord,
                            direction,
                        });
                    }
                }
            }
            if (cancelled()) return [];

            // Primary key: siteOrd (leftmost type in fan-out → nearest 0).
            // layerIndex is only a tie-break; wildcards stay farthest.
            bindings.sort((a, b) => {
                const aWild = a.siteOrd >= 9999 || a.layerIndex >= 9999 ? 1 : 0;
                const bWild = b.siteOrd >= 9999 || b.layerIndex >= 9999 ? 1 : 0;
                if (aWild !== bWild) return aWild - bWild;
                if (a.siteOrd !== b.siteOrd) return a.siteOrd - b.siteOrd;
                if (a.layerIndex !== b.layerIndex) {
                    return a.layerIndex - b.layerIndex;
                }
                return String(a.claim.claimId).localeCompare(
                    String(b.claim.claimId)
                );
            });

            const positives = bindings.filter((b) => b.direction >= 0);
            const negatives = bindings.filter((b) => b.direction < 0);
            /** @type {object[]} */
            const listed = [];

            let positive = 1;
            let negative = -1;
            for (const b of positives) {
                const position = positive++;
                const style = this._describe(
                    b.claim,
                    b.scopedCtx,
                    position
                );
                listed.push({
                    position,
                    pluginId: b.claim.pluginId,
                    claimId: b.claim.claimId,
                    claim: b.claim,
                    context: b.scopedCtx,
                    boundType: b.boundType,
                    boundLayerIndex: b.boundLayerIndex,
                    ...style,
                });
            }
            for (const b of negatives) {
                const position = negative--;
                const style = this._describe(
                    b.claim,
                    b.scopedCtx,
                    position
                );
                listed.push({
                    position,
                    pluginId: b.claim.pluginId,
                    claimId: b.claim.claimId,
                    claim: b.claim,
                    context: b.scopedCtx,
                    boundType: b.boundType,
                    boundLayerIndex: b.boundLayerIndex,
                    ...style,
                });
            }
            return listed;
        }

        begin(context) {
            this.history = [{ context, via: null }];
            this.rebuild(context);
        }

        clear() {
            if (this.armed) this._callClaimHook("onDisarm");
            this.context = null;
            this.position = 0;
            this.entries.clear();
            this.history = [];
            this.executing = false;
            this.armed = false;
            this._savedPosition = null;
            this._terminateAfterExecute = false;
            if (this.overlay) {
                this.overlay.remove();
                this.overlay = null;
            }
        }

        /** Snapshot current claim selection (for cancel-restore, e.g. jockey-move). */
        rememberPosition() {
            this._savedPosition = this.position;
        }

        restorePosition() {
            if (this._savedPosition == null) return false;
            if (!this.entries.has(this._savedPosition)) {
                this._savedPosition = null;
                return false;
            }
            this.position = this._savedPosition;
            this._savedPosition = null;
            this.armed = false;
            this.render();
            this.owner.persistLive({
                via: { kind: "scrollbuffer-restore" },
            });
            return true;
        }

        move(step) {
            if (!this.context || !step) return false;
            const wanted = this.position + (step < 0 ? -1 : 1);
            if (!this.entries.has(wanted)) return false;
            if (this.armed) this._callClaimHook("onDisarm");
            this.position = wanted;
            this.armed = false;
            this.render();
            this.owner._paint();
            // Claim-index scrub is ephemeral — do not mut8 live tip per tick.
            return true;
        }

        updatePointer(x, y) {
            if (Number.isFinite(x)) this.owner._pointer.x = x;
            if (Number.isFinite(y)) this.owner._pointer.y = y;
            this.render();
            if (this.armed) this._callClaimHook("onPointerMove");
        }

        _api(position, claim, context = this.context) {
            return {
                navi,
                jockey: this.owner,
                scrollbuffer: this,
                stage: resolveStageDir()?.stage || null,
                selection: this.owner.select,
                context,
                position,
                claim,
                history: this.history.slice(),
                /** End the right-hold session immediately (and after execute).
                 * Interactive claim UIs must call this when they open so left-drag
                 * is not stolen by stage pick. */
                terminate: () => {
                    this._terminateAfterExecute = true;
                    if (this.owner.holding) this.owner.endHold();
                    else this.owner.clearDropdownPick();
                }
            };
        }

        seekClaim(pluginId, claimId) {
            for (const [pos, entry] of this.entries) {
                if (pos === 0) continue;
                if (
                    entry.pluginId === pluginId &&
                    (!claimId || entry.claimId === claimId)
                ) {
                    if (this.armed) this._callClaimHook("onDisarm");
                    this.position = pos;
                    this.armed = false;
                    this.render();
                    this.owner._paint();
                    this.owner.persistLive({
                        via: {
                            kind: "seek-claim",
                            pluginId: pluginId || null,
                            claimId: claimId || null,
                        },
                    });
                    return true;
                }
            }
            return false;
        }

        _callClaimHook(name) {
            const entry = this.entries.get(this.position);
            const hook = entry?.claim?.[name];
            if (typeof hook !== "function") return;
            try {
                const execCtx = entry.context || this.context;
                hook(execCtx, this._api(entry.position, entry.claim, execCtx));
            } catch (err) {
                console.error(
                    `[stagejockey] scrollbuffer ${name} failed (${entry?.claimId})`,
                    err
                );
            }
        }

        armCurrent() {
            if (!this.context || this.position === 0) return false;
            this.armed = true;
            this.render();
            this._callClaimHook("onArm");
            return true;
        }

        disarm() {
            if (!this.armed) return;
            this._callClaimHook("onDisarm");
            this.armed = false;
            this.render();
        }

        async executeCurrent() {
            const entry = this.entries.get(this.position);
            return this.executeEntry(entry);
        }

        /** Run a claim entry (scrollbuffer or dropdown claims: menu). */
        async executeEntry(entry) {
            const execute = entry?.claim?.execute || entry?.claim?.onExecute;
            if (
                !entry ||
                entry.position === 0 ||
                typeof execute !== "function" ||
                this.executing
            ) {
                return false;
            }

            const callDisarm = this.armed;
            this.executing = true;
            this.armed = false;
            this._terminateAfterExecute = false;
            try {
                const execCtx = entry.context || this.context;
                const next = await execute(
                    execCtx,
                    this._api(entry.position, entry.claim, execCtx)
                );
                if (
                    this._terminateAfterExecute ||
                    next === "terminate" ||
                    (next && typeof next === "object" && next.__terminateJockey)
                ) {
                    if (this.owner.holding) this.owner.endHold();
                    else this.owner.clearDropdownPick();
                    return true;
                }
                if (next == null) {
                    this.position = 0;
                    if (this.context) this.render();
                    this.owner.persistLive({
                        via: {
                            kind: "claim",
                            pluginId: entry.pluginId || null,
                            claimId: entry.claimId || null,
                            position: entry.position,
                        },
                    });
                    return true;
                }
                if (typeof next !== "object") {
                    throw new Error(
                        "scrollbuffer execute() must return an object or nothing"
                    );
                }
                this.history.push({
                    context: next,
                    via: {
                        position: entry.position,
                        pluginId: entry.pluginId,
                        claimId: entry.claimId
                    }
                });
                this.rebuild(next);
                return true;
            } catch (err) {
                console.error(
                    `[stagejockey] scrollbuffer execute failed (${entry.claimId})`,
                    err
                );
                if (typeof navi.callout === "function") {
                    navi.callout(`[stagejockey] ${err.message || err}`);
                }
                this.position = 0;
                if (this.context) this.render();
                return false;
            } finally {
                if (callDisarm) this._callClaimHook("onDisarm");
                this.executing = false;
                this._terminateAfterExecute = false;
            }
        }

        render() {
            if (!isBrowser || !this.context) return;
            const entry = this.entries.get(this.position);
            if (!entry) return;
            if (!this.overlay) {
                const el = document.createElement("div");
                el.id = "stagejockey-scrollbuffer";
                el.style.cssText = [
                    "position:fixed",
                    "z-index:2147483647",
                    "pointer-events:none",
                    "font:600 13px/1.2 monospace",
                    "padding:0",
                    "background:transparent",
                    "border-radius:2px",
                ].join(";");
                document.body.appendChild(el);
                this.overlay = el;
            }

            const sign =
                this.position > 0 ? `+${this.position}` : String(this.position);
            const nesting = Array.isArray(this.context.nesting)
                ? this.context.nesting
                : [];
            const boundType =
                entry.boundType ||
                (entry.claim
                    ? this._boundTypeForClaim(
                          entry.claim,
                          this._contextTypes(this.context)
                      )
                    : null);
            const boundLayerIndex =
                entry.boundLayerIndex != null &&
                Number.isFinite(Number(entry.boundLayerIndex))
                    ? Number(entry.boundLayerIndex)
                    : null;

            this.overlay.replaceChildren();

            const rightCol = document.createElement("div");
            // Claim + nesting legend stack to the RIGHT of the mouse (1-line claim on top).
            rightCol.style.cssText =
                "position:absolute;left:12px;top:0;display:flex;flex-direction:column;align-items:flex-start;gap:2px;";

            const claimEl = document.createElement("div");
            claimEl.style.cssText =
                "white-space:nowrap;padding:2px 4px;border-radius:2px;display:flex;align-items:baseline;gap:6px;";

            if (this.position !== 0 && boundType) {
                const kindEl = document.createElement("span");
                kindEl.textContent = boundType;
                kindEl.style.color = "white";
                kindEl.style.textShadow = "0 1px 3px black";
                claimEl.appendChild(kindEl);
            }

            const textEl = document.createElement("span");
            textEl.textContent = `${sign} ${entry.text}`;
            if (this.armed) {
                textEl.style.color = "lime";
                textEl.style.textShadow = "0 0 6px lime, 0 1px 3px black";
                claimEl.style.background = "rgba(0,80,0,.55)";
            } else if (this.position === 0) {
                textEl.style.color = "white";
                textEl.style.textShadow = "0 1px 3px black";
                claimEl.style.background = "rgba(0,0,0,.55)";
            } else {
                textEl.style.color = entry.color;
                textEl.style.textShadow = entry.textShadow;
                claimEl.style.background = "rgba(0,0,0,.45)";
            }
            claimEl.appendChild(textEl);
            rightCol.appendChild(claimEl);

            if (nesting.length) {
                const legend = document.createElement("div");
                // Parent (shallow) at top → deepest nest at bottom, under the claim.
                legend.style.cssText =
                    "display:flex;flex-direction:column;gap:1px;font:600 11px/1.15 monospace;";

                let highlightLi =
                    boundLayerIndex != null &&
                    Number.isFinite(boundLayerIndex)
                        ? boundLayerIndex
                        : null;
                if (highlightLi == null && boundType) {
                    // Prefer deepest matching layer (nesting[0] = leaf).
                    for (let li = 0; li < nesting.length; li++) {
                        const layerTypes = this._layerBindTypes(
                            nesting[li],
                            li,
                            nesting.length
                        );
                        if (this._layerHasType(layerTypes, boundType)) {
                            highlightLi = li;
                            break;
                        }
                    }
                    if (highlightLi == null) {
                        if (boundType === STAGE_MEMBER) {
                            highlightLi = nesting.length - 1;
                        } else if (boundType === "htm-element") {
                            highlightLi = 0;
                        }
                    }
                }

                for (let li = nesting.length - 1; li >= 0; li--) {
                    const layer = nesting[li];
                    const line = document.createElement("div");
                    line.textContent = layer.label || layer.tagPart || "?";
                    line.style.padding = "1px 3px";
                    line.style.color = "white";
                    line.style.background = "rgba(0,0,0,.75)";
                    line.style.textShadow = "0 1px 2px #000";
                    line.style.boxSizing = "border-box";
                    if (highlightLi === li) {
                        line.style.outline = "2px solid lime";
                        line.style.outlineOffset = "-1px";
                    } else {
                        line.style.outline = "none";
                    }
                    legend.appendChild(line);
                }
                rightCol.appendChild(legend);
            }

            this.overlay.appendChild(rightCol);

            this.overlay.style.left = `${this.owner._pointer.x}px`;
            this.overlay.style.top = `${this.owner._pointer.y - 8}px`;
            this.overlay.style.transform = "translateY(-100%)";
        }

        snapshot() {
            const entry = this.entries.get(this.position);
            return this.context
                ? {
                      position: this.position,
                      pluginId: entry?.pluginId || null,
                      claimId: entry?.claimId || null,
                      text: entry?.text || "",
                      contextKind: this.context.kind || null,
                      contextTypes: this._contextTypes(this.context),
                      depth: Math.max(0, this.history.length - 1)
                  }
                : null;
        }
    }

    class StageJockey {
        constructor() {
            this.settings = { ...DEFAULT_SETTINGS };
            this.holding = false;
            this.touchedStage = false;
            /** @type {{ slot: string, index: number|null, zoneEl: Element, itemEl: Element|null, targetEl?: Element|null } | null} */
            this.hover = null;
            this.select = null;
            /** @type {object|null} parked idle-righttap context for dropdown claims: */
            this.dropdownContext = null;
            /** @type {Map<Element, HTMLElement>} content el → temporary mark <span> (never mutates HTMF) */
            this._marked = new Map();
            this._domChromeCleanupBound = false;
            /**
             * Idle righttap parks select for dropdown claims but must not show red.
             * Real left-click setSelect clears this so chrome paints again.
             */
            this._selectOutlineSuppressed = false;
            this._lastRight = { x: 0, y: 0 };
            /** @type {Element|null} right-hold target (for off-stage htmf park). */
            this._rightTarget = null;
            this._pointer = { x: 0, y: 0 };
            this._selectionGeneration = 0;
            this._liveWriteChain = Promise.resolve();
            this._liveInteractionId = null;
            this._liveInteractionKind = null;
            this._liveInteractionRing = [];
            this.enabled = true;
            this.scrollbuffer = new ScrollBuffer(this);
            /** @type {Map<Element, { overlay: HTMLElement, host: HTMLElement, prevPosition: string }>|null} */
            this._holdOverlays = null;
            /** @type {WeakMap<Element, Element>|null} shield overlay → stage item */
            this._shieldOverlayOwner = null;
            /** @type {object|null} supermouse host instance */
            this._supermouseHost = null;
            /** @type {((e: Event) => void)|null} */
            this._memberShieldHandler = null;
            /** @type {string[]|null} */
            this._memberShieldTypes = null;
            /** Middle-claim gesture: keep member opaque until execute settles + trailing auxclick. */
            this._middleGestureOpaque = false;
            this._middleOpaqueGen = 0;
            this._shieldRemovePending = false;
            /** @type {{ x: number, y: number, dragging: boolean }|null} */
            this._moveDrag = null;
            this._moveDragMoveHandler = null;
            this._moveDragUpHandler = null;
            /** @type {{ kind: string, hostElement: HTMLElement, hostTypes: string[] }|null} */
            this.nestSession = null;
            /** Text / word / char probe while scrollbuffer is in inner-html virtual. */
            this._textProbe = null;
            /** @type {HTMLElement|null} */
            this._textOverlayRoot = null;
            this._textDrag = null;
        }

        armNest(nest) {
            this.nestSession = nest || null;
            this._paint();
        }

        clearNest() {
            this.nestSession = null;
        }

        _preventLeftDefault() {
            const h = this._supermouseHost;
            if (!h || typeof h.isPreventLeftDefault !== "function") return true;
            return h.isPreventLeftDefault();
        }

        _beginMiddleGestureOpaque() {
            this._middleGestureOpaque = true;
            this._middleOpaqueGen++;
            // Hold shield must stay up (or be reinstalled) while opaque.
            if (!this._memberShieldHandler) this._setMemberShield(true);
        }

        _clearMiddleGestureOpaque() {
            this._middleGestureOpaque = false;
            this._middleOpaqueGen++;
            if (this._shieldRemovePending && !this.holding) {
                this._shieldRemovePending = false;
                this._setMemberShield(false);
            }
        }

        /** Keep opaque past claim terminate so trailing auxclick cannot hit the occupant. */
        _releaseMiddleGestureOpaqueSoon() {
            const gen = ++this._middleOpaqueGen;
            const finish = () => {
                if (gen !== this._middleOpaqueGen) return;
                this._clearMiddleGestureOpaque();
            };
            // auxclick follows mouseup; cover a couple of turns.
            queueMicrotask(() => {
                setTimeout(finish, 0);
                setTimeout(finish, 120);
            });
        }

        _jockeyMoveMod() {
            const mod = navi?.mod || globalThis?.navi?.mod;
            return mod?.jockey_move || null;
        }

        _beginRedselectDrag(x, y) {
            this._cancelRedselectDrag();
            this._moveDrag = { x, y, dragging: false };
            if (this._moveDragMoveHandler) return;
            this._moveDragMoveHandler = (e) => {
                if (!this._moveDrag) return;
                this._pointer = { x: e.clientX, y: e.clientY };
                const d = this._moveDrag;
                const dist = Math.hypot(e.clientX - d.x, e.clientY - d.y);
                if (!d.dragging && dist < 16) return;
                d.dragging = true;
                try {
                    e.preventDefault();
                } catch {
                    /* ignore */
                }
                this._jockeyMoveMod()?.redselectDrag?.move(this);
            };
            this._moveDragUpHandler = (e) => {
                if (e.button != null && e.button !== 0) return;
                void this._finishRedselectDrag(e);
            };
            window.addEventListener("pointermove", this._moveDragMoveHandler, true);
            window.addEventListener("mousemove", this._moveDragMoveHandler, true);
            window.addEventListener("pointerup", this._moveDragUpHandler, true);
            window.addEventListener("mouseup", this._moveDragUpHandler, true);
        }

        _cancelRedselectDrag() {
            this._moveDrag = null;
            this._jockeyMoveMod()?.redselectDrag?.cancel?.();
            if (this._moveDragMoveHandler) {
                window.removeEventListener(
                    "pointermove",
                    this._moveDragMoveHandler,
                    true
                );
                window.removeEventListener(
                    "mousemove",
                    this._moveDragMoveHandler,
                    true
                );
                this._moveDragMoveHandler = null;
            }
            if (this._moveDragUpHandler) {
                window.removeEventListener(
                    "pointerup",
                    this._moveDragUpHandler,
                    true
                );
                window.removeEventListener(
                    "mouseup",
                    this._moveDragUpHandler,
                    true
                );
                this._moveDragUpHandler = null;
            }
        }

        async _finishRedselectDrag(e) {
            const d = this._moveDrag;
            const x = e.clientX;
            const y = e.clientY;
            this._pointer = { x, y };
            const dragging = !!d?.dragging;
            this._moveDrag = null;
            if (this._moveDragMoveHandler) {
                window.removeEventListener(
                    "pointermove",
                    this._moveDragMoveHandler,
                    true
                );
                window.removeEventListener(
                    "mousemove",
                    this._moveDragMoveHandler,
                    true
                );
                this._moveDragMoveHandler = null;
            }
            if (this._moveDragUpHandler) {
                window.removeEventListener(
                    "pointerup",
                    this._moveDragUpHandler,
                    true
                );
                window.removeEventListener(
                    "mouseup",
                    this._moveDragUpHandler,
                    true
                );
                this._moveDragUpHandler = null;
            }
            if (dragging) {
                try {
                    e.preventDefault();
                    e.stopPropagation();
                } catch {
                    /* ignore */
                }
                try {
                    await this._jockeyMoveMod()?.redselectDrag?.end(this);
                } catch (err) {
                    console.error("[stagejockey] redselectDrag.end", err);
                }
                return true;
            }
            this._jockeyMoveMod()?.redselectDrag?.cancel?.();
            const loc = this.locate(e.target);
            if (loc) this.setSelect(loc);
            return false;
        }

        _nestDiveEnabled() {
            return !!(this.nestSession && this.nestSession.kind === "html");
        }

        armTextProbe(context) {
            const root =
                context?.textRoot ||
                (context?.element instanceof HTMLElement
                    ? context.element
                    : null);
            if (!(root instanceof HTMLElement)) {
                this.clearTextProbe();
                return;
            }
            const prev = this._textProbe;
            // Freeze the host >> tail from the first arm (select innerHTML) so
            // later char commits can insert under-root nest without duplicating.
            let hostTail = prev?.hostTail;
            if (!hostTail) {
                const types = Array.isArray(context?.types)
                    ? context.types
                    : [];
                const idx = types.indexOf(NEST_BREAK);
                hostTail =
                    idx >= 0
                        ? types.slice(idx)
                        : [
                              NEST_BREAK,
                              ...typesForClaims(types).filter(
                                  (t) =>
                                      t !== "text" &&
                                      t !== "text-html" &&
                                      t !== "inner-html" &&
                                      t !== "word" &&
                                      t !== "char" &&
                                      t !== "phrase"
                              ),
                          ];
            }
            this._textProbe = {
                root,
                fullText: String(root.textContent || ""),
                baseContext: context,
                hover: null,
                committed: prev?.committed || null,
                hostTail,
            };
            this._ensureTextOverlay();
            this._paintTextProbe();
        }

        /**
         * select innerHTML default: treat as a scrub of the entire textContent.
         * Builds committed context + paint; caller (executeEntry) rebuilds once.
         * Does not push history itself.
         */
        commitFullInnerHtmlSelect(baseContext) {
            const root =
                baseContext?.textRoot instanceof HTMLElement
                    ? baseContext.textRoot
                    : baseContext?.element instanceof HTMLElement
                      ? baseContext.element
                      : null;
            if (!(root instanceof HTMLElement)) {
                this.armTextProbe(baseContext);
                return baseContext;
            }
            const full = String(root.textContent || "");
            const start = 0;
            const end = full.length;
            if (end <= start) {
                this.armTextProbe(baseContext);
                return baseContext;
            }

            // Seed probe so hostTail / later reselects work.
            this.armTextProbe({
                ...baseContext,
                textRoot: root,
                textSpan: { start, end, text: full },
            });
            const probe = this._textProbe;
            const hostTail = Array.isArray(probe?.hostTail) && probe.hostTail.length
                ? probe.hostTail
                : [NEST_BREAK];
            const TEXT_HEADS = new Set([
                "text",
                "text-html",
                "inner-html",
                "word",
                "char",
                "phrase",
            ]);
            const meta = this._textRangeMeta(root, start, end);
            const value = meta.hasMarkup ? meta.html : meta.plain;
            const words = this._wordSpans(full);
            // One word (ignoring surrounding whitespace) → word·text·inner-html.
            const sole =
                words.length === 1 &&
                full.slice(0, words[0].start).trim() === "" &&
                full.slice(words[0].end).trim() === ""
                    ? words[0]
                    : null;
            let heads;
            let label;
            let virtual;
            let kind;
            let wordSpan = null;
            let phraseSpan = null;
            if (meta.hasMarkup) {
                heads = ["text-html", "text", "inner-html"];
                label = `text-html ${start}-${end}`;
                virtual = "text-html";
                kind = "text-html";
            } else if (sole) {
                heads = ["word", "text", "inner-html"];
                label = sole.text;
                virtual = "word";
                kind = "word";
                wordSpan = sole;
            } else if ((phraseSpan = this._phraseSpan(full, start, end))) {
                heads = ["phrase", "text", "inner-html"];
                label = phraseSpan.text.trim() || `phrase ${start}-${end}`;
                virtual = "phrase";
                kind = "phrase";
            } else {
                heads = ["text", "inner-html"];
                label = `text ${start}-${end}`;
                virtual = "text";
                kind = "text";
            }
            const next = virtualTextSelectContext(baseContext, {
                attrPart: "inner-html",
                value,
                virtual,
                label,
                extraHeads: heads.filter(
                    (h) => h !== "text" && h !== "inner-html"
                ),
            });
            const child = (meta.childTypes || []).filter(
                (t) => t && !TEXT_HEADS.has(t)
            );
            next.types = [
                ...heads,
                ...(child.length ? [NEST_BREAK, ...child] : []),
                ...hostTail,
            ];
            const cleaned = [];
            for (const t of next.types) {
                if (
                    t === NEST_BREAK &&
                    cleaned[cleaned.length - 1] === NEST_BREAK
                ) {
                    continue;
                }
                cleaned.push(t);
            }
            next.types = cleaned;
            next.kind = kind;
            next.textRoot = root;
            next.textSpan = {
                start,
                end,
                text: meta.plain,
                html: meta.hasMarkup ? meta.html : null,
            };
            next.wordSpan = phraseSpan ? null : wordSpan;
            next.phraseSpan = phraseSpan;
            next.charIndex = null;
            next.value = value;
            next.text = value;
            next.hasMarkup = meta.hasMarkup;
            const stageHost =
                baseContext.hostElement instanceof HTMLElement
                    ? baseContext.hostElement
                    : baseContext.element instanceof HTMLElement
                      ? baseContext.element
                      : root;
            next.nesting = this._buildNesting(meta.leafEl, stageHost);
            next.element = meta.leafEl;

            const rangeRects = this._rangeRects(root, start, end);
            const phrasePaint = !meta.hasMarkup
                ? this._phrasePaintPack(root, full, start, end)
                : null;
            const paint = phrasePaint || {
                word: sole
                    ? {
                          ...sole,
                          rects: this._rangeRects(root, sole.start, sole.end),
                      }
                    : null,
                char: null,
                // Always paint the full range so "select innerHTML" looks selected.
                range: { start, end, rects: rangeRects },
                phrase: null,
            };

            this._textProbe = {
                ...this._textProbe,
                root,
                fullText: full,
                baseContext: next,
                hover: null,
                committed: paint,
                hostTail,
            };
            this._ensureTextOverlay();
            this._paintTextProbe();
            return next;
        }

        clearTextProbe() {
            this._textProbe = null;
            this._textDrag = null;
            this._clearTextOverlay();
        }

        _ensureTextOverlay() {
            if (!isBrowser) return;
            if (this._textOverlayRoot) return;
            const root = document.createElement("div");
            root.setAttribute("data-jockey-ui", "stagejockey-text-probe");
            root.style.cssText =
                "position:fixed;inset:0;pointer-events:none;z-index:2147483645;";
            document.documentElement.appendChild(root);
            this._textOverlayRoot = root;
        }

        _clearTextOverlay() {
            if (this._textOverlayRoot) {
                try {
                    this._textOverlayRoot.remove();
                } catch {
                    /* ignore */
                }
            }
            this._textOverlayRoot = null;
        }

        _paintTextRects(rects, color, fill) {
            const root = this._textOverlayRoot;
            if (!root) return;
            for (const r of rects || []) {
                if (!r || r.width < 0.5 || r.height < 0.5) continue;
                const box = document.createElement("div");
                box.style.cssText = [
                    "position:fixed",
                    `left:${r.left}px`,
                    `top:${r.top}px`,
                    `width:${r.width}px`,
                    `height:${r.height}px`,
                    `outline:2px solid ${color}`,
                    fill ? `background:${fill}` : "background:transparent",
                    "pointer-events:none",
                    "box-sizing:border-box",
                ].join(";");
                root.appendChild(box);
            }
        }

        _paintTextProbe() {
            this._ensureTextOverlay();
            const root = this._textOverlayRoot;
            if (!root) return;
            root.replaceChildren();
            const probe = this._textProbe;
            if (!probe) return;
            const paintPack = (pack, { wordColor, charColor, rangeColor, phraseColor }) => {
                if (!pack) return;
                if (pack.phrase?.rects) {
                    this._paintTextRects(
                        pack.phrase.rects,
                        phraseColor,
                        "rgba(230,126,34,0.22)"
                    );
                }
                if (pack.range?.rects) {
                    this._paintTextRects(
                        pack.range.rects,
                        rangeColor,
                        "rgba(218,112,214,0.22)"
                    );
                }
                if (pack.word?.rects) {
                    this._paintTextRects(
                        pack.word.rects,
                        wordColor,
                        "rgba(72,209,204,0.15)"
                    );
                }
                if (pack.char?.rects) {
                    this._paintTextRects(
                        pack.char.rects,
                        charColor,
                        "rgba(255,215,0,0.35)"
                    );
                }
            };
            // Committed selection (solid) under live hover (lighter).
            paintPack(probe.committed, {
                wordColor: "darkcyan",
                charColor: "goldenrod",
                rangeColor: "darkorchid",
                phraseColor: "chocolate",
            });
            paintPack(probe.hover, {
                wordColor: "mediumturquoise",
                charColor: "gold",
                rangeColor: "orchid",
                phraseColor: "darkorange",
            });
        }

        /** Map document caret → absolute offset in root.textContent. */
        _offsetInRoot(root, node, offset) {
            if (!root.contains(node)) return null;
            const walker = document.createTreeWalker(
                root,
                NodeFilter.SHOW_TEXT
            );
            let acc = 0;
            let n;
            while ((n = walker.nextNode())) {
                if (n === node) return acc + offset;
                acc += String(n.textContent || "").length;
            }
            return null;
        }

        _caretAtPoint(x, y, root) {
            let node = null;
            let offset = 0;
            if (typeof document.caretRangeFromPoint === "function") {
                const r = document.caretRangeFromPoint(x, y);
                if (!r) return null;
                node = r.startContainer;
                offset = r.startOffset;
            } else if (typeof document.caretPositionFromPoint === "function") {
                const p = document.caretPositionFromPoint(x, y);
                if (!p) return null;
                node = p.offsetNode;
                offset = p.offset;
            } else {
                return null;
            }
            if (node && node.nodeType !== 3) {
                // Element — try first text child
                const tw = document.createTreeWalker(
                    node,
                    NodeFilter.SHOW_TEXT
                );
                const t = tw.nextNode();
                if (!t) return null;
                node = t;
                offset = 0;
            }
            const abs = this._offsetInRoot(root, node, offset);
            if (abs == null) return null;
            return { abs, node, offset };
        }

        _rangeRects(root, start, end) {
            const range = this._domRangeFromOffsets(root, start, end);
            if (!range) return [];
            try {
                return Array.from(range.getClientRects());
            } catch {
                return [];
            }
        }

        /** DOM Range covering [start,end) in root.textContent space. */
        _domRangeFromOffsets(root, start, end) {
            const a = Math.max(0, Math.min(start, end));
            const b = Math.max(start, end);
            if (!(root instanceof HTMLElement) || b < a) return null;
            try {
                const range = document.createRange();
                const walker = document.createTreeWalker(
                    root,
                    NodeFilter.SHOW_TEXT
                );
                let acc = 0;
                let startNode = null;
                let startOff = 0;
                let endNode = null;
                let endOff = 0;
                let lastNode = null;
                let n;
                while ((n = walker.nextNode())) {
                    // Empty text nodes do not contribute to textContent.
                    const len = String(n.textContent || "").length;
                    if (len === 0) continue;
                    lastNode = n;
                    // Start must fall *inside* this node: [acc, acc+len).
                    // Using `>=` wrongly pins offset==acc+len (next char, often
                    // first glyph of a nested tag) to the *previous* node end,
                    // so [n,n+1) spans an element → false text-html (char 0).
                    if (!startNode && a < acc + len) {
                        startNode = n;
                        startOff = a - acc;
                    }
                    // Exclusive end may sit exactly at acc+len (node boundary).
                    if (!endNode && b <= acc + len) {
                        endNode = n;
                        endOff = b - acc;
                        break;
                    }
                    acc += len;
                }
                if (!startNode) {
                    // a at/past end of text — clamp to last glyph boundary.
                    if (!lastNode) return null;
                    startNode = lastNode;
                    startOff = String(lastNode.textContent || "").length;
                }
                if (!endNode) {
                    endNode = startNode;
                    endOff = String(startNode.textContent || "").length;
                }
                range.setStart(startNode, Math.min(startOff, startNode.length));
                range.setEnd(endNode, Math.min(endOff, endNode.length));
                return range;
            } catch {
                return null;
            }
        }

        /**
         * Serialize a textContent offset span via Range — plain when only
         * text nodes; HTML fragment when nested elements are crossed
         * (e.g. hello <i>wo</i>). Also returns nest path under root.
         */
        _textRangeMeta(root, start, end) {
            const a = Math.max(0, Math.min(start, end));
            const b = Math.max(start, end);
            const plain = String(root.textContent || "").slice(a, b);
            const range =
                b > a ? this._domRangeFromOffsets(root, a, b) : null;
            let html = plain;
            let hasMarkup = false;
            let leafEl = root;
            if (range) {
                try {
                    // One textContent unit can never need markup serialization.
                    const sameText =
                        range.startContainer === range.endContainer &&
                        range.startContainer.nodeType === 3;
                    if (!sameText && b - a > 1) {
                        const frag = range.cloneContents();
                        hasMarkup = Array.from(frag.childNodes).some(
                            (n) => n.nodeType === 1
                        );
                        if (hasMarkup) {
                            const box = document.createElement("div");
                            box.appendChild(frag);
                            html = box.innerHTML;
                        }
                    }
                    const sc = range.startContainer;
                    const el =
                        sc.nodeType === 1
                            ? sc
                            : sc.parentElement;
                    if (el instanceof HTMLElement && root.contains(el)) {
                        leafEl = el;
                    }
                } catch {
                    /* keep plain */
                }
            } else {
                // Zero-length / caret: still resolve leaf for nest context.
                const caretRange = this._domRangeFromOffsets(
                    root,
                    a,
                    Math.min(a + 1, String(root.textContent || "").length)
                );
                try {
                    const sc = caretRange?.startContainer;
                    const el =
                        sc && sc.nodeType === 1
                            ? sc
                            : sc?.parentElement;
                    if (el instanceof HTMLElement && root.contains(el)) {
                        leafEl = el;
                    }
                } catch {
                    /* ignore */
                }
            }
            // Nesting deepest → root (inclusive). Child layers (exclude root)
            // become the middle >> fan-out so <i> inside <h1> stays visible.
            const nesting = this._buildNesting(leafEl, root);
            const childLayers =
                nesting.length > 1 ? nesting.slice(0, -1) : [];
            const childTypes = [];
            for (let i = 0; i < childLayers.length; i++) {
                childTypes.push(
                    ...layerBindTypes(
                        childLayers[i],
                        i,
                        childLayers.length + 1
                    )
                );
            }
            return {
                plain,
                html,
                hasMarkup,
                leafEl,
                nesting,
                childTypes,
            };
        }

        /** Word spans: split on whitespace, `:`, `/`. */
        _wordSpans(fullText) {
            const re = /[^:\s/]+/g;
            /** @type {Array<{ start: number, end: number, text: string }>} */
            const out = [];
            let m;
            while ((m = re.exec(fullText))) {
                out.push({
                    start: m.index,
                    end: m.index + m[0].length,
                    text: m[0],
                });
            }
            return out;
        }

        /** Word objects overlapping [start, end) in fullText. */
        _wordsInRange(fullText, start, end) {
            const a = Math.max(0, start | 0);
            const b = Math.max(a, end | 0);
            return this._wordSpans(fullText).filter(
                (w) => w.start < b && w.end > a
            );
        }

        /**
         * Phrase index: selection may be a partial slice across words
         * (e.g. "o wo" in "hello world"), but words[] lists the full word
         * objects overlapped — claims on phrase target those words.
         * Null unless 2+ words overlap [start, end).
         */
        _phraseSpan(fullText, start, end) {
            const a = Math.max(0, start | 0);
            const b = Math.max(a, end | 0);
            const words = this._wordsInRange(fullText, a, b);
            if (words.length < 2) return null;
            return {
                start: a,
                end: b,
                text: String(fullText || "").slice(a, b),
                words: words.map((w) => ({
                    start: w.start,
                    end: w.end,
                    text: w.text,
                })),
            };
        }

        /**
         * Paint pack for a multi-word phrase: rectangles around each full
         * word in phraseSpan (not only the selected slice).
         */
        _phrasePaintPack(root, fullText, start, end) {
            const phraseSpan = this._phraseSpan(fullText, start, end);
            if (!phraseSpan) return null;
            const rects = [];
            for (const w of phraseSpan.words) {
                const wr = this._rangeRects(root, w.start, w.end);
                for (const r of wr || []) rects.push(r);
            }
            return {
                phrase: {
                    ...phraseSpan,
                    rects,
                },
                word: null,
                char: null,
                range: null,
            };
        }

        /** Absolute textContent offset of the glyph under (x,y) in [from,to), or null. */
        _glyphAbsAtPoint(root, x, y, from, to) {
            const a = Math.max(0, from | 0);
            const b = Math.max(a, to | 0);
            for (let i = a; i < b; i++) {
                const rects = this._rangeRects(root, i, i + 1);
                for (const r of rects || []) {
                    if (
                        r &&
                        x >= r.left &&
                        x <= r.right &&
                        y >= r.top &&
                        y <= r.bottom
                    ) {
                        return i;
                    }
                }
            }
            return null;
        }

        _probeTextAt(x, y) {
            const probe = this._textProbe;
            if (!probe?.root) return null;
            const caret = this._caretAtPoint(x, y, probe.root);
            if (!caret) return null;
            const full = probe.fullText;
            const root = probe.root;
            let abs = Math.max(0, Math.min(caret.abs, full.length));
            const words = this._wordSpans(full);
            let word = null;
            for (const w of words) {
                if (abs >= w.start && abs < w.end) {
                    word = w;
                    break;
                }
                if (abs === w.end && abs > w.start) {
                    word = w;
                    break;
                }
            }
            // Prefer the glyph under the pointer (fixes char 0: caret sits at the
            // left edge, so any tiny move reports abs+1 and used to wipe char).
            if (!word) {
                for (const w of words) {
                    if (
                        this._glyphAbsAtPoint(root, x, y, w.start, w.end) !=
                        null
                    ) {
                        word = w;
                        break;
                    }
                }
            }
            let char = null;
            if (word) {
                const hit =
                    this._glyphAbsAtPoint(root, x, y, word.start, word.end) ??
                    null;
                let i = hit;
                if (i == null) {
                    if (abs >= word.start && abs < word.end) i = abs;
                    else if (abs > word.start && abs <= word.end) i = abs - 1;
                }
                if (i != null && i >= word.start && i < word.end) {
                    abs = i;
                    char = {
                        index: i - word.start,
                        abs: i,
                        text: full[i] || "",
                        rects: this._rangeRects(root, i, i + 1),
                    };
                }
                word = {
                    ...word,
                    rects: this._rangeRects(root, word.start, word.end),
                };
            }
            return { abs, word, char, range: null };
        }

        _commitTextSelection(hover, { dragRange } = {}) {
            const probe = this._textProbe;
            if (!probe?.baseContext || !(probe.root instanceof HTMLElement)) {
                return;
            }
            const base = probe.baseContext;
            const full = probe.fullText;
            const root = probe.root;
            const hostTail = () =>
                Array.isArray(probe.hostTail) && probe.hostTail.length
                    ? probe.hostTail
                    : [NEST_BREAK];
            const TEXT_HEADS = new Set([
                "text",
                "text-html",
                "inner-html",
                "word",
                "char",
                "phrase",
            ]);
            const applyCommit = (next, paint) => {
                this.scrollbuffer.history.push({
                    context: next,
                    via: { claimId: next.virtual || "text-select" },
                });
                this.scrollbuffer.rebuild(next);
                if (this._textProbe) {
                    this._textProbe.committed = paint;
                    this._textProbe.baseContext = next;
                    this._textProbe.hover = null;
                }
                this.armTextProbe(next);
                if (this._textProbe) {
                    this._textProbe.committed = paint;
                    this._paintTextProbe();
                }
            };
            /**
             * Build committed context: markup via Range when nested elements
             * are crossed; nest path under textRoot stays in the >> fan-out.
             * heads e.g. char·word·text·inner-html or text-html·text·inner-html
             */
            const buildAndCommit = ({
                start,
                end,
                heads,
                label,
                virtual,
                kind,
                wordSpan,
                phraseSpan,
                charIndex,
                paint,
            }) => {
                const meta = this._textRangeMeta(root, start, end);
                const value = meta.hasMarkup ? meta.html : meta.plain;
                const useHeads = meta.hasMarkup
                    ? [
                          "text-html",
                          ...heads.filter(
                              (h) => h !== "text-html" && h !== "char"
                          ),
                      ]
                    : heads;
                // Ensure text + inner-html present for writeback claims.
                const normHeads = [];
                for (const h of useHeads) {
                    if (h && !normHeads.includes(h)) normHeads.push(h);
                }
                if (!normHeads.includes("text")) {
                    const i = normHeads.indexOf("text-html");
                    normHeads.splice(i >= 0 ? i + 1 : 0, 0, "text");
                }
                if (!normHeads.includes("inner-html")) {
                    normHeads.push("inner-html");
                }
                const next = virtualTextSelectContext(base, {
                    attrPart: "inner-html",
                    value,
                    virtual: meta.hasMarkup ? "text-html" : virtual,
                    label: meta.hasMarkup
                        ? `text-html ${start}-${end}`
                        : label,
                    extraHeads: normHeads.filter(
                        (h) => h !== "text" && h !== "inner-html"
                    ),
                });
                // virtualTextSelectContext builds text·inner-html·extras >> prior;
                // replace with explicit heads + child nest + host tail.
                const tail = hostTail();
                const child = meta.childTypes.filter(
                    (t) => t && !TEXT_HEADS.has(t)
                );
                next.types = [
                    ...normHeads,
                    ...(child.length ? [NEST_BREAK, ...child] : []),
                    ...tail,
                ];
                // Dedup >> 
                const cleaned = [];
                for (const t of next.types) {
                    if (
                        t === NEST_BREAK &&
                        cleaned[cleaned.length - 1] === NEST_BREAK
                    ) {
                        continue;
                    }
                    cleaned.push(t);
                }
                next.types = cleaned;
                next.kind = meta.hasMarkup ? "text-html" : kind;
                next.textRoot = root;
                next.textSpan = {
                    start,
                    end,
                    text: meta.plain,
                    html: meta.hasMarkup ? meta.html : null,
                };
                // Priority: char > word > phrase — never let phrase clobber char/word.
                const k = meta.hasMarkup ? "text-html" : kind;
                if (k === "char") {
                    next.phraseSpan = null;
                    next.wordSpan = wordSpan || null;
                    next.charIndex = charIndex ?? null;
                    const pi = normHeads.indexOf("phrase");
                    if (pi >= 0) normHeads.splice(pi, 1);
                    next.types = [
                        ...normHeads,
                        ...(child.length ? [NEST_BREAK, ...child] : []),
                        ...tail,
                    ];
                } else if (k === "word") {
                    next.phraseSpan = null;
                    next.wordSpan = wordSpan || null;
                    next.charIndex = null;
                    const pi = normHeads.indexOf("phrase");
                    if (pi >= 0) normHeads.splice(pi, 1);
                    next.types = [
                        ...normHeads,
                        ...(child.length ? [NEST_BREAK, ...child] : []),
                        ...tail,
                    ];
                } else if (k === "phrase") {
                    next.phraseSpan =
                        phraseSpan || this._phraseSpan(full, start, end);
                    next.wordSpan = null;
                    next.charIndex = null;
                    const wi = normHeads.indexOf("word");
                    if (wi >= 0) normHeads.splice(wi, 1);
                    if (!normHeads.includes("phrase")) {
                        normHeads.unshift("phrase");
                    }
                    next.types = [
                        ...normHeads,
                        ...(child.length ? [NEST_BREAK, ...child] : []),
                        ...tail,
                    ];
                } else {
                    next.phraseSpan = null;
                    next.wordSpan = wordSpan || null;
                    next.charIndex = charIndex ?? null;
                }
                // Dedup >> again after head tweaks
                {
                    const c2 = [];
                    for (const t of next.types) {
                        if (
                            t === NEST_BREAK &&
                            c2[c2.length - 1] === NEST_BREAK
                        ) {
                            continue;
                        }
                        c2.push(t);
                    }
                    next.types = c2;
                }
                next.value = value;
                next.text = value;
                next.hasMarkup = meta.hasMarkup;
                // Legend: leaf → stage host when known, else leaf → text root.
                const stageHost =
                    base.hostElement instanceof HTMLElement
                        ? base.hostElement
                        : base.element instanceof HTMLElement
                          ? base.element
                          : root;
                next.nesting = this._buildNesting(meta.leafEl, stageHost);
                next.element = meta.leafEl;
                applyCommit(next, paint);
            };

            if (dragRange && dragRange.end > dragRange.start) {
                const start = dragRange.start;
                const end = dragRange.end;
                const words = this._wordSpans(full);
                // Full-span drag (select-all) — never treat length-1 full text as char click.
                const isFullSelect = start === 0 && end === full.length;
                // Priority: char > word > phrase > text
                // One-glyph "drag" is a click (char 0→1 caret jitter). Keep char.
                if (!isFullSelect && end - start === 1) {
                    const containing = words.find(
                        (w) => start >= w.start && start < w.end
                    );
                    if (containing) {
                        const ch = full[start] || "";
                        buildAndCommit({
                            start,
                            end: start + 1,
                            heads: ["char", "word", "text", "inner-html"],
                            label: `char ${start - containing.start} '${ch}'`,
                            virtual: "char",
                            kind: "char",
                            wordSpan: {
                                start: containing.start,
                                end: containing.end,
                                text: containing.text,
                            },
                            phraseSpan: null,
                            charIndex: start - containing.start,
                            paint: {
                                word: {
                                    ...containing,
                                    rects: this._rangeRects(
                                        root,
                                        containing.start,
                                        containing.end
                                    ),
                                },
                                char: {
                                    index: start - containing.start,
                                    abs: start,
                                    text: ch,
                                    rects: this._rangeRects(
                                        root,
                                        start,
                                        start + 1
                                    ),
                                },
                                phrase: null,
                                range: null,
                            },
                        });
                        return;
                    }
                }
                const exactWord = words.find(
                    (w) => w.start === start && w.end === end
                );
                const containing = words.find(
                    (w) => start >= w.start && end <= w.end
                );
                const rangeRects = this._rangeRects(root, start, end);

                // Exact full word, or any selection wholly inside one word.
                if (exactWord || containing) {
                    const w = exactWord || containing;
                    const isExact = !!exactWord;
                    buildAndCommit({
                        start,
                        end,
                        heads: isExact
                            ? ["word", "text", "inner-html"]
                            : ["text", "word", "inner-html"],
                        label: isExact ? w.text : `text ${start}-${end}`,
                        virtual: isExact ? "word" : "text",
                        kind: isExact ? "word" : "text",
                        wordSpan: {
                            start: w.start,
                            end: w.end,
                            text: w.text,
                        },
                        phraseSpan: null,
                        charIndex: null,
                        paint: {
                            word: {
                                ...w,
                                rects: this._rangeRects(root, w.start, w.end),
                            },
                            char: null,
                            phrase: null,
                            range: isExact
                                ? null
                                : { start, end, rects: rangeRects },
                        },
                    });
                    return;
                }

                const phraseSpan = this._phraseSpan(full, start, end);
                if (phraseSpan) {
                    const phrasePaint =
                        this._phrasePaintPack(root, full, start, end) || {
                            word: null,
                            char: null,
                            phrase: null,
                            range: { start, end, rects: rangeRects },
                        };
                    buildAndCommit({
                        start,
                        end,
                        heads: ["phrase", "text", "inner-html"],
                        label:
                            (phraseSpan.text || "").trim() ||
                            `phrase ${start}-${end}`,
                        virtual: "phrase",
                        kind: "phrase",
                        wordSpan: null,
                        phraseSpan,
                        charIndex: null,
                        paint: phrasePaint,
                    });
                    return;
                }
                buildAndCommit({
                    start,
                    end,
                    heads: ["text", "inner-html"],
                    label: `text ${start}-${end}`,
                    virtual: "text",
                    kind: "text",
                    wordSpan: null,
                    phraseSpan: null,
                    charIndex: null,
                    paint: {
                        word: null,
                        char: null,
                        phrase: null,
                        range: { start, end, rects: rangeRects },
                    },
                });
                return;
            }

            if (!hover?.word) return;
            const w = hover.word;
            if (hover.char) {
                const i = hover.char.abs;
                const ch = hover.char.text || full[i] || "";
                buildAndCommit({
                    start: i,
                    end: i + 1,
                    heads: ["char", "word", "text", "inner-html"],
                    label: `char ${hover.char.index} '${ch}'`,
                    virtual: "char",
                    kind: "char",
                    wordSpan: {
                        start: w.start,
                        end: w.end,
                        text: w.text,
                    },
                    phraseSpan: null,
                    charIndex: hover.char.index,
                    paint: {
                        word: {
                            ...w,
                            rects:
                                w.rects ||
                                this._rangeRects(root, w.start, w.end),
                        },
                        char: {
                            ...hover.char,
                            rects:
                                hover.char.rects ||
                                this._rangeRects(root, i, i + 1),
                        },
                        phrase: null,
                        range: null,
                    },
                });
                return;
            }
            buildAndCommit({
                start: w.start,
                end: w.end,
                heads: ["word", "text", "inner-html"],
                label: w.text,
                virtual: "word",
                kind: "word",
                wordSpan: {
                    start: w.start,
                    end: w.end,
                    text: w.text,
                },
                phraseSpan: null,
                charIndex: null,
                paint: {
                    word: {
                        ...w,
                        rects:
                            w.rects ||
                            this._rangeRects(root, w.start, w.end),
                    },
                    char: null,
                    phrase: null,
                    range: null,
                },
            });
        }

        /** True when target is under a stage occupant (stage-member), not bare zone. */
        _eventOnStageMember(target) {
            const loc = this.locate(target);
            return !!(loc && loc.itemEl);
        }

        _isEmbedFrame(el) {
            if (!(el instanceof HTMLElement)) return false;
            const tag = String(el.tagName || "").toLowerCase();
            return (
                tag === "iframe" ||
                tag === "embed" ||
                tag === "object" ||
                tag === "frame"
            );
        }

        /**
         * Physical overlays on top of iframes/embeds (and iframe-as-member).
         * pointer-events:none is not enough — cross-origin frames still eat
         * hits, and PE:none on an iframe *member* makes it unselectable.
         */
        _syncHoldOverlays() {
            if (!isBrowser || !this.holding) return;
            if (!this._holdOverlays) this._holdOverlays = new Map();
            if (!this._shieldOverlayOwner) this._shieldOverlayOwner = new WeakMap();

            const alive = new Set();

            const placeOverlay = (frame, itemEl, host) => {
                let rec = this._holdOverlays.get(frame);
                const useFixed = !(host instanceof HTMLElement);
                if (!rec) {
                    const overlay = document.createElement("div");
                    overlay.setAttribute("data-stagejockey-shield", "1");
                    overlay.setAttribute("data-jockey-ui", "stagejockey-shield");
                    overlay.style.cssText = [
                        useFixed ? "position:fixed" : "position:absolute",
                        "left:0",
                        "top:0",
                        "width:0",
                        "height:0",
                        "z-index:2147483646",
                        "background:transparent",
                        "pointer-events:auto",
                        "cursor:inherit",
                    ].join(";");
                    const prevPosition =
                        host instanceof HTMLElement
                            ? host.style.position || ""
                            : "";
                    if (host instanceof HTMLElement) {
                        const cs = window.getComputedStyle(host);
                        if (!cs.position || cs.position === "static") {
                            host.style.position = "relative";
                        }
                        host.appendChild(overlay);
                    } else {
                        document.body.appendChild(overlay);
                    }
                    this._shieldOverlayOwner.set(overlay, itemEl);
                    rec = { overlay, host, prevPosition, frame, useFixed };
                    this._holdOverlays.set(frame, rec);
                }
                const { overlay } = rec;
                if (!(overlay instanceof HTMLElement)) return;
                const fr = frame.getBoundingClientRect();
                if (rec.useFixed || useFixed) {
                    overlay.style.position = "fixed";
                    overlay.style.left = `${Math.round(fr.left)}px`;
                    overlay.style.top = `${Math.round(fr.top)}px`;
                    if (
                        overlay.parentElement !== document.body &&
                        document.body
                    ) {
                        document.body.appendChild(overlay);
                    }
                } else if (host instanceof HTMLElement) {
                    if (!host.contains(overlay)) {
                        try {
                            host.appendChild(overlay);
                        } catch (_) {
                            return;
                        }
                    }
                    const hr = host.getBoundingClientRect();
                    const left = fr.left - hr.left + host.scrollLeft;
                    const top = fr.top - hr.top + host.scrollTop;
                    overlay.style.left = `${Math.round(left)}px`;
                    overlay.style.top = `${Math.round(top)}px`;
                }
                overlay.style.width = `${Math.max(0, Math.round(fr.width))}px`;
                overlay.style.height = `${Math.max(0, Math.round(fr.height))}px`;
                alive.add(frame);
            };

            for (const zone of zoneColumns()) {
                for (const item of Array.from(zone.children)) {
                    if (!(item instanceof HTMLElement)) continue;
                    if (isStageMemberSeparator(item)) continue;
                    if (item.hasAttribute("data-stagejockey-shield")) continue;
                    if (this._isEmbedFrame(item)) {
                        // iframe is the occupant — fixed overlay on body (not a
                        // zone child; that would pollute stage kid indexing).
                        placeOverlay(item, item, null);
                        continue;
                    }
                    for (const frame of item.querySelectorAll(
                        "iframe, embed, object, frame"
                    )) {
                        if (!(frame instanceof HTMLElement)) continue;
                        placeOverlay(frame, item, item);
                    }
                }
            }

            for (const [frame, rec] of [...this._holdOverlays.entries()]) {
                if (alive.has(frame)) continue;
                try {
                    rec.overlay?.remove?.();
                } catch (_) {
                    /* ignore */
                }
                if (
                    rec.host instanceof HTMLElement &&
                    rec.prevPosition != null &&
                    !rec.host.querySelector("[data-stagejockey-shield]")
                ) {
                    rec.host.style.position = rec.prevPosition;
                }
                this._holdOverlays.delete(frame);
            }
        }

        _clearHoldOverlays() {
            if (this._holdOverlays) {
                for (const rec of this._holdOverlays.values()) {
                    try {
                        rec.overlay?.remove?.();
                    } catch (_) {
                        /* ignore */
                    }
                    if (
                        rec.host instanceof HTMLElement &&
                        rec.prevPosition != null
                    ) {
                        rec.host.style.position = rec.prevPosition;
                    }
                }
                this._holdOverlays.clear();
                this._holdOverlays = null;
            }
            this._shieldOverlayOwner = null;
        }

        /** Resolve shield overlay hits to the real stage item. */
        _itemFromShieldTarget(target) {
            if (!target || !this._shieldOverlayOwner) return null;
            const el =
                target.nodeType === 1 ? target : target.parentElement;
            const shield =
                el?.closest?.("[data-stagejockey-shield]") || null;
            if (!shield) return null;
            const item = this._shieldOverlayOwner.get(shield);
            return item instanceof HTMLElement ? item : null;
        }

        /**
         * While right-hold: hard-block member UI (links, forms, htmx, focus)
         * and cover embeds with overlays so picks never enter frame documents.
         *
         * Listeners attach to window capture so they run *before* document
         * handlers (htmx, etc.). Left-button pick is applied here directly —
         * stopPropagation intentionally keeps those document listeners inert.
         * Right-button still reaches supermouse for the hold. Middle-button on
         * a stage member is opaque to the occupant (stopPropagation) and
         * forwarded to onMiddleClick / onMiddleUp here, because window capture
         * would otherwise starve document supermouse.
         */
        _setMemberShield(on) {
            if (!isBrowser) return;
            if (!on) {
                // Claim execute often terminate()s the hold before auxclick fires.
                // Keep the shield until middle-gesture opaque clears.
                if (this._middleGestureOpaque) {
                    this._shieldRemovePending = true;
                    return;
                }
                this._shieldRemovePending = false;
            }
            if (on) {
                this._shieldRemovePending = false;
                try {
                    document.documentElement.setAttribute(
                        "data-stagejockey-hold",
                        "1"
                    );
                } catch (_) {
                    /* ignore */
                }
                this._syncHoldOverlays();
                if (!this._memberShieldHandler) {
                    this._memberShieldHandler = (e) => {
                        if (!this.enabled) return;
                        if (!this.holding && !this._middleGestureOpaque) return;
                        const btn =
                            typeof e.button === "number" ? e.button : null;
                        const leftish =
                            btn === 0 ||
                            (btn == null &&
                                (e.type === "click" ||
                                    e.type === "dblclick" ||
                                    e.type === "dragstart"));
                        // Left only while actively holding (not post-terminate opaque).
                        if (leftish && !this.holding) return;
                        if (leftish && !this._preventLeftDefault()) return;

                        // Right must still reach supermouse (hold / rightup).
                        if (btn === 2) return;

                        if (!this._eventOnStageMember(e.target)) return;
                        if (
                            e.target?.closest?.(CHROME_SEL) &&
                            !e.target?.closest?.("[data-stagejockey-shield]")
                        ) {
                            return;
                        }

                        // Middle on a stage member: opaque to the occupant
                        // (e.g. nexus-sphere auxclick), but still drive claims.
                        // Window capture runs before document supermouse, so we
                        // stopPropagation and invoke the handlers ourselves.
                        // Stays opaque through claim eval/terminate until
                        // _middleGestureOpaque clears (trailing auxclick).
                        if (btn === 1) {
                            e.preventDefault();
                            e.stopPropagation();
                            if (!this.holding) {
                                // Post-terminate: only eat trailing middle events.
                                if (e.type === "auxclick") {
                                    this._clearMiddleGestureOpaque();
                                }
                                return;
                            }
                            const midCtx = {
                                type:
                                    e.type === "mouseup" ||
                                    e.type === "pointerup"
                                        ? "middleup"
                                        : "middleclick",
                                event: e,
                                target: e.target,
                                x: e.clientX,
                                y: e.clientY,
                                preventDefault: () => {
                                    try {
                                        e.preventDefault();
                                    } catch {
                                        /* ignore */
                                    }
                                },
                                stopPropagation: () => {
                                    try {
                                        e.stopPropagation();
                                    } catch {
                                        /* ignore */
                                    }
                                },
                            };
                            if (
                                e.type === "mousedown" ||
                                e.type === "pointerdown"
                            ) {
                                this.onMiddleClick(midCtx);
                            } else if (
                                e.type === "mouseup" ||
                                e.type === "pointerup"
                            ) {
                                this.onMiddleUp(midCtx);
                            } else if (e.type === "auxclick") {
                                // Eat; release handled by execute finally / timeout.
                            }
                            return;
                        }

                        e.preventDefault();
                        e.stopPropagation();

                        const isDown =
                            (e.type === "mousedown" ||
                                e.type === "pointerdown") &&
                            (e.button === 0 || e.button == null);
                        const isUp =
                            (e.type === "mouseup" || e.type === "pointerup") &&
                            (e.button === 0 || e.button == null);

                        // Text probe owns left-button while armed — do NOT
                        // setSelect (that was wiping char commit back to cs[0]).
                        if (this._textProbe?.root) {
                            if (isDown) {
                                const hover = this._probeTextAt(
                                    e.clientX,
                                    e.clientY
                                );
                                if (hover) {
                                    this._textProbePointerDown(
                                        e.clientX,
                                        e.clientY
                                    );
                                } else {
                                    // Outside text root — leave probe, pick occupant.
                                    this.clearTextProbe();
                                    const loc = this.locate(e.target);
                                    if (loc) this.setSelect(loc);
                                }
                            } else if (isUp) {
                                this._textProbePointerUp(e.clientX, e.clientY);
                            }
                            return;
                        }

                        // Manual red-select — document supermouse never sees this.
                        // Left-click picks; left-press+drag on an *existing* red-select
                        // is jockey-move's pointer (not the scrollbuffer claim).
                        if (isDown) {
                            const loc = this.locate(e.target);
                            if (this.select) {
                                this._beginRedselectDrag(e.clientX, e.clientY);
                            } else if (loc) {
                                this.setSelect(loc);
                            }
                        }
                    };
                    const types = [
                        "click",
                        "auxclick",
                        "dblclick",
                        "mousedown",
                        "mouseup",
                        "pointerdown",
                        "pointerup",
                        "pointercancel",
                        "dragstart",
                        "drop",
                        "submit",
                        "focusin",
                        "beforeinput",
                    ];
                    for (const t of types) {
                        window.addEventListener(
                            t,
                            this._memberShieldHandler,
                            true
                        );
                    }
                    this._memberShieldTypes = types;
                }
            } else {
                try {
                    document.documentElement.removeAttribute(
                        "data-stagejockey-hold"
                    );
                } catch (_) {
                    /* ignore */
                }
                if (this._memberShieldHandler && this._memberShieldTypes) {
                    for (const t of this._memberShieldTypes) {
                        window.removeEventListener(
                            t,
                            this._memberShieldHandler,
                            true
                        );
                    }
                    this._memberShieldHandler = null;
                    this._memberShieldTypes = null;
                }
                this._clearHoldOverlays();
            }
        }

        clearDropdownPick() {
            this.dropdownContext = null;
            this._selectOutlineSuppressed = false;
            if (!this.holding) {
                this.select = null;
                this.hover = null;
                this._setMemberShield(false);
                this._clearOutlines();
                this.persistLive({ via: { kind: "clear-dropdown" } });
            }
        }

        /**
         * Sync scrollbuffer context from a locate() hit (no presentationAt).
         */
        contextFromLoc(loc) {
            if (!loc) return null;
            if (!loc.itemEl) {
                return {
                    types: ["stage_zone"],
                    kind: "stage_zone",
                    label: loc.slot,
                    slot: loc.slot,
                    index: null,
                    element: loc.zoneEl,
                };
            }

            const stage = resolveStageDir()?.stage;
            let presentation = null;
            try {
                if (typeof stage?.presentationFor === "function") {
                    presentation = stage.presentationFor(loc.itemEl);
                }
            } catch {
                /* ignore */
            }
            if (!presentation) {
                presentation = (() => {
                    const o = { value: loc.itemEl.outerHTML };
                    const stamped = loc.itemEl.getAttribute?.("data-part");
                    if (stamped) o.type = String(stamped).toLowerCase();
                    return o;
                })();
            }

            return this._contextFromOccupantPick(loc, presentation);
        }

        /**
         * Nesting fan-out for a stage occupant pick.
         * Deep child dive only when −1 nest (html) is armed on that host.
         */
        _contextFromOccupantPick(loc, presentation) {
            const itemEl = loc.itemEl;
            if (!(itemEl instanceof HTMLElement)) return null;

            const rawPart =
                presentation?.type ||
                itemEl.getAttribute?.("data-part") ||
                "";
            const parentParts = partNamesFrom(rawPart);
            const part = parentParts.join(" ");

            const nestedOn = this._nestDiveEnabled();
            let focusEl = itemEl;
            if (
                nestedOn &&
                loc.targetEl &&
                loc.targetEl !== itemEl &&
                itemEl.contains?.(loc.targetEl)
            ) {
                focusEl = loc.targetEl;
            }

            const nesting = this._buildNesting(focusEl, itemEl);
            let types = this._typesFromNesting(nesting);
            const deep = focusEl !== itemEl;

            // Nest session: child types under nest host >> nest host…stage
            if (deep && this.nestSession?.kind === "html") {
                const nestHost = this.nestSession.hostElement;
                if (
                    nestHost instanceof HTMLElement &&
                    (nestHost === itemEl || itemEl.contains(nestHost))
                ) {
                    const hostIdx = nesting.findIndex((L) => L.el === nestHost);
                    if (hostIdx > 0) {
                        const childLayers = nesting.slice(0, hostIdx);
                        const rightLayers = nesting.slice(hostIdx);
                        const left = [];
                        for (let i = 0; i < childLayers.length; i++) {
                            left.push(
                                ...layerBindTypes(
                                    childLayers[i],
                                    i,
                                    childLayers.length + rightLayers.length
                                )
                            );
                        }
                        const right = [];
                        for (let i = 0; i < rightLayers.length; i++) {
                            right.push(
                                ...layerBindTypes(
                                    rightLayers[i],
                                    i,
                                    rightLayers.length
                                )
                            );
                        }
                        types = [...left, NEST_BREAK, ...right];
                    }
                }
            }

            let pathAttr = "";
            for (const layer of nesting) {
                if (layer.path) {
                    pathAttr = layer.path;
                    break;
                }
            }
            if (!pathAttr) {
                pathAttr = itemEl.getAttribute?.("data-path") || "";
            }
            pathAttr = String(pathAttr || "")
                .trim()
                .replace(/^\/+/, "");

            const hrefVal =
                presentation?.type === "href" || parentParts.includes("href")
                    ? String(presentation?.value || presentation?.href || "")
                          .trim()
                          .replace(/^\/+/, "")
                    : "";

            if (deep) {
                return {
                    types,
                    kind: "htm-element",
                    nest: this.nestSession
                        ? { ...this.nestSession }
                        : null,
                    // Tag lives in types / legend — same label shape as host pick.
                    label: `${loc.slot}[${loc.index}]`,
                    slot: loc.slot,
                    index: loc.index,
                    ...(part ? { part } : {}),
                    path: pathAttr || undefined,
                    dataPath: pathAttr || undefined,
                    nesting,
                    presentation: {
                        type: stripStageMember(
                            typesForClaims(types)
                        ).join(" "),
                        value: focusEl.outerHTML,
                        ...(pathAttr ? { path: pathAttr } : {}),
                    },
                    element: focusEl,
                    hostElement: itemEl,
                    zoneElement: loc.zoneEl,
                };
            }

            return {
                types,
                kind: STAGE_MEMBER,
                label: `${loc.slot}[${loc.index}]`,
                slot: loc.slot,
                index: loc.index,
                ...(part ? { part } : {}),
                ...(hrefVal
                    ? { href: hrefVal, path: hrefVal, dataPath: hrefVal }
                    : pathAttr
                      ? { path: pathAttr, dataPath: pathAttr }
                      : {}),
                nesting,
                presentation: presentation
                    ? part
                        ? { ...presentation, type: part }
                        : { ...presentation }
                    : part
                      ? { type: part, value: itemEl.outerHTML }
                      : { value: itemEl.outerHTML },
                element: itemEl,
                zoneElement: loc.zoneEl,
                hostElement: itemEl,
            };
        }

        /** Occupant root is always an HTMLElement when locate finds an item. */
        _occupantIsHtml(itemEl) {
            return itemEl instanceof HTMLElement;
        }

        _isChrome(el) {
            if (!(el instanceof HTMLElement)) return false;
            try {
                return !!el.closest?.(CHROME_SEL);
            } catch {
                return false;
            }
        }

        /**
         * Deepest non-chrome element under cursor inside itemEl (leaf).
         * Does not snap to data-part/data-path ancestors.
         */
        _resolveHtmlTarget(itemEl, eventTarget) {
            if (!(itemEl instanceof HTMLElement) || !eventTarget) return null;

            let cur =
                eventTarget.nodeType === 1
                    ? eventTarget
                    : eventTarget.parentElement;
            if (!cur) return null;

            while (cur && cur !== itemEl && !itemEl.contains(cur)) {
                cur = cur.parentElement;
            }
            if (!cur || cur === itemEl || !itemEl.contains(cur)) return null;
            if (this._isChrome(cur)) return null;
            return cur;
        }

        /**
         * Nesting layers deepest → shallowest from targetEl up through itemEl.
         * @returns {Array<{ el: Element, tag: string, tagPart: string, parts: string[], name: string|null, path: string|null, label: string }>}
         */
        _buildNesting(targetEl, itemEl) {
            if (!(targetEl instanceof HTMLElement) || !(itemEl instanceof HTMLElement)) {
                return [];
            }
            const layers = [];
            let cur = targetEl;
            while (cur && (itemEl === cur || itemEl.contains(cur))) {
                const tag = String(cur.tagName || "div").toLowerCase();
                const tagPart = htmTagType(tag);
                const parts = partNamesFrom(
                    cur.getAttribute?.("data-part") || ""
                );
                const nameRaw = cur.getAttribute?.("name");
                const name = nameRaw != null && String(nameRaw).trim()
                    ? String(nameRaw).trim()
                    : null;
                const pathRaw = String(cur.getAttribute?.("data-path") || "")
                    .trim()
                    .replace(/^\/+/, "");
                const path = pathRaw || null;
                const labelParts = [tagPart];
                if (name) labelParts.push(name);
                labelParts.push(...parts);
                layers.push({
                    el: cur,
                    tag,
                    tagPart,
                    parts,
                    name,
                    path,
                    label: labelParts.join(" "),
                });
                if (cur === itemEl) break;
                cur = cur.parentElement;
            }
            return layers;
        }

        /**
         * types deepest→host, one coherent block per nesting layer:
         *   leaf:     parts · htm-<tag> · htm-element
         *   ancestor: htm-<tag> · parts · htm-element
         *   host:     … · stage-member
         * e.g. rec-dot · htm-button · htm-element · htm-div · htmf · htm-element · stage-member
         */
        _typesFromNesting(nesting, _extraParts = []) {
            return typesFromNesting(nesting);
        }

        _clearOutlines() {
            // Snapshot before callers null hover/select.
            const refs = [this.hover, this.select];
            this._unmarkAll();
            // Scrub legacy inline outlines (older builds baked these into HTMF).
            for (const ref of refs) {
                if (!ref) continue;
                for (const el of [ref.zoneEl, ref.itemEl, ref.targetEl]) {
                    this._scrubInlineOutline(el);
                }
            }
        }

        /** Remove pick outlines written into el.style (must not survive hx swaps / localpark). */
        _scrubInlineOutline(el) {
            if (!el?.style) return;
            try {
                const o = String(el.style.outline || "");
                const off = String(el.style.outlineOffset || "");
                if (
                    off === "-1px" ||
                    /2px\s+solid/i.test(o) ||
                    o.toLowerCase().includes("solid")
                ) {
                    el.style.outline = "";
                    el.style.outlineOffset = "";
                }
            } catch (_) {
                /* ignore */
            }
        }

        _scrubSubtree(root) {
            if (!(root instanceof HTMLElement)) return;
            this._scrubInlineOutline(root);
            try {
                for (const el of root.querySelectorAll("*")) {
                    this._scrubInlineOutline(el);
                }
            } catch (_) {
                /* ignore */
            }
        }

        /**
         * Scrub stage + any HTMF/data-path trees (off-stage navigated tips included).
         * Old builds baked pick outlines into outerHTML → localpark/hx round-trips
         * re-show a "red select" with no live pick.
         */
        _scrubPollutedOutlinesInDocument() {
            if (!isBrowser) return;
            for (const zone of zoneColumns()) {
                this._scrubSubtree(zone);
            }
            try {
                const roots = document.querySelectorAll(
                    "[data-path], [data-part='htmf'], [data-hash]"
                );
                for (const el of roots) {
                    this._scrubSubtree(el);
                }
            } catch (_) {
                /* ignore */
            }
            // Orphan overlay chrome (map key lost after DOM replace).
            try {
                for (const ov of document.querySelectorAll(
                    "[data-stagejockey-mark], [data-stagejockey-mark-overlay]"
                )) {
                    try {
                        ov.remove();
                    } catch (_) {
                        /* ignore */
                    }
                }
            } catch (_) {
                /* ignore */
            }
            this._marked.clear();
        }

        /** @deprecated name — callers use document scrub now */
        _scrubPollutedOutlinesInStage() {
            this._scrubPollutedOutlinesInDocument();
        }

        /**
         * Drop hover/select when their DOM was replaced (e.g. welcome hx-swap).
         * Prevents _paint from re-applying red chrome onto a new tree.
         */
        _invalidateDisconnectedPicks() {
            const dead = (ref) => {
                if (!ref) return false;
                const el = ref.itemEl || ref.zoneEl || ref.targetEl;
                return el instanceof HTMLElement && !el.isConnected;
            };
            if (dead(this.hover)) this.hover = null;
            if (dead(this.select)) {
                this.select = null;
                this._selectOutlineSuppressed = false;
                this.dropdownContext = null;
                try {
                    this.scrollbuffer.clear();
                } catch (_) {
                    /* ignore */
                }
            }
        }

        /**
         * True if pick ref intersects a swapped root (or is disconnected).
         * Navigating HTMF invalidates pick even when the stage-member wrapper
         * stays connected around an outerHTML child swap.
         */
        _pickTouchesRoots(ref, roots) {
            if (!ref) return false;
            const els = [ref.itemEl, ref.targetEl, ref.zoneEl].filter(
                (el) => el instanceof HTMLElement
            );
            if (!els.length) return false;
            for (const el of els) {
                if (!el.isConnected) return true;
                for (const r of roots) {
                    if (!(r instanceof HTMLElement)) continue;
                    if (r === el || r.contains(el) || el.contains(r)) {
                        return true;
                    }
                }
            }
            return false;
        }

        _clearPickForNavigation() {
            this.hover = null;
            this.select = null;
            this._selectOutlineSuppressed = false;
            this.dropdownContext = null;
            try {
                this.scrollbuffer.clear();
            } catch (_) {
                /* ignore */
            }
            this._unmarkAll();
        }

        _ensureMarkStyle() {
            if (!isBrowser) return;
            let s = document.getElementById("stagejockey-mark-style");
            if (!(s instanceof HTMLStyleElement)) {
                s = document.createElement("style");
                s.id = "stagejockey-mark-style";
                (document.head || document.documentElement).appendChild(s);
            }
            // Always refresh — remounts must not keep a prior empty/old rule set.
            s.textContent = `
#stagejockey-mark-layer{
  position:fixed !important;
  inset:0 !important;
  width:auto !important;
  height:auto !important;
  margin:0 !important;
  padding:0 !important;
  overflow:visible !important;
  pointer-events:none !important;
  z-index:2147483645 !important;
  background:transparent !important;
  border:none !important;
}
span[data-stagejockey-mark]{
  position:absolute !important;
  pointer-events:none !important;
  box-sizing:border-box !important;
  margin:0 !important;
  padding:0 !important;
  display:block !important;
  background:transparent !important;
}
`;
        }

        /** Ephemeral chrome host — full viewport, never under HTMF. */
        _markLayer() {
            if (!isBrowser) return null;
            this._ensureMarkStyle();
            let layer = document.getElementById("stagejockey-mark-layer");
            if (!(layer instanceof HTMLElement)) {
                layer = document.createElement("div");
                layer.id = "stagejockey-mark-layer";
                layer.setAttribute("data-jockey-ui", "stagejockey-mark-layer");
                (document.body || document.documentElement).appendChild(layer);
            } else if (
                document.body &&
                layer.parentElement !== document.body
            ) {
                document.body.appendChild(layer);
            }
            return layer;
        }

        /**
         * Draw pick chrome with a temporary <span> in #stagejockey-mark-layer.
         * Never mutates the target HTMF/stage element (no style/outline bake).
         */
        _mark(el, color) {
            if (!el || !color || !isBrowser) return;
            const layer = this._markLayer();
            if (!layer) return;
            let span = this._marked.get(el);
            if (!(span instanceof HTMLElement) || !span.isConnected) {
                if (span instanceof HTMLElement) {
                    try {
                        span.remove();
                    } catch (_) {
                        /* ignore */
                    }
                }
                span = document.createElement("span");
                span.setAttribute("data-stagejockey-mark", "1");
                span.setAttribute("data-jockey-ui", "stagejockey-mark");
                layer.appendChild(span);
                this._marked.set(el, span);
            } else if (span.parentElement !== layer) {
                layer.appendChild(span);
            }
            try {
                const r = el.getBoundingClientRect();
                const w = Math.max(0, Math.round(r.width));
                const h = Math.max(0, Math.round(r.height));
                // Inline layout so chrome stays visible even if stylesheet is stale.
                span.style.cssText = [
                    "position:absolute",
                    `left:${Math.round(r.left)}px`,
                    `top:${Math.round(r.top)}px`,
                    `width:${w}px`,
                    `height:${h}px`,
                    `border:2px solid ${color}`,
                    "box-sizing:border-box",
                    "margin:0",
                    "padding:0",
                    "pointer-events:none",
                    "display:block",
                    "background:transparent",
                ].join(";");
            } catch (_) {
                /* ignore */
            }
        }

        /**
         * Bind htmx / DOM swap cleanup so pick chrome never sticks on swapped HTMF.
         */
        _bindDomChromeCleanup() {
            if (!isBrowser || this._domChromeCleanupBound) return;
            this._domChromeCleanupBound = true;
            const onSwap = (ev) => {
                const detail = ev?.detail;
                const roots = [];
                if (ev?.target instanceof HTMLElement) roots.push(ev.target);
                if (detail?.target instanceof HTMLElement) {
                    roots.push(detail.target);
                }
                if (detail?.elt instanceof HTMLElement) roots.push(detail.elt);
                for (const r of roots) this._scrubSubtree(r);
                this._scrubPollutedOutlinesInDocument();
                const touch =
                    this._pickTouchesRoots(this.select, roots) ||
                    this._pickTouchesRoots(this.hover, roots) ||
                    (this.select &&
                        this.select.itemEl instanceof HTMLElement &&
                        !this.select.itemEl.isConnected) ||
                    this._selectOutlineSuppressed;
                if (touch) {
                    this._clearPickForNavigation();
                } else {
                    this._invalidateDisconnectedPicks();
                    this._unmarkAll();
                }
            };
            this._onDomChromeCleanup = onSwap;
            const root = document.body || document.documentElement;
            for (const ev of [
                "htmx:beforeSwap",
                "htmx:afterSwap",
                "htmx:afterSettle",
                "htmx:historyRestore",
            ]) {
                try {
                    root.addEventListener(ev, onSwap);
                } catch (_) {
                    /* ignore */
                }
            }
        }

        _unbindDomChromeCleanup() {
            if (!this._domChromeCleanupBound || !this._onDomChromeCleanup) return;
            const root = document.body || document.documentElement;
            for (const ev of [
                "htmx:beforeSwap",
                "htmx:afterSwap",
                "htmx:afterSettle",
                "htmx:historyRestore",
            ]) {
                try {
                    root.removeEventListener(ev, this._onDomChromeCleanup);
                } catch (_) {
                    /* ignore */
                }
            }
            this._domChromeCleanupBound = false;
            this._onDomChromeCleanup = null;
        }

        async loadSettings() {
            try {
                const stored = await navi.storage.item.get(SETTINGS_KEY);
                if (!stored || typeof stored !== "object") return;
                const forgetRaw = Number(stored.liveForgetAfter);
                this.settings = {
                    pick: stored.pick !== false,
                    prefPrefix: stored.prefPrefix !== false,
                    liveTrace: stored.liveTrace !== false,
                    liveForgetAfter: Number.isFinite(forgetRaw)
                        ? Math.max(0, Math.floor(forgetRaw))
                        : DEFAULT_SETTINGS.liveForgetAfter,
                    colorZone: stored.colorZone || DEFAULT_SETTINGS.colorZone,
                    colorItem: stored.colorItem || DEFAULT_SETTINGS.colorItem,
                    colorSelect: stored.colorSelect || DEFAULT_SETTINGS.colorSelect,
                    colorElementHover:
                        stored.colorElementHover ||
                        DEFAULT_SETTINGS.colorElementHover,
                    colorElementHoverBlue:
                        stored.colorElementHoverBlue ||
                        DEFAULT_SETTINGS.colorElementHoverBlue,
                    colorElementSelect:
                        stored.colorElementSelect ||
                        DEFAULT_SETTINGS.colorElementSelect,
                    colorNestHover:
                        stored.colorNestHover || DEFAULT_SETTINGS.colorNestHover,
                    colorNestSelect:
                        stored.colorNestSelect ||
                        DEFAULT_SETTINGS.colorNestSelect,
                };
            } catch (err) {
                console.error("[stagejockey] loadSettings failed", err);
            }
        }

        async saveSettings() {
            try {
                await navi.storage.item.set(SETTINGS_KEY, { ...this.settings });
            } catch (err) {
                console.error("[stagejockey] saveSettings failed", err);
            }
        }

        /** DOM-free context for tip graphs (types / path / text span). */
        _packContext(ctx) {
            if (!ctx || typeof ctx !== "object") return null;
            const el =
                ctx.element instanceof HTMLElement
                    ? ctx.element
                    : ctx.hostElement instanceof HTMLElement
                      ? ctx.hostElement
                      : ctx.textRoot instanceof HTMLElement
                        ? ctx.textRoot
                        : null;
            const path =
                (el && el.getAttribute?.("data-path")) ||
                (typeof ctx.path === "string" ? ctx.path : "") ||
                "";
            return {
                kind: ctx.kind || null,
                types: Array.isArray(ctx.types) ? ctx.types.map(String) : [],
                label: ctx.label != null ? String(ctx.label) : null,
                slot: ctx.slot ?? null,
                index: ctx.index ?? null,
                virtual: ctx.virtual || null,
                attrPart: ctx.attrPart || null,
                path: path || null,
                textSpan: ctx.textSpan
                    ? {
                          start: Number(ctx.textSpan.start) || 0,
                          end: Number(ctx.textSpan.end) || 0,
                          text:
                              ctx.textSpan.text != null
                                  ? String(ctx.textSpan.text).slice(0, 240)
                                  : null,
                      }
                    : null,
            };
        }

        _packLoc(ref) {
            if (!ref) return null;
            const el =
                ref.itemEl instanceof HTMLElement
                    ? ref.itemEl
                    : ref.targetEl instanceof HTMLElement
                      ? ref.targetEl
                      : null;
            return {
                slot: ref.slot,
                index: ref.index,
                path: el?.getAttribute?.("data-path") || null,
                part: el?.getAttribute?.("data-part") || null,
            };
        }

        _beginLiveInteraction(kind = "hold") {
            const id = `i${Date.now().toString(36)}_${Math.floor(
                Math.random() * 0x10000
            )
                .toString(16)
                .padStart(4, "0")}`;
            this._liveInteractionId = id;
            this._liveInteractionKind = String(kind || "hold");
            if (!Array.isArray(this._liveInteractionRing)) {
                this._liveInteractionRing = [];
            }
            this._liveInteractionRing.push(id);
            const keep = Math.max(
                0,
                Number(this.settings.liveForgetAfter) || 0
            );
            // Retain the last `keep` interactions (+ current already pushed).
            while (
                keep > 0 &&
                this._liveInteractionRing.length > keep
            ) {
                this._liveInteractionRing.shift();
            }
            if (keep === 0) {
                // Never auto-forget: still track current for labeling only.
                this._liveInteractionRing = [id];
            }
            return id;
        }

        _enqueueLiveWrite(job) {
            const run = () => Promise.resolve().then(job);
            this._liveWriteChain = (this._liveWriteChain || Promise.resolve())
                .then(run)
                .catch((err) => {
                    console.error("[stagejockey] live tip write failed", err);
                });
            return this._liveWriteChain;
        }

        /**
         * Mut8 supermouse_stagejockey_live with a traceable selection/claim
         * snapshot. Serialized (no racing n forks). Skips hover-only noise.
         * @param {{ via?: object, startInteraction?: string }} [opts]
         */
        persistLive(opts = {}) {
            if (this.settings.liveTrace === false) return;
            if (!navi?.storage?.item?.set) return;

            if (opts.startInteraction) {
                this._beginLiveInteraction(opts.startInteraction);
            } else if (!this._liveInteractionId) {
                this._beginLiveInteraction("anon");
            }

            const via = opts.via || null;
            const interactionId = this._liveInteractionId;
            const keepIds = new Set(this._liveInteractionRing || []);
            const forgetAfter = Math.max(
                0,
                Number(this.settings.liveForgetAfter) || 0
            );

            const pack = (ref) => this._packLoc(ref);
            const sb = this.scrollbuffer;
            const history = Array.isArray(sb?.history)
                ? sb.history.map((h) => ({
                      via: h?.via || null,
                      context: this._packContext(h?.context),
                  }))
                : [];
            const claims = [];
            if (sb?.entries && typeof sb.entries.forEach === "function") {
                sb.entries.forEach((entry, position) => {
                    if (!entry || position === 0) return;
                    claims.push({
                        position,
                        pluginId: entry.pluginId || null,
                        claimId: entry.claimId || null,
                        text: entry.text || "",
                        direction: entry.direction,
                        boundType: entry.boundType || null,
                    });
                });
            }

            const payload = {
                parts: ["stagejockey_live", "interaction", "json"],
                interactionId,
                interactionKind: this._liveInteractionKind || null,
                via,
                at: new Date().toISOString(),
                holding: !!this.holding,
                hover: pack(this.hover),
                select: pack(this.select),
                scrollbuffer: sb?.snapshot?.() || null,
                context: this._packContext(sb?.context),
                history,
                claims,
            };

            this._enqueueLiveWrite(async () => {
                await navi.storage.item.set(LIVE_KEY, payload);
                if (forgetAfter > 0) {
                    await this._pruneLiveFrames(keepIds);
                }
            });
        }

        /**
         * Delete live tip frames whose interactionId is outside the keep ring
         * (and legacy frames with no interactionId). Never deletes the tip
         * pointer's current frame.
         */
        async _pruneLiveFrames(keepIds) {
            const tipApi = navi?.storage?.tip;
            if (!tipApi?.frame?.list || !tipApi?.frame?.get || !tipApi?.frame?.del) {
                return;
            }
            const keep = keepIds instanceof Set ? keepIds : new Set(keepIds || []);
            let tipGib = "";
            try {
                const tip = await tipApi.get(LIVE_KEY);
                tipGib = String(tip?.gib || "");
            } catch {
                /* ignore */
            }
            let addrs = [];
            try {
                addrs = await tipApi.frame.list(LIVE_KEY);
            } catch {
                return;
            }
            if (!Array.isArray(addrs) || !addrs.length) return;

            for (const addr of addrs) {
                const a = String(addr || "");
                if (!a.includes("^")) continue;
                const gib = a.slice(a.indexOf("^") + 1);
                if (tipGib && gib === tipGib) continue;
                let frame = null;
                try {
                    frame = await tipApi.frame.get(a);
                } catch {
                    continue;
                }
                const iid = String(
                    frame?.data?.value?.interactionId || ""
                ).trim();
                // Legacy spam (pre-interactionId) or expired interaction → drop.
                if (!iid || !keep.has(iid)) {
                    try {
                        await tipApi.frame.del(a);
                    } catch {
                        /* ignore */
                    }
                }
            }
        }

        clearLiveStorage() {
            this._liveInteractionId = null;
            this._liveInteractionKind = null;
            this._liveInteractionRing = [];
            this._enqueueLiveWrite(async () => {
                if (navi?.storage?.item?.del) {
                    await navi.storage.item.del(LIVE_KEY);
                }
            });
        }

        locate(target) {
            if (!target || !isBrowser) return null;
            const shielded = this._itemFromShieldTarget(target);
            if (shielded) {
                target = shielded;
            }
            const eventTarget =
                target.nodeType === 1 ? target : target.parentElement;
            let el = eventTarget;
            if (!el) return null;

            // Climb until parent is a stage column (occupant) or we hit a column itself.
            while (el && el !== document.documentElement) {
                if (el.hasAttribute?.("data-stagejockey-shield")) {
                    el = el.parentElement;
                    continue;
                }
                const selfSlot = zoneSlotOf(el);
                if (selfSlot && !el.hasAttribute("data-stage-nest")) {
                    return {
                        slot: selfSlot,
                        index: null,
                        zoneEl: el,
                        itemEl: null,
                        targetEl: null
                    };
                }
                const parent = el.parentElement;
                const parentSlot = zoneSlotOf(parent);
                if (parentSlot) {
                    const slot = parentSlot;
                    if (isStageMemberSeparator(el)) return null;
                    const kids = Array.from(parent.children).filter(
                        (c) =>
                            !c.hasAttribute?.("data-stagejockey-shield") &&
                            !isStageMemberSeparator(c)
                    );
                    const domIdx = kids.indexOf(el);
                    if (domIdx < 0) return null;
                    const index = isLeftZone(slot) ? kids.length - 1 - domIdx : domIdx;
                    let targetEl = null;
                    // Nest dive: −1 select children arms hostElement (htm-element).
                    if (
                        !shielded &&
                        this.nestSession?.kind === "html" &&
                        this.nestSession.hostElement instanceof HTMLElement &&
                        (this.nestSession.hostElement === el ||
                            el.contains(this.nestSession.hostElement))
                    ) {
                        const diveRoot = this.nestSession.hostElement;
                        targetEl = this._resolveHtmlTarget(
                            diveRoot,
                            eventTarget
                        );
                        if (targetEl === diveRoot) targetEl = null;
                    }
                    return { slot, index, zoneEl: parent, itemEl: el, targetEl };
                }
                el = parent;
            }
            return null;
        }

        _unmarkAll() {
            for (const [, span] of this._marked) {
                try {
                    if (span instanceof HTMLElement) span.remove();
                } catch (_) {
                    /* ignore */
                }
            }
            this._marked.clear();
        }

        /**
         * DOM node that should wear the red select outline — prefer the
         * scrollbuffer claim's bound nesting layer (most relevant), else
         * nest targetEl, else the stage-member / zone.
         */
        _selectChromeEl() {
            if (!this.select || this._selectOutlineSuppressed) return null;
            const sb = this.scrollbuffer;
            if (
                sb?.context &&
                sb.entries instanceof Map &&
                sb.position !== 0 &&
                sb.entries.has(sb.position)
            ) {
                const entry = sb.entries.get(sb.position);
                const nesting = Array.isArray(sb.context.nesting)
                    ? sb.context.nesting
                    : [];
                const li = entry?.boundLayerIndex;
                if (li != null && Number.isFinite(Number(li))) {
                    const el = nesting[Number(li)]?.el;
                    if (el instanceof HTMLElement && el.isConnected) return el;
                }
                const scoped = entry?.context?.element;
                if (
                    scoped instanceof HTMLElement &&
                    scoped.isConnected &&
                    this.select.itemEl?.contains?.(scoped)
                ) {
                    return scoped;
                }
            }
            if (
                this.select.targetEl instanceof HTMLElement &&
                this.select.targetEl.isConnected &&
                this.select.itemEl?.contains?.(this.select.targetEl) &&
                this.select.targetEl !== this.select.itemEl
            ) {
                return this.select.targetEl;
            }
            const item = this.select.itemEl;
            if (item instanceof HTMLElement && item.isConnected) return item;
            const zone = this.select.zoneEl;
            if (zone instanceof HTMLElement && zone.isConnected) return zone;
            return null;
        }

        _paint() {
            this._invalidateDisconnectedPicks();
            this._unmarkAll();
            const {
                colorZone,
                colorItem,
                colorSelect,
                colorElementHover,
                colorElementHoverBlue,
                colorElementSelect,
            } = this.settings;

            const selectChrome = this._selectChromeEl();
            const selectZone = this.select?.zoneEl || null;
            const selectItem = this.select?.itemEl || null;

            // Zone (lightblue) under hover — never when it would share an edge
            // with / contain the active red select (reads as covering red).
            if (this.hover?.zoneEl) {
                const z = this.hover.zoneEl;
                const obscuresSelect =
                    !!selectChrome &&
                    (z === selectChrome ||
                        z === selectZone ||
                        z === selectItem ||
                        (selectChrome instanceof HTMLElement &&
                            typeof z.contains === "function" &&
                            z.contains(selectChrome)) ||
                        (selectItem instanceof HTMLElement &&
                            typeof z.contains === "function" &&
                            z.contains(selectItem)));
                if (!obscuresSelect) this._mark(z, colorZone);
            }

            // Item (blue) under hover — skip the selected chrome/item.
            if (
                this.hover?.itemEl &&
                this.hover.itemEl !== selectChrome &&
                this.hover.itemEl !== selectItem
            ) {
                this._mark(this.hover.itemEl, colorItem);
            }

            // Select (red) on the most relevant nesting / target / member.
            if (selectChrome) this._mark(selectChrome, colorSelect);

            // Nested HTML element outlines (settings or nest-armed session).
            if (!this._nestDiveEnabled() || this._selectOutlineSuppressed) {
                /* no element dive outlines */
            } else {
                const nestColors = {
                    hover: this.settings.colorNestHover || "mediumorchid",
                    select: this.settings.colorNestSelect || "orchid",
                };
                const selectTarget =
                    this.select?.targetEl &&
                    this.select.targetEl !== this.select.itemEl &&
                    this.select.itemEl?.contains?.(this.select.targetEl)
                        ? this.select.targetEl
                        : null;
                if (selectTarget && selectTarget !== selectChrome) {
                    this._mark(
                        selectTarget,
                        this.nestSession
                            ? nestColors.select
                            : colorElementSelect
                    );
                }

                const hoverTarget =
                    this.hover?.targetEl &&
                    this.hover.targetEl !== this.hover.itemEl &&
                    this.hover.itemEl?.contains?.(this.hover.targetEl)
                        ? this.hover.targetEl
                        : null;
                if (
                    hoverTarget &&
                    hoverTarget !== selectTarget &&
                    hoverTarget !== selectChrome
                ) {
                    const memberSelected =
                        !!this.select?.itemEl &&
                        this.select.itemEl === this.hover.itemEl;
                    this._mark(
                        hoverTarget,
                        this.nestSession
                            ? nestColors.hover
                            : memberSelected
                              ? colorElementHover
                              : colorElementHoverBlue
                    );
                }
            }
        }

        setHover(loc) {
            if (!loc) {
                if (this.hover) {
                    this.hover = null;
                    this._paint();
                    // Hover is ephemeral — not a live tip frame.
                }
                return;
            }
            this.touchedStage = true;
            if (this.holding) this._syncHoldOverlays();
            const same =
                this.hover &&
                this.hover.slot === loc.slot &&
                this.hover.index === loc.index &&
                this.hover.itemEl === loc.itemEl &&
                this.hover.targetEl === loc.targetEl;
            if (same) return;
            this.hover = loc;
            this._paint();
        }

        setSelect(loc) {
            if (!loc) return;
            this.touchedStage = true;
            this._selectOutlineSuppressed = false;
            this.select = loc;
            const generation = ++this._selectionGeneration;
            this.scrollbuffer.clear();
            this._paint();
            this.persistLive({ via: { kind: "select" } });
            this._beginScrollbuffer(loc, generation);
        }

        async _beginScrollbuffer(loc, generation) {
            let presentation = null;
            if (loc.itemEl) {
                try {
                    const stage = resolveStageDir()?.stage;
                    if (stage) {
                        // Prefer the selected element itself so nested stages with
                        // duplicate slot ids do not resolve the wrong presentation.
                        if (typeof stage.presentationFor === "function") {
                            presentation = stage.presentationFor(loc.itemEl);
                        }
                        if (!presentation && typeof stage.presentationAt === "function") {
                            presentation = await stage.presentationAt(
                                loc.slot,
                                loc.index,
                                loc.itemEl
                            );
                        }
                    }
                } catch (err) {
                    console.error("[stagejockey] could not resolve selected presentation", err);
                }
                if (!presentation) {
                    presentation = (() => {
                        const o = { value: loc.itemEl.outerHTML };
                        const stamped = loc.itemEl.getAttribute?.("data-part");
                        if (stamped) o.type = String(stamped).toLowerCase();
                        return o;
                    })();
                }
            }

            if (
                generation !== this._selectionGeneration ||
                !this.holding ||
                this.select !== loc
            ) {
                return;
            }

            const context = loc.itemEl
                ? this._contextFromOccupantPick(loc, presentation)
                : {
                      types: ["stage_zone"],
                      kind: "stage_zone",
                      label: loc.slot,
                      slot: loc.slot,
                      index: null,
                      element: loc.zoneEl,
                  };
            this.scrollbuffer.begin(context);
        }

        beginHold(x, y) {
            this.clearDropdownPick();
            this.clearNest();
            this.clearTextProbe();
            this.holding = true;
            this.touchedStage = false;
            this.hover = null;
            this.select = null;
            this._selectOutlineSuppressed = false;
            this._lastRight = { x, y };
            this._pointer = { x, y };
            this._selectionGeneration++;
            this.scrollbuffer.clear();
            this._clearOutlines();
            this._setMemberShield(true);
            this.persistLive({ startInteraction: "hold", via: { kind: "hold" } });
        }

        endHold() {
            const xy = { ...this._lastRight };
            // Park for dropdown claims: whenever we never left-clicked a red
            // select. Hover alone sets touchedStage, so "idle" must NOT require
            // !touchedStage — otherwise righttap-on-stage never parks.
            const parkLoc =
                this.holding && !this.select ? this.hover : null;
            const wasIdleTap = !!(parkLoc && !this.select);

            this.holding = false;
            this.hover = null;
            this.touchedStage = false;
            this._selectionGeneration++;
            this._cancelRedselectDrag();
            this.scrollbuffer.clear();
            this.clearNest();
            this.clearTextProbe();
            this._setMemberShield(false);

            if (parkLoc?.itemEl) {
                // Keep pick state for claims: menu, but drop outlines on rightup
                // so the quick righttap doesn't leave rectangles until next click.
                // Suppress red until a real left-click setSelect — otherwise
                // mouseover/_paint after hx navigate would re-show select chrome.
                this.select = parkLoc;
                this._selectOutlineSuppressed = true;
                this.dropdownContext = this.contextFromLoc(parkLoc);
                this._clearOutlines();
                this.persistLive({ via: { kind: "end-hold-park" } });
            } else if (!(this.select?.itemEl || this.select?.zoneEl)) {
                // Idle righttap off-stage: park htmf host for dropdown
                // (move onstage / claims that key off element).
                const moveMod =
                    navi?.mod?.jockey_move ||
                    globalThis?.navi?.mod?.jockey_move;
                const findHost =
                    typeof moveMod?.findHtmfHost === "function"
                        ? moveMod.findHtmfHost.bind(moveMod)
                        : null;
                const htmf = findHost
                    ? findHost(this._rightTarget)
                    : null;
                const onStage =
                    htmf && typeof moveMod?.isOnStage === "function"
                        ? moveMod.isOnStage(htmf)
                        : false;
                if (htmf && !onStage) {
                    this.select = null;
                    this.dropdownContext = {
                        types: ["htmf"],
                        kind: "htmf",
                        label: "htmf",
                        part: "htmf",
                        element: htmf,
                        hostElement: htmf,
                    };
                    this._clearOutlines();
                    this.persistLive({ via: { kind: "end-hold-htmf" } });
                } else {
                    this.select = null;
                    this.dropdownContext = null;
                    this._clearOutlines();
                    this.persistLive({ via: { kind: "end-hold" } });
                }
            } else {
                this._clearOutlines();
                this.persistLive({ via: { kind: "end-hold-select" } });
            }
            return wasIdleTap ? xy : null;
        }

        reset() {
            this.holding = false;
            this._middleGestureOpaque = false;
            this._shieldRemovePending = false;
            this._middleOpaqueGen++;
            this._setMemberShield(false);
            this.hover = null;
            this.select = null;
            this._selectOutlineSuppressed = false;
            this.dropdownContext = null;
            this.touchedStage = false;
            this._selectionGeneration++;
            this.scrollbuffer.clear();
            this.clearNest();
            this.clearTextProbe();
            this._clearOutlines();
            this.clearLiveStorage();
        }

        onRightDown(ctx) {
            if (!this.enabled || !this.settings.pick) return;
            const t = ctx.target;
            this._rightTarget =
                t && t.nodeType === 1
                    ? t
                    : t?.parentElement || null;
            this.beginHold(ctx.x, ctx.y);
            const loc = this.locate(ctx.target);
            if (loc) this.setHover(loc);
        }

        onMove(ctx) {
            if (!this.enabled || !this.settings.pick || !this.holding) return;
            if (ctx.event && (ctx.event.buttons & 2) === 0) {
                this.endHold();
                return;
            }
            this._syncHoldOverlays();
            this.scrollbuffer.updatePointer(ctx.x, ctx.y);

            // Bespoke text probe / drag while in inner-html virtual context.
            if (this._textProbe?.root) {
                // After a commit, only paint the selection — no live hover chase
                // unless the user is dragging a new range.
                if (this._textProbe.committed && !this._textDrag) {
                    if (this._textProbe.hover) {
                        this._textProbe.hover = null;
                        this._paintTextProbe();
                    }
                    return;
                }
                const hover = this._probeTextAt(ctx.x, ctx.y);
                if (this._textDrag && hover) {
                    const a = this._textDrag.start;
                    const b = hover.char?.abs ?? hover.abs;
                    const lo = Math.min(a, b);
                    const hi = Math.max(a, b);
                    // Exclusive end like commit: [lo, hi+1) when dragging across glyphs.
                    const start = lo;
                    const end = hi === lo ? lo + 1 : hi + 1;
                    const fullText = this._textProbe.fullText || "";
                    const rootEl = this._textProbe.root;
                    // Priority: char > word > phrase (live preview)
                    if (end - start === 1) {
                        const words = this._wordSpans(fullText);
                        const containing = words.find(
                            (w) => start >= w.start && start < w.end
                        );
                        this._textProbe.hover = {
                            ...hover,
                            phrase: null,
                            range: null,
                            word: containing
                                ? {
                                      ...containing,
                                      rects: this._rangeRects(
                                          rootEl,
                                          containing.start,
                                          containing.end
                                      ),
                                  }
                                : null,
                            char: {
                                index: containing
                                    ? start - containing.start
                                    : 0,
                                abs: start,
                                text: fullText[start] || "",
                                rects: this._rangeRects(
                                    rootEl,
                                    start,
                                    start + 1
                                ),
                            },
                        };
                    } else {
                        const words = this._wordSpans(fullText);
                        const containing = words.find(
                            (w) => start >= w.start && end <= w.end
                        );
                        const phrasePaint = !containing
                            ? this._phrasePaintPack(
                                  rootEl,
                                  fullText,
                                  start,
                                  end
                              )
                            : null;
                        if (phrasePaint) {
                            this._textProbe.hover = {
                                ...hover,
                                word: null,
                                char: null,
                                ...phrasePaint,
                            };
                        } else if (containing) {
                            this._textProbe.hover = {
                                ...hover,
                                phrase: null,
                                char: null,
                                word: {
                                    ...containing,
                                    rects: this._rangeRects(
                                        rootEl,
                                        containing.start,
                                        containing.end
                                    ),
                                },
                                range: {
                                    start,
                                    end,
                                    rects: this._rangeRects(
                                        rootEl,
                                        start,
                                        end
                                    ),
                                },
                            };
                        } else {
                            this._textProbe.hover = {
                                ...hover,
                                phrase: null,
                                word: null,
                                char: null,
                                range: {
                                    start,
                                    end,
                                    rects: this._rangeRects(
                                        rootEl,
                                        start,
                                        end
                                    ),
                                },
                            };
                        }
                    }
                } else {
                    this._textProbe.hover = hover;
                }
                this._paintTextProbe();
                return;
            }

            if (!this.scrollbuffer.armed) {
            this.setHover(this.locate(ctx.target));
            }
        }

        onMouseover(ctx) {
            if (!this.enabled || !this.settings.pick || !this.holding) return;
            this.scrollbuffer.updatePointer(ctx.x, ctx.y);
            if (this._textProbe?.root) {
                if (this._textProbe.committed && !this._textDrag) {
                    if (this._textProbe.hover) {
                        this._textProbe.hover = null;
                        this._paintTextProbe();
                    }
                    return;
                }
                const hover = this._probeTextAt(ctx.x, ctx.y);
                if (this._textDrag && hover) {
                    const a = this._textDrag.start;
                    const b = hover.char?.abs ?? hover.abs;
                    const lo = Math.min(a, b);
                    const hi = Math.max(a, b);
                    const start = lo;
                    const end = hi === lo ? lo + 1 : hi + 1;
                    const fullText = this._textProbe.fullText || "";
                    const rootEl = this._textProbe.root;
                    if (end - start === 1) {
                        const words = this._wordSpans(fullText);
                        const containing = words.find(
                            (w) => start >= w.start && start < w.end
                        );
                        this._textProbe.hover = {
                            ...hover,
                            phrase: null,
                            range: null,
                            word: containing
                                ? {
                                      ...containing,
                                      rects: this._rangeRects(
                                          rootEl,
                                          containing.start,
                                          containing.end
                                      ),
                                  }
                                : null,
                            char: {
                                index: containing
                                    ? start - containing.start
                                    : 0,
                                abs: start,
                                text: fullText[start] || "",
                                rects: this._rangeRects(
                                    rootEl,
                                    start,
                                    start + 1
                                ),
                            },
                        };
                    } else {
                        const words = this._wordSpans(fullText);
                        const containing = words.find(
                            (w) => start >= w.start && end <= w.end
                        );
                        const phrasePaint = !containing
                            ? this._phrasePaintPack(
                                  rootEl,
                                  fullText,
                                  start,
                                  end
                              )
                            : null;
                        if (phrasePaint) {
                            this._textProbe.hover = {
                                ...hover,
                                word: null,
                                char: null,
                                ...phrasePaint,
                            };
                        } else if (containing) {
                            this._textProbe.hover = {
                                ...hover,
                                phrase: null,
                                char: null,
                                word: {
                                    ...containing,
                                    rects: this._rangeRects(
                                        rootEl,
                                        containing.start,
                                        containing.end
                                    ),
                                },
                                range: {
                                    start,
                                    end,
                                    rects: this._rangeRects(
                                        rootEl,
                                        start,
                                        end
                                    ),
                                },
                            };
                        } else {
                            this._textProbe.hover = {
                                ...hover,
                                phrase: null,
                                word: null,
                                char: null,
                                range: {
                                    start,
                                    end,
                                    rects: this._rangeRects(
                                        rootEl,
                                        start,
                                        end
                                    ),
                                },
                            };
                        }
                    }
                } else {
                    this._textProbe.hover = hover;
                }
                this._paintTextProbe();
                return;
            }
            this.setHover(this.locate(ctx.target));
        }

        /** Left-down while text probe armed (shield or supermouse path). */
        _textProbePointerDown(x, y) {
            const hover = this._probeTextAt(x, y);
            if (!hover || !this._textProbe?.root) return;
            this._textDrag = {
                start: hover.char?.abs ?? hover.abs,
                originHover: hover,
                x,
                y,
            };
            // Commit clears hover; during drag, move will paint range preview.
            this._textProbe.hover = null;
            this._commitTextSelection(hover);
            this._paintTextProbe();
        }

        /** Left-up while text probe armed — extend to drag range if moved. */
        _textProbePointerUp(x, y) {
            const drag = this._textDrag;
            this._textDrag = null;
            if (!drag || !this._textProbe?.root) return;
            const endHover =
                this._probeTextAt(x, y) || drag.originHover || null;
            if (!endHover) return;
            const endAbs = endHover.char?.abs ?? endHover.abs;
            const absSpan = Math.abs(endAbs - drag.start);
            const pixelMoved = Math.hypot(
                (x || 0) - (drag.x || 0),
                (y || 0) - (drag.y || 0)
            );
            // Caret on char 0 sits at the glyph's left edge; mouseup often
            // reports abs+1 without a real drag. Keep the mousedown char.
            // Priority: char wins for absSpan 0–1 unless a clear multi-glyph drag.
            if (absSpan === 0) return;
            if (absSpan <= 1 && pixelMoved < 8) return;
            if (absSpan > 0) {
                const lo = Math.min(drag.start, endAbs);
                const hi = Math.max(drag.start, endAbs);
                // Glyph indices are inclusive → exclusive end for [start,end).
                this._commitTextSelection(endHover, {
                    dragRange: { start: lo, end: hi + 1 },
                });
            }
        }

        onLeftClick(ctx) {
            if (!this.enabled || !this.settings.pick || !this.holding) return;
            if (!ctx.supermouse?.isPreventLeftDefault?.()) return;
            // Right button no longer down (lost rightup during DOM swap etc.) — drop hold.
            if (ctx.event && (ctx.event.buttons & 2) === 0) {
                this.endHold();
                return;
            }
            const t = ctx.target;
            // Leave host/plugin chrome alone ([data-jockey-ui]).
            if (t?.closest?.(CHROME_SEL)) {
                return;
            }

            // Fallback when shield did not capture (non-member targets).
            if (this._textProbe?.root) {
            ctx.preventDefault();
            ctx.stopPropagation();
                this._textProbePointerDown(ctx.x, ctx.y);
                const up = (ev) => {
                    try {
                        document.removeEventListener("mouseup", up, true);
                        document.removeEventListener("pointerup", up, true);
                    } catch {
                        /* ignore */
                    }
                    this._textProbePointerUp(ev.clientX, ev.clientY);
                };
                document.addEventListener("mouseup", up, true);
                document.addEventListener("pointerup", up, true);
                return;
            }

            // Block links/htmx on stage members during hold even when pick misses.
            if (this._eventOnStageMember(t)) {
                ctx.preventDefault();
                ctx.stopPropagation();
            }
            const loc = this.locate(t);
            if (!loc) return;
            this.setSelect(loc);
        }

        onScroll(ctx) {
            if (
                !this.enabled ||
                !this.settings.pick ||
                !this.holding ||
                !this.select ||
                !this.scrollbuffer.context
            ) {
                return;
            }
            ctx.preventDefault();
            ctx.stopPropagation();
            this.scrollbuffer.updatePointer(ctx.x, ctx.y);
            if (ctx.deltaY > 0) this.scrollbuffer.move(1);
            else if (ctx.deltaY < 0) this.scrollbuffer.move(-1);
        }

        onMiddleClick(ctx) {
            if (
                !this.enabled ||
                !this.settings.pick ||
                !this.holding ||
                !this.select ||
                !this.scrollbuffer.context
            ) {
                return;
            }
            ctx.preventDefault();
            ctx.stopPropagation();
            this._beginMiddleGestureOpaque();
            this.scrollbuffer.updatePointer(ctx.x, ctx.y);
            this.scrollbuffer.armCurrent();
        }

        onMiddleUp(ctx) {
            if (
                !this.enabled ||
                !this.settings.pick ||
                !this.holding ||
                !this.select ||
                !this.scrollbuffer.context ||
                !this.scrollbuffer.armed
            ) {
                if (this._middleGestureOpaque) {
                    this._releaseMiddleGestureOpaqueSoon();
                }
                return;
            }
            ctx.preventDefault();
            ctx.stopPropagation();
            this.scrollbuffer.updatePointer(ctx.x, ctx.y);
            void this.scrollbuffer.executeCurrent().finally(() => {
                this._releaseMiddleGestureOpaqueSoon();
            });
        }

        onRightUp(ctx) {
            if (!this.holding) return;
            this._lastRight = { x: ctx.x, y: ctx.y };
            // Dropdown owns righttap separately — we only end the hold here.
            this.endHold();
        }
    }

    const jockey = new StageJockey();
    try {
        jockey.scrollbuffer.registerPlugin(builtInSelectPlugin);
    } catch (err) {
        console.error("[stagejockey] built-in select plugin failed", err);
    }

    const buildStagejockeyMenu = (api) => {
        const pickMark = jockey.settings.pick ? "[x]" : "[ ]";
        const pickRow = api.item(`${pickMark} pick`, { checkbox: true });
        pickRow.title = "Hold right-click to hover/select stage occupants";
        pickRow.addEventListener("click", (e) => {
            e.stopPropagation();
            jockey.settings.pick = !jockey.settings.pick;
            if (!jockey.settings.pick) jockey.reset();
            jockey.saveSettings();
            pickRow.textContent = `${jockey.settings.pick ? "[x]" : "[ ]"} pick`;
        });
        api.insertAfter(pickRow);

        const prefMark = jockey.settings.prefPrefix !== false ? "[x]" : "[ ]";
        const prefRow = api.item(`${prefMark} path:media pref ix`, {
            checkbox: true,
        });
        prefRow.title =
            "Prefix path:media paths with navi.storage navi:pref:ix";
        prefRow.addEventListener("click", (e) => {
            e.stopPropagation();
            jockey.settings.prefPrefix = !(jockey.settings.prefPrefix !== false);
            jockey.saveSettings();
            prefRow.textContent = `${
                jockey.settings.prefPrefix !== false ? "[x]" : "[ ]"
            } path:media pref ix`;
        });
        api.insertAfter(prefRow);

        const liveTraceMark = jockey.settings.liveTrace !== false ? "[x]" : "[ ]";
        const liveTraceRow = api.item(`${liveTraceMark} live tip trace`, {
            checkbox: true,
        });
        liveTraceRow.title =
            "Mut8 supermouse_stagejockey_live for select/claim/text graphs (serialized)";
        liveTraceRow.addEventListener("click", (e) => {
            e.stopPropagation();
            jockey.settings.liveTrace = !(jockey.settings.liveTrace !== false);
            jockey.saveSettings();
            liveTraceRow.textContent = `${
                jockey.settings.liveTrace !== false ? "[x]" : "[ ]"
            } live tip trace`;
            if (jockey.settings.liveTrace === false) {
                jockey.clearLiveStorage();
            }
        });
        api.insertAfter(liveTraceRow);

        const stageApi = resolveStageDir()?.stage || null;
        const brOn = stageApi?.separateWithBr?.() === true;
        const brMark = brOn ? "[x]" : "[ ]";
        const brRow = api.item(`${brMark} separate members with br`, {
            checkbox: true,
        });
        brRow.title =
            "stagedir br — put <br> between each occupant in a stage zone";
        brRow.addEventListener("click", async (e) => {
            e.stopPropagation();
            const stage = resolveStageDir()?.stage;
            if (!stage || typeof stage.setSeparateWithBr !== "function") {
                brRow.textContent = "[ ] separate members with br (need stagedir)";
                return;
            }
            try {
                const next = !(stage.separateWithBr?.() === true);
                await stage.setSeparateWithBr(next ? "on" : "off");
                brRow.textContent = `${
                    stage.separateWithBr?.() === true ? "[x]" : "[ ]"
                } separate members with br`;
            } catch (err) {
                console.error("[stagejockey] stagedir br toggle failed", err);
            }
        });
        api.insertAfter(brRow);

        api.insertAfter(
            api.inputRow(
                "live forget after",
                String(
                    Number.isFinite(Number(jockey.settings.liveForgetAfter))
                        ? jockey.settings.liveForgetAfter
                        : DEFAULT_SETTINGS.liveForgetAfter
                ),
                (v) => {
                    const n = Math.max(0, Math.floor(Number(v)));
                    jockey.settings.liveForgetAfter = Number.isFinite(n)
                        ? n
                        : DEFAULT_SETTINGS.liveForgetAfter;
                    jockey.saveSettings();
                }
            )
        );

        api.insertAfter(
            api.inputRow("zone (hover)", jockey.settings.colorZone || DEFAULT_SETTINGS.colorZone, (v) => {
                jockey.settings.colorZone = v || DEFAULT_SETTINGS.colorZone;
                jockey.saveSettings();
                jockey._paint();
            })
        );
        api.insertAfter(
            api.inputRow("item (hover)", jockey.settings.colorItem || DEFAULT_SETTINGS.colorItem, (v) => {
                jockey.settings.colorItem = v || DEFAULT_SETTINGS.colorItem;
                jockey.saveSettings();
                jockey._paint();
            })
        );
        api.insertAfter(
            api.inputRow("select", jockey.settings.colorSelect || DEFAULT_SETTINGS.colorSelect, (v) => {
                jockey.settings.colorSelect = v || DEFAULT_SETTINGS.colorSelect;
                jockey.saveSettings();
                jockey._paint();
            })
        );

        api.insertAfter(
            api.inputRow(
                "element hover (red member)",
                jockey.settings.colorElementHover || DEFAULT_SETTINGS.colorElementHover,
                (v) => {
                    jockey.settings.colorElementHover =
                        v || DEFAULT_SETTINGS.colorElementHover;
                    jockey.saveSettings();
                    jockey._paint();
                }
            )
        );
        api.insertAfter(
            api.inputRow(
                "element hover (blue member)",
                jockey.settings.colorElementHoverBlue ||
                    DEFAULT_SETTINGS.colorElementHoverBlue,
                (v) => {
                    jockey.settings.colorElementHoverBlue =
                        v || DEFAULT_SETTINGS.colorElementHoverBlue;
                    jockey.saveSettings();
                    jockey._paint();
                }
            )
        );
        api.insertAfter(
            api.inputRow(
                "element select",
                jockey.settings.colorElementSelect ||
                    DEFAULT_SETTINGS.colorElementSelect,
                (v) => {
                    jockey.settings.colorElementSelect =
                        v || DEFAULT_SETTINGS.colorElementSelect;
                    jockey.saveSettings();
                    jockey._paint();
                }
            )
        );
    };

    const dropdownMenu = {
        id: "stagejockey",
        label: "stagejockey",
        build: buildStagejockeyMenu
    };

    const registerAddClaim = (def = {}) => {
        const id = def.id;
        if (!id || typeof id !== "string") {
            throw new Error("[stagejockey] add claim requires id");
        }
        if (
            typeof def.execute !== "function" &&
            typeof def.activate !== "function"
        ) {
            throw new Error(
                "[stagejockey] add claim requires execute() or activate()"
            );
        }
        addClaims.set(id, {
            id,
            label: def.label || id,
            matches: typeof def.matches === "function" ? def.matches : null,
            execute:
                typeof def.execute === "function"
                    ? def.execute
                    : async () => undefined,
            activate:
                typeof def.activate === "function" ? def.activate : null,
            source: def.source || "push",
        });
        return () => addClaims.delete(id);
    };

    const discoverAddClaims = () => {
        const out = new Map(addClaims);
        try {
            const names =
                typeof navi.listModules === "function"
                    ? navi.listModules()
                    : Object.keys(navi.mod || {});
            for (const name of names) {
                const mod = navi.mod?.[name];
                const plugin =
                    typeof mod?.stageMemberAddPlugin === "function"
                        ? mod.stageMemberAddPlugin()
                        : mod?.stageMemberAddPlugin;
                if (!plugin || !Array.isArray(plugin.claims)) continue;
                for (const claim of plugin.claims) {
                    if (!claim?.id) continue;
                    if (
                        typeof claim.execute !== "function" &&
                        typeof claim.activate !== "function"
                    ) {
                        continue;
                    }
                    if (out.has(claim.id)) continue;
                    out.set(claim.id, {
                        id: claim.id,
                        label: claim.label || claim.id,
                        matches:
                            typeof claim.matches === "function"
                                ? claim.matches
                                : null,
                        execute:
                            typeof claim.execute === "function"
                                ? claim.execute
                                : async () => undefined,
                        activate:
                            typeof claim.activate === "function"
                                ? claim.activate
                                : null,
                        source: name,
                    });
                }
            }
        } catch (err) {
            console.error("[stagejockey] add-claim discovery failed", err);
        }
        return [...out.values()];
    };

    /** Top-level stagejockey ▸ rows from mounted mods' `stagejockeyMenuPlugin`. */
    const discoverMenuItems = (menuCtx) => {
        const out = [];
        const seen = new Set();
        try {
            const names =
                typeof navi.listModules === "function"
                    ? navi.listModules()
                    : Object.keys(navi.mod || {});
            for (const name of names) {
                const mod = navi.mod?.[name];
                const plugin =
                    typeof mod?.stagejockeyMenuPlugin === "function"
                        ? mod.stagejockeyMenuPlugin()
                        : mod?.stagejockeyMenuPlugin;
                if (!plugin || !Array.isArray(plugin.items)) continue;
                for (const item of plugin.items) {
                    if (!item?.id || typeof item.action !== "function" || seen.has(item.id)) continue;
                    try {
                        if (typeof item.matches === "function" && item.matches(menuCtx) === false) continue;
                    } catch {
                        continue;
                    }
                    seen.add(item.id);
                    out.push({ ...item, label: item.label || item.id, source: name });
                }
            }
        } catch (err) {
            console.error("[stagejockey] menu-item discovery failed", err);
        }
        return out;
    };

    // Built-ins — insertion order is menu order.
    registerAddClaim({
        id: "upload:media",
        label: "upload:media",
        source: "stagejockey",
        matches: () =>
            !!(
                findScrollClaim("stage_casting", "stagemaker") &&
                findScrollClaim("jockey_move", "move") &&
                navi?.storage?.file &&
                typeof navi.storage.file.save === "function" &&
                typeof document !== "undefined"
            ),
        activate: (row, menuApi, addApi) => {
            activateUploadMedia(row, menuApi, addApi);
        },
        async execute(api) {
            if (typeof document === "undefined") return undefined;
            return runUploadMediaAdd(api);
        },
    });

    registerAddClaim({
        id: "path:media",
        label: "path:media",
        source: "stagejockey",
        matches: () =>
            !!(
                findScrollClaim("stage_casting", "stagemaker") &&
                findScrollClaim("jockey_move", "move")
            ),
        activate: (row, menuApi, addApi) => {
            activatePathMediaInput(row, menuApi, addApi);
        },
        async execute(api) {
            if (typeof document === "undefined") return undefined;
            const raw = globalThis.prompt?.("path:media path (e.g. welcome.html)");
            if (!raw || !String(raw).trim()) return undefined;
            return runPathMediaAdd(api, String(raw).trim());
        },
    });

    registerAddClaim({
        id: "iframe",
        label: "iframe",
        source: "stagejockey",
        matches: () =>
            !!(
                findScrollClaim("jockey_move", "move") ||
                navi?.mod?.jockey_move?.moveOnstage
            ),
        activate: (row, menuApi, addApi) => {
            activateIframeInput(row, menuApi, addApi);
        },
        async execute(api) {
            if (typeof document === "undefined") return undefined;
            const raw = globalThis.prompt?.(
                "iframe src (https://… or /path)"
            );
            if (!raw || !String(raw).trim()) return undefined;
            return runIframeAdd(api, String(raw).trim());
        },
    });

    const makeAddApi = (pointer) => {
        const pt = pointer || jockey._pointer || { x: 0, y: 0 };
        if (jockey._pointer) {
            jockey._pointer.x = pt.x;
            jockey._pointer.y = pt.y;
        }
        return {
            navi,
            jockey,
            scrollbuffer: jockey.scrollbuffer,
            stage: resolveStageDir()?.stage || null,
            pointer: { x: pt.x, y: pt.y },
            terminate: () => {
                try {
                    if (jockey.holding) jockey.endHold();
                } catch {
                    /* ignore */
                }
            },
        };
    };

    const buildStagejockeyRootMenu = (api) => {
        const moveMod =
            navi?.mod?.jockey_move || globalThis?.navi?.mod?.jockey_move;
        const stage = resolveStageDir()?.stage || null;
        const hasStage = !!(
            (isBrowser && (hasHorizonV1() || hasJockeyStageV1())) ||
            stage
        );

        const resolveDropdownHtmf = () => {
            const ctx = jockey.dropdownContext;
            const pick = jockey.select;
            const findHost =
                typeof moveMod?.findHtmfHost === "function"
                    ? moveMod.findHtmfHost.bind(moveMod)
                    : null;
            const stageable = findHost ? findHost(jockey._rightTarget) : null;
            if (
                stageable instanceof HTMLElement &&
                stageable.hasAttribute("data-stageable") &&
                stageable !== pick?.itemEl &&
                !(typeof moveMod?.isOnStage === "function" && moveMod.isOnStage(stageable))
            ) {
                return { el: stageable, onStage: false };
            }
            if (pick?.itemEl instanceof HTMLElement) {
                const parts = String(pick.itemEl.getAttribute?.("data-part") || "")
                    .toLowerCase()
                    .split(/[\s,]+/)
                    .filter(Boolean);
                const types = Array.isArray(ctx?.types) ? ctx.types : [];
                if (
                    parts.includes("htmf") ||
                    parts.includes("html") ||
                    types.includes("htmf") ||
                    types.includes("html")
                ) {
                    return {
                        el: pick.itemEl,
                        onStage: true,
                        slot: pick.slot,
                        index: pick.index,
                    };
                }
            }
            const fromCtx =
                (ctx?.hostElement instanceof HTMLElement && ctx.hostElement) ||
                (ctx?.element instanceof HTMLElement && ctx.element) ||
                null;
            const el =
                (fromCtx && findHost ? findHost(fromCtx) : fromCtx) ||
                (findHost ? findHost(jockey._rightTarget) : null);
            if (!(el instanceof HTMLElement)) return null;
            const onStage =
                typeof moveMod?.isOnStage === "function"
                    ? !!moveMod.isOnStage(el)
                    : false;
            return { el, onStage };
        };

        const htmfPick = resolveDropdownHtmf();

        const stagePick = (() => {
            const seeds = [
                jockey.select?.itemEl,
                jockey.dropdownContext?.hostElement,
                jockey.dropdownContext?.element,
                jockey._rightTarget,
            ];
            for (const seed of seeds) {
                const stage = resolveStageHost(seed);
                if (!(stage instanceof HTMLElement)) continue;
                const path = String(stage.getAttribute("data-path") || "")
                    .trim()
                    .replace(/^\/+/, "");
                if (path) return { el: stage, path };
            }
            return null;
        })();

        // Same menu slot as proscene: either build a stage, or move live htmf
        // on/off an existing stage.
        if (isBrowser && canOfferProscene()) {
            const proRow = api.item("proscene");
            proRow.title =
                "Build jockeystage/v1 (Horizon-shaped); move body into Center Stage";
            proRow.addEventListener("click", (e) => {
                e.stopPropagation();
                api.close();
                try {
                    createJockeyStageV1();
                } catch (err) {
                    console.error("[stagejockey] proscene failed", err);
                    if (typeof navi.callout === "function") {
                        navi.callout(
                            `[stagejockey] proscene: ${err.message || err}`
                        );
                    }
                }
            });
            api.insertAfter(proRow);
        } else if (
            isBrowser &&
            hasStage &&
            htmfPick &&
            !htmfPick.onStage &&
            typeof moveMod?.moveOnstage === "function"
        ) {
            const row = api.item("move onstage");
            row.title =
                "Open jockey-move grid; place this live htmf into the chosen zone";
            row.addEventListener("click", (e) => {
                e.stopPropagation();
                api.close();
                const addApi = makeAddApi(api.pointer?.() || jockey._pointer);
                void moveMod
                    .moveOnstage(htmfPick.el, addApi)
                    .then(() => {
                        jockey.select = null;
                        jockey.dropdownContext = null;
                        jockey._clearOutlines?.();
                        jockey.persistLive?.({ via: { kind: "move-onstage" } });
                    })
                    .catch((err) => {
                    console.error("[stagejockey] move onstage failed", err);
                    if (typeof navi.callout === "function") {
                        navi.callout(
                            `[stagejockey] move onstage: ${err?.message || err}`
                        );
                    }
                });
            });
            api.insertAfter(row);
        } else if (
            isBrowser &&
            htmfPick?.onStage &&
            typeof moveMod?.moveOffstage === "function"
        ) {
            const row = api.item("move offstage");
            row.title =
                "Lift this live htmf out of the stage onto document.body";
            row.addEventListener("click", (e) => {
                e.stopPropagation();
                api.close();
                const addApi = makeAddApi(api.pointer?.() || jockey._pointer);
                void moveMod
                    .moveOffstage(htmfPick.el, addApi)
                    .then(() => {
                        jockey.select = null;
                        jockey.dropdownContext = null;
                        jockey._clearOutlines?.();
                        jockey.persistLive?.({ via: { kind: "move-offstage" } });
                    if (typeof navi.callout === "function") {
                        navi.callout(
                            `[stagejockey] move offstage: ${err?.message || err}`
                        );
                    }
                });
            });
            api.insertAfter(row);
        }

        const menuStage = isBrowser && stagePick ? stagePick : null;
        for (const item of discoverMenuItems({ stage: menuStage })) {
            const row = api.item(item.label);
            row.title = item.title || `from ${item.source}`;
            row.addEventListener("click", (e) => {
                e.stopPropagation();
                const pointer = api.pointer?.() || jockey._pointer;
                api.close();
                void (async () => {
                    try {
                        await item.action({ pointer, stage: menuStage });
                    } catch (err) {
                        console.error("[stagejockey] menu item failed", item.id, err);
                        if (typeof navi.callout === "function") {
                            navi.callout(`[stagejockey] ${item.label}: ${err?.message || err}`);
                        }
                    }
                })();
            });
            api.insertAfter(row);
        }

        const ctx = jockey.dropdownContext;
        const star =
            (Array.isArray(ctx?.types) && ctx.types[0]) ||
            ctx?.kind ||
            "—";
        const claimsRow = api.item(`claims: ${star} ▸`);
        claimsRow.title = ctx
            ? `Scrollbuffer claims for parked pick (${ctx.label || star})`
            : "Righttap a stage occupant first (idle right-click)";
        claimsRow.addEventListener("click", (e) => {
            e.stopPropagation();
            api.toggleNested(claimsRow, (nested) => {
                if (!jockey.dropdownContext) {
                    nested.insertAfter(
                        nested.item("(righttap a stage member)", {
                            vanity: true,
                        })
                    );
                    return;
                }
                const loading = nested.item("(loading claims…)", {
                    vanity: true,
                });
                nested.insertAfter(loading);
                void (async () => {
                    let entries = [];
                    try {
                        entries = await jockey.scrollbuffer.listClaimEntries(
                            jockey.dropdownContext
                        );
                    } catch (err) {
                        console.error(
                            "[stagejockey] claims menu failed",
                            err
                        );
                    }
                    try {
                        loading.remove();
                    } catch {
                        /* nest closed */
                    }
                    if (!entries.length) {
                        try {
                            nested.insertAfter(
                                nested.item("(no matching claims)", {
                                    vanity: true,
                                })
                            );
                        } catch {
                            /* ignore */
                        }
                        return;
                    }
                    // Most-negative → -1, skip 0, then +1 → +n (down the list).
                    const ordered = [
                        ...entries
                            .filter((en) => en.position < 0)
                            .sort((a, b) => a.position - b.position),
                        ...entries
                            .filter((en) => en.position > 0)
                            .sort((a, b) => a.position - b.position),
                    ];
                    for (const entry of ordered) {
                        const row = nested.item("");
                        row.textContent = "";
                        row.style.display = "flex";
                        row.style.alignItems = "baseline";
                        row.style.gap = "0.35rem";

                        const partEl = document.createElement("span");
                        partEl.textContent = entry.boundType || "*";
                        partEl.style.cssText =
                            "flex:none;opacity:0.65;min-width:4.5rem";
                        partEl.title = entry.boundType
                            ? `bound type ${entry.boundType}`
                            : "universal (*)";

                        const dirEl = document.createElement("span");
                        const pos = entry.position;
                        dirEl.textContent =
                            pos > 0 ? `+${pos}` : String(pos);
                        dirEl.style.cssText =
                            "flex:none;font-variant-numeric:tabular-nums;min-width:1.6rem";

                        const nameEl = document.createElement("span");
                        nameEl.textContent = entry.text || entry.claimId;
                        nameEl.style.color = entry.color || "inherit";
                        nameEl.style.textShadow =
                            entry.textShadow || "0 1px 2px #000, 0 0 2px #000";

                        row.appendChild(partEl);
                        row.appendChild(dirEl);
                        row.appendChild(nameEl);
                        row.title = [
                            entry.pluginId && `plugin ${entry.pluginId}`,
                            entry.claimId,
                            entry.boundType && `type ${entry.boundType}`,
                        ]
                            .filter(Boolean)
                            .join(" · ");

                        row.addEventListener("click", (ev) => {
                            ev.stopPropagation();
                            api.close();
                            void (async () => {
                                try {
                                    await jockey.scrollbuffer.executeEntry(
                                        entry
                                    );
                                } catch (err) {
                                    console.error(
                                        "[stagejockey] claim execute failed",
                                        entry.claimId,
                                        err
                                    );
                                    if (typeof navi.callout === "function") {
                                        navi.callout(
                                            `[stagejockey] ${entry.claimId}: ${err?.message || err}`
                                        );
                                    }
                                }
                            })();
                        });
                        try {
                            nested.insertAfter(row);
                        } catch {
                            /* nest closed */
                        }
                    }
                })();
            });
        });
        api.insertAfter(claimsRow);

        const addRow = api.item("stage-member add ▸");
        addRow.title = "Add a new stage-member via discovered claims";
        addRow.addEventListener("click", (e) => {
            e.stopPropagation();
            api.toggleNested(addRow, (nested) => {
                const claims = discoverAddClaims().filter((c) => {
                    if (!c.matches) return true;
                    try {
                        return c.matches(makeAddApi(api.pointer())) !== false;
                    } catch {
                        return false;
                    }
                });
                if (!claims.length) {
                    const empty = nested.item("(no add claims)", { vanity: true });
                    nested.insertAfter(empty);
                    return;
                }
                for (const claim of claims) {
                    const row = nested.item(claim.label || claim.id);
                    row.title = claim.source
                        ? `from ${claim.source}`
                        : claim.id;
                    row.addEventListener("click", (ev) => {
                        ev.stopPropagation();
                        const ptr = api.pointer();
                        const addApi = makeAddApi(ptr);
                        if (typeof claim.activate === "function") {
                            claim.activate(row, api, addApi);
                            return;
                        }
                        api.close();
                        void (async () => {
                            try {
                                await claim.execute(addApi);
                            } catch (err) {
                                console.error(
                                    "[stagejockey] add claim failed",
                                    claim.id,
                                    err
                                );
                                if (typeof navi.callout === "function") {
                                    navi.callout(
                                        `[stagejockey] ${claim.id}: ${err.message || err}`
                                    );
                                }
                            }
                        })();
                    });
                    nested.insertAfter(row);
                }
            });
        });
        api.insertAfter(addRow);

        const canTestkit =
            !!findScrollClaim("stage_casting", "stagemaker") &&
            !!findScrollClaim("jockey_move", "move");
        const TESTKIT_HTMFS = [
            "testkit/notemaker",
            "testkit/keychain",
            "testkit/tinyviewport",
            "testkit/relaytest",
            "testkit/storagetest",
            "testkit/text_editor",
            "testkit/tablemaker",
            "testkit/scripter",
            "testkit/fofum",
            "testkit/warezashyperlinks",
            "testkit/media-explorer",
            "testkit/surfroster",
        ];
        const testkitRow = api.item("testkit ▸");
        testkitRow.title = canTestkit
            ? "Stage a testkit HTMF (fetch → cast → jockey-move)"
            : "Needs stage_casting + jockey_move mounted";
        testkitRow.addEventListener("click", (e) => {
            e.stopPropagation();
            api.toggleNested(testkitRow, (nested) => {
                if (!canTestkit) {
                    nested.insertAfter(
                        nested.item("(mount stage_casting + jockey_move)", {
                            vanity: true,
                        })
                    );
                    return;
                }
                for (const path of TESTKIT_HTMFS) {
                    const leaf = path.split("/").pop() || path;
                    const row = nested.item(leaf);
                    row.title = path;
                    row.addEventListener("click", (ev) => {
                        ev.stopPropagation();
                        const ptr = api.pointer();
                        const addApi = makeAddApi(ptr);
                        api.close();
                        void (async () => {
                            try {
                                await runPathMediaAdd(addApi, path);
                            } catch (err) {
                                console.error(
                                    "[stagejockey] testkit add failed",
                                    path,
                                    err
                                );
                                if (typeof navi.callout === "function") {
                                    navi.callout(
                                        `[stagejockey] testkit ${leaf}: ${err?.message || err}`
                                    );
                                }
                            }
                        })();
                    });
                    nested.insertAfter(row);
                }
            });
        });
        api.insertAfter(testkitRow);
    };

    const rootDropdownMenu = {
        id: "stagejockey",
        label: "stagejockey",
        build: buildStagejockeyRootMenu,
    };

    const hookDropdown = () => {
        const dd = resolveDropdown();
        if (!dd) return false;
        // Settings submenu under plugins.
        if (!unmenuDropdown && typeof dd.registerPluginMenu === "function") {
            unmenuDropdown = dd.registerPluginMenu(dropdownMenu);
        }
        // Formal top-level stagejockey ▸
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
        name: "supermouse_plugin_stagejockey",
        version: "0.9.96",
        description:
            "Stage pick; select children on htm-element; live tip select/claim graphs",

        moduleInfo: {
            name: "supermouse_plugin_stagejockey",
            version: "0.9.96",
            description:
                "stage-member add ▸ iframe → src then jockey-move; stagedir br toggle",
        },

        PLUGIN_ID,
        jockey,
        /** surf -p hook: empty jockeystage/v1 in body with nodes in CS; returns CS. */
        prosceneBody,
        scrollbuffer: jockey.scrollbuffer,
        registerScrollPlugin: (def) => jockey.scrollbuffer.registerPlugin(def),
        unregisterScrollPlugin: (id) => jockey.scrollbuffer.unregisterPlugin(id),
        listScrollPlugins: () => jockey.scrollbuffer.listPlugins(),
        registerAddClaim,
        listAddClaims: () => discoverAddClaims(),
        dropdownMenu,
        rootDropdownMenu,

        commands: {
            stagejockey: {
                name: "stagejockey",
                description:
                    "stagejockey <status|help|prefix> — pick + path:media pref prefix",
                execute: async (subcommand, ...args) => {
                    if (!subcommand || subcommand === "help") {
                        return [
                            "supermouse_plugin_stagejockey v0.9.84",
                            "Triggers: rightclick + move + leftclick + scroll/middleclick/middleup + rightup.",
                            "Dropdown uses righttap (no move) — parks red+green pick for claims: menu",
                            "Left-click while holding selects red (+ nested green) and starts scrollbuffer at 0.",
                            "Left-press+drag on an active red-select is jockey-move's pointer (ghost rect) — not a claim.",
                            "Rightup / api.terminate() clears red + green outlines and ends the hold.",
                            "Wheel down/up moves +1/-1; middle down arms the *current* claim; middle up executes.",
                            "Claims fan out by nesting: parents nearer ±1, deeper children farther out.",
                            "−1 built-in: select children → arms child pick + >>; select innerHTML → full-text commit (word/char probe); select src/href",
                            "Text probe priority: char > word > phrase (phraseSpan = full words index)",
                            "Nesting fan-out e.g. htm-p · htm-element >> htmf · htm-div · htm-element · stage-member",
                            "After a claim, scrollbuffer returns to 0; api.terminate() ends the hold",
                            "(use when the claim mutates the red-select origin, e.g. jockey-move).",
                            "An action object becomes the next recursive scrollbuffer context.",
                            "Release right to collapse the entire chain.",
                            "Top-level: dropdown → stagejockey ▸ → [proscene | move onstage | move offstage] claims: * ▸ | …",
                            "  claims: <leftmost-type> — list −n…−1 then +1…+n; describe may set textShadow",
                            "  proscene (no horizon/v1 or jockeystage/v1): build stage, body → CS",
                            "  move onstage (stage + off-stage htmf righttap): jockey-move grid → live adopt",
                            "  move offstage (on-stage htmf righttap): live node → document.body",
                            "  built-in: upload:media (file picker → storage path → cast → move)",
                            "  built-in: path:media (path → localpark → hostpark → cast → move)",
                            "  built-in: testkit ▸ (testkit/* HTMFs → fetch → cast → jockey-move)",
                            "  (more claims via stageMemberAddPlugin / registerAddClaim)",
                            "Settings: dropdown → plugins → stagejockey ▸",
                            "",
                            "  stagejockey status",
                            "  stagejockey help",
                            "  stagejockey prefix              show on/off + navi:pref:ix",
                            "  stagejockey prefix on|off       enable/disable path:media pref prefixing",
                            "  stagejockey prefix <path>       set navi:pref:ix (spaces → /)",
                            "  stagejockey prefix clear        delete navi:pref:ix",
                        ].join("\n");
                    }
                    if (subcommand === "status") {
                        const host = resolveSuperMouse();
                        const stage = resolveStageDir();
                        const plug = host?.getPlugin?.(PLUGIN_ID);
                        const h = jockey.hover;
                        const s = jockey.select;
                        const b = jockey.scrollbuffer;
                        const ix = await readPrefIx();
                        return [
                            `supermouse: ${host ? "present" : "MISSING"}`,
                            `stagedir: ${stage ? "present" : "MISSING"}`,
                            `plugin enabled: ${plug ? (plug.enabled ? "yes" : "no") : "not registered"}`,
                            `pick: ${jockey.settings.pick ? "ON" : "OFF"}`,
                            `pref prefix: ${jockey.settings.prefPrefix !== false ? "ON" : "OFF"}`,
                            `live tip: ${jockey.settings.liveTrace !== false ? "ON" : "OFF"} (forget after ${jockey.settings.liveForgetAfter ?? 3})`,
                            `live interaction: ${jockey._liveInteractionId || "(none)"} ring=${(jockey._liveInteractionRing || []).length}`,
                            `navi:pref:ix: ${ix || "(unset)"}`,
                            `holding: ${jockey.holding ? "yes" : "no"}`,
                            `hover: ${h ? `${h.slot}[${h.index}]` : "(none)"}`,
                            `select: ${s ? `${s.slot}[${s.index}]` : "(none)"}`,
                            `scrollbuffer: ${b.context ? `${b.position} (${b.entries.size} positions, depth ${Math.max(0, b.history.length - 1)})` : "(inactive)"}`,
                            `scroll plugins: ${b.listPlugins().map((p) => p.id).join(", ") || "(none)"}`,
                            `add claims: ${discoverAddClaims().map((c) => c.id).join(", ") || "(none)"}`,
                            `colors: zone=${jockey.settings.colorZone} item=${jockey.settings.colorItem} select=${jockey.settings.colorSelect}`
                        ].join("\n");
                    }
                    if (subcommand === "prefix") {
                        const flag = args[0];
                        if (flag == null || flag === "") {
                            const ix = await readPrefIx();
                            return [
                                `pref prefix: ${jockey.settings.prefPrefix !== false ? "ON" : "OFF"}`,
                                `navi:pref:ix: ${ix || "(unset)"}`,
                                "usage: stagejockey prefix on|off | <path> | clear",
                            ].join("\n");
                        }
                        const on =
                            args.length === 1 &&
                            (flag === "on" ||
                                flag === "true" ||
                                flag === "1" ||
                                flag === "enable");
                        const off =
                            args.length === 1 &&
                            (flag === "off" ||
                                flag === "false" ||
                                flag === "0" ||
                                flag === "disable");
                        if (on || off) {
                            jockey.settings.prefPrefix = on;
                            await jockey.saveSettings();
                            return `pref prefix: ${on ? "ON" : "OFF"}`;
                        }
                        if (
                            args.length === 1 &&
                            (flag === "clear" ||
                                flag === "del" ||
                                flag === "delete" ||
                                flag === "unset")
                        ) {
                            await writePrefIx("");
                            return "navi:pref:ix cleared";
                        }
                        const joined = args
                            .join("/")
                            .replace(/\/+/g, "/")
                            .replace(/^\/+|\/+$/g, "");
                        const set = await writePrefIx(joined);
                        return `navi:pref:ix: ${set}`;
                    }
                    return `Unknown: ${subcommand}. Type 'stagejockey help'.`;
                }
            }
        },

        onMount: async () => {
            if (!isBrowser) {
                selfUnmount("browser environment required");
                return;
            }

            const host = resolveSuperMouse();
            const stage = resolveStageDir();
            const missing = [];
            if (!host) missing.push("supermouse");
            if (!stage) missing.push("stagedir");
            if (missing.length) {
                selfUnmount(`needs ${missing.join(" + ")} mounted first`);
                return;
            }

            await jockey.loadSettings();

            jockey._supermouseHost = host;
            jockey._bindDomChromeCleanup();
            jockey._scrubPollutedOutlinesInDocument();

            // Replace-safe: remounts must not die on "already registered".
            if (host.getPlugin(PLUGIN_ID)) {
                host.unregisterPlugin(PLUGIN_ID);
            }

            unregister = host.registerPlugin({
                id: PLUGIN_ID,
                name: "Stage Jockey",
                description: "right-hold stage pick + recursive scrollbuffer; ends on rightup",
                modes: ["rightclick", "rightup", "leftclick", "middleclick", "middleup", "mouseover", "move", "scroll"],
                enabled: true,
                meta: { stagedir: true },
                onRightClick: (ctx) => jockey.onRightDown(ctx),
                onRightUp: (ctx) => jockey.onRightUp(ctx),
                onLeftClick: (ctx) => jockey.onLeftClick(ctx),
                onMiddleClick: (ctx) => jockey.onMiddleClick(ctx),
                onMiddleUp: (ctx) => jockey.onMiddleUp(ctx),
                onMouseover: (ctx) => jockey.onMouseover(ctx),
                onMove: (ctx) => jockey.onMove(ctx),
                onScroll: (ctx) => jockey.onScroll(ctx),
                onEnable: () => {
                    jockey.enabled = true;
                    if (typeof navi.callout === "function") {
                        navi.callout("[stagejockey] enabled");
                    }
                },
                onDisable: () => {
                    jockey.enabled = false;
                    jockey.reset();
                    if (typeof navi.callout === "function") {
                        navi.callout("[stagejockey] disabled");
                    }
                }
            });

            const onVis = () => {
                if (document.visibilityState === "hidden" && jockey.holding) {
                    jockey.endHold();
                }
            };
            const onBlur = () => {
                if (jockey.holding) jockey.endHold();
            };
            // Lost rightup (DOM swap under cursor, etc.): drop hold when RMB released.
            const onPointerUp = (e) => {
                if (!jockey.holding) return;
                if (e.button === 2 || (e.buttons & 2) === 0) {
                    jockey.endHold();
                }
            };
            document.addEventListener("visibilitychange", onVis);
            window.addEventListener("blur", onBlur);
            document.addEventListener("pointerup", onPointerUp, true);
            jockey._releaseHoldOnBlur = () => {
                document.removeEventListener("visibilitychange", onVis);
                window.removeEventListener("blur", onBlur);
                document.removeEventListener("pointerup", onPointerUp, true);
            };

            // Settings submenu + top-level stagejockey ▸ (pull discovery also via dropdownMenu / rootDropdownMenu).
            const tryHook = () => {
                hookDropdown();
            };
            tryHook();
            [50, 200, 500, 1000, 2000].forEach((ms) => {
                const id = setTimeout(tryHook, ms);
                hookTimers.push(id);
            });
            if (typeof navi?.on === "function") {
                dropdownMountHandler = (msg) => {
                    if (msg?.kind === "mount") tryHook();
                };
                navi.on("supermouse_plugin_dropdown", dropdownMountHandler);
            }
            watchHost();

            if (typeof navi.callout === "function") {
                navi.callout("[supermouse_plugin_stagejockey] mounted — rightclick hold to pick; menu is righttap");
            } else {
                console.log("[supermouse_plugin_stagejockey] mounted");
            }
        },

        onUnmount: () => {
            unwatchHost();
            unhookDropdown();
            try {
                jockey._unbindDomChromeCleanup();
            } catch (_) {
                /* ignore */
            }
            if (typeof jockey._releaseHoldOnBlur === "function") {
                try {
                    jockey._releaseHoldOnBlur();
                } catch (_) {
                    /* ignore */
                }
                jockey._releaseHoldOnBlur = null;
            }
            hookTimers.forEach((id) => clearTimeout(id));
            hookTimers.length = 0;
            if (dropdownMountHandler && typeof navi?.off === "function") {
                navi.off("supermouse_plugin_dropdown", dropdownMountHandler);
                dropdownMountHandler = null;
            }
            jockey.enabled = false;
            jockey.reset();
            // Drop push-registered scroll plugins so remounts do not throw
            // "already registered". Pull-discovered exports remain available.
            jockey.scrollbuffer.plugins.clear();

            if (typeof unregister === "function") {
                try {
                    unregister();
                } catch (_) {
                    /* host may already be gone */
                }
                unregister = null;
            }
            if (typeof navi.callout === "function") {
                navi.callout("[supermouse_plugin_stagejockey] unmounted");
            } else {
                console.log("[supermouse_plugin_stagejockey] unmounted");
            }
        }
    };
};
