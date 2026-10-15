/**
 * hxswapem — +1 on word / phrase: wrap the selected text in an <a> htmx
 * hyperlink whose hx-get is that phrase treated as a park path. Clicking
 * the link hx-swaps outerHTML with whatever the path returns (e.g. an HTMF).
 *
 * Requires: supermouse_plugin_stagejockey (scrollbuffer word/phrase context).
 */
const HELP = [
    "hxswapem — turn a word or phrase into a link that swaps itself for what that path returns.",
    "use: select a word/phrase with stagejockey → +1 \"hxswapem\".",
    "     The text becomes an <a> whose hx-get is the phrase read as a park path;",
    "     clicking it replaces the link with the response (e.g. an HTMF).",
    "needs: stagejockey",
].join("\n");

export const register = (navi) => {
    const isBrowser =
        typeof window !== "undefined" && typeof window.document !== "undefined";

    const CLAIM_COLOR = "#4da3ff";
    const CLAIM_SHADOW = "0 1px 2px #000, 0 0 2px #000, 0 0 1px #000";

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

    const selectedPath = (context) => {
        const span = context?.textSpan;
        if (span && span.text != null) {
            return String(span.text).trim().replace(/^\/+/, "");
        }
        const root = textRootOf(context);
        if (!(root instanceof HTMLElement) || !span) return "";
        const full = String(root.textContent || "");
        const a = Math.max(0, Number(span.start) || 0);
        const b = Math.max(a, Number(span.end) || a);
        return full.slice(a, b).trim().replace(/^\/+/, "");
    };

    const pathHref = (path) => {
        const p = String(path || "")
            .trim()
            .replace(/^\/+/, "");
        return p ? "/" + p : "/";
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

    const makeHxLink = (path, labelText) => {
        const href = pathHref(path);
        const a = document.createElement("a");
        a.setAttribute("href", href);
        a.setAttribute("hx-get", href);
        a.setAttribute("hx-swap", "outerHTML");
        a.setAttribute("hx-target", "this");
        a.setAttribute("hx-push-url", "false");
        a.setAttribute("data-hxswapem", "1");
        a.textContent =
            labelText != null && String(labelText).length
                ? String(labelText)
                : path;
        return a;
    };

    /**
     * Wrap [start,end) of root.textContent in an htmx <a> that GETs `path`
     * and replaces itself (outerHTML) on click.
     */
    const wrapRangeAsHxLink = (root, start, end, path, labelText) => {
        const range = domRangeFromTextOffsets(root, start, end);
        if (!range) throw new Error("cannot map text range");

        const a = makeHxLink(path, labelText);
        const extracted = range.extractContents();
        // Prefer keeping the live selected nodes inside the link when possible.
        if (extracted && extracted.childNodes && extracted.childNodes.length) {
            a.textContent = "";
            a.appendChild(extracted);
            if (!String(a.textContent || "").trim()) {
                a.textContent =
                    labelText != null && String(labelText).length
                        ? String(labelText)
                        : path;
            }
        }
        range.insertNode(a);
        return a;
    };

    const refreshHostPresentation = (context, stage, textRoot) => {
        if (!stage || typeof stage.rememberPresentation !== "function") return;
        const host =
            (context?.hostElement instanceof HTMLElement &&
                context.hostElement) ||
            (textRoot instanceof HTMLElement &&
                textRoot.closest?.("[data-part], [data-path]")) ||
            textRoot;
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
        id: "hxswapem",
        name: "hxswapem",
        claims: [
            {
                id: "hxswapem",
                direction: 1,
                types: ["word", "phrase"],
                color: CLAIM_COLOR,
                describe: () => ({
                    text: "hxswapem",
                    color: CLAIM_COLOR,
                    textShadow: CLAIM_SHADOW,
                }),
                matches: (context) => {
                    if (
                        !hasType(context, "word") &&
                        !hasType(context, "phrase")
                    ) {
                        return false;
                    }
                    const path = selectedPath(context);
                    return !!path;
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
                    const path = selectedPath(context);
                    if (!path) throw new Error("empty path from selection");

                    const start = Number(span.start) || 0;
                    const end = Math.max(start, Number(span.end) || start);
                    const label =
                        span.text != null
                            ? String(span.text)
                            : String(root.textContent || "").slice(start, end);

                    const a = wrapRangeAsHxLink(
                        root,
                        start,
                        end,
                        path,
                        label
                    );

                    const stage =
                        api?.stage || navi?.mod?.stagedir?.stage || null;
                    if (stage && typeof stage.activate === "function") {
                        try {
                            stage.activate(a);
                        } catch {
                            /* ignore */
                        }
                    } else {
                        const htmxApi = globalThis.htmx;
                        if (htmxApi && typeof htmxApi.process === "function") {
                            try {
                                htmxApi.process(a);
                            } catch {
                                /* ignore */
                            }
                        }
                    }

                    refreshHostPresentation(context, stage, root);
                    if (stage && typeof stage.persist === "function") {
                        await stage.persist();
                    }

                    callout(
                        `[hxswapem] linked ${pathHref(path)} — click to hx-swap`
                    );

                    if (typeof api?.terminate === "function") api.terminate();
                    return undefined;
                },
            },
        ],
    };

    return {
        name: "hxswapem",
        commands: {
            hxswapem: { name: "hxswapem", description: "help", execute: async () => HELP },
        },
        version: "0.1.4",
        description:
            "Jockey +1 word/phrase: wrap selection in an htmx <a> that swaps itself on click",
        moduleInfo: {
            name: "hxswapem",
            version: "0.1.4",
            description:
                "Brighter blue claim; wrap word/phrase as hx-get link that swaps on click",
        },
        scrollbufferPlugin,
        onMount: async () => {
            callout(
                "[hxswapem] mounted — +1 hxswapem on word/phrase (wrap as hx link)"
            );
        },
    };
};
