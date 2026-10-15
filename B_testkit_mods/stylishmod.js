// stylishmod — page html/body theme + scale + open web fonts
// Command: stylishmod
//
// Callin spreads args (like pecklogger): stylishmod scale 110 → execute("scale","110").
// Prefs in navi.storage.item stylishmod_prefs. File/bin images resolve to data: URLs.
//
// Web fonts: Fontsource catalog (api.fontsource.org, CSS via jsDelivr), Bunny
// Fonts fallback. Exposed as navi.mod.stylishmod.fonts for jockey_stylish.

export const register = (navi) => {
    const isBrowser =
        typeof window !== "undefined" && typeof window.document !== "undefined";

    const STYLE_ID = "stylishmod-root-style";
    const STORAGE_KEY = "stylishmod_prefs";
    const TAG = "[stylishmod]";

    const FONT_CATALOG_KEY = "stylishmod_font_catalog";
    const FONT_CATALOG_TTL_MS = 7 * 24 * 60 * 60 * 1000;
    const FONTSOURCE_LIST = "https://api.fontsource.org/v1/fonts";
    const FONTSOURCE_CSS = "https://cdn.jsdelivr.net/npm";
    const BUNNY_LIST = "https://fonts.bunny.net/list";
    const BUNNY_CSS = "https://fonts.bunny.net/css";
    const FONT_LINK_ATTR = "data-stylishmod-font";

    /** Always-available families (no network). */
    const SYSTEM_FONTS = [
        ["system-ui", "sans-serif"],
        ["sans-serif", "sans-serif"],
        ["serif", "serif"],
        ["monospace", "monospace"],
        ["cursive", "handwriting"],
        ["fantasy", "display"],
        ["Arial", "sans-serif"],
        ["Helvetica", "sans-serif"],
        ["Segoe UI", "sans-serif"],
        ["Tahoma", "sans-serif"],
        ["Trebuchet MS", "sans-serif"],
        ["Verdana", "sans-serif"],
        ["Georgia", "serif"],
        ["Garamond", "serif"],
        ["Palatino Linotype", "serif"],
        ["Times New Roman", "serif"],
        ["Consolas", "monospace"],
        ["Courier New", "monospace"],
        ["Lucida Console", "monospace"],
        ["Comic Sans MS", "handwriting"],
        ["Impact", "display"],
    ].map(([family, category]) => ({
        id: `system:${family}`,
        family,
        category,
        weights: [],
        source: "system",
    }));

    const DEFAULTS = {
        scale: 100,
        color: null,
        background: null,
        backgroundColor: null,
        backgroundImage: null,
        backgroundSize: null,
        backgroundPosition: null,
        backgroundRepeat: null,
        backgroundAttachment: null,
        /** PWA chrome (navi.pwa) — browser UI / splash, not page CSS */
        themeColor: null,
        backgroundColorPwa: null,
        /** @type {{ kind: 'css'|'file'|'bin', ref: string }|null} */
        bgImageSource: null,
        /** Page background gradient, drawn under any bgimage, over bgcolor. */
        /** @type {{ type: 'linear'|'radial'|'conic', direction: string|null, stops: string[] }|null} */
        gradient: null,
        /** Allow fetching the open font catalog + font CSS. */
        fontsEnabled: true,
        /** Page-wide font family (catalog family name) or null. */
        pageFont: null,
        /** Font ids kept loaded across remounts (styled elements use them). */
        pinnedFonts: [],
    };

    let prefs = { ...DEFAULTS };
    let styleEl = null;
    /** Resolved CSS url(...) for file/bin; revoked on change. */
    let resolvedBgImage = null;
    let blobUrl = null;

    const say = (msg) => `${TAG} ${msg}`;

    const clampScale = (n) => {
        const x = Number(n);
        if (!Number.isFinite(x)) return null;
        return Math.min(400, Math.max(10, Math.round(x * 100) / 100));
    };

    const isUnsetToken = (s) => {
        const t = String(s || "")
            .trim()
            .toLowerCase();
        return t === "unset" || t === "none" || t === "default" || t === "clear";
    };

    const joinRest = (args) =>
        (Array.isArray(args) ? args : []).map(String).join(" ").trim();

    const short = (s, max = 64) => {
        const t = String(s || "");
        return t.length > max ? t.slice(0, max - 1) + "…" : t;
    };

    const revokeBlob = () => {
        if (blobUrl && typeof URL !== "undefined" && URL.revokeObjectURL) {
            try {
                URL.revokeObjectURL(blobUrl);
            } catch {
                /* ignore */
            }
        }
        blobUrl = null;
    };

    const mediaToCssUrl = (media, mime) => {
        const body = String(media ?? "");
        const m = String(mime || "application/octet-stream").split(";")[0].trim();
        if (body.startsWith("data:") || body.startsWith("blob:") || body.startsWith("http")) {
            return `url(${JSON.stringify(body)})`;
        }
        // Prefer data URL (survives without keeping blob around across remount).
        const dataUrl = body.startsWith("data:")
            ? body
            : `data:${m};base64,${body}`;
        return `url(${JSON.stringify(dataUrl)})`;
    };

    const resolveBgImage = async () => {
        resolvedBgImage = null;
        revokeBlob();
        const src = prefs.bgImageSource;
        if (!src || !src.kind) {
            if (prefs.backgroundImage) resolvedBgImage = prefs.backgroundImage;
            return;
        }
        if (src.kind === "css") {
            resolvedBgImage = src.ref;
            prefs.backgroundImage = src.ref;
            return;
        }
        if (src.kind === "file") {
            const file = navi?.storage?.file;
            if (!file || typeof file.get !== "function") {
                throw new Error("navi.storage.file unavailable");
            }
            const key = String(src.ref || "")
                .trim()
                .replace(/^navi:/, "")
                .replace(/^\/+/, "");
            const entry = await file.get(key);
            if (!entry || entry.media == null) {
                throw new Error(`file not found: ${key}`);
            }
            resolvedBgImage = mediaToCssUrl(entry.media, entry.mime);
            prefs.backgroundImage = resolvedBgImage;
            return;
        }
        if (src.kind === "bin") {
            const bin = navi?.storage?.bin;
            if (!bin || typeof bin.get !== "function") {
                throw new Error("navi.storage.bin unavailable");
            }
            const sha = String(src.ref || "")
                .trim()
                .replace(/^bin\s+/i, "")
                .toLowerCase();
            const entry = await bin.get(sha);
            if (!entry || entry.media == null) {
                throw new Error(`bin not found: ${sha}`);
            }
            resolvedBgImage = mediaToCssUrl(entry.media, entry.mime);
            prefs.backgroundImage = resolvedBgImage;
            return;
        }
    };

    const GRADIENT_TYPES = ["linear", "radial", "conic"];

    const normalizeGradient = (g) => {
        if (!g || typeof g !== "object" || !Array.isArray(g.stops)) return null;
        const stops = g.stops.map((s) => String(s || "").trim()).filter(Boolean);
        if (stops.length < 2) return null;
        const type = GRADIENT_TYPES.includes(g.type) ? g.type : "linear";
        const direction = typeof g.direction === "string" && g.direction.trim() ? g.direction.trim() : null;
        return { type, direction, stops };
    };

    /** Split where `isSep(ch)` outside parentheses: "rgb(1, 2, 3) #fff" on spaces → ["rgb(1, 2, 3)", "#fff"]. */
    const splitTopLevel = (text, isSep) => {
        const out = [];
        let cur = "";
        let depth = 0;
        for (const ch of String(text || "")) {
            if (ch === "(") depth += 1;
            if (ch === ")") depth = Math.max(0, depth - 1);
            if (depth === 0 && isSep(ch)) {
                if (cur.trim()) out.push(cur.trim());
                cur = "";
            } else {
                cur += ch;
            }
        }
        if (cur.trim()) out.push(cur.trim());
        return out;
    };
    const splitCssWords = (text) => splitTopLevel(text, (ch) => /\s/.test(ch));
    const splitCssList = (text) => splitTopLevel(text, (ch) => ch === ",");

    const ANGLE_RE = /^-?\d*\.?\d+(deg|turn|rad|grad)$/i;
    const SIDE_WORDS = new Set(["top", "bottom", "left", "right", "center"]);

    /**
     * [linear|radial|conic] [angle | to <side…> | circle/ellipse … | from <angle>] <color> <color> [color…]
     * Stops may carry positions ("#000 30%") when quoted together: use commas, e.g. "#000 30%, #fff".
     */
    const parseGradient = (text) => {
        const list = splitCssList(text);
        let words = list.length > 1 ? null : splitCssWords(text);
        let type = "linear";
        let direction = null;
        let stops;
        if (words) {
            if (GRADIENT_TYPES.includes(String(words[0]).toLowerCase())) type = words.shift().toLowerCase();
            const dir = [];
            if (words[0] && ANGLE_RE.test(words[0])) dir.push(words.shift());
            else if (words[0] && /^(to|from|at|circle|ellipse)$/i.test(words[0])) {
                while (words.length && (/^(to|from|at|circle|ellipse|closest-side|farthest-corner)$/i.test(words[0]) || SIDE_WORDS.has(words[0].toLowerCase()) || ANGLE_RE.test(words[0]) || /^\d+%$/.test(words[0]))) {
                    dir.push(words.shift());
                }
            }
            direction = dir.length ? dir.join(" ") : null;
            stops = words;
        } else {
            const parts = list;
            const head = splitCssWords(parts[0]);
            if (GRADIENT_TYPES.includes(String(head[0]).toLowerCase())) {
                type = head.shift().toLowerCase();
                parts[0] = head.join(" ");
            }
            if (parts[0] && (ANGLE_RE.test(parts[0]) || /^(to|from|at|circle|ellipse)\b/i.test(parts[0]))) {
                direction = parts.shift();
            }
            stops = parts.filter(Boolean);
        }
        return normalizeGradient({ type, direction, stops });
    };

    const gradientCss = (g) => {
        if (!g) return "";
        const args = g.direction ? [g.direction, ...g.stops] : g.stops;
        return `${g.type}-gradient(${args.join(", ")})`;
    };

    const loadPrefs = async () => {
        try {
            const raw = await navi.storage?.item?.get?.(STORAGE_KEY);
            if (!raw || typeof raw !== "object") return;
            const next = { ...DEFAULTS };
            if (typeof raw.scale === "number" || typeof raw.scale === "string") {
                const s = clampScale(raw.scale);
                if (s != null) next.scale = s;
            }
            for (const k of [
                "color",
                "background",
                "backgroundColor",
                "backgroundImage",
                "backgroundSize",
                "backgroundPosition",
                "backgroundRepeat",
                "backgroundAttachment",
                "themeColor",
                "backgroundColorPwa",
            ]) {
                if (raw[k] === null || typeof raw[k] === "string") next[k] = raw[k];
            }
            if (raw.theme_color != null && next.themeColor == null) {
                next.themeColor =
                    typeof raw.theme_color === "string" ? raw.theme_color : null;
            }
            if (raw.pwa_background_color != null && next.backgroundColorPwa == null) {
                next.backgroundColorPwa =
                    typeof raw.pwa_background_color === "string"
                        ? raw.pwa_background_color
                        : null;
            }
            // Legacy 0.1.0 keys
            if (raw.bg != null && next.backgroundColor == null && next.background == null) {
                next.backgroundColor = typeof raw.bg === "string" ? raw.bg : null;
            }
            if (raw.text != null && next.color == null) {
                next.color = typeof raw.text === "string" ? raw.text : null;
            }
            if (raw.bgImageSource && typeof raw.bgImageSource === "object") {
                next.bgImageSource = {
                    kind: String(raw.bgImageSource.kind || "css"),
                    ref: String(raw.bgImageSource.ref || ""),
                };
            }
            next.gradient = normalizeGradient(raw.gradient);
            if (typeof raw.fontsEnabled === "boolean") next.fontsEnabled = raw.fontsEnabled;
            if (raw.pageFont === null || typeof raw.pageFont === "string") {
                next.pageFont = raw.pageFont;
            }
            if (Array.isArray(raw.pinnedFonts)) {
                next.pinnedFonts = raw.pinnedFonts.map(String).filter(Boolean);
            }
            prefs = next;
            await resolveBgImage();
        } catch (err) {
            console.warn(say("load prefs failed:"), err);
        }
    };

    const savePrefs = async () => {
        try {
            const toStore = {
                scale: prefs.scale,
                color: prefs.color,
                background: prefs.background,
                backgroundColor: prefs.backgroundColor,
                backgroundImage: prefs.bgImageSource?.kind === "css" ? prefs.backgroundImage : null,
                backgroundSize: prefs.backgroundSize,
                backgroundPosition: prefs.backgroundPosition,
                backgroundRepeat: prefs.backgroundRepeat,
                backgroundAttachment: prefs.backgroundAttachment,
                themeColor: prefs.themeColor,
                backgroundColorPwa: prefs.backgroundColorPwa,
                bgImageSource: prefs.bgImageSource,
                gradient: prefs.gradient,
                fontsEnabled: prefs.fontsEnabled !== false,
                pageFont: prefs.pageFont,
                pinnedFonts: [...(prefs.pinnedFonts || [])],
            };
            // For file/bin, persist source only (re-resolve on mount); don't bloat item with data URLs.
            if (prefs.bgImageSource?.kind === "css" || !prefs.bgImageSource) {
                toStore.backgroundImage = prefs.backgroundImage;
            }
            await navi.storage?.item?.set?.(STORAGE_KEY, toStore);
        } catch (err) {
            console.warn(say("save prefs failed:"), err);
        }
    };

    // —— Web fonts ————————————————————————————————————————————————

    /** @type {{ at: number, source: string, fonts: Array<object> }|null} */
    let fontCatalog = null;
    /** @type {Promise<object>|null} */
    let fontCatalogPending = null;
    /** font id → injected <link> elements */
    const loadedFonts = new Map();

    const genericFor = (category) => {
        const c = String(category || "").toLowerCase();
        if (c === "serif") return "serif";
        if (c === "monospace") return "monospace";
        if (c === "handwriting") return "cursive";
        return "sans-serif";
    };

    const quoteFamily = (family) => {
        const f = String(family || "").trim();
        if (!f) return "";
        if (/^(serif|sans-serif|monospace|cursive|fantasy|system-ui)$/i.test(f)) return f;
        return `"${f.replace(/"/g, "")}"`;
    };

    /** CSS font-family stack for a catalog entry (family + generic fallback). */
    const fontStack = (font) => {
        if (!font) return "";
        const fam = quoteFamily(font.family);
        const generic = genericFor(font.category);
        return fam === generic ? fam : `${fam}, ${generic}`;
    };

    const normalizeFontsource = (list) =>
        (Array.isArray(list) ? list : [])
            .filter((f) => f && f.id && f.family)
            .map((f) => ({
                id: String(f.id),
                family: String(f.family),
                category: String(f.category || "sans-serif"),
                weights: Array.isArray(f.weights) ? f.weights.map(Number) : [],
                variable: !!f.variable,
                source: "fontsource",
            }));

    const normalizeBunny = (obj) =>
        Object.entries(obj && typeof obj === "object" ? obj : {})
            .filter(([id, f]) => id && f && f.familyName)
            .map(([id, f]) => ({
                id: String(id),
                family: String(f.familyName),
                category: String(f.category || "sans-serif"),
                weights: Array.isArray(f.weights) ? f.weights.map(Number) : [],
                variable: false,
                source: "bunny",
            }));

    const fetchCatalog = async () => {
        try {
            const res = await fetch(FONTSOURCE_LIST);
            if (!res.ok) throw new Error(`fontsource ${res.status}`);
            const fonts = normalizeFontsource(await res.json());
            if (fonts.length) return { at: Date.now(), source: "fontsource", fonts };
            throw new Error("fontsource list empty");
        } catch (err) {
            console.warn(say("fontsource catalog failed, trying bunny:"), err);
        }
        const res = await fetch(BUNNY_LIST);
        if (!res.ok) throw new Error(`bunny ${res.status}`);
        const fonts = normalizeBunny(await res.json());
        if (!fonts.length) throw new Error("bunny list empty");
        return { at: Date.now(), source: "bunny", fonts };
    };

    /**
     * Web font catalog (cached in navi.storage.item for a week).
     * @param {{ force?: boolean }} [opts]
     */
    const loadCatalog = async ({ force = false } = {}) => {
        if (prefs.fontsEnabled === false) {
            return { at: 0, source: "disabled", fonts: [] };
        }
        const fresh = (c) =>
            c && Array.isArray(c.fonts) && c.fonts.length &&
            Date.now() - Number(c.at || 0) < FONT_CATALOG_TTL_MS;
        if (!force && fresh(fontCatalog)) return fontCatalog;
        if (!force && !fontCatalog) {
            try {
                const cached = await navi.storage?.item?.get?.(FONT_CATALOG_KEY);
                if (fresh(cached)) {
                    fontCatalog = cached;
                    return fontCatalog;
                }
            } catch {
                /* refetch */
            }
        }
        if (fontCatalogPending) return fontCatalogPending;
        fontCatalogPending = (async () => {
            try {
                const next = await fetchCatalog();
                next.fonts.sort((a, b) => a.family.localeCompare(b.family));
                fontCatalog = next;
                try {
                    await navi.storage?.item?.set?.(FONT_CATALOG_KEY, next);
                } catch {
                    /* cache is best-effort */
                }
                return next;
            } finally {
                fontCatalogPending = null;
            }
        })();
        return fontCatalogPending;
    };

    /** System fonts first, then the web catalog (when enabled). */
    const listFonts = async (opts) => {
        let web = [];
        try {
            web = (await loadCatalog(opts)).fonts || [];
        } catch (err) {
            console.warn(say("font catalog unavailable:"), err);
        }
        return [...SYSTEM_FONTS, ...web];
    };

    /** Resolve an id ("roboto", "system:Georgia") or family name ("Open Sans"). */
    const findFont = async (query) => {
        const q = String(query || "").trim().toLowerCase();
        if (!q) return null;
        const all = await listFonts();
        return (
            all.find((f) => f.id.toLowerCase() === q) ||
            all.find((f) => f.family.toLowerCase() === q) ||
            all.find((f) => f.id.toLowerCase() === q.replace(/\s+/g, "-")) ||
            null
        );
    };

    const fontCssUrls = (font) => {
        if (font.source === "bunny") {
            const ws = (font.weights || []).filter((w) => w === 400 || w === 700);
            const spec = ws.length ? ws.join(",") : "400";
            return [`${BUNNY_CSS}?family=${encodeURIComponent(font.id)}:${spec}&display=swap`];
        }
        if (font.variable) {
            return [`${FONTSOURCE_CSS}/@fontsource-variable/${font.id}/index.css`];
        }
        const urls = [`${FONTSOURCE_CSS}/@fontsource/${font.id}/index.css`];
        if ((font.weights || []).includes(700)) {
            urls.push(`${FONTSOURCE_CSS}/@fontsource/${font.id}/700.css`);
        }
        return urls;
    };

    /**
     * Inject @font-face CSS for a font (idempotent). System fonts are no-ops.
     * @returns {Promise<object|null>} catalog entry with `.stack`
     */
    const loadFont = async (idOrFamily) => {
        let font = null;
        if (typeof idOrFamily === "object" && idOrFamily) font = idOrFamily;
        else {
            try {
                font = await findFont(idOrFamily);
            } catch {
                font = null;
            }
            // Catalog unreachable/uncached (fresh clone): the id is a Fontsource slug,
            // and the element already carries its family name inline.
            const slug = String(idOrFamily || "").trim();
            if (!font && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
                font = { id: slug, family: slug, category: "sans-serif", weights: [], variable: false, source: "fontsource" };
            }
        }
        if (!font) return null;
        const out = { ...font, stack: fontStack(font) };
        if (!isBrowser || font.source === "system") return out;
        if (prefs.fontsEnabled === false) throw new Error("web fonts disabled (stylishmod fonts on)");
        if (loadedFonts.has(font.id)) return out;
        const links = fontCssUrls(font).map((href) => {
            const link = document.createElement("link");
            link.rel = "stylesheet";
            link.href = href;
            link.setAttribute(FONT_LINK_ATTR, font.id);
            (document.head || document.documentElement).appendChild(link);
            return link;
        });
        loadedFonts.set(font.id, links);
        return out;
    };

    /** Drop a loaded font's CSS unless pinned or used as the page font. */
    const releaseFont = (id) => {
        const key = String(id || "");
        if (!loadedFonts.has(key)) return false;
        if ((prefs.pinnedFonts || []).includes(key)) return false;
        if (prefs.pageFontId === key) return false;
        for (const link of loadedFonts.get(key)) link.remove();
        loadedFonts.delete(key);
        return true;
    };

    /** Keep a font loaded across remounts (elements styled with it). */
    const pinFont = async (idOrFamily) => {
        const font = await loadFont(idOrFamily);
        if (!font || font.source === "system") return font;
        if (!prefs.pinnedFonts.includes(font.id)) {
            prefs.pinnedFonts = [...prefs.pinnedFonts, font.id];
            await savePrefs();
        }
        return font;
    };

    const unpinFont = async (idOrFamily) => {
        const q = String(idOrFamily || "").trim().toLowerCase();
        const before = prefs.pinnedFonts.length;
        if (q === "all" || q === "*") {
            prefs.pinnedFonts = [];
        } else {
            const font = await findFont(q);
            const id = font ? font.id : q;
            prefs.pinnedFonts = prefs.pinnedFonts.filter((x) => x !== id);
        }
        if (prefs.pinnedFonts.length !== before) await savePrefs();
        return before - prefs.pinnedFonts.length;
    };

    /** Load fonts for [data-jockey-font] elements rendered after mount (htmx swaps, remounts). */
    let fontObserver = null;
    let fontScanTimer = null;
    const scanTaggedFonts = () => {
        fontScanTimer = null;
        if (prefs.fontsEnabled === false) return;
        for (const el of document.querySelectorAll("[data-jockey-font]")) {
            const id = el.getAttribute("data-jockey-font");
            if (!id || loadedFonts.has(id)) continue;
            loadFont(id).catch((err) => console.warn(say(`font load failed: ${id}`), err));
        }
    };
    const watchTaggedFonts = () => {
        if (!isBrowser || fontObserver || typeof MutationObserver !== "function") return;
        fontObserver = new MutationObserver(() => {
            if (!fontScanTimer) fontScanTimer = setTimeout(scanTaggedFonts, 150);
        });
        fontObserver.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["data-jockey-font"],
        });
    };
    const unwatchTaggedFonts = () => {
        if (fontObserver) fontObserver.disconnect();
        fontObserver = null;
        if (fontScanTimer) clearTimeout(fontScanTimer);
        fontScanTimer = null;
    };

    /** On mount: reload pinned fonts, page font, and any [data-jockey-font] in DOM. */
    const restoreFonts = async () => {
        if (!isBrowser || prefs.fontsEnabled === false) return;
        const ids = new Set(prefs.pinnedFonts || []);
        for (const el of document.querySelectorAll("[data-jockey-font]")) {
            const id = el.getAttribute("data-jockey-font");
            if (id) ids.add(id);
        }
        if (prefs.pageFont) ids.add(prefs.pageFont);
        for (const id of ids) {
            try {
                await loadFont(id);
            } catch (err) {
                console.warn(say(`font restore failed: ${id}`), err);
            }
        }
    };

    let resolvedPageFontStack = "";

    /** Load the page font (if any), then re-apply the root style. */
    const applyPageFont = async () => {
        resolvedPageFontStack = await pageFontStack();
        apply();
        return resolvedPageFontStack;
    };

    const pageFontStack = async () => {
        if (!prefs.pageFont) return "";
        try {
            const font = await loadFont(prefs.pageFont);
            if (font) {
                prefs.pageFontId = font.id;
                return font.stack;
            }
        } catch {
            /* fall through to raw family */
        }
        return quoteFamily(prefs.pageFont);
    };

    const ensureStyleEl = () => {
        if (!isBrowser) return null;
        if (styleEl && styleEl.isConnected) return styleEl;
        let el = document.getElementById(STYLE_ID);
        if (!el) {
            el = document.createElement("style");
            el.id = STYLE_ID;
            el.setAttribute("data-stylishmod", "1");
            (document.head || document.documentElement).appendChild(el);
        }
        styleEl = el;
        return el;
    };

    const cssEscapeValue = (v) => String(v);

    const apply = () => {
        if (!isBrowser) return;
        const el = ensureStyleEl();
        if (!el) return;

        const scale = prefs.scale != null ? prefs.scale : 100;
        const factor = scale / 100;
        const rules = [];

        // zoom (Chromium) + transform fallback so % scale is visible everywhere.
        rules.push(`html {
  zoom: ${scale}%;
  --stylishmod-scale: ${factor};
}`);
        rules.push(`@supports not (zoom: 1) {
  html {
    transform: scale(var(--stylishmod-scale));
    transform-origin: 0 0;
    width: calc(100% / var(--stylishmod-scale));
    min-height: calc(100% / var(--stylishmod-scale));
  }
}`);

        const rootBits = [];
        if (prefs.background != null && String(prefs.background).trim() !== "") {
            rootBits.push(`background: ${cssEscapeValue(prefs.background)} !important`);
        } else {
            if (prefs.backgroundColor != null && String(prefs.backgroundColor).trim() !== "") {
                rootBits.push(
                    `background-color: ${cssEscapeValue(prefs.backgroundColor)} !important`
                );
            }
            const img = resolvedBgImage || prefs.backgroundImage;
            const layers = [];
            if (img != null && String(img).trim() !== "") layers.push(cssEscapeValue(img));
            if (prefs.gradient) layers.push(gradientCss(prefs.gradient));
            if (layers.length) {
                rootBits.push(`background-image: ${layers.join(", ")} !important`);
            }
            // Without a fixed attachment a gradient restarts per screen of a long page.
            if (prefs.gradient && !img && (prefs.backgroundAttachment == null || String(prefs.backgroundAttachment).trim() === "")) {
                rootBits.push("background-attachment: fixed !important");
            }
            if (prefs.backgroundSize != null && String(prefs.backgroundSize).trim() !== "") {
                rootBits.push(
                    `background-size: ${cssEscapeValue(prefs.backgroundSize)} !important`
                );
            }
            if (
                prefs.backgroundPosition != null &&
                String(prefs.backgroundPosition).trim() !== ""
            ) {
                rootBits.push(
                    `background-position: ${cssEscapeValue(prefs.backgroundPosition)} !important`
                );
            }
            if (
                prefs.backgroundRepeat != null &&
                String(prefs.backgroundRepeat).trim() !== ""
            ) {
                rootBits.push(
                    `background-repeat: ${cssEscapeValue(prefs.backgroundRepeat)} !important`
                );
            }
            if (
                prefs.backgroundAttachment != null &&
                String(prefs.backgroundAttachment).trim() !== ""
            ) {
                rootBits.push(
                    `background-attachment: ${cssEscapeValue(prefs.backgroundAttachment)} !important`
                );
            }
        }
        if (prefs.color != null && String(prefs.color).trim() !== "") {
            rootBits.push(`color: ${cssEscapeValue(prefs.color)} !important`);
        }
        if (prefs.pageFont) {
            rules.push(`html, body {
  font-family: ${resolvedPageFontStack || quoteFamily(prefs.pageFont)} !important;
}`);
        }

        if (rootBits.length) {
            rules.push(`html, body {
  ${rootBits.join(";\n  ")};
}`);
            // Cover full viewport when body is short.
            rules.push(`html {
  min-height: 100%;
}`);
            rules.push(`body {
  min-height: 100%;
  background-repeat: inherit;
}`);
        }

        el.textContent = rules.join("\n");
        return applyPwa();
    };

    /**
     * register() gets the Navi instance (setPwa), not the global facade (navi.pwa).
     * Resolve either so theme_color actually hits PWA chrome.
     */
    const pwaApi = () => {
        if (navi?.pwa && typeof navi.pwa.set === "function") return navi.pwa;
        if (typeof navi?.setPwa === "function") {
            return {
                set: (c) => navi.setPwa(c),
                get: () =>
                    typeof navi.getPwaConfig === "function"
                        ? navi.getPwaConfig()
                        : null,
            };
        }
        const g =
            typeof globalThis !== "undefined" ? globalThis.navi : null;
        if (g?.pwa && typeof g.pwa.set === "function") return g.pwa;
        return null;
    };

    /** Merge theme/background into current navi.pwa config (does not wipe icons/name). */
    const applyPwa = () => {
        if (!isBrowser) return null;

        const patch = {};
        if (prefs.themeColor != null && String(prefs.themeColor).trim() !== "") {
            patch.theme_color = String(prefs.themeColor).trim();
        }
        if (
            prefs.backgroundColorPwa != null &&
            String(prefs.backgroundColorPwa).trim() !== ""
        ) {
            patch.background_color = String(prefs.backgroundColorPwa).trim();
        }
        if (Object.keys(patch).length === 0) return null;

        const api = pwaApi();
        if (!api || typeof api.set !== "function") {
            const msg = say("pwa API missing — theme_color not applied");
            console.warn(msg);
            return msg;
        }

        try {
            const cur = typeof api.get === "function" ? api.get() : null;
            const base = cur && typeof cur === "object" ? cur : {};
            api.set({ ...base, ...patch });
            return say(
                `pwa ${
                    patch.theme_color ? `theme_color ${patch.theme_color}` : ""
                }${
                    patch.theme_color && patch.background_color ? " " : ""
                }${
                    patch.background_color
                        ? `background_color ${patch.background_color}`
                        : ""
                }`
            );
        } catch (err) {
            const msg = say(`pwa set failed: ${err?.message || err}`);
            console.warn(msg);
            return msg;
        }
    };

    const clearStyle = () => {
        if (!isBrowser) return;
        const el = styleEl || document.getElementById(STYLE_ID);
        if (el && el.parentNode) el.parentNode.removeChild(el);
        styleEl = null;
        revokeBlob();
        resolvedBgImage = null;
    };

    const statusLines = () => {
        const lines = [
            say(`scale ${prefs.scale}%`),
            say(
                `color ${prefs.color == null || prefs.color === "" ? "(unset)" : short(prefs.color)}`
            ),
            say(
                `background ${
                    prefs.background == null || prefs.background === ""
                        ? "(unset)"
                        : short(prefs.background, 80)
                }`
            ),
            say(
                `background-color ${
                    prefs.backgroundColor == null || prefs.backgroundColor === ""
                        ? "(unset)"
                        : short(prefs.backgroundColor, 80)
                }`
            ),
        ];
        lines.push(say(`bggradient ${prefs.gradient ? short(gradientCss(prefs.gradient), 100) : "(unset)"}`));
        const imgSrc = prefs.bgImageSource;
        if (imgSrc?.kind === "file") {
            lines.push(say(`background-image file ${imgSrc.ref}`));
        } else if (imgSrc?.kind === "bin") {
            lines.push(say(`background-image bin ${short(imgSrc.ref, 20)}`));
        } else {
            lines.push(
                say(
                    `background-image ${
                        prefs.backgroundImage == null || prefs.backgroundImage === ""
                            ? "(unset)"
                            : short(prefs.backgroundImage, 80)
                    }`
                )
            );
        }
        for (const [label, key] of [
            ["background-size", "backgroundSize"],
            ["background-position", "backgroundPosition"],
            ["background-repeat", "backgroundRepeat"],
            ["background-attachment", "backgroundAttachment"],
        ]) {
            const v = prefs[key];
            lines.push(say(`${label} ${v == null || v === "" ? "(unset)" : short(v)}`));
        }
        lines.push(
            say(
                `theme_color ${
                    prefs.themeColor == null || prefs.themeColor === ""
                        ? "(unset)"
                        : short(prefs.themeColor)
                }`
            )
        );
        lines.push(
            say(
                `pwa background_color ${
                    prefs.backgroundColorPwa == null || prefs.backgroundColorPwa === ""
                        ? "(unset)"
                        : short(prefs.backgroundColorPwa)
                }`
            )
        );
        lines.push(
            say(
                `fonts ${prefs.fontsEnabled === false ? "off" : "on"} — page font ${
                    prefs.pageFont || "(unset)"
                }, pinned ${(prefs.pinnedFonts || []).length}, loaded ${loadedFonts.size}`
            )
        );
        return lines.join("\n");
    };

    const fontsCommand = async (args) => {
        const sub = String(args[0] || "status").trim().toLowerCase();
        const rest = joinRest(args.slice(1));
        if (sub === "on" || sub === "enable") {
            prefs.fontsEnabled = true;
            await savePrefs();
            await restoreFonts();
            await applyPageFont();
            return say("fonts → on (Fontsource catalog, Bunny fallback)");
        }
        if (sub === "off" || sub === "disable") {
            prefs.fontsEnabled = false;
            await savePrefs();
            return say("fonts → off (system fonts only; already-loaded CSS stays until reload)");
        }
        if (sub === "refresh" || sub === "reload") {
            const cat = await loadCatalog({ force: true });
            return say(`catalog → ${cat.fonts.length} fonts from ${cat.source}`);
        }
        if (sub === "search" || sub === "find" || sub === "list") {
            const q = rest.toLowerCase();
            const all = await listFonts();
            const hits = all.filter(
                (f) =>
                    !q ||
                    f.family.toLowerCase().includes(q) ||
                    f.id.toLowerCase().includes(q) ||
                    f.category.toLowerCase() === q
            );
            const shown = hits.slice(0, 40).map((f) => `  ${f.family}  [${f.category}] ${f.id}`);
            return [
                say(`${hits.length} match${hits.length === 1 ? "" : "es"}${q ? ` for "${q}"` : ""}`),
                ...shown,
                hits.length > shown.length ? `  … ${hits.length - shown.length} more` : "",
            ]
                .filter(Boolean)
                .join("\n");
        }
        if (sub === "load" || sub === "pin" || sub === "remember") {
            if (!rest) return say(`usage: stylishmod fonts ${sub} <family|id>`);
            const font = await pinFont(rest);
            if (!font) return say(`font not found: ${rest}`);
            return say(`font ${font.family} → loaded + pinned (${font.stack})`);
        }
        if (sub === "forget" || sub === "unpin") {
            if (!rest) return say("usage: stylishmod fonts forget <family|id|all>");
            const n = await unpinFont(rest);
            return say(`unpinned ${n} font${n === 1 ? "" : "s"}`);
        }
        if (sub === "status") {
            const cat = fontCatalog;
            return [
                say(`fonts ${prefs.fontsEnabled === false ? "off" : "on"}`),
                say(
                    `catalog ${
                        cat ? `${cat.fonts.length} from ${cat.source}` : "(not fetched yet)"
                    }`
                ),
                say(`page font ${prefs.pageFont || "(unset)"}`),
                say(`pinned ${(prefs.pinnedFonts || []).join(", ") || "(none)"}`),
                say(`loaded ${[...loadedFonts.keys()].join(", ") || "(none)"}`),
            ].join("\n");
        }
        return say("usage: stylishmod fonts <on|off|status|refresh|search|load|forget>");
    };

    const HELP = [
        "stylishmod — html/body theme + page scale + PWA colors",
        "",
        "  stylishmod                         Status",
        "  stylishmod status                  Same",
        "  stylishmod help                    This help",
        "  stylishmod reset                   Clear theme prefs; scale → 100",
        "  stylishmod clearstyle              Remove injected CSS only (prefs kept)",
        "",
        "  stylishmod scale <percent>         Page zoom (default 100; 10–400)",
        "  stylishmod text <color>            color (alias: color)",
        "  stylishmod bgcolor <css>           background-color (solid or any CSS color)",
        "  stylishmod bggradient <c1> <c2> […] Gradient background (2+ colors, linear by default)",
        "  stylishmod bggradient [linear|radial|conic] [135deg | to bottom right] <c1> <c2> […]",
        "  stylishmod bggradient #000 30%, #fff Commas for stops with positions",
        "  stylishmod bggradient unset        Back to bgcolor only",
        "  stylishmod bgimage <css>           background-image (url, gradient, …)",
        "  stylishmod bgimage file <path>     From navi.storage.file",
        "  stylishmod bgimage bin <sha>       From navi.storage.bin",
        "  stylishmod bg <css>                Full background shorthand",
        "  stylishmod bgsize <css>            background-size (cover, contain, …)",
        "  stylishmod bgpos <css>             background-position",
        "  stylishmod bgrepeat <css>          background-repeat",
        "  stylishmod bgattach <css>          background-attachment",
        "  stylishmod theme_color <css>       PWA theme-color (navi.pwa)",
        "  stylishmod pwa_bg <css>            PWA background_color (splash)",
        "",
        "  stylishmod font <family|unset>     Page-wide font-family (loads web font)",
        "  stylishmod fonts                   Web font status",
        "  stylishmod fonts on|off            Allow open web fonts (Fontsource/Bunny)",
        "  stylishmod fonts search <q>        Search catalog (name or category)",
        "  stylishmod fonts load <family>     Load + keep loaded across remounts",
        "  stylishmod fonts forget <f|all>    Stop keeping a font loaded",
        "  stylishmod fonts refresh           Refetch the font catalog",
        "",
        "Unset any field: stylishmod bgcolor unset",
        "Gradient examples:",
        "  stylishmod bggradient #1a1a2e #16213e",
        "  stylishmod bggradient 135deg #ff9a9e #fad0c4 #fbc2eb",
        "  stylishmod bggradient radial circle at center #333 #000",
        "The gradient sits over bgcolor and under bgimage; `bg` (shorthand) overrides both.",
        "PWA colors merge into current navi.pwa (icons/name kept).",
        "",
        `Prefs: navi.storage.item ${STORAGE_KEY}`,
    ].join("\n");

    const setCssField = async (field, value, label) => {
        if (!value) {
            const cur = prefs[field];
            return say(
                `${label} ${cur == null || cur === "" ? "(unset)" : cur}`
            );
        }
        if (isUnsetToken(value)) {
            prefs[field] = null;
            if (field === "backgroundImage") {
                prefs.bgImageSource = null;
                resolvedBgImage = null;
                revokeBlob();
            }
            if (field === "background") {
                // clearing shorthand only
            }
        } else {
            prefs[field] = value;
            if (field === "backgroundImage") {
                prefs.bgImageSource = { kind: "css", ref: value };
                resolvedBgImage = value;
            }
            // Setting shorthand clears layered longhands conflict? Keep both;
            // apply() prefers background shorthand when set.
        }
        await savePrefs();
        apply();
        return say(`${label} → ${isUnsetToken(value) ? "(unset)" : short(value, 100)}`);
    };

    const execute = async (action, ...args) => {
        const cmd = String(action || "status")
            .trim()
            .toLowerCase();
        const rest = joinRest(args);

        if (!action || cmd === "help" || cmd === "-h" || cmd === "--help") {
            return action ? HELP : statusLines() + "\n\n(type stylishmod help)";
        }

        if (cmd === "status" || cmd === "show" || cmd === "get") {
            return statusLines();
        }

        if (cmd === "reset" || cmd === "clear") {
            prefs = { ...DEFAULTS };
            resolvedBgImage = null;
            revokeBlob();
            await savePrefs();
            apply();
            return say("reset → scale 100%, theme cleared");
        }

        if (cmd === "clearstyle" || cmd === "clear-style" || cmd === "removestyle") {
            clearStyle();
            return say("clearstyle → injected CSS removed (prefs kept; remount/apply restores)");
        }

        if (cmd === "scale" || cmd === "zoom") {
            if (!rest) return say(`scale ${prefs.scale}%`);
            const s = clampScale(String(rest).replace(/%/g, ""));
            if (s == null) return say("usage: stylishmod scale <percent>  (10–400)");
            prefs.scale = s;
            await savePrefs();
            apply();
            return say(`scale → ${s}%`);
        }

        if (cmd === "fonts" || cmd === "webfonts") {
            try {
                return await fontsCommand(args);
            } catch (err) {
                return say(`fonts failed: ${err?.message || err}`);
            }
        }

        if (cmd === "font" || cmd === "font-family" || cmd === "fontfamily") {
            if (!rest) return say(`page font ${prefs.pageFont || "(unset)"}`);
            if (isUnsetToken(rest)) {
                prefs.pageFont = null;
                prefs.pageFontId = null;
                resolvedPageFontStack = "";
                await savePrefs();
                apply();
                return say("page font → (unset)");
            }
            let font = null;
            try {
                font = await loadFont(rest);
            } catch (err) {
                return say(`font failed: ${err?.message || err}`);
            }
            prefs.pageFont = font ? font.family : rest;
            await savePrefs();
            await applyPageFont();
            return say(
                `page font → ${prefs.pageFont}${font ? "" : " (not in catalog; used as raw family)"}`
            );
        }

        if (cmd === "text" || cmd === "color" || cmd === "fg" || cmd === "foreground") {
            return await setCssField("color", rest, "color");
        }

        if (cmd === "bgcolor" || cmd === "background-color" || cmd === "backgroundcolor") {
            return await setCssField("backgroundColor", rest, "background-color");
        }

        if (cmd === "bg" || cmd === "background") {
            return await setCssField("background", rest, "background");
        }

        if (cmd === "bggradient" || cmd === "background-gradient") {
            if (!rest) return say(`bggradient ${prefs.gradient ? gradientCss(prefs.gradient) : "(unset)"}`);
            if (isUnsetToken(rest)) {
                prefs.gradient = null;
                await savePrefs();
                apply();
                return say("bggradient → (unset)");
            }
            const g = parseGradient(rest);
            if (!g) return say("usage: stylishmod bggradient [linear|radial|conic] [angle|to <side>] <color> <color> [color…]");
            prefs.gradient = g;
            prefs.background = null; // the shorthand would hide it
            await savePrefs();
            apply();
            return say(`bggradient → ${short(gradientCss(g), 100)}`);
        }

        if (cmd === "bgsize" || cmd === "background-size") {
            return await setCssField("backgroundSize", rest, "background-size");
        }

        if (cmd === "bgpos" || cmd === "background-position") {
            return await setCssField("backgroundPosition", rest, "background-position");
        }

        if (cmd === "bgrepeat" || cmd === "background-repeat") {
            return await setCssField("backgroundRepeat", rest, "background-repeat");
        }

        if (cmd === "bgattach" || cmd === "background-attachment") {
            return await setCssField(
                "backgroundAttachment",
                rest,
                "background-attachment"
            );
        }

        if (
            cmd === "theme_color" ||
            cmd === "themecolor" ||
            cmd === "theme-color" ||
            cmd === "pwa_theme" ||
            cmd === "pwatheme"
        ) {
            if (!rest) {
                return say(
                    `theme_color ${
                        prefs.themeColor == null || prefs.themeColor === ""
                            ? "(unset)"
                            : prefs.themeColor
                    }`
                );
            }
            if (isUnsetToken(rest)) {
                prefs.themeColor = null;
                await savePrefs();
                apply();
                return say("theme_color → (unset) — remount/relaunch to restore shell default");
            }
            prefs.themeColor = rest;
            await savePrefs();
            const pwa = apply();
            return say(`theme_color → ${short(rest, 100)}`) + (pwa ? `\n${pwa}` : "");
        }

        if (
            cmd === "pwa_bg" ||
            cmd === "pwa_background" ||
            cmd === "pwa_bgcolor" ||
            cmd === "background_color" ||
            cmd === "pwabg"
        ) {
            if (!rest) {
                return say(
                    `pwa background_color ${
                        prefs.backgroundColorPwa == null ||
                        prefs.backgroundColorPwa === ""
                            ? "(unset)"
                            : prefs.backgroundColorPwa
                    }`
                );
            }
            if (isUnsetToken(rest)) {
                prefs.backgroundColorPwa = null;
                await savePrefs();
                apply();
                return say("pwa background_color → (unset)");
            }
            prefs.backgroundColorPwa = rest;
            await savePrefs();
            const pwa = apply();
            return say(`pwa background_color → ${short(rest, 100)}`) + (pwa ? `\n${pwa}` : "");
        }

        if (cmd === "bgimage" || cmd === "background-image" || cmd === "image") {
            const kind = String(args[0] || "")
                .trim()
                .toLowerCase();
            if (kind === "file") {
                const path = joinRest(args.slice(1));
                if (!path) return say("usage: stylishmod bgimage file <path>");
                if (isUnsetToken(path)) {
                    prefs.bgImageSource = null;
                    prefs.backgroundImage = null;
                    resolvedBgImage = null;
                    revokeBlob();
                    await savePrefs();
                    apply();
                    return say("background-image → (unset)");
                }
                prefs.bgImageSource = { kind: "file", ref: path };
                prefs.background = null; // prefer longhands
                try {
                    await resolveBgImage();
                } catch (err) {
                    prefs.bgImageSource = null;
                    return say(`bgimage file failed: ${err?.message || err}`);
                }
                await savePrefs();
                apply();
                return say(`background-image → file ${path}`);
            }
            if (kind === "bin") {
                const sha = joinRest(args.slice(1));
                if (!sha) return say("usage: stylishmod bgimage bin <sha>");
                if (isUnsetToken(sha)) {
                    prefs.bgImageSource = null;
                    prefs.backgroundImage = null;
                    resolvedBgImage = null;
                    revokeBlob();
                    await savePrefs();
                    apply();
                    return say("background-image → (unset)");
                }
                prefs.bgImageSource = { kind: "bin", ref: sha };
                prefs.background = null;
                try {
                    await resolveBgImage();
                } catch (err) {
                    prefs.bgImageSource = null;
                    return say(`bgimage bin failed: ${err?.message || err}`);
                }
                await savePrefs();
                apply();
                return say(`background-image → bin ${short(sha, 24)}`);
            }
            // CSS value (gradient, url(...), unset, …)
            return await setCssField("backgroundImage", rest, "background-image");
        }

        return say(`unknown: ${cmd} — type stylishmod help`);
    };

    return {
        name: "stylishmod",
        version: "0.5.1",
        description:
            "Page html/body background (color/gradient/image/file/bin), text color, scale %, PWA theme_color, open web fonts",
        moduleInfo: {
            name: "stylishmod",
            version: "0.5.1",
            description:
                "Page theme: bgcolor, gradient, bgimage, scale %, PWA colors, page font + open web font provider",
        },
        about: {
            name: "stylishmod",
            version: "0.5.1",
            description:
                "Page theme: bgcolor, gradient, bgimage, scale %, PWA colors, page font + open web font provider",
        },
        /** Font provider for other mods (jockey_stylish): navi.mod.stylishmod.fonts */
        fonts: {
            enabled: () => prefs.fontsEnabled !== false,
            system: () => SYSTEM_FONTS.slice(),
            catalog: (opts) => loadCatalog(opts),
            list: (opts) => listFonts(opts),
            find: (q) => findFont(q),
            load: (idOrFont) => loadFont(idOrFont),
            loaded: (id) => loadedFonts.has(String(id || "")),
            release: (id) => releaseFont(id),
            remember: (idOrFont) => pinFont(idOrFont),
            forget: (idOrFont) => unpinFont(idOrFont),
            stack: (font) => fontStack(font),
            generic: (category) => genericFor(category),
        },
        commands: {
            stylishmod: {
                name: "stylishmod",
                description:
                    "stylishmod <scale|bgcolor|bggradient|bgimage|bg|text|font|fonts|theme_color|pwa_bg|clearstyle|reset|status|help>",
                execute,
            },
        },
        onMount: async () => {
            await loadPrefs();
            apply();
            restoreFonts()
                .then(() => (prefs.pageFont ? applyPageFont() : null))
                .catch((err) => console.warn(say("font restore failed:"), err));
            watchTaggedFonts();
            if (typeof navi.callout === "function") {
                navi.callout(say(`mounted — scale ${prefs.scale}%`));
            }
        },
        onUnmount: async () => {
            unwatchTaggedFonts();
            if (typeof navi.callout === "function") {
                navi.callout(say("unmounted — styles left applied"));
            }
        },
    };
};
