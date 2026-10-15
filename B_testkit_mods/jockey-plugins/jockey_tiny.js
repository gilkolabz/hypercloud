/**
 * jockey_tiny — scoped htmf tips via tiny_ibgib_space.
 *
 * Tip ib (hyperuri-style, rightmost = deeper):
 *   <data-path>[:<name>][:<tag>]…
 * Frame data.parts mark identity: htmf, tiny-clone, ibgib_frame, manifest, json.
 * Legacy tip ibs `htmf:…` / `jockey:htmf:…` are still peeled on read.
 *
 * Live identity: data-ibgib on the edited element (htmf host or leaf).
 * +1 tiny-init / tiny-edit / tiny-from-snoop: htmf + htm-element (htmf path differs).
 * +1 tiny-orient: htm-element only.
 * +1 tiny-base (<a>): /navi path attrs + htmx.process + persistLiveEdit.
 * stage-member add: tiny frame. Dropdown tiny ▸: tiny-orient | stage tiny frame.
 *
 * Requires: supermouse_plugin_stagejockey, tiny_ibgib_space
 * Optional: snoopy (URL hint for tiny-from-snoop)
 * @see A_document/tiny.md
 */
export const register = (navi) => {
    const NAVI_PREFIX = "navi:htmf:";
    /** Legacy tip prefixes — peel on read; new writes use bare data-path tip ibs. */
    const TIP_PREFIX = "htmf:";
    const LEGACY_TIP_PREFIX = "jockey:htmf:";
    const LEGACY_NAVI_PREFIXES = [
        "navi:jockey:htmf:",
        "navi:jockey:html:",
    ];
    /** Manifest parts stamped onto every tiny tip frame. */
    const FRAME_PARTS = [
        "htmf",
        "tiny-clone",
        "ibgib_frame",
        "manifest",
        "json",
    ];
    const ATTR_IBGIB = "data-ibgib";
    const ATTR_HTMF_IBGIB = "data-htmf-ibgib";
    const ORIENT_INDEX_KEY = "navi:tiny:orients";
    const PATH_ATTRS = [
        "href",
        "hx-get",
        "hx-post",
        "hx-put",
        "hx-patch",
        "hx-delete",
        "hx-src",
    ];

    const hasType = (context, name) => {
        const types = Array.isArray(context?.types) ? context.types : [];
        return types.includes(name) || context?.kind === name;
    };

    const resolveSpace = () => navi?.mod?.tiny_ibgib_space?.space || null;
    const resolveSnoopy = () => navi?.mod?.snoopy || null;
    const resolveStage = () => navi?.mod?.stagedir?.stage || navi?.mod?.horizon_stagedir?.stage || null;
    const resolveJockey = () =>
        navi?.mod?.supermouse_plugin_stagejockey?.jockey || null;

    const originalDataPath = (raw) => {
        let s = String(raw || "")
            .trim()
            .replace(/^\/+/, "");
        if (s.startsWith(NAVI_PREFIX)) s = s.slice(NAVI_PREFIX.length);
        else {
            for (const pre of LEGACY_NAVI_PREFIXES) {
                if (s.startsWith(pre)) {
                    s = s.slice(pre.length);
                    break;
                }
            }
        }
        if (s.startsWith(TIP_PREFIX)) s = s.slice(TIP_PREFIX.length);
        else if (s.startsWith(LEGACY_TIP_PREFIX)) {
            s = s.slice(LEGACY_TIP_PREFIX.length);
        }
        return s;
    };

    const rewrittenAttr = (dataPath) =>
        NAVI_PREFIX + originalDataPath(dataPath);

    const pathFromTipIb = (ib) => {
        const s = String(ib || "").trim();
        if (s.startsWith(TIP_PREFIX)) return s.slice(TIP_PREFIX.length);
        if (s.startsWith(LEGACY_TIP_PREFIX)) {
            return s.slice(LEGACY_TIP_PREFIX.length);
        }
        return originalDataPath(s);
    };

    /** Preferred tip ib + legacy prefixed forms (for lookup). */
    const tipIbCandidates = (dataPathOrIb) => {
        const bare = pathFromTipIb(dataPathOrIb) || originalDataPath(dataPathOrIb);
        if (!bare) return [];
        const out = [bare];
        if (!bare.startsWith(TIP_PREFIX)) out.push(TIP_PREFIX + bare);
        if (!bare.startsWith(LEGACY_TIP_PREFIX)) {
            out.push(LEGACY_TIP_PREFIX + bare);
        }
        return [...new Set(out)];
    };

    /** New writes: bare data-path tip ib (no htmf: / jockey:htmf: prefix). */
    const tipIbForDataPath = (dataPath) => {
        const path = originalDataPath(dataPath);
        return path || null;
    };

    const resolveTipIb = async (space, dataPathOrIb) => {
        const preferred = tipIbForDataPath(dataPathOrIb);
        if (!space || typeof space.tip !== "function") return preferred;
        for (const ib of tipIbCandidates(dataPathOrIb)) {
            try {
                const addr = await space.tip(ib);
                if (addr) return ib;
            } catch {
                /* try next */
            }
        }
        return preferred;
    };

    const liveElement = (context) => {
        const el = context?.element;
        return el instanceof HTMLElement ? el : null;
    };

    const hostMember = (context) => {
        if (context?.hostElement instanceof HTMLElement) {
            return context.hostElement;
        }
        return liveElement(context);
    };

    /**
     * Nesting layers deepest→shallow from context, or rebuild from DOM.
     */
    const nestingOf = (context) => {
        if (Array.isArray(context?.nesting) && context.nesting.length) {
            return context.nesting;
        }
        const el = liveElement(context);
        const host = hostMember(context) || el;
        const jockey = resolveJockey();
        if (el && host && typeof jockey?._buildNesting === "function") {
            return jockey._buildNesting(el, host);
        }
        return [];
    };

    /**
     * Fragment root layer: nearest ancestor/self with data-part (expects data-part).
     * Path from nearest path on/above that layer.
     */
    const fragmentScope = (nesting) => {
        let partLayer = null;
        for (const layer of nesting) {
            if (layer.parts?.length) {
                partLayer = layer;
                break;
            }
        }
        if (!partLayer && nesting.length) {
            partLayer = nesting[nesting.length - 1];
        }
        if (!partLayer) return null;

        let path = partLayer.path || null;
        if (!path) {
            for (const layer of nesting) {
                if (layer.path) {
                    path = layer.path;
                    break;
                }
            }
        }
        path = originalDataPath(path || "");
        if (!path) return null;
        if (!partLayer.parts?.length) return null;
        return { partLayer, path };
    };

    /**
     * Build tip ib for a scope ending at `leafIndex` in nesting (0 = deepest).
     * Root fragment (leafIndex at/above partLayer) → <path>
     * Deeper → append :<name> and :<tag> for layers from partLayer toward leaf.
     * (htmf / tiny-clone live in frame data.parts, not the tip ib prefix.)
     */
    const tipIbForNesting = (nesting, leafIndex, path) => {
        const frag = fragmentScope(nesting);
        if (!frag && !path) return null;
        const basePath = originalDataPath(path || frag?.path || "");
        if (!basePath) return null;

        const partIdx = frag
            ? nesting.indexOf(frag.partLayer)
            : nesting.length - 1;
        if (partIdx < 0) return basePath;

        // Scope at or shallower than fragment root → base tip only.
        if (leafIndex >= partIdx) {
            return basePath;
        }

        const segments = [basePath];
        // From fragment toward leaf (shallow→deep for rightmost deeper).
        for (let i = partIdx - 1; i >= leafIndex; i--) {
            const layer = nesting[i];
            if (!layer) continue;
            if (layer.name) segments.push(layer.name);
            if (layer.tag) segments.push(layer.tag);
        }
        return segments.join(":");
    };

    const tipIbForContext = (context) => {
        const nesting = nestingOf(context);
        const frag = fragmentScope(nesting);
        if (!frag) return null;
        return tipIbForNesting(nesting, 0, frag.path);
    };

    const ancestorTipIbs = (context) => {
        const nesting = nestingOf(context);
        const frag = fragmentScope(nesting);
        if (!frag) return [];
        const partIdx = nesting.indexOf(frag.partLayer);
        const out = [];
        // From leaf (0) up through fragment root (partIdx)
        for (let i = 0; i <= partIdx; i++) {
            const ib = tipIbForNesting(nesting, i, frag.path);
            if (ib && !out.includes(ib)) {
                out.push({
                    ib,
                    el: nesting[i]?.el || null,
                    leafIndex: i,
                });
            }
        }
        return out;
    };

    const isEditableHtmlContext = (context) => {
        if (hasType(context, "htm-element")) return true;
        if (hasType(context, "htmf") || hasType(context, "html")) return true;
        return false;
    };

    const canTiny = (context) => {
        if (!isEditableHtmlContext(context)) return false;
        if (!resolveSpace()) return false;
        return !!tipIbForContext(context);
    };

    const readIbgibStamp = (el) => {
        if (!(el instanceof HTMLElement)) return "";
        return String(el.getAttribute(ATTR_IBGIB) || "").trim();
    };

    const writeIbgibStamp = (el, addr) => {
        if (!(el instanceof HTMLElement)) return;
        const a = String(addr || "").trim();
        if (!a) {
            el.removeAttribute(ATTR_IBGIB);
            return;
        }
        el.setAttribute(ATTR_IBGIB, a);
    };

    const writeHtmfIbgibStamp = (el, addr) => {
        if (!(el instanceof HTMLElement)) return;
        const a = String(addr || "").trim();
        if (!a) {
            el.removeAttribute(ATTR_HTMF_IBGIB);
            return;
        }
        el.setAttribute(ATTR_HTMF_IBGIB, a);
    };

    /** Nearest data-part=htmf (or html) host for leaf → parent stamp. */
    const htmfHostOf = (el, nesting) => {
        if (Array.isArray(nesting)) {
            for (const layer of nesting) {
                const parts = Array.isArray(layer?.parts) ? layer.parts : [];
                if (
                    parts.includes("htmf") ||
                    parts.includes("html") ||
                    String(layer?.el?.getAttribute?.("data-part") || "")
                        .toLowerCase()
                        .includes("htmf")
                ) {
                    if (layer.el instanceof HTMLElement) return layer.el;
                }
            }
        }
        if (!(el instanceof HTMLElement)) return null;
        try {
            const near = el.closest?.(
                '[data-part*="htmf"], [data-part*="html"]'
            );
            if (near instanceof HTMLElement) return near;
        } catch {
            /* ignore */
        }
        return el;
    };

    const hasStampForContext = (context) => {
        const el = liveElement(context);
        return !!readIbgibStamp(el);
    };

    /** @deprecated use hasStampForContext — kept for callers */
    const tipExistsForContext = async (context) => hasStampForContext(context);

    const findScrollClaim = (modName, claimId) => {
        const plug = navi?.mod?.[modName]?.scrollbufferPlugin;
        const claims = Array.isArray(plug?.claims) ? plug.claims : [];
        return claims.find((c) => c?.id === claimId) || null;
    };

    const dismissUi = (ui) => {
        if (!ui) return;
        try {
            ui.root?.remove();
        } catch {
            /* ignore */
        }
        for (const [type, el, fn, opts] of ui.listeners || []) {
            try {
                el.removeEventListener(type, fn, opts);
            } catch {
                /* ignore */
            }
        }
        ui.listeners = [];
    };

    const pointerOf = (api) => {
        const p = api?.pointer || api?.jockey?._pointer;
        if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
            return { x: p.x, y: p.y };
        }
        return { x: 24, y: 48 };
    };

    const syncPresentation = async (memberEl) => {
        const stage = resolveStage();
        if (!stage || !(memberEl instanceof HTMLElement)) return;
        const prev =
            typeof stage.presentationFor === "function"
                ? stage.presentationFor(memberEl)
                : null;
        scrubOutlinePaint(memberEl);
        const next = {
            ...(prev && typeof prev === "object" ? prev : {}),
            value: memberEl.outerHTML,
        };
        if (!next.type) {
            const stamped = memberEl.getAttribute("data-part");
            if (stamped) next.type = String(stamped).toLowerCase();
        }
        const path = memberEl.getAttribute("data-path");
        if (path && !next.path) next.path = path;
        if (typeof stage.rememberPresentation === "function") {
            stage.rememberPresentation(memberEl, next);
        }
        if (typeof stage.persist === "function") {
            await stage.persist();
        }
    };

    /**
     * Stagejockey paints via inline outline; outerHTML must not bake that in.
     * Clear paint on el (+ optional subtree) before reading / after swap.
     */
    const scrubOutlinePaint = (root, { deep = false } = {}) => {
        if (!(root instanceof HTMLElement)) return;
        const nodes = deep
            ? [root, ...Array.from(root.querySelectorAll("*"))]
            : [root];
        for (const el of nodes) {
            if (!(el instanceof HTMLElement) || !el.style) continue;
            if (el.style.outline) el.style.outline = "";
            if (el.style.outlineOffset) el.style.outlineOffset = "";
        }
    };

    const clearJockeySelectPaint = (api) => {
        if (typeof api?.terminate === "function") {
            api.terminate();
            return;
        }
        const jockey = resolveJockey();
        if (!jockey) return;
        jockey.select = null;
        jockey.hover = null;
        if (typeof jockey._clearOutlines === "function") jockey._clearOutlines();
        else if (typeof jockey._paint === "function") jockey._paint();
    };

    /** outerHTML after scrubbing jockey outline paint on that node. */
    const liveOuterHtml = (el) => {
        if (!(el instanceof HTMLElement)) return "";
        scrubOutlinePaint(el);
        return el.outerHTML;
    };

    const swapElementHtml = (el, html) => {
        if (!(el instanceof HTMLElement)) {
            throw new Error("no live element to swap");
        }
        const tpl = document.createElement("template");
        tpl.innerHTML = String(html || "").trim();
        const next = tpl.content.firstElementChild;
        if (!next) throw new Error("edited HTML has no root element");
        scrubOutlinePaint(next, { deep: true });
        el.replaceWith(next);
        return next;
    };

    /** Rebuild <script> tags + htmx.process so hx-* binds after DOM swap. */
    const activateLiveHtml = (el) => {
        if (!(el instanceof HTMLElement)) return;
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
                console.error("[jockey_tiny] htmx.process failed", err);
            }
        }
    };

    const loadTipHtml = async (space, ib) => {
        for (const candidate of tipIbCandidates(ib)) {
            const tipAddr = await space.tip(candidate);
            if (!tipAddr) continue;
            const frame = await space.get(tipAddr);
            if (!frame) continue;
            const html = frame?.data?.html;
            if (html == null) continue;
            return {
                tipAddr,
                frame,
                html: String(html),
                ib: candidate,
            };
        }
        return null;
    };

    const loadFrameHtml = async (space, addr) => {
        const tipAddr = String(addr || "").trim();
        if (!tipAddr) return null;
        const frame = await space.get(tipAddr);
        if (!frame) return null;
        const html = frame?.data?.html;
        if (html == null) return null;
        const ib = String(frame.ib || tipAddr.split("^")[0] || "");
        return { tipAddr, frame, html: String(html), ib };
    };

    /** Always create a new tip genesis (re-points tip). Does not mut8. */
    const createFreshTip = async (space, ib, html, source, dataPath, opts = {}) => {
        const data = {
            parts: [...FRAME_PARTS],
            html: String(html || ""),
            data_path: originalDataPath(dataPath),
            source: source || "live",
        };
        // Durable parent claim for viewport (which htmf frame this leaf forked from).
        const htmfIbgib = String(opts.htmfIbgib || "").trim();
        if (htmfIbgib) data.htmf_ibgib = htmfIbgib;
        const created = await space.create({
            ib,
            data,
        });
        return {
            tipAddr: created.addr,
            frame: created.ibGib,
            html: String(html || ""),
            ib,
        };
    };

    const ensureTip = async (space, ib, html, source, dataPath, opts = {}) => {
        if (opts.forceFresh) {
            return createFreshTip(
                space,
                tipIbForDataPath(ib) || ib,
                html,
                source,
                dataPath,
                opts
            );
        }
        const resolvedIb = await resolveTipIb(space, ib);
        const existing = await loadTipHtml(space, resolvedIb);
        if (existing) return existing;
        return createFreshTip(
            space,
            tipIbForDataPath(ib) || resolvedIb || ib,
            html,
            source,
            dataPath,
            opts
        );
    };

    const stampAfterCommit = (element, leafAddr, nesting, host) => {
        if (!(element instanceof HTMLElement)) return;
        writeIbgibStamp(element, leafAddr);
        const htmf = htmfHostOf(element, nesting) || host;
        if (htmf instanceof HTMLElement && htmf !== element) {
            const parentAddr = readIbgibStamp(htmf);
            if (parentAddr) writeHtmfIbgibStamp(element, parentAddr);
        }
        // Root htmf edit: stamp is on the host itself (already written above).
    };

    const mut8Tip = async (space, tipAddr, html, dataPath, opts = {}) => {
        const cascadeOf = opts.cascadeOf ? String(opts.cascadeOf) : "";
        // Cascade snapshots must not move the parent tip (parallel to direct mut8 past).
        const updateTip = cascadeOf ? false : opts.updateTip !== false;
        // Let space nCounter own `n` — do not also patch n (that made odd-only labels).
        const patch = {
            html: String(html || ""),
            source: cascadeOf ? "cascade" : "edit",
            data_path: originalDataPath(dataPath),
            parts: [...FRAME_PARTS],
        };
        const htmfIbgib = String(opts.htmfIbgib || "").trim();
        if (htmfIbgib) patch.htmf_ibgib = htmfIbgib;
        const out = await space.mut8(tipAddr, patch, undefined, { updateTip });
        if (cascadeOf && typeof space.rel8 === "function") {
            return space.rel8(
                out.addr,
                {
                    cascade_of: [cascadeOf],
                    // Open lineage claim: forked from this tip, not authoring it.
                    mutation_of: [String(tipAddr)],
                },
                { updateTip: false }
            );
        }
        return out;
    };

    /**
     * Ensure tips for current scope + ancestors. Stamps each live element.
     * opts.forceFresh: leaf always createFresh (new branch); ancestors ensure
     * only if tip missing, and stamp if unstamped.
     */
    const ensureAncestryTips = async (space, context, source, opts = {}) => {
        const nesting = nestingOf(context);
        const frag = fragmentScope(nesting);
        if (!frag) throw new Error("no data-part fragment with data-path");
        const chain = ancestorTipIbs(context);
        // Shallow → deep so parent stamps exist before leaf data-htmf-ibgib.
        const ordered = [...chain].sort((a, b) => b.leafIndex - a.leafIndex);
        const out = [];
        for (const item of ordered) {
            const html =
                item.el instanceof HTMLElement
                    ? liveOuterHtml(item.el)
                    : liveOuterHtml(liveElement(context));
            const isLeaf = item.leafIndex === 0;
            let tip = null;
            if (opts.forceFresh && isLeaf) {
                // Parent stamps already written (shallow→deep); record which htmf.
                let htmfIbgib = "";
                if (item.el instanceof HTMLElement) {
                    const host = htmfHostOf(item.el, nesting);
                    if (host && host !== item.el) {
                        htmfIbgib = readIbgibStamp(host);
                    }
                }
                tip = await createFreshTip(
                    space,
                    item.ib,
                    html,
                    source || "live",
                    frag.path,
                    { htmfIbgib }
                );
            } else {
                tip = await ensureTip(
                    space,
                    item.ib,
                    html,
                    source || "live",
                    frag.path
                );
            }
            if (item.el instanceof HTMLElement && tip?.tipAddr) {
                writeIbgibStamp(item.el, tip.tipAddr);
            }
            out.push({ ...item, ...tip });
        }
        const leaf =
            out.find((x) => x.leafIndex === 0) || out[out.length - 1];
        if (leaf?.el instanceof HTMLElement) {
            const host = htmfHostOf(leaf.el, nesting);
            if (host && host !== leaf.el) {
                const parentAddr = readIbgibStamp(host);
                if (parentAddr) writeHtmfIbgibStamp(leaf.el, parentAddr);
            }
        }
        return { chain: out, frag };
    };

    /**
     * Ensure missing parent tips from live outerHTML (create only).
     * Does not mut8 existing parent tips — that would pollute direct past with cascades.
     */
    const cascadeParentsFromLive = async (space, context) => {
        const nesting = nestingOf(context);
        const frag = fragmentScope(nesting);
        if (!frag) return;
        const partIdx = nesting.indexOf(frag.partLayer);
        for (let i = 1; i <= partIdx; i++) {
            const ib = tipIbForNesting(nesting, i, frag.path);
            if (!ib) continue;
            const pel = nesting[i]?.el;
            if (!(pel instanceof HTMLElement)) continue;
            const html = liveOuterHtml(pel);
            const tip = await loadTipHtml(space, ib);
            if (!tip) {
                await ensureTip(space, ib, html, "live", frag.path);
            }
        }
    };

    /**
     * Mechanical tiny-edit save: mut8 leaf from live outerHTML → cascade parent
     * *snapshots* (non-tip; cascade_of → leaf, mutation_of → parent tip).
     * No editor UI.
     */
    const commitLiveScope = async ({
        space,
        tipIb,
        tipAddr,
        dataPath,
        element,
        hostElement,
        nesting,
        api,
        skipMut8 = false,
    }) => {
        if (!tipAddr) throw new Error("no tip addr");
        if (!(element instanceof HTMLElement)) {
            throw new Error("live element gone");
        }

        let currentNesting = Array.isArray(nesting) ? nesting : [];
        const host =
            hostElement instanceof HTMLElement &&
            document.contains(hostElement)
                ? hostElement
                : element;
        const jockey = resolveJockey();
        if (typeof jockey?._buildNesting === "function") {
            currentNesting = jockey._buildNesting(element, host);
        }

        let leafAddr = String(tipAddr);
        const hostStamp =
            host instanceof HTMLElement ? readIbgibStamp(host) : "";
        if (!skipMut8) {
            const leafOut = await mut8Tip(
                space,
                tipAddr,
                liveOuterHtml(element),
                dataPath,
                hostStamp && host !== element ? { htmfIbgib: hostStamp } : {}
            );
            leafAddr = String(leafOut?.addr || tipAddr);
        }
        stampAfterCommit(element, leafAddr, currentNesting, host);

        const frag = fragmentScope(currentNesting);
        const partIdx = frag
            ? currentNesting.indexOf(frag.partLayer)
            : -1;
        for (let i = 1; i <= partIdx; i++) {
            const ib = tipIbForNesting(
                currentNesting,
                i,
                frag?.path || dataPath
            );
            if (!ib) continue;
            const pel = currentNesting[i]?.el;
            if (!(pel instanceof HTMLElement)) continue;
            const parentHtml = liveOuterHtml(pel);
            let parentTip = null;
            const parentStamp = readIbgibStamp(pel);
            if (parentStamp) {
                parentTip = await loadFrameHtml(space, parentStamp);
            }
            if (!parentTip) {
                parentTip = await loadTipHtml(space, ib);
            }
            if (!parentTip) {
                // Genesis tip = live snapshot (direct line). Cascade is a separate non-tip frame.
                parentTip = await ensureTip(
                    space,
                    ib,
                    parentHtml,
                    "edit",
                    frag?.path || dataPath
                );
                writeIbgibStamp(pel, parentTip.tipAddr);
            }
            await mut8Tip(
                space,
                parentTip.tipAddr,
                parentHtml,
                frag?.path || dataPath,
                { cascadeOf: leafAddr }
            );
            // Parent tip does not move on cascade; keep parent stamp on tip addr.
        }

        // Refresh leaf → htmf stamp after parent stamps settled.
        if (frag?.partLayer?.el instanceof HTMLElement && element !== frag.partLayer.el) {
            const parentAddr = readIbgibStamp(frag.partLayer.el);
            if (parentAddr) writeHtmfIbgibStamp(element, parentAddr);
        }

        const rootIb = tipIbForDataPath(dataPath);
        if (tipIb === rootIb && host instanceof HTMLElement) {
            const curPath = host.getAttribute("data-path") || "";
            if (
                !String(curPath).startsWith(NAVI_PREFIX) &&
                originalDataPath(curPath) === originalDataPath(dataPath)
            ) {
                host.setAttribute("data-path", rewrittenAttr(dataPath));
            }
        }

        await syncPresentation(host);

        // Do not rebind/repaint stagejockey select — that would leave
        // a permanent-looking red/green box after the edit finishes.
        if (jockey) {
            jockey.select = null;
            jockey.hover = null;
            if (typeof jockey._clearOutlines === "function") {
                jockey._clearOutlines();
            } else {
                jockey._paint?.();
            }
        }

        if (typeof navi.callout === "function") {
            navi.callout(`[jockey_tiny] mut8 ${tipIb} → ${leafAddr}`);
        }

        return { tipIb, leafAddr, element, host };
    };

    /**
     * Silent tiny-init/edit commit for the current select scope.
     * No data-ibgib → forceFresh create from live + stamp (new branch).
     * Has stamp → mut8 from stamped addr + replace stamp.
     */
    const persistLiveEdit = async (context, api, opts = {}) => {
        const space = resolveSpace();
        if (!space) throw new Error("tiny_ibgib_space not mounted");

        const nesting = nestingOf(context);
        const frag = fragmentScope(nesting);
        if (!frag) {
            throw new Error(
                "need data-part fragment with data-path (jockey expects data-part)"
            );
        }

        const el = liveElement(context);
        if (!el) throw new Error("no live element");

        const tipIb = tipIbForContext(context);
        if (!tipIb) throw new Error("could not derive tip ib");

        clearJockeySelectPaint(api);

        const stamp = readIbgibStamp(el);
        let inited = false;
        let tipAddr = stamp;

        if (!stamp) {
            if (opts.initIfMissing === false) {
                throw new Error(`no data-ibgib — run tiny-init first (${tipIb})`);
            }
            const ensured = await ensureAncestryTips(space, context, "live", {
                forceFresh: true,
            });
            const leaf =
                ensured.chain.find((x) => x.leafIndex === 0) ||
                ensured.chain[ensured.chain.length - 1];
            tipAddr = leaf?.tipAddr || "";
            if (!tipAddr) {
                throw new Error(`tiny-init failed — no tip after create (${tipIb})`);
            }
            inited = true;
            if (typeof navi.callout === "function") {
                navi.callout(`[jockey_tiny] tiny-init ${tipIb} → ${tipAddr}`);
            }
            // Fresh create already holds live HTML; still cascade parent snapshots.
            await commitLiveScope({
                space,
                tipIb,
                tipAddr,
                dataPath: frag.path,
                element: el,
                hostElement: hostMember(context),
                nesting,
                api,
                skipMut8: true,
            });
            return {
                tipIb,
                leafAddr: tipAddr,
                element: el,
                host: hostMember(context),
                inited,
            };
        }

        const stamped = await loadFrameHtml(space, stamp);
        if (!stamped) {
            throw new Error(`data-ibgib frame missing: ${stamp}`);
        }

        const out = await commitLiveScope({
            space,
            tipIb,
            tipAddr: stamped.tipAddr,
            dataPath: frag.path,
            element: el,
            hostElement: hostMember(context),
            nesting,
            api,
        });
        return { ...out, inited };
    };

    /**
     * Walk past rel8ns from tipAddr → genesis. Returns oldest→newest.
     */
    const loadTipHistory = async (space, tipAddr) => {
        const versions = [];
        let addr = String(tipAddr || "").trim();
        const seen = new Set();
        while (addr && !seen.has(addr)) {
            seen.add(addr);
            const frame = await space.get(addr);
            if (!frame) break;
            versions.push({
                addr,
                html: String(frame?.data?.html ?? ""),
                frame,
            });
            const past = frame?.rel8ns?.past;
            const prev = Array.isArray(past) && past[0] ? String(past[0]) : "";
            addr = prev;
        }
        versions.reverse();
        return versions;
    };

    const resolveSnoopUrl = async (dataPath) => {
        const path = originalDataPath(dataPath);
        const snoopy = resolveSnoopy();
        if (snoopy && typeof snoopy.findByRoute === "function") {
            try {
                const hit = await snoopy.findByRoute(path, 0);
                const rec = hit?.record;
                if (rec?.url) return String(rec.url);
                if (rec?.route) {
                    const r = String(rec.route).replace(/^\/+/, "");
                    if (typeof navi.resolveUrl === "function") {
                        return navi.resolveUrl(r);
                    }
                    return `/${r}`;
                }
            } catch {
                /* fall through */
            }
        }
        if (snoopy && typeof snoopy.get === "function") {
            try {
                const tipOrRec = await snoopy.get(path);
                const rec =
                    tipOrRec &&
                    typeof snoopy.observationFromFrame === "function" &&
                    tipOrRec.data
                        ? snoopy.observationFromFrame(tipOrRec)
                        : tipOrRec;
                if (rec?.url) return String(rec.url);
                if (rec?.route) {
                    const r = String(rec.route).replace(/^\/+/, "");
                    if (typeof navi.resolveUrl === "function") {
                        return navi.resolveUrl(r);
                    }
                    return `/${r}`;
                }
            } catch {
                /* fall through */
            }
        }
        if (typeof navi.resolveUrl === "function") {
            return navi.resolveUrl(path);
        }
        return `/${path}`;
    };

    const fetchBody = async (url) => {
        const res = await fetch(url, { credentials: "same-origin" });
        const text = await res.text();
        if (!res.ok) {
            throw new Error(
                `fetch ${url} → ${res.status}: ${text.slice(0, 120)}`
            );
        }
        return text;
    };

    const openEditor = ({
        initialHtml,
        tipAddr,
        tipIb,
        dataPath,
        element,
        hostElement,
        nesting,
        api,
        space,
        versions = null,
        saveMode = "edit",
    }) =>
        new Promise((resolve) => {
            if (typeof document === "undefined") {
                resolve(undefined);
                return;
            }

            const ui = { listeners: [] };
            const pt = pointerOf(api);

            const root = document.createElement("div");
            root.setAttribute("data-jockey-ui", "jockey-tiny");
            root.setAttribute("name", "jockey-tiny-edit");
            root.style.cssText = [
                "position:fixed",
                "z-index:2147483646",
                "pointer-events:auto",
                "font:600 12px/1.2 monospace",
                "transition:opacity 3s ease",
                "opacity:1",
                "min-width:20rem",
                "max-width:min(90vw,48rem)",
                "background:transparent",
            ].join(";");
            root.style.left = `${pt.x + 16}px`;
            root.style.top = `${pt.y - 8}px`;
            root.style.transform = "translateY(-100%)";

            const fieldCss = [
                "display:block",
                "width:100%",
                "box-sizing:border-box",
                "margin:0",
                "padding:6px 8px",
                "border:3px solid limegreen",
                "border-radius:0",
                "outline:none",
                "box-shadow:none",
                "background:#111",
                "color:#eee",
                "font:inherit",
            ].join(";");

            const header = document.createElement("div");
            header.style.cssText =
                fieldCss +
                ";border-bottom:0;display:flex;align-items:center;gap:8px;color:limegreen";

            const label = document.createElement("div");
            label.textContent = tipIb;
            label.title = tipIb;
            label.style.cssText =
                "flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";

            const pager = document.createElement("div");
            pager.style.cssText =
                "flex:none;display:flex;align-items:center;gap:0;user-select:none;color:limegreen";

            header.appendChild(label);
            header.appendChild(pager);

            const textArea = document.createElement("textarea");
            textArea.value = String(initialHtml || "");
            textArea.rows = 10;
            textArea.spellcheck = false;
            textArea.style.cssText =
                fieldCss + ";resize:both;min-height:8rem;max-height:70vh";

            const status = document.createElement("div");
            status.style.cssText = [
                "display:none",
                "padding:6px 8px",
                "background:transparent",
                "color:#fff",
                "text-shadow:0 1px 2px #000, 0 0 1px #000",
                "white-space:nowrap",
                "font:inherit",
            ].join(";");

            root.appendChild(header);
            root.appendChild(textArea);
            root.appendChild(status);
            document.body.appendChild(root);

            let settled = false;
            // Edit/snoop: mut8 stamped addr. Init: createFresh on Enter.
            const saveTipAddr = tipAddr;
            let currentEl = element;
            let currentNesting = nesting;

            const history =
                Array.isArray(versions) && versions.length
                    ? versions
                    : tipAddr
                      ? [
                            {
                                addr: tipAddr,
                                html: String(initialHtml || ""),
                            },
                        ]
                      : [];
            let pageIndex = Math.max(0, history.length - 1);

            const pagerBtnCss =
                "appearance:none;border:0;background:transparent;color:limegreen;font:inherit;cursor:pointer;padding:0 2px;line-height:1";

            const renderPager = () => {
                pager.replaceChildren();
                const n = history.length;
                if (!n) {
                    const only = document.createElement("span");
                    only.textContent = "<new>";
                    pager.appendChild(only);
                    return;
                }
                const i = pageIndex + 1;
                if (n <= 1) {
                    const only = document.createElement("span");
                    only.textContent = `<${i}>`;
                    pager.appendChild(only);
                    return;
                }
                if (pageIndex > 0) {
                    const left = document.createElement("button");
                    left.type = "button";
                    left.textContent = "<";
                    left.title = "older version";
                    left.style.cssText = pagerBtnCss;
                    left.addEventListener("click", (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (pageIndex <= 0) return;
                        pageIndex -= 1;
                        textArea.value = String(
                            history[pageIndex]?.html ?? ""
                        );
                        renderPager();
                    });
                    pager.appendChild(left);
                }
                const num = document.createElement("span");
                num.textContent = String(i);
                pager.appendChild(num);
                if (pageIndex < n - 1) {
                    const right = document.createElement("button");
                    right.type = "button";
                    right.textContent = ">";
                    right.title = "newer version";
                    right.style.cssText = pagerBtnCss;
                    right.addEventListener("click", (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (pageIndex >= history.length - 1) return;
                        pageIndex += 1;
                        textArea.value = String(
                            history[pageIndex]?.html ?? ""
                        );
                        renderPager();
                    });
                    pager.appendChild(right);
                }
            };
            renderPager();

            const finish = () => {
                if (settled) return;
                settled = true;
                dismissUi(ui);
                resolve(undefined);
            };

            const showStatus = (text, color) => {
                textArea.style.display = "none";
                header.style.display = "none";
                status.style.display = "block";
                status.textContent = text;
                status.style.color = color;
            };

            const fadeAndFinish = () => {
                root.style.opacity = "0";
                setTimeout(() => finish(), 1200);
            };

            const submit = async () => {
                if (settled) return;
                const html = String(textArea.value || "");
                textArea.disabled = true;
                showStatus("saving…", "#fff");
                try {
                    if (!(currentEl instanceof HTMLElement)) {
                        throw new Error("live element gone");
                    }

                    const next = swapElementHtml(currentEl, html);
                    currentEl = next;
                    activateLiveHtml(next);

                    const host =
                        hostElement instanceof HTMLElement &&
                        document.contains(hostElement)
                            ? hostElement
                            : next;
                    const jockey = resolveJockey();
                    if (typeof jockey?._buildNesting === "function") {
                        currentNesting = jockey._buildNesting(next, host);
                    }

                    let addr = saveTipAddr;
                    let skipMut8 = false;
                    if (saveMode === "init" || !addr) {
                        await ensureAncestryTips(
                            space,
                            {
                                element: currentEl,
                                hostElement: host,
                                nesting: currentNesting,
                            },
                            "live",
                            { forceFresh: true }
                        );
                        addr = readIbgibStamp(currentEl);
                        if (!addr) {
                            const created = await createFreshTip(
                                space,
                                tipIb,
                                liveOuterHtml(currentEl),
                                "live",
                                dataPath
                            );
                            addr = created.tipAddr;
                            writeIbgibStamp(currentEl, addr);
                        }
                        skipMut8 = true;
                    }

                    await commitLiveScope({
                        space,
                        tipIb,
                        tipAddr: addr,
                        dataPath,
                        element: currentEl,
                        hostElement: host,
                        nesting: currentNesting,
                        api,
                        skipMut8,
                    });
                    showStatus("ok!", "#0f0");
                } catch (err) {
                    console.error("[jockey_tiny]", err);
                    showStatus(String(err.message || err), "#f66");
                    if (typeof navi.callout === "function") {
                        navi.callout(`[jockey_tiny] ${err.message || err}`);
                    }
                }
                fadeAndFinish();
            };

            const onKey = (e) => {
                if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    finish();
                    return;
                }
                if (e.key === "Enter") {
                    if (e.shiftKey) return;
                    e.preventDefault();
                    e.stopPropagation();
                    void submit();
                }
            };
            textArea.addEventListener("keydown", onKey);
            ui.listeners.push(["keydown", textArea, onKey, false]);

            const onDoc = (e) => {
                if (settled) return;
                if (root.contains(e.target)) return;
                finish();
            };
            setTimeout(() => {
                document.addEventListener("mousedown", onDoc, true);
                ui.listeners.push(["mousedown", document, onDoc, true]);
            }, 0);

            ui.root = root;
            textArea.focus();
            try {
                textArea.setSelectionRange(0, 0);
            } catch {
                /* ignore */
            }
        });

    const runEditorFlow = async (context, api, { mode }) => {
        const space = resolveSpace();
        if (!space) throw new Error("tiny_ibgib_space not mounted");

        const nesting = nestingOf(context);
        const frag = fragmentScope(nesting);
        if (!frag) {
            throw new Error(
                "need data-part fragment with data-path (jockey expects data-part)"
            );
        }

        const el = liveElement(context);
        if (!el) throw new Error("no live element");

        const tipIb = tipIbForContext(context);
        if (!tipIb) throw new Error("could not derive tip ib");

        // Drop red/green paint BEFORE any outerHTML capture (tips / editor).
        clearJockeySelectPaint(api);

        let tipState = null;
        /** @type {string|null} wire body for tiny-from-snoop (not live DOM) */
        let snoopHtml = null;
        const stamp = readIbgibStamp(el);

        if (mode === "edit") {
            if (!stamp) {
                throw new Error(`no data-ibgib — run tiny-init first (${tipIb})`);
            }
            tipState = await loadFrameHtml(space, stamp);
            if (!tipState) {
                throw new Error(`data-ibgib frame missing: ${stamp}`);
            }
            await cascadeParentsFromLive(space, context);
        } else if (mode === "snoop") {
            const url = await resolveSnoopUrl(frag.path);
            snoopHtml = await fetchBody(url);
            if (stamp) {
                tipState = await loadFrameHtml(space, stamp);
            }
            if (!tipState) {
                tipState = await createFreshTip(
                    space,
                    tipIb,
                    snoopHtml,
                    "snoop_refetch",
                    frag.path
                );
                writeIbgibStamp(el, tipState.tipAddr);
            }
            await ensureAncestryTips(space, context, "live");
            tipState =
                (stamp
                    ? await loadFrameHtml(space, readIbgibStamp(el))
                    : null) ||
                (await loadTipHtml(space, tipIb)) ||
                tipState;
            if (!tipState) {
                throw new Error(`tiny-from-snoop failed — no tip (${tipIb})`);
            }
        } else {
            // tiny-init: defer createFresh until Enter (Escape leaves no stamp).
            tipState = null;
            await cascadeParentsFromLive(space, context);
        }

        // Edit/init: live outerHTML. Snoop: wire body from the request.
        const initialHtml =
            mode === "snoop" && snoopHtml != null
                ? snoopHtml
                : liveOuterHtml(el);
        const versions =
            mode === "edit" && tipState
                ? await loadTipHistory(space, tipState.tipAddr)
                : null;

        await openEditor({
            initialHtml,
            tipAddr: tipState?.tipAddr || "",
            tipIb,
            dataPath: frag.path,
            element: el,
            hostElement: hostMember(context),
            nesting,
            api,
            space,
            versions,
            saveMode: mode === "init" ? "init" : "edit",
        });
        return undefined;
    };

    const dataPathOfContext = (context) => {
        const fromCtx = originalDataPath(
            context?.path || context?.dataPath || context?.presentation?.path || ""
        );
        if (fromCtx) return fromCtx;
        const nesting = nestingOf(context);
        const frag = fragmentScope(nesting);
        if (frag?.path) return frag.path;
        const el = context?.element || context?.hostElement;
        if (el instanceof HTMLElement) {
            const stamped = originalDataPath(el.getAttribute("data-path") || "");
            if (stamped) return stamped;
            try {
                const near = el.closest?.("[data-path]");
                const p = originalDataPath(near?.getAttribute?.("data-path") || "");
                if (p) return p;
            } catch {
                /* ignore */
            }
        }
        return "";
    };

    const withNaviBase = (raw) => {
        const s = String(raw ?? "").trim();
        if (!s) return s;
        if (
            s.startsWith("#") ||
            s.startsWith("mailto:") ||
            s.startsWith("javascript:") ||
            s.startsWith("data:") ||
            s.startsWith("navi:") ||
            s.startsWith("mod:") ||
            /^[a-z][a-z0-9+.-]*:/i.test(s)
        ) {
            return s;
        }
        if (s === "/navi" || s.startsWith("/navi/") || s.startsWith("/navi?")) {
            return s;
        }
        if (s.startsWith("/")) return `/navi${s}`;
        return `/navi/${s}`;
    };

    const applyNaviBaseToAnchor = (a) => {
        let changed = 0;
        for (const attr of PATH_ATTRS) {
            if (!a.hasAttribute(attr)) continue;
            const prev = a.getAttribute(attr);
            const next = withNaviBase(prev);
            if (next !== prev) {
                a.setAttribute(attr, next);
                changed++;
            }
        }
        return changed;
    };

    const reprocessHtmx = (el) => {
        const htmxApi = globalThis.htmx;
        if (
            !(el instanceof HTMLElement) ||
            !htmxApi ||
            typeof htmxApi.process !== "function"
        ) {
            return false;
        }
        try {
            htmxApi.process(el);
            return true;
        } catch (err) {
            console.error("[jockey_tiny] htmx.process failed", err);
            return false;
        }
    };

    const liveAnchor = (context) => {
        const el = context?.element;
        if (!(el instanceof HTMLElement)) return null;
        if (String(el.tagName || "").toLowerCase() === "a") return el;
        return null;
    };

    const isContentfulFrame = (frame) => {
        if (!frame || typeof frame !== "object") return false;
        const d = frame.data;
        if (d == null || typeof d !== "object") return false;
        return d.html != null;
    };

    const loadOrientIndex = async () => {
        const file = navi?.storage?.file;
        if (!file || typeof file.get !== "function") return {};
        try {
            const entry = await file.get(ORIENT_INDEX_KEY);
            const raw = entry?.media;
            if (raw == null || raw === "") return {};
            const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
            return parsed && typeof parsed === "object" ? parsed : {};
        } catch {
            return {};
        }
    };

    const saveOrientIndex = async (index) => {
        const file = navi?.storage?.file;
        if (!file || typeof file.save !== "function") {
            throw new Error("navi.storage.file unavailable");
        }
        await file.save(ORIENT_INDEX_KEY, {
            media: JSON.stringify(index || {}),
            mime: "application/json; charset=utf-8",
        });
    };

    const upsertOrient = async ({ dataPath, addr, tipIb, frame }) => {
        const path = originalDataPath(dataPath);
        if (!path) throw new Error("orient needs data-path");
        const index = await loadOrientIndex();
        index[path] = {
            addr: String(addr || ""),
            tipIb: String(tipIb || path),
            n: Number(frame?.data?.n || 0),
            at: new Date().toISOString(),
        };
        await saveOrientIndex(index);
        return index[path];
    };

    const removeOrient = async (raw) => {
        const key = String(raw || "").trim();
        if (!key) throw new Error("orient rm needs path or addr");
        const index = await loadOrientIndex();
        const pathKey = originalDataPath(key);
        let removed = null;
        if (index[pathKey]) {
            removed = index[pathKey];
            delete index[pathKey];
        } else {
            for (const [p, ent] of Object.entries(index)) {
                if (ent?.addr === key) {
                    removed = ent;
                    delete index[p];
                    break;
                }
            }
        }
        if (!removed) throw new Error(`orient not found: ${key}`);
        await saveOrientIndex(index);
        return removed;
    };

    const listOrients = async () => {
        const index = await loadOrientIndex();
        return Object.entries(index).map(([path, ent]) => ({
            path,
            ...(ent && typeof ent === "object" ? ent : {}),
        }));
    };

    /** Publish frame HTML to storage.file + orient index. */
    const orientFrame = async ({ dataPath, addr, tipIb, html, frame }) => {
        const path = originalDataPath(dataPath);
        if (!path) throw new Error("orient needs data-path");
        if (!navi?.storage?.file?.save) {
            throw new Error("navi.storage.file.save unavailable");
        }
        const body = html != null ? String(html) : String(frame?.data?.html ?? "");
        await navi.storage.file.save(path, {
            media: body,
            mime: "text/html; charset=utf-8",
        });
        const entry = await upsertOrient({
            dataPath: path,
            addr,
            tipIb: tipIb || path,
            frame,
        });
        return { path, addr, entry, html: body };
    };

    const htmfElementOf = (context) => {
        const el = liveElement(context) || hostMember(context);
        if (!(el instanceof HTMLElement)) return null;
        const part = String(el.getAttribute("data-part") || "").toLowerCase();
        if (part.includes("htmf") || part.includes("html")) return el;
        try {
            const near = el.closest?.('[data-part*="htmf"], [data-part*="html"]');
            if (near instanceof HTMLElement) return near;
        } catch {
            /* ignore */
        }
        return el;
    };

    const runTinyOrientClaim = async (context, api) => {
        const space = resolveSpace();
        if (!space) throw new Error("tiny_ibgib_space not mounted");
        const host = htmfElementOf(context);
        if (!(host instanceof HTMLElement)) {
            throw new Error("tiny-orient needs an htmf element");
        }
        const dataPath = dataPathOfContext({
            ...context,
            element: host,
            hostElement: host,
        });
        if (!dataPath) throw new Error("htmf has no data-path");
        const tipIb = await resolveTipIb(space, dataPath);

        clearJockeySelectPaint(api);

        let addr = readIbgibStamp(host);
        let frame = null;
        let html = "";

        if (!addr) {
            await ensureAncestryTips(
                space,
                { ...context, element: host, hostElement: host },
                "live",
                { forceFresh: true }
            );
            addr = readIbgibStamp(host);
            if (!addr) {
                const created = await createFreshTip(
                    space,
                    tipIb,
                    liveOuterHtml(host),
                    "live",
                    dataPath
                );
                addr = created.tipAddr;
                writeIbgibStamp(host, addr);
                frame = created.frame;
                html = created.html;
            }
            await syncPresentation(host);
        }

        if (!frame) {
            const loaded = await loadFrameHtml(space, addr);
            if (!loaded) throw new Error(`frame missing for ${addr}`);
            frame = loaded.frame;
            html = loaded.html;
            addr = loaded.tipAddr;
        }

        const out = await orientFrame({
            dataPath,
            addr,
            tipIb,
            html,
            frame,
        });
        const msg = `[jockey_tiny] tiny-orient ${out.path} ← ${addr}`;
        if (typeof navi.callout === "function") navi.callout(msg);
        else console.log(msg);
        if (typeof api?.terminate === "function") api.terminate();
        return out;
    };

    const listContentfulVersions = async (space, tipIb) => {
        const resolved = await resolveTipIb(space, tipIb);
        const tipAddr = resolved ? await space.tip(resolved) : null;
        if (!tipAddr) return [];
        const history = await loadTipHistory(space, tipAddr);
        return history.filter((v) => isContentfulFrame(v.frame));
    };

    const resolvePathOrAddr = async (space, raw) => {
        const s = String(raw || "").trim();
        if (!s) throw new Error("empty path/addr");
        if (s.includes("^")) {
            const frame = await space.get(s);
            if (!frame) throw new Error(`unknown addr ${s}`);
            const ib = String(frame.ib || s.split("^")[0] || "");
            const dataPath = originalDataPath(
                frame?.data?.data_path ||
                    (pathFromTipIb(ib) || "")
            );
            return {
                addr: s,
                tipIb: ib,
                dataPath,
                frame,
                html: String(frame?.data?.html ?? ""),
                versions: isContentfulFrame(frame)
                    ? [
                          {
                              addr: s,
                              n: Number(frame?.data?.n || 0),
                              frame,
                              html: String(frame?.data?.html ?? ""),
                          },
                      ]
                    : [],
            };
        }
        const dataPath = originalDataPath(s);
        const tipIb = (await resolveTipIb(space, dataPath)) || tipIbForDataPath(dataPath);
        const versions = await listContentfulVersions(space, tipIb);
        return { addr: "", tipIb, dataPath, frame: null, html: "", versions };
    };

    const runStageFromHtml = async (addApi, { html, path, label }) => {
        const stagemaker = findScrollClaim("stage_casting", "stagemaker");
        if (!stagemaker) {
            throw new Error("stage_casting (stagemaker) not mounted");
        }
        const move = findScrollClaim("jockey_move", "move");
        if (!move) throw new Error("jockey_move not mounted");
        const body = String(html || "");
        const htmlCtx = {
            types: ["htmf"],
            kind: "htmf",
            part: "htmf",
            label: label || `stage-tiny ${path}`,
            html: body,
            value: body,
            presentation: { type: "htmf", value: body, path },
            path,
            href: path,
        };
        const offstage = await stagemaker.execute(htmlCtx, addApi);
        if (!offstage) return undefined;
        return move.execute(offstage, addApi);
    };

    const activateTinyDualField = (row, menuApi, addApi, opts) => {
        const { flag, label, mode, logTag } = opts;
        if (!row || row.dataset[flag] === "1") return;
        row.dataset[flag] = "1";
        row.classList.add("smd-input-row");
        row.textContent = "";

        const wrap = document.createElement("div");
        wrap.style.cssText =
            "display:flex;gap:4px;align-items:center;width:100%;box-sizing:border-box";

        const select = document.createElement("select");
        select.setAttribute("aria-label", "tiny frame index");
        select.style.cssText =
            "flex:0 0 auto;min-width:3.5rem;padding:2px 4px;border:1px inset #f0f0f0;background:white;font-family:monospace;font-size:12px";
        const emptyOpt = document.createElement("option");
        emptyOpt.value = "";
        emptyOpt.textContent = "—";
        select.appendChild(emptyOpt);

        const input = document.createElement("input");
        input.placeholder = "path or ib^gib";
        input.setAttribute("aria-label", "tiny path or addr");
        input.style.cssText =
            "flex:1;min-width:0;padding:2px 4px;border:1px inset #f0f0f0;background:white;font-family:monospace;font-size:12px;outline:none;box-sizing:border-box";

        wrap.appendChild(select);
        wrap.appendChild(input);
        row.appendChild(wrap);
        try {
            input.focus();
        } catch {
            /* ignore */
        }

        let versions = [];

        const fillSelect = (list, preferAddr) => {
            versions = Array.isArray(list) ? list : [];
            select.replaceChildren();
            if (!versions.length) {
                const o = document.createElement("option");
                o.value = "";
                o.textContent = "—";
                select.appendChild(o);
                return;
            }
            versions.forEach((v, i) => {
                const o = document.createElement("option");
                o.value = String(v.addr);
                const n = Number(v.frame?.data?.n ?? v.n ?? i + 1);
                o.textContent = String(n);
                select.appendChild(o);
            });
            if (preferAddr) {
                select.value = preferAddr;
            } else {
                select.selectedIndex = versions.length - 1;
            }
        };

        const refreshVersions = async () => {
            const space = resolveSpace();
            if (!space) return;
            const raw = input.value.trim();
            if (!raw) {
                fillSelect([]);
                return;
            }
            try {
                const resolved = await resolvePathOrAddr(space, raw);
                const list = resolved.versions.length
                    ? resolved.versions
                    : (
                          await listContentfulVersions(space, resolved.tipIb)
                      ).map((v) => ({
                          ...v,
                          n: Number(v.frame?.data?.n || 0),
                      }));
                fillSelect(list, resolved.addr || undefined);
            } catch (err) {
                console.error(`[jockey_tiny] ${logTag} resolve`, err);
                fillSelect([]);
            }
        };

        const reset = () => {
            row.dataset[flag] = "0";
            row.classList.remove("smd-input-row");
            row.textContent = label;
        };

        const run = async () => {
            const space = resolveSpace();
            if (!space) throw new Error("tiny_ibgib_space not mounted");
            const raw = input.value.trim();
            if (!raw) return;
            const resolved = await resolvePathOrAddr(space, raw);
            let addr = select.value || resolved.addr;
            if (!addr && versions.length) {
                addr = versions[versions.length - 1]?.addr || "";
            }
            if (!addr) throw new Error("no frame selected");
            const loaded = await loadFrameHtml(space, addr);
            if (!loaded) throw new Error(`frame missing: ${addr}`);
            if (typeof menuApi?.close === "function") menuApi.close();

            if (mode === "orient") {
                const out = await orientFrame({
                    dataPath: resolved.dataPath || loaded.frame?.data?.data_path,
                    addr: loaded.tipAddr,
                    tipIb: loaded.ib || resolved.tipIb,
                    html: loaded.html,
                    frame: loaded.frame,
                });
                if (typeof navi.callout === "function") {
                    navi.callout(
                        `[jockey_tiny] tiny-orient ${out.path} ← ${out.addr}`
                    );
                }
                return out;
            }

            const path =
                resolved.dataPath ||
                originalDataPath(loaded.frame?.data?.data_path || "") ||
                raw;
            if (typeof navi.callout === "function") {
                navi.callout(`[jockey_tiny] stage-tiny ${path} ← ${addr}`);
            }
            return runStageFromHtml(addApi, {
                html: loaded.html,
                path,
                label: `stage-tiny ${path}`,
            });
        };

        input.addEventListener("click", (e) => e.stopPropagation());
        input.addEventListener("mousedown", (e) => e.stopPropagation());
        select.addEventListener("click", (e) => e.stopPropagation());
        select.addEventListener("mousedown", (e) => e.stopPropagation());

        let debounce = null;
        input.addEventListener("input", () => {
            clearTimeout(debounce);
            debounce = setTimeout(() => void refreshVersions(), 200);
        });
        input.addEventListener("blur", () => {
            void refreshVersions();
            setTimeout(() => {
                if (row.isConnected && row.dataset[flag] === "1") {
                    // keep open while select focused
                    if (document.activeElement === select) return;
                    if (document.activeElement === input) return;
                    reset();
                }
            }, 120);
        });

        const onKey = (e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
                e.preventDefault();
                void (async () => {
                    try {
                        await run();
                    } catch (err) {
                        console.error(`[jockey_tiny] ${logTag} failed`, err);
                        if (typeof navi.callout === "function") {
                            navi.callout(
                                `[jockey_tiny] ${logTag}: ${err?.message || err}`
                            );
                        }
                    }
                })();
            } else if (e.key === "Escape") {
                e.preventDefault();
                reset();
            }
        };
        input.addEventListener("keydown", onKey);
        select.addEventListener("keydown", onKey);
    };

    const scrollbufferPlugin = {
        id: "jockey_tiny",
        name: "jockey_tiny",
        claims: [
            {
                id: "tiny-init",
                direction: 1,
                // htmf first — host bind prefers htmf over htm-element.
                types: ["htmf", "html", "htm-element"],
                color: "limegreen",
                describe: () => ({
                    text: "tiny-init",
                    color: "limegreen",
                    textShadow: "0 1px 2px #001a00, 0 0 2px #000, 0 0 1px #000",
                }),
                matches: (context) => {
                    if (!canTiny(context)) return false;
                    return !hasStampForContext(context);
                },
                async execute(context, api) {
                    return runEditorFlow(context, api, { mode: "init" });
                },
            },
            {
                id: "tiny-edit",
                direction: 1,
                types: ["htmf", "html", "htm-element"],
                color: "chartreuse",
                describe: () => ({
                    text: "tiny-edit",
                    color: "chartreuse",
                    textShadow: "0 1px 2px #001a00, 0 0 2px #000, 0 0 1px #000",
                }),
                matches: (context) => {
                    if (!canTiny(context)) return false;
                    return hasStampForContext(context);
                },
                async execute(context, api) {
                    return runEditorFlow(context, api, { mode: "edit" });
                },
            },
            {
                id: "tiny-from-snoop",
                direction: 1,
                types: ["htmf", "html", "htm-element"],
                color: "#3dff8a",
                describe: () => ({
                    text: "tiny-from-snoop",
                    color: "#3dff8a",
                    textShadow: "0 1px 2px #001a00, 0 0 2px #000, 0 0 1px #000",
                }),
                matches: (context) => canTiny(context),
                async execute(context, api) {
                    return runEditorFlow(context, api, { mode: "snoop" });
                },
            },
            {
                id: "tiny-orient",
                direction: 1,
                types: ["htm-element"],
                color: "#00e8a8",
                describe: () => ({
                    text: "tiny-orient",
                    color: "#00e8a8",
                    textShadow: "0 1px 2px #003328, 0 0 2px #000, 0 0 1px #000",
                }),
                matches: (context) => {
                    if (!hasType(context, "htm-element")) return false;
                    if (!resolveSpace()) return false;
                    if (!navi?.storage?.file?.save) return false;
                    return !!dataPathOfContext(context);
                },
                async execute(context, api) {
                    return runTinyOrientClaim(context, api);
                },
            },
            {
                id: "tiny-base",
                direction: 1,
                types: ["htm-element"],
                color: "#00ffe0",
                describe: () => ({
                    text: "tiny-base",
                    color: "#00ffe0",
                    textShadow: "0 1px 2px #003333, 0 0 2px #000, 0 0 1px #000",
                }),
                matches: (context) => {
                    if (!hasType(context, "htm-element")) {
                        return false;
                    }
                    if (!liveAnchor(context)) return false;
                    return canTiny(context);
                },
                async execute(context, api) {
                    const a = liveAnchor(context);
                    if (!a) throw new Error("tiny-base needs an <a> element");
                    const n = applyNaviBaseToAnchor(a);
                    const hx = reprocessHtmx(a);
                    const out = await persistLiveEdit(context, api);
                    const how = out?.inited ? "tiny-init+cascade" : "tiny-edit";
                    const msg = `[jockey_tiny] tiny-base ${how} ${n} attr(s)${hx ? "+htmx" : ""} → ${out?.leafAddr || "?"}`;
                    if (typeof navi.callout === "function") navi.callout(msg);
                    else console.log(msg);
                    if (typeof api?.terminate === "function") api.terminate();
                    return undefined;
                },
            },
        ],
    };

    const makeAddApiFromPointer = (ptr) => {
        const jockey = resolveJockey();
        const pt = ptr || jockey?._pointer || { x: 24, y: 48 };
        if (jockey?._pointer) {
            jockey._pointer.x = pt.x;
            jockey._pointer.y = pt.y;
        }
        return {
            navi,
            jockey: jockey || null,
            scrollbuffer: jockey?.scrollbuffer || null,
            stage: resolveStage() || null,
            pointer: { x: pt.x, y: pt.y },
            terminate: () => {
                try {
                    if (jockey?.holding) jockey.endHold();
                } catch {
                    /* ignore */
                }
            },
        };
    };

    /** stage-member add ▸ — staging only (tiny frame). */
    const stageMemberAddPlugin = {
        id: "jockey_tiny-add",
        claims: [
            {
                id: "tiny-frame",
                label: "tiny frame",
                matches: () =>
                    !!(
                        findScrollClaim("stage_casting", "stagemaker") &&
                        findScrollClaim("jockey_move", "move") &&
                        resolveSpace() &&
                        resolveStage()
                    ),
                activate: (row, menuApi, addApi) => {
                    activateTinyDualField(row, menuApi, addApi, {
                        flag: "tinyFrameInput",
                        label: "tiny frame",
                        mode: "stage",
                        logTag: "tiny-frame",
                    });
                },
                async execute() {
                    return undefined;
                },
            },
        ],
    };

    /** Top-level dropdown → tiny ▸ (orient + stage tiny frame). */
    const buildTinyRootMenu = (api) => {
        const orientRow = api.item("tiny-orient");
        orientRow.title = "Orient a tiny frame → storage.file + index";
        orientRow.addEventListener("click", (e) => {
            e.stopPropagation();
            if (!resolveSpace() || !navi?.storage?.file?.save) {
                if (typeof navi.callout === "function") {
                    navi.callout(
                        "[jockey_tiny] tiny-orient needs tiny_ibgib_space + storage.file"
                    );
                }
                return;
            }
            activateTinyDualField(orientRow, api, makeAddApiFromPointer(api.pointer?.()), {
                flag: "tinyOrientRootInput",
                label: "tiny-orient",
                mode: "orient",
                logTag: "tiny-orient",
            });
        });
        api.insertAfter(orientRow);

        const stageRow = api.item("stage tiny frame");
        stageRow.title =
            "Stage a tiny frame from data.html (same as stage-member add → tiny frame)";
        stageRow.addEventListener("click", (e) => {
            e.stopPropagation();
            if (
                !findScrollClaim("stage_casting", "stagemaker") ||
                !findScrollClaim("jockey_move", "move") ||
                !resolveSpace() ||
                !resolveStage()
            ) {
                if (typeof navi.callout === "function") {
                    navi.callout(
                        "[jockey_tiny] stage tiny frame needs stage_casting + jockey_move + stagedir + space"
                    );
                }
                return;
            }
            activateTinyDualField(stageRow, api, makeAddApiFromPointer(api.pointer?.()), {
                flag: "stageTinyFrameRootInput",
                label: "stage tiny frame",
                mode: "stage",
                logTag: "stage-tiny-frame",
            });
        });
        api.insertAfter(stageRow);
    };

    const rootDropdownMenu = {
        id: "tiny",
        label: "tiny",
        build: buildTinyRootMenu,
    };

    const ORIENT_HELP = [
        "jockey_tiny orient list",
        "jockey_tiny orient rm <path|ib^gib>",
        "jockey_tiny orient <path|ib^gib> [n]  — publish frame to storage.file",
    ].join("\n");

    const runOrientCommand = async (args) => {
        const space = resolveSpace();
        if (!space) throw new Error("tiny_ibgib_space not mounted");
        const verb = String(args[0] || "help").toLowerCase();
        if (verb === "help" || verb === "-h") return ORIENT_HELP;
        if (verb === "list") {
            const rows = await listOrients();
            if (!rows.length) return "(no orients)";
            return rows
                .map(
                    (r) =>
                        `${r.path}  n=${r.n ?? "?"}  ${r.addr || ""}  ${r.at || ""}`
                )
                .join("\n");
        }
        if (verb === "rm" || verb === "remove") {
            const target = args[1];
            const removed = await removeOrient(target);
            const filePath =
                originalDataPath(target) ||
                pathFromTipIb(removed?.tipIb || "") ||
                "";
            try {
                if (filePath && navi?.storage?.file?.del) {
                    await navi.storage.file.del(filePath);
                }
            } catch {
                /* index removal is enough */
            }
            return `removed orient ${filePath || target} (${removed?.addr || "?"})`;
        }

        // orient <path|addr> [n]
        const raw = verb === "orient" ? args[1] : args[0];
        const nArg = verb === "orient" ? args[2] : args[1];
        if (!raw || raw === "orient") return ORIENT_HELP;
        const resolved = await resolvePathOrAddr(space, raw);
        let versions = resolved.versions.length
            ? resolved.versions
            : await listContentfulVersions(space, resolved.tipIb);
        if (!versions.length) {
            throw new Error(`no contentful frames for ${resolved.tipIb}`);
        }
        let pick = versions[versions.length - 1];
        if (nArg != null && String(nArg).trim() !== "") {
            const want = Number(nArg);
            const hit = versions.find(
                (v) => Number(v.frame?.data?.n ?? v.n) === want
            );
            if (!hit) throw new Error(`no frame with n=${want}`);
            pick = hit;
        } else if (resolved.addr) {
            pick =
                versions.find((v) => v.addr === resolved.addr) || {
                    addr: resolved.addr,
                    frame: resolved.frame,
                    html: resolved.html,
                };
        }
        const loaded =
            (await loadFrameHtml(space, pick.addr)) || {
                tipAddr: pick.addr,
                frame: pick.frame,
                html: pick.html,
                ib: resolved.tipIb,
            };
        const out = await orientFrame({
            dataPath: resolved.dataPath,
            addr: loaded.tipAddr,
            tipIb: loaded.ib || resolved.tipIb,
            html: loaded.html,
            frame: loaded.frame,
        });
        return `oriented ${out.path} ← ${out.addr}`;
    };

    return {
        name: "jockey_tiny",
        version: "0.4.7",
        description:
            "Jockey +1 tiny-init/edit/snoop on htmf+htm-element; tip ib = data-path; parts htmf+tiny-clone",

        moduleInfo: {
            name: "jockey_tiny",
            version: "0.4.7",
            description:
                "Bare tip ib <path>; frame parts htmf + tiny-clone (legacy htmf:/jockey:htmf: peeled)",
        },

        scrollbufferPlugin,
        stageMemberAddPlugin,
        rootDropdownMenu,
        tipIbForContext,
        nestingOf,
        canTiny,
        tipExistsForContext,
        hasStampForContext,
        persistLiveEdit,
        withNaviBase,
        tipIbForDataPath,
        orientFrame,
        listOrients,
        removeOrient,

        commands: {
            orient: {
                name: "orient",
                description:
                    "orient list | rm <path|addr> | <path|addr> [n] — storage.file + index",
                execute: async (...args) => runOrientCommand(args),
            },
        },

        onMount: async () => {
            if (typeof navi.callout === "function") {
                navi.callout(
                    "[jockey_tiny] mounted — dropdown tiny ▸; stage-member add → tiny frame"
                );
            }
        },

        onUnmount: () => {
            /* claims drop with module */
        },
    };
};

