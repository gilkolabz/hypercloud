/**
 * sprinter_client — browser side of sprinter eoas: live element registers keyed by data-hash.
 *
 * Register (stagejockey +1 "sprinter-register" on an htm-element, or `sprinter_client eoas register`):
 *   the element gets a data-hash if it has none, and this navi's keychain key becomes its owner on
 *   https://<host>/sprinter/eoas/{data-hash}. Every interval (prefs) the owner captures the element
 *   (root attributes + outerHTML) and pushes it when something changed.
 *   Rules set at register: watch (attributes that matter; empty = all) and deadzone
 *   (attr:number — numeric values that close don't count as different, e.g. data-yt-t:5).
 *   Prefill them on the element with data-sprinter-watch / data-sprinter-deadzone.
 *
 * Hook: every [data-hash] element on screen is checked once against sprinter (batched). When the
 *   sprinter says it's stale, the recorded attribute values are written onto the element, and it
 *   fires `sprinter:update` (on the element, bubbles), `sprinter:el-update` (window) and `stage-dirty`.
 *   Registered elements this navi doesn't own are re-checked every interval while follow is on.
 *
 * Reads: GET /sprinter/eoas/{hash} (raw html) · /{hash}/state · /{hash}/{prop} · /{hash}/attrs/{name}
 *
 * Callin:
 *   sprinter_client eoas [status]
 *   sprinter_client eoas list
 *   sprinter_client eoas register <hash> [watch=a,b] [deadzone=a:5,b:2]
 *   sprinter_client eoas unregister <hash>
 *   sprinter_client eoas get <hash> [prop|state|attrs <name>]
 *   sprinter_client eoas check
 *   sprinter_client eoas prefs [interval <ms> | scan <ms> | follow on|off | ignore <a,b,data-x-*> | reset]
 */

const HELP = [
    "sprinter_client — keep elements in step through sprinter eoas (keyed by data-hash).",
    "use: select an element with stagejockey → +1 \"sprinter-register\", pick the attributes that",
    "     matter and any deadzones; this navi then records it to sprinter/eoas/{data-hash} on an interval.",
    "     Any page showing that data-hash gets the recorded state when its copy is off.",
    "",
    "  sprinter_client eoas [status]                     hooked / registered / owned counts",
    "  sprinter_client eoas list                         hooked elements",
    "  sprinter_client eoas register <hash> [watch=a,b] [deadzone=a:5]",
    "  sprinter_client eoas unregister <hash>",
    "  sprinter_client eoas get <hash> [prop|state|attrs <name>]",
    "  sprinter_client eoas check                        re-check every hooked element now",
    "  sprinter_client eoas prefs [interval <ms>|scan <ms>|follow on|off|ignore <list>|reset]",
    "needs: keychain (to register); stagejockey for the claim",
].join("\n");

