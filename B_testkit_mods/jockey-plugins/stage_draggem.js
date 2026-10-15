/**
 * stage_draggem — jockey scrollbuffer claims over live stage HTML.
 *
 * +1  draggablize → wrap the pointed / bound-layer target in-place via
 *     supermouse_plugin_draggem_div (NOT surf.persist). Stage-member reference
 *     stays the column occupant (e.g. gadgets); a nested child (e.g. notemaker
 *     after select-children) can be wrapped on its own and unwraps back into
 *     that host. Titlebar X: remove occupant only when the wrap target *is*
 *     the stage member; nested wraps just unwrap.
 * −1  undraggablize → unwrap; content stays where the wrapper lived in the DOM
 *
 * Requires: supermouse_plugin_stagejockey, supermouse_plugin_draggem_div,
 *           horizon_stagedir (for X → removeAt + persist when wrapping occupant)
 */
const HELP = [
    "stage_draggem — make a piece of the stage draggable in place.",
    "use: select an htmf with stagejockey → +1 \"draggablize\" to wrap it in a draggable window;",
    "     select the window → −1 \"undraggablize\" to unwrap it where it is.",
    "     The window's X removes the stage-member only when the wrap is the stage-member itself.",
    "needs: stagejockey, supermouse_plugin_draggem_div, horizon_stagedir",
].join("\n");

