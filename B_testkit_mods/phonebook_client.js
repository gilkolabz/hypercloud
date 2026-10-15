/**
 * phonebook_client — navi client for the Phonebook ledger (foobarch.net/phonebook).
 *
 * Callin:
 *   phonebook_client check <subject>     Is this subject subscribed? (exact probe; no directory)
 *   phonebook_client get <subject>       Local index snapshot for a known subject
 *   phonebook_client ring <subject>      HTML table of index payloads (text; skips first)
 *   phonebook_client health              Liveness
 *   phonebook_client base [url]          Show / set API base (default /phonebook)
 *   phonebook_client tokens <path>       GET token stash (Flowerpot path) → phonebook_client.tokens
 *   phonebook_client tokens              Show local spare-token count
 *   phonebook_client tokens clear        Empty local spare-token stash
 *   phonebook_client faucet [n]          GET faucet /token/phonebook → add to usage (default n=1)
 *   phonebook_client faucet base [url]   Show / set faucet base (default /torus_faucet)
 *   phonebook_client help
 *
 * Programmatic (subscribe / report a Flowerpot-known IbGib frame JSON):
 *   await navi.mod.phonebook_client.subscribe(subject, frameObject)
 *   await navi.mod.phonebook_client.report(subject, frameObject)   // alias
 *   await navi.mod.phonebook_client.write(subject, { alias, text }) // pot + report
 *   await navi.mod.phonebook_client.check(subject)
 *   await navi.mod.phonebook_client.ring(subject)  // raw HTML string
 *   await navi.mod.phonebook_client.requestFromFaucet([n])
 *
 * POST /phonebook/<subject> requires X-Phonebook-Usage-Token (single-use).
 * Mint on the server: POST /_phonebook/tokens + X-Phonebook-Usage-Password.
 * Or pull from a running faucet_server: GET {faucet}/token/phonebook.
 */

