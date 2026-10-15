/**
 * relativespan — dropdown leaf "stage text" + jockey relative place/unwrap.
 * Text compose/edit stays on the live stage DOM (+ stage persist) — no tip invent.
 *
 * Dropdown root "stage text": opens jockey-move 3×3 zone grid; chosen slot gets
 * a <span data-relativespan-compose> + <input>. Enter → text node on stage.
 *
 * +1 insert text (htm-element): same compose input, inserted into the claimed
 * element (not a new stage-member).
 * +1 relative-span xy (stage-member): wrap or re-place at current visual xy, then drag.
 * −1 on relative-span: unwrap.
 * −1 on text (edit text): swap selection for textarea; Enter → text node
 * (Range splice — never flatten HTMF markup via textContent).
 *
 * Requires: supermouse_plugin_stagejockey, supermouse_plugin_dropdown,
 *           stagedir, jockey_move (zone picker).
 */
const HELP = [
    "relativespan — put text on the stage and pin things at exact positions.",
    "use: stagejockey dropdown \"stage text\" → pick a grid cell, type, Enter.",
    "     +1 \"insert text\" on an element — type text into that element.",
    "     +1 \"relative-span xy\" on a stage-member — pin it where it is, then drag it.",
    "     −1 \"unrelative-span\" on a pinned span — unpin it.",
    "     −1 \"edit text\" on text — edit it in place, Enter to save.",
    "needs: stagejockey, supermouse_plugin_dropdown, horizon_stagedir, jockey_move",
].join("\n");