export const register = (navi) => {
    const resolveDraggem = () =>
        navi?.mod?.supermouse_plugin_draggem_div || null;

    // Same object jockey-remove uses via api.stage (module.stage, not the module).
    const resolveStage = () =>
        navi?.mod?.stagedir?.stage || navi?.mod?.horizon_stagedir?.stage || null;

    const resolveJockey = () =>
        navi?.mod?.supermouse_plugin_stagejockey?.jockey || null;

    const hasType = (context, name) => {
        const types = Array.isArray(context?.types) ? context.types : [];
        return types.includes(name) || context?.kind === name;
    };

    const isHtmlContext = (context) =>
        hasType(context, "htmf") ||
        hasType(context, "html") ||
        context?.part === "htmf" ||
        context?.part === "html" ||
        partNames(context?.part).includes("htmf") ||
        partNames(context?.part).includes("html");

    const partNames = (raw) =>
        String(raw || "")
            .trim()
            .toLowerCase()
            .split(/\s+/)
            .filter(Boolean);

    const wrapTag = () => resolveDraggem()?.WRAP_TAG || "x-draggem-div";

    const isWrapped = (el) => {
        if (!(el instanceof HTMLElement)) return false;
        const tag = wrapTag();
        return !!(el.closest?.(tag) || el.matches?.(tag));
    };

    const liveElement = (context) => {
        const el = context?.element;
        return el instanceof HTMLElement ? el : null;
    };

    /**
     * Prefer the pointed / layer-bound element when it lives under the stage
     * occupant; otherwise wrap the occupant (classic whole-member case).
     * hostElement stays the stage-member anchor either way.
     */
    const resolveWrapTarget = (context) => {
        const host =
            context?.hostElement instanceof HTMLElement
                ? context.hostElement
                : null;
        const el = liveElement(context);
        if (el && host) {
            if (el === host || host.contains(el)) return el;
        }
        if (el) return el;
        return host;
    };

    const hostWrapper = (el) => {
        if (!(el instanceof HTMLElement)) return null;
        const tag = wrapTag();
        if (el.matches?.(tag)) return el;
        return el.closest?.(tag) || null;
    };

    /** Wrapper from nested select: element, hostElement, or type inheritance. */
    const resolveWrapper = (context) => {
        const fromEl = hostWrapper(liveElement(context));
        if (fromEl) return fromEl;
        const fromTarget = hostWrapper(resolveWrapTarget(context));
        if (fromTarget) return fromTarget;
        const host = context?.hostElement;
        if (host instanceof HTMLElement) {
            const w = hostWrapper(host);
            if (w) return w;
            if (host.matches?.(wrapTag())) return host;
        }
        return null;
    };

    /** Remove the wrapped stage-member (same as jockey-remove). */
    const removeOccupant = async (wrapper) => {
        const stage = resolveStage();
        const jockey = resolveJockey();
        const loc =
            typeof jockey?.locate === "function" ? jockey.locate(wrapper) : null;

        if (stage && loc?.slot != null && loc?.index != null) {
            const removed = stage.removeAt(loc.slot, loc.index);
            if (!removed) {
                throw new Error(`no item at ${loc.slot}[${loc.index}]`);
            }
            if (typeof stage.persist === "function") {
                await stage.persist();
            }
            if (typeof navi.callout === "function") {
                navi.callout(
                    `[stage_draggem] closed ${loc.slot}[${loc.index}]`
                );
            }
            return;
        }

        // Fallback if stage/locate unavailable — drop the wrapper from the DOM.
        wrapper.remove();
        if (typeof navi.callout === "function") {
            navi.callout(
                "[stage_draggem] closed (DOM only — stage locate unavailable)"
            );
        }
    };

    /** Nested wrap: X / close puts content back where it lived under the host. */
    const unwrapNested = (wrapper) => {
        const host = resolveDraggem();
        if (!host?.unwrapElement) {
            wrapper.remove();
            return;
        }
        host.unwrapElement(wrapper);
        if (typeof navi.callout === "function") {
            navi.callout("[stage_draggem] unwrapped nested (host stage-member kept)");
        }
    };

    const scrollbufferPlugin = {
        id: "stage_draggem",
        name: "stage_draggem",
        claims: [
            {
                id: "draggablize",
                direction: 1,
                types: ["htmf"],
                color: "goldenrod",
                describe: () => ({
                    text: "draggablize",
                    color: "goldenrod",
                    textShadow: "0 1px 2px #221100, 0 0 2px #000, 0 0 1px #000",
                }),
                matches: (context) => {
                    if (!hasType(context, "stage-member")) return false;
                    if (
                        !isHtmlContext(context) &&
                        !hasType(context, "htmf") &&
                        !hasType(context, "html") &&
                        !hasType(context, "htm-element")
                    ) {
                        return false;
                    }
                    const el = resolveWrapTarget(context);
                    if (!el || isWrapped(el)) return false;
                    return !!resolveDraggem()?.wrapElement;
                },
                execute: (context, api) => {
                    const host = resolveDraggem();
                    if (!host?.wrapElement) {
                        throw new Error(
                            "supermouse_plugin_draggem_div not mounted"
                        );
                    }
                    const el = resolveWrapTarget(context);
                    if (!el) throw new Error("no live stage element");
                    if (isWrapped(el)) {
                        throw new Error("already draggablized");
                    }

                    const stageHost =
                        context?.hostElement instanceof HTMLElement
                            ? context.hostElement
                            : el;
                    const nested = el !== stageHost && stageHost.contains(el);

                    const wrapper = host.wrapElement(el, {
                        persist: false,
                        closable: true,
                        closeTitle: nested
                            ? "unwrap back into host"
                            : "close (remove from stage)",
                        onClose: nested
                            ? (w) => unwrapNested(w)
                            : removeOccupant,
                    });
                    if (!wrapper) throw new Error("wrap failed");

                    if (typeof api?.terminate === "function") api.terminate();
                    return undefined;
                },
            },
            {
                id: "undraggablize",
                direction: -1,
                types: ["draggemdiv"],
                color: "goldenrod",
                describe: () => ({
                    text: "undraggablize",
                    color: "goldenrod",
                    textShadow: "0 1px 2px #221100, 0 0 2px #000, 0 0 1px #000",
                }),
                matches: (context) => {
                    if (!resolveDraggem()?.unwrapElement) return false;
                    if (resolveWrapper(context)) return true;
                    return hasType(context, "draggemdiv");
                },
                execute: (context, api) => {
                    const host = resolveDraggem();
                    if (!host?.unwrapElement) {
                        throw new Error(
                            "supermouse_plugin_draggem_div not mounted"
                        );
                    }
                    const wrapper = resolveWrapper(context);
                    if (!wrapper) throw new Error("no draggem wrapper");

                    const restored = host.unwrapElement(wrapper);
                    if (!restored) {
                        throw new Error("not a draggemdiv (or empty)");
                    }

                    if (typeof api?.terminate === "function") api.terminate();
                    return undefined;
                },
            },
        ],
    };

    return {
        name: "stage_draggem",
        commands: {
            stage_draggem: { name: "stage_draggem", description: "help", execute: async () => HELP },
        },
        version: "0.1.11",
        description:
            "Jockey: wrap pointed htmf / unwrap (nested stays under stage-member)",

        moduleInfo: {
            name: "stage_draggem",
            version: "0.1.11",
            description:
                "Jockey: wrap pointed htmf / unwrap (nested stays under stage-member)",
        },

        scrollbufferPlugin,

        onMount: async () => {
            if (typeof navi.callout === "function") {
                navi.callout(
                    "[stage_draggem] mounted — needs stagejockey + supermouse_plugin_draggem_div"
                );
            }
        },

        onUnmount: () => {
            /* claims drop with module */
        },
    };
};
