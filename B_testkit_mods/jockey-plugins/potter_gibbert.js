/**
 * potter_gibbert — from ib^gib_addr, fetch the IbGib graph-node frame from the
 * live network host (`/_foobarch/frame?addr=`), not a remote flowerpot base.
 *
 * Two claim processors:
 *   gibbert       — plain addr string (context.addr / value / presentation.value)
 *   gibbert-html  — HTML-wrapped part: first <> has data-part="ib^gib_addr",
 *                   innerHTML until </> is the address bytes
 *
 * Caveat: the resulting object is an attempt at the frame for that addr on the
 * current host. It may not be the true ibgib of whatever is currently on screen.
 */

function hasType(context, name) {
    const types = Array.isArray(context?.types) ? context.types : [];
    return types.includes(name) || context?.kind === name;
}

function looksLikeHtml(raw) {
    return /^\s*</.test(String(raw || ""));
}

/**
 * First opening tag: require data-part=ib^gib_addr; inner until last </ is addr.
 * @returns {string|null}
 */
function parseAddrFromPartHtml(html) {
    const s = String(html || "").trim();
    const open = s.match(/^<([a-zA-Z][\w:-]*)([^>]*)>/);
    if (!open) return null;
    const attrs = open[2] || "";
    const partMatch = attrs.match(
        /data-part\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i
    );
    const part = String(
        partMatch?.[1] ?? partMatch?.[2] ?? partMatch?.[3] ?? ""
    )
        .trim()
        .toLowerCase();
    if (part !== "ib^gib_addr") return null;

    const start = s.indexOf(">") + 1;
    const end = s.lastIndexOf("</");
    if (start <= 0 || end < start) return null;
    const addr = s.slice(start, end).trim();
    if (!addr || !addr.includes("^") || addr.includes("<")) return null;
    return addr;
}

function rawAddrCandidate(context) {
    return String(
        context?.addr ||
            context?.value ||
            context?.presentation?.value ||
            context?.presentation?.addr ||
            context?.element?.outerHTML ||
            ""
    ).trim();
}

/** Plain non-HTML address with a caret. */
function resolvePlainAddr(context) {
    const raw = rawAddrCandidate(context);
    if (!raw || looksLikeHtml(raw)) return "";
    return raw.includes("^") ? raw : "";
}

/** Address extracted from HTML part wrapper. */
function resolveHtmlAddr(context) {
    const raw = rawAddrCandidate(context);
    if (!raw || !looksLikeHtml(raw)) return "";
    return parseAddrFromPartHtml(raw) || "";
}

function frameResult(addr, frame) {
    return {
        types: ["ibgib_frame", "manifest", "json"],
        kind: "ibgib_frame",
        part: "ibgib_frame",
        parts: ["ibgib_frame", "manifest", "json"],
        label: `ibgib_frame ${addr}`,
        addr,
        frame,
        value: frame,
        json: frame,
        attempted: true,
        note:
            "May not be the true ibgib of what was on screen — host frame fetch attempt only.",
    };
}

function frameUrl(navi, addr) {
    const path = `/_foobarch/frame?addr=${encodeURIComponent(addr)}`;
    if (typeof navi?.resolveUrl === "function") {
        return navi.resolveUrl(path);
    }
    const origin =
        (typeof globalThis !== "undefined" && globalThis.location?.origin) ||
        "";
    return origin ? `${origin}${path}` : path;
}

async function fetchHostFrame(navi, addr) {
    if (!addr || !addr.includes("^")) {
        throw new Error("ib^gib_addr missing caret address");
    }
    const url = frameUrl(navi, addr);
    const res = await fetch(url, { method: "GET" });
    const text = await res.text();
    if (!res.ok) {
        throw new Error(`GET ${_short(url)} → ${res.status}: ${text.slice(0, 200)}`);
    }
    let frame = null;
    try {
        frame = JSON.parse(text);
    } catch {
        throw new Error(`GET frame returned non-JSON for ${addr}`);
    }
    const got =
        res.headers.get("x-foobarch-ib^gib") ||
        res.headers.get("X-Foobarch-ib^gib") ||
        addr;
    return { addr: got, frame };
}

function _short(url) {
    try {
        const u = new URL(url, "http://local");
        return u.pathname + u.search;
    } catch {
        return String(url);
    }
}

/** Bright lime + hard black outline — readable on dark overlays. */
const GIBBERT_STYLE = {
    color: "lime",
    textShadow:
        "-1px -1px 0 #111, 1px -1px 0 #111, -1px 1px 0 #111, 1px 1px 0 #111",
};

const HELP = [
    "potter_gibbert — open the ibgib frame behind an ib^gib address.",
    "use: select an ib^gib address with stagejockey → +1 \"gibbert\" (plain text)",
    "     or +1 \"gibbert (html part)\" (address inside a data-part=\"ib^gib_addr\" element).",
    "     It fetches that frame from the current host and puts it on the stage.",
    "The result is what this host has for that address, which may not match what is on screen.",
    "needs: stagejockey",
].join("\n");

export const register = (navi) => {
    const scrollbufferPlugin = {
        id: "potter_gibbert",
        name: "potter_gibbert",
        claims: [
            {
                id: "gibbert",
                direction: 1,
                types: ["ib^gib_addr"],
                color: GIBBERT_STYLE.color,
                describe: () => ({
                    text: "gibbert",
                    color: GIBBERT_STYLE.color,
                    textShadow: GIBBERT_STYLE.textShadow,
                }),
                matches: (context) =>
                    hasType(context, "ib^gib_addr") && !!resolvePlainAddr(context),
                async execute(context) {
                    const { addr, frame } = await fetchHostFrame(
                        navi,
                        resolvePlainAddr(context)
                    );
                    return frameResult(addr, frame);
                },
            },
            {
                id: "gibbert-html",
                direction: 1,
                types: ["ib^gib_addr"],
                color: "lawngreen",
                describe: () => ({
                    text: "gibbert (html part)",
                    color: "lawngreen",
                    textShadow: GIBBERT_STYLE.textShadow,
                }),
                matches: (context) =>
                    hasType(context, "ib^gib_addr") && !!resolveHtmlAddr(context),
                async execute(context) {
                    const { addr, frame } = await fetchHostFrame(
                        navi,
                        resolveHtmlAddr(context)
                    );
                    return frameResult(addr, frame);
                },
            },
        ],
    };

    return {
        name: "potter_gibbert",
        commands: {
            potter_gibbert: { name: "potter_gibbert", description: "help", execute: async () => HELP },
        },
        version: "0.3.1",
        description:
            "Scrollbuffer: ib^gib_addr → host /_foobarch/frame ibgib_frame",
        moduleInfo: {
            name: "potter_gibbert",
            version: "0.3.1",
            description:
                "Scrollbuffer: ib^gib_addr → host /_foobarch/frame ibgib_frame",
        },
        scrollbufferPlugin,
    };
};
