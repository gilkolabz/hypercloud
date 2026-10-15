/**
 * surf_persist — jockey scrollbuffer ±1 via navi.mod.surf.
 *
 * +1  not yet surf-persisted → surf.persist(target)
 * −1  already persisted      → surf.unpersist(target)
 *
 * Targets:
 *   - htmf / html fragment hosts
 *   - draggemdiv wrappers (x-draggem-div) — free-float chrome that should
 *     survive navi surf(); stage_draggem wraps stay unpersisted by design
 *
 * Matches are mutually exclusive on the live element, so after a successful
 * +1 the next red-select rebuilds the buffer and offers −1 (and hides +1).
 *
 * Requires: supermouse_plugin_stagejockey, built-in surf (navi.mod.surf).
 */

function hasType(context, name) {
    const types = Array.isArray(context?.types) ? context.types : [];
    return types.includes(name) || context?.kind === name;
}

function partNames(raw) {
    return String(raw || "")
        .toLowerCase()
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
}

const HELP = [
    "surf_persist — keep a piece of the page across navi surf() page changes.",
    "use: select an htmf / html fragment or a draggable window with stagejockey →",
    "     +1 \"surf-persist\" to keep it; once kept, −1 \"surf-unpersist\" to stop.",
    "needs: stagejockey (surf is built in)",
].join("\n");

export const register = (navi) => {
    const resolveSurf = () => navi?.mod?.surf || null;
    const WRAP_TAG = "x-draggem-div";

    const isHtmfHost = (el) => {
        if (!(el instanceof HTMLElement)) return false;
        const parts = partNames(el.getAttribute("data-part"));
        return parts.includes("htmf") || parts.includes("html");
    };

    const isDraggemHost = (el) => {
        if (!(el instanceof HTMLElement)) return false;
        const parts = partNames(el.getAttribute("data-part"));
        if (parts.includes("draggemdiv")) return true;
        return String(el.tagName || "").toLowerCase() === WRAP_TAG;
    };

    /** Prefer draggem wrapper when selected; else htmf/html fragment host. */
    const persistElementOf = (context) => {
        const el = context?.element;
        if (!(el instanceof HTMLElement)) return null;

        if (isDraggemHost(el)) return el;
        const host = context?.hostElement;
        if (isDraggemHost(host)) return host;
        try {
            const wrap =
                el.closest?.(WRAP_TAG) ||
                el.closest?.('[data-part*="draggemdiv"]');
            if (wrap instanceof HTMLElement && isDraggemHost(wrap)) {
                // Only claim the wrapper when the pick is the draggem itself
                // (or nested under it with type draggemdiv), not when picking
                // an inner htmf for fragment persist.
                if (
                    hasType(context, "draggemdiv") ||
                    el === wrap ||
                    host === wrap
                ) {
                    return wrap;
                }
            }
        } catch {
            /* ignore */
        }

        if (isHtmfHost(el)) return el;
        if (isHtmfHost(host)) return host;
        try {
            const near = el.closest?.(
                '[data-part*="htmf"], [data-part*="html"]'
            );
            if (near instanceof HTMLElement) return near;
        } catch {
            /* ignore */
        }
        return null;
    };

    const isPersisted = (el) => {
        const surf = resolveSurf();
        if (!el || !surf || typeof surf.isPersisted !== "function") return false;
        try {
            return !!surf.isPersisted(el);
        } catch {
            return false;
        }
    };

    const isClaimContext = (context) =>
        hasType(context, "htmf") ||
        hasType(context, "html") ||
        hasType(context, "draggemdiv");

    const labelFor = (el) =>
        isDraggemHost(el) ? "draggemdiv" : "htmf";

    const scrollbufferPlugin = {
        id: "surf_persist",
        name: "surf_persist",
        claims: [
            {
                id: "surf-persist",
                direction: 1,
                types: ["htmf", "html", "draggemdiv"],
                color: "cyan",
                describe: () => ({
                    text: "surf-persist",
                    color: "cyan",
                    textShadow: "0 1px 2px #003333, 0 0 2px #000, 0 0 1px #000",
                }),
                matches: (context) => {
                    if (!isClaimContext(context)) return false;
                    const surf = resolveSurf();
                    if (!surf || typeof surf.persist !== "function") return false;
                    const el = persistElementOf(context);
                    if (!el) return false;
                    return !isPersisted(el);
                },
                execute: (context, api) => {
                    const surf = resolveSurf();
                    if (!surf || typeof surf.persist !== "function") {
                        throw new Error("navi.mod.surf.persist unavailable");
                    }
                    const el = persistElementOf(context);
                    if (!el) throw new Error("no live persist target");
                    if (isPersisted(el)) {
                        throw new Error("already surf-persisted");
                    }

                    surf.persist(el);
                    if (isDraggemHost(el)) {
                        el.setAttribute("data-draggem-persisted", "true");
                    }

                    if (typeof navi.callout === "function") {
                        navi.callout(
                            `[surf_persist] persisted ${labelFor(el)}`
                        );
                    }
                    if (typeof api?.terminate === "function") api.terminate();
                    return undefined;
                },
            },
            {
                id: "surf-unpersist",
                direction: -1,
                types: ["htmf", "html", "draggemdiv"],
                color: "cyan",
                describe: () => ({
                    text: "surf-unpersist",
                    color: "cyan",
                    textShadow: "0 1px 2px #003333, 0 0 2px #000, 0 0 1px #000",
                }),
                matches: (context) => {
                    if (!isClaimContext(context)) return false;
                    const surf = resolveSurf();
                    if (!surf || typeof surf.unpersist !== "function") return false;
                    const el = persistElementOf(context);
                    if (!el) return false;
                    return isPersisted(el);
                },
                execute: (context, api) => {
                    const surf = resolveSurf();
                    if (!surf || typeof surf.unpersist !== "function") {
                        throw new Error("navi.mod.surf.unpersist unavailable");
                    }
                    const el = persistElementOf(context);
                    if (!el) throw new Error("no live persist target");
                    if (!isPersisted(el)) {
                        throw new Error("not surf-persisted");
                    }

                    surf.unpersist(el);
                    if (isDraggemHost(el)) {
                        el.removeAttribute("data-draggem-persisted");
                    }

                    if (typeof navi.callout === "function") {
                        navi.callout(
                            `[surf_persist] unpersisted ${labelFor(el)}`
                        );
                    }
                    if (typeof api?.terminate === "function") api.terminate();
                    return undefined;
                },
            },
        ],
    };

    return {
        name: "surf_persist",
        commands: {
            surf_persist: { name: "surf_persist", description: "help", execute: async () => HELP },
        },
        version: "0.1.4",
        description:
            "Jockey +1/−1: surf.persist / unpersist on htmf and draggemdiv",

        moduleInfo: {
            name: "surf_persist",
            version: "0.1.4",
            description:
                "Scrollbuffer: surf-persist (+1) / surf-unpersist (−1) on htmf + draggemdiv",
        },

        scrollbufferPlugin,
    };
};
