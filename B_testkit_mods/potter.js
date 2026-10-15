// potter — pot content onto Flowerpot from navi callin.
//
// Tokens: stash a spare-token array on a private Flowerpot path, then
//   potter tokens <path>
// GETs it into navi.storage.item `potter.tokens`.
//
// Paths accept `/`, `:`, and whitespace as separators (surf/hyperuri-style);
// they are normalized to `/` for the HTTP request.
//
// Signing: if navi.mod.keychain is mounted, protected overwrites are signed
// with flowerpot-write-v1 (keys.v1). First write can attach --policy / --protect.
// Known aliases (systems) resolve to hardcoded
// policy ib^gib. --protect live reuses the tip's current X-Flowerpot-Policy.
//
// Index: every successful pot is recorded under navi.storage.item `potter_potted`.

export const register = (navi) => {
    const isBrowser =
        typeof window !== "undefined" && typeof window.document !== "undefined";

    const eventListeners = [];
    const createdElements = [];
    const addedStyles = [];
    const observers = [];
    const timers = [];

    const DEFAULT_BASE = "/flowerpot";
    const KEYCHAIN_MOUNT =
        "flowerpot/hypercloud/testkit/mods/legacy/keychain.js";
    const STORAGE = {
        tokens: "potter.tokens",
        baseUrl: "potter.base_url",
        potted: "potter_potted",
        defaultKey: "potter.default_key",
        policies: "potter.policies",
    };

    const HEADER = {
        usageToken: "X-Flowerpot-Usage-Token",
        ibGib: "X-Flowerpot-ib^gib",
        policy: "X-Flowerpot-Policy",
        schema: "X-Flowerpot-Schema",
        signKeys: "X-Flowerpot-Sign-Keys",
        signatures: "X-Flowerpot-Signatures",
        asidePrefix: "X-Flowerpot-Aside-Prefix",
        target: "X-Flowerpot-Target",
        mutationOf: "X-Flowerpot-Mutation-Of",
    };

    /**
     * Hardcoded write-gate policies. Public addrs + expected owner pubkey
     * (never the private key). --policy systems → systems-pot keys.v1 gate.
     */
    const POLICY_BOOK = {
        systems: {
            aliases: ["systems", "systems-pot", "systems_pot", "policies/systems-pot"],
            addr: "policies/systems-pot^2DF0074D4FF0F71A77A72E14A9DC75ED1ED687B96C26305F1257A4C4BD6C718D.BDAA3D860DA632BB7FEBEE6FC8F487DA6C8C840262870A47B839FC4C27B151CF",
            // keys.v1 policy instance authorizes only this public key:
            ownerPublicKey: "frRfkjWBtql_RcnrlprdM49Zq0ET5XFyN7urImKfbpo",
            ownerHash: "1f9be8567904053c",
            note: "keys.v1 — hypercloud / systems_pot_index (owner hash 1f9be8567904053c)",
        },
    };

    const policyEntryForAddr = (addrOrAlias) => {
        if (addrOrAlias == null || addrOrAlias === "") return null;
        const s = String(addrOrAlias).trim();
        if (!s || s.toLowerCase() === "live") return null;
        const key = s.toLowerCase().replace(/^\/+/, "");
        for (const [name, entry] of Object.entries(POLICY_BOOK)) {
            if (entry.aliases.some((a) => a.toLowerCase() === key)) {
                return { name, ...entry };
            }
            if (
                entry.addr.toLowerCase() === key ||
                entry.addr.toLowerCase().startsWith(`${key}^`) ||
                (s.includes("^") && entry.addr.toLowerCase() === s.toLowerCase())
            ) {
                return { name, ...entry };
            }
        }
        return null;
    };

    const resolvePolicy = (raw) => {
        if (raw == null || raw === "") return null;
        const s = String(raw).trim();
        if (!s) return null;
        if (s.toLowerCase() === "live") return "live";
        if (s.includes("^")) return s;
        const entry = policyEntryForAddr(s);
        if (entry) return entry.addr;
        const known = Object.keys(POLICY_BOOK).join(", ");
        throw new Error(
            `unknown policy '${s}' — use full ib^gib, live, or alias: ${known} (potter policies)`
        );
    };

    const formatPolicies = () =>
        Object.entries(POLICY_BOOK)
            .map(([name, e]) => {
                const al = e.aliases.filter((a) => a !== name).join(", ");
                const owner = e.ownerPublicKey
                    ? `\n    owner pub=${e.ownerPublicKey} hash=${e.ownerHash || "?"}`
                    : "";
                return `  ${name}${al ? ` (${al})` : ""}\n    ${e.addr}${owner}\n    ${e.note}`;
            })
            .join("\n");

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

    /** Parse `ib^gib` (or flowerpot:ib^gib) into parts. */
    const parseAddr = (raw) => {
        const addr = String(raw || "")
            .trim()
            .replace(/^flowerpot:/i, "");
        const caret = addr.indexOf("^");
        if (caret <= 0 || caret === addr.length - 1) return null;
        const ib = addr.slice(0, caret);
        const gib = addr.slice(caret + 1);
        if (!ib || !gib || gib.includes("^")) return null;
        return { addr: `${ib}^${gib}`, ib, gib };
    };

    const tokenize = (args) => {
        if (!args.length) return [];
        if (args.length === 1 && /\s/.test(args[0])) {
            const raw = args[0];
            const out = [];
            const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
            let m;
            while ((m = re.exec(raw))) out.push(m[1] ?? m[2] ?? m[3]);
            return out;
        }
        return args.map((a) => {
            if (
                (a.startsWith('"') && a.endsWith('"') && a.length >= 2) ||
                (a.startsWith("'") && a.endsWith("'") && a.length >= 2)
            ) {
                return a.slice(1, -1);
            }
            return a;
        });
    };

    const parseFlags = (tokens) => {
        const flags = {};
        const positional = [];
        for (let i = 0; i < tokens.length; i++) {
            const t = tokens[i];
            if (t === "--path" || t === "-p") flags.path = tokens[++i];
            else if (t === "--type" || t === "-t") flags.contentType = tokens[++i];
            else if (t === "--policy" || t === "--protect") flags.policy = tokens[++i];
            else if (t === "--key") flags.key = tokens[++i];
            else if (t === "--token") flags.token = tokens[++i];
            else if (t === "--url" || t === "--base") flags.baseUrl = tokens[++i];
            else if (t === "--aside" || t === "--aside-prefix") flags.asidePrefix = tokens[++i];
            else if (t === "--no-sign") flags.noSign = true;
            else positional.push(t);
        }
        return { flags, positional };
    };

    const guessContentType = (name, text) => {
        const preview = String(text || "").slice(0, 4000);
        if (
            preview.includes("export const register") ||
            preview.includes("export const moduleInfo")
        ) {
            return "application/navi-module";
        }
        const ext = String(name || "").split(".").pop()?.toLowerCase();
        const types = {
            js: "application/javascript",
            mjs: "application/javascript",
            json: "application/json",
            html: "text/html",
            css: "text/css",
            md: "text/markdown",
            txt: "text/plain",
            svg: "image/svg+xml",
            lua: "text/x-lua",
        };
        return types[ext] || "application/octet-stream";
    };

    class Potter {
        constructor() {
            this.baseUrl = DEFAULT_BASE;
        }

        log(...args) {
            console.log("[potter]", ...args);
        }

        async loadBase() {
            this.baseUrl =
                (await navi.storage.item.get(STORAGE.baseUrl)) || DEFAULT_BASE;
            return this.baseUrl;
        }

        async setBase(url) {
            const u = String(url || DEFAULT_BASE).replace(/\/$/, "") || DEFAULT_BASE;
            await navi.storage.item.set(STORAGE.baseUrl, u);
            this.baseUrl = u;
            return u;
        }

        buildUrl(path) {
            const base = String(this.baseUrl || DEFAULT_BASE).replace(/\/$/, "");
            const ib = encodePath(path);
            return `${base}/${ib}`;
        }

        resolveUrl(path) {
            const built = this.buildUrl(path);
            if (/^https?:\/\//i.test(built)) return new URL(built);
            const origin = globalThis.location?.origin || "http://localhost";
            return new URL(built, origin);
        }

        async parseError(response) {
            const ct = response.headers.get("Content-Type") || "";
            try {
                if (ct.includes("application/json")) {
                    return JSON.stringify(await response.json());
                }
            } catch {
                /* fall through */
            }
            return response.text();
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

        async takeToken() {
            const tokens = await this.getTokens();
            if (!tokens.length) {
                throw new Error(
                    "no usage tokens — potter tokens <secret-path> to load a stash"
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

        async getCustomPolicies() {
            const raw = await navi.storage.item.get(STORAGE.policies);
            if (!raw) return {};
            if (typeof raw === "object" && !Array.isArray(raw)) return { ...raw };
            try {
                const parsed = JSON.parse(String(raw));
                return parsed && typeof parsed === "object" && !Array.isArray(parsed)
                    ? parsed
                    : {};
            } catch {
                return {};
            }
        }

        async policyEntry(raw) {
            const known = policyEntryForAddr(raw);
            if (known) return known;
            const needle = String(raw || "").trim().toLowerCase();
            if (!needle) return null;
            const custom = await this.getCustomPolicies();
            for (const [name, entry] of Object.entries(custom)) {
                const addr = String(entry.addr || "").toLowerCase();
                const aliases = [
                    name.toLowerCase(),
                    `policies/${name}`.toLowerCase(),
                    ...(Array.isArray(entry.aliases)
                        ? entry.aliases.map((a) => String(a).toLowerCase())
                        : []),
                ];
                if (
                    aliases.includes(needle) ||
                    (addr &&
                        (addr === needle ||
                            addr.startsWith(`${needle}^`) ||
                            (needle.includes("^") && addr === needle)))
                ) {
                    return { name, ...entry };
                }
            }
            return null;
        }

        async createKeyPolicy(nameRaw, keyName = "default", pathRaw = "") {
            await this.loadBase();
            const name = String(nameRaw || "").trim().toLowerCase();
            if (!/^[a-z0-9][a-z0-9._-]*$/.test(name)) {
                throw new Error("policy name must use letters, numbers, dot, underscore, or dash");
            }
            const kc = this.keychain();
            const get = kc?.get || kc?.keychain?.get;
            if (!kc || typeof get !== "function") {
                throw new Error("keychain module not mounted or keychain.get unavailable");
            }
            const key = await get.call(kc, keyName || "default");
            if (!key?.publicKey) {
                throw new Error(`no key '${keyName || "default"}' in keychain`);
            }

            const ib = encodePath(pathRaw || `policies/${name}`);
            const existing = await this.peekParent(ib);
            if (existing.exists) {
                throw new Error(
                    `policy path '${ib}' already exists — choose another name or --path, or: potter policy import ${name}`
                );
            }

            const token = await this.takeToken();
            const body = JSON.stringify({
                threshold: 1,
                keys: [key.publicKey],
            });
            let consumed = false;
            try {
                const res = await fetch(this.resolveUrl(ib), {
                    method: "PUT",
                    headers: {
                        "Content-Type": "application/json",
                        [HEADER.usageToken]: token,
                        [HEADER.schema]: "flowerpot.schema.keys.v1",
                    },
                    body,
                });
                const text = await res.text();
                if (!res.ok) {
                    await this.returnToken(token);
                    throw new Error(`PUT ${ib} -> ${res.status}: ${text}`);
                }
                consumed = true;
                const json = JSON.parse(text);
                const addr =
                    res.headers.get(HEADER.ibGib) ||
                    res.headers.get("X-Flowerpot-ib^gib") ||
                    json.addr;
                if (!addr) throw new Error("policy PUT succeeded without an ib^gib addr");
                const custom = await this.getCustomPolicies();
                custom[name] = {
                    aliases: [name],
                    addr,
                    ownerPublicKey: key.publicKey,
                    ownerHash: key.hash || null,
                    keyName: keyName || "default",
                    note: `keys.v1 local key '${keyName || "default"}'`,
                };
                await navi.storage.item.set(STORAGE.policies, custom);
                return { name, ib, addr, keyName: keyName || "default", key };
            } catch (error) {
                if (
                    !consumed &&
                    !String(error?.message || "").startsWith("PUT ")
                ) {
                    await this.returnToken(token);
                }
                throw error;
            }
        }

        /**
         * Bind a local alias to an existing live keys.v1 policy tip (no PUT).
         * Default path: policies/<alias>. Use --path for a full ib or ib^gib.
         */
        async importKeyPolicy(nameRaw, pathRaw = "") {
            await this.loadBase();
            const name = String(nameRaw || "").trim().toLowerCase();
            if (!/^[a-z0-9][a-z0-9._-]*$/.test(name)) {
                throw new Error(
                    "policy name must use letters, numbers, dot, underscore, or dash"
                );
            }
            let route = encodePath(pathRaw || `policies/${name}`);
            let addrHint = null;
            if (String(pathRaw || "").includes("^")) {
                const p = parseAddr(String(pathRaw).trim());
                if (!p) throw new Error(`bad policy addr: ${pathRaw}`);
                route = p.ib;
                addrHint = p.addr;
            }
            if (!route) throw new Error("policy path required");

            const url = addrHint
                ? `${this.resolveUrl(route)}?addr=${encodeURIComponent(addrHint)}`
                : this.resolveUrl(route);
            this.log("GET policy import", route, addrHint || "latest");
            const res = await fetch(url, { method: "GET" });
            const text = await res.text();
            if (!res.ok) {
                throw new Error(
                    `GET ${route} -> ${res.status}: ${text.slice(0, 200)}`
                );
            }
            const addr =
                res.headers.get(HEADER.ibGib) ||
                res.headers.get("X-Flowerpot-ib^gib") ||
                addrHint;
            if (!addr) {
                throw new Error("policy GET missing X-Flowerpot-ib^gib");
            }
            let body;
            try {
                body = JSON.parse(text);
            } catch (e) {
                throw new Error(
                    `policy tip is not JSON: ${e.message || e}`
                );
            }
            const keys = Array.isArray(body.keys) ? body.keys.map(String) : [];
            if (!keys.length) {
                throw new Error(
                    "policy tip has no keys[] — expected keys.v1 shape { threshold, keys }"
                );
            }
            const ownerPublicKey = keys[0];
            let ownerHash = null;
            let keyName = null;
            const match = await this.findKeyNameForPublicKey(ownerPublicKey);
            if (match) {
                keyName = match;
                const kc = this.keychain();
                const get = kc?.get || kc?.keychain?.get;
                if (typeof get === "function") {
                    const entry = await get.call(kc, match);
                    ownerHash = entry?.hash || null;
                }
            }
            if (!ownerHash && globalThis.crypto?.subtle) {
                const dig = await crypto.subtle.digest(
                    "SHA-256",
                    new TextEncoder().encode(ownerPublicKey)
                );
                ownerHash = [...new Uint8Array(dig)]
                    .map((b) => b.toString(16).padStart(2, "0"))
                    .join("")
                    .slice(0, 16);
            }

            const custom = await this.getCustomPolicies();
            custom[name] = {
                aliases: [name],
                addr,
                ownerPublicKey,
                ownerHash,
                keyName,
                threshold:
                    typeof body.threshold === "number" ? body.threshold : 1,
                note: keyName
                    ? `imported from live ${route} (keychain '${keyName}')`
                    : `imported from live ${route} — import owner key into keychain if you need to sign`,
                importedAt: new Date().toISOString(),
            };
            await navi.storage.item.set(STORAGE.policies, custom);
            return {
                name,
                ib: route,
                addr,
                ownerPublicKey,
                ownerHash,
                keyName,
                inKeychain: !!keyName,
            };
        }

        /**
         * GET a Flowerpot path that holds a token array (or {spare tokens}/{tokens})
         * and merge into local potter.tokens.
         */
        async loadTokensFromPath(rawPath) {
            await this.loadBase();
            const ib = encodePath(rawPath);
            if (!ib) throw new Error("token path required");
            const url = this.resolveUrl(ib);
            this.log("GET tokens", ib);
            const res = await fetch(url, { method: "GET" });
            if (!res.ok) {
                throw new Error(`GET ${ib} -> ${res.status}: ${await this.parseError(res)}`);
            }
            const ct = res.headers.get("Content-Type") || "";
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
                    `token stash at ${ib} is not JSON array (${e.message}). ct=${ct}`
                );
            }
            const clean = incoming.map(String).filter(Boolean);
            const existing = await this.getTokens();
            await this.setTokens([...existing, ...clean]);
            return { loaded: clean.length, total: existing.length + clean.length, ib };
        }

        // --- payload GET (latest tip or ?addr= pin) ------------------------

        /**
         * Fetch payload bytes for an ib path, or a specific version when the
         * argument is a full ib^gib (`^gib` pins via ?addr=).
         * @param {string} rawPathOrAddr
         * @param {{ headers?: Record<string, string> }} [opts]
         */
        async getPayload(rawPathOrAddr, opts = {}) {
            await this.loadBase();
            const raw = String(rawPathOrAddr || "").trim();
            const parsed = parseAddr(raw);
            const ib = parsed ? parsed.ib : encodePath(raw);
            if (!ib) throw new Error("path or ib^gib required");

            const url = this.resolveUrl(ib);
            if (parsed) url.searchParams.set("addr", parsed.addr);

            const headers = { ...(opts.headers || {}) };
            this.log("GET payload", parsed ? parsed.addr : ib);
            const res = await fetch(url, { method: "GET", headers });
            const contentType = res.headers.get("Content-Type") || "";
            const servedAddr =
                res.headers.get(HEADER.ibGib) ||
                res.headers.get("X-Flowerpot-ib^gib") ||
                (parsed ? parsed.addr : null);
            const text = await res.text();
            if (!res.ok) {
                throw new Error(
                    `GET ${parsed ? parsed.addr : ib} -> ${res.status}: ${text}`
                );
            }

            let json = null;
            const baseMime = contentType.split(";")[0].trim().toLowerCase();
            if (
                baseMime === "application/json" ||
                baseMime === "application/ld+json" ||
                baseMime.endsWith("+json") ||
                /^\s*[\[{]/.test(text)
            ) {
                try {
                    json = JSON.parse(text);
                } catch {
                    json = null;
                }
            }

            return {
                addr: servedAddr,
                ib,
                gib: parsed ? parsed.gib : null,
                contentType,
                body: text,
                json,
                headers: {
                    policy: res.headers.get("X-Flowerpot-Policy") || null,
                    readPolicy: res.headers.get("X-Flowerpot-Read-Policy") || null,
                    schema: res.headers.get("X-Flowerpot-Schema") || null,
                },
            };
        }

        /** @deprecated use getPayload */
        async getByAddr(rawAddr, opts = {}) {
            return this.getPayload(rawAddr, opts);
        }

        // --- graph-node frame GET (/_flowerpot/frame?addr=) ----------------

        /**
         * Fetch the raw IbGib_V1 graph-node frame JSON for an ib^gib addr.
         * @param {string} rawAddr
         * @param {{ headers?: Record<string, string> }} [opts]
         */
        async getFrame(rawAddr, opts = {}) {
            await this.loadBase();
            const parsed = parseAddr(rawAddr);
            if (!parsed) {
                throw new Error("invalid ib^gib address (expected ib^gib)");
            }

            const base = String(this.baseUrl || DEFAULT_BASE).replace(/\/$/, "");
            const built = `${base}/_flowerpot/frame`;
            const origin = globalThis.location?.origin || "http://localhost";
            const url = /^https?:\/\//i.test(built)
                ? new URL(built)
                : new URL(built, origin);
            url.searchParams.set("addr", parsed.addr);

            const headers = { ...(opts.headers || {}) };
            this.log("GET frame", parsed.addr);
            const res = await fetch(url, { method: "GET", headers });
            const text = await res.text();
            if (!res.ok) {
                throw new Error(`GET frame ${parsed.addr} -> ${res.status}: ${text}`);
            }

            let frame = null;
            try {
                frame = JSON.parse(text);
            } catch {
                throw new Error(`GET frame ${parsed.addr} returned non-JSON`);
            }

            return {
                addr:
                    res.headers.get(HEADER.ibGib) ||
                    res.headers.get("X-Flowerpot-ib^gib") ||
                    parsed.addr,
                ib: parsed.ib,
                gib: parsed.gib,
                frame,
                body: text,
            };
        }

        // --- potted index --------------------------------------------------

        async getPotted() {
            const raw = await navi.storage.item.get(STORAGE.potted);
            if (!raw) return [];
            if (Array.isArray(raw)) return raw;
            try {
                const parsed = JSON.parse(String(raw));
                return Array.isArray(parsed) ? parsed : [];
            } catch {
                return [];
            }
        }

        async recordPotted({ ib, addr, contentType, bytes, mode }) {
            const list = await this.getPotted();
            const entry = {
                ib,
                addr: addr || null,
                contentType: contentType || null,
                bytes: bytes ?? null,
                mode: mode || "put",
                at: new Date().toISOString(),
            };
            const idx = list.findIndex((e) => e && e.ib === ib);
            if (idx >= 0) list[idx] = entry;
            else list.push(entry);
            await navi.storage.item.set(STORAGE.potted, list);
            return entry;
        }

        async clearPotted() {
            await navi.storage.item.set(STORAGE.potted, []);
        }

        // --- keychain bridge -----------------------------------------------

        keychain() {
            return navi.mod?.keychain || null;
        }

        async keychainStatus() {
            const kc = this.keychain();
            if (!kc) {
                return {
                    mounted: false,
                    mount: KEYCHAIN_MOUNT,
                    hint: `potter keychain connect  (or: mount ${KEYCHAIN_MOUNT})`,
                };
            }
            let keys = [];
            try {
                if (typeof kc.list === "function") keys = await kc.list();
                else if (typeof kc.keychain?.list === "function") {
                    keys = await kc.keychain.list();
                } else if (Array.isArray(kc.names)) {
                    keys = kc.names;
                }
            } catch {
                keys = [];
            }
            const defaultKey =
                (await navi.storage.item.get(STORAGE.defaultKey)) || "default";
            return {
                mounted: true,
                keys: Array.isArray(keys) ? keys : [],
                defaultKey,
            };
        }

        async connectKeychain() {
            if (this.keychain()) {
                const status = await this.keychainStatus();
                return { ok: true, already: true, ...status };
            }
            const spec = KEYCHAIN_MOUNT;
            try {
                if (typeof navi === "function") {
                    await navi(`mount ${spec}`);
                } else if (typeof navi.mount === "function") {
                    await this.loadBase();
                    const ib = encodePath(
                        spec.replace(/^flowerpot\//i, "")
                    );
                    const res = await fetch(this.resolveUrl(ib));
                    const code = await res.text();
                    if (!res.ok) {
                        throw new Error(
                            `GET ${ib} → ${res.status}: ${code.slice(0, 160)}`
                        );
                    }
                    await navi.mount(code);
                } else {
                    throw new Error(
                        "navi.mount / callin unavailable — mount keychain manually"
                    );
                }
            } catch (e) {
                throw new Error(
                    `keychain connect failed: ${e.message || e} — try: mount ${spec}`
                );
            }
            if (!this.keychain()) {
                throw new Error(
                    `keychain still not mounted after connect — try: mount ${spec}`
                );
            }
            const status = await this.keychainStatus();
            return { ok: true, already: false, connected: spec, ...status };
        }

        async findKeyNameForPublicKey(publicKey) {
            const want = String(publicKey || "").trim();
            if (!want) return null;
            const kc = this.keychain();
            if (!kc) return null;
            const list = kc.list || kc.keychain?.list;
            const get = kc.get || kc.keychain?.get;
            if (typeof list !== "function" || typeof get !== "function") return null;
            const names = await list.call(kc);
            for (const name of names || []) {
                const entry = await get.call(kc, name);
                if (entry?.publicKey === want) return name;
            }
            return null;
        }

        async resolveSignKeyName({ keyName, policyHint }) {
            if (keyName) return keyName;
            const entry = await this.policyEntry(policyHint);
            if (entry?.ownerPublicKey) {
                const match = await this.findKeyNameForPublicKey(entry.ownerPublicKey);
                if (match) return match;
                throw new Error(
                    `policy '${entry.name}' requires owner pub=${entry.ownerPublicKey} (hash ${entry.ownerHash || "?"}) — ` +
                        `import that key into keychain (not a freshly created default), or pass --key <name>`
                );
            }
            return (
                (await navi.storage.item.get(STORAGE.defaultKey)) || "default"
            );
        }

        async signIfNeeded({ ib, parentAddr, body, contentType, keyName, force }) {
            const kc = this.keychain();
            if (!kc) {
                if (force) throw new Error("keychain module not mounted — cannot sign");
                return null;
            }
            if (!parentAddr && !force) return null;
            const signWrite = kc.signWrite || kc.keychain?.signWrite;
            const buildHeaders =
                kc.buildSignHeaders || kc.keychain?.buildSignHeaders;
            if (typeof signWrite !== "function") {
                throw new Error("keychain.signWrite unavailable");
            }
            const key = keyName || "default";
            const signed = await signWrite.call(kc, {
                ib,
                parentAddr: parentAddr || "",
                body,
                contentType,
                key,
            });
            const headers =
                typeof buildHeaders === "function"
                    ? buildHeaders.call(kc, signed)
                    : {
                          [HEADER.signKeys]: signed.publicKey,
                          [HEADER.signatures]: signed.signature,
                      };
            return {
                headers,
                key: signed.key || key,
                publicKey: signed.publicKey,
                hash: signed.hash || null,
            };
        }

        // --- pot -----------------------------------------------------------

        async peekParent(ib) {
            const url = this.resolveUrl(ib);
            const res = await fetch(url, { method: "GET" });
            if (res.status === 404) {
                return { exists: false, parentAddr: "", policy: null };
            }
            const parentAddr =
                res.headers.get(HEADER.ibGib) ||
                res.headers.get("X-Flowerpot-ib^gib") ||
                "";
            const policy =
                res.headers.get(HEADER.policy) ||
                res.headers.get("X-Flowerpot-Policy") ||
                null;
            // Drain body so the connection can close cleanly.
            try {
                await res.arrayBuffer();
            } catch {
                /* ignore */
            }
            if (!res.ok && res.status !== 404) {
                return {
                    exists: false,
                    parentAddr: "",
                    policy: null,
                    warn: `probe GET ${ib} -> ${res.status}`,
                };
            }
            return { exists: !!parentAddr, parentAddr, policy };
        }

        /**
         * Resolve --policy / --protect. `live` = tip's current write policy.
         */
        async resolveProtect(raw, probe) {
            if (raw == null || String(raw).trim() === "") return null;
            const text = String(raw).trim();
            let resolved;
            if (text.toLowerCase() === "live") {
                resolved = "live";
            } else if (text.includes("^")) {
                resolved = text;
            } else {
                const entry = await this.policyEntry(text);
                if (!entry) {
                    const custom = Object.keys(await this.getCustomPolicies());
                    const known = [...Object.keys(POLICY_BOOK), ...custom].join(", ");
                    throw new Error(
                        `unknown policy '${text}' — use full ib^gib, live, alias (${known || "none"}), or: potter policy import ${text}`
                    );
                }
                resolved = entry.addr;
            }
            if (resolved !== "live") return resolved;
            if (!probe?.exists) {
                throw new Error(
                    "--protect live needs an existing tip — use --protect systems (or another alias) on first write"
                );
            }
            if (!probe.policy) {
                throw new Error(
                    `--protect live: tip has no X-Flowerpot-Policy (open tip)`
                );
            }
            return probe.policy;
        }

        async pot({
            ib: rawIb,
            body,
            contentType,
            policy,
            keyName,
            noSign = false,
            usageToken = null,
            asidePrefix = null,
            targetAddrs = null,
            mutationOfAddrs = null,
        }) {
            await this.loadBase();
            const ib = encodePath(rawIb);
            if (!ib) throw new Error("--path required");
            if (body == null) throw new Error("nothing to pot");

            const ct =
                contentType ||
                guessContentType(ib, typeof body === "string" ? body : "");
            const fromStash = !usageToken;
            const token = fromStash
                ? await this.takeToken()
                : String(usageToken).trim();
            if (!token) throw new Error("--token requires a non-empty usage token");
            const probe = await this.peekParent(ib);
            const resolvedPolicy = await this.resolveProtect(policy, probe);
            if (!probe.exists && resolvedPolicy) {
                const known = await this.policyEntry(resolvedPolicy);
                if (known?.ownerPublicKey) {
                    this.log(
                        `attaching ${known.name} — later overwrites need owner hash ${known.ownerHash || "?"} (not a random keychain create)`
                    );
                }
            }
            if (
                probe.exists &&
                probe.policy &&
                resolvedPolicy &&
                resolvedPolicy !== "live"
            ) {
                const tipPol = String(probe.policy).toLowerCase();
                const wantPol = String(resolvedPolicy).toLowerCase();
                if (
                    tipPol !== wantPol &&
                    !tipPol.startsWith(`${wantPol}^`) &&
                    !wantPol.startsWith(tipPol.split("^")[0])
                ) {
                    this.log(
                        `note: tip already gated by ${probe.policy}; --protect ignored on overwrite (signed DELETE then recreate to change policy)`
                    );
                }
            }

            const headers = {
                "Content-Type": ct,
                [HEADER.usageToken]: token,
            };

            try {
                // Attach write policy only on first create. Overwrites inherit the tip gate.
                if (!probe.exists && resolvedPolicy) {
                    headers[HEADER.policy] = resolvedPolicy;
                }

                // Aside: only used by Flowerpot when write policy denies the tip.
                // Always send when the caller supplied a prefix (free incidental path).
                // NOTE: Flowerpot is supposed to stamp data.alias = this prefix on the
                // incidental graph-node, but we have not been able to get alias to show
                // up on live aside tips (path encodes the prefix; data.alias stays absent).
                // Phonebook ring dropped its alias column for that reason.
                const aside = String(asidePrefix || "").trim().replace(/^\/+|\/+$/g, "");
                if (aside) {
                    headers[HEADER.asidePrefix] = aside;
                    // Prefer explicit targets; else tip parent so aside rel8ns.target the locked head.
                    let targets = Array.isArray(targetAddrs)
                        ? targetAddrs.map(String).filter(Boolean)
                        : [];
                    if (!targets.length && probe.parentAddr) {
                        targets = [probe.parentAddr];
                    }
                    if (targets.length) {
                        headers[HEADER.target] = targets.join(",");
                    }
                }

                const mutOf = Array.isArray(mutationOfAddrs)
                    ? mutationOfAddrs.map(String).filter(Boolean)
                    : [];
                if (mutOf.length) {
                    headers[HEADER.mutationOf] = mutOf.join(",");
                }

                // Write-gated tip (has policy): must sign with THAT tip's owner key.
                // --protect only picks the key on first create; overwrite always uses tip gate.
                let signedWith = null;
                const gated = !!(probe.exists && probe.policy);
                const policyHintForSign = gated
                    ? probe.policy
                    : resolvedPolicy || null;
                if (probe.exists && probe.parentAddr && !noSign) {
                    if (gated && !this.keychain()) {
                        throw new Error(
                            `tip is write-gated (${probe.policy}) — mount keychain and import the policy owner key (or pass --key)`
                        );
                    }
                    if (this.keychain()) {
                        const useKey = await this.resolveSignKeyName({
                            keyName,
                            policyHint: gated ? policyHintForSign : null,
                        });
                        const signed = await this.signIfNeeded({
                            ib,
                            parentAddr: probe.parentAddr,
                            body,
                            contentType: ct,
                            keyName: useKey,
                            force: gated,
                        });
                        if (signed?.headers) {
                            Object.assign(headers, signed.headers);
                            signedWith = signed;
                        }
                    }
                }

                this.log(
                    "PUT",
                    ib,
                    ct,
                    probe.exists ? "overwrite" : "create",
                    signedWith
                        ? `signed key=${signedWith.key} hash=${signedWith.hash || "?"}`
                        : gated
                          ? "UNSIGNED gated"
                          : "",
                    aside ? `aside=${aside}` : ""
                );
                const res = await fetch(this.resolveUrl(ib), {
                    method: "PUT",
                    headers,
                    body,
                });
                const addr =
                    res.headers.get(HEADER.ibGib) ||
                    res.headers.get("X-Flowerpot-ib^gib") ||
                    null;
                const text = await res.text();
                if (!res.ok) {
                    if (fromStash) await this.returnToken(token);
                    let msg = `PUT ${ib} -> ${res.status}: ${text}`;
                    if (
                        res.status === 401 &&
                        /threshold not met/i.test(text)
                    ) {
                        const tipGate = probe.policy || null;
                        const known = await this.policyEntry(
                            tipGate || policyHintForSign
                        );
                        if (tipGate) {
                            msg += `\n  tip write-gate: ${tipGate}`;
                        }
                        if (signedWith) {
                            msg += `\n  signed with keychain '${signedWith.key}' pub=${signedWith.publicKey} hash=${signedWith.hash || "?"}`;
                        }
                        if (known?.ownerPublicKey) {
                            msg += `\n  ${known.name} expects pub=${known.ownerPublicKey} hash=${known.ownerHash || "?"}`;
                            msg += `\n  import that owner into keychain, or signed DELETE then PUT with --protect <new> to change policy`;
                        } else if (tipGate) {
                            msg += `\n  (no local alias for that tip policy — potter policies / import the tip owner key, or --key <name>)`;
                        }
                    }
                    throw new Error(msg);
                }
                let result;
                try {
                    result = JSON.parse(text);
                } catch {
                    result = { ok: true, raw: text };
                }
                const bytes =
                    typeof body === "string"
                        ? new TextEncoder().encode(body).byteLength
                        : body?.byteLength ?? body?.length ?? null;
                const wroteAside = !!(aside && result?.aside);
                await this.recordPotted({
                    ib: result?.ib || (wroteAside ? `${aside}/${ib}` : ib),
                    addr,
                    contentType: ct,
                    bytes,
                    mode: wroteAside
                        ? "aside"
                        : probe.exists
                          ? "overwrite"
                          : "create",
                });
                return {
                    ib: result?.ib || ib,
                    addr: addr || result?.addr || null,
                    contentType: ct,
                    result,
                    aside: wroteAside,
                    asidePrefix: aside || null,
                    tokensLeft: (await this.getTokens()).length,
                    tokenSource: fromStash ? "stash" : "flag",
                };
            } catch (error) {
                if (fromStash && error && !String(error.message || "").startsWith("PUT ")) {
                    try {
                        await this.returnToken(token);
                    } catch {
                        /* ignore */
                    }
                }
                throw error;
            }
        }

        async potString(text, opts) {
            return this.pot({ ...opts, body: String(text ?? "") });
        }

        async potFile(fileKey, opts) {
            const media = await navi.storage.file.load(fileKey);
            if (media == null) throw new Error(`navi.storage.file not found: ${fileKey}`);
            const record = await navi.storage.file.get(fileKey);
            const mime =
                opts.contentType ||
                record?.mime ||
                guessContentType(fileKey, String(media));
            return this.pot({
                ...opts,
                body: typeof media === "string" ? media : String(media),
                contentType: mime,
            });
        }

        /**
         * GET a relative (or absolute) href, then PUT the response body to --path.
         * Relative paths resolve against the page origin (`/…`); `:` / spaces encode like other potter paths.
         */
        async potHref(rawHref, opts = {}) {
            const raw = String(rawHref || "").trim();
            if (!raw) throw new Error("href required");

            let url;
            if (/^https?:\/\//i.test(raw)) {
                url = new URL(raw);
            } else {
                const origin = globalThis.location?.origin || "http://localhost";
                url = new URL(`/${encodePath(raw)}`, origin);
            }

            this.log("GET href", url.href);
            const res = await fetch(url.href, { method: "GET" });
            const headerCt = (res.headers.get("Content-Type") || "").split(";")[0].trim();
            if (!res.ok) {
                const errText = await res.text().catch(() => "");
                throw new Error(
                    `GET href ${url.pathname} -> ${res.status}: ${errText.slice(0, 200)}`
                );
            }

            const mime =
                opts.contentType ||
                headerCt ||
                guessContentType(url.pathname, "");
            const textish =
                /^text\//i.test(mime) ||
                /^(application\/(json|javascript|xml|navi-module)|.*\+json)/i.test(
                    mime
                ) ||
                /javascript/i.test(mime);
            const body = textish ? await res.text() : new Uint8Array(await res.arrayBuffer());

            return this.pot({
                ...opts,
                body,
                contentType: mime,
            });
        }
    }

    const potter = new Potter();

    const HELP = [
        "potter — pot bytes onto Flowerpot from navi",
        "",
        "  potter base [url]                     Show/set base (default /flowerpot)",
        "  potter tokens <path>                  GET token stash from Flowerpot → potter.tokens",
        "  potter tokens list|count|clear        Inspect / clear local usage tokens",
        "  potter keychain                       Is keychain mounted? (+ key names)",
        "  potter keychain connect               Mount keychain from Flowerpot if missing",
        "  potter pot string <text...> --path <ib> [--type mime] [--protect|--policy alias|addr|live] [--key name] [--token usageToken] [--aside prefix] [--no-sign]",
        "  potter pot file <fileKey> --path <ib> [--type mime] [--protect|--policy alias|addr|live] [--key name] [--token usageToken] [--aside prefix]",
        "  potter pot href <rel-or-url> --path <ib> [--type mime] [--protect|--policy alias|addr|live] [--key name] [--token usageToken] [--aside prefix]",
        "  potter get <path|ib^gib>              GET payload (latest tip, or ?addr= when ^gib present)",
        "  potter ibgib <ib^gib>                 GET raw IbGib graph-node frame JSON (/_flowerpot/frame)",
        "  potter policies                       List built-in + locally created policy aliases",
        "  potter policy create keys.v1 <alias> --key <name> [--path policies/<ib>]",
        "                                        PUT a keys.v1 write-gate (threshold 1, that key) + save alias",
        "  potter policy import <alias> [--path policies/<ib>|ib^gib]",
        "                                        GET live tip → save local alias (no PUT); default path policies/<alias>",
        "  potter index | potter potted          List potter_potted index",
        "  potter clear index                    Clear potter_potted",
        "",
        "  Path separators `/` `:` and spaces encode to `/` for the request.",
        "  --protect / --policy: systems | full ib^gib | live",
        "  systems = keys.v1 authorizing owner hash 1f9be8567904053c (not a random keychain create)",
        "  --protect attaches a write-gate on first create only (systems | alias | ib^gib | live).",
        "  --protect live reuses the tip's current X-Flowerpot-Policy (existing tip only).",
        "  Gated overwrites auto-sign with the tip's existing owner key; --protect does not swap gates.",
        "  To change policy: signed DELETE (owner) then PUT with --protect <new>.",
        "  --aside <prefix> sends X-Flowerpot-Aside-Prefix (used when tip write is denied → {prefix}/{ib}).",
        "  --token uses that usage token once (does not touch potter.tokens stash).",
        "  pot href GETs the relative (or absolute) URL, then PUTs that body to --path.",
        "  example: potter pot string hello --path hypercloud:testkit:data:hello.txt",
        "  example: potter pot string hi --path hypercloud/testkit/data/hi.txt --token <usageToken>",
        "  example: potter pot href flowerpot/hypercloud/testkit/data/hello.txt --path hypercloud/testkit/data/copy.txt",
        "  example: potter pot file mods/foo.js --path hypercloud/testkit/mods/legacy/foo.js --protect systems",
        "  example: potter policy create keys.v1 my-key --key default",
        "  example: potter policy import my-policy",
        "  example: potter pot string hi --path docs/hi --protect my-key",
        "  example: potter pot string update --path hypercloud/testkit/mods/legacy/foo.js --protect live",
        "  example: potter get hypercloud/testkit/mods/legacy/potter.js^DEADBEEF…",
        "  example: potter ibgib hypercloud/testkit/mods/legacy/potter.js^DEADBEEF…",
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
                        await potter.loadBase();
                        return `base: ${potter.baseUrl}`;
                    }
                    return `base: ${await potter.setBase(next)}`;
                }

                case "tokens": {
                    const sub = String(args[1] || "").toLowerCase();
                    if (!sub || sub === "list") {
                        const t = await potter.getTokens();
                        if (sub === "list") {
                            return t.length
                                ? t.map((x, i) => `  [${i}] ${x.slice(0, 12)}…`).join("\n")
                                : "(no tokens)";
                        }
                        // bare `tokens` without path → count + hint
                        if (!args[1]) {
                            return `${t.length} token(s). load: potter tokens <path>`;
                        }
                    }
                    if (sub === "count") {
                        return String((await potter.getTokens()).length);
                    }
                    if (sub === "clear") {
                        await potter.setTokens([]);
                        return "tokens cleared";
                    }
                    // Treat rest as path (may use : / spaces)
                    const pathRaw = args.slice(1).join(" ");
                    const r = await potter.loadTokensFromPath(pathRaw);
                    return `loaded ${r.loaded} token(s) from ${r.ib} (total ${r.total})`;
                }

                case "policies":
                case "policy": {
                    const want = String(args[1] || "").trim();
                    if (want.toLowerCase() === "create") {
                        const usage =
                            "usage: potter policy create keys.v1 <alias> --key <keychain-name> [--path policies/<ib>]";
                        const { flags, positional } = parseFlags(args.slice(2));
                        const kind = String(positional[0] || "").toLowerCase();
                        const name = positional[1];
                        if (kind !== "keys.v1" && kind !== "keys") {
                            return kind
                                ? `unknown policy schema '${kind}' — only keys.v1 supported\n${usage}`
                                : usage;
                        }
                        if (!name) return usage;
                        const r = await potter.createKeyPolicy(
                            name,
                            flags.key || "default",
                            flags.path || ""
                        );
                        return [
                            `created keys.v1 write policy '${r.name}' (threshold 1, key '${r.keyName}')`,
                            `  ${r.addr}`,
                            `use: --protect ${r.name}`,
                        ].join("\n");
                    }
                    if (want.toLowerCase() === "import" || want.toLowerCase() === "remember") {
                        const usage =
                            "usage: potter policy import <alias> [--path policies/<ib>|ib^gib]";
                        const { flags, positional } = parseFlags(args.slice(2));
                        const name = positional[0];
                        if (!name) return usage;
                        const r = await potter.importKeyPolicy(
                            name,
                            flags.path || ""
                        );
                        return [
                            `imported policy alias '${r.name}'`,
                            `  ${r.addr}`,
                            `  owner pub=${r.ownerPublicKey} hash=${r.ownerHash || "?"}`,
                            r.inKeychain
                                ? `  keychain: '${r.keyName}' matches — overwrites can sign`
                                : `  keychain: no matching key — import that pub/priv before gated overwrites`,
                            `use: --protect ${r.name}`,
                        ].join("\n");
                    }
                    if (!want) {
                        const custom = await potter.getCustomPolicies();
                        const customText = Object.entries(custom)
                            .map(
                                ([name, e]) =>
                                    `  ${name}\n    ${e.addr}\n    owner pub=${e.ownerPublicKey} hash=${e.ownerHash || "?"}`
                            )
                            .join("\n");
                        return [
                            "known policies:",
                            formatPolicies(),
                            customText,
                            "  live",
                            "    (reuse tip's current X-Flowerpot-Policy — existing tip only)",
                        ]
                            .filter(Boolean)
                            .join("\n");
                    }
                    const entry = await potter.policyEntry(want);
                    if (entry) return entry.addr;
                    return resolvePolicy(want);
                }

                case "keychain":
                case "kc": {
                    const sub = String(args[1] || "status").toLowerCase();
                    if (sub === "connect" || sub === "mount") {
                        const r = await potter.connectKeychain();
                        if (r.already) {
                            return `keychain already mounted — keys: ${(r.keys || []).join(", ") || "(none)"}`;
                        }
                        return `keychain connected from ${r.connected} — keys: ${(r.keys || []).join(", ") || "(none — keychain create default)"}`;
                    }
                    const status = await potter.keychainStatus();
                    if (!status.mounted) {
                        return `keychain: not mounted\n  ${status.hint}`;
                    }
                    const names = status.keys || [];
                    return [
                        "keychain: mounted",
                        `  default key: ${status.defaultKey}`,
                        names.length
                            ? `  keys: ${names.join(", ")}`
                            : "  keys: (none — keychain create default)",
                    ].join("\n");
                }

                case "index":
                case "potted": {
                    const sub = String(args[1] || "").toLowerCase();
                    if (sub === "clear") {
                        await potter.clearPotted();
                        return "potter_potted cleared";
                    }
                    const list = await potter.getPotted();
                    if (!list.length) return "(potter_potted empty)";
                    return list
                        .map(
                            (e, i) =>
                                `  [${i}] ${e.ib}  ${e.mode || "?"}  ${e.at || ""}${e.addr ? `\n       ${e.addr}` : ""}`
                        )
                        .join("\n");
                }

                case "clear": {
                    const what = String(args[1] || "").toLowerCase();
                    if (what === "index" || what === "potted") {
                        await potter.clearPotted();
                        return "potter_potted cleared";
                    }
                    if (what === "tokens") {
                        await potter.setTokens([]);
                        return "tokens cleared";
                    }
                    return "usage: potter clear index|tokens";
                }

                case "pot": {
                    const { flags, positional } = parseFlags(args.slice(1));
                    const kind = String(positional[0] || "").toLowerCase();
                    if (!flags.path) {
                        return "usage: potter pot string|file|href ... --path <ib>";
                    }
                    const opts = {
                        ib: flags.path,
                        contentType: flags.contentType,
                        policy: flags.policy || null,
                        keyName: flags.key,
                        noSign: !!flags.noSign,
                        usageToken: flags.token || null,
                        asidePrefix: flags.asidePrefix || null,
                    };
                    if (kind === "string" || kind === "str" || kind === "text") {
                        const text = positional.slice(1).join(" ");
                        if (!text) return "usage: potter pot string <text...> --path <ib>";
                        const r = await potter.potString(text, opts);
                        return `potted ${r.ib} (${r.contentType})${r.aside ? " [aside]" : ""} tokensLeft=${r.tokensLeft}${r.addr ? `\n${r.addr}` : ""}`;
                    }
                    if (kind === "file") {
                        const fileKey = positional.slice(1).join(" ");
                        if (!fileKey) return "usage: potter pot file <fileKey> --path <ib>";
                        const r = await potter.potFile(fileKey, opts);
                        return `potted file '${fileKey}' -> ${r.ib} (${r.contentType}) tokensLeft=${r.tokensLeft}${r.addr ? `\n${r.addr}` : ""}`;
                    }
                    if (kind === "href" || kind === "url" || kind === "fetch") {
                        const href = positional.slice(1).join(" ").trim();
                        if (!href) return "usage: potter pot href <rel-or-url> --path <ib>";
                        const r = await potter.potHref(href, opts);
                        return `potted href '${href}' -> ${r.ib} (${r.contentType}) tokensLeft=${r.tokensLeft}${r.addr ? `\n${r.addr}` : ""}`;
                    }
                    return "usage: potter pot string|file|href ... --path <ib>";
                }

                case "get":
                case "payload": {
                    const raw = args.slice(1).join(" ").trim();
                    if (!raw) return "usage: potter get <path|ib^gib>";
                    const r = await potter.getPayload(raw);
                    if (r.json != null) {
                        return JSON.stringify(
                            {
                                addr: r.addr,
                                contentType: r.contentType,
                                headers: r.headers,
                                json: r.json,
                            },
                            null,
                            2
                        );
                    }
                    return [
                        `addr: ${r.addr || "(tip)"}`,
                        `content-type: ${r.contentType || "(none)"}`,
                        r.headers.policy ? `policy: ${r.headers.policy}` : null,
                        r.headers.readPolicy
                            ? `read-policy: ${r.headers.readPolicy}`
                            : null,
                        r.headers.schema ? `schema: ${r.headers.schema}` : null,
                        "",
                        r.body,
                    ]
                        .filter((line) => line != null)
                        .join("\n");
                }

                case "ibgib":
                case "frame":
                case "addr": {
                    const rawAddr = args.slice(1).join(" ").trim();
                    if (!rawAddr) return "usage: potter ibgib <ib^gib>";
                    const r = await potter.getFrame(rawAddr);
                    return JSON.stringify(
                        {
                            addr: r.addr,
                            frame: r.frame,
                        },
                        null,
                        2
                    );
                }

                default:
                    return `unknown: ${verb}\n\n${HELP}`;
            }
        } catch (error) {
            console.error("[potter]", error);
            return `error: ${error.message || error}`;
        }
    };

    return {
        name: "potter",
        version: "1.8.3",
        description: "Pot content onto Flowerpot; tokens + optional keychain signing + aside",

        moduleInfo: {
            name: "potter",
            version: "1.8.3",
            description: "Pot content onto Flowerpot; tokens + optional keychain signing + aside",
        },

        potter,
        encodePath,
        parseAddr,
        resolvePolicy,
        policies: POLICY_BOOK,

        commands: {
            potter: {
                name: "potter",
                description:
                    "potter tokens|pot|keychain|get|ibgib|policies|index|base|clear — pot to Flowerpot from navi",
                execute: async (...args) => run(...args),
            },
        },

        onMount: async () => {
            await potter.loadBase();
            const n = (await potter.getTokens()).length;
            const kc = !!potter.keychain();
            console.log(
                `[potter] ready v1.8.3 — base ${potter.baseUrl} — ${n} token(s) — keychain ${kc ? "yes" : "no"}`
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
            console.log("[potter] unmounted");
        },
    };
};
