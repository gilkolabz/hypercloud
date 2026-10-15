/**
 * cursor_edit_client — browser-safe client for cursor_edit_v1.
 *
 * Spec-driven: any browser mod can call edit(pack). Does not require stagejockey.
 * Relays POST JSON to navi-{alias}/cursor_sdk/edit on navi.origin (default alias hq01).
 *
 * Callin:
 *   cursor_edit_client help|status|last
 *   cursor_edit_client alias [name]
 *   cursor_edit_client origin [url|-]
 *   cursor_edit_client token [<token>|-]  # relay alias token for the current alias
 *   cursor_edit_client run <prompt…>     # freeform pack (no selection)
 *
 */

export const register = (navi) => {
    const eventListeners = [];
    const createdElements = [];
    const timers = [];

    const VERSION = "0.2.2";
    const PREFS_IB = "navi:cursor_edit_client:prefs";
    const LAST_IB = "navi:cursor_edit_client:last";
    const CALLIN_ALLOW = /^(mount|remount|unmount)\//i;

    /** @type {Map<string, Function>} */
    const opHandlers = new Map();

    const state = {
        alias: "hq01",
        origin: "",
        /** Relay alias tokens by alias (sent as X-Navi-Shell-Usage-Token; never echoed). */
        tokens: {},
        finalityEl: null,
        last: null,
    };

    const callout = (msg) => {
        try {
            navi.callout?.(msg);
        } catch {
            /* ignore */
        }
    };

    const originHost = () => {
        const o =
            state.origin ||
            (typeof navi.origin === "string" && navi.origin) ||
            (typeof navi.getOrigin === "function" && navi.getOrigin()) ||
            "";
        return String(o || "https://foobarch.net").replace(/\/+$/, "");
    };

    async function loadPrefs() {
        try {
            const tip = await navi.storage.tip.get(PREFS_IB);
            const d = tip?.data || {};
            if (typeof d.alias === "string" && d.alias.trim()) {
                state.alias = d.alias.trim().replace(/^navi-/i, "");
            }
            if (typeof d.origin === "string") {
                state.origin = d.origin.trim();
            }
            state.tokens =
                d.tokens && typeof d.tokens === "object" ? { ...d.tokens } : {};
        } catch {
            /* ignore */
        }
        return {
            alias: state.alias,
            origin: state.origin || originHost(),
            token: state.tokens[state.alias] ? "set" : "none",
        };
    }

    async function savePrefs(patch = {}) {
        if (patch.alias != null) {
            state.alias = String(patch.alias)
                .trim()
                .replace(/^navi-/i, "") || state.alias;
        }
        if (patch.origin != null) {
            const o = String(patch.origin).trim();
            state.origin = o === "-" ? "" : o;
        }
        if (patch.token != null) {
            const t = String(patch.token).trim();
            const tokens = { ...state.tokens };
            if (!t || t === "-" || t === "clear" || t === "none") delete tokens[state.alias];
            else tokens[state.alias] = t;
            state.tokens = tokens;
        }
        await navi.storage.tip.mut8(
            PREFS_IB,
            {
                parts: [
                    "cursor_edit_client_prefs",
                    "ibgib_frame",
                    "manifest",
                    "json",
                ],
                about: {
                    label: PREFS_IB,
                    description: "cursor_edit_client relay alias + origin + alias tokens",
                },
                alias: state.alias,
                origin: state.origin,
                tokens: state.tokens,
            },
            { create: true, replaceData: true }
        );
        return loadPrefs();
    }

    function parseCursorEditV1(text) {
        const raw = String(text || "");
        const tryParse = (s) => {
            try {
                const o = JSON.parse(s);
                if (o && typeof o === "object" && Number(o.v) === 1) {
                    return { v: 1, ops: Array.isArray(o.ops) ? o.ops : [] };
                }
            } catch {
                /* ignore */
            }
            return null;
        };
        const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
        if (fence) {
            const hit = tryParse(fence[1].trim());
            if (hit) return hit;
        }
        const start = raw.indexOf("{");
        const end = raw.lastIndexOf("}");
        if (start >= 0 && end > start) {
            const hit = tryParse(raw.slice(start, end + 1));
            if (hit) return hit;
        }
        return null;
    }

    function registerOpHandler(op, fn) {
        const id = String(op || "").trim();
        if (!id || typeof fn !== "function") {
            throw new Error("registerOpHandler(op, fn) required");
        }
        opHandlers.set(id, fn);
        return () => opHandlers.delete(id);
    }

    async function applyOp(op, ctx) {
        const kind = String(op?.op || "").trim();
        if (!kind) return { ok: false, error: "missing op" };
        const custom = opHandlers.get(kind);
        if (custom) return custom(op, ctx);

        if (kind === "replace_outerHTML") {
            const hash = String(op.dataHash || "").trim();
            const html = String(op.html ?? "");
            const esc =
                typeof CSS !== "undefined" && typeof CSS.escape === "function"
                    ? CSS.escape
                    : (s) => String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
            let el =
                (hash && document.querySelector(`[data-hash="${esc(hash)}"]`)) ||
                ctx?.selectionEl ||
                null;
            if (!(el instanceof HTMLElement)) {
                return { ok: false, error: `no element for hash ${hash}` };
            }
            const wrap = document.createElement("div");
            wrap.innerHTML = html.trim();
            const next = wrap.firstElementChild;
            if (!next) return { ok: false, error: "empty html" };
            el.replaceWith(next);
            const stage = navi.mod?.stagedir || navi.mod?.horizon_stagedir;
            if (typeof stage?.activate === "function") {
                try {
                    stage.activate(next);
                } catch {
                    /* ignore */
                }
            }
            if (typeof stage?.persist === "function") {
                try {
                    await stage.persist();
                } catch {
                    /* ignore */
                }
            }
            return { ok: true, op: kind, dataHash: hash };
        }

        if (kind === "replace_text") {
            const hash = String(op.dataHash || "").trim();
            const text = String(op.text ?? "");
            const esc =
                typeof CSS !== "undefined" && typeof CSS.escape === "function"
                    ? CSS.escape
                    : (s) => String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
            let el =
                (hash && document.querySelector(`[data-hash="${esc(hash)}"]`)) ||
                ctx?.selectionEl ||
                null;
            if (!(el instanceof HTMLElement)) {
                return { ok: false, error: `no element for hash ${hash}` };
            }
            el.textContent = text;
            const stage = navi.mod?.stagedir || navi.mod?.horizon_stagedir;
            if (typeof stage?.persist === "function") {
                try {
                    await stage.persist();
                } catch {
                    /* ignore */
                }
            }
            return { ok: true, op: kind, dataHash: hash };
        }

        if (kind === "callin") {
            const path = String(op.path || "").trim().replace(/^\/+/, "");
            if (!CALLIN_ALLOW.test(path)) {
                return {
                    ok: false,
                    error: `callin not allowlisted: ${path}`,
                };
            }
            const out = await navi.callin(path);
            return { ok: true, op: kind, path, out: String(out).slice(0, 400) };
        }

        return { ok: false, error: `unknown op ${kind}` };
    }

    async function applyOps(ops, ctx = {}) {
        const list = Array.isArray(ops) ? ops : [];
        const results = [];
        for (const op of list) {
            try {
                results.push(await applyOp(op, ctx));
            } catch (e) {
                results.push({ ok: false, error: e.message || String(e), op });
            }
        }
        return results;
    }

    async function relayEdit(pack) {
        await loadPrefs();
        const alias = String(pack?.alias || state.alias || "hq01")
            .trim()
            .replace(/^navi-/i, "");
        const origin = originHost();
        const url = `${origin}/navi-${alias}/cursor_sdk/edit`;
        const body = JSON.stringify({
            prompt: pack?.prompt || "",
            selection: pack?.selection || {},
            navi: {
                origin,
                mods: Object.keys(navi.mod || {}),
                ...(pack?.navi && typeof pack.navi === "object" ? pack.navi : {}),
            },
            extras: pack?.extras || {},
        });
        callout(`[cursor_edit] → ${alias} …`);
        const headers = {
            "Content-Type": "application/json",
            "X-Navi-Shell-Wait": "1",
        };
        if (state.tokens[alias]) headers["X-Navi-Shell-Usage-Token"] = state.tokens[alias];
        const res = await fetch(url, { method: "POST", headers, body });
        const text = await res.text();
        if (!res.ok) {
            throw new Error(`edit ${res.status}: ${text.slice(0, 400)}`);
        }
        let parsedBody = null;
        try {
            parsedBody = JSON.parse(text);
        } catch {
            parsedBody = null;
        }
        const resultText =
            (parsedBody && parsedBody.result) ||
            (typeof parsedBody === "string" ? parsedBody : text);
        const opsFromBody = Array.isArray(parsedBody?.ops)
            ? parsedBody.ops
            : null;
        const parsed =
            opsFromBody != null
                ? { v: 1, ops: opsFromBody }
                : parseCursorEditV1(resultText);
        return {
            ok: parsedBody?.ok !== false,
            status: res.status,
            alias,
            raw: text,
            result: resultText,
            ops: parsed?.ops || [],
            parsed,
            body: parsedBody,
        };
    }

    function finalityPayload(out, applied) {
        const ops = Array.isArray(out.ops) ? out.ops : [];
        return {
            v: 1,
            ok: out.ok !== false,
            alias: out.alias,
            ops,
            parsed: out.parsed || (ops.length ? { v: 1, ops } : null),
            applied: applied || [],
            result: out.result == null ? null : String(out.result),
            raw: out.raw == null ? null : String(out.raw),
            at: Date.now(),
        };
    }

    async function saveLast(payload) {
        state.last = payload;
        try {
            await navi.storage.tip.mut8(
                LAST_IB,
                {
                    parts: [
                        "cursor_edit_client_last",
                        "ibgib_frame",
                        "manifest",
                        "json",
                    ],
                    about: {
                        label: LAST_IB,
                        description: "last cursor_edit relay result on this shell",
                    },
                    ...payload,
                },
                { create: true, replaceData: true }
            );
        } catch {
            /* ignore tip write */
        }
    }

    function escapeHtml(s) {
        return String(s || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    /** Small safe markdown → HTML (fences, headings, lists, inline). */
    function mdToHtml(src) {
        const text = String(src || "");
        if (!text.trim()) {
            return `<p style="margin:0;opacity:.6;">(empty result)</p>`;
        }
        const fences = [];
        let work = text.replace(/```([\w-]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
            const i = fences.length;
            fences.push(
                `<pre style="margin:0.4rem 0;padding:0.4rem;overflow:auto;background:#f4f4f4;border:1px solid #ccc;"><code>${escapeHtml(
                    code.replace(/\n$/, "")
                )}</code></pre>`
            );
            return `\u0000FENCE${i}\u0000`;
        });
        const lines = work.split(/\r?\n/);
        const out = [];
        let listOpen = null;
        const closeList = () => {
            if (listOpen) {
                out.push(`</${listOpen}>`);
                listOpen = null;
            }
        };
        const inline = (line) => {
            let s = escapeHtml(line);
            s = s.replace(
                /`([^`]+)`/g,
                "<code style=\"background:#f0f0f0;padding:0 0.2em;\">$1</code>"
            );
            s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
            s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
            s = s.replace(
                /\[([^\]]+)\]\((https?:[^)\s]+)\)/g,
                '<a href="$2" target="_blank" rel="noopener">$1</a>'
            );
            return s;
        };
        for (const line of lines) {
            const fenceHit = line.match(/^\u0000FENCE(\d+)\u0000$/);
            if (fenceHit) {
                closeList();
                out.push(fences[Number(fenceHit[1])] || "");
                continue;
            }
            const h = line.match(/^(#{1,3})\s+(.*)$/);
            if (h) {
                closeList();
                const n = h[1].length;
                out.push(
                    `<h${n} style="margin:0.45rem 0 0.2rem;font-size:${
                        n === 1 ? "1.15em" : n === 2 ? "1.05em" : "1em"
                    };">${inline(h[2])}</h${n}>`
                );
                continue;
            }
            const ul = line.match(/^\s*[-*]\s+(.*)$/);
            if (ul) {
                if (listOpen !== "ul") {
                    closeList();
                    out.push('<ul style="margin:0.25rem 0 0.25rem 1.1rem;padding:0;">');
                    listOpen = "ul";
                }
                out.push(`<li>${inline(ul[1])}</li>`);
                continue;
            }
            const ol = line.match(/^\s*\d+\.\s+(.*)$/);
            if (ol) {
                if (listOpen !== "ol") {
                    closeList();
                    out.push('<ul style="margin:0.25rem 0 0.25rem 1.1rem;padding:0;list-style:decimal;">');
                    listOpen = "ul";
                }
                out.push(`<li>${inline(ol[1])}</li>`);
                continue;
            }
            if (!line.trim()) {
                closeList();
                out.push('<div style="height:0.35rem;"></div>');
                continue;
            }
            closeList();
            out.push(`<p style="margin:0.2rem 0;">${inline(line)}</p>`);
        }
        closeList();
        return out.join("");
    }

    function showRawOverlay(payload) {
        const existing = document.getElementById("cursor-edit-raw");
        if (existing) existing.remove();
        const opsN = Array.isArray(payload?.ops) ? payload.ops.length : 0;
        const rawObj = {
            v: 1,
            ops: payload?.ops || [],
            parsed: payload?.parsed || null,
            applied: payload?.applied || [],
            result: payload?.result || null,
            raw: payload?.raw || null,
            alias: payload?.alias || null,
            at: payload?.at || null,
            note:
                opsN > 0
                    ? null
                    : "agent did not return parseable cursor_edit_v1 ops",
        };
        const overlay = document.createElement("div");
        overlay.id = "cursor-edit-raw";
        overlay.style.cssText =
            "position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:1rem;box-sizing:border-box;";
        const sheet = document.createElement("div");
        sheet.style.cssText =
            "background:#fff;color:#111;border:double 4px #000;max-width:min(48rem,96vw);max-height:min(80vh,36rem);overflow:auto;padding:0.75rem;font:12px/1.35 ui-monospace,Consolas,monospace;width:100%;box-sizing:border-box;";
        sheet.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;margin:0 0 0.5rem;">
            <strong>raw</strong>
            <button type="button" id="ce-raw-x" style="font:inherit;cursor:pointer;">close</button>
          </div>
          <pre id="ce-raw-pre" style="margin:0;white-space:pre-wrap;word-break:break-word;"></pre>`;
        sheet.querySelector("#ce-raw-pre").textContent = JSON.stringify(
            rawObj,
            null,
            2
        );
        const close = () => overlay.remove();
        sheet.querySelector("#ce-raw-x").onclick = close;
        overlay.onclick = (e) => {
            if (e.target === overlay) close();
        };
        overlay.appendChild(sheet);
        document.documentElement.appendChild(overlay);
        createdElements.push(overlay);
        return overlay;
    }

    function showFinality(payload) {
        const existing = document.getElementById("cursor-edit-finality");
        if (existing) existing.remove();
        const box = document.createElement("div");
        box.id = "cursor-edit-finality";
        box.setAttribute("data-part", "htmf");
        box.setAttribute("name", "cursor_edit_finality");
        box.style.cssText =
            "position:fixed;z-index:2147483645;right:0.75rem;bottom:0.75rem;left:auto;max-width:min(36rem,92vw);max-height:min(50vh,24rem);overflow:auto;background:#fff;color:#111;border:double 4px #000;padding:0.65rem 0.75rem;font:13px/1.4 system-ui,Segoe UI,sans-serif;box-shadow:0 0 0 2px #0f0, 0 8px 24px rgba(0,0,0,.35);";
        const opsN = Array.isArray(payload?.ops) ? payload.ops.length : 0;
        const title =
            opsN > 0
                ? `cursor edit — ${opsN} op(s) applied path`
                : "cursor edit — result";
        const mdSrc =
            payload?.result != null && String(payload.result).trim()
                ? String(payload.result)
                : opsN > 0
                  ? `Applied **${opsN}** op(s). Use **raw** for the JSON payload.`
                  : "_(empty result)_";
        box.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;gap:0.5rem;margin:0 0 0.45rem;flex-wrap:wrap;">
            <strong style="color:#000;text-shadow:0 0 6px lime, 0 1px 2px #0f0;font:12px/1.35 ui-monospace,Consolas,monospace;">${escapeHtml(
                title
            )}</strong>
            <span style="display:flex;gap:0.35rem;">
              <button type="button" id="ce-fin-raw" style="font:12px ui-monospace,Consolas,monospace;cursor:pointer;">raw</button>
              <button type="button" id="ce-fin-x" style="font:12px ui-monospace,Consolas,monospace;cursor:pointer;">close</button>
            </span>
          </div>
          <div id="ce-fin-md" style="font:inherit;"></div>`;
        box.querySelector("#ce-fin-md").innerHTML = mdToHtml(mdSrc);
        box.querySelector("#ce-fin-raw").onclick = () => showRawOverlay(payload);
        box.querySelector("#ce-fin-x").onclick = () => {
            box.remove();
            if (state.finalityEl === box) state.finalityEl = null;
        };
        document.documentElement.appendChild(box);
        createdElements.push(box);
        state.finalityEl = box;
        return box;
    }

    async function edit(pack, ctx = {}) {
        const out = await relayEdit(pack || {});
        const applied = await applyOps(out.ops, ctx);
        const payload = finalityPayload(out, applied);
        await saveLast(payload);
        showFinality(payload);
        const summary = {
            ok: out.ok,
            alias: out.alias,
            ops: out.ops.length,
            applied,
            resultPreview: String(out.result || "").slice(0, 500),
            lastIb: LAST_IB,
        };
        callout(
            `[cursor_edit] done ops=${out.ops.length} applied_ok=${
                applied.filter((a) => a.ok).length
            }`
        );
        if (!out.ops.length) {
            callout(
                `[cursor_edit] no cursor_edit_v1 — finality box + tip ${LAST_IB}`
            );
        }
        return { ...out, applied, summary, last: payload };
    }

    const HELP = [
        `cursor_edit_client v${VERSION} — browser client for cursor_edit_v1`,
        "",
        "  cursor_edit_client help|status|last",
        "  cursor_edit_client alias [name]",
        "  cursor_edit_client origin [url|-]",
        "  cursor_edit_client token [<token>|-]   alias token for the current alias (from: relay alias-token <alias> new);",
        "                                         sent as X-Navi-Shell-Usage-Token, never shown back.",
        "  cursor_edit_client run <prompt…>",
        "",
        "API: navi.mod.cursor_edit_client.edit(pack)",
        "     .registerOpHandler(op, fn)",
        `Prefs tip: ${PREFS_IB}`,
        `Last tip:  ${LAST_IB}`,
    ].join("\n");

    const run = async (...rawArgs) => {
        const args = rawArgs
            .flatMap((a) =>
                typeof a === "string" ? a.split(/\s+/).filter(Boolean) : [a]
            )
            .map((a) => String(a))
            .filter(Boolean);
        const verb = String(args[0] || "help").toLowerCase();
        await loadPrefs();
        try {
            if (verb === "help" || verb === "") return HELP;
            if (verb === "status") {
                return JSON.stringify(
                    {
                        version: VERSION,
                        alias: state.alias,
                        origin: originHost(),
                        token: state.tokens[state.alias] ? "set" : "none",
                        handlers: [...opHandlers.keys()],
                    },
                    null,
                    2
                );
            }
            if (verb === "last") {
                if (!state.last) {
                    try {
                        const tip = await navi.storage.tip.get(LAST_IB);
                        state.last = tip?.data || null;
                    } catch {
                        state.last = null;
                    }
                }
                if (!state.last) return `(empty) tip ${LAST_IB}`;
                showFinality(state.last);
                return `finality open (tip ${LAST_IB})`;
            }
            if (verb === "alias") {
                if (args[1] == null) return state.alias;
                await savePrefs({ alias: args[1] });
                return state.alias;
            }
            if (verb === "token") {
                if (args[1] != null) await savePrefs({ token: args[1] });
                return `${state.alias}: alias token ${state.tokens[state.alias] ? "set" : "none"}`;
            }
            if (verb === "origin") {
                if (args[1] == null) return originHost();
                await savePrefs({ origin: args.slice(1).join(" ") });
                return originHost();
            }
            if (verb === "run" || verb === "edit") {
                const prompt = args.slice(1).join(" ").trim();
                if (!prompt) return "usage: cursor_edit_client run <prompt…>";
                const r = await edit({ prompt });
                return `done ops=${r.ops?.length || 0} — finality + tip ${LAST_IB}`;
            }
            return `unknown: ${verb}\n\n${HELP}`;
        } catch (e) {
            return `error: ${e.message || e}`;
        }
    };

    return {
        name: "cursor_edit_client",
        version: VERSION,
        description:
            "Browser client for cursor_edit_v1 — relay to native cursor_sdk, apply ops locally",
        moduleInfo: {
            name: "cursor_edit_client",
            version: VERSION,
            description:
                "Spec-driven edit client; alias/origin/token prefs; registerOpHandler",
        },
        edit,
        applyOps,
        parseCursorEditV1,
        registerOpHandler,
        loadPrefs,
        savePrefs,
        showFinality,
        getLast: () => state.last,
        commands: {
            cursor_edit_client: {
                name: "cursor_edit_client",
                description:
                    "cursor_edit_client alias|origin|token|run — browser cursor_edit_v1 client",
                execute: async (...args) => run(...args),
            },
        },
        onMount: async () => {
            await loadPrefs();
            console.log(
                `[cursor_edit_client] ready v${VERSION} alias=${state.alias}`
            );
        },
        onUnmount: () => {
            for (const el of createdElements) {
                try {
                    el.remove();
                } catch {
                    /* ignore */
                }
            }
            for (const t of timers) clearTimeout(t);
            for (const { target, type, fn, opts } of eventListeners) {
                try {
                    target.off?.(type, fn);
                    target.removeEventListener?.(type, fn, opts);
                } catch {
                    /* ignore */
                }
            }
        },
    };
};
