/**
 * parsehtm — +1 on word/phrase: treat selected plaintext as HTML markup and
 * splice the parsed nodes into the live DOM (entities → real elements).
 * −1 unparsehtm on htm-element: reverse — replace the element with a text
 * node of its outerHTML (markup as characters again).
 *
 * Requires: supermouse_plugin_stagejockey (scrollbuffer word/phrase context).
 */
const HELP = [
    "parsehtm — switch between HTML written as text and real HTML.",
    "use: select a word/phrase containing markup with stagejockey → +1 \"parsehtm\" to turn it into elements;",
    "     select an element → −1 \"unparsehtm\" to turn it back into its markup as plain text.",
    "needs: stagejockey",
].join("\n");

export const register = (navi) => {
    const isBrowser =
        typeof window !== "undefined" && typeof window.document !== "undefined";

    const CLAIM_COLOR = "orange";
    /** Explicit none so stagejockey skips contrast shadow. */
    const CLAIM_SHADOW = "none";

    const callout = (msg) => {
        if (typeof navi.callout === "function") navi.callout(msg);
    };

    const hasType = (context, name) => {
        const types = Array.isArray(context?.types) ? context.types : [];
        return types.includes(name) || context?.kind === name;
    };

    const textRootOf = (context) => {
        if (context?.textRoot instanceof HTMLElement) return context.textRoot;
        if (context?.element instanceof HTMLElement) return context.element;
        if (context?.hostElement instanceof HTMLElement) {
            return context.hostElement;
        }
        return null;
    };

    const liveElement = (context) => {
        if (context?.element instanceof HTMLElement) return context.element;
        if (context?.hostElement instanceof HTMLElement) {
            return context.hostElement;
        }
        return null;
    };

    const selectedMarkup = (context) => {
        const span = context?.textSpan;
        if (span && span.text != null) return String(span.text);
        const root = textRootOf(context);
        if (!(root instanceof HTMLElement) || !span) return "";
        const full = String(root.textContent || "");
        const a = Math.max(0, Number(span.start) || 0);
        const b = Math.max(a, Number(span.end) || a);
        return full.slice(a, b);
    };

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

    /** Parse plaintext markup into a DocumentFragment (flimsy innerHTML). */
    const parseMarkupFragment = (markup) => {
        const tpl = document.createElement("template");
        tpl.innerHTML = String(markup ?? "");
        return tpl.content;
    };

    /**
     * Replace [start,end) of root.textContent with nodes parsed from that
     * slice (so `&lt;hr&gt;` / `<b>test</b>` become real DOM).
     */
    const spliceParsedMarkup = (root, start, end, markup) => {
        const range = domRangeFromTextOffsets(root, start, end);
        if (!range) throw new Error("cannot map text range");
        const frag = parseMarkupFragment(markup);
        range.deleteContents();
        if (!frag.childNodes.length) {
            range.insertNode(document.createTextNode(String(markup ?? "")));
            return range.startContainer;
        }
        const first = frag.firstChild;
        range.insertNode(frag);
        return first;
    };

    const refreshHostPresentation = (context, stage, anchor) => {
        if (!stage || typeof stage.rememberPresentation !== "function") return;
        const host =
            (context?.hostElement instanceof HTMLElement &&
                context.hostElement) ||
            (anchor instanceof HTMLElement &&
                anchor.closest?.("[data-part], [data-path]")) ||
            (anchor instanceof Node &&
                anchor.parentElement?.closest?.("[data-part], [data-path]")) ||
            (anchor instanceof HTMLElement ? anchor : null);
        if (!(host instanceof HTMLElement)) return;
        const prior =
            typeof stage.presentationFor === "function"
                ? stage.presentationFor(host)
                : null;
        const type =
            host.getAttribute("data-part") || prior?.type || "htmf";
        const path =
            host.getAttribute("data-path") ||
            prior?.path ||
            context?.path ||
            "";
        stage.rememberPresentation(host, {
            ...(prior && typeof prior === "object" ? prior : {}),
            type,
            value: host.outerHTML,
            ...(path ? { path: String(path).replace(/^\/+/, "") } : {}),
        });
    };

    const scrollbufferPlugin = {
        id: "parsehtm",
        name: "parsehtm",
        claims: [
            {
                id: "parsehtm",
                direction: 1,
                types: ["word", "phrase", "text"],
                color: CLAIM_COLOR,
                describe: () => ({
                    text: "parsehtm",
                    color: CLAIM_COLOR,
                    textShadow: CLAIM_SHADOW,
                }),
                matches: (context) => {
                    if (
                        !hasType(context, "word") &&
                        !hasType(context, "phrase") &&
                        !hasType(context, "text")
                    ) {
                        return false;
                    }
                    return !!String(selectedMarkup(context) || "").length;
                },
                async execute(context, api) {
                    const root = textRootOf(context);
                    if (!(root instanceof HTMLElement)) {
                        throw new Error("no text root");
                    }
                    const span = context?.textSpan;
                    if (
                        !span ||
                        typeof span.start !== "number" ||
                        typeof span.end !== "number"
                    ) {
                        throw new Error("no word/phrase span");
                    }
                    const markup = selectedMarkup(context);
                    if (!markup.length) throw new Error("empty selection");

                    const start = Number(span.start) || 0;
                    const end = Math.max(start, Number(span.end) || start);
                    const inserted = spliceParsedMarkup(
                        root,
                        start,
                        end,
                        markup
                    );

                    const stage =
                        api?.stage || navi?.mod?.stagedir?.stage || null;
                    if (
                        stage &&
                        typeof stage.activate === "function" &&
                        inserted instanceof HTMLElement
                    ) {
                        try {
                            stage.activate(inserted);
                        } catch {
                            /* ignore */
                        }
                    }

                    refreshHostPresentation(context, stage, root);
                    if (stage && typeof stage.persist === "function") {
                        await stage.persist();
                    }

                    callout("[parsehtm] parsed selection as HTML");
                    if (typeof api?.terminate === "function") api.terminate();
                    return undefined;
                },
            },
            {
                id: "unparsehtm",
                direction: -1,
                types: ["htm-element"],
                color: CLAIM_COLOR,
                describe: () => ({
                    text: "unparsehtm",
                    color: CLAIM_COLOR,
                    textShadow: CLAIM_SHADOW,
                }),
                matches: (context) => {
                    if (!hasType(context, "htm-element")) return false;
                    return !!liveElement(context);
                },
                async execute(context, api) {
                    const el = liveElement(context);
                    if (!(el instanceof HTMLElement)) {
                        throw new Error("no htm-element");
                    }
                    const parent = el.parentNode;
                    if (!parent) throw new Error("element has no parent");

                    const serialized = el.outerHTML;
                    const tn = document.createTextNode(serialized);
                    el.replaceWith(tn);

                    const stage =
                        api?.stage || navi?.mod?.stagedir?.stage || null;
                    const anchor =
                        (parent instanceof HTMLElement && parent) ||
                        tn.parentElement ||
                        context?.hostElement ||
                        null;
                    refreshHostPresentation(context, stage, anchor);
                    if (stage && typeof stage.persist === "function") {
                        await stage.persist();
                    }

                    callout("[unparsehtm] element → text node");
                    if (typeof api?.terminate === "function") api.terminate();
                    return undefined;
                },
            },
        ],
    };

    return {
        name: "parsehtm",
        commands: {
            parsehtm: { name: "parsehtm", description: "help", execute: async () => HELP },
        },
        version: "0.1.1",
        description:
            "Jockey +1 parsehtm (word/phrase/text→HTML) / −1 unparsehtm (element→text)",
        moduleInfo: {
            name: "parsehtm",
            version: "0.1.1",
            description:
                "Orange no-shadow claims: parse plaintext markup to DOM; unparse element to text",
        },
        scrollbufferPlugin,
        onMount: async () => {
            callout(
                "[parsehtm] mounted — +1 parsehtm on word/phrase/text; −1 unparsehtm on htm-element"
            );
        },
    };
};
