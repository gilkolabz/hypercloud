/**
 * jockey_netproposer — jockey +1 "hostpark…" on text parts, images, htmf,
 * and stage-members (not bare htm-element). Opens a small panel to confirm
 * what will be published, the host and path (the element's own data-path,
 * else typed by the user; the stagejockey prefix navi:pref:ix goes in front
 * when set), then sends it through netproposer (one navi.tokens usage token
 * per save). Hostparking an htmf stamps that path onto the outermost
 * data-part htmf in the parked source.
 *
 * Send is greyed out when the host has no tokens in navi.tokens.
 *
 * Stage-members: "hostpark stage-member…" also writes the member's column,
 * position, and type into the frame (data.stage_dir) so `stagedir place <path>`
 * can put it back on a stage.
 *
 * Each hostpark claim (and the stagejockey menu item) has a "localpark…" twin:
 * same panel and path rules, saved as a local park tip (method GET → bin) in
 * this browser instead of being sent to a host.
 *
 * "scranton - post on this page…" (stage-members): hostparks the member as a stage_member
 * post (data.post names the page, its lobby, and the author's lobby key), then
 * appends it, signed, to the surfed page's scranton lobby (needs scranton_lobby
 * ≥ 1.9.0 + keychain). See surfroster_stage_member.
 *
 * Policy dropdown: "write protect" = hostparkinator keys policy frame
 * policies/keys/<pubkey16> (foobarch.schema.keys.v1, threshold 1, keys [keychain
 * default], self-locked) — reused if saved or already on the host, else created
 * (+2 tokens). Attached via rel8ns.policy to every new path the panel writes.
 *
 * Requires: supermouse_plugin_stagejockey, netproposer ≥ 0.4.1 (stagedir ≥ 3.7.17 for stage-members)
 */

const TEXT_TYPES = ["text", "word", "phrase", "char", "inner-html", "text-html"];
const IMAGE_PARTS = ["png", "jpeg", "jpg", "gif", "webp", "svg", "image"];
const HTML_VIRTUALS = new Set(["inner-html", "text-html"]);
const VERSION = "0.9.4";
const PREF_IX_KEY = "navi:pref:ix";
const COLOR = "#ffb347";
const SHADOW = "0 1px 2px #2a1400, 0 0 2px #000, 0 0 1px #000";

function liveEl(context) {
    const el = context?.element;
    return typeof HTMLElement !== "undefined" && el instanceof HTMLElement ? el : null;
}

function partList(n) {
    return String(n?.getAttribute?.("data-part") || "")
        .trim()
        .split(/\s+/)
        .filter(Boolean);
}

function isHtmfEl(n) {
    return partList(n).includes("htmf");
}

/** Nearest ancestor-or-self with data-part htmf. */
function htmfHostFrom(el) {
    let n = el && el.nodeType === 1 ? el : null;
    while (n) {
        if (isHtmfEl(n)) return n;
        n = n.parentElement;
    }
    return null;
}

/**
 * Stamp data-path on the outermost htmf in an HTML fragment (the first
 * data-part=htmf in tree order, which is the outermost when nested).
 */
function stampHtmfDataPath(html, path) {
    const p = cleanPath(path);
    if (!p || typeof document === "undefined") return String(html ?? "");
    const wrap = document.createElement("div");
    wrap.innerHTML = String(html ?? "");
    const walk = (node) => {
        if (!node || node.nodeType !== 1) return null;
        if (isHtmfEl(node)) return node;
        for (const c of node.children) {
            const hit = walk(c);
            if (hit) return hit;
        }
        return null;
    };
    let target = null;
    for (const child of wrap.children) {
        target = walk(child);
        if (target) break;
    }
    if (!target) return wrap.innerHTML || String(html ?? "");
    target.setAttribute("data-path", p);
    return wrap.childElementCount === 1 && wrap.firstElementChild
        ? wrap.firstElementChild.outerHTML
        : wrap.innerHTML;
}

function withStampedHtmfPath(payload, path) {
    if (!payload || typeof payload.body !== "string") return payload;
    const mime = String(payload.contentType || "")
        .split(";")[0]
        .trim()
        .toLowerCase();
    if (mime !== "text/html" && mime !== "application/xhtml+xml") return payload;
    if (!/\bhtmf\b/.test(payload.body)) return payload;
    const body = stampHtmfDataPath(payload.body, path);
    if (body === payload.body) return payload;
    return { ...payload, body, size: new TextEncoder().encode(body).length };
}

function classify(context) {
    if (context?.kind === "text" || context?.virtual) return "text";
    const el = liveEl(context);
    if (!el) return null;
    if (el.tagName === "IMG") return "image";
    if (htmfHostFrom(el)) return "htmf";
    return "element";
}

