/**
 * Snoopy — SW fetch observer for Navi (tip+bin lineage).
 *
 * Tip ib: navi:snoopy:<route> (route = pathname without leading /).
 * Each observation is the tip's data (request/response meta). tip.mut8 stamps a
 * new generation (past ← prior); every generation lives at ib^gib in tip.frame
 * space; the tip pointer is only the latest addr.
 * Texty response bodies (html/json/…) are cloned in the SW and stored in tip
 * rel8ns.bin (capped); binary / slow bodies stay bodyOmitted.
 *
 * SW plugin observeFetch returns the naviHandler promise so waitUntil holds
 * until the page tip write finishes. Does not care fetch vs XHR.
 */

const MODULE_NAME = "snoopy";
const PLUGIN_ID = "snoopy-observer";
const HANDLER_NAME = "snoopy.record";
const TIP_PREFIX = "navi:snoopy:";
/** Legacy item-archive prefix (read fallback only). */
const FRAME_ITEM_PREFIX = "navi:ibgib:frame:";
/** Path prefixes skipped by the SW observer (host chrome / APIs). */
const SKIP_SEGMENTS = ["foobarch", "_foobarch"];
/** Max response body chars stored in bin (SW + page). */
const BODY_MAX = 256 * 1024;
const LINEAGE_MAX = 64;

const SENSITIVE_HEADER_RE =
    /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-flowerpot-usage-token|x-flowerpot-signatures)$/i;

function headersToObject(headers, { redact = true } = {}) {
    const out = {};
    if (!headers) return out;
    if (typeof headers.forEach === "function") {
        headers.forEach((value, name) => {
            out[name] =
                redact && SENSITIVE_HEADER_RE.test(name) ? "[redacted]" : value;
        });
        return out;
    }
    for (const [name, value] of Object.entries(headers)) {
        out[name] =
            redact && SENSITIVE_HEADER_RE.test(name) ? "[redacted]" : value;
    }
    return out;
}

function normalizeRoute(raw) {
    return String(raw || "")
        .trim()
        .replace(/^https?:\/\/[^/]+/i, "")
        .replace(/^\/+/, "");
}

function tipIbForRoute(route) {
    const r = normalizeRoute(route);
    return r ? `${TIP_PREFIX}${r}` : "";
}

function routeFromTipIb(ib) {
    const s = String(ib || "").trim();
    if (s.startsWith(TIP_PREFIX)) return s.slice(TIP_PREFIX.length);
    if (s.startsWith("navi/snoopy/")) return s.slice("navi/snoopy/".length);
    return null;
}

function frameAddr(frame) {
    if (!frame?.ib) return null;
    return frame.gib ? `${frame.ib}^${frame.gib}` : String(frame.ib);
}

/**
 * SW plugin source — cannot close over page locals; SKIP + BODY_MAX inlined.
 * Clones the response (page still gets the original). Captures texty bodies
 * up to BODY_MAX; races a short timeout so waitUntil never stalls on huge bodies.
 */