export const register = (navi) => {
    const isBrowser =
        typeof window !== "undefined" && typeof window.document !== "undefined";

    const PART_REL = "relative-span";
    const PART_TEXT = "text";
    /** Stage text is an htmf member: a <span data-part="htmf"> holding the text node; value = its outerHTML. */
    const PART_HTMF = "htmf";
    const STYLE_ID = "relativespan-style";

    let unrootDropdown = null;
    /** @type {{ span: HTMLElement, hold: HTMLElement|null, cleanup: () => void }|null} */
    let placeSession = null;

    const resolveStage = () => navi?.mod?.stagedir?.stage || null;
    const resolveDropdown = () => navi?.mod?.supermouse_plugin_dropdown || null;
    const resolveJockey = () =>
        navi?.mod?.supermouse_plugin_stagejockey?.jockey || null;
    const resolveJockeyMove = () =>
        navi?.mod?.jockey_move || globalThis?.navi?.mod?.jockey_move || null;

    const callout = (msg) => {
        if (typeof navi.callout === "function") navi.callout(msg);
    };

    const hasType = (context, name) => {
        const types = Array.isArray(context?.types) ? context.types : [];
        return types.includes(name) || context?.kind === name;
    };

    const liveElement = (context) => {
        const el = context?.element;
        return el instanceof HTMLElement ? el : null;
    };

    const ensureStyles = () => {
        if (!isBrowser || document.getElementById(STYLE_ID)) return;
        const style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = `
span[data-relativespan-compose="1"] {
  display: inline-block;
  line-height: 1.25;
  vertical-align: baseline;
}
span[data-relativespan-compose="1"] input[data-relativespan-input],
textarea[data-relativespan-edit] {
  display: block;
  box-sizing: border-box;
  margin: 0;
  padding: 2px 6px;
  font: inherit;
  border: 1px solid #888;
  background: #fff;
  min-width: 8ch;
  max-width: min(40vw, 24rem);
}
span[data-relativespan-compose="1"] input[data-relativespan-input] {
  height: 1.5em;
  line-height: 1.25;
}
textarea[data-relativespan-edit] {
  line-height: 1.25;
  min-height: 1.5em;
  resize: both;
}
`;
        document.head.appendChild(style);
    };

    /** Positioning is inline on each span so serialized stage HTML carries it. */
    const REL_INLINE = {
        position: "absolute",
        display: "block",
        boxSizing: "border-box",
        margin: "0",
        zIndex: "20",
    };

    const applyRelInline = (span) => {
        if (!(span instanceof HTMLElement)) return span;
        for (const [k, v] of Object.entries(REL_INLINE)) {
            if (!span.style[k]) span.style[k] = v;
        }
        return span;
    };

    const backfillRelInline = () => {
        if (!isBrowser) return 0;
        const spans = document.querySelectorAll(`span[data-part="${PART_REL}"]`);
        spans.forEach(applyRelInline);
        return spans.length;
    };

    const hostRelative = (el) => {
        if (!(el instanceof HTMLElement)) return null;
        if (
            el.matches?.(`span[data-part="${PART_REL}"]`) ||
            el.getAttribute("data-part") === PART_REL
        ) {
            return el;
        }
        return el.closest?.(`span[data-part="${PART_REL}"]`) || null;
    };

    const resolveRelative = (context) => {
        const fromEl = hostRelative(liveElement(context));
        if (fromEl) return fromEl;
        const host = context?.hostElement;
        if (host instanceof HTMLElement) {
            const w = hostRelative(host);
            if (w) return w;
        }
        return null;
    };

    const installDataHash = (el) => {
        if (!(el instanceof HTMLElement) || el.hasAttribute("data-hash")) {
            return el.getAttribute("data-hash") || "";
        }
        try {
            const raw = el.outerHTML;
            let h = 0x811c9dc5;
            for (let i = 0; i < raw.length; i++) {
                h ^= raw.charCodeAt(i);
                h = Math.imul(h, 0x01000193);
            }
            const stamp =
                Date.now().toString(16) +
                (Math.floor(Math.random() * 0x10000) >>> 0)
                    .toString(16)
                    .padStart(4, "0");
            const hash =
                (h >>> 0).toString(16).padStart(8, "0") +
                raw.length.toString(16).padStart(6, "0") +
                stamp;
            el.setAttribute("data-hash", hash);
            return hash;
        } catch {
            return "";
        }
    };

    const hashHostOf = (el) => {
        if (!(el instanceof HTMLElement)) return null;
        if (el.hasAttribute("data-hash")) return el;
        return el.closest?.("[data-hash]") || null;
    };

    /**
     * In-flow spacer so the stage does not collapse while the claim is still
     * placing the absolute wrapper. Removed when the place claim terminates.
     */
    const makeFlowHold = (el, rect) => {
        const hold = document.createElement("span");
        hold.setAttribute("data-jockey-ui", "relativespan-hold");
        hold.setAttribute("aria-hidden", "true");
        const cs =
            typeof window.getComputedStyle === "function"
                ? window.getComputedStyle(el)
                : null;
        const display = String(cs?.display || "block");
        const inlineish =
            display === "inline" ||
            display === "inline-block" ||
            display === "inline-flex" ||
            display === "inline-grid";
        hold.style.cssText = [
            `display:${inlineish ? "inline-block" : "block"}`,
            "box-sizing:border-box",
            "margin:0",
            "padding:0",
            "border:0",
            `width:${Math.max(1, rect.width)}px`,
            `height:${Math.max(1, rect.height)}px`,
            inlineish
                ? `vertical-align:${cs?.verticalAlign || "baseline"}`
                : "",
            "visibility:hidden",
            "pointer-events:none",
            "overflow:hidden",
        ]
            .filter(Boolean)
            .join(";");
        return hold;
    };

    const dropFlowHold = (hold) => {
        if (!(hold instanceof HTMLElement)) return;
        try {
            hold.remove();
        } catch {
            /* ignore */
        }
    };

    /**
     * Wrap live stage element in span[data-part=relative-span] at current visual xy
     * relative to its parent (stage columns are position:relative).
     * Returns { span, hold } — hold is an in-flow spacer kept until claim end.
     */
    const wrapRelative = (el) => {
        if (!isBrowser || !(el instanceof HTMLElement)) {
            return { span: null, hold: null };
        }
        ensureStyles();
        const already = hostRelative(el);
        if (already) return { span: applyRelInline(already), hold: null };

        const parent = el.parentNode;
        if (!(parent instanceof HTMLElement)) {
            return { span: null, hold: null };
        }

        const pRect = parent.getBoundingClientRect();
        const r = el.getBoundingClientRect();
        const left = r.left - pRect.left + parent.scrollLeft;
        const top = r.top - pRect.top + parent.scrollTop;

        // Reserve layout space before the absolute wrap takes the element out of flow.
        const hold = makeFlowHold(el, r);
        parent.insertBefore(hold, el);

        const span = document.createElement("span");
        span.setAttribute("data-part", PART_REL);
        applyRelInline(span);
        span.style.left = `${left}px`;
        span.style.top = `${top}px`;
        span.style.width = `${Math.max(1, r.width)}px`;

        parent.insertBefore(span, el);
        span.appendChild(el);
        return { span, hold };
    };

    const unwrapRelative = (node) => {
        if (!isBrowser || !(node instanceof HTMLElement)) return null;
        const wrapper = hostRelative(node);
        if (!wrapper || !wrapper.parentNode) return null;

        const parent = wrapper.parentNode;
        const stage = resolveStage();
        const priorPres =
            stage && typeof stage.presentationFor === "function"
                ? stage.presentationFor(wrapper)
                : null;

        const nodes = Array.from(wrapper.childNodes);
        const elements = nodes.filter((n) => n.nodeType === 1);
        let restored = null;

        if (elements.length > 0) {
            const frag = document.createDocumentFragment();
            for (const n of nodes) frag.appendChild(n);
            parent.insertBefore(frag, wrapper);
            restored = elements[0];
        } else if (nodes.length > 0) {
            // Text-only after innerHTML/edit flatten — need an element occupant.
            const span = document.createElement("span");
            for (const attr of ["data-hash", "data-path"]) {
                const v = wrapper.getAttribute(attr);
                if (v) span.setAttribute(attr, v);
            }
            for (const n of nodes) span.appendChild(n);
            parent.insertBefore(span, wrapper);
            restored = span;
        }

        wrapper.remove();

        if (
            restored instanceof HTMLElement &&
            priorPres &&
            stage &&
            typeof stage.rememberPresentation === "function"
        ) {
            stage.rememberPresentation(restored, priorPres);
        }
        return restored;
    };

    const clearPlaceSession = () => {
        if (!placeSession) return;
        try {
            placeSession.cleanup();
        } catch {
            /* ignore */
        }
        placeSession = null;
    };

    const CLAIM_COLOR = "#e040a0";
    const CLAIM_SHADOW = "0 1px 2px #2a0018, 0 0 2px #000, 0 0 1px #000";

    const armPlaceDrag = (span, api, hold = null) => {
        clearPlaceSession();
        if (!(span instanceof HTMLElement) || !isBrowser) {
            dropFlowHold(hold);
            return;
        }

        ensureStyles();
        applyRelInline(span);
        const baseLeft = parseFloat(span.style.left) || 0;
        const baseTop = parseFloat(span.style.top) || 0;
        let anchorX = null;
        let anchorY = null;
        let finished = false;
        let flowHold = hold instanceof HTMLElement ? hold : null;

        const outline = document.createElement("div");
        outline.setAttribute("data-jockey-ui", "relativespan-place");
        outline.style.cssText = [
            "position:fixed",
            "pointer-events:none",
            "z-index:2147483646",
            "box-sizing:border-box",
            `border:2px solid ${CLAIM_COLOR}`,
            "background:rgba(224,64,160,0.10)",
        ].join(";");
        document.documentElement.appendChild(outline);

        const syncOutline = () => {
            if (!span.isConnected || !outline.isConnected) return;
            const r = span.getBoundingClientRect();
            outline.style.left = `${r.left}px`;
            outline.style.top = `${r.top}px`;
            outline.style.width = `${r.width}px`;
            outline.style.height = `${r.height}px`;
        };
        syncOutline();

        const finish = (via) => {
            if (finished) return;
            finished = true;
            clearPlaceSession();
            if (via === "middle" && typeof api?.terminate === "function") {
                try {
                    api.terminate();
                } catch {
                    /* ignore */
                }
            }
            callout(
                via === "middle"
                    ? "[relativespan] position locked (middle-click)"
                    : "[relativespan] place ended"
            );
        };

        const onMove = (e) => {
            if (!span.isConnected) {
                finish("gone");
                return;
            }
            if (anchorX == null) {
                anchorX = e.clientX;
                anchorY = e.clientY;
                return;
            }
            const dx = e.clientX - anchorX;
            const dy = e.clientY - anchorY;
            span.style.left = `${baseLeft + dx}px`;
            span.style.top = `${baseTop + dy}px`;
            syncOutline();
        };

        const onDown = (e) => {
            if (e.button === 1) {
                e.preventDefault();
                e.stopPropagation();
                finish("middle");
            }
        };

        const onRightUp = (e) => {
            if (e.button !== 2) return;
            finish("rightup");
        };

        const cleanup = () => {
            document.removeEventListener("mousemove", onMove, true);
            document.removeEventListener("mousedown", onDown, true);
            document.removeEventListener("mouseup", onRightUp, true);
            document.removeEventListener("pointerup", onRightUp, true);
            try {
                outline.remove();
            } catch {
                /* ignore */
            }
            // Release reserved layout space only after the claim ends.
            dropFlowHold(flowHold);
            flowHold = null;
        };

        document.addEventListener("mousemove", onMove, true);
        document.addEventListener("mousedown", onDown, true);
        document.addEventListener("mouseup", onRightUp, true);
        document.addEventListener("pointerup", onRightUp, true);
        placeSession = { span, hold: flowHold, cleanup };
        callout(
            "[relativespan] move cursor to place · middle-click to lock · or release right"
        );
    };

    const dropEmptyCompose = (span) => {
        const stage = resolveStage();
        const jockey = resolveJockey();
        const loc =
            typeof jockey?.locate === "function" ? jockey.locate(span) : null;
        if (stage && loc?.slot != null && loc?.index != null) {
            stage.removeAt(loc.slot, loc.index);
            if (typeof stage.persist === "function") void stage.persist();
        } else {
            span.remove();
        }
    };

    const commitComposeInput = async (span, input) => {
        if (!(span instanceof HTMLElement) || !(input instanceof HTMLElement)) {
            return;
        }
        const text = String(input.value ?? "");
        if (!text.trim()) {
            input.remove();
            span.removeAttribute("data-relativespan-compose");
            dropEmptyCompose(span);
            return;
        }
        installDataHash(span);
        input.remove();
        span.removeAttribute("data-relativespan-compose");
        span.appendChild(document.createTextNode(text));
        const stage = resolveStage();
        if (stage && typeof stage.rememberPresentation === "function") {
            stage.rememberPresentation(span, {
                type: PART_HTMF,
                value: span.outerHTML,
            });
        }
        if (stage && typeof stage.persist === "function") {
            void stage.persist();
        }
        callout("[relativespan] stage text committed");
    };

    const wireComposeInput = (root) => {
        if (!(root instanceof HTMLElement)) return;
        const input =
            root.matches?.("input[data-relativespan-input]")
                ? root
                : root.querySelector?.("input[data-relativespan-input]");
        if (!(input instanceof HTMLInputElement)) return;
        const span =
            input.closest?.('span[data-relativespan-compose="1"]') ||
            input.parentElement;
        if (!(span instanceof HTMLElement)) return;

        const onKey = (e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            e.stopPropagation();
            input.removeEventListener("keydown", onKey);
            void commitComposeInput(span, input);
        };
        input.addEventListener("keydown", onKey);
        try {
            input.focus();
            input.select?.();
        } catch {
            /* ignore */
        }
    };

    const addTextComposeToSlot = (slotKey) => {
        if (!isBrowser) throw new Error("browser required");
        const stage = resolveStage();
        if (!stage?.ensureColumn || !stage?.insertLogical) {
            throw new Error("stagedir.stage insert API unavailable");
        }
        const slot = String(slotKey || "").trim().toUpperCase();
        if (!slot) throw new Error("stage zone required");
        ensureStyles();

        const span = document.createElement("span");
        span.setAttribute("data-relativespan-compose", "1");
        const input = document.createElement("input");
        input.type = "text";
        input.setAttribute("data-relativespan-input", "1");
        input.setAttribute("aria-label", "stage text");
        input.placeholder = "type text, Enter";
        span.appendChild(input);

        const col = stage.ensureColumn(slot);
        stage.insertLogical(col, span, slot, null);
        if (typeof stage.rememberPresentation === "function") {
            stage.rememberPresentation(span, {
                type: PART_HTMF,
                value: "<span></span>",
            });
        }
        if (typeof stage.stampOccupantMeta === "function") {
            stage.stampOccupantMeta(span, PART_HTMF, null);
        }
        installDataHash(span);

        wireComposeInput(span);
        if (typeof stage.persist === "function") {
            void stage.persist();
        }
        callout(`[relativespan] text input on ${slot} — Enter commits on stage`);
        try {
            input.focus();
            input.select?.();
        } catch {
            /* ignore */
        }
    };

    /**
     * +1 insert text on htm-element: compose input inside the claimed element
     * (not cast as a new stage-member). Enter → append text node; empty → remove.
     */
    const insertTextComposeInto = (hostEl, api) => {
        if (!isBrowser || !(hostEl instanceof HTMLElement)) {
            throw new Error("no htm-element");
        }
        ensureStyles();

        const existing = hostEl.querySelector?.(
            'span[data-relativespan-compose="1"] input[data-relativespan-input]'
        );
        if (existing instanceof HTMLInputElement) {
            try {
                existing.focus();
                existing.select?.();
            } catch {
                /* ignore */
            }
            if (typeof api?.terminate === "function") api.terminate();
            return existing;
        }

        const span = document.createElement("span");
        span.setAttribute("data-relativespan-compose", "1");
        span.setAttribute("data-relativespan-insert", "1");
        const input = document.createElement("input");
        input.type = "text";
        input.setAttribute("data-relativespan-input", "1");
        input.setAttribute("aria-label", "insert text");
        input.placeholder = "type text, Enter";
        span.appendChild(input);
        hostEl.appendChild(span);

        const finish = async () => {
            const text = String(input.value ?? "");
            try {
                span.remove();
                if (text.trim()) {
                    hostEl.appendChild(document.createTextNode(text));
                    if (typeof hostEl.normalize === "function") {
                        hostEl.normalize();
                    }
                }
                const stage = resolveStage();
                const hashHost = hashHostOf(hostEl) || hostEl;
                installDataHash(hashHost);
                if (
                    stage &&
                    typeof stage.rememberPresentation === "function"
                ) {
                    const prior =
                        typeof stage.presentationFor === "function"
                            ? stage.presentationFor(hashHost)
                            : null;
                    const stamped = String(
                        hashHost.getAttribute("data-part") || ""
                    ).trim();
                    const priorType = String(prior?.type || "").trim();
                    const path =
                        hashHost.getAttribute("data-path") ||
                        prior?.path ||
                        undefined;
                    const keepStructured =
                        (stamped && stamped !== PART_TEXT) ||
                        (priorType &&
                            priorType !== PART_TEXT &&
                            priorType !== "text");
                    if (keepStructured) {
                        stage.rememberPresentation(hashHost, {
                            ...(prior || {}),
                            type: stamped || priorType,
                            value: hashHost.outerHTML,
                            ...(path ? { path } : {}),
                        });
                    } else {
                        stage.rememberPresentation(hashHost, {
                            type: PART_HTMF,
                            value: hashHost.outerHTML,
                            ...(path ? { path } : {}),
                        });
                    }
                }
                if (stage && typeof stage.persist === "function") {
                    void stage.persist();
                }
                callout(
                    text.trim()
                        ? "[relativespan] insert text committed"
                        : "[relativespan] insert text cancelled"
                );
            } catch (err) {
                callout(
                    `[relativespan] insert text failed: ${
                        err && err.message ? err.message : err
                    }`
                );
            }
        };

        const onKey = (e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            e.stopPropagation();
            input.removeEventListener("keydown", onKey);
            void finish();
        };
        input.addEventListener("keydown", onKey);

        // End the hold so typing/clicks reach the input freely.
        if (typeof api?.terminate === "function") api.terminate();

        callout("[relativespan] insert text — Enter commits into element");
        try {
            input.focus();
            input.select?.();
        } catch {
            /* ignore */
        }
        return input;
    };

    /** Dropdown "stage text": jockey-move 3×3 → compose input in chosen zone. */
    const openStageTextPicker = (ddApi) => {
        const move = resolveJockeyMove();
        if (!move || typeof move.openMoveGrid !== "function") {
            throw new Error("jockey_move required (mount jockey_move for stage text)");
        }
        const stage = resolveStage();
        if (!stage) throw new Error("stagedir.stage unavailable");
        const jockey = resolveJockey();
        const pt =
            (typeof ddApi?.pointer === "function"
                ? ddApi.pointer()
                : ddApi?.pointer) ||
            jockey?._pointer ||
            { x: 0, y: 0 };
        if (jockey?._pointer) {
            jockey._pointer.x = Number(pt.x) || 0;
            jockey._pointer.y = Number(pt.y) || 0;
        }
        const api = {
            navi,
            jockey: jockey || { _pointer: { x: Number(pt.x) || 0, y: Number(pt.y) || 0 } },
            stage,
            pointer: { x: Number(pt.x) || 0, y: Number(pt.y) || 0 },
            terminate: () => {},
        };
        return move.openMoveGrid(api, async (slot) => {
            addTextComposeToSlot(slot);
        });
    };

    /**
     * Map [start,end) in root.textContent space → a live DOM Range.
     * Matches stagejockey offset rules (empty text nodes skipped).
     */
    const domRangeFromTextOffsets = (root, start, end) => {
        if (!(root instanceof HTMLElement) || !isBrowser) return null;
        const a = Math.max(0, Math.min(start, end));
        const b = Math.max(start, end);
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
                const len = String(n.textContent || "").length;
                if (len === 0) continue;
                lastNode = n;
                if (!startNode && a < acc + len) {
                    startNode = n;
                    startOff = a - acc;
                }
                if (!endNode && b <= acc + len) {
                    endNode = n;
                    endOff = b - acc;
                    break;
                }
                acc += len;
            }
            if (!startNode) {
                if (!lastNode) return null;
                startNode = lastNode;
                startOff = String(lastNode.textContent || "").length;
            }
            if (!endNode) {
                if (!lastNode) return null;
                endNode = lastNode;
                endOff = String(lastNode.textContent || "").length;
            }
            range.setStart(startNode, startOff);
            range.setEnd(endNode, endOff);
            return range;
        } catch {
            return null;
        }
    };

    const rootHasElementDescendants = (root) =>
        root instanceof HTMLElement && !!root.querySelector("*");

    /**
     * Splice textarea into the live text-node range (preserves sibling markup).
     * Never replaceChildren on the HTMF root — that flattened welcome to plain text.
     */
    const spliceTextareaAtOffsets = (root, start, end, ta) => {
        const range = domRangeFromTextOffsets(root, start, end);
        if (!range) throw new Error("cannot map text range in root");
        range.deleteContents();
        range.insertNode(ta);
        if (!ta.isConnected) {
            throw new Error("textarea failed to splice into DOM");
        }
    };

    /**
     * Replace a character range inside root with a focused textarea.
     * Enter → text node on stage (no tip invent / data-path overwrite).
     * If root is a relative-span, edit its leaf shell (never flatten the wrapper).
     * Markup roots: only splice the selected text nodes — do not flatten to textContent.
     */
    const armTextEdit = (rootIn, start, end, selectedText, api) => {
        if (!(rootIn instanceof HTMLElement) || !isBrowser) {
            throw new Error("no text root");
        }
        ensureStyles();

        let root = rootIn;
        if (root.getAttribute("data-part") === PART_REL) {
            let shell = root.firstElementChild;
            if (!(shell instanceof HTMLElement)) {
                shell = document.createElement("span");
                while (root.firstChild) shell.appendChild(root.firstChild);
                root.appendChild(shell);
            }
            root = shell;
        }

        const full = String(root.textContent || "");
        const s = Math.max(0, Math.min(Number(start) || 0, full.length));
        const e = Math.max(s, Math.min(Number(end) || s, full.length));
        const slice =
            selectedText != null ? String(selectedText) : full.slice(s, e);
        const isFull = s === 0 && e === full.length;
        const hasMarkup = rootHasElementDescendants(root);
        // Full-range edit of marked-up HTMF would delete intervening elements.
        if (isFull && hasMarkup) {
            throw new Error(
                "full text edit would flatten markup — select a char/word/phrase span"
            );
        }
        // Plain leaf: replaceChildren is safe. Markup / partial: Range splice.
        const preserveDom = hasMarkup || !isFull;

        const host = hashHostOf(root) || root;
        installDataHash(host);

        const ta = document.createElement("textarea");
        ta.setAttribute("data-relativespan-edit", "1");
        ta.value = slice;
        ta.rows = Math.min(8, Math.max(1, slice.split("\n").length));

        if (preserveDom) {
            spliceTextareaAtOffsets(root, s, e, ta);
        } else {
            root.replaceChildren(ta);
        }

        const finishEdit = async () => {
            const next = String(ta.value ?? "");
            try {
                const tn = document.createTextNode(next);
                const parent = ta.parentNode;
                ta.replaceWith(tn);
                if (parent && typeof parent.normalize === "function") {
                    parent.normalize();
                }
                const stage = resolveStage();
                if (stage && typeof stage.rememberPresentation === "function") {
                    const prior =
                        typeof stage.presentationFor === "function"
                            ? stage.presentationFor(host)
                            : null;
                    const stamped = String(
                        host.getAttribute("data-part") || ""
                    ).trim();
                    const priorType = String(prior?.type || "").trim();
                    const keepStructured =
                        (stamped && stamped !== PART_TEXT) ||
                        (priorType &&
                            priorType !== PART_TEXT &&
                            priorType !== "text");
                    const path =
                        host.getAttribute("data-path") ||
                        prior?.path ||
                        undefined;
                    if (keepStructured) {
                        // HTMF/html occupant: persist live markup, not textContent.
                        stage.rememberPresentation(host, {
                            ...(prior || {}),
                            type: stamped || priorType,
                            value: host.outerHTML,
                            ...(path ? { path } : {}),
                        });
                    } else {
                        stage.rememberPresentation(host, {
                            type: PART_HTMF,
                            value: host.outerHTML,
                            ...(path ? { path } : {}),
                        });
                    }
                }
                if (stage && typeof stage.persist === "function") {
                    void stage.persist();
                }
                callout("[relativespan] text edit committed");
                if (typeof api?.terminate === "function") api.terminate();
            } catch (err) {
                callout(
                    `[relativespan] text edit failed: ${
                        err && err.message ? err.message : err
                    }`
                );
            }
        };

        const onKey = (ev) => {
            if (ev.key !== "Enter" || ev.shiftKey) return;
            ev.preventDefault();
            ev.stopPropagation();
            ta.removeEventListener("keydown", onKey);
            void finishEdit();
        };
        ta.addEventListener("keydown", onKey);
        try {
            ta.focus();
            ta.select?.();
        } catch {
            /* ignore */
        }
    };

    const rootDropdownMenu = {
        id: "relativespan_text",
        label: "stage text",
        title: "Pick a stage zone (jockey-move grid), then type; Enter commits on stage",
        action: (ddApi) => {
            try {
                void openStageTextPicker(ddApi);
            } catch (err) {
                callout(
                    `[relativespan] ${err && err.message ? err.message : err}`
                );
            }
        },
    };

    const hookDropdown = () => {
        const dd = resolveDropdown();
        if (!dd?.registerRootMenu) return false;
        // Only offer the leaf when jockey-move can supply the zone grid.
        if (!resolveJockeyMove()?.openMoveGrid) return false;
        if (!unrootDropdown) {
            unrootDropdown = dd.registerRootMenu(rootDropdownMenu);
        }
        return !!unrootDropdown;
    };

    const unhookDropdown = () => {
        if (typeof unrootDropdown === "function") {
            try {
                unrootDropdown();
            } catch {
                /* ignore */
            }
            unrootDropdown = null;
        }
    };

    const scrollbufferPlugin = {
        id: "relativespan",
        name: "relativespan",
        claims: [
            {
                id: "insert-text",
                direction: 1,
                types: ["htm-element"],
                color: CLAIM_COLOR,
                describe: () => ({
                    text: "insert text",
                    color: CLAIM_COLOR,
                    textShadow: CLAIM_SHADOW,
                }),
                matches: (context) => {
                    if (!hasType(context, "htm-element")) return false;
                    const el =
                        context?.hostElement instanceof HTMLElement
                            ? context.hostElement
                            : liveElement(context);
                    return !!el;
                },
                execute: (context, api) => {
                    const el =
                        context?.hostElement instanceof HTMLElement
                            ? context.hostElement
                            : liveElement(context);
                    if (!el) throw new Error("no htm-element");
                    insertTextComposeInto(el, api);
                    return undefined;
                },
            },
            {
                id: "relative-span-xy",
                direction: 1,
                types: ["stage-member"],
                color: CLAIM_COLOR,
                describe: () => ({
                    text: "relative-span xy",
                    color: CLAIM_COLOR,
                    textShadow: CLAIM_SHADOW,
                }),
                matches: (context) => {
                    if (!hasType(context, "stage-member")) return false;
                    const el =
                        context?.hostElement instanceof HTMLElement
                            ? context.hostElement
                            : liveElement(context);
                    return !!el;
                },
                execute: (context, api) => {
                    const el =
                        context?.hostElement instanceof HTMLElement
                            ? context.hostElement
                            : liveElement(context);
                    if (!el) throw new Error("no live stage element");
                    const { span, hold } = wrapRelative(el);
                    if (!span) {
                        dropFlowHold(hold);
                        throw new Error("wrap failed");
                    }
                    armPlaceDrag(span, api, hold);
                    return undefined;
                },
            },
            {
                id: "unrelative-span",
                direction: -1,
                types: [PART_REL],
                color: CLAIM_COLOR,
                describe: () => ({
                    text: "unrelative-span",
                    color: CLAIM_COLOR,
                    textShadow: CLAIM_SHADOW,
                }),
                matches: (context) => {
                    if (resolveRelative(context)) return true;
                    return hasType(context, PART_REL);
                },
                execute: (context, api) => {
                    clearPlaceSession();
                    const wrapper = resolveRelative(context);
                    if (!wrapper) throw new Error("no relative-span");
                    unwrapRelative(wrapper);
                    if (typeof api?.terminate === "function") api.terminate();
                    return undefined;
                },
            },
            {
                id: "edit-text",
                direction: -1,
                types: [PART_TEXT],
                color: CLAIM_COLOR,
                describe: () => ({
                    text: "edit text",
                    color: CLAIM_COLOR,
                    textShadow: CLAIM_SHADOW,
                }),
                matches: (context) => {
                    if (!hasType(context, PART_TEXT)) return false;
                    const root =
                        context?.textRoot instanceof HTMLElement
                            ? context.textRoot
                            : liveElement(context);
                    if (!(root instanceof HTMLElement)) return false;
                    const span = context?.textSpan;
                    if (span && typeof span.start === "number") return true;
                    return String(root.textContent || "").length > 0;
                },
                execute: (context, api) => {
                    const root =
                        context?.textRoot instanceof HTMLElement
                            ? context.textRoot
                            : liveElement(context);
                    if (!(root instanceof HTMLElement)) {
                        throw new Error("no text root");
                    }
                    const full = String(root.textContent || "");
                    const span = context?.textSpan;
                    let start = 0;
                    let end = full.length;
                    let selected = full;
                    if (
                        span &&
                        typeof span.start === "number" &&
                        typeof span.end === "number"
                    ) {
                        start = span.start;
                        end = span.end;
                        selected =
                            span.text != null
                                ? String(span.text)
                                : full.slice(start, end);
                    }
                    armTextEdit(root, start, end, selected, api);
                    return undefined;
                },
            },
        ],
    };

    return {
        name: "relativespan",
        commands: {
            relativespan: { name: "relativespan", description: "help", execute: async () => HELP },
        },
        version: "0.1.13",
        description:
            "stage text / insert text / edit text on stage DOM; +1 relative-span xy; −1 unwrap",

        moduleInfo: {
            name: "relativespan",
            version: "0.1.13",
            description:
                "+1 insert text on htm-element; compose input inside the claimed element",
        },

        PART_REL,
        PART_TEXT,
        scrollbufferPlugin,
        rootDropdownMenu,
        wrapRelative,
        unwrapRelative,
        openStageTextPicker,
        addTextComposeToSlot,
        insertTextComposeInto,

        onMount: async () => {
            if (!isBrowser) return;
            ensureStyles();
            backfillRelInline();
            document.addEventListener("htmx:afterSettle", backfillRelInline);
            if (!hookDropdown()) {
                const t = setInterval(() => {
                    if (hookDropdown()) clearInterval(t);
                }, 400);
                setTimeout(() => clearInterval(t), 15000);
            }
            callout(
                "[relativespan] mounted — stage text · +1 insert text (htm-element) · +1 relative-span xy · −1 edit text"
            );
        },

        onUnmount: () => {
            clearPlaceSession();
            unhookDropdown();
            document.removeEventListener("htmx:afterSettle", backfillRelInline);
            try {
                document.getElementById(STYLE_ID)?.remove();
            } catch {
                /* ignore */
            }
        },
    };
};
