/**
 * snoopy_sniff — stage/htmf path → snoopy_object (+1), older-snoop (+1),
 * and field fans (−1) over a snoopy_object.
 *
 * Route from data-path / path / href (live element or presentation). Peels
 * common host path wrappers on lookup. −1 fans surface record fields and the
 * tip ib^gib from response headers when the host exposes one.
 */

function hasType(context, name) {
    const types = Array.isArray(context?.types) ? context.types : [];
    return types.includes(name) || context?.kind === name;
}

function htmlSource(context) {
    return String(
        context?.presentation?.value ??
            context?.value ??
            context?.html ??
            context?.element?.outerHTML ??
            ""
    );
}

/** First opening tag: data-part / data-path / name attrs. */
function parseFirstTag(html) {
    const s = String(html || "").trim();
    const m = s.match(/^<([a-zA-Z][\w:-]*)([^>]*)>/);
    if (!m) return null;
    const attrs = m[2] || "";
    const attr = (name) => {
        const re = new RegExp(
            `${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
            "i"
        );
        const am = attrs.match(re);
        if (!am) return null;
        return am[1] ?? am[2] ?? am[3] ?? null;
    };
    return {
        tag: m[1],
        part: attr("data-part"),
        path: attr("data-path"),
        name: attr("name"),
    };
}

function isSniffSource(context) {
    return (
        hasType(context, "stage-member") ||
        hasType(context, "html") ||
        hasType(context, "htm-element") ||
        hasType(context, "href") ||
        context?.part === "html" ||
        context?.part === "href" ||
        String(context?.part || "")
            .split(/\s+/)
            .includes("href")
    );
}

function looksLikeHtml(raw) {
    return /^\s*</.test(String(raw || ""));
}

function normalizeRoute(raw) {
    let s = String(raw || "")
        .trim()
        .replace(/^https?:\/\/[^/]+/i, "")
        .replace(/^\/+/, "");
    if (s.startsWith("navi:htmf:")) {
        s = s.slice("navi:htmf:".length);
    } else if (s.startsWith("navi:jockey:htmf:")) {
        s = s.slice("navi:jockey:htmf:".length);
    } else if (s.startsWith("navi:jockey:html:")) {
        s = s.slice("navi:jockey:html:".length);
    } else if (s.startsWith("navi:")) {
        s = s.slice("navi:".length);
    }
    return s.replace(/^\/+/, "");
}

/** Peel known host path wrappers for alternate lookup keys. */
function pathCandidates(raw) {
    const out = [];
    const seen = new Set();
    const push = (x) => {
        const n = normalizeRoute(x);
        if (!n || seen.has(n.toLowerCase())) return;
        seen.add(n.toLowerCase());
        out.push(n);
    };

    let cur = normalizeRoute(raw);
    push(cur);

    const WRAP = ["flowerpot/", "manifest/", "horizon/", "foobarch/"];
    for (let i = 0; i < 8 && cur; i++) {
        const lower = cur.toLowerCase();
        let next = null;
        for (const pre of WRAP) {
            if (lower.startsWith(pre)) {
                next = cur.slice(pre.length);
                break;
            }
        }
        if (next == null || next === cur) break;
        push(next);
        cur = next;
    }
    return out;
}

/**
 * Route for snoopy lookup: data-path / path / href on element or presentation.
 * Skips HTML outerHTML that scoped bind contexts sometimes stuff into value.
 */
function resolveSniffPath(context) {
    if (!isSniffSource(context)) return null;

    const presentation = context?.presentation || {};
    const el = context?.element;
    const host = context?.hostElement;
    const fromEl = (node) =>
        node && typeof node.getAttribute === "function"
            ? node.getAttribute("data-path") || node.getAttribute("path")
            : null;
    const first = parseFirstTag(htmlSource(context));

    const asPath = (c) => {
        if (c == null || c === "") return "";
        if (looksLikeHtml(c)) return "";
        return normalizeRoute(c);
    };

    const candidates = [
        context?.href,
        context?.path,
        context?.dataPath,
        presentation.href,
        presentation.path,
        presentation.dataPath,
        // href parts keep the route string in value (when not clobbered to HTML)
        presentation.type === "href" ||
        String(presentation.type || "")
            .split(/\s+/)
            .includes("href") ||
        context?.part === "href" ||
        hasType(context, "href")
            ? presentation.value
            : null,
        !looksLikeHtml(presentation.value) ? presentation.value : null,
        fromEl(el),
        fromEl(host),
        first?.path,
    ];

    for (const c of candidates) {
        const n = asPath(c);
        if (n) {
            return {
                path: n,
                name:
                    (el && typeof el.getAttribute === "function"
                        ? el.getAttribute("name")
                        : null) ||
                    (host && typeof host.getAttribute === "function"
                        ? host.getAttribute("name")
                        : null) ||
                    first?.name ||
                    null,
            };
        }
    }
    return null;
}

function looksLikeAddr(value) {
    const s = String(value || "");
    const caret = s.indexOf("^");
    return caret > 0 && caret < s.length - 1 && !s.slice(caret + 1).includes("^");
}

function looksLikeRoute(value, leadingSegments) {
    const s = String(value || "").trim();
    if (!s || looksLikeAddr(s)) return false;
    if (/^https?:\/\//i.test(s)) return true;
    const first = s.replace(/^\/+/, "").split("/")[0] || "";
    const roots = Array.isArray(leadingSegments) ? leadingSegments.map(String) : [];
    if (first && roots.includes(first)) return true;
    if (s.includes("/") && !/\s/.test(s) && s.length < 512) return true;
    return false;
}

function headerGet(headers, name) {
    const want = String(name || "").toLowerCase();
    for (const [k, v] of headerEntries(headers)) {
        if (String(k).toLowerCase() === want) return headerValue(v);
    }
    return null;
}

function headerValue(v) {
    if (v == null) return null;
    if (Array.isArray(v)) return headerValue(v[0]);
    const s = String(v).trim().replace(/%5e/gi, "^");
    return s || null;
}

function headerEntries(headers) {
    if (!headers) return [];
    if (typeof headers.forEach === "function" && !Array.isArray(headers)) {
        const out = [];
        try {
            headers.forEach((value, name) => {
                out.push([String(name), value]);
            });
        } catch (_) {
            /* ignore */
        }
        if (out.length) return out;
    }
    if (Array.isArray(headers)) {
        return headers.map((row) => {
            if (Array.isArray(row) && row.length >= 2) {
                return [String(row[0]), row[1]];
            }
            if (row && typeof row === "object") {
                return [
                    String(row.name || row.key || row[0] || ""),
                    row.value ?? row.val ?? row[1],
                ];
            }
            return ["", null];
        });
    }
    if (typeof headers === "object") {
        return Object.entries(headers);
    }
    return [];
}

function normalizeHeaderKey(k) {
    let key = String(k || "")
        .toLowerCase()
        .replace(/\s+/g, "")
        .replace(/%5e/gi, "^");
    try {
        key = decodeURIComponent(key);
    } catch (_) {
        /* ignore */
    }
    return key;
}

/** Tip ib^gib from response headers (host-agnostic name shapes). */
function ibgibFromHeaders(headers) {
    const entries = headerEntries(headers).map(([k, v]) => [
        normalizeHeaderKey(k),
        headerValue(v),
    ]);

    const preferred = [
        "x-foobarch-ib^gib",
        "x-foobarch-ibgib",
        "x-ib^gib",
        "x-ibgib",
        "x-flowerpot-ib^gib",
        "x-flowerpot-ibgib",
    ];
    for (const want of preferred) {
        for (const [key, val] of entries) {
            if (key === want && val && looksLikeAddr(val)) return val;
        }
    }
    for (const [key, val] of entries) {
        if (
            val &&
            looksLikeAddr(val) &&
            (key.includes("ib^gib") ||
                key.includes("ibgib") ||
                /ib.?gib/.test(key))
        ) {
            return val;
        }
    }
    for (const [, val] of entries) {
        if (val && looksLikeAddr(val)) return val;
    }
    return null;
}

function ibgibFromBlob(value) {
    if (value == null) return null;
    let blob = "";
    try {
        blob = typeof value === "string" ? value : JSON.stringify(value);
    } catch (_) {
        return null;
    }
    if (!blob) return null;
    const patterns = [
        /x-foobarch-ib\^gib"\s*:\s*"([^"]+)"/i,
        /x-ib\^gib"\s*:\s*"([^"]+)"/i,
        /x-flowerpot-ib\^gib"\s*:\s*"([^"]+)"/i,
        /x-flowerpot-ib%5Egib"\s*:\s*"([^"]+)"/i,
        /"ib\^gib"\s*:\s*"([^"]+\^[^"]+)"/i,
    ];
    for (const re of patterns) {
        const m = blob.match(re);
        const got = headerValue(m?.[1]);
        if (got && looksLikeAddr(got)) return got;
    }
    return null;
}

/** Tip ib^gib: snoopy observation addr, then host response headers. */
function resolveSnoopyIbgib(context) {
    if (!context || typeof context !== "object") return null;
    const direct =
        headerValue(context.ibgib) ||
        headerValue(context.addr) ||
        headerValue(context.record?.addr);
    if (direct && looksLikeAddr(direct)) return direct;
    return (
        ibgibFromHeaders(context.responseHeaders) ||
        ibgibFromHeaders(context.record?.responseHeaders) ||
        ibgibFromHeaders(context.record?.headers) ||
        ibgibFromBlob(context.responseHeaders) ||
        ibgibFromBlob(context.record?.responseHeaders) ||
        ibgibFromBlob(context.record) ||
        null
    );
}

/** Flatten tip frame or observation record into sniff record shape. */
function asSnoopyRecord(value, snoopy) {
    if (!value || typeof value !== "object") return null;
    if (value.route != null && (value.addr || value.status != null)) {
        return value;
    }
    if (value.ib && value.data && typeof snoopy?.observationFromFrame === "function") {
        return snoopy.observationFromFrame(value);
    }
    if (value.ib && value.data) {
        const d = value.data;
        const addr = value.gib ? `${value.ib}^${value.gib}` : value.ib;
        return {
            route: d.route || "",
            url: d.url ?? null,
            method: d.method || "GET",
            status: d.status ?? null,
            statusText: d.statusText || "",
            ok: !!d.ok,
            requestHeaders: d.requestHeaders || {},
            responseHeaders: d.responseHeaders || {},
            contentType: d.contentType || null,
            timestamp: d.timestamp || null,
            error: d.error || null,
            n: d.n ?? 0,
            ib: value.ib,
            gib: value.gib || null,
            addr,
        };
    }
    return value.route != null ? value : null;
}

function policyFromHeaders(headers) {
    return (
        headerGet(headers, "x-foobarch-policy") ||
        headerGet(headers, "x-flowerpot-policy") ||
        null
    );
}

function objectParts(value) {
    const declared = Array.isArray(value?.parts) ? value.parts.map(String) : [];
    if (declared.includes("stage_dir")) {
        return ["stage_dir", "manifest", "json"];
    }
    return ["manifest", "json"];
}

function wrapValue(label, value, leadingSegments) {
    if (value != null && typeof value === "object") {
        const types = objectParts(value);
        return {
            types,
            kind: "manifest",
            label,
            value,
            json: value,
            parts: types,
        };
    }
    const text = value == null ? "" : String(value);
    if (looksLikeAddr(text)) {
        return {
            types: ["ib^gib_addr"],
            kind: "ib^gib_addr",
            label,
            addr: text,
            value: text,
        };
    }
    if (looksLikeRoute(text, leadingSegments)) {
        return {
            types: ["href"],
            kind: "href",
            part: "href",
            label,
            value: text.replace(/^\/+/, ""),
            href: text.replace(/^\/+/, ""),
        };
    }
    return {
        types: ["text"],
        kind: "text",
        part: "text",
        label,
        value: text,
        text,
    };
}

function snoopyObjectFromHit({ record, historyIndex, name, label }) {
    const route = record.route || "";
    const snoopyAddr =
        record.addr && looksLikeAddr(record.addr) ? record.addr : null;
    const ibgibHint =
        snoopyAddr ||
        resolveSnoopyIbgib({
            record,
            responseHeaders: record.responseHeaders,
            addr: record.addr,
        });
    const types = ["snoopy_object", "json"];
    if (ibgibHint) types.splice(1, 0, "ib^gib_addr");
    return {
        types,
        kind: "snoopy_object",
        label: ibgibHint
            ? `${label || `sniff ${route || name}`} · ${ibgibHint.length > 40 ? ibgibHint.slice(0, 40) + "…" : ibgibHint}`
            : label || `sniff ${route || name}`,
        name: name || null,
        historyIndex: Number(historyIndex) || 0,
        route,
        ibgib: ibgibHint,
        ...(ibgibHint ? { addr: ibgibHint } : {}),
        record,
        status: record.status,
        method: record.method,
        url: record.url,
        contentType: record.contentType,
        responseHeaders: record.responseHeaders || {},
        requestHeaders: record.requestHeaders || {},
        timestamp: record.timestamp,
        error: record.error,
        n: record.n,
        snoopyIb: record.ib || null,
    };
}

const HELP = [
    "snoopy_sniff — look up what a path on the page points to.",
    "use: select a stage-member, link, element, or html with stagejockey → +1 \"snoopy-sniff\"",
    "     to fetch its data-path / path / href as a snoopy_object.",
    "     On a snoopy_object: +1 \"older-snoop\" for the previous version, or −1 to pull out a field:",
    "     \"infer ibgib\", \"infer policy\", \"infer record json\", \"infer route\", \"infer url\", \"infer status\".",
    "needs: stagejockey",
].join("\n");

export const register = (navi) => {
    const INTEREST_HEADERS = [
        "x-foobarch-ib^gib",
        "x-ib^gib",
        "x-flowerpot-ib^gib",
        "x-foobarch-policy",
        "x-flowerpot-policy",
    ];

    function snoopyApi() {
        return navi.mod?.snoopy || null;
    }

    /** Used only for wrapValue route-vs-text heuristics; lookup is path-agnostic. */
    function leadingSegments() {
        return [];
    }

    const scrollbufferPlugin = {
        id: "snoopy_sniff",
        name: "snoopy_sniff",
        claims: [
            {
                id: "sniff",
                direction: 1,
                types: ["stage-member", "href", "htm-element", "html"],
                color: "orchid",
                describe: () => ({
                    text: "snoopy-sniff",
                    color: "orchid",
                    textShadow:
                        "0 1px 2px #1a0022, 0 0 2px #000, 0 0 1px #000",
                }),
                matches: (context) => !!resolveSniffPath(context),
                async execute(context) {
                    const meta = resolveSniffPath(context);
                    if (!meta?.path) {
                        throw new Error(
                            "no data-path / path / href — cannot sniff a snoopy route"
                        );
                    }

                    const snoopy = snoopyApi();
                    if (!snoopy || typeof snoopy.findByRoute !== "function") {
                        throw new Error(
                            "snoopy module not mounted (need findByRoute)"
                        );
                    }

                    const tried = pathCandidates(meta.path);
                    let hit = null;
                    let used = meta.path;
                    for (const cand of tried) {
                        const found = await snoopy.findByRoute(cand, 0);
                        const rec = asSnoopyRecord(found?.record, snoopy);
                        if (rec) {
                            hit = { record: rec, historyIndex: found.historyIndex };
                            used = cand;
                            break;
                        }
                    }
                    if (!hit?.record && typeof snoopy.get === "function") {
                        for (const cand of tried) {
                            const tipOrRec = await snoopy.get(cand);
                            const record = asSnoopyRecord(tipOrRec, snoopy);
                            if (record) {
                                hit = { record, historyIndex: 0 };
                                used = cand;
                                break;
                            }
                        }
                    }
                    if (!hit?.record) {
                        throw new Error(
                            `no snoopy tip for path="${meta.path}" (tried ${tried.join(", ")})`
                        );
                    }

                    const ibgibHint =
                        context.presentation?.ibgib || context.ibgib || null;

                    const obj = snoopyObjectFromHit({
                        record: hit.record,
                        historyIndex: hit.historyIndex,
                        name: used,
                        label: `sniff ${hit.record.route || used}`,
                    });
                    if (!obj.ibgib && ibgibHint) {
                        const addr = headerValue(ibgibHint);
                        if (addr && looksLikeAddr(addr)) {
                            obj.ibgib = addr;
                            obj.addr = addr;
                            if (!obj.types.includes("ib^gib_addr")) {
                                obj.types.splice(1, 0, "ib^gib_addr");
                            }
                        }
                    }
                    return obj;
                },
            },
            {
                id: "older-snoop",
                direction: 1,
                types: ["snoopy_object"],
                color: "thistle",
                describe: () => ({
                    text: "older-snoop",
                    color: "thistle",
                    textShadow:
                        "-1px -1px 0 #111, 1px -1px 0 #111, -1px 1px 0 #111, 1px 1px 0 #111",
                }),
                matches: (context) => {
                    if (!hasType(context, "snoopy_object")) return false;
                    const path = context.route || context.name || "";
                    return !!String(path).trim() && context.historyIndex != null;
                },
                async execute(context) {
                    const snoopy = snoopyApi();
                    if (!snoopy || typeof snoopy.findByRoute !== "function") {
                        throw new Error(
                            "snoopy module not mounted (need findByRoute)"
                        );
                    }

                    const path = String(
                        context.route || context.name || ""
                    ).trim();
                    const from = (Number(context.historyIndex) || 0) + 1;
                    const hit = await snoopy.findByRoute(path, from);
                    const record = asSnoopyRecord(hit?.record, snoopy);
                    if (!record) {
                        throw new Error(
                            `no older snoopy frame for path="${path}" past historyIndex ${from - 1}`
                        );
                    }

                    return snoopyObjectFromHit({
                        record,
                        historyIndex: hit.historyIndex,
                        name: path,
                        label: `older ${record.route || path}`,
                    });
                },
            },
            {
                id: "sniff-ibgib",
                direction: -1,
                types: ["snoopy_object"],
                color: "gold",
                describe: () => ({
                    text: "infer ibgib",
                    color: "gold",
                    textShadow:
                        "0 1px 2px #221100, 0 0 2px #000, 0 0 1px #000",
                }),
                matches: (context) => hasType(context, "snoopy_object"),
                execute: (context) => {
                    const addr = resolveSnoopyIbgib(context);
                    if (!addr) {
                        throw new Error(
                            "no ib^gib on snoopy_object (missing tip addr in responseHeaders)"
                        );
                    }
                    return wrapValue("ibgib", addr, leadingSegments());
                },
            },
            {
                id: "sniff-policy",
                direction: -1,
                types: ["snoopy_object"],
                color: "goldenrod",
                describe: () => ({
                    text: "infer policy",
                    color: "goldenrod",
                    textShadow:
                        "0 1px 2px #221100, 0 0 2px #000, 0 0 1px #000",
                }),
                matches: (context) =>
                    hasType(context, "snoopy_object") &&
                    !!policyFromHeaders(context.responseHeaders),
                execute: (context) =>
                    wrapValue(
                        "policy",
                        policyFromHeaders(context.responseHeaders),
                        leadingSegments()
                    ),
            },
            {
                id: "sniff-record",
                direction: -1,
                types: ["snoopy_object"],
                color: "khaki",
                describe: () => ({
                    text: "infer record json",
                    color: "khaki",
                    textShadow:
                        "0 1px 2px #221100, 0 0 2px #000, 0 0 1px #000",
                }),
                matches: (context) => hasType(context, "snoopy_object"),
                execute: (context) =>
                    wrapValue(
                        "snoopy record",
                        context.record || context,
                        leadingSegments()
                    ),
            },
            {
                id: "sniff-route",
                direction: -1,
                types: ["snoopy_object"],
                color: "darkkhaki",
                describe: () => ({
                    text: "infer route",
                    color: "darkkhaki",
                    textShadow: "0 0 3px #fff, 0 0 1px #fff, 0 1px 2px #000",
                }),
                matches: (context) =>
                    hasType(context, "snoopy_object") && !!context.route,
                execute: (context) =>
                    wrapValue("route", context.route, leadingSegments()),
            },
            {
                id: "sniff-url",
                direction: -1,
                types: ["snoopy_object"],
                color: "darkkhaki",
                describe: () => ({
                    text: "infer url",
                    color: "darkkhaki",
                    textShadow: "0 0 3px #fff, 0 0 1px #fff, 0 1px 2px #000",
                }),
                matches: (context) =>
                    hasType(context, "snoopy_object") && !!context.url,
                execute: (context) =>
                    wrapValue("url", context.url, leadingSegments()),
            },
            {
                id: "sniff-status",
                direction: -1,
                types: ["snoopy_object"],
                color: "tan",
                describe: () => ({
                    text: "infer status",
                    color: "tan",
                    textShadow:
                        "0 1px 2px #221100, 0 0 2px #000, 0 0 1px #000",
                }),
                matches: (context) =>
                    hasType(context, "snoopy_object") && context.status != null,
                execute: (context) =>
                    wrapValue("status", context.status, leadingSegments()),
            },
        ],
    };

    return {
        name: "snoopy_sniff",
        commands: {
            snoopy_sniff: { name: "snoopy_sniff", description: "help", execute: async () => HELP },
        },
        version: "0.3.4",
        description:
            "Scrollbuffer sniff: path→snoopy tip+bin lineage (htm-element, not exclusive htmf)",
        moduleInfo: {
            name: "snoopy_sniff",
            version: "0.3.4",
            description:
                "Scrollbuffer sniff binds htm-element / href / stage-member (no htmf)",
        },
        INTEREST_HEADERS,
        scrollbufferPlugin,
    };
};