function buildPluginSource(skipSegments, bodyMax) {
    const skipJson = JSON.stringify(skipSegments.map(String));
    const max = Math.max(1024, Number(bodyMax) || BODY_MAX);
    return `
(function () {
    var SKIP = ${skipJson};
    var BODY_MAX = ${max};
    var BODY_TIMEOUT_MS = 2500;
    var naviHandler = null;

    function firstSegment(pathname) {
        var trimmed = String(pathname || "").replace(/^\\/+/, "");
        if (!trimmed) return "";
        return trimmed.split("/")[0] || "";
    }

    function routeFromUrl(urlString) {
        try {
            var u = new URL(urlString, self.location && self.location.origin);
            return String(u.pathname || "").replace(/^\\/+/, "");
        } catch (e) {
            return String(urlString || "").replace(/^\\/+/, "");
        }
    }

    function headersObject(headers) {
        var out = {};
        if (!headers || typeof headers.forEach !== "function") return out;
        headers.forEach(function (value, name) {
            out[name] = value;
        });
        return out;
    }

    function shouldObserve(urlString) {
        try {
            var u = new URL(urlString, self.location && self.location.origin);
            var first = firstSegment(u.pathname);
            if (!first) return false;
            return SKIP.indexOf(first) === -1;
        } catch (e) {
            return false;
        }
    }

    function isTextyContentType(ct) {
        var s = String(ct || "").toLowerCase();
        if (!s) return true;
        return (
            s.indexOf("text/") === 0 ||
            s.indexOf("json") !== -1 ||
            s.indexOf("html") !== -1 ||
            s.indexOf("xml") !== -1 ||
            s.indexOf("javascript") !== -1 ||
            s.indexOf("svg") !== -1
        );
    }

    function payloadFrom(event, response, extra) {
        var url = event.request.url;
        var base = {
            route: routeFromUrl(url),
            url: url,
            method: event.request.method || "GET",
            status: response && response.status,
            statusText: response && response.statusText,
            ok: !!(response && response.ok),
            requestHeaders: headersObject(event.request.headers),
            responseHeaders: headersObject(response && response.headers),
            contentType: response && response.headers
                ? response.headers.get("content-type")
                : null,
            timestamp: new Date().toISOString(),
            durationMs: null,
            error: null,
            observedAt: Date.now(),
            body: null,
            bodyTruncated: false,
            bodyOmitted: true
        };
        if (extra && typeof extra === "object") {
            for (var k in extra) {
                if (Object.prototype.hasOwnProperty.call(extra, k)) base[k] = extra[k];
            }
        }
        return base;
    }

    self.registerFoobarchPlugin("${PLUGIN_ID}", {
        install: function (ctx) {
            naviHandler = ctx.naviHandler;
            if (typeof ctx.swCallout === "function") {
                ctx.swCallout(
                    "snoopy-observer installed; body≤" + BODY_MAX + "; skip=" + SKIP.join(",")
                );
            }
        },

        observeFetch: function (event, response) {
            if (!naviHandler || !event || !event.request) return;
            var url = event.request.url;
            if (!shouldObserve(url)) return;

            var done = false;
            function finish(extra) {
                if (done) return Promise.resolve(null);
                done = true;
                return naviHandler(
                    "${HANDLER_NAME}",
                    payloadFrom(event, response, extra || null)
                );
            }

            if (!response || typeof response.clone !== "function") {
                return finish(null);
            }
            var ct = response.headers && response.headers.get
                ? response.headers.get("content-type")
                : null;
            if (!isTextyContentType(ct)) {
                return finish({ bodyOmitted: true });
            }

            var cloned;
            try {
                cloned = response.clone();
            } catch (e) {
                return finish(null);
            }

            var bodyP = cloned
                .text()
                .then(function (text) {
                    var full = String(text || "");
                    var truncated = full.length > BODY_MAX;
                    var s = truncated ? full.slice(0, BODY_MAX) : full;
                    return finish({
                        body: s,
                        bodyTruncated: truncated,
                        bodyOmitted: false,
                        bodyBytes: full.length
                    });
                })
                .catch(function () {
                    return finish(null);
                });

            var timeoutP = new Promise(function (resolve) {
                setTimeout(function () {
                    resolve(finish(null));
                }, BODY_TIMEOUT_MS);
            });

            return Promise.race([bodyP, timeoutP]);
        },

        observeFetchError: function (event, error) {
            if (!naviHandler || !event || !event.request) return;
            var url = event.request.url;
            if (!shouldObserve(url)) return;
            return naviHandler("${HANDLER_NAME}", payloadFrom(event, null, {
                status: 0,
                statusText: "",
                ok: false,
                responseHeaders: {},
                contentType: null,
                error: String((error && error.message) || error || "fetch failed"),
                bodyOmitted: true
            }));
        }
    });
})();
`;
}

