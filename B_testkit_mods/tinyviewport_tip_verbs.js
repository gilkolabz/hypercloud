/**
 * tinyviewport_tip_verbs — nesting companion for tinyviewport_manager.
 *
 * Under nested tip leaves, surfaces park method.* / http verbs and relay
 * commands from tip frame data (contributeSidebar). Mirrors flowchart:
 * mount after the manager, registers via attachTinyviewportPlugin.
 *
 *   mount flowerpot/hypercloud/testkit/mods/legacy/tinyviewport_manager.js
 *   mount flowerpot/hypercloud/testkit/mods/legacy/tinyviewport_tip_verbs.js
 *
 * Fragment only collects sidebar actions when nesting is on.
 */
export const register = (navi) => {
    const VERSION = "0.1.0";
    const PLUGIN_ID = "tip_verbs";
    const WAREZ_SUBJECT =
        "flowerpot/hypercloud/testkit/mods/legacy/tinyviewport_tip_verbs.js";
    const WAREZ_MANIFEST =
        "flowerpot/hypercloud/testkit/mods/tinyviewport_tip_verbs";

    let unregister = null;

    const tipApi = () => {
        const tip = navi?.storage?.tip;
        if (!tip || typeof tip.get !== "function") {
            throw new Error("navi.storage.tip unavailable");
        }
        return tip;
    };

    const resolveManager = () => {
        const m = navi?.mod?.tinyviewport_manager;
        if (m && typeof m.registerPlugin === "function") return m;
        return null;
    };

    const contributeSidebar = async (ctx) => {
        const nodes = [];
        const tip = tipApi();
        const ibs = Array.isArray(ctx.ibs) ? ctx.ibs : [];
        for (const ib of ibs) {
            let frame = null;
            try {
                frame = await tip.get(ib);
            } catch {
                frame = null;
            }
            const data = frame?.data;
            if (!data || typeof data !== "object") continue;
            const methodBag =
                data.method && typeof data.method === "object"
                    ? data.method
                    : null;
            if (methodBag) {
                for (const verb of Object.keys(methodBag)) {
                    const v = String(verb || "").trim();
                    if (!v) continue;
                    nodes.push({
                        id: `method:${ib}:${v}`,
                        underIb: ib,
                        label: v,
                        kind: "method",
                        title: `park method.${v}`,
                        order: 10,
                        run: async () => {
                            if (typeof navi.callout === "function") {
                                navi.callout(
                                    `[tip_verbs] ${ib} method.${v}`
                                );
                            }
                        },
                    });
                }
            }
            const httpBag =
                data.http && typeof data.http === "object" ? data.http : null;
            if (httpBag) {
                for (const verb of Object.keys(httpBag)) {
                    const v = String(verb || "").trim();
                    if (!v) continue;
                    if (methodBag && methodBag[v]) continue;
                    nodes.push({
                        id: `http:${ib}:${v}`,
                        underIb: ib,
                        label: `http ${v}`,
                        kind: "method",
                        title: `data.http.${v}`,
                        order: 20,
                        run: async () => {
                            if (typeof navi.callout === "function") {
                                navi.callout(
                                    `[tip_verbs] ${ib} http.${v}`
                                );
                            }
                        },
                    });
                }
            }
            const cmdBags = [];
            if (Array.isArray(data.commands)) {
                cmdBags.push(data.commands);
            }
            if (Array.isArray(data.relay?.commands)) {
                cmdBags.push(data.relay.commands);
            }
            if (methodBag) {
                for (const spec of Object.values(methodBag)) {
                    if (
                        spec &&
                        typeof spec === "object" &&
                        Array.isArray(spec.commands)
                    ) {
                        cmdBags.push(spec.commands);
                    }
                }
            }
            const seen = new Set();
            for (const bag of cmdBags) {
                for (const c of bag) {
                    const cmd = String(c || "").trim();
                    if (!cmd || seen.has(cmd)) continue;
                    seen.add(cmd);
                    nodes.push({
                        id: `cmd:${ib}:${cmd}`,
                        underIb: ib,
                        label: cmd,
                        kind: "command",
                        title: `command ${cmd}`,
                        order: 30,
                        run: async () => {
                            try {
                                if (typeof navi === "function") {
                                    await navi(cmd);
                                } else if (
                                    typeof navi.callout === "function"
                                ) {
                                    navi.callout(
                                        `[tip_verbs] navi unavailable for ${cmd}`
                                    );
                                }
                            } catch (err) {
                                if (typeof navi.callout === "function") {
                                    navi.callout(
                                        `[tip_verbs] ${cmd}: ${err?.message || err}`
                                    );
                                }
                            }
                        },
                    });
                }
            }
        }
        return { nodes };
    };

    const pluginDef = {
        id: PLUGIN_ID,
        label: "tip methods / commands",
        description:
            "Nesting companion — under each tip leaf, park method.* / http verbs and relay.commands from tip frame data.",
        enabledByDefault: true,
        source: "module",
        contributeSidebar,
    };

    const mountPlugin = () => {
        const mgr = resolveManager();
        if (!mgr || typeof mgr.registerPlugin !== "function") {
            if (typeof navi.callout === "function") {
                navi.callout(
                    "[tinyviewport_tip_verbs] needs tinyviewport_manager mounted first"
                );
            }
            return false;
        }
        try {
            mgr.unregisterPlugin?.(PLUGIN_ID);
        } catch {
            /* ignore */
        }
        unregister = mgr.registerPlugin(pluginDef);
        return true;
    };

    return {
        name: "tinyviewport_tip_verbs",
        version: VERSION,
        description:
            "Nesting companion — tip methods / commands under nested tip leaves",

        moduleInfo: {
            name: "tinyviewport_tip_verbs",
            version: VERSION,
            description:
                "Registers tip_verbs contributeSidebar on tinyviewport_manager",
        },

        warezSubject: WAREZ_SUBJECT,
        warezManifest: WAREZ_MANIFEST,

        attachTinyviewportPlugin: () => {
            const ok = mountPlugin();
            if (ok && typeof navi.callout === "function") {
                navi.callout(
                    `[tinyviewport_tip_verbs] reattach v${VERSION}`
                );
            }
            return ok;
        },

        onMount: async () => {
            if (mountPlugin()) {
                if (typeof navi.callout === "function") {
                    navi.callout(`[tinyviewport_tip_verbs] v${VERSION}`);
                }
            }
        },

        onUnmount: async () => {
            try {
                unregister?.();
            } catch {
                /* ignore */
            }
            unregister = null;
            try {
                resolveManager()?.unregisterPlugin?.(PLUGIN_ID);
            } catch {
                /* ignore */
            }
        },
    };
};
