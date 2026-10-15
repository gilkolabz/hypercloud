// horizon_stagedir — navi-module companion for the Horizon proscenium stage.
//
// Inserted content is "activated" the way surf does after a swap: <script>
// tags are rebuilt (innerHTML/template inserts never execute scripts) and
// htmx.process() is run so hx-* attributes bind. Moving an existing live
// element does not need this — its scripts already ran and htmx already bound.
//
// The stage is server-rendered by Horizon into the client DOM: three bands
// (US/S/DS) and columns addressed by id (USL USC USR / SL CS SR / DSL DSC DSR).
// Marching hangs a nested 3×3 off a cell: CS/R is Stage Right of CS-as-CS,
// never SR. Only occupied marched cells are stored; flexbox grows the viewport.
// Once it is on the client it is ours: this module directs the stage by moving
// the LIVE occupant elements between columns — no repaint, no re-fetch of the
// stage, no round-trip to the server renderer.
//
// Indexing is inside-out, matching horizon_v1.js: index 0 is the occupant
// nearest center stage. Left columns (USL/SL/DSL) render reversed, so their
// DOM child order is the reverse of the logical order — the module maps between
// the two so `stagedir SL 0 ...` always addresses the innermost item.
//
// Default placement:
//   - `move` FROM a center slot (USC/CS/DSC) → destination logical index 0
//     (pushes in from center on SL/SR and US/DS left/right).
//   - `move` between side columns (e.g. SR→SL, SL→SR) → same as `add`:
//     logical end / outermost.
//   - `add` → logical end / outermost.
// Explicit destination index on move (`… move DEST k`) or add (`add SLOT k …`)
// overrides these defaults.
//
// navi.storage.item holds a PRESET INDEX: a JSON array of stage_dir manifests.
// Slot 0 is the live stage (kept in sync after each direction; the first-gen
// stage_dir manifest seeds it). Slots 1..n are saved arrangements. `preset N`
// (N>0) copies slot N into slot 0 and repaints, so slot 0 is always "the live
// one". Populate slots programmatically via stage.setPreset(n, manifest) or
// `preset new`/`save`. Documents declare parts ["stage_dir","manifest","json"].
//
// Directions come in through the `stagedir` navi command:
//   navi('stagedir CS 0 move SR')   move the first Center Stage item to Stage Right
//   navi('stagedir preset 1')       load preset 1 into slot 0 and repaint
//
// On put (add / href / resolveOccupant), stamps data-hash from the initial
// HTML/text string (sync FNV + timestamp + entropy). Never overwritten after install.
// Also listens for htmx:beforeSwap / afterSwap / oobAfterSwap and stamps
// data-hash on swapped-in element roots from the response body string.