export const register = (navi) => {
    const NAME = "sprinter_client";
    const VERSION = "0.1.0";
    const isBrowser = typeof document !== "undefined";
    const PREFS_KEY = "sprinter_client.prefs";
    const OWNED_KEY = "sprinter_client.owned";
    const SIGN_KEY = "default";
    const MAX_HTML = 64 * 1024;
    const MAX_VALUE = 4096;
    const MAX_ATTRS = 64;
    const CHECK_BATCH = 64;
    const MISS_TTL_MS = 60_000;
    const ATTR_RE = /^[A-Za-z_:][-A-Za-z0-9_.:]{0,127}$/;
    const CLAIM_COLOR = "#ffd23f";
    const CLAIM_SHADOW = "0 1px 2px #332200, 0 0 2px #000, 0 0 1px #000";
    const DEFAULT_PREFS = {
        interval_ms: 5000,
        scan_ms: 2000,
        follow: true,
        ignore: ["style", "data-hash", "data-sprinter-*", "data-stagejockey-*"],
    };

    let prefs = { ...DEFAULT_PREFS };
    /** @type {Record<string, { rev: number, at?: string }>} */
    let owned = {};
    let loaded = null;
    let scanTimer = null;
    let tickTimer = null;
    let busy = false;
    /** hash → { el, registered: boolean|null, lastPushed: string, checking: boolean } */
    const hooks = new Map();
    /** hash → time of the last "no register" answer */
    const misses = new Map();
    const stats = { checks: 0, updates: 0, pushes: 0, errors: 0, lastError: "" };

    // ─── storage ────────────────────────────────────────────────────────

    const load = () =>
        (loaded ||= (async () => {
            const p = await navi.storage?.item?.get(PREFS_KEY);
            prefs = { ...DEFAULT_PREFS, ...(p && typeof p === "object" ? p : {}) };
            const o = await navi.storage?.item?.get(OWNED_KEY);
            owned = o && typeof o === "object" ? o : {};
        })());
    const savePrefs = () => navi.storage?.item?.set(PREFS_KEY, prefs);
    const saveOwned = () => navi.storage?.item?.set(OWNED_KEY, owned);

    // ─── element capture ───────────────────────────────────────────────

    /** Same install-id scheme as stagedir / surf: FNV-1a + length + time + entropy. */
    const hashContentSync = (text) => {
        const s = String(text ?? "");
        let h = 0x811c9dc5;
        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 0x01000193);
        }
        const stamp = Date.now().toString(16) + (Math.floor(Math.random() * 0x10000) >>> 0).toString(16).padStart(4, "0");
        return (h >>> 0).toString(16).padStart(8, "0") + s.length.toString(16).padStart(6, "0") + stamp;
    };

    const ignored = (name) =>
        (prefs.ignore || []).some((p) => (p.endsWith("*") ? name.startsWith(p.slice(0, -1)) : name === p));

    function captureAttrs(el) {
        const attrs = {};
        let n = 0;
        for (const a of Array.from(el.attributes)) {
            if (n >= MAX_ATTRS) break;
            if (ignored(a.name) || !ATTR_RE.test(a.name) || a.value.length > MAX_VALUE) continue;
            attrs[a.name] = a.value;
            n++;
        }
        return attrs;
    }

    /** outerHTML without stagejockey's pick outlines; just the opening tag when too big. */
    function captureHtml(el) {
        const clone = el.cloneNode(true);
        for (const node of [clone, ...clone.querySelectorAll("*")]) {
            if (!(node instanceof HTMLElement) || !node.style) continue;
            if (node.style.outline) node.style.outline = "";
            if (node.style.outlineOffset) node.style.outlineOffset = "";
            if (node.getAttribute("style") === "") node.removeAttribute("style");
        }
        const html = clone.outerHTML;
        return html.length <= MAX_HTML ? html : el.cloneNode(false).outerHTML.slice(0, MAX_HTML);
    }

    const capture = (el) => ({ attrs: captureAttrs(el), html: captureHtml(el) });

    const ensureHash = (el) => {
        let hash = String(el.getAttribute("data-hash") || "").trim();
        if (!hash) {
            hash = hashContentSync(el.outerHTML);
            el.setAttribute("data-hash", hash);
            el.dispatchEvent(new CustomEvent("stage-dirty", { bubbles: true }));
        }
        return hash;
    };

    const findEl = (hash) => {
        const hooked = hooks.get(hash)?.el;
        if (hooked?.isConnected) return hooked;
        if (!isBrowser) return null;
        return document.querySelector(`[data-hash="${CSS.escape(hash)}"]`);
    };

    // ─── rules ─────────────────────────────────────────────────────────

    const parseWatch = (raw) => {
        const list = String(raw || "")
            .split(/[\s,]+/)
            .map((s) => s.trim())
            .filter((s) => s && s !== "all" && s !== "*");
        const bad = list.find((n) => !ATTR_RE.test(n));
        if (bad) throw new Error(`not an attribute name: ${bad}`);
        return list.length ? list : null;
    };

    const parseDeadzone = (raw) => {
        const out = {};
        for (const part of String(raw || "").split(/[\s,]+/).filter(Boolean)) {
            const i = part.lastIndexOf(":");
            const name = part.slice(0, i);
            const num = Number(part.slice(i + 1));
            if (i <= 0 || !ATTR_RE.test(name) || !Number.isFinite(num) || num < 0) {
                throw new Error(`deadzone entries look like attr:number (got ${part})`);
            }
            out[name] = num;
        }
        return out;
    };

    // ─── sprinter wire ─────────────────────────────────────────────────

    const origin = () =>
        String(navi.origin || (isBrowser ? location.origin : "") || "https://foobarch.net").replace(/\/+$/, "");
    const eoasUrl = (rest = "") => `${origin()}/sprinter/eoas${rest}`;
    const eoasIb = (hash) => `sprinter/eoas/${hash}`;

    async function call(rest, { method = "GET", body, headers = {} } = {}) {
        const res = await fetch(eoasUrl(rest), {
            method,
            headers: { Accept: "application/json", "X-Navi-Shell-Wait": "1", ...headers },
            ...(body != null ? { body } : {}),
        });
        const text = await res.text();
        try {
            return JSON.parse(text);
        } catch {
            throw new Error(`sprinter eoas${rest} → ${res.status}: ${text.slice(0, 200)}`);
        }
    }

    const keychain = () => {
        const kc = navi.mod?.keychain;
        if (!kc) throw new Error("mount keychain first");
        return kc;
    };

    async function signerKey() {
        const kc = keychain();
        let key = await kc.get(SIGN_KEY);
        if (!key?.publicKey) key = await kc.create(SIGN_KEY);
        return { name: SIGN_KEY, publicKey: key.publicKey };
    }

    async function signedPost(ib, rest, payload) {
        const kc = keychain();
        const body = JSON.stringify(payload);
        const signed = await kc.signWrite({
            ib,
            parentAddr: "",
            body,
            contentType: "application/json",
            key: (await signerKey()).name,
            scheme: "proposal",
        });
        const h = typeof kc.buildSignHeaders === "function"
            ? kc.buildSignHeaders(signed)
            : { "X-Flowerpot-Sign-Keys": signed.publicKey, "X-Flowerpot-Signatures": signed.signature };
        const headers = {
            "Content-Type": "application/json",
            ...h,
            "X-Foobarch-Sign-Keys": h["X-Flowerpot-Sign-Keys"],
            "X-Foobarch-Signatures": h["X-Flowerpot-Signatures"],
        };
        return call(rest, { method: "POST", body, headers });
    }

    /** Write the element's current capture as rev n (retries once on a stale rev). */
    async function push(hash, el, extra = {}) {
        const snap = capture(el);
        const write = (rev) =>
            signedPost(eoasIb(hash), `/${hash}`, {
                v: 1,
                hash,
                rev,
                html: snap.html,
                attrs: snap.attrs,
                tag: el.tagName.toLowerCase(),
                ...extra,
            });
        const first = owned[hash] ? owned[hash].rev + 1 : 0;
        let out = await write(first);
        if (out?.status === 409 && Number.isInteger(out.rev)) out = await write(out.rev + 1);
        if (!out?.ok) throw new Error(out?.error || "sprinter refused the write");
        owned[hash] = { rev: out.rev, at: new Date().toISOString() };
        await saveOwned();
        const hook = hooks.get(hash);
        if (hook) hook.lastPushed = JSON.stringify(snap);
        stats.pushes++;
        return out;
    }

    // ─── registering ───────────────────────────────────────────────────

    async function registerEl(el, { watch = null, deadzone = {} } = {}) {
        await load();
        const hash = ensureHash(el);
        const me = (await signerKey()).publicKey;
        const state = await call(`/${hash}/state`);
        if (state?.ok && state.owner && state.owner !== me) {
            throw new Error(`${hash} is registered to another key`);
        }
        if (state?.ok) owned[hash] = { rev: state.rev };
        else delete owned[hash];
        hookEl(el, hash, true);
        const out = await push(hash, el, { watch, deadzone });
        return { hash, rev: out.rev, url: eoasUrl(`/${hash}`) };
    }

    async function unregisterHash(hash) {
        await load();
        const state = await call(`/${hash}/state`);
        if (!state?.ok) {
            delete owned[hash];
            await saveOwned();
            return `no register for ${hash}`;
        }
        const out = await signedPost(`${eoasIb(hash)}/drop`, `/${hash}/drop`, { v: 1, hash, drop: true, rev: state.rev });
        if (!out?.ok) throw new Error(out?.error || "drop refused");
        delete owned[hash];
        await saveOwned();
        const hook = hooks.get(hash);
        if (hook) hook.registered = false;
        return `unregistered ${eoasIb(hash)}`;
    }

    // ─── hooking + applying ────────────────────────────────────────────

    function hookEl(el, hash, registered = null) {
        const prev = hooks.get(hash);
        if (prev && prev.el === el) {
            if (registered != null) prev.registered = registered;
            return prev;
        }
        const hook = { el, registered, lastPushed: prev?.lastPushed || "", checking: false };
        hooks.set(hash, hook);
        return hook;
    }

    function apply(hash, el, result) {
        const changed = [];
        for (const name of result.changed || []) {
            if (!ATTR_RE.test(name)) continue;
            const v = result.attrs?.[name];
            if (v == null) el.removeAttribute(name);
            else el.setAttribute(name, String(v));
            changed.push(name);
        }
        if (!changed.length) return;
        stats.updates++;
        const detail = { hash, changed, rev: result.rev, tag: el.tagName.toLowerCase() };
        el.dispatchEvent(new CustomEvent("sprinter:update", { bubbles: true, detail }));
        el.dispatchEvent(new CustomEvent("stage-dirty", { bubbles: true }));
        if (isBrowser) window.dispatchEvent(new CustomEvent("sprinter:el-update", { detail }));
        if (owned[hash]) {
            const hook = hooks.get(hash);
            if (hook) hook.lastPushed = JSON.stringify(capture(el));
        }
    }

    /** One batched check; applies whatever sprinter says is stale. */
    async function check(hashes) {
        for (let i = 0; i < hashes.length; i += CHECK_BATCH) {
            const batch = hashes.slice(i, i + CHECK_BATCH).filter((h) => hooks.get(h)?.el?.isConnected);
            if (!batch.length) continue;
            for (const h of batch) hooks.get(h).checking = true;
            try {
                const out = await call("", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ check: batch.map((h) => ({ hash: h, attrs: captureAttrs(hooks.get(h).el) })) }),
                });
                if (!out?.ok) throw new Error(out?.error || "check refused");
                stats.checks++;
                const results = out.results || {};
                const now = Date.now();
                for (const h of batch) {
                    const hook = hooks.get(h);
                    const r = results[h];
                    hook.registered = !!r;
                    if (!r) {
                        misses.set(h, now);
                        continue;
                    }
                    misses.delete(h);
                    if (r.stale) apply(h, hook.el, r);
                    if (owned[h] && !hook.lastPushed) hook.lastPushed = JSON.stringify(capture(hook.el));
                }
            } catch (e) {
                stats.errors++;
                stats.lastError = String(e?.message || e);
            } finally {
                for (const h of batch) {
                    const hook = hooks.get(h);
                    if (hook) hook.checking = false;
                }
            }
        }
    }

    /** Hook new [data-hash] elements on screen and check them once. */
    async function scan() {
        if (!isBrowser) return;
        const fresh = [];
        const now = Date.now();
        for (const el of document.querySelectorAll("[data-hash]")) {
            const hash = String(el.getAttribute("data-hash") || "").trim();
            if (!/^[A-Za-z0-9._-]{4,128}$/.test(hash)) continue;
            const prev = hooks.get(hash);
            if (prev?.el === el) continue;
            if (prev?.el?.isConnected) continue;
            hookEl(el, hash, owned[hash] ? true : null);
            const missAt = misses.get(hash);
            if (!owned[hash] && missAt && now - missAt < MISS_TTL_MS) {
                hooks.get(hash).registered = false;
                continue;
            }
            fresh.push(hash);
        }
        for (const [hash, hook] of hooks) {
            if (!hook.el.isConnected) hooks.delete(hash);
        }
        if (fresh.length) await check(fresh);
    }

    /** Owners push what changed; followers re-check registered elements. */
    async function tick() {
        const follow = [];
        for (const [hash, hook] of hooks) {
            if (!hook.el.isConnected || hook.checking) continue;
            if (owned[hash]) {
                const snap = JSON.stringify(capture(hook.el));
                if (snap === hook.lastPushed) continue;
                try {
                    await push(hash, hook.el);
                } catch (e) {
                    stats.errors++;
                    stats.lastError = String(e?.message || e);
                    if (/registered to another|only the key/i.test(stats.lastError)) {
                        delete owned[hash];
                        await saveOwned();
                    }
                }
            } else if (hook.registered && prefs.follow) {
                follow.push(hash);
            }
        }
        if (follow.length) await check(follow);
    }

    const guarded = (fn) => async () => {
        if (busy) return;
        busy = true;
        try {
            await fn();
        } catch (e) {
            stats.errors++;
            stats.lastError = String(e?.message || e);
        } finally {
            busy = false;
        }
    };

    function startTimers() {
        stopTimers();
        if (!isBrowser) return;
        scanTimer = setInterval(guarded(scan), Math.max(500, Number(prefs.scan_ms) || DEFAULT_PREFS.scan_ms));
        tickTimer = setInterval(guarded(tick), Math.max(1000, Number(prefs.interval_ms) || DEFAULT_PREFS.interval_ms));
    }

    function stopTimers() {
        clearInterval(scanTimer);
        clearInterval(tickTimer);
        scanTimer = tickTimer = null;
    }

    // ─── claim (stagejockey) ───────────────────────────────────────────

    const hasType = (context, name) => {
        const types = Array.isArray(context?.types) ? context.types : [];
        return types.includes(name) || context?.kind === name;
    };
    const claimEl = (context) => (context?.element instanceof HTMLElement ? context.element : null);

    /** Watch + deadzone for a register; null when cancelled. */
    const promptRules = (el) =>
        new Promise((resolve) => {
            document.getElementById("sprinter-client-prompt")?.remove();
            const box = document.createElement("div");
            box.id = "sprinter-client-prompt";
            box.style.cssText =
                "position:fixed;z-index:2147483646;left:50%;top:20%;transform:translateX(-50%);background:#fff;color:#111;border:double 4px #000;padding:0.75rem;min-width:20rem;font:13px/1.35 ui-monospace,Consolas,monospace;";
            const hash = el.getAttribute("data-hash") || "(new data-hash)";
            box.innerHTML = `<div style="font-weight:700;margin:0 0 0.35rem;">sprinter register</div>
              <div style="opacity:.7;margin:0 0 0.5rem;word-break:break-all;">&lt;${el.tagName.toLowerCase()}&gt; ${hash}</div>
              <label style="display:block;margin:0 0 0.15rem;">attributes that matter <span style="opacity:.6">(blank = all)</span></label>
              <input data-sc="watch" style="width:100%;box-sizing:border-box;font:inherit;margin:0 0 0.5rem;" placeholder="data-yt-t, data-yt-vol">
              <label style="display:block;margin:0 0 0.15rem;">deadzones <span style="opacity:.6">(attr:number)</span></label>
              <input data-sc="deadzone" style="width:100%;box-sizing:border-box;font:inherit;" placeholder="data-yt-t:5">
              <div data-sc="err" style="color:#b00;min-height:1em;margin:0.25rem 0;"></div>
              <div style="display:flex;gap:0.35rem;">
                <button type="button" data-sc="ok">register</button>
                <button type="button" data-sc="x">cancel</button>
              </div>`;
            document.documentElement.appendChild(box);
            const watchIn = box.querySelector('[data-sc="watch"]');
            const dzIn = box.querySelector('[data-sc="deadzone"]');
            watchIn.value = el.getAttribute("data-sprinter-watch") || "";
            dzIn.value = el.getAttribute("data-sprinter-deadzone") || "";
            watchIn.focus();
            const done = (v) => {
                box.remove();
                resolve(v);
            };
            const ok = () => {
                try {
                    done({ watch: parseWatch(watchIn.value), deadzone: parseDeadzone(dzIn.value) });
                } catch (e) {
                    box.querySelector('[data-sc="err"]').textContent = String(e?.message || e);
                }
            };
            box.querySelector('[data-sc="ok"]').onclick = ok;
            box.querySelector('[data-sc="x"]').onclick = () => done(null);
            box.addEventListener("keydown", (e) => {
                if (e.key === "Escape") done(null);
                if (e.key === "Enter") ok();
            });
        });

    const scrollbufferPlugin = {
        id: NAME,
        name: NAME,
        claims: [
            {
                id: "sprinter-register",
                direction: 1,
                types: ["htm-element"],
                color: CLAIM_COLOR,
                describe: () => ({ text: "sprinter-register", color: CLAIM_COLOR, textShadow: CLAIM_SHADOW }),
                matches: (context) => hasType(context, "htm-element") && !!claimEl(context),
                async execute(context, api) {
                    const el = claimEl(context);
                    if (!el) throw new Error("no htm-element");
                    if (typeof api?.terminate === "function") api.terminate();
                    const rules = await promptRules(el);
                    if (!rules) return undefined;
                    const out = await registerEl(el, rules);
                    navi.callout?.(`[sprinter_client] registered ${eoasIb(out.hash)} (rev ${out.rev})`);
                    return out;
                },
            },
            {
                id: "sprinter-unregister",
                direction: -1,
                types: ["htm-element"],
                color: CLAIM_COLOR,
                describe: () => ({ text: "sprinter-unregister", color: CLAIM_COLOR, textShadow: CLAIM_SHADOW }),
                matches: (context) => {
                    const el = claimEl(context);
                    return hasType(context, "htm-element") && !!el && !!owned[el.getAttribute("data-hash") || ""];
                },
                async execute(context, api) {
                    const el = claimEl(context);
                    if (typeof api?.terminate === "function") api.terminate();
                    const msg = await unregisterHash(String(el?.getAttribute("data-hash") || ""));
                    navi.callout?.(`[sprinter_client] ${msg}`);
                    return msg;
                },
            },
        ],
    };

    // ─── commands ──────────────────────────────────────────────────────

    const kv = (args, key) => {
        const hit = args.find((a) => a.startsWith(key + "="));
        return hit == null ? undefined : hit.slice(key.length + 1);
    };

    async function eoas(args) {
        await load();
        const verb = String(args[0] || "status").toLowerCase();
        if (verb === "status") {
            const regs = [...hooks.values()].filter((h) => h.registered).length;
            return [
                `${NAME} v${VERSION} — sprinter eoas at ${eoasUrl()}`,
                `  hooked ${hooks.size} · registered ${regs} · owned ${Object.keys(owned).length}`,
                `  interval ${prefs.interval_ms}ms · scan ${prefs.scan_ms}ms · follow ${prefs.follow ? "on" : "off"}`,
                `  checks ${stats.checks} · updates applied ${stats.updates} · pushes ${stats.pushes} · errors ${stats.errors}`,
                ...(stats.lastError ? [`  last error: ${stats.lastError}`] : []),
            ].join("\n");
        }
        if (verb === "list") {
            if (!hooks.size) return "  (no data-hash elements hooked)";
            return [...hooks.entries()]
                .map(([h, k]) => `  ${h}  <${k.el.tagName.toLowerCase()}>  ${owned[h] ? "owned rev " + owned[h].rev : k.registered ? "registered" : k.registered === false ? "-" : "?"}`)
                .join("\n");
        }
        if (verb === "register") {
            const hash = String(args[1] || "");
            const el = hash ? findEl(hash) : null;
            if (!el) return `no element with data-hash ${hash || "<hash>"} on screen`;
            const watchRaw = kv(args, "watch");
            const dzRaw = kv(args, "deadzone");
            const out = await registerEl(el, {
                watch: parseWatch(watchRaw ?? el.getAttribute("data-sprinter-watch") ?? ""),
                deadzone: parseDeadzone(dzRaw ?? el.getAttribute("data-sprinter-deadzone") ?? ""),
            });
            return `registered ${eoasIb(out.hash)} rev ${out.rev}\n  ${out.url}`;
        }
        if (verb === "unregister") {
            const hash = String(args[1] || "");
            if (!hash) return `usage: ${NAME} eoas unregister <hash>`;
            return unregisterHash(hash);
        }
        if (verb === "get") {
            const hash = String(args[1] || "");
            if (!hash) return `usage: ${NAME} eoas get <hash> [prop]`;
            const rest = args.slice(2).join("/");
            if (!rest) {
                const res = await fetch(eoasUrl(`/${hash}`), { headers: { "X-Navi-Shell-Wait": "1" } });
                return await res.text();
            }
            return JSON.stringify(await call(`/${hash}/${rest}`), null, 2);
        }
        if (verb === "check") {
            await check([...hooks.keys()]);
            return `checked ${hooks.size} — updates applied so far ${stats.updates}`;
        }
        if (verb === "prefs") {
            const what = String(args[1] || "").toLowerCase();
            const val = args.slice(2).join(" ");
            if (what === "interval" || what === "scan") {
                const ms = Number(val);
                if (!Number.isFinite(ms) || ms < (what === "scan" ? 500 : 1000)) return `${what} needs ms ≥ ${what === "scan" ? 500 : 1000}`;
                prefs[what === "scan" ? "scan_ms" : "interval_ms"] = ms;
            } else if (what === "follow") {
                prefs.follow = /^(on|1|true|yes)$/i.test(val);
            } else if (what === "ignore") {
                prefs.ignore = val.split(/[\s,]+/).filter(Boolean);
            } else if (what === "reset") {
                prefs = { ...DEFAULT_PREFS };
            } else if (what) {
                return `unknown pref ${what}\n\n${HELP}`;
            }
            if (what) {
                await savePrefs();
                startTimers();
            }
            return JSON.stringify(prefs, null, 2);
        }
        return HELP;
    }

    const run = async (...rawArgs) => {
        const args = rawArgs.flatMap((a) => String(a ?? "").split(/\s+/)).filter(Boolean);
        try {
            if (String(args[0] || "").toLowerCase() === "eoas") return await eoas(args.slice(1));
            return HELP;
        } catch (e) {
            return `error: ${e?.message || e}`;
        }
    };

    return {
        name: NAME,
        version: VERSION,
        description: "sprinter eoas client: register elements by data-hash, record them on an interval, keep copies in step",
        moduleInfo: {
            name: NAME,
            version: VERSION,
            description: "Browser side of sprinter eoas (+1 sprinter-register claim, data-hash hooks, stale updates)",
        },
        commands: {
            [NAME]: { name: NAME, description: `${NAME} eoas status|list|register|unregister|get|check|prefs`, execute: run },
        },
        scrollbufferPlugin,
        eoas: {
            register: (el, rules) => registerEl(el, rules),
            unregister: (hash) => unregisterHash(hash),
            check: (hashes) => check(hashes || [...hooks.keys()]),
            scan: () => scan(),
            tick: () => tick(),
            capture: (el) => capture(el),
            hooks,
            stats,
            get prefs() {
                return { ...prefs };
            },
            get owned() {
                return { ...owned };
            },
        },
        onMount: async () => {
            await load();
            startTimers();
            void guarded(scan)();
        },
        onUnmount: () => {
            stopTimers();
            if (isBrowser) document.getElementById("sprinter-client-prompt")?.remove();
        },
    };
};