function originOf(raw) {
    const s = String(raw || "").trim();
    if (!s) return "";
    try {
        return new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`).origin;
    } catch {
        return "";
    }
}

/** `navi:` data-paths are local park ibs; the host path drops the prefix. */
function cleanPath(raw) {
    return String(raw || "")
        .trim()
        .replace(/^navi:/i, "")
        .replace(/^\/+/, "")
        .replace(/\/+$/, "")
        .replace(/\/+/g, "/");
}

/** The selected element's own data-path, or "" (the user types one). */
function ownDataPath(context, kind) {
    const el = kind === "text" ? context?.textRoot : liveEl(context);
    return cleanPath(el?.getAttribute?.("data-path") || "");
}

function withPrefix(ix, path) {
    if (!ix) return path;
    if (!path) return `${ix}/`;
    return path === ix || path.startsWith(`${ix}/`) ? path : `${ix}/${path}`;
}

function formatBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

async function readPayload(context, kind) {
    if (kind === "stage") {
        const json = JSON.stringify(await context.snapshot(), null, 2);
        return {
            body: json,
            contentType: "application/json",
            size: new TextEncoder().encode(json).length,
            preview: json,
            note: "load it with: stagedir surf <path> (replaces the stage)",
        };
    }
    if (kind === "text") {
        const text = String(context.value ?? context.text ?? "");
        const html = HTML_VIRTUALS.has(String(context.virtual || ""));
        return { body: text, contentType: html ? "text/html" : "text/plain", size: new TextEncoder().encode(text).length, preview: text };
    }
    const el = kind === "htmf" ? htmfHostFrom(liveEl(context)) || liveEl(context) : liveEl(context);
    if (kind === "image") {
        const src = el.currentSrc || el.src;
        let res;
        try {
            res = await fetch(src);
        } catch (e) {
            throw new Error(`can't read the image bytes (${e.message || e}) — cross-origin images block this; use "select src" to publish its address as text`);
        }
        if (!res.ok) throw new Error(`image GET → ${res.status}`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        const contentType = (res.headers.get("Content-Type") || "image/png").split(";")[0].trim();
        return { body: bytes, contentType, size: bytes.length, previewSrc: src };
    }
    const clone = el.cloneNode(true);
    for (const n of clone.querySelectorAll?.("[data-jockey-ui]") || []) n.remove();
    const html = clone.outerHTML;
    const embedded = (html.match(/src\s*=\s*["']data:[^"']+/gi) || []).reduce((n, s) => n + s.length, 0);
    const note = embedded ? `the picture is inside this HTML as base64 text (${formatBytes(embedded)})` : "";
    return { body: html, contentType: "text/html", size: new TextEncoder().encode(html).length, preview: html, note };
}

export const register = (navi) => {
    const isBrowser = typeof window !== "undefined" && typeof document !== "undefined";
    const proposer = () => navi?.mod?.netproposer || null;
    let openUi = null;

    const readPrefIx = async () => {
        try {
            const v = await navi.storage.item.get(PREF_IX_KEY);
            return v == null ? "" : String(v).trim().replace(/^\/+|\/+$/g, "");
        } catch {
            return "";
        }
    };

    const dismiss = () => {
        if (!openUi) return;
        try {
            openUi.root.remove();
        } catch {
            /* ignore */
        }
        for (const [type, el, fn, opts] of openUi.listeners) {
            try {
                el.removeEventListener(type, fn, opts);
            } catch {
                /* ignore */
            }
        }
        clearTimeout(openUi.timer);
        const done = openUi.resolve;
        openUi = null;
        done?.(undefined);
    };

    const el = (tag, css, text) => {
        const n = document.createElement(tag);
        if (css) n.style.cssText = css;
        if (text != null) n.textContent = text;
        return n;
    };

    const INPUT_CSS =
        "width:100%;box-sizing:border-box;padding:4px 6px;margin:2px 0 6px;font:12px/1.3 monospace;background:#fff;color:#111;border:1px solid #bbb;border-radius:3px";
    const BUTTON_CSS =
        "padding:5px 12px;font:600 12px/1 monospace;border-radius:3px;border:1px solid #888;cursor:pointer";

    const bytesToDataUrl = (bytes, mime) => {
        let bin = "";
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        return `data:${mime};base64,${btoa(bin)}`;
    };

    /** Local park kind: method GET kind, storage.file → bin, other tips → frame. */
    const localTipKind = (tip) => {
        if (!tip) return null;
        const get = tip.data?.method?.GET;
        if (get) return String(get.kind || "").toLowerCase() || "frame";
        return tip.data?.shim === "file" ? "bin" : "frame";
    };

    /** Surfed page's path when the lobby never saw the surf: the first data-path in body (a proscene stage takes the content's). */
    const pagePathFromBody = () => {
        for (const n of document.body?.querySelectorAll?.("[data-path]") || []) {
            if (n.closest?.("[data-jockey-ui]") || n.closest?.('[name="scranton_lobby_v1_surfroster"]')) continue;
            const p = cleanPath(n.getAttribute("data-path"));
            if (p) return p;
        }
        return "";
    };

    const localpark = async (path, payload, member) => {
        const tipApi = navi?.storage?.tip;
        const binApi = navi?.storage?.bin;
        if (!tipApi?.mut8 || !binApi?.putMedia || !binApi?.ref) throw new Error("navi.storage tip/bin unavailable");
        const media = payload.body instanceof Uint8Array ? bytesToDataUrl(payload.body, payload.contentType) : String(payload.body);
        const sha = await binApi.putMedia({ media, mime: payload.contentType });
        const existing = await tipApi.get(path).catch(() => null);
        const now = new Date().toISOString();
        const data = {
            parts: ["ibgib_frame", "park", "bin"],
            park: "defer",
            default_method: "GET",
            content_type: payload.contentType,
            path,
            source: "jockey_netproposer:localpark",
            created_at: existing?.data?.created_at || now,
            updated_at: now,
            method: { GET: { kind: "bin" } },
            about: { label: path.split("/").pop() || path },
            ...(member ? { stage_dir: { slot: member.slot, at: member.at, type: member.type } } : {}),
        };
        await tipApi.mut8(path, data, { create: true, replaceData: true, rel8ns: { bin: [binApi.ref(sha)] } });
        return { ib: path, sha, updated: !!existing };
    };

    const openPanel = (context, kind, api, member = null, where = "host") =>
        new Promise((resolve) => {
            const local = where === "local";
            const posting = where === "post";
            dismiss();
            const ui = { listeners: [], resolve, timer: 0 };
            openUi = ui;
            const on = (type, target, fn, opts) => {
                target.addEventListener(type, fn, opts);
                ui.listeners.push([type, target, fn, opts]);
            };

            const root = el(
                "div",
                [
                    "position:fixed",
                    "z-index:2147483646",
                    "width:320px",
                    "padding:10px 12px",
                    "box-sizing:border-box",
                    "background:#fff",
                    "color:#111",
                    `border:2px solid ${COLOR}`,
                    "border-radius:6px",
                    "font:12px/1.35 monospace",
                ].join(";")
            );
            root.setAttribute("data-jockey-ui", "jockey-netproposer");
            ui.root = root;

            const title = el("div", `font-weight:700;color:#a35400;margin-bottom:6px`, posting ? `scranton - post on this page · ${member ? "stage-member" : "whole stage"}` : `${where}park ${member ? "stage-member" : kind}`);
            if (member) {
                title.append(
                    el(
                        "div",
                        "font-weight:400;color:#333;margin-top:2px",
                        `${member.label} (${member.slot}) · position ${member.at} · ${member.type}`
                    )
                );
            }
            const meta = el("div", "color:#666;margin-bottom:6px", "reading…");
            const preview = el(
                "div",
                "max-height:110px;overflow:auto;margin-bottom:8px;padding:4px;background:#f6f6f6;border:1px solid #ddd;border-radius:3px;white-space:pre-wrap;word-break:break-all;color:#333"
            );
            const hostLabel = el("label", "display:block;color:#666", "host");
            const hostInput = el("input", INPUT_CSS);
            const pathLabel = el("label", "display:block;color:#666", "path");
            const pathInput = el("input", INPUT_CSS);
            pathInput.placeholder = "e.g. alice/notes/hello";
            const protectLabel = el("label", "display:block;color:#666", "policy (new paths only)");
            const protectSelect = el("select", INPUT_CSS);
            const protectInput = el("input", `${INPUT_CSS};display:none`);
            protectInput.placeholder = "policy alias or ib^gib";
            const replaceRow = el("label", "display:none;color:#a35400;margin-bottom:6px");
            const replaceBox = el("input");
            replaceBox.type = "checkbox";
            const replaceText = el("span", "margin-left:4px");
            replaceRow.append(replaceBox, replaceText);
            const status = el("div", "min-height:1.3em;margin-bottom:8px;color:#666");
            const row = el("div", "display:flex;gap:8px;justify-content:flex-end");
            const mountBtn = el("button", `${BUTTON_CSS};display:none;background:#fff;color:#111`, "mount netproposer");
            const cancelBtn = el("button", `${BUTTON_CSS};background:#fff;color:#111`, "cancel");
            const sendBtn = el("button", `${BUTTON_CSS};background:${COLOR};color:#111`, "send");
            const keyBtn = el("button", `${BUTTON_CSS};display:none;background:#fff;color:#111`, "create my key");
            for (const b of [mountBtn, keyBtn, cancelBtn, sendBtn]) b.type = "button";
            row.append(mountBtn, keyBtn, cancelBtn, sendBtn);
            const surfLabel = el("label", "display:block;color:#666", "page (surf path) visitors will see it on");
            const surfInput = el("input", INPUT_CSS);
            surfInput.placeholder = "e.g. Clip_Art_Deer_Drawing.jpg";
            const gateLabel = el("label", "display:block;color:#666", "only when arriving from (optional; trusted visitors get it on their own only then)");
            const gateInput = el("input", INPUT_CSS);
            gateInput.placeholder = "e.g. horizon/enter  (trailing /* = anything under it)";
            if (local) {
                root.append(title, meta, preview, pathLabel, pathInput, replaceRow, status, row);
                sendBtn.textContent = "save";
            } else if (posting) {
                pathLabel.textContent = member ? "member park path" : "stage park path";
                sendBtn.textContent = "post";
                root.append(title, meta, preview, hostLabel, hostInput, surfLabel, surfInput, gateLabel, gateInput, pathLabel, pathInput, protectLabel, protectSelect, protectInput, replaceRow, status, row);
            } else {
                root.append(title, meta, preview, hostLabel, hostInput, pathLabel, pathInput, protectLabel, protectSelect, protectInput, replaceRow, status, row);
            }

            const px = api?.jockey?._pointer?.x ?? 40;
            const py = api?.jockey?._pointer?.y ?? 40;
            root.style.left = `${Math.max(8, Math.min(px + 16, window.innerWidth - 336))}px`;
            root.style.top = `${Math.max(8, Math.min(py - 40, window.innerHeight - 440))}px`;
            document.body.appendChild(root);

            const state = {
                payload: null,
                payloadError: "",
                tokens: 0,
                tip: null,
                tipKind: null,
                busy: false,
                done: false,
                readError: "",
                sendError: "",
                lobbyExists: false,
                policies: {},
                myKey: null,
            };
            const lobbySvc = () => navi?.mod?.scranton_lobby?.lobby || null;
            const memberPath = () => cleanPath(pathInput.value);
            const pathProblem = () => {
                const raw = pathInput.value;
                return !cleanPath(raw) || /\/\s*$/.test(raw) ? "type a path" : "";
            };
            /** write protect = hostparkinator keys policy (foobarch.schema.keys.v1, threshold 1, keys [my default key]). */
            const wpPath = () => (state.myKey ? `policies/keys/${String(state.myKey).slice(0, 16)}` : "");
            const wpReady = () => !!(state.wpAlias || state.wpAddr);
            const protectTokens = () => (protectSelect.value === "wp" && !wpReady() ? 2 : 0);
            const tokensNeeded = () => (posting ? 2 : 1) + protectTokens();
            const spendText = () => (posting ? `${tokensNeeded()}–${tokensNeeded() + 1}` : `${tokensNeeded()}`);
            const protectBlocker = () => {
                const v = protectSelect.value;
                if (v === "wp" && !state.myKey) return navi?.mod?.keychain ? "no keychain key yet — create my key to write protect" : "write protect needs keychain mounted";
                if (v === "wp" && state.wpError) return state.wpError;
                if (v === "custom" && !protectInput.value.trim()) return "type a policy alias or ib^gib";
                return "";
            };
            const protectNote = () => {
                const v = protectSelect.value;
                if (v !== "wp") return "";
                const where = state.wpAlias ? `policy ${state.wpAlias}` : wpPath();
                return ` · write protect → ${where}${wpReady() ? "" : " (created first, +2)"}`;
            };
            const postBlocker = () => {
                if (!posting) return "";
                if (!lobbySvc()?.postsFor) return "mount scranton_lobby ≥ 1.9.0 (open surfroster) first";
                if (!navi?.mod?.keychain) return "mount keychain first (lobby rows are signed)";
                if (!cleanPath(surfInput.value)) return "type the page's surf path";
                return "";
            };

            const loadPolicies = async () => {
                const np = proposer();
                state.policies = (await np?.policies?.().catch(() => ({}))) || {};
                const kc = navi?.mod?.keychain;
                const get = kc?.get || kc?.keychain?.get;
                state.myKey = typeof get === "function" ? (await get.call(kc, "default").catch(() => null))?.publicKey || null : null;
                state.wpAlias = "";
                state.wpAddr = "";
                state.wpError = "";
                const others = [];
                for (const [name, entry] of Object.entries(state.policies)) {
                    if (state.myKey && entry.ownerPublicKey === state.myKey && !state.wpAlias) state.wpAlias = name;
                    else others.push([name, entry]);
                }
                if (state.myKey && !state.wpAlias && np?.getTip) {
                    try {
                        const tip = await np.getTip(wpPath());
                        if (tip?.frame && !tip.tombstone) {
                            if (tip.frame.data?.keys?.[0] === state.myKey) state.wpAddr = tip.addr;
                            else state.wpError = `${wpPath()} belongs to another key`;
                        }
                    } catch (e) {
                        state.wpError = `can't read ${wpPath()} (${e.message || e})`;
                    }
                }
                const keep = protectSelect.value;
                protectSelect.replaceChildren();
                const add = (value, text) => {
                    const o = el("option", "", text);
                    o.value = value;
                    protectSelect.append(o);
                };
                add("", "none (open — anyone with tokens can overwrite)");
                add("wp", "write protect (only my key can change it)");
                for (const [name, entry] of others) {
                    add(`alias:${name}`, `${name} (keys policy · key ${String(entry.ownerPublicKey || "?").slice(0, 8)}…)`);
                }
                add("custom", "other policy (alias or ib^gib)…");
                if ([...protectSelect.options].some((o) => o.value === keep)) protectSelect.value = keep;
                protectInput.style.display = protectSelect.value === "custom" ? "" : "none";
            };

            /** Policy alias / ib^gib for propose; write protect imports or creates the keys policy frame first. */
            const resolvePolicy = async (np) => {
                const v = protectSelect.value;
                if (!v) return undefined;
                if (v === "custom") return protectInput.value.trim() || undefined;
                if (v.startsWith("alias:")) return v.slice(6);
                if (state.wpAlias) return state.wpAlias;
                const names = Object.keys(state.policies);
                let name = "mine";
                for (let i = 2; names.includes(name); i++) name = `mine-${i}`;
                status.textContent = state.wpAddr ? "importing your write-protect policy…" : "creating your write-protect policy…";
                const fn = state.wpAddr ? np.importPolicy : np.createKeyPolicy;
                if (typeof fn === "function") {
                    if (state.wpAddr) await fn(name, wpPath());
                    else await fn(name, "default", wpPath());
                } else {
                    /** netproposer < 0.4.1 has no function exports; its callin does the same. */
                    const args = state.wpAddr ? ["policy", "import", name, "--path", wpPath()] : ["policy", "create", "keys", name, "--path", wpPath()];
                    const out = await np.commands?.netproposer?.execute?.(...args);
                    if (!(await np.policies())?.[name]) throw new Error(String(out || "netproposer policy command failed"));
                }
                await loadPolicies();
                protectSelect.value = "wp";
                return name;
            };

            const render = () => {
                const np = proposer();
                mountBtn.style.display = np || local ? "none" : "";
                keyBtn.style.display = !local && !state.done && protectSelect.value === "wp" && navi?.mod?.keychain?.create && !state.myKey ? "" : "none";
                const needReplace = !!(state.tip && state.tipKind && state.tipKind !== "bin");
                replaceRow.style.display = needReplace ? "block" : "none";
                replaceText.textContent = needReplace ? `replace this ${state.tipKind} park with content` : "";
                if (state.done) {
                    sendBtn.disabled = false;
                    sendBtn.textContent = "close";
                    sendBtn.style.opacity = "1";
                    return;
                }
                const reason = local
                    ? state.payloadError ||
                      (!state.payload
                          ? "reading…"
                          : pathProblem()
                            ? pathProblem()
                            : needReplace && !replaceBox.checked
                              ? `${cleanPath(pathInput.value)} is a ${state.tipKind} park — tick replace to overwrite it`
                              : "")
                    : !np
                    ? "netproposer is not mounted"
                    : state.payloadError
                      ? state.payloadError
                      : !state.payload
                        ? "reading…"
                        : pathProblem()
                          ? pathProblem()
                          : !originOf(hostInput.value)
                            ? "host is not a valid origin"
                            : postBlocker() || protectBlocker()
                            ? postBlocker() || protectBlocker()
                            : state.tokens < tokensNeeded()
                              ? `${tokensNeeded() > 1 ? `needs ${tokensNeeded()} usage tokens, have ${state.tokens}` : "no usage tokens"} for ${originOf(hostInput.value)} — request some on hypertext/intro`
                              : needReplace && !replaceBox.checked
                                ? `${memberPath()} is a ${state.tipKind} park — tick replace to overwrite it`
                                : "";
                sendBtn.disabled = !!reason || state.busy;
                sendBtn.style.opacity = sendBtn.disabled ? "0.4" : "1";
                sendBtn.style.cursor = sendBtn.disabled ? "not-allowed" : "pointer";
                if (state.busy) return;
                if (state.sendError) {
                    status.style.color = "#c62828";
                    status.textContent = state.sendError;
                    return;
                }
                if (reason) {
                    status.style.color = state.payloadError || state.readError ? "#c62828" : "#666";
                    status.textContent = state.readError || reason;
                    return;
                }
                status.style.color = "#666";
                if (local) {
                    status.textContent = `${state.tip ? "update local park" : "new local park"} · this browser only`;
                    return;
                }
                const guard = protectNote();
                status.textContent = posting
                    ? `post → ${memberPath()} · lobby row (+1 if the page has no lobby yet) · ${state.tokens} token(s) · spends ${spendText()}${guard}`
                    : `${state.tokens} token(s) · send spends ${spendText()}${guard}`;
            };

            /** No host lookups here — the path, its park kind, and the page's lobby are only checked on send. */
            const refresh = async () => {
                const host = originOf(hostInput.value);
                state.readError = "";
                if (local) {
                    const path = cleanPath(pathInput.value);
                    state.tip = path ? (await navi.storage?.tip?.get?.(path).catch(() => null)) || null : null;
                    state.tipKind = localTipKind(state.tip);
                    return render();
                }
                state.tokens = host && navi.tokens ? await navi.tokens.count(host).catch(() => 0) : 0;
                render();
            };

            /** The parked frame is the post: data.post names the page, its lobby, and the key that signs the row. */
            const preparePost = async () => {
                const svc = lobbySvc();
                const page = cleanPath(surfInput.value);
                status.textContent = "lobby…";
                let lt = await svc.getTip(svc.lobbyIb(page));
                if (!lt || lt.tombstone) {
                    await svc.create(page);
                    lt = await svc.getTip(svc.lobbyIb(page));
                }
                const author = (await svc.signerFor(lt.frame?.data?.lobby)).publicKey;
                const from = gateInput.value.trim().replace(/^\/+/, "");
                const gate = from ? { gate: { from } } : {};
                if (!member) {
                    return {
                        v: 1,
                        kind: "stage_dir",
                        page,
                        lobby: svc.lobbyIb(page),
                        author,
                        label: memberPath().split("/").pop() || "stage",
                        ...gate,
                        created_at: new Date().toISOString(),
                    };
                }
                const text = String(member.el?.textContent || "").replace(/\s+/g, " ").trim();
                const stage_dir = { slot: member.slot, at: member.at, type: member.type };
                return {
                    v: 1,
                    kind: "stage_member",
                    page,
                    lobby: svc.lobbyIb(page),
                    author,
                    stage_dir,
                    label: text.slice(0, 60) || member.label,
                    ...gate,
                    created_at: new Date().toISOString(),
                };
            };
            const scheduleRefresh = () => {
                state.sendError = "";
                clearTimeout(ui.timer);
                ui.timer = setTimeout(() => void refresh(), 250);
            };

            const send = async () => {
                if (state.done) return dismiss();
                const np = proposer();
                if ((!np && !local) || sendBtn.disabled) return;
                state.busy = true;
                status.style.color = "#666";
                status.textContent = local ? "saving…" : "sending…";
                render();
                const parked = withStampedHtmfPath(state.payload, pathInput.value);
                if (local) {
                    try {
                        const r = await localpark(cleanPath(pathInput.value), parked, member);
                        state.done = true;
                        status.style.color = "#1a7f37";
                        status.textContent = `${r.updated ? "updated" : "saved"} local park → ${r.ib} (surf ${r.ib})`;
                        if (typeof navi.callout === "function") navi.callout(`[jockey_netproposer] localpark ${r.ib}`);
                    } catch (e) {
                        await refresh().catch(() => {});
                        state.sendError = String(e.message || e).replace(/^error:\s*/i, "");
                    } finally {
                        state.busy = false;
                        render();
                    }
                    return;
                }
                try {
                    const host = originOf(hostInput.value);
                    if (host !== originOf(await np.getHost())) await np.setHost(host);
                    const policy = await resolvePolicy(np);
                    const post = posting ? await preparePost() : null;
                    status.textContent = "sending…";
                    const r = await np.propose({
                        ib: memberPath(),
                        body: parked.body,
                        contentType: parked.contentType,
                        policy,
                        replace: replaceBox.checked,
                        data: member
                            ? { stage_dir: { slot: member.slot, at: member.at, type: member.type }, ...(post ? { post } : {}) }
                            : post
                              ? { post }
                              : undefined,
                    });
                    if (posting) {
                        if (!r.addr) throw new Error(`${r.ib || memberPath()} saved but the host returned no address; append it by hand: scranton_lobby append push`);
                        status.textContent = "post parked · lobby row…";
                        await lobbySvc().appendPush(post.page, r.addr);
                        state.done = true;
                        status.style.color = "#1a7f37";
                        status.textContent = `posted ${r.ib || memberPath()} on ${post.page} → ${post.lobby} · ${await navi.tokens?.count(host).catch(() => "?")} token(s) left`;
                        if (typeof navi.callout === "function") navi.callout(`[jockey_netproposer] post ${r.addr} on ${post.lobby}`);
                        return;
                    }
                    state.done = true;
                    status.textContent = "";
                    status.style.color = "#1a7f37";
                    const link = el("a", "color:#0b62c4");
                    link.href = `${host}/${r.ib}`;
                    link.target = "_blank";
                    link.rel = "noopener";
                    link.textContent = `${host}/${r.ib}`;
                    status.append(`saved (${r.transform}, ${r.tokensLeft} token(s) left) → `, link);
                    if (typeof navi.callout === "function") navi.callout(`[jockey_netproposer] ${r.addr || r.ib}`);
                } catch (e) {
                    await refresh().catch(() => {});
                    state.sendError = String(e.message || e).replace(/^error:\s*/i, "");
                    const parkKind = /is a (\w+) park/.exec(state.sendError)?.[1];
                    if (parkKind) {
                        state.tip = { refused: true };
                        state.tipKind = parkKind.toLowerCase();
                    }
                } finally {
                    state.busy = false;
                    render();
                }
            };

            const typed = () => {
                if (local) return scheduleRefresh();
                state.sendError = "";
                state.tip = null;
                state.tipKind = null;
                replaceBox.checked = false;
                render();
            };
            on("input", hostInput, scheduleRefresh);
            on("input", pathInput, typed);
            on("input", surfInput, typed);
            on("change", replaceBox, render);
            on("change", protectSelect, async () => {
                protectInput.style.display = protectSelect.value === "custom" ? "" : "none";
                if (protectSelect.value === "wp" && !navi?.mod?.keychain) {
                    status.textContent = "mounting keychain…";
                    await navi.callin({ path: "keychain", method: "GET" }).catch(() => {});
                    await loadPolicies();
                }
                scheduleRefresh();
            });
            on("input", protectInput, render);
            on("click", keyBtn, async () => {
                keyBtn.disabled = true;
                try {
                    await navi.mod.keychain.create("default");
                } catch (e) {
                    state.sendError = `create key failed: ${e.message || e}`;
                }
                keyBtn.disabled = false;
                await loadPolicies();
                await refresh();
            });
            on("click", sendBtn, () => void send());
            on("click", cancelBtn, dismiss);
            /** netproposer is a warez park: calling its path mounts it (`mount <route>` does not). */
            const mountProposer = async () => {
                mountBtn.disabled = true;
                try {
                    if (proposer()) await navi.mod.surf?.unmount?.("netproposer");
                    await navi.callin({ path: "netproposer", method: "GET", headers: { "X-Navi-Park-Bypass": "1" } });
                } catch (e) {
                    state.sendError = `mount netproposer failed: ${e.message || e}`;
                }
                mountBtn.disabled = false;
                hostInput.value = (await proposer()?.getHost?.()) || hostInput.value;
                await loadPolicies();
                await refresh();
            };
            on("click", mountBtn, () => void mountProposer());
            on("keydown", root, (e) => {
                e.stopPropagation();
                if (e.key === "Escape") {
                    e.preventDefault();
                    dismiss();
                } else if (e.key === "Enter" && e.target !== protectInput) {
                    e.preventDefault();
                    void send();
                }
            });
            on(
                "pointerdown",
                document,
                (e) => {
                    if (!root.isConnected) return dismiss();
                    if (root.contains(e.target)) {
                        e.stopPropagation();
                        return;
                    }
                    dismiss();
                },
                true
            );

            const loadPayload = async () => {
                state.payload = null;
                state.payloadError = "";
                render();
                try {
                    state.payload = await readPayload(context, kind);
                    const p = state.payload;
                    meta.textContent = `${p.contentType} · ${formatBytes(p.size)}`;
                    preview.replaceChildren();
                    preview.style.display = "";
                    if (p.previewSrc) {
                        const img = el("img", "max-width:100%;max-height:100px;display:block;margin:auto");
                        img.src = p.previewSrc;
                        preview.appendChild(img);
                    } else {
                        preview.textContent = String(p.preview).slice(0, 2000);
                    }
                    if (p.note) meta.textContent += ` — ${p.note}`;
                } catch (e) {
                    state.payloadError = String(e.message || e);
                    meta.textContent = "";
                    preview.style.display = "none";
                }
                render();
            };

            const own = member ? cleanPath(member.path) : kind === "stage" ? (posting ? "" : cleanPath(context.stagePath)) : ownDataPath(context, kind);
            pathInput.value = own;
            void (async () => {
                const ix = await readPrefIx();
                pathInput.value = withPrefix(ix, own);
                if (ix) pathLabel.textContent = `${posting ? (member ? "member park path" : "stage park path") : "path"} (stagejockey prefix ${ix})`;
                if (!local && !proposer()) await mountProposer();
                const np = proposer();
                if (!local) hostInput.value = (np ? await np.getHost() : "") || navi.origin || globalThis.location?.origin || "";
                if (posting) surfInput.value = cleanPath(lobbySvc()?.lastSurfPath || pagePathFromBody());
                if (!local) await loadPolicies();
                await loadPayload();
                await refresh();
                if (own) sendBtn.focus?.();
                else {
                    pathInput.focus?.();
                    pathInput.setSelectionRange?.(pathInput.value.length, pathInput.value.length);
                }
            })();
            render();
        });

    const LOCAL_COLOR = "#7fd1ff";
    const LOCAL_SHADOW = "0 1px 2px #001a2a, 0 0 2px #000, 0 0 1px #000";
    const claimsFor = (where) => {
        const color = where === "local" ? LOCAL_COLOR : COLOR;
        const textShadow = where === "local" ? LOCAL_SHADOW : SHADOW;
        const id = where === "local" ? "netproposer-localpark" : "netproposer-hostpark";
        return [
            {
                id,
                direction: 1,
                types: [...TEXT_TYPES, ...IMAGE_PARTS, "htm-img"],
                color,
                describe: (context) => ({ text: `${where}park ${classify(context) || ""}…`, color, textShadow }),
                matches: (context) => {
                    const k = classify(context);
                    return isBrowser && (k === "text" || k === "image");
                },
                async execute(context, api) {
                    const kind = classify(context);
                    if (kind !== "text" && kind !== "image") throw new Error(`nothing to ${where}park here`);
                    if (typeof api?.terminate === "function") api.terminate();
                    return openPanel(context, kind, api, null, where);
                },
            },
            {
                id: `${id}-htmf`,
                direction: 1,
                types: ["htmf"],
                color,
                describe: () => ({ text: `${where}park htmf…`, color, textShadow }),
                matches: (context) => isBrowser && !!htmfHostFrom(liveEl(context)),
                async execute(context, api) {
                    const host = htmfHostFrom(liveEl(context));
                    if (!host) throw new Error("no htmf");
                    if (typeof api?.terminate === "function") api.terminate();
                    return openPanel({ element: host }, "htmf", api, null, where);
                },
            },
            {
                id: `${id}-html`,
                direction: 1,
                types: [...IMAGE_PARTS, "htm-img"],
                color,
                describe: () => ({ text: `${where}park html…`, color, textShadow }),
                matches: (context) => isBrowser && classify(context) === "image",
                async execute(context, api) {
                    if (typeof api?.terminate === "function") api.terminate();
                    return openPanel(context, "element", api, null, where);
                },
            },
            {
                id: `${id}-stage-member`,
                direction: 1,
                types: ["stage-member"],
                color,
                describe: () => ({ text: `${where}park stage-member…`, color, textShadow }),
                matches: (context, api) =>
                    isBrowser &&
                    context?.slot != null &&
                    context?.index != null &&
                    typeof (api?.stage || navi.mod?.stagedir?.stage)?.describeMember === "function",
                async execute(context, api) {
                    const stage = api?.stage || navi.mod?.stagedir?.stage;
                    const member = stage?.describeMember?.(context.slot, context.index);
                    if (!member) throw new Error(`no stage-member at ${context.slot}[${context.index}]`);
                    if (typeof api?.terminate === "function") api.terminate();
                    return openPanel({ element: member.el }, "element", api, member, where);
                },
            },
        ];
    };

    const postClaim = {
        id: "netproposer-post-stage-member",
        direction: 1,
        types: ["stage-member"],
        color: COLOR,
        describe: () => ({ text: "scranton - post on this page…", color: COLOR, textShadow: SHADOW }),
        matches: (context, api) =>
            isBrowser &&
            context?.slot != null &&
            context?.index != null &&
            typeof (api?.stage || navi.mod?.stagedir?.stage)?.describeMember === "function",
        async execute(context, api) {
            const stage = api?.stage || navi.mod?.stagedir?.stage;
            const member = stage?.describeMember?.(context.slot, context.index);
            if (!member) throw new Error(`no stage-member at ${context.slot}[${context.index}]`);
            if (typeof api?.terminate === "function") api.terminate();
            return openPanel({ element: member.el }, "element", api, member, "post");
        },
    };

    const scrollbufferPlugin = {
        id: "jockey_netproposer",
        name: "jockey_netproposer",
        claims: [...claimsFor("host"), ...claimsFor("local"), postClaim],
    };

    const stageMenuItem = (where) => ({
        id: where === "post" ? "netproposer-post-stage" : `netproposer-${where}park-stage`,
        label: where === "post" ? "scranton - post stage on this page…" : `${where}park stage…`,
        title:
            where === "post"
                ? "Park the whole live stage as a stage_dir post and append it, signed, to this page's lobby (visitors can apply it)"
                : where === "local"
                  ? "Save the whole live stage as stage_dir JSON in this browser (load with stagedir surf <path>)"
                  : "Publish the whole live stage as stage_dir JSON (load with stagedir surf <path>)",
        matches: ({ stage } = {}) =>
            isBrowser && !!stage?.path && typeof navi.mod?.stagedir?.stage?.liveSnapshot === "function",
        action: ({ pointer, stage: picked } = {}) => {
            const stage = navi.mod?.stagedir?.stage;
            if (!stage) throw new Error("stagedir is not mounted");
            return openPanel(
                { snapshot: () => stage.liveSnapshot(), stagePath: picked?.path || "" },
                "stage",
                { jockey: { _pointer: pointer } },
                null,
                where
            );
        },
    });

    return {
        name: "jockey_netproposer",
        version: VERSION,
        description: "Jockey +1: hostpark (netproposer) or localpark text, images, htmf, or stage-members (confirm panel)",
        moduleInfo: {
            name: "jockey_netproposer",
            version: VERSION,
            description: "Jockey +1: hostpark (netproposer) or localpark text, images, htmf, or stage-members (confirm panel)",
        },
        scrollbufferPlugin,
        /** stagejockey ▸ "hostpark stage…" / "localpark stage…" — whole live stage as stage_dir JSON. */
        stagejockeyMenuPlugin: {
            id: "jockey_netproposer",
            items: [stageMenuItem("host"), stageMenuItem("local"), stageMenuItem("post")],
        },
        commands: {
            jockey_netproposer: {
                name: "jockey_netproposer",
                description: "status: netproposer, host, tokens, path prefix",
                execute: async () => {
                    const np = proposer();
                    const host = np ? originOf(await np.getHost()) : "";
                    const tokens = host && navi.tokens ? await navi.tokens.count(host).catch(() => 0) : 0;
                    const ix = await readPrefIx();
                    return [
                        `jockey_netproposer ${VERSION}`,
                        np ? `netproposer: mounted · host ${host} · ${tokens} token(s)` : "netproposer: not mounted (mount netproposer)",
                        `path prefix (navi:pref:ix): ${ix || "(none)"}`,
                        "use: jockey-hold text or an image → +1 \"hostpark …\" (images also get \"hostpark html…\")",
                        "     on an htmf → +1 \"hostpark htmf…\" (stamps the panel path onto the outermost htmf data-path);",
                        "     on a stage-member → +1 \"hostpark stage-member…\" also saves its column + position;",
                        "     anyone can then put it back with: stagedir place <path>",
                        "     stagejockey menu → \"hostpark stage…\" publishes the whole stage (load: stagedir surf <path>)",
                        "     stagejockey menu → \"scranton - post stage on this page…\" parks the whole stage as a stage_dir post and",
                        "     appends it to the page's lobby (visitors can apply it; trusted authors' stages apply on surf)",
                        "     every hostpark claim has a \"localpark …\" twin: same panel and path, saved in this browser",
                        "     only (no host, no tokens); surf <path> serves it here, surf -h <path> skips it for the host copy",
                        "     on a stage-member → +1 \"scranton - post on this page…\" parks the member as a stage_member post",
                        "     (data.post) and appends it, signed, to that",
                        "     page's scranton lobby (2–3 tokens, +2 the first time you write protect with your own key);",
                        "     surfroster lists it there, and surfroster_stage_member can stage it or auto-stage trusted authors",
                    ].join("\n");
                },
            },
        },
        onUnmount: () => dismiss(),
    };
};