export const register = (navi) => {
    const isBrowser =
        typeof window !== "undefined" && typeof window.document !== "undefined";

    let mounted = false;
    /** Serialize tip writes per ib so concurrent observes don't all stamp the same n. */
    const recordChainByIb = new Map();

    function withTipLock(ib, fn) {
        const key = String(ib || "");
        const prev = recordChainByIb.get(key) || Promise.resolve();
        const run = prev.then(fn, fn);
        recordChainByIb.set(
            key,
            run.then(
                () => undefined,
                () => undefined
            )
        );
        return run;
    }

    function observationFromFrame(frame) {
        if (!frame || typeof frame !== "object" || !frame.data) return null;
        const d = frame.data;
        const addr = frameAddr(frame);
        return {
            route: d.route || routeFromTipIb(frame.ib) || "",
            url: d.url ?? null,
            method: d.method || "GET",
            status: d.status ?? null,
            statusText: d.statusText || "",
            ok: !!d.ok,
            requestHeaders: d.requestHeaders || {},
            responseHeaders: d.responseHeaders || {},
            contentType: d.contentType || null,
            timestamp: d.timestamp || null,
            observedTimestamp: d.observedTimestamp || null,
            durationMs: d.durationMs ?? null,
            error: d.error || null,
            bodyTruncated: !!d.bodyTruncated,
            bodyOmitted: !!d.bodyOmitted,
            n: d.n ?? 0,
            ib: frame.ib,
            gib: frame.gib || null,
            addr,
            bin: Array.isArray(frame.rel8ns?.bin) ? frame.rel8ns.bin.slice() : [],
        };
    }

    /**
     * Resolve generation: tip.frame space, then live tip, then legacy item/nested.
     */
    async function getArchivedFrame(addr) {
        const a = String(addr || "").trim();
        if (!a) return null;

        try {
            const f = await navi.storage?.tip?.frame?.get?.(a);
            if (f && typeof f === "object") return f;
        } catch {
            /* ignore */
        }

        const caret = a.indexOf("^");
        if (caret > 0) {
            const ib = a.slice(0, caret);
            const gib = a.slice(caret + 1);
            try {
                const tip = await navi.storage.tip.get(ib);
                if (
                    tip &&
                    String(tip.gib || "").toUpperCase() ===
                        String(gib).toUpperCase()
                ) {
                    return tip;
                }
                // Legacy nested data.frames (snoopy 2.2 mistake)
                const map = tip?.data?.frames;
                if (map && typeof map === "object" && map[a]) return map[a];
            } catch {
                /* ignore */
            }
        }

        try {
            const f = await navi.storage.item.get(FRAME_ITEM_PREFIX + a);
            if (f && typeof f === "object") return f;
        } catch {
            /* ignore */
        }
        return null;
    }

    async function getTip(routeOrIb) {
        const raw = String(routeOrIb || "").trim();
        if (!raw) return null;
        const ib = raw.startsWith(TIP_PREFIX) || raw.startsWith("navi/snoopy/")
            ? raw
            : tipIbForRoute(raw);
        if (!ib) return null;
        const tip = await navi.storage.tip.get(ib);
        return tip && typeof tip === "object" ? tip : null;
    }

    /**
     * Walk tip past chain newest-first (current tip + tip.frame archives).
     */
    async function history(route, { max = LINEAGE_MAX } = {}) {
        const tip = await getTip(route);
        if (!tip) return [];
        const out = [];
        let frame = tip;
        let guard = 0;
        const limit = Math.max(1, Number(max) || LINEAGE_MAX);
        while (frame && guard < limit) {
            const rec = observationFromFrame(frame);
            if (rec) out.push(rec);
            const past =
                Array.isArray(frame.rel8ns?.past) && frame.rel8ns.past[0]
                    ? String(frame.rel8ns.past[0])
                    : "";
            if (!past) break;
            guard += 1;
            frame = await getArchivedFrame(past);
            if (!frame) break;
        }
        return out;
    }

    async function listRoutes() {
        const tips = (await navi.storage.tip.list()) || [];
        const routes = [];
        for (const ib of tips) {
            const route = routeFromTipIb(ib);
            if (route != null && route !== "") routes.push(route);
        }
        routes.sort();
        return routes;
    }

    async function recordUnlocked(raw) {
        if (!raw || typeof raw !== "object") return null;
        const route = normalizeRoute(raw.route || raw.url);
        if (!route) return null;
        const ib = tipIbForRoute(route);
        if (typeof navi.storage?.tip?.mut8 !== "function") {
            throw new Error(
                "[snoopy] navi.storage.tip.mut8 unavailable — update navi_shell"
            );
        }

        const prior = await navi.storage.tip.get(ib);

        let binRefs = [];
        const body =
            raw.body != null && String(raw.body).length
                ? String(raw.body)
                : null;
        if (body != null) {
            const mime =
                (raw.contentType && String(raw.contentType).split(";")[0].trim()) ||
                "application/octet-stream";
            const sha = await navi.storage.bin.putMedia({ media: body, mime });
            binRefs = [navi.storage.bin.ref(sha)];
        }

        const observedAt =
            raw.observedAt != null ? Number(raw.observedAt) : Date.now();
        const observedTimestamp =
            typeof navi.stamp?.time === "function"
                ? navi.stamp.time(observedAt)
                : new Date(observedAt).toISOString();
        // Unique every write so content-identical GETs still get a new gib.
        const rid = `${observedAt}-${Math.random().toString(36).slice(2, 10)}`;
        const data = {
            parts: ["snoopy_observation", "ibgib_frame", "manifest", "json"],
            route,
            url: raw.url || null,
            method: raw.method || "GET",
            status: raw.status ?? null,
            statusText: raw.statusText || "",
            ok: !!raw.ok,
            requestHeaders: headersToObject(raw.requestHeaders || {}),
            responseHeaders: headersToObject(raw.responseHeaders || {}),
            contentType: raw.contentType || null,
            durationMs: raw.durationMs ?? null,
            error: raw.error || null,
            bodyTruncated: !!raw.bodyTruncated,
            bodyOmitted: body == null ? true : !!raw.bodyOmitted,
            bodyBytes: raw.bodyBytes ?? null,
            observedAt,
            observedTimestamp,
            rid,
            about: {
                label: `snoopy ${route}`,
                description: `SW observation tip for ${route}`,
            },
        };
        // First tip (no gib yet): mut8 keeps this n; later mut8s bump + keep prior in frame space.
        if (!prior?.gib) data.n = 0;

        const frame = await navi.storage.tip.mut8(ib, data, {
            replaceData: true,
            create: true,
            rel8ns: {
                bin: binRefs,
                tjp: [],
                dna: [],
            },
        });
        return observationFromFrame(frame);
    }

    async function record(raw) {
        if (!raw || typeof raw !== "object") return null;
        const route = normalizeRoute(raw.route || raw.url);
        if (!route) return null;
        const ib = tipIbForRoute(route);
        return withTipLock(ib, () => recordUnlocked(raw));
    }

    function routeMatches(route, wantPath) {
        const have = normalizeRoute(route).toLowerCase();
        const want = normalizeRoute(wantPath).toLowerCase();
        return !!have && !!want && have === want;
    }

    /**
     * Newest-first lineage walk; fromIndex 0 = tip.
     */
    async function findByRoute(path, fromIndex = 0) {
        const hist = await history(path);
        const start = Math.max(0, Number(fromIndex) || 0);
        if (start >= hist.length) return null;
        return { record: hist[start], historyIndex: start };
    }

    /** @deprecated use findByRoute */
    async function findByLastSegment(path, fromIndex = 0) {
        return findByRoute(path, fromIndex);
    }

    const api = {
        skipSegments: [...SKIP_SEGMENTS],
        leadingSegments: [],
        storagePrefix: TIP_PREFIX,
        tipPrefix: TIP_PREFIX,
        bodyMax: BODY_MAX,
        normalizeRoute,
        tipIbForRoute,
        routeFromTipIb,
        routeMatches,
        get: getTip,
        list: listRoutes,
        history,
        findByRoute,
        findByLastSegment,
        observationFromFrame,
        record,
    };

    const HELP = [
        "snoopy — SW fetch observer → tip+bin lineage (v2.4)",
        "",
        `  skip: ${SKIP_SEGMENTS.join(", ") || "(none)"}`,
        "  tip:  navi:snoopy:<route> via navi.storage.tip.mut8",
        "  bin:  texty response bodies (html/json/…) up to " +
            `${Math.round(BODY_MAX / 1024)}KiB (clone+timeout; binary omitted)`,
        "  prior gens at ib^gib in tip.frame space (tip = latest pointer)",
        "  requires navi_shell with tip.mut8 + tip.frame.get/put",
        "  remount after SW update; snoopy status must list snoopy-observer",
        "",
        "  snoopy status",
        "  snoopy get <route>",
        "  snoopy list",
        "  snoopy history <route>",
        "  snoopy del <route>               Delete tip (rebuild lineage by re-surfing)",
        "  snoopy help",
    ].join("\n");

    return {
        name: MODULE_NAME,
        version: "2.6.0",
        description:
            "SW observeFetch → tip.mut8 lineage under navi:snoopy:<route>",

        moduleInfo: {
            name: MODULE_NAME,
            version: "2.6.0",
            description:
                "SW observeFetch → tip+bin; texty bodies via tip.frame (ib^gib)",
        },

        snoopy: api,
        ...api,

        commands: {
            snoopy: {
                name: "snoopy",
                description:
                    "snoopy status|get|list|history|help — tip+bin SW observer",
                execute: async (subcommand, ...args) => {
                    const verb = String(subcommand || "help").toLowerCase();
                    if (verb === "help" || verb === "-h") return HELP;
                    if (verb === "status") {
                        let plugins = [];
                        try {
                            const listed = await navi.sw?.listPlugins?.();
                            plugins = listed?.plugins || listed || [];
                        } catch {
                            plugins = [];
                        }
                        const routes = await listRoutes();
                        return [
                            `mounted: ${mounted ? "yes" : "no"}`,
                            `skip: ${SKIP_SEGMENTS.join(", ") || "(none)"}`,
                            `sw plugin: ${PLUGIN_ID}`,
                            `tips: ${routes.length}`,
                            `plugins: ${Array.isArray(plugins) ? plugins.join(", ") || "(none)" : "(?)"}`,
                        ].join("\n");
                    }
                    if (verb === "get") {
                        // Rejoin with "/" so URL dispatch (segments) and spaced
                        // callin both yield the same route (hypertext/welcome).
                        const route = args.join("/").trim();
                        if (!route) return "usage: snoopy get <route>";
                        const tip = await getTip(route);
                        if (!tip) {
                            return `(no tip for ${normalizeRoute(route)})`;
                        }
                        const obs = observationFromFrame(tip);
                        let bodyPreview = null;
                        const ref = Array.isArray(tip.rel8ns?.bin)
                            ? tip.rel8ns.bin[0]
                            : null;
                        const sha = String(ref || "")
                            .trim()
                            .match(/^bin\s+([0-9a-fA-F]+)$/)?.[1]
                            ?.toLowerCase();
                        if (sha && navi.storage?.bin?.get) {
                            try {
                                const bin = await navi.storage.bin.get(sha);
                                if (bin?.media != null) {
                                    const media = String(bin.media);
                                    bodyPreview = {
                                        mime: bin.mime || null,
                                        bytes: media.length,
                                        media:
                                            media.length > 4000
                                                ? media.slice(0, 4000) +
                                                  "\n…(truncated)"
                                                : media,
                                    };
                                }
                            } catch {
                                /* ignore */
                            }
                        }
                        return JSON.stringify(
                            { ...(obs || tip), bodyPreview },
                            null,
                            2
                        );
                    }
                    if (verb === "list") {
                        const routes = await listRoutes();
                        return routes.length
                            ? routes.map((r) => `  ${r}`).join("\n")
                            : "(no snoopy tips yet)";
                    }
                    if (verb === "history") {
                        const route = args.join("/").trim();
                        if (!route) return "usage: snoopy history <route>";
                        const hist = await history(route);
                        const ib = tipIbForRoute(route);
                        let storeN = null;
                        try {
                            const listed =
                                (await navi.storage?.tip?.frame?.list?.(ib)) ||
                                [];
                            storeN = listed.length;
                        } catch {
                            storeN = null;
                        }
                        const head =
                            storeN == null
                                ? "(tip.frame.list unavailable — update navi_shell)"
                                : `tip.frame.list: ${storeN} generation(s)`;
                        if (!hist.length) {
                            return `${head}\n(no history for ${normalizeRoute(route)})`;
                        }
                        return [
                            head,
                            ...hist.map(
                                (r, i) =>
                                    `  [${i}] n=${r.n ?? "?"} ${r.status ?? ""} ${r.addr || ""} ${r.timestamp || ""}`
                            ),
                        ].join("\n");
                    }
                    if (verb === "del" || verb === "delete" || verb === "rm") {
                        const route = args.join("/").trim();
                        if (!route) return "usage: snoopy del <route>";
                        const ib = tipIbForRoute(route);
                        if (!ib) return "usage: snoopy del <route>";
                        await navi.storage.tip.del(ib);
                        return `deleted tip ${ib} — re-surf to rebuild n chain`;
                    }
                    return `unknown: ${verb}\n\n${HELP}`;
                },
            },
        },

        onMount: async () => {
            if (!isBrowser || !navi.sw) {
                console.warn("[snoopy] browser navi.sw required — skip SW register");
                return;
            }

            navi.sw.on(
                HANDLER_NAME,
                async (payload) => {
                    try {
                        const stored = await api.record(payload);
                        if (!stored) {
                            throw new Error(
                                "[snoopy] record rejected empty payload"
                            );
                        }
                        if (typeof navi.callout === "function") {
                            navi.callout(
                                `[snoopy] ${stored.route} → ${stored.status ?? "?"} n=${stored.n}`
                            );
                        }
                        return {
                            ok: true,
                            ib: stored.ib,
                            addr: stored.addr,
                            n: stored.n,
                        };
                    } catch (err) {
                        console.error("[snoopy] record failed", err);
                        if (typeof navi.callout === "function") {
                            navi.callout(
                                `[snoopy] record failed: ${err?.message || err}`
                            );
                        }
                        throw err;
                    }
                },
                MODULE_NAME
            );

            try {
                await navi.sw.registerPluginSource(
                    PLUGIN_ID,
                    buildPluginSource(SKIP_SEGMENTS, BODY_MAX)
                );
                mounted = true;
                if (typeof navi.callout === "function") {
                    navi.callout(
                        `[snoopy] SW observer on (tip+bin); skip=${SKIP_SEGMENTS.join(",")}`
                    );
                }
            } catch (err) {
                console.error("[snoopy] registerPluginSource failed", err);
                if (typeof navi.callout === "function") {
                    navi.callout(
                        `[snoopy] SW register failed: ${err.message || err}`
                    );
                }
            }
        },

        onUnmount: async () => {
            mounted = false;
            try {
                navi.sw?.off?.(HANDLER_NAME);
            } catch {
                /* ignore */
            }
            try {
                await navi.sw?.unregisterPlugin?.(PLUGIN_ID);
            } catch (err) {
                console.warn("[snoopy] unregisterPlugin failed", err);
            }
        },
    };
};