export const register = (navi) => {
    const isBrowser =
        typeof window !== "undefined" && typeof window.document !== "undefined";

    const eventListeners = [];
    const createdElements = [];
    const addedStyles = [];
    const observers = [];
    const timers = [];

    const DEFAULT_BASE = "/phonebook";
    const DEFAULT_FAUCET = "/torus_faucet";
    const STORAGE = {
        baseUrl: "phonebook_client.base_url",
        faucetUrl: "phonebook_client.faucet_url",
        tokens: "phonebook_client.tokens",
    };
    const HEADER = {
        usageToken: "X-Phonebook-Usage-Token",
    };

    /** slashfold via surf when mounted; local fallback. @see A_document/slashfold.md */
    const encodePath = (raw) => {
        const fn = navi?.mod?.surf?.slashfold;
        if (typeof fn === "function") {
            try {
                const out = fn(raw);
                if (typeof out === "string") {
                    return out.replace(/\/+$/g, "");
                }
            } catch {
                /* fall through */
            }
        }
        return String(raw || "")
            .trim()
            .replace(/^\/+/, "")
            .replace(/\s+/g, "/")
            .replace(/\/+/g, "/")
            .replace(/\/+$/g, "");
    };

    const tokenize = (rawArgs) => {
        if (rawArgs.length === 1 && typeof rawArgs[0] === "string") {
            return String(rawArgs[0])
                .trim()
                .split(/\s+/)
                .filter(Boolean);
        }
        return rawArgs.map((a) => String(a)).filter((a) => a.length);
    };

    class PhonebookClient {
        constructor() {
            this.baseUrl = DEFAULT_BASE;
            this.faucetUrl = DEFAULT_FAUCET;
        }

        log(...args) {
            console.log("[phonebook_client]", ...args);
        }

        async loadBase() {
            const stored = await navi.storage.item.get(STORAGE.baseUrl);
            if (stored != null && String(stored).trim()) {
                this.baseUrl = String(stored).trim().replace(/\/+$/, "");
            } else {
                this.baseUrl = DEFAULT_BASE;
            }
            return this.baseUrl;
        }

        async setBase(url) {
            const next = String(url || "")
                .trim()
                .replace(/\/+$/, "");
            if (!next) throw new Error("base url required");
            this.baseUrl = next;
            await navi.storage.item.set(STORAGE.baseUrl, next);
            return this.baseUrl;
        }

        async loadFaucet() {
            const stored = await navi.storage.item.get(STORAGE.faucetUrl);
            if (stored != null && String(stored).trim()) {
                this.faucetUrl = String(stored).trim().replace(/\/+$/, "");
            } else {
                this.faucetUrl = DEFAULT_FAUCET;
            }
            return this.faucetUrl;
        }

        async setFaucet(url) {
            const next = String(url || "")
                .trim()
                .replace(/\/+$/, "");
            if (!next) throw new Error("faucet url required");
            this.faucetUrl = next;
            await navi.storage.item.set(STORAGE.faucetUrl, next);
            return this.faucetUrl;
        }

        resolveUrl(path) {
            const p = String(path || "").replace(/^\/+/, "");
            const base = this.baseUrl.replace(/\/+$/, "");
            if (/^https?:\/\//i.test(base)) return `${base}/${p}`;
            const origin =
                isBrowser && typeof location !== "undefined"
                    ? location.origin
                    : "";
            if (base.startsWith("/")) return `${origin}${base}/${p}`;
            return `${origin}/${base}/${p}`;
        }

        /** Resolve against faucet base (default `/torus_faucet` proposal key). */
        resolveFaucetUrl(path) {
            const p = String(path || "").replace(/^\/+/, "");
            const base = this.faucetUrl.replace(/\/+$/, "");
            if (/^https?:\/\//i.test(base)) return `${base}/${p}`;
            const origin =
                isBrowser && typeof location !== "undefined"
                    ? location.origin
                    : "";
            if (base.startsWith("/")) return `${origin}${base}/${p}`;
            return `${origin}/${base}/${p}`;
        }

        /** Resolve a Flowerpot URL for token-stash GETs (separate from phonebook base). */
        flowerpotUrl(ib) {
            const origin =
                isBrowser && typeof location !== "undefined"
                    ? location.origin
                    : "";
            return `${origin}/flowerpot/${String(ib).replace(/^\/+/, "")}`;
        }

        async parseError(res) {
            try {
                const j = await res.json();
                if (j && j.error) return String(j.error);
                return JSON.stringify(j);
            } catch {
                try {
                    return await res.text();
                } catch {
                    return res.statusText || String(res.status);
                }
            }
        }

        // --- tokens --------------------------------------------------------

        async getTokens() {
            const raw = await navi.storage.item.get(STORAGE.tokens);
            if (!raw) return [];
            if (Array.isArray(raw)) return raw.map(String);
            if (typeof raw === "object" && Array.isArray(raw["spare tokens"])) {
                return raw["spare tokens"].map(String);
            }
            try {
                const parsed = JSON.parse(String(raw));
                if (Array.isArray(parsed)) return parsed.map(String);
                if (parsed && Array.isArray(parsed["spare tokens"])) {
                    return parsed["spare tokens"].map(String);
                }
                if (parsed && Array.isArray(parsed.tokens)) {
                    return parsed.tokens.map(String);
                }
            } catch {
                /* ignore */
            }
            return [];
        }

        async setTokens(tokens) {
            await navi.storage.item.set(STORAGE.tokens, tokens.map(String));
        }

        /** Empty the local spare-token stash (`navi.storage.item` key phonebook_client.tokens). */
        async clearTokens() {
            const before = (await this.getTokens()).length;
            await this.setTokens([]);
            return { cleared: before, total: 0 };
        }

        async takeToken() {
            const tokens = await this.getTokens();
            if (!tokens.length) {
                throw new Error(
                    "no phonebook usage tokens — phonebook_client tokens <path> to load a stash"
                );
            }
            const token = tokens.shift();
            await this.setTokens(tokens);
            return token;
        }

        async returnToken(token) {
            if (!token) return;
            const tokens = await this.getTokens();
            tokens.unshift(token);
            await this.setTokens(tokens);
        }

        /**
         * GET a Flowerpot path holding phonebook usage tokens and merge locally.
         * @param {string} rawPath
         */
        async loadTokensFromPath(rawPath) {
            const ib = encodePath(rawPath);
            if (!ib) throw new Error("token path required");
            const url = this.flowerpotUrl(ib);
            this.log("GET tokens", ib);
            const res = await fetch(url, { method: "GET" });
            if (!res.ok) {
                throw new Error(
                    `GET flowerpot/${ib} → ${res.status}: ${await this.parseError(res)}`
                );
            }
            const text = await res.text();
            let incoming = [];
            try {
                const parsed = JSON.parse(text);
                if (Array.isArray(parsed)) incoming = parsed;
                else if (parsed && Array.isArray(parsed["spare tokens"])) {
                    incoming = parsed["spare tokens"];
                } else if (parsed && Array.isArray(parsed.tokens)) {
                    incoming = parsed.tokens;
                } else {
                    throw new Error("JSON is not a token array");
                }
            } catch (e) {
                throw new Error(
                    `token stash at ${ib} is not JSON array (${e.message})`
                );
            }
            const clean = incoming.map(String).filter(Boolean);
            const existing = await this.getTokens();
            await this.setTokens([...existing, ...clean]);
            return {
                loaded: clean.length,
                total: existing.length + clean.length,
                ib,
            };
        }

        /**
         * GET faucet /token/phonebook (raw text/plain) and append to local usage stash.
         * @param {number} [count=1]
         */
        async requestFromFaucet(count = 1) {
            await this.loadFaucet();
            const n = Math.max(1, Math.min(50, Number(count) || 1));
            const got = [];
            for (let i = 0; i < n; i++) {
                const url = this.resolveFaucetUrl("token/phonebook");
                this.log("GET faucet", url);
                const res = await fetch(url, { method: "GET" });
                const text = (await res.text()).trim();
                if (!res.ok) {
                    const hint =
                        res.status === 503
                            ? "faucet phonebook stash empty — feed faucet_server first"
                            : text || res.statusText;
                    throw new Error(
                        `faucet token/phonebook → ${res.status}: ${hint}`
                    );
                }
                if (!text) {
                    throw new Error("faucet returned empty token body");
                }
                got.push(text);
            }
            const existing = await this.getTokens();
            await this.setTokens([...existing, ...got]);
            return {
                added: got.length,
                total: existing.length + got.length,
                faucet: this.faucetUrl,
            };
        }

        async health() {
            await this.loadBase();
            const url = this.resolveUrl("health");
            this.log("GET", url);
            const res = await fetch(url, { method: "GET" });
            const text = await res.text();
            let body;
            try {
                body = JSON.parse(text);
            } catch {
                body = text;
            }
            if (!res.ok) {
                throw new Error(
                    `health → ${res.status}: ${typeof body === "string" ? body : body?.error || text}`
                );
            }
            return body;
        }

        /**
         * @param {string} subject
         */
        async check(subject) {
            await this.loadBase();
            const s = encodePath(subject);
            if (!s) throw new Error("subject required");
            const url = this.resolveUrl(`subscriptions/${s}`);
            this.log("GET", url);
            const res = await fetch(url, { method: "GET" });
            const text = await res.text();
            let body = null;
            try {
                body = JSON.parse(text);
            } catch {
                body = { raw: text };
            }
            if (res.status === 404) {
                return {
                    ok: false,
                    subscribed: false,
                    subject: s,
                    status: 404,
                    ...(body && typeof body === "object" ? body : {}),
                };
            }
            if (!res.ok) {
                throw new Error(
                    `check ${s} → ${res.status}: ${body?.error || text}`
                );
            }
            return { ...body, status: 200 };
        }

        /**
         * @param {string} subject
         */
        async get(subject) {
            await this.loadBase();
            const s = encodePath(subject);
            if (!s) throw new Error("subject required");
            const url = this.resolveUrl(`phonebook/${s}`);
            this.log("GET", url);
            const res = await fetch(url, { method: "GET" });
            const text = await res.text();
            let body;
            try {
                body = JSON.parse(text);
            } catch {
                body = { raw: text };
            }
            if (res.status === 404) {
                return {
                    ok: false,
                    subscribed: false,
                    subject: s,
                    status: 404,
                    ...(body && typeof body === "object" ? body : {}),
                };
            }
            if (!res.ok) {
                throw new Error(
                    `get ${s} → ${res.status}: ${body?.error || text}`
                );
            }
            return { ...body, status: 200 };
        }

        /**
         * Report an IbGib frame under subject (auto-subscribes). Spends one usage token.
         * @param {string} subject
         * @param {object|string} frame
         * @param {{ token?: string }} [opts] — override token (does not touch stash)
         */
        async subscribe(subject, frame, opts = {}) {
            await this.loadBase();
            const s = encodePath(subject);
            if (!s) throw new Error("subject required");

            let obj = frame;
            if (typeof frame === "string") {
                try {
                    obj = JSON.parse(frame);
                } catch (error) {
                    throw new Error(
                        `frame JSON parse failed: ${error.message || error}`
                    );
                }
            }
            if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
                throw new Error("frame must be an IbGib object (ib, gib, …)");
            }
            if (obj.ib == null || obj.gib == null) {
                throw new Error("frame requires ib and gib");
            }

            const owned = opts.token == null;
            const token = owned
                ? await this.takeToken()
                : String(opts.token || "").trim();
            if (!token) throw new Error("usage token required");

            const url = this.resolveUrl(`phonebook/${s}`);
            this.log("POST", url, `${obj.ib}^${obj.gib}`);
            try {
                const res = await fetch(url, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        [HEADER.usageToken]: token,
                    },
                    body: JSON.stringify(obj),
                });
                const text = await res.text();
                let body;
                try {
                    body = JSON.parse(text);
                } catch {
                    body = { raw: text };
                }
                if (!res.ok) {
                    if (owned) await this.returnToken(token);
                    throw new Error(
                        `subscribe ${s} → ${res.status}: ${body?.error || text}`
                    );
                }
                return body;
            } catch (error) {
                if (
                    owned &&
                    !String(error.message || "").startsWith("subscribe ")
                ) {
                    await this.returnToken(token);
                }
                throw error;
            }
        }

        async report(subject, frame, opts) {
            return this.subscribe(subject, frame, opts);
        }

        /**
         * Pot free text to Flowerpot (stamping `alias` as the frame prefix),
         * then report the resulting frame under `subject`.
         *
         * Pots a fresh unique frame under `phonebook/<subject>/<uid>` via potter
         * (spends one Flowerpot usage token from potter's stash), then reports it
         * (spends one Phonebook usage token). getPayload of the frame addr yields
         * exactly this text — so it shows verbatim in `ring`.
         *
         * @param {string} subject
         * @param {{ alias?: string, text?: string }} [entry]
         * @returns {Promise<object>} subscribe result (frame_addr, tip, …)
         */
        async write(subject, { alias = "", text = "" } = {}) {
            const s = encodePath(subject);
            if (!s) throw new Error("subject required");
            const body = String(text ?? "");
            if (!body.trim()) throw new Error("text required");

            const pot =
                navi.mod?.potter?.potter ||
                (typeof navi.mod?.potter?.potString === "function"
                    ? navi.mod.potter
                    : null);
            if (!pot || typeof pot.potString !== "function") {
                throw new Error(
                    "write needs potter mounted (potString) — mount flowerpot/hypercloud/testkit/mods/legacy/potter.js"
                );
            }

            const uid = `${Date.now().toString(36)}${Math.random()
                .toString(36)
                .slice(2, 8)}`;
            const framePath = `phonebook/${s}/${uid}`;
            const aliasStr = String(alias ?? "").trim();

            const potted = await pot.potString(body, {
                ib: framePath,
                contentType: "text/plain; charset=utf-8",
                ...(aliasStr ? { asidePrefix: aliasStr } : {}),
            });

            const addr = String(potted?.addr || "").trim();
            const caret = addr.indexOf("^");
            if (caret <= 0 || caret === addr.length - 1) {
                throw new Error(`potter returned no ib^gib for ${framePath}`);
            }
            const frame = {
                ib: addr.slice(0, caret),
                gib: addr.slice(caret + 1),
            };

            return this.subscribe(subject, frame);
        }

        /**
         * Build scrollable ring HTML table for a subject's index.
         * Rows: payload text only (all frames, including frame 0).
         * (Alias column removed — Flowerpot data.alias does not land on aside tips.)
         * Uses potter.getPayload — fails loudly if potter is missing.
         * @param {string} subject
         * @returns {Promise<string>} raw HTML
         */
        async ring(subject) {
            const index = await this.get(subject);
            if (!index?.subscribed && index?.ok === false) {
                return `<div name="ring_table" data-part="ring" style="max-height:400px;overflow:auto">not subscribed: ${escHtml(
                    index.subject || subject
                )}</div>`;
            }

            const pot =
                navi.mod?.potter?.potter ||
                (typeof navi.mod?.potter?.getPayload === "function"
                    ? navi.mod.potter
                    : null);
            if (!pot || typeof pot.getPayload !== "function") {
                throw new Error(
                    "ring needs potter mounted (getPayload) — mount flowerpot/hypercloud/testkit/mods/legacy/potter.js"
                );
            }

            const frames = Array.isArray(index.frames) ? index.frames : [];
            const rows = [];
            for (const entry of frames) {
                const addr = String(entry?.addr || entry || "").trim();
                if (!addr) continue;

                let text = "";
                try {
                    const payload = await pot.getPayload(addr);
                    if (payload?.body != null && String(payload.body).length) {
                        text = String(payload.body);
                    } else if (payload?.json != null) {
                        text = JSON.stringify(payload.json);
                    } else {
                        text = `(potter.getPayload empty for ${addr})`;
                    }
                } catch (err) {
                    text = `(potter.getPayload failed: ${err.message || err})`;
                }

                rows.push(
                    `<tr>` +
                        `<td class="ring-text" style="max-width:400px;vertical-align:top;word-wrap:break-word;overflow-wrap:anywhere;white-space:pre-wrap;padding:0.25rem;border:1px solid #bbb">${escHtml(
                            text
                        )}</td>` +
                        `</tr>`
                );
            }

            if (!rows.length) {
                return `<div name="ring_table" data-part="ring" style="max-height:400px;overflow:auto">no rings for ${escHtml(
                    index.subject || subject
                )}</div>`;
            }

            return (
                `<div name="ring_table" data-part="ring" style="max-height:400px;overflow:auto;box-sizing:border-box">` +
                `<table style="border-collapse:collapse;width:100%;font:12px/1.35 monospace">` +
                `<thead><tr>` +
                `<th style="text-align:left;max-width:400px">ring</th>` +
                `</tr></thead><tbody>${rows.join("")}</tbody></table></div>`
            );
        }
    }

    function escHtml(s) {
        return String(s ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    const phonebookClient = new PhonebookClient();

    const HELP = [
        "phonebook_client — interact with the Phonebook frame ledger",
        "",
        "  phonebook_client check <subject>     Probe if subject is subscribed (no public list)",
        "  phonebook_client get <subject>       Fetch index snapshot for a known subject",
        "  phonebook_client ring <subject>      HTML table of index payloads (text; skips first)",
        "  phonebook_client health              GET /health",
        "  phonebook_client base [url]          Show or set API base (default /phonebook)",
        "  phonebook_client tokens              Show local spare-token count",
        "  phonebook_client tokens <path>       GET Flowerpot stash → phonebook_client.tokens",
        "  phonebook_client tokens clear        Empty local spare-token stash",
        "  phonebook_client faucet [n]          GET faucet /token/phonebook → usage (default 1)",
        "  phonebook_client faucet base [url]   Show / set faucet base (default /torus_faucet)",
        "  phonebook_client help",
        "",
        "  Programmatic (JSON frame already on Flowerpot; spends one usage token):",
        "    await navi.mod.phonebook_client.subscribe(subject, frameObject)",
        "    await navi.mod.phonebook_client.report(subject, frameObject)",
        "    await navi.mod.phonebook_client.ring(subject)  // raw HTML string",
        "    await navi.mod.phonebook_client.requestFromFaucet(n)",
        "  Subject path is arbitrary; frame.ib need not match.",
        "  example: phonebook_client check welcome.html",
        "  example: phonebook_client ring comments/posts/hello",
        "  example: phonebook_client tokens torus/devops/phonebook-tokens/a",
        "  example: phonebook_client faucet",
        "  example: phonebook_client faucet base http://localhost:8080",
    ].join("\n");

    const run = async (...rawArgs) => {
        const args = tokenize(rawArgs);
        if (!args.length || args[0] === "help" || args[0] === "-h") return HELP;

        const verb = String(args[0]).toLowerCase();

        try {
            switch (verb) {
                case "base":
                case "url": {
                    const next = args[1];
                    if (!next) {
                        await phonebookClient.loadBase();
                        return `base: ${phonebookClient.baseUrl}`;
                    }
                    return `base: ${await phonebookClient.setBase(next)}`;
                }

                case "tokens": {
                    const pathArg = args.slice(1).join(" ").trim();
                    if (!pathArg) {
                        const n = (await phonebookClient.getTokens()).length;
                        return `tokens: ${n} spare`;
                    }
                    const verb2 = String(args[1] || "").toLowerCase();
                    if (
                        verb2 === "clear" ||
                        verb2 === "empty" ||
                        verb2 === "reset"
                    ) {
                        const r = await phonebookClient.clearTokens();
                        return `cleared ${r.cleared} — tokens: 0 spare`;
                    }
                    if (verb2 === "faucet") {
                        const n = Number(args[2]) || 1;
                        const r = await phonebookClient.requestFromFaucet(n);
                        return `faucet +${r.added} from ${r.faucet}/token/phonebook — total ${r.total}`;
                    }
                    const r = await phonebookClient.loadTokensFromPath(pathArg);
                    return `loaded ${r.loaded} from flowerpot/${r.ib} — total ${r.total}`;
                }

                case "faucet": {
                    const sub = String(args[1] || "").toLowerCase();
                    if (sub === "base" || sub === "url") {
                        const next = args[2];
                        if (!next) {
                            await phonebookClient.loadFaucet();
                            return `faucet: ${phonebookClient.faucetUrl}`;
                        }
                        return `faucet: ${await phonebookClient.setFaucet(next)}`;
                    }
                    const n = args[1] != null && args[1] !== "" ? Number(args[1]) : 1;
                    if (args[1] != null && args[1] !== "" && !Number.isFinite(n)) {
                        return "Usage: phonebook_client faucet [n] | faucet base [url]";
                    }
                    const r = await phonebookClient.requestFromFaucet(n);
                    return `faucet +${r.added} from ${r.faucet}/token/phonebook — total ${r.total}`;
                }

                case "health": {
                    return JSON.stringify(await phonebookClient.health(), null, 2);
                }

                case "check": {
                    const subject = args.slice(1).join(" ");
                    if (!subject) return "Usage: phonebook_client check <subject>";
                    const r = await phonebookClient.check(subject);
                    if (!r.subscribed) {
                        return `not subscribed: ${r.subject || subject}`;
                    }
                    return [
                        `subscribed: ${r.subject}`,
                        `  tip_ib:   ${r.tip_ib || ""}`,
                        `  tip_addr: ${r.tip_addr || ""}`,
                        r.created_at ? `  since:    ${r.created_at}` : "",
                    ]
                        .filter(Boolean)
                        .join("\n");
                }

                case "get":
                case "index": {
                    const subject = args.slice(1).join(" ");
                    if (!subject) return "Usage: phonebook_client get <subject>";
                    const r = await phonebookClient.get(subject);
                    return JSON.stringify(r, null, 2);
                }

                case "ring": {
                    const subject = args.slice(1).join(" ");
                    if (!subject) return "Usage: phonebook_client ring <subject>";
                    return await phonebookClient.ring(subject);
                }

                case "subscribe":
                case "report":
                    return [
                        "Use programmatic API for JSON frames (spends one usage token):",
                        "  await navi.mod.phonebook_client.subscribe(subject, frameObject)",
                        "Load tokens first: phonebook_client tokens <flowerpot-stash-path>",
                    ].join("\n");

                default:
                    return `unknown: ${verb}\n\n${HELP}`;
            }
        } catch (error) {
            console.error("[phonebook_client]", error);
            return `error: ${error.message || error}`;
        }
    };

    return {
        name: "phonebook_client",
        version: "1.5.0",
        description:
            "Check / subscribe Phonebook ledger; ring HTML; write text frames (pot + report)",

        moduleInfo: {
            name: "phonebook_client",
            version: "1.5.0",
            description:
                "Check / subscribe Phonebook ledger; ring HTML; write text frames (pot + report)",
        },

        phonebook_client: phonebookClient,
        phonebookClient,
        encodePath,
        check: (...a) => phonebookClient.check(...a),
        get: (...a) => phonebookClient.get(...a),
        ring: (...a) => phonebookClient.ring(...a),
        subscribe: (...a) => phonebookClient.subscribe(...a),
        report: (...a) => phonebookClient.report(...a),
        write: (...a) => phonebookClient.write(...a),
        health: (...a) => phonebookClient.health(...a),
        getTokens: (...a) => phonebookClient.getTokens(...a),
        setTokens: (...a) => phonebookClient.setTokens(...a),
        clearTokens: (...a) => phonebookClient.clearTokens(...a),
        requestFromFaucet: (...a) => phonebookClient.requestFromFaucet(...a),

        commands: {
            phonebook_client: {
                name: "phonebook_client",
                description:
                    "phonebook_client check|get|ring|tokens|faucet|health|base — Phonebook ledger client",
                execute: async (...args) => run(...args),
            },
        },

        onMount: async () => {
            await phonebookClient.loadBase();
            await phonebookClient.loadFaucet();
            const n = (await phonebookClient.getTokens()).length;
            console.log(
                `[phonebook_client] ready v1.5.0 — base ${phonebookClient.baseUrl} — faucet ${phonebookClient.faucetUrl} — ${n} token(s)`
            );
        },

        onUnmount: () => {
            eventListeners.forEach(({ element, event, handler }) =>
                element.removeEventListener(event, handler)
            );
            eventListeners.length = 0;
            createdElements.forEach((el) => el.remove());
            createdElements.length = 0;
            addedStyles.forEach((s) => s.remove());
            addedStyles.length = 0;
            observers.forEach((o) => o.disconnect());
            observers.length = 0;
            timers.forEach(({ type, id }) => {
                if (type === "interval") clearInterval(id);
                if (type === "timeout") clearTimeout(id);
            });
            timers.length = 0;
            console.log("[phonebook_client] unmounted");
        },
    };
};