export const register = (navi) => {
    const isBrowser = typeof window !== "undefined" && typeof window.document !== "undefined";

    /** Insert/move `el` before `ref` in `parent`, state-preserving when both are live. */
    const placeNode = (parent, el, ref) => {
        if (el.parentNode === parent && el.nextSibling === ref) return;
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

    const eventListeners = [];
    const createdElements = [];
    const addedStyles = [];
    const observers = [];
    const timers = [];

    // The preset index: an array of stage_dir manifests stored as objects.
    // Slot 0 is the live stage; slots 1..n are saved arrangements.
    const INDEX_KEY = "horizon_stage_presets";
    /** Live stage UI prefs (member separators, etc.) — not a stage_dir manifest. */
    const SETTINGS_KEY = "horizon_stage_settings";
    const STAGE_DIR_PARTS = ["stage_dir", "manifest", "json"];
    /** Stamp on interstitial <br> so pick/serialize skip them as occupants. */
    const MEMBER_SEP_ATTR = "data-stagedir-sep";
    const MEMBER_SEP_VAL = "br";
    const MEMBER_SEP_HTML = `<br ${MEMBER_SEP_ATTR}="${MEMBER_SEP_VAL}">`;
    const ROOT_STYLE =
        "margin:0;min-height:100vh;overflow:none;display:flex;flex-direction:column;justify-content:space-evenly;";
    /** Flipped: root row + bands column — 3×3 visual transpose (rows↔columns). */
    const ROOT_STYLE_FLIPPED =
        "margin:0;min-height:100vh;overflow:none;display:flex;flex-direction:row;justify-content:space-evenly;";
    const BAND_STYLE = "display:flex;flex-direction:row";
    const BAND_STYLE_FLIPPED = "display:flex;flex-direction:column";
    /** Paint depth, all positive: US front, S mid, DS back.
     * Negative z drops DS under the page root and blocks pointer hits on downstage. */
    const BAND_Z = { US: 3, S: 2, DS: 1 };
    const bandStyle = (bandId, flipped = false) => {
        const z = BAND_Z[bandId] ?? 0;
        return `${flipped ? BAND_STYLE_FLIPPED : BAND_STYLE};position:relative;z-index:${z}`;
    };
    const STAGE_ROOT_SEL =
        'div[name="horizon/v1"],div[name="jockeystage/v1"]';

    const esc = (s) =>
        String(s)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");

    /**
     * Sync install id for data-hash at put time (not crypto).
     * FNV-1a 32-bit + length + Date.now hex + 4-hex entropy —
     * unique per stamp even when markup matches a prior install.
     * Do not recompute on paint; never overwrite an existing data-hash.
     */
    const hashContentSync = (text) => {
        const s = String(text ?? "");
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
    };

    /** Stamp install hash once; never overwrite. */
    const stampDataHash = (el, contentHash) => {
        if (!el || el.nodeType !== 1 || !contentHash) return;
        if (el.hasAttribute("data-hash")) return;
        el.setAttribute("data-hash", String(contentHash));
    };

    /**
     * Pending install hash for the in-flight htmx swap (beforeSwap → afterSwap).
     * Swaps are effectively serial on the main thread; one slot is enough.
     */
    let pendingHtmxInstallHash = null;

    const hxSwapStyleOf = (elt) => {
        if (!elt || typeof elt.getAttribute !== "function") return "innerhtml";
        const raw =
            elt.getAttribute("hx-swap") ||
            elt.getAttribute("data-hx-swap") ||
            "";
        const style = String(raw).trim().split(/\s+/)[0].toLowerCase();
        return style || "innerhtml";
    };

    /** After an htmx swap: stamp roots that represent the arrived markup. */
    const stampHtmxSwapTarget = (detail, contentHash, eventTarget = null) => {
        if (!contentHash || !detail) return;
        const style = hxSwapStyleOf(detail.elt);
        // outerHTML: htmx fires afterSwap on the *new* node (event.target /
        // detail.elt). detail.target is still the *old* swap target (detached).
        if (style === "outerhtml" || style === "replace") {
            const arrived =
                (eventTarget instanceof HTMLElement && eventTarget) ||
                (detail.elt instanceof HTMLElement && detail.elt) ||
                (detail.target instanceof HTMLElement && detail.target);
            if (arrived) stampDataHash(arrived, contentHash);
            return;
        }
        const target = detail.target;
        if (!(target instanceof HTMLElement)) return;
        // innerHTML / beforeend / afterbegin / … — stamp element children
        // that do not already have an install hash (new arrivals only).
        for (const child of Array.from(target.children || [])) {
            stampDataHash(child, contentHash);
        }
    };

    const onHtmxBeforeSwap = (e) => {
        try {
            const d = e?.detail;
            const raw =
                d?.serverResponse ??
                d?.xhr?.responseText ??
                d?.xhr?.response;
            pendingHtmxInstallHash =
                raw != null && String(raw).length
                    ? hashContentSync(raw)
                    : null;
        } catch {
            pendingHtmxInstallHash = null;
        }
    };

    const onHtmxAfterSwap = (e) => {
        let hash = pendingHtmxInstallHash;
        pendingHtmxInstallHash = null;
        try {
            if (!hash) {
                const d = e?.detail;
                const raw =
                    d?.serverResponse ??
                    d?.xhr?.responseText ??
                    d?.xhr?.response;
                if (raw != null && String(raw).length) {
                    hash = hashContentSync(raw);
                }
            }
            const arrived =
                e?.target instanceof HTMLElement
                    ? e.target
                    : e?.detail?.elt instanceof HTMLElement
                      ? e.detail.elt
                      : null;
            stampHtmxSwapTarget(e?.detail, hash, arrived);
            if (arrived && !arrived.hasAttribute("data-hash")) {
                stampDataHash(
                    arrived,
                    hash || hashContentSync(arrived.outerHTML)
                );
            }
        } catch (err) {
            console.error("[horizon_stagedir] htmx data-hash stamp failed:", err);
        }
    };

    const onHtmxOobAfterSwap = (e) => {
        // OOB may not pair with our beforeSwap slot; hash target outerHTML once.
        try {
            const target = e?.detail?.target;
            if (!(target instanceof HTMLElement)) return;
            if (target.hasAttribute("data-hash")) return;
            stampDataHash(target, hashContentSync(target.outerHTML));
        } catch (err) {
            console.error("[horizon_stagedir] htmx oob data-hash stamp failed:", err);
        }
    };

    const armHtmxHashListeners = () => {
        if (!isBrowser || typeof document === "undefined") return;
        // Capture on document — htmx fires on the requesting elt; body-only
        // bubble miss if the request node is detached mid-swap.
        const root = document;
        const add = (event, handler) => {
            root.addEventListener(event, handler, true);
            eventListeners.push({ element: root, event, handler, capture: true });
        };
        add("htmx:beforeSwap", onHtmxBeforeSwap);
        add("htmx:afterSwap", onHtmxAfterSwap);
        add("htmx:oobAfterSwap", onHtmxOobAfterSwap);
    };

    /**
     * Path ergonomics when surf is mounted: whitespace → `/` (keeps `:` / //).
     * @see A_document/slashfold.md
     */
    const slashfoldPath = (raw) => {
        const s = String(raw ?? "").trim();
        if (!s) return "";
        const fn = navi?.mod?.surf?.slashfold;
        if (typeof fn === "function") {
            try {
                const out = fn(s);
                if (typeof out === "string") return out;
            } catch {
                /* fall through */
            }
        }
        return s.replace(/\s+/g, "/").replace(/^\/+/, "").replace(/\/{3,}/g, "//");
    };

    const BAND_LAYOUT = [
        { id: "US", name: "Upstage", left: "USL", center: "USC", right: "USR" },
        { id: "S", name: "Stage", left: "SL", center: "CS", right: "SR" },
        { id: "DS", name: "Downstage", left: "DSL", center: "DSC", right: "DSR" },
    ];

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

    const SLOTS = Object.keys(SLOT_LABELS);
    // Left columns index inside-out (0 = nearest center, last = furthest left),
    // matching horizon_v1.js which reverses left occupants before rendering. The
    // DOM child order of a left column is therefore the reverse of its logical order.
    const LEFT_SLOTS = new Set(["USL", "SL", "DSL"]);
    const CENTER_SLOTS = new Set(["USC", "CS", "DSC"]);
    /** One step from a cell-as-CS: U/D/L/R and diagonals. Not the nine base names. */
    const STEP_INFO = {
        UL: { row: "US", col: "L", like: "USL", label: "Upstage Left" },
        U: { row: "US", col: "C", like: "USC", label: "Upstage" },
        UR: { row: "US", col: "R", like: "USR", label: "Upstage Right" },
        L: { row: "S", col: "L", like: "SL", label: "Stage Left" },
        R: { row: "S", col: "R", like: "SR", label: "Stage Right" },
        DL: { row: "DS", col: "L", like: "DSL", label: "Downstage Left" },
        D: { row: "DS", col: "C", like: "DSC", label: "Downstage" },
        DR: { row: "DS", col: "R", like: "DSR", label: "Downstage Right" },
    };
    const STEP_NAMES = new Set(Object.keys(STEP_INFO));
    const COL_ORDER = ["L", "C", "R"];
    const ROW_ORDER = ["US", "S", "DS"];
    const COL_STYLE = "margin:auto;position:relative";
    const NEST_STYLE =
        "display:flex;flex-direction:column;margin:auto;position:relative;flex:1 1 auto";
    const NEST_STYLE_FLIPPED =
        "display:flex;flex-direction:row;margin:auto;position:relative;flex:1 1 auto";

    const normalizeStep = (raw) => {
        const s = String(raw || "")
            .trim()
            .toUpperCase();
        return STEP_NAMES.has(s) ? s : null;
    };

    /** Canonical slot path: CS or CS/R/U. Null if not a zone path. */
    const parseSlot = (raw) => {
        const parts = String(raw || "")
            .trim()
            .split(/[/\s]+/)
            .filter(Boolean)
            .map((p) => p.toUpperCase());
        if (!parts.length) return null;
        if (!(parts[0] in SLOT_LABELS)) return null;
        const steps = [];
        for (const p of parts.slice(1)) {
            const st = normalizeStep(p);
            if (!st) return null;
            steps.push(st);
        }
        return steps.length ? `${parts[0]}/${steps.join("/")}` : parts[0];
    };

    const parentSlot = (slotKey) => {
        const k = parseSlot(slotKey);
        if (!k || !k.includes("/")) return null;
        return k.slice(0, k.lastIndexOf("/"));
    };

    const lastStepOf = (slotKey) => {
        const k = parseSlot(slotKey);
        if (!k || !k.includes("/")) return null;
        return k.slice(k.lastIndexOf("/") + 1);
    };

    const slotParts = (slotKey) => {
        const k = parseSlot(slotKey);
        if (!k) return null;
        const bits = k.split("/");
        return { base: bits[0], steps: bits.slice(1), key: k };
    };

    const slotLabel = (slotKey) => {
        const p = slotParts(slotKey);
        if (!p) return String(slotKey || "");
        if (!p.steps.length) return SLOT_LABELS[p.base];
        return [SLOT_LABELS[p.base], ...p.steps.map((st) => STEP_INFO[st].label)].join(
            " · "
        );
    };

    const isLeftSlot = (slotKey) => {
        const st = lastStepOf(slotKey);
        if (st) return STEP_INFO[st].col === "L";
        return LEFT_SLOTS.has(parseSlot(slotKey));
    };

    const isCenterSlot = (slotKey) => {
        const st = lastStepOf(slotKey);
        if (st) return STEP_INFO[st].col === "C";
        return CENTER_SLOTS.has(parseSlot(slotKey));
    };

    /** Peel a slot path off command args (callin splits on /). */
    const takeSlot = (args) => {
        const list = Array.from(args || []).map(String);
        if (!list.length) return { slot: null, rest: list };
        if (list[0].includes("/")) {
            const slot = parseSlot(list[0]);
            if (slot) return { slot, rest: list.slice(1) };
        }
        if (!(String(list[0]).toUpperCase() in SLOT_LABELS)) {
            return { slot: null, rest: list };
        }
        let i = 1;
        const steps = [];
        while (i < list.length) {
            const st = normalizeStep(list[i]);
            if (!st) break;
            steps.push(st);
            i += 1;
        }
        const base = String(list[0]).toUpperCase();
        return {
            slot: steps.length ? `${base}/${steps.join("/")}` : base,
            rest: list.slice(i),
        };
    };

    const nestStyle = (flipped) => (flipped ? NEST_STYLE_FLIPPED : NEST_STYLE);

    /** Lowercase part name, or "" when missing. Preserves space-separated multi-parts. */
    const partName = (raw) =>
        raw == null ? "" : String(raw).trim().toLowerCase();

    const partNames = (raw) =>
        partName(raw)
            .split(/\s+/)
            .filter(Boolean);

    const isExclusivePart = (type, name) => {
        const parts = partNames(type);
        return parts.length === 1 && parts[0] === name;
    };
    const normalizeOccupantPath = (path) =>
        String(path || "")
            .trim()
            .replace(/^\/+/, "");

    class HorizonStage {
        constructor() {
            // Keeps each live element tied to the presentation abstract that
            // produced it. DOM serialization alone would erase href routes.
            this._presentationByElement = new WeakMap();
            /** When true, zone members are separated by stamped <br>. */
            this._separateWithBr = false;
        }

        isMemberSeparator(el) {
            return (
                !!el &&
                el.nodeType === 1 &&
                String(el.tagName || "").toUpperCase() === "BR" &&
                el.getAttribute?.(MEMBER_SEP_ATTR) === MEMBER_SEP_VAL
            );
        }

        separateWithBr() {
            return this._separateWithBr === true;
        }

        memberChildren(col) {
            if (!col) return [];
            return Array.from(col.children).filter(
                (c) => !this.isMemberSeparator(c)
            );
        }

        makeMemberSeparator() {
            const br = document.createElement("br");
            br.setAttribute(MEMBER_SEP_ATTR, MEMBER_SEP_VAL);
            return br;
        }

        stripMemberSeparators(col) {
            if (!col || !isBrowser) return;
            for (const kid of Array.from(col.children)) {
                if (this.isMemberSeparator(kid)) kid.remove();
            }
        }

        /** Rebuild stamped <br> between real members in DOM order (or strip). */
        syncMemberSeparators(col) {
            if (!col || !isBrowser) return;
            this.stripMemberSeparators(col);
            if (!this.separateWithBr()) return;
            const members = Array.from(col.children);
            for (let i = 1; i < members.length; i++) {
                col.insertBefore(this.makeMemberSeparator(), members[i]);
            }
        }

        syncAllMemberSeparators() {
            if (!isBrowser) return;
            for (const col of this.slotColumns()) {
                this.syncMemberSeparators(col);
            }
        }

        async loadSettings() {
            try {
                const raw = await navi.storage.item.get(SETTINGS_KEY);
                if (raw && typeof raw === "object") {
                    this._separateWithBr = raw.separateWithBr === true;
                }
            } catch {
                /* keep defaults */
            }
            return { separateWithBr: this.separateWithBr() };
        }

        async saveSettings() {
            try {
                await navi.storage.item.set(SETTINGS_KEY, {
                    separateWithBr: this.separateWithBr(),
                });
            } catch {
                /* best-effort */
            }
        }

        /**
         * Toggle / set <br> between stage-zone members.
         * @param {'toggle'|'on'|'off'|boolean|null} [mode]
         * @returns {Promise<{ separateWithBr: boolean, msg: string }>}
         */
        async setSeparateWithBr(mode = "toggle") {
            if (!isBrowser) throw new Error("browser required");
            let want;
            const m = String(mode ?? "toggle").toLowerCase();
            if (m === "on" || m === "true" || m === "1" || mode === true) {
                want = true;
            } else if (
                m === "off" ||
                m === "false" ||
                m === "0" ||
                mode === false
            ) {
                want = false;
            } else {
                want = !this.separateWithBr();
            }
            this._separateWithBr = want;
            this.syncAllMemberSeparators();
            await this.saveSettings();
            return {
                separateWithBr: want,
                msg: want
                    ? "Stage zone members separated by <br>"
                    : "Stage zone member <br> separators off",
            };
        }

        _clonePresentation(value) {
            if (!value || typeof value !== "object") return null;
            try {
                return JSON.parse(JSON.stringify(value));
            } catch {
                return null;
            }
        }

        rememberPresentation(el, presentation) {
            let copy = this._clonePresentation(presentation);
            if (el && copy) {
                const existing = partName(el.getAttribute?.("data-part"));
                const pathAttr = normalizeOccupantPath(
                    el.getAttribute?.("data-path")
                );
                // href is a fetch verb, not a DOM part: after punch, remember as
                // htmf + data-path (route). Never keep type "href" on the element.
                if (isExclusivePart(copy.type, "href")) {
                    const route =
                        pathAttr ||
                        normalizeOccupantPath(copy.path) ||
                        normalizeOccupantPath(copy.value || copy.href);
                    copy = {
                        type: "htmf",
                        value: el.outerHTML,
                        ...(route ? { path: route } : {}),
                    };
                } else {
                    // DOM stamp wins when already present (don't overwrite / re-type).
                    if (existing) copy.type = existing;
                    if (pathAttr) copy.path = pathAttr;
                }
                this._presentationByElement.set(el, copy);
                this.stampOccupantMeta(el, copy.type || null, copy.path || null);
            }
            return copy;
        }

        /** DOM hint for jockey / inspectors; WeakMap presentation stays authoritative. */
        stampOccupantType(el, type) {
            if (!el || el.nodeType !== 1) return;
            if (el.hasAttribute("data-part")) return;
            let t = partName(type);
            // Never stamp data-part="href" — href is fetch-only; DOM part is htmf.
            if (t === "href") t = "htmf";
            // Never stamp data-part="text" — text is the text node inside; the wrap
            // is just a span (presentation.type remains "text").
            if (t === "text") return;
            if (t) el.setAttribute("data-part", t);
        }

        stampOccupantMeta(el, type, path, contentHash = null) {
            if (!el || el.nodeType !== 1) return;
            this.stampOccupantType(el, type);
            const p = normalizeOccupantPath(path);
            if (p) el.setAttribute("data-path", p);
            // Install hash only — never overwrite (live DOM may mutate later).
            stampDataHash(el, contentHash);
        }

        occupantTypeOf(el, presentation = null) {
            const fromPres = presentation?.type != null ? partName(presentation.type) : "";
            if (fromPres) return fromPres;
            if (el && el.nodeType === 1) {
                const attr = el.getAttribute("data-part");
                if (attr) return partName(attr);
            }
            return "";
        }

        slot(key) {
            return parseSlot(key);
        }

        /** Live occupant columns, including marched CS/R paths. */
        slotColumns() {
            if (!isBrowser) return [];
            return Array.from(document.querySelectorAll("[data-stage-slot]"));
        }

        zoneSlotOf(el) {
            if (!(el instanceof HTMLElement)) return null;
            const stamped = parseSlot(el.getAttribute("data-stage-slot"));
            if (stamped) return stamped;
            return parseSlot(el.id);
        }

        bandFor(slotKey) {
            const key = parseSlot(slotKey);
            if (!key || key.includes("/")) return null;
            return BAND_LAYOUT.find(
                (b) => b.left === key || b.center === key || b.right === key
            );
        }

        column(slotKey) {
            if (!isBrowser) return null;
            const key = parseSlot(slotKey);
            if (!key) return null;
            const byId = document.getElementById(key);
            if (byId && this.zoneSlotOf(byId) === key) return byId;
            try {
                return document.querySelector(`[data-stage-slot="${key}"]`);
            } catch {
                return null;
            }
        }

        /** Live horizon/v1 or jockeystage/v1 root, if present. */
        findRoot() {
            if (!isBrowser) return null;
            return document.querySelector(STAGE_ROOT_SEL);
        }

        /**
         * true when axes are flipped (root row, bands column) — visual 3×3 transpose.
         * Default stage is root column + bands row.
         */
        isFlipped() {
            const root = this.findRoot();
            if (!root) return false;
            const dir = String(
                root.style?.flexDirection ||
                    getComputedStyle(root).flexDirection ||
                    ""
            ).toLowerCase();
            return dir === "row";
        }

        /** US z=3 (front), S z=2, DS z=1 (back). Safe on live SSR stages. */
        applyBandDepth() {
            if (!isBrowser) return;
            const flipped = this.isFlipped();
            for (const band of BAND_LAYOUT) {
                const el = document.getElementById(band.id);
                if (el) el.setAttribute("style", bandStyle(band.id, flipped));
            }
        }

        /**
         * Toggle / set flex axes.
         * @param {'toggle'|'on'|'off'|boolean|null} [mode]
         * @returns {{ flipped: boolean, msg: string }}
         */
        flipAxes(mode = "toggle") {
            if (!isBrowser) throw new Error("browser required");
            const root = this.findRoot();
            if (!root) throw new Error("no horizon/v1 or jockeystage/v1 on page");

            let want;
            const m = String(mode ?? "toggle").toLowerCase();
            if (m === "on" || m === "true" || m === "1" || mode === true) {
                want = true;
            } else if (
                m === "off" ||
                m === "false" ||
                m === "0" ||
                mode === false
            ) {
                want = false;
            } else {
                want = !this.isFlipped();
            }

            root.setAttribute("style", want ? ROOT_STYLE_FLIPPED : ROOT_STYLE);
            for (const band of BAND_LAYOUT) {
                const el = document.getElementById(band.id);
                if (el) {
                    el.setAttribute("style", bandStyle(band.id, want));
                }
            }
            this.applyNestLayout(want);
            return {
                flipped: want,
                msg: want
                    ? "Flipped: bands as columns, slots as rows (flex transpose)"
                    : "Default: bands as rows, slots as columns",
            };
        }

        applyNestLayout(flipped = this.isFlipped()) {
            if (!isBrowser) return;
            for (const nest of document.querySelectorAll("[data-stage-nest]")) {
                nest.setAttribute("style", nestStyle(flipped));
            }
            for (const band of document.querySelectorAll("[data-stage-nest-band]")) {
                const row = band.getAttribute("data-stage-row") || "S";
                band.setAttribute("style", bandStyle(row, flipped));
            }
        }

        stampColumn(col, slotKey) {
            const key = parseSlot(slotKey);
            col.id = key;
            col.setAttribute("data-stage-slot", key);
            col.setAttribute("name", slotLabel(key));
            col.setAttribute("style", COL_STYLE);
            return col;
        }

        makeColumn(slotKey) {
            return this.stampColumn(document.createElement("div"), slotKey);
        }

        nestOf(parentKey) {
            if (!isBrowser) return null;
            const key = parseSlot(parentKey);
            if (!key) return null;
            try {
                return document.querySelector(`[data-stage-nest="${key}"]`);
            } catch {
                return null;
            }
        }

        /**
         * Wrap an existing occupant column in a mini-stage so marched
         * neighbours can hang off it. The column keeps its id; the wrapper
         * is layout-only and is not serialized.
         */
        ensureNest(parentCol, parentKey) {
            const key = parseSlot(parentKey);
            const existing = this.nestOf(key);
            if (existing) return existing;
            const flipped = this.isFlipped();
            const nest = document.createElement("div");
            nest.setAttribute("data-stage-nest", key);
            nest.setAttribute("style", nestStyle(flipped));
            const sBand = document.createElement("div");
            sBand.setAttribute("data-stage-nest-band", key);
            sBand.setAttribute("data-stage-row", "S");
            sBand.setAttribute("style", bandStyle("S", flipped));
            const host = parentCol.parentElement;
            if (!host) throw new Error(`column ${key} has no parent band`);
            host.insertBefore(nest, parentCol);
            sBand.appendChild(parentCol);
            nest.appendChild(sBand);
            return nest;
        }

        ensureNestBand(nest, parentKey, row) {
            const key = parseSlot(parentKey);
            const want = ROW_ORDER.includes(row) ? row : "S";
            for (const kid of Array.from(nest.children)) {
                if (
                    kid.getAttribute?.("data-stage-nest-band") === key &&
                    kid.getAttribute?.("data-stage-row") === want
                ) {
                    return kid;
                }
            }
            const band = document.createElement("div");
            band.setAttribute("data-stage-nest-band", key);
            band.setAttribute("data-stage-row", want);
            band.setAttribute("style", bandStyle(want, this.isFlipped()));
            const order = ROW_ORDER.indexOf(want);
            for (const kid of Array.from(nest.children)) {
                const r = kid.getAttribute?.("data-stage-row");
                if (ROW_ORDER.indexOf(r) > order) {
                    nest.insertBefore(band, kid);
                    return band;
                }
            }
            nest.appendChild(band);
            return band;
        }

        insertColumnInBand(band, col, slotKey) {
            const key = parseSlot(slotKey);
            const st = lastStepOf(key);
            const parent = parentSlot(key);
            let order;
            if (st) {
                const row = STEP_INFO[st].row;
                order = COL_ORDER.map((c) => {
                    if (c === "C" && row === "S") return parent;
                    const hit = Object.entries(STEP_INFO).find(
                        ([, info]) => info.row === row && info.col === c
                    );
                    return hit ? `${parent}/${hit[0]}` : null;
                }).filter(Boolean);
            } else {
                const layout = this.bandFor(key);
                order = layout ? [layout.left, layout.center, layout.right] : [key];
            }
            const pos = order.indexOf(key);
            for (let k = pos + 1; k < order.length; k++) {
                const after = this.column(order[k]);
                if (after && after.parentElement === band) {
                    band.insertBefore(col, after);
                    return col;
                }
            }
            band.appendChild(col);
            return col;
        }

        // Ensure a column div exists to receive an element, without repainting the
        // rest of the stage. Base bands are always present; marched cells wrap
        // their parent in a mini-stage and only create occupied neighbours.
        ensureColumn(slotKey) {
            const key = parseSlot(slotKey);
            if (!key) throw new Error(`unknown slot '${slotKey}'`);
            let col = this.column(key);
            if (col) {
                if (!col.hasAttribute("data-stage-slot")) this.stampColumn(col, key);
                return col;
            }

            const parent = parentSlot(key);
            if (!parent) {
                const layout = this.bandFor(key);
                const band = document.getElementById(layout.id);
                if (!band) throw new Error(`band ${layout.id} is not on the page`);
                band.setAttribute("style", bandStyle(layout.id, this.isFlipped()));
                col = this.makeColumn(key);
                return this.insertColumnInBand(band, col, key);
            }

            const parentCol = this.ensureColumn(parent);
            const nest = this.ensureNest(parentCol, parent);
            const st = lastStepOf(key);
            const band = this.ensureNestBand(nest, parent, STEP_INFO[st].row);
            col = this.makeColumn(key);
            return this.insertColumnInBand(band, col, key);
        }

        /**
         * Clone `from` one step (or n steps) as an empty pseudo-zone. The
         * destination is a spacer column until something is placed in it.
         */
        march(fromKey, step, n = 1) {
            const start = parseSlot(fromKey);
            const st = normalizeStep(step);
            if (!start) throw new Error(`unknown slot '${fromKey}'`);
            if (!st) throw new Error(`unknown march step '${step}' (use U D L R UL UR DL DR)`);
            const count = Math.max(1, Number(n) || 1);
            this.ensureColumn(start);
            let cur = start;
            for (let i = 0; i < count; i++) {
                cur = `${cur}/${st}`;
                this.ensureColumn(cur);
            }
            return cur;
        }

        /** Drop empty marched columns and unwrap a nest that has no neighbours. */
        pruneMarch(slotKey) {
            const key = parseSlot(slotKey);
            if (!key) return;
            const col = this.column(key);
            if (col) {
                if (this.memberChildren(col).length > 0) return;
                const nestKids = this.nestOf(key)
                    ? Array.from(
                          document.querySelectorAll(`[data-stage-slot^="${key}/"]`)
                      )
                    : [];
                if (nestKids.some((c) => this.memberChildren(c).length > 0)) return;
                if (parentSlot(key)) {
                    col.remove();
                }
            }
            const parent = parentSlot(key);
            if (parent) this.unwrapIfLonely(parent);
        }

        unwrapIfLonely(parentKey) {
            const key = parseSlot(parentKey);
            const nest = this.nestOf(key);
            if (!nest) return;
            const marched = Array.from(
                nest.querySelectorAll("[data-stage-slot]")
            ).filter((el) => parseSlot(el.getAttribute("data-stage-slot")) !== key);
            if (marched.some((c) => this.memberChildren(c).length > 0)) return;
            for (const extra of marched) extra.remove();
            const parentCol = this.column(key);
            const host = nest.parentElement;
            if (parentCol && host) host.insertBefore(parentCol, nest);
            nest.remove();
            if (parentSlot(key)) this.unwrapIfLonely(parentSlot(key));
        }

        // The "spacer trick": place an empty margin:auto column so the band's flex
        // row keeps that position occupied (matches horizon_v1.js spacerCell). Only
        // creates the div when the slot is missing; refuses to touch a filled column.
        addSpacer(slotKey) {
            const col = this.column(slotKey);
            if (col && this.memberChildren(col).length > 0) return false;
            this.ensureColumn(slotKey);
            return true;
        }

        // Remove an empty spacer column (only if it holds nothing).
        removeSpacer(slotKey) {
            const col = this.column(slotKey);
            if (!col || this.memberChildren(col).length > 0) return false;
            this.stripMemberSeparators(col);
            col.remove();
            return true;
        }

        // Map a logical (inside-out) index to a DOM child index for a column.
        // Left columns render reversed, so logical i sits at DOM (count-1-i).
        domIndex(slotKey, logicalIndex, count) {
            return isLeftSlot(slotKey) ? count - 1 - logicalIndex : logicalIndex;
        }

        itemAt(slotKey, index) {
            const col = this.column(slotKey);
            if (!col) return null;
            const members = this.memberChildren(col);
            const di = this.domIndex(slotKey, index, members.length);
            return members[di] || null;
        }

        presentationFor(el) {
            if (!el) return null;
            const known = this._presentationByElement.get(el);
            return known ? this._clonePresentation(known) : null;
        }

        /** Stage direction for one member: where it sits and what it is. */
        describeMember(slotKey, index) {
            const slot = this.slot(slotKey);
            const el = slot ? this.itemAt(slot, index) : null;
            if (!el) return null;
            const pres = this.presentationFor(el);
            return {
                el,
                slot,
                at: Number(index),
                label: slotLabel(slot),
                type: this.occupantTypeOf(el, pres) || "htmf",
                path: normalizeOccupantPath(el.getAttribute("data-path") || pres?.path || ""),
            };
        }

        /**
         * Add a hostparked member from `route`: HTML from the route, column /
         * position / type from its tip frame's data.stage_dir. slotOverride and
         * atOverride win; without either a stage_dir or a slot, refuse.
         */
        async placeFromPath(route, slotOverride = null, atOverride = null) {
            let base = "";
            let path = String(route || "").trim();
            const abs = path.match(/^(https?:\/\/[^/]+)\/?(.*)$/i);
            if (abs) {
                base = abs[1];
                path = abs[2];
            }
            path = slashfoldPath(path).replace(/^\/+/, "");
            if (!path) throw new Error("missing path");

            let dir = null;
            if (!base) {
                const local = await navi.storage?.tip?.get?.(path).catch(() => null);
                const sd = local?.data?.stage_dir;
                if (sd && typeof sd === "object") dir = sd;
            }
            if (!dir) {
                try {
                    const tipRes = await fetch(`${base}/foobarch/tip/${path}`);
                    if (tipRes.ok) {
                        const tip = await tipRes.json();
                        const sd = tip?.frame?.data?.stage_dir;
                        if (sd && typeof sd === "object") dir = sd;
                    }
                } catch {
                    /* no tip API on this host: fall back to overrides */
                }
            }
            const slot = this.slot(slotOverride) || this.slot(dir?.slot);
            if (!slot) {
                throw new Error(`${path} has no stage direction — give a slot: stagedir place ${path} <SLOT> [n]`);
            }
            const atRaw = atOverride != null ? atOverride : slotOverride ? null : dir?.at;
            const at = atRaw == null || Number.isNaN(Number(atRaw)) ? null : Number(atRaw);

            const res = await fetch(`${base}/${path}`);
            if (!res.ok) throw new Error(`fetch ${base}/${path} -> ${res.status}`);
            const html = await res.text();
            const type = partName(dir?.type) || "htmf";
            this.addData(slot, html, at, { type, path, value: html });
            return { slot, at, label: slotLabel(slot), path, fromFrame: !!dir };
        }

        async presentationAt(slotKey, index, el = null) {
            const item = el || this.itemAt(slotKey, index);
            if (!item) return null;

            const known = this.presentationFor(item);
            if (known) return known;

            // Hydrate an SSR/live stage from preset 0 when it still retains the
            // authored href/data abstracts.
            const live = await this.getPreset(0);
            const candidate = this.normalize(live)?.[slotKey]?.[index];
            if (candidate && typeof candidate === "object") {
                return this.rememberPresentation(item, candidate);
            }

            const fallback = { value: item.outerHTML };
            const stamped = item.getAttribute?.("data-part");
            if (stamped) fallback.type = partName(stamped);
            this.rememberPresentation(item, fallback);
            return fallback;
        }

        // Insert el at a logical index within a column (inside-out for left columns).
        // No index => logical end (append to the manifest array = furthest out).
        // Member <br> separators are stripped for indexing, then rebuilt.
        // Live members move with moveBefore() where available so iframes/video keep
        // playing; insertBefore() (and removeChild) would reload them.
        insertLogical(col, el, slotKey, logicalIndex) {
            this.stripMemberSeparators(col);
            const others = Array.from(col.children).filter((c) => c !== el);
            const isLeft = isLeftSlot(slotKey);
            const count = others.length;
            let ref;
            if (logicalIndex == null || Number.isNaN(logicalIndex)) {
                ref = isLeft ? others[0] || null : null;
            } else {
                const k = Math.max(0, Math.min(logicalIndex, count));
                if (!isLeft) ref = others[k] || null;
                // Left: logical k lands just inside current logical k-1. Logical 0 is
                // the DOM-last (nearest center), so k=0 appends.
                else ref = k === 0 ? null : others[count - 1 - (k - 1)] || null;
            }
            placeNode(col, el, ref);
            this.syncMemberSeparators(col);
        }

        move(srcKey, index, destKey, destIndex) {
            const el = this.itemAt(srcKey, index);
            if (!el) throw new Error(`no item at ${srcKey}[${index}]`);
            const srcCol = el.parentElement;
            const destCol = this.ensureColumn(destKey);
            let k = destIndex;
            if (k == null || Number.isNaN(k)) {
                // From center → shove into dest[0]. Side↔side (incl. R→L) → outer end.
                k = isCenterSlot(srcKey) ? 0 : null;
            }
            this.insertLogical(destCol, el, destKey, k);
            if (srcCol && srcCol !== destCol) this.syncMemberSeparators(srcCol);
            return el;
        }

        removeAt(srcKey, index) {
            const el = this.itemAt(srcKey, index);
            if (!el) return null;
            const col = el.parentElement;
            el.remove();
            if (col) this.syncMemberSeparators(col);
            this.pruneMarch(srcKey);
            return el;
        }

        swap(aKey, i, bKey, j) {
            const a = this.itemAt(aKey, i);
            const b = this.itemAt(bKey, j);
            if (!a || !b) return false;
            const aCol = a.parentElement;
            const bCol = b.parentElement;
            const marker = document.createComment("stagedir-swap");
            a.parentElement.insertBefore(marker, a);
            b.parentElement.insertBefore(a, b);
            marker.parentElement.insertBefore(b, marker);
            marker.remove();
            if (aCol) this.syncMemberSeparators(aCol);
            if (bCol && bCol !== aCol) this.syncMemberSeparators(bCol);
            return true;
        }

        htmlToNodes(html) {
            const tpl = document.createElement("template");
            tpl.innerHTML = String(html).trim();
            return Array.from(tpl.content.childNodes).filter(
                (n) => n.nodeType === 1 || (n.nodeType === 3 && n.textContent.trim())
            );
        }

        // Make freshly inserted markup live: rebuild <script> tags so the browser
        // runs them, then let htmx bind hx-* attributes. Mirrors surf's post-swap step.
        // Also stamp data-hash on nested data-part roots that arrived without one
        // (e.g. enter htmf inside a surfed horizon/v1 shell).
        activate(el) {
            if (!isBrowser || !el || el.nodeType !== 1) return;
            const scripts =
                el.tagName === "SCRIPT"
                    ? [el]
                    : Array.from(el.querySelectorAll ? el.querySelectorAll("script") : []);
            for (const oldScript of scripts) {
                const script = document.createElement("script");
                for (const attr of oldScript.attributes) {
                    script.setAttribute(attr.name, attr.value);
                }
                script.textContent = oldScript.textContent;
                oldScript.replaceWith(script);
            }
            try {
                const parts = el.querySelectorAll
                    ? el.querySelectorAll("[data-part]")
                    : [];
                for (const node of parts) {
                    if (node instanceof HTMLElement && !node.hasAttribute("data-hash")) {
                        stampDataHash(node, hashContentSync(node.outerHTML));
                    }
                }
                if (
                    el.hasAttribute?.("data-part") &&
                    !el.hasAttribute("data-hash")
                ) {
                    stampDataHash(el, hashContentSync(el.outerHTML));
                }
            } catch {
                /* ignore */
            }
            const htmxApi = globalThis.htmx;
            if (el.tagName !== "SCRIPT" && htmxApi && typeof htmxApi.process === "function") {
                try {
                    htmxApi.process(el);
                } catch (error) {
                    console.error("[horizon_stagedir] htmx.process failed:", error);
                }
            }
        }

        /**
         * Ensure a node is an Element column child. Plain strings parse as text
         * nodes; Element.columns / serialize / stagejockey only see elements.
         */
        wrapOccupantNode(node, fallbackText = "", type = null) {
            if (node && node.nodeType === 1) {
                // Already stamped — trust it; don't re-type from the presentation.
                if (node.hasAttribute("data-part")) {
                    return node;
                }
                this.stampOccupantType(node, type);
                return node;
            }
            const wrap = document.createElement("span");
            if (node && node.nodeType === 3) {
                wrap.textContent = node.textContent || "";
            } else {
                wrap.textContent = String(fallbackText ?? "");
            }
            this.stampOccupantType(wrap, type);
            return wrap;
        }

        /**
         * True when `value` rehydrates as exactly one Element (safe column child).
         */
        presentationRehydratesElement(presentation) {
            if (!presentation || isExclusivePart(presentation.type, "href")) return true;
            if (isExclusivePart(presentation.type, "text")) return true;
            const nodes = this.htmlToNodes(String(presentation.value ?? ""));
            return nodes.length === 1 && nodes[0].nodeType === 1;
        }

        addData(slotKey, html, logicalIndex = null, presentation = null) {
            const col = this.ensureColumn(slotKey);
            const raw = html == null ? "" : String(html);
            const contentHash = hashContentSync(raw);
            let stored = this._clonePresentation(presentation) || {
                value: raw,
            };
            const occType = partName(stored.type);
            const occPath = normalizeOccupantPath(stored.path);
            if (occType) stored = { ...stored, type: occType };
            else {
                const { type: _drop, ...rest } = stored;
                stored = rest;
                stored.value = stored.value ?? raw;
            }
            if (occPath) stored.path = occPath;

            let nodes;
            if (isExclusivePart(occType, "text")) {
                const wrap = document.createElement("span");
                wrap.textContent = raw;
                nodes = [wrap];
                stored = { ...stored, type: "text", value: raw };
            } else {
                // href is via addHref; everything else (html, data, custom, untyped) punches.
                nodes = this.htmlToNodes(raw);
                const onlyText =
                    nodes.length > 0 && nodes.every((n) => n.nodeType === 3);
                if (onlyText || (nodes.length === 0 && raw.length > 0)) {
                    const wrap = document.createElement("span");
                    wrap.textContent = raw;
                    nodes = [wrap];
                    if (!this.presentationRehydratesElement(stored)) {
                        stored = {
                            ...stored,
                            ...(occType ? { type: occType } : {}),
                            value: wrap.outerHTML,
                        };
                    }
                } else {
                    nodes = nodes.map((n) => this.wrapOccupantNode(n, raw, occType || null));
                    if (
                        !isExclusivePart(occType, "text") &&
                        !isExclusivePart(occType, "href") &&
                        !this.presentationRehydratesElement(stored) &&
                        nodes.length === 1
                    ) {
                        stored = {
                            ...stored,
                            ...(occType ? { type: occType } : {}),
                            value: nodes[0].outerHTML,
                        };
                    }
                }
            }

            if (nodes.length === 0) throw new Error("nothing to add");

            // Default null = logical end (outermost). Pass k to insert at index k.
            const added = [];
            for (const el of nodes) {
                if (el.nodeType === 1) {
                    const stampType = occType || stored.type;
                    // href fetch: path lives on presentation.path (or legacy value).
                    const stampPath =
                        occPath ||
                        (isExclusivePart(occType, "href")
                            ? normalizeOccupantPath(stored.path || stored.value)
                            : "");
                    this.stampOccupantMeta(el, stampType, stampPath, contentHash);
                }
                this.insertLogical(col, el, slotKey, logicalIndex);
                this.rememberPresentation(el, stored);
                added.push(el);
            }
            added.forEach((n) => this.activate(n));
            return added.length;
        }

        async addHref(slotKey, route, logicalIndex = null) {
            const path = slashfoldPath(route).replace(/^\/+/, "");
            if (!path) throw new Error("missing route");
            const res = await fetch(`/${path}`);
            if (!res.ok) throw new Error(`fetch /${path} -> ${res.status}`);
            const html = await res.text();
            // Fetch verb stays `href` on the CLI; DOM stamps htmf + data-path.
            return this.addData(slotKey, html, logicalIndex, {
                type: "htmf",
                path,
                value: html,
            });
        }

        clear(slotKey) {
            if (slotKey) {
                const col = this.column(slotKey);
                if (col) col.replaceChildren();
                this.pruneMarch(slotKey);
                return;
            }
            for (const col of this.slotColumns()) {
                col.replaceChildren();
            }
            for (const col of this.slotColumns()) {
                const k = this.zoneSlotOf(col);
                if (k && parentSlot(k)) this.pruneMarch(k);
            }
        }

        // Serialize the LIVE stage into a stage_dir manifest (slot occupants).
        // Left columns are reversed back to logical (inside-out) order so the stored
        // document matches horizon_v1.js's convention. Stamped member <br> separators
        // are skipped — they are layout-only, not occupants.
        serialize() {
            const m = { parts: [...STAGE_DIR_PARTS] };
            if (!isBrowser) return m;
            for (const col of this.slotColumns()) {
                const slotKey = this.zoneSlotOf(col);
                if (!slotKey) continue;
                const kids = this.memberChildren(col);
                if (kids.length === 0) continue;
                const occ = kids.map((k) => {
                    const presentation = this._presentationByElement.get(k);
                    // data-stage-live members save their current markup, not the adopt-time copy.
                    if (
                        presentation &&
                        (k.hasAttribute?.("data-stage-live") || k.querySelector?.("[data-stage-live]"))
                    ) {
                        return { ...this._clonePresentation(presentation), value: k.outerHTML };
                    }
                    return this._clonePresentation(presentation) || (() => {
                        const o = { value: k.outerHTML };
                        const stamped = partName(k.getAttribute?.("data-part"));
                        if (stamped) o.type = stamped;
                        return o;
                    })();
                });
                if (isLeftSlot(slotKey)) occ.reverse();
                m[slotKey] = occ;
            }
            return m;
        }

        async loadIndex() {
            const raw = await navi.storage.item.get(INDEX_KEY);
            return Array.isArray(raw) ? raw : [];
        }

        async saveIndex(index) {
            await navi.storage.item.set(INDEX_KEY, index);
        }

        async liveSnapshot() {
            return this.normalize(this.serialize());
        }

        async installManifestContent(content, source) {
            let parsed;
            try {
                parsed = JSON.parse(content);
            } catch (error) {
                throw new Error(
                    `stage_dir manifest at ${source} is not JSON: ${error.message || error}`
                );
            }
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
                throw new Error(`stage_dir manifest at ${source} must be an object`);
            }
            if (!this.isStageDirDocument(parsed)) {
                throw new Error(
                    `document at ${source} is not a stage_dir manifest (need parts including stage_dir, or legacy slot keys)`
                );
            }

            // Occupants may carry optional fields (e.g. ibgib) beside type/value.
            const stored = this.normalize(parsed);
            const index = await this.loadIndex();
            if (index.length === 0) index.push(stored);
            else index[0] = stored;
            await this.saveIndex(index);
            await this.repaintFrom(stored);
            return stored;
        }

        async loadManifestFromPath(path) {
            const route = slashfoldPath(path);
            if (!route) throw new Error("stage_dir manifest path required");

            const surf = navi.mod?.surf;
            if (!surf || typeof surf.browse !== "function") {
                throw new Error("surf.browse is unavailable; mount surf first");
            }

            const content = await surf.browse(route, {
                headers: { Accept: "application/json, text/plain" }
            });
            // surf.browse returns an "Error fetching …" string instead of throwing.
            if (typeof content !== "string" || content.startsWith("Error fetching ")) {
                throw new Error(String(content || `browse failed for ${route}`));
            }
            return this.installManifestContent(content, route);
        }

        // Keep the live slot (0) in sync with the current DOM. Called after each
        // direction.
        async persist() {
            try {
                const index = await this.loadIndex();
                const live = this.normalize(this.serialize());
                if (index.length === 0) index.push(live);
                else index[0] = live;
                await this.saveIndex(index);
            } catch (error) {
                console.error("[horizon_stagedir] persist failed:", error);
            }
        }

        async listPresets() {
            const index = await this.loadIndex();
            return index.map((m, i) => ({
                index: i,
                live: i === 0,
                slots: Object.keys(this.normalize(m)).filter((k) => k !== "parts"),
            }));
        }

        async getPreset(n) {
            const index = await this.loadIndex();
            return index[n] != null ? JSON.parse(JSON.stringify(index[n])) : null;
        }

        // Programmatic populate: set slot n to an arbitrary stage_dir manifest
        // (append if n === length).
        async setPreset(n, manifest) {
            const index = await this.loadIndex();
            if (index.length === 0) index.push(await this.liveSnapshot());
            const m = this.normalize(manifest);
            if (n === index.length) index.push(m);
            else if (n >= 0 && n < index.length) index[n] = m;
            else throw new Error(`preset index ${n} out of range (0..${index.length})`);
            await this.saveIndex(index);
            return n;
        }

        // Snapshot the current live stage into a brand-new slot; returns its index.
        async newPreset() {
            const index = await this.loadIndex();
            const live = await this.liveSnapshot();
            if (index.length === 0) index.push(live);
            index.push(live);
            await this.saveIndex(index);
            return index.length - 1;
        }

        // Snapshot the current live stage into slot n (append if n === length).
        async savePreset(n) {
            const index = await this.loadIndex();
            const live = await this.liveSnapshot();
            if (index.length === 0) index.push(live);
            if (n < 0 || n > index.length) {
                throw new Error(`preset ${n} out of range (0..${index.length})`);
            }
            if (n === index.length) index.push(live);
            else index[n] = live;
            await this.saveIndex(index);
        }

        async delPreset(n) {
            const index = await this.loadIndex();
            if (n <= 0 || n >= index.length) return false;
            index.splice(n, 1);
            await this.saveIndex(index);
            return true;
        }

        // Activate a preset: slot 0 repaints as-is; slot n>0 is copied into 0 first,
        // so slot 0 is always "the live one".
        async activatePreset(n) {
            const index = await this.loadIndex();
            if (index.length === 0) {
                index.push(await this.liveSnapshot());
                await this.saveIndex(index);
            }
            if (n < 0 || n >= index.length || index[n] == null) {
                return { ok: false, msg: `no preset ${n} (have 0..${index.length - 1})` };
            }
            if (n !== 0) {
                index[0] = JSON.parse(JSON.stringify(index[n]));
                await this.saveIndex(index);
            }
            await this.repaintFrom(index[0]);
            return {
                ok: true,
                msg: n === 0 ? "Repainted from preset 0 (live)." : `Loaded preset ${n} into 0 and repainted.`,
            };
        }

        /**
         * True when doc is a stage_dir map: parts includes stage_dir, or legacy
         * slot keys with no parts / without a conflicting non-stage_dir parts list.
         */
        isStageDirDocument(raw) {
            if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
            const parts = Array.isArray(raw.parts) ? raw.parts.map(String) : null;
            if (parts && parts.includes("stage_dir")) return true;
            if (parts && parts.length && !parts.includes("stage_dir")) return false;
            return Object.keys(raw).some((k) => k !== "parts" && parseSlot(k));
        }

        /** Slot map + parts stamp. Reserved key `parts` is never treated as a slot. */
        normalize(raw) {
            const out = {};
            if (!raw || typeof raw !== "object") return out;
            if (!this.isStageDirDocument(raw)) return out;
            for (const [key, value] of Object.entries(raw)) {
                if (key === "parts") continue;
                const slot = parseSlot(key);
                if (!slot || value == null) continue;
                if (Array.isArray(value)) {
                    if (value.length > 0) out[slot] = value;
                } else if (typeof value === "object") {
                    out[slot] = [value];
                }
            }
            out.parts = [...STAGE_DIR_PARTS];
            return out;
        }

        async resolveOccupant(occ) {
            if (!occ || typeof occ !== "object") return "";
            const type = partName(occ.type);
            const path = normalizeOccupantPath(occ.path);
            if (isExclusivePart(type, "text")) {
                const wrap = document.createElement("span");
                wrap.textContent = occ.value != null ? String(occ.value) : "";
                this.stampOccupantMeta(
                    wrap,
                    "text",
                    path,
                    hashContentSync(wrap.textContent)
                );
                return wrap.outerHTML;
            }
            if (isExclusivePart(type, "href")) {
                const route = String(occ.value ?? occ.href ?? occ.path ?? "")
                    .replace(/^\/+/, "");
                if (!route) return "";
                try {
                    const res = await fetch(`/${route}`);
                    if (!res.ok) return "";
                    const html = await res.text();
                    const contentHash = hashContentSync(html);
                    const nodes = this.htmlToNodes(html);
                    if (!nodes.length) return "";
                    const stamped = nodes.map((n) => {
                        const el = this.wrapOccupantNode(n, html, "htmf");
                        if (el.nodeType === 1) {
                            this.stampOccupantMeta(el, "htmf", route, contentHash);
                        }
                        return el;
                    });
                    return stamped
                        .map((n) =>
                            n.nodeType === 1
                                ? n.outerHTML
                                : n.textContent || ""
                        )
                        .join("");
                } catch {
                    return "";
                }
            }
            const markup = occ.value != null ? String(occ.value) : "";
            if (!path && !type) return markup;
            const nodes = this.htmlToNodes(markup);
            if (nodes.length === 1 && nodes[0].nodeType === 1) {
                this.stampOccupantMeta(
                    nodes[0],
                    type,
                    path,
                    hashContentSync(markup)
                );
                return nodes[0].outerHTML;
            }
            return markup;
        }

        columnCell(slotKey, innerHtml) {
            const key = parseSlot(slotKey) || slotKey;
            const label = slotLabel(key);
            return `<div id="${esc(key)}" data-stage-slot="${esc(key)}" name="${esc(label)}" style="${COL_STYLE}">${innerHtml}</div>`;
        }

        nestWrapHtml(parentKey, bandsHtml) {
            return `<div data-stage-nest="${esc(parentKey)}" style="${nestStyle(false)}">${bandsHtml}</div>`;
        }

        nestBandHtml(parentKey, row, cellsHtml) {
            return `<div data-stage-nest-band="${esc(parentKey)}" data-stage-row="${esc(row)}" style="${bandStyle(row, false)}">${cellsHtml}</div>`;
        }

        /**
         * Occupied keys plus ancestors needed so a marched cell can hang off
         * its parent. Unused neighbour steps are omitted.
         */
        structuralSlots(innerBySlot) {
            const occupied = Object.keys(innerBySlot);
            const set = new Set(occupied);
            for (const k of occupied) {
                let p = parentSlot(k);
                while (p) {
                    set.add(p);
                    p = parentSlot(p);
                }
            }
            return set;
        }

        renderSlotCell(slotKey, innerBySlot, structural) {
            const kids = [...structural].filter((k) => parentSlot(k) === slotKey);
            const memberHtml = innerBySlot[slotKey] || "";
            if (kids.length === 0) return this.columnCell(slotKey, memberHtml);

            const bands = [];
            for (const row of ROW_ORDER) {
                const rowKids = kids.filter((k) => STEP_INFO[lastStepOf(k)].row === row);
                if (!rowKids.length && row !== "S") continue;
                const byCol = { L: null, C: null, R: null };
                for (const k of rowKids) {
                    byCol[STEP_INFO[lastStepOf(k)].col] = k;
                }
                const cells = [];
                if (byCol.L) cells.push(this.renderSlotCell(byCol.L, innerBySlot, structural));
                if (row === "S") {
                    cells.push(this.columnCell(slotKey, memberHtml));
                } else if (byCol.C) {
                    cells.push(this.renderSlotCell(byCol.C, innerBySlot, structural));
                }
                if (byCol.R) cells.push(this.renderSlotCell(byCol.R, innerBySlot, structural));
                if (cells.length) {
                    bands.push(this.nestBandHtml(slotKey, row, cells.join("")));
                }
            }
            return this.nestWrapHtml(slotKey, bands.join(""));
        }

        buildBand(layout, innerBySlot) {
            const hasL = innerBySlot[layout.left] != null;
            const hasC = innerBySlot[layout.center] != null;
            const hasR = innerBySlot[layout.right] != null;
            const attrs = ` id="${layout.id}" name="${esc(layout.name)}"`;
            const style = bandStyle(layout.id, false);

            if (!hasL && !hasC && !hasR) {
                return `<div${attrs} style="${style}"></div>`;
            }

            let cells;
            if (hasL && hasR && !hasC) {
                cells = [
                    this.columnCell(layout.left, innerBySlot[layout.left]),
                    this.columnCell(layout.right, innerBySlot[layout.right]),
                ];
            } else {
                cells = [
                    this.columnCell(layout.left, hasL ? innerBySlot[layout.left] : ""),
                    this.columnCell(layout.center, hasC ? innerBySlot[layout.center] : ""),
                    this.columnCell(layout.right, hasR ? innerBySlot[layout.right] : ""),
                ];
            }
            return `<div${attrs} style="${style}">${cells.join("")}</div>`;
        }

        async buildInner(manifest) {
            const slots = this.normalize(manifest);
            const innerBySlot = {};
            for (const slotKey of Object.keys(slots)) {
                if (slotKey === "parts") continue;
                const occ = slots[slotKey];
                if (!occ || occ.length === 0) continue;
                const htmls = await Promise.all(occ.map((o) => this.resolveOccupant(o)));
                // Left columns render inside-out: reverse logical order to DOM order.
                const ordered = isLeftSlot(slotKey) ? htmls.slice().reverse() : htmls;
                const sep = this.separateWithBr() ? MEMBER_SEP_HTML : "";
                innerBySlot[slotKey] = ordered.join(sep);
            }
            const structural = this.structuralSlots(innerBySlot);
            const bandInner = {};
            for (const slotKey of SLOTS) {
                if (!structural.has(slotKey) && innerBySlot[slotKey] == null) continue;
                bandInner[slotKey] = this.renderSlotCell(slotKey, innerBySlot, structural);
            }
            // buildBand wraps columns again — pass already-rendered cells as
            // inner HTML of the base column shell. For nested bases, the cell
            // is the nest wrapper, not occupant HTML, so skip the extra shell.
            return BAND_LAYOUT.map((layout) => {
                const inner = {};
                for (const k of [layout.left, layout.center, layout.right]) {
                    if (bandInner[k] == null) continue;
                    inner[k] = bandInner[k];
                }
                return this.buildBandFromCells(layout, inner);
            }).join("");
        }

        /** Like buildBand, but values are already full cell/nest markup. */
        buildBandFromCells(layout, cellBySlot) {
            const hasL = cellBySlot[layout.left] != null;
            const hasC = cellBySlot[layout.center] != null;
            const hasR = cellBySlot[layout.right] != null;
            const attrs = ` id="${layout.id}" name="${esc(layout.name)}"`;
            const style = bandStyle(layout.id, false);
            if (!hasL && !hasC && !hasR) {
                return `<div${attrs} style="${style}"></div>`;
            }
            let cells;
            if (hasL && hasR && !hasC) {
                cells = [cellBySlot[layout.left], cellBySlot[layout.right]];
            } else {
                cells = [
                    hasL ? cellBySlot[layout.left] : this.columnCell(layout.left, ""),
                    hasC ? cellBySlot[layout.center] : this.columnCell(layout.center, ""),
                    hasR ? cellBySlot[layout.right] : this.columnCell(layout.right, ""),
                ];
            }
            return `<div${attrs} style="${style}">${cells.join("")}</div>`;
        }

        bindPresentations(manifest) {
            const slots = this.normalize(manifest);
            for (const slotKey of Object.keys(slots)) {
                if (slotKey === "parts") continue;
                const occupants = slots[slotKey] || [];
                occupants.forEach((presentation, index) => {
                    const el = this.itemAt(slotKey, index);
                    if (el) this.rememberPresentation(el, presentation);
                });
            }
        }

        async hydratePresentations() {
            const live = await this.getPreset(0);
            if (live) this.bindPresentations(live);
        }

        getOrCreateRoot() {
            let root = this.findRoot();
            if (!root) {
                root = document.createElement("div");
                root.setAttribute("name", "horizon/v1");
                root.setAttribute("style", ROOT_STYLE);
                document.body.appendChild(root);
                createdElements.push(root);
            }
            this.applyBandDepth();
            this.applyNestLayout();
            this.stampExistingColumns();
            return root;
        }

        /** SSR/Horizon columns have ids but no data-stage-slot until we mark them. */
        stampExistingColumns() {
            if (!isBrowser) return;
            for (const id of SLOTS) {
                const col = document.getElementById(id);
                if (col && !col.hasAttribute("data-stage-slot")) this.stampColumn(col, id);
            }
        }

        // Full repaint of the stage from a stage_dir manifest (saved preset).
        async repaintFrom(manifest) {
            if (!isBrowser) return "";
            const root = this.getOrCreateRoot();
            root.innerHTML = await this.buildInner(manifest);
            this.bindPresentations(manifest);
            this.activate(root);
            this.applyNestLayout();
            return root.innerHTML;
        }

        listSlot(slotKey) {
            const col = this.column(slotKey);
            let kids = col ? this.memberChildren(col) : [];
            if (kids.length === 0) return `${slotKey} (${slotLabel(slotKey)}) is empty`;
            // Show logical (inside-out) order so [i] matches the command index.
            if (isLeftSlot(slotKey)) kids = kids.slice().reverse();
            const lines = kids.map((k, i) => {
                const html = k.outerHTML;
                const preview = html.length > 60 ? html.slice(0, 57) + "..." : html;
                return `  [${i}] ${preview}`;
            });
            return `${slotKey} (${SLOT_LABELS[slotKey]}):\n${lines.join("\n")}`;
        }
    }

    const stage = new HorizonStage();

    // Any stage member may fire a bubbling "stage-dirty" when its own state changes
    // (paired with data-stage-live); the live slot is re-saved, debounced.
    if (isBrowser) {
        let dirtyTimer = null;
        const onStageDirty = (e) => {
            const t = e.target;
            if (!(t instanceof Element) || !t.closest('[data-part~="stage"]')) return;
            clearTimeout(dirtyTimer);
            dirtyTimer = setTimeout(() => void stage.persist(), 400);
        };
        document.addEventListener("stage-dirty", onStageDirty, true);
        eventListeners.push({ element: document, event: "stage-dirty", handler: onStageDirty, capture: true });
    }

    const HELP = [
        "stagedir — direct the live Horizon stage (slots: USL USC USR SL CS SR DSL DSC DSR)",
        "  Marched cells: SLOT/STEP/STEP…  e.g. CS/R, CS/R/U  steps: U D L R UL UR DL DR",
        "  Each step treats the current cell as Center Stage of its own 3×3; unused",
        "  neighbours are not stored. CS/R is not SR.",
        "",
        "  stagedir show                        Print the current stage as stage_dir manifest JSON",
        "  stagedir surf <path>                 browse stage_dir manifest JSON into preset 0 and repaint",
        "  stagedir march <SLOT> <STEP> [n]     Hang a pseudo-zone off SLOT (n times); empty until filled",
        "  stagedir <SLOT>                      List items in a slot",
        "  stagedir <SLOT> <n> move <DEST> [k]  Move item n to DEST (default: from center → [0], else outer end)",
        "  stagedir <SLOT> <n> remove           Remove item n",
        "  stagedir <SLOT> <n> swap <DEST> <m>  Swap two items",
        "  stagedir add <SLOT> [k] html <html>  Insert as html (raw markup + activate/htmx)",
        "  stagedir add <SLOT> [k] text <str>   Insert as escaped text occupant",
        "  stagedir add <SLOT> [k] href <route> Fetch route and insert (default: outermost; optional k)",
        "  stagedir add <SLOT> [k] <part> <v>   Any data-part name (punch unless text|href; text wraps as span w/o data-part)",
        "  stagedir publish <path> [--replace]  Hostpark the whole live stage as stage_dir JSON (netproposer,",
        "                                       1 token); anyone loads it with stagedir surf <path>",
        "  stagedir place <path> [SLOT] [n]     Add a hostparked member where its stage direction says",
        "                                       (tip data.stage_dir: slot / at / type); SLOT [n] override.",
        "                                       Path may be a full https://host/path URL.",
        "  stagedir clear [SLOT]                Empty one slot, or the whole stage",
        "  stagedir spacer <SLOT> [off]         Place (or 'off' to remove) an empty spacer column",
        "  stagedir flip [on|off]               Toggle flex axes (root↔bands row/column = visual transpose)",
        "  stagedir br [on|off]                 Separate each stage-zone member with <br> (layout only)",
        "  stagedir save                        Snapshot the live stage to preset 0 (live)",
        "  stagedir preset [N]                  Repaint from preset N (N>0 is copied into 0 first)",
        "  stagedir preset list                 List presets in the index (0 = live)",
        "  stagedir preset new                  Snapshot the live stage as a new preset slot",
        "  stagedir preset save <N>             Save the live stage into preset slot N",
        "  stagedir preset del <N>              Delete preset slot N (N>0)",
        "",
        "  Paths (href / surf): when navi.mod.surf.slashfold is present, whitespace",
        "  folds to / (keeps :). e.g. stagedir add CS href navi:hypertext welcome",
        "",
        "  n indexes inside-out: 0 = nearest center. Left columns (USL/SL/DSL)",
        "  count right-to-left; right columns (USR/SR/DSR) left-to-right.",
        "  move from USC/CS/DSC pushes into dest[0]; side↔side move appends outer (like add).",
        "  pass k to override. example: stagedir CS 0 move SR",
    ].join("\n");

    const runStagedir = async (...args) => {
        if (!args.length) return HELP;
        if (!isBrowser) return "stagedir needs the browser stage (DOM) to direct.";

        const first = args[0];
        const taken = takeSlot(args);

        // Form: <SLOT> <n> <verb> ...  (SLOT may be CS/R; callin splits on /)
        if (taken.slot) {
            if (taken.rest.length === 0) return stage.listSlot(taken.slot);

            const index = parseInt(taken.rest[0], 10);
            if (Number.isNaN(index)) return `Expected an item number after ${taken.slot}. ${stage.listSlot(taken.slot)}`;
            const verb = String(taken.rest[1] || "").toLowerCase();

            try {
                switch (verb) {
                    case "move": {
                        const destTaken = takeSlot(taken.rest.slice(2));
                        if (!destTaken.slot) return `Unknown destination slot '${taken.rest[2] || ""}'`;
                        const destIndex = destTaken.rest[0] != null ? parseInt(destTaken.rest[0], 10) : null;
                        stage.move(taken.slot, index, destTaken.slot, Number.isNaN(destIndex) ? null : destIndex);
                        await stage.persist();
                        return `Moved ${taken.slot}[${index}] -> ${destTaken.slot}`;
                    }
                    case "remove": {
                        if (!stage.removeAt(taken.slot, index)) return `no item at ${taken.slot}[${index}]`;
                        await stage.persist();
                        return `Removed ${taken.slot}[${index}]`;
                    }
                    case "swap": {
                        const destTaken = takeSlot(taken.rest.slice(2));
                        const destIndex = parseInt(destTaken.rest[0], 10);
                        if (!destTaken.slot || Number.isNaN(destIndex)) return "Usage: stagedir <SLOT> <n> swap <DEST> <m>";
                        if (!stage.swap(taken.slot, index, destTaken.slot, destIndex)) return "swap needs valid items on both sides";
                        await stage.persist();
                        return `Swapped ${taken.slot}[${index}] <-> ${destTaken.slot}[${destIndex}]`;
                    }
                    default:
                        return `Unknown verb '${taken.rest[1]}'. Try: move | remove | swap`;
                }
            } catch (error) {
                return `Error: ${error.message || error}`;
            }
        }

        try {
            switch (String(first).toLowerCase()) {
                case "show":
                case "list": {
                    const live = (await stage.getPreset(0)) || (await stage.liveSnapshot());
                    return JSON.stringify(live, null, 2);
                }

                case "surf":
                case "browse":
                case "load": {
                    const route = slashfoldPath(args.slice(1).join(" "));
                    if (!route) return "Usage: stagedir surf <path>";
                    const manifest = await stage.loadManifestFromPath(route);
                    return `Loaded ${route} into preset 0 (${Object.keys(manifest).join(" ") || "empty"}) and repainted.`;
                }

                case "march": {
                    const fromTaken = takeSlot(args.slice(1));
                    const stepTok = fromTaken.rest[0];
                    const nTok = fromTaken.rest[1];
                    if (!fromTaken.slot || !stepTok) {
                        return "Usage: stagedir march <SLOT> <STEP> [n]   STEP is U D L R UL UR DL DR";
                    }
                    const n = nTok != null && /^\d+$/.test(String(nTok)) ? parseInt(nTok, 10) : 1;
                    const dest = stage.march(fromTaken.slot, stepTok, n);
                    await stage.persist();
                    return `Marched ${fromTaken.slot} ${String(stepTok).toUpperCase()} × ${n} → ${dest} (${slotLabel(dest)})`;
                }

                case "add": {
                    const slotTaken = takeSlot(args.slice(1));
                    const slotKey = slotTaken.slot;
                    if (!slotKey) return `Unknown slot '${args[1]}'`;
                    let at = null;
                    let typeIdx = 0;
                    const maybeAt = parseInt(slotTaken.rest[0], 10);
                    if (
                        slotTaken.rest[0] != null &&
                        String(maybeAt) === String(slotTaken.rest[0]) &&
                        !Number.isNaN(maybeAt)
                    ) {
                        at = maybeAt;
                        typeIdx = 1;
                    }
                    const type = partName(slotTaken.rest[typeIdx]);
                    let value = slotTaken.rest.slice(typeIdx + 1).join(" ");
                    if (!slotTaken.rest[typeIdx]) return "Usage: stagedir add <SLOT> [k] <part> <value>";
                    if (!value) return `missing value for ${type || "?"}`;
                    // Path-like parts: slashfold when surf is present (href + surf path).
                    if (type === "href") {
                        value = slashfoldPath(value);
                        await stage.addHref(slotKey, value, at);
                    } else {
                        stage.addData(slotKey, value, at, { type, value });
                    }
                    await stage.persist();
                    if (type === "href") {
                        return at == null
                            ? `Added href ${value} to ${slotKey}`
                            : `Added href ${value} to ${slotKey}[${at}]`;
                    }
                    return at == null
                        ? `Added ${type} to ${slotKey} (outer end)`
                        : `Added ${type} to ${slotKey}[${at}]`;
                }

                case "publish": {
                    // Callin splits paths on / and whitespace; rejoin like surf does.
                    const flags = args.slice(1).filter((a) => String(a).startsWith("--"));
                    const route = slashfoldPath(args.slice(1).filter((a) => !String(a).startsWith("--")).join(" "));
                    if (!route) return "Usage: stagedir publish <path> [--replace]";
                    const np = navi.mod?.netproposer;
                    if (typeof np?.propose !== "function") return "stagedir publish needs netproposer — mount netproposer";
                    const manifest = await stage.liveSnapshot();
                    const r = await np.propose({
                        ib: slashfoldPath(route).replace(/^\/+/, ""),
                        body: JSON.stringify(manifest, null, 2),
                        contentType: "application/json",
                        replace: flags.includes("--replace"),
                    });
                    const host = String((await np.getHost?.()) || "").replace(/\/+$/, "");
                    return [
                        `Published the stage to ${host}/${r.ib} (${r.transform}, ${r.tokensLeft} token(s) left).`,
                        `Load it (replaces the stage): stagedir surf ${r.ib}`,
                    ].join("\n");
                }

                case "place": {
                    // Trailing "<SLOT> [n]" overrides; everything before is the path.
                    const rest = args.slice(1).map(String);
                    const peelSlotSuffix = (parts) => {
                        for (let i = 1; i <= parts.length; i++) {
                            const slice = parts.slice(parts.length - i);
                            const t = takeSlot(slice);
                            if (t.slot && t.rest.length === 0) {
                                return { slot: t.slot, rest: parts.slice(0, parts.length - i) };
                            }
                        }
                        return { slot: null, rest: parts };
                    };
                    let atArg = null;
                    let slotArg = null;
                    const last = rest[rest.length - 1];
                    if (rest.length > 2 && /^\d+$/.test(last)) {
                        const before = peelSlotSuffix(rest.slice(0, -1));
                        if (before.slot && before.rest.length) {
                            atArg = parseInt(rest[rest.length - 1], 10);
                            slotArg = before.slot;
                            rest.length = 0;
                            rest.push(...before.rest);
                        }
                    }
                    if (slotArg == null && rest.length > 1) {
                        const before = peelSlotSuffix(rest);
                        if (before.slot && before.rest.length) {
                            slotArg = before.slot;
                            rest.length = 0;
                            rest.push(...before.rest);
                        }
                    }
                    const route = /^https?:$/i.test(rest[0] || "")
                        ? `${rest[0]}//${rest.slice(1).join("/")}`
                        : rest.join(" ");
                    if (!route.trim()) return "Usage: stagedir place <path> [SLOT] [n]";
                    const r = await stage.placeFromPath(route, slotArg, atArg);
                    await stage.persist();
                    const where = r.at == null ? `${r.slot} (outer end)` : `${r.slot}[${r.at}]`;
                    return `Placed ${r.path} at ${where} — ${r.label}${r.fromFrame && slotArg == null ? " (from its stage direction)" : ""}`;
                }

                case "clear": {
                    const slotTaken = args[1] ? takeSlot(args.slice(1)) : { slot: null };
                    const slotKey = slotTaken.slot;
                    if (args[1] && !slotKey) return `Unknown slot '${args[1]}'`;
                    stage.clear(slotKey);
                    await stage.persist();
                    return slotKey ? `Cleared ${slotKey}` : "Cleared the whole stage";
                }

                case "spacer": {
                    const slotTaken = takeSlot(args.slice(1));
                    const slotKey = slotTaken.slot;
                    if (!slotKey) return `Unknown slot '${args[1]}'`;
                    args = [args[0], slotKey, ...slotTaken.rest];
                    const mode = String(args[2] || "").toLowerCase();
                    if (mode === "off" || mode === "remove") {
                        return stage.removeSpacer(slotKey)
                            ? `Removed spacer at ${slotKey}`
                            : `${slotKey} is not an empty spacer`;
                    }
                    return stage.addSpacer(slotKey)
                        ? `Spacer placed at ${slotKey}`
                        : `${slotKey} already has content (not a spacer)`;
                }

                case "flip":
                case "transpose":
                case "axes": {
                    const mode = args[1] != null ? args[1] : "toggle";
                    return stage.flipAxes(mode).msg;
                }

                case "br":
                case "separatebr":
                case "memberbr": {
                    const mode = args[1] != null ? args[1] : "toggle";
                    return (await stage.setSeparateWithBr(mode)).msg;
                }

                case "save":
                    await stage.persist();
                    return "Saved current stage to preset 0 (live).";

                case "preset": {
                    const sub = args[1] != null ? String(args[1]).toLowerCase() : "";

                    if (sub === "") {
                        return (await stage.activatePreset(0)).msg;
                    }
                    if (sub === "list") {
                        const list = await stage.listPresets();
                        if (!list.length) return "No presets yet.";
                        return list
                            .map((p) => {
                                return `  [${p.index}]${p.live ? " (live)" : ""} ${p.slots.join(" ") || "(empty)"}`;
                            })
                            .join("\n");
                    }
                    if (sub === "new") {
                        const i = await stage.newPreset();
                        return `Created preset ${i} from the live stage.`;
                    }
                    if (sub === "save") {
                        const n = parseInt(args[2], 10);
                        if (Number.isNaN(n)) return "Usage: stagedir preset save <N>";
                        try {
                            await stage.savePreset(n);
                            return `Saved the live stage to preset ${n}.`;
                        } catch (error) {
                            return `Error: ${error.message}`;
                        }
                    }
                    if (sub === "del" || sub === "delete" || sub === "remove") {
                        const n = parseInt(args[2], 10);
                        if (Number.isNaN(n) || n === 0) return "Usage: stagedir preset del <N>  (N>0)";
                        return (await stage.delPreset(n)) ? `Deleted preset ${n}.` : `no preset ${n}`;
                    }

                    const n = parseInt(sub, 10);
                    if (Number.isNaN(n)) return "Usage: stagedir preset [N | list | new | save <N> | del <N>]";
                    return (await stage.activatePreset(n)).msg;
                }

                case "help":
                    return HELP;

                default:
                    return `Unknown stagedir form '${first}'. Type 'stagedir help'.`;
            }
        } catch (error) {
            return `Error: ${error.message || error}`;
        }
    };

    return {
        name: "stagedir",
        version: "3.8.0",
        description:
            "Direct the live Horizon stage; put + htmx swaps stamp data-hash",

        moduleInfo: {
            name: "stagedir",
            version: "3.8.0",
            description:
                "stagedir march hangs nested 3×3 cells (CS/R/U); br separators; flip axes",
        },

        stage,

        commands: {
            stagedir: {
                name: "stagedir",
                description: "Direct the live Horizon stage: stagedir surf <path> | publish <path> | place <path> [SLOT] [n] | march <SLOT> <STEP> [n] | <SLOT> <n> move <DEST> [k] | add [k] | remove | swap | show | clear | spacer | flip | br | save | preset",
                execute: runStagedir,
            },
        },

        onMount: async () => {
            // Do not auto-persist here: a reload would otherwise overwrite a saved
            // preset with the default SSR stage before `stagedir preset` can apply it.
            await stage.loadSettings();
            await stage.hydratePresentations();
            stage.applyBandDepth();
            stage.stampExistingColumns();
            stage.syncAllMemberSeparators();
            armHtmxHashListeners();
            console.log("[stagedir] Module loaded — type 'stagedir help'");
        },

        onUnmount: () => {
            pendingHtmxInstallHash = null;
            eventListeners.forEach(({ element, event, handler, capture }) => {
                element.removeEventListener(event, handler, !!capture);
            });
            eventListeners.length = 0;

            createdElements.forEach((el) => el.remove());
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

            console.log("[stagedir] Module unmounted");
        },
    };
};
