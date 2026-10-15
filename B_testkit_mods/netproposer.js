// netproposer — commit bin-park network_proposal envelopes to hostparkinator_5000.
//
// Tokens: one per commit from the shared navi.tokens stash (keyed by the base
// origin). Refunded unless the host says the token is consumed/invalid.
// Fill it via hypertext/intro or `relay tokens add <token…>`.
//
// Write gates:
//   schema tip (Lua authorize) → policy tip (keys + rel8ns.schema) → content rel8ns.policy
// Stock schema ib: foobarch.schema.keys.v1 (host: hostparkinator_5000 seed schemas).
//
// Signing: keychain.signWrite({ scheme: "proposal" }) → proposal-write-v1, on
// creates too (parentAddr "") so creation gates (rel8ns.genesis_policy) can pass.

export const register = (navi) => {
    const isBrowser =
        typeof window !== "undefined" && typeof window.document !== "undefined";

    const eventListeners = [];
    const createdElements = [];
    const addedStyles = [];
    const observers = [];
    const timers = [];

    const defaultHost = () =>
        String(
            (typeof navi?.origin === "string" && navi.origin) ||
                globalThis.location?.origin ||
                "https://foobarch.net"
        ).replace(/\/+$/, "");
    const KEYCHAIN_PARK = "keychain";
    const SCHEMA_KEYS_IB = "foobarch.schema.keys.v1";

    const STORAGE = {
        baseUrl: "netproposer.base_url",
        proposed: "netproposer_proposed",
        defaultKey: "netproposer.default_key",
        policies: "netproposer.policies",
    };

    const HEADER = {
        usageToken: "X-Foobarch-Usage-Token",
        ibGib: "X-Foobarch-ib^gib",
    };

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

    const tokenize = (args) => {
        if (!args.length) return [];
        if (args.length === 1 && /\s/.test(args[0])) {
            const out = [];
            const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
            let m;
            while ((m = re.exec(args[0]))) out.push(m[1] ?? m[2] ?? m[3]);
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
            else if (t === "--no-sign") flags.noSign = true;
            else if (t === "--replace") flags.replace = true;
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

    const subtle = () => {
        const c = globalThis.crypto;
        if (!c?.subtle) throw new Error("WebCrypto subtle unavailable");
        return c.subtle;
    };

    const sha256Hex = async (body) => {
        const raw =
            typeof body === "string"
                ? new TextEncoder().encode(body)
                : body instanceof ArrayBuffer
                  ? new Uint8Array(body)
                  : body instanceof Uint8Array
                    ? body
                    : new TextEncoder().encode(String(body ?? ""));
        const dig = await subtle().digest("SHA-256", raw);
        return Array.from(new Uint8Array(dig))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
    };

    const bytesToB64 = (u8) => {
        const bytes = u8 instanceof Uint8Array ? u8 : new Uint8Array(u8);
        let bin = "";
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        const b64 =
            typeof btoa === "function"
                ? btoa(bin)
                : Buffer.from(bytes).toString("base64");
        return b64;
    };

    const toUint8 = (body) => {
        if (body instanceof Uint8Array) return body;
        if (body instanceof ArrayBuffer) return new Uint8Array(body);
        if (typeof body === "string") return new TextEncoder().encode(body);
        return new TextEncoder().encode(String(body ?? ""));
    };

    class NetProposer {
        constructor() {
            this.baseUrl = defaultHost();
            this.hostPinned = false;
        }

        log(...args) {
            console.log("[netproposer]", ...args);
        }

        async loadBase() {
            const pref = await navi.storage.item.get(STORAGE.baseUrl);
            this.hostPinned = !!pref;
            this.baseUrl = pref || defaultHost();
            return this.baseUrl;
        }

        /** Pin a host preference; "", "default" or "reset" follows navi.origin again. */
        async setBase(url) {
            const raw = String(url || "").trim();
            if (!raw || /^(default|reset|origin)$/i.test(raw)) {
                await navi.storage.item.set(STORAGE.baseUrl, "");
                return this.loadBase();
            }
            const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
            const u = new URL(withScheme).origin;
            await navi.storage.item.set(STORAGE.baseUrl, u);
            this.baseUrl = u;
            this.hostPinned = true;
            return u;
        }

        buildUrl(path) {
            const base = String(this.baseUrl || defaultHost()).replace(/\/$/, "");
            const ib = encodePath(path);
            return `${base}/${ib}`;
        }

        resolveUrl(path) {
            const built = this.buildUrl(path);
            if (/^https?:\/\//i.test(built)) return new URL(built);
            const origin = globalThis.location?.origin || "http://localhost";
            return new URL(built, origin);
        }

        // --- tokens (shared navi.tokens stash) ----------------------------

        tokens() {
            if (!navi.tokens) {
                throw new Error(
                    "this navi shell has no navi.tokens — reload to get the current navi_shell.js"
                );
            }
            return navi.tokens;
        }

        tokenHost() {
            return this.resolveUrl("").origin;
        }

        async tokenCount() {
            return navi.tokens ? navi.tokens.count(this.tokenHost()) : 0;
        }

        async takeToken() {
            const host = this.tokenHost();
            try {
                return await this.tokens().take(host);
            } catch (e) {
                if (e?.code === "NO_TOKENS") {
                    throw new Error(
                        `no usage tokens for ${host} — request some on hypertext/intro, or: relay tokens add <token…>`
                    );
                }
                throw e;
            }
        }

        async addTokens(list) {
            return this.tokens().add(this.tokenHost(), list);
        }

        // --- keychain -----------------------------------------------------

        keychain() {
            return navi.mod?.keychain || null;
        }

        async keychainStatus() {
            const kc = this.keychain();
            if (!kc) {
                return {
                    mounted: false,
                    hint: `netproposer keychain connect  (or: mount ${KEYCHAIN_PARK})`,
                };
            }
            let keys = [];
            try {
                if (typeof kc.list === "function") keys = await kc.list();
                else if (typeof kc.keychain?.list === "function") {
                    keys = await kc.keychain.list();
                }
            } catch {
                /* ignore */
            }
            return { mounted: true, keys: Array.isArray(keys) ? keys : [] };
        }

        async keychainConnect() {
            if (this.keychain()) {
                const status = await this.keychainStatus();
                return { already: true, ...status };
            }
            const spec = KEYCHAIN_PARK;
            try {
                if (typeof navi.callin !== "function") {
                    throw new Error("navi.callin unavailable — mount keychain manually");
                }
                await navi.callin(`mount ${spec}`);
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
            return { connected: spec, ...status };
        }

        async defaultKeyName() {
            return (
                (await navi.storage.item.get(STORAGE.defaultKey)) || "default"
            );
        }

        async signProposal({ ib, parentAddr, body, keyName, force }) {
            const kc = this.keychain();
            if (!kc) {
                if (force) {
                    throw new Error("keychain module not mounted — cannot sign");
                }
                return null;
            }
            const signWrite = kc.signWrite || kc.keychain?.signWrite;
            const buildHeaders =
                kc.buildSignHeaders || kc.keychain?.buildSignHeaders;
            if (typeof signWrite !== "function") {
                throw new Error("keychain.signWrite unavailable");
            }
            const key = keyName || (await this.defaultKeyName());
            const signed = await signWrite.call(kc, {
                ib,
                parentAddr: parentAddr || "",
                body,
                contentType: "application/json",
                key,
                scheme: "proposal",
            });
            const rawHeaders =
                typeof buildHeaders === "function"
                    ? buildHeaders.call(kc, signed)
                    : {};
            const pub =
                signed.publicKey ||
                rawHeaders["X-Foobarch-Sign-Keys"] ||
                rawHeaders["X-Flowerpot-Sign-Keys"];
            const sig =
                signed.signature ||
                rawHeaders["X-Foobarch-Signatures"] ||
                rawHeaders["X-Flowerpot-Signatures"];
            const headers = {
                "X-Foobarch-Sign-Keys": pub,
                "X-Foobarch-Signatures": sig,
            };
            return {
                headers,
                key: signed.key || key,
                publicKey: signed.publicKey,
                hash: signed.hash || null,
                prefix: signed.prefix || "proposal-write-v1",
            };
        }

        // --- policies -----------------------------------------------------

        async getCustomPolicies() {
            const raw = await navi.storage.item.get(STORAGE.policies);
            if (!raw || typeof raw !== "object") return {};
            return { ...raw };
        }

        async policyEntry(raw) {
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

        async resolveProtect(raw, tip) {
            if (raw == null || String(raw).trim() === "") return null;
            const text = String(raw).trim();
            if (text.toLowerCase() === "live") {
                const pol = tip?.frame?.rel8ns?.policy?.[0];
                if (!tip?.addr) {
                    throw new Error(
                        "--protect live needs an existing tip — create a policy first"
                    );
                }
                if (!pol) {
                    throw new Error("--protect live: tip has no rel8ns.policy");
                }
                return String(pol);
            }
            if (text.includes("^")) return text;
            const entry = await this.policyEntry(text);
            if (!entry?.addr) {
                const custom = Object.keys(await this.getCustomPolicies());
                throw new Error(
                    `unknown policy '${text}' — use ib^gib, live, or: netproposer policy create keys ${text} (known: ${custom.join(", ") || "none"})`
                );
            }
            return entry.addr;
        }

        async ensureKeysSchema() {
            await this.loadBase();
            const tip = await this.getTip(SCHEMA_KEYS_IB);
            if (tip?.addr && !tip.tombstone) {
                return { ib: SCHEMA_KEYS_IB, addr: tip.addr };
            }
            throw new Error(
                `${SCHEMA_KEYS_IB} is missing on ${this.tokenHost()} — host operator: hostparkinator_5000 seed schemas`
            );
        }

        async createKeyPolicy(nameRaw, keyName = "default", pathRaw = "") {
            await this.loadBase();
            const name = String(nameRaw || "").trim().toLowerCase();
            if (!/^[a-z0-9][a-z0-9._-]*$/.test(name)) {
                throw new Error(
                    "policy name must use letters, numbers, dot, underscore, or dash"
                );
            }
            const kc = this.keychain();
            const get = kc?.get || kc?.keychain?.get;
            if (!kc || typeof get !== "function") {
                throw new Error(
                    "keychain module not mounted or keychain.get unavailable"
                );
            }
            const key = await get.call(kc, keyName || "default");
            if (!key?.publicKey) {
                throw new Error(`no key '${keyName || "default"}' in keychain`);
            }

            const schema = await this.ensureKeysSchema();
            const ib = encodePath(pathRaw || `policies/${name}`);
            const tip = await this.getTip(ib);
            if (tip?.addr && !tip.tombstone) {
                throw new Error(
                    `policy path '${ib}' already exists — import or choose another --path`
                );
            }

            const data = {
                parts: ["keys_policy", "ibgib_frame", "manifest", "json"],
                schema_ib: SCHEMA_KEYS_IB,
                threshold: 1,
                keys: [key.publicKey],
                n: 0,
                timestamp: new Date().toUTCString(),
            };
            const gib = (await sha256Hex(JSON.stringify(data))).toUpperCase();
            const frame = {
                ib,
                gib,
                data,
                rel8ns: {
                    schema: [schema.addr],
                    past: [],
                    tjp: [],
                    dna: [],
                },
            };
            const created = await this.commitEnvelope(
                ib,
                {
                    transform: "firstGen",
                    newIbGib: frame,
                    dnas: [],
                    intermediateIbGibs: [],
                },
                { keyName: keyName || "default", sign: false }
            );

            // Self-lock: mut8 open policy so rel8ns.policy → this instance (retroactive gate).
            const lockData = {
                ...data,
                n: 1,
                timestamp: new Date().toUTCString(),
            };
            const lockGib = (await sha256Hex(JSON.stringify(lockData))).toUpperCase();
            const lockFrame = {
                ib,
                gib: lockGib,
                data: lockData,
                rel8ns: {
                    schema: [schema.addr],
                    policy: [created.addr],
                    past: [created.addr],
                    tjp: [],
                    dna: [],
                },
            };
            const locked = await this.commitEnvelope(
                ib,
                {
                    transform: "mut8",
                    newIbGib: lockFrame,
                    dnas: [],
                    intermediateIbGibs: [],
                },
                { keyName: keyName || "default", sign: false }
            );

            const custom = await this.getCustomPolicies();
            custom[name] = {
                aliases: [name],
                addr: locked.addr,
                schemaAddr: schema.addr,
                schemaIb: SCHEMA_KEYS_IB,
                ownerPublicKey: key.publicKey,
                ownerHash: key.hash || null,
                keyName: keyName || "default",
                note: `${SCHEMA_KEYS_IB} — keychain '${keyName || "default"}' (self-locked)`,
            };
            await navi.storage.item.set(STORAGE.policies, custom);
            return {
                name,
                ib,
                addr: locked.addr,
                openAddr: created.addr,
                schemaAddr: schema.addr,
                keyName: keyName || "default",
                key,
            };
        }

        async importPolicy(nameRaw, pathRaw = "") {
            await this.loadBase();
            const name = String(nameRaw || "").trim().toLowerCase();
            if (!name) throw new Error("policy alias required");
            const ib = encodePath(pathRaw || `policies/${name}`);
            const tip = await this.getTip(ib);
            if (!tip?.frame) throw new Error(`no tip for ${ib}`);
            const keys = tip.frame.data?.keys;
            if (!Array.isArray(keys) || !keys.length) {
                throw new Error(
                    "policy tip has no keys[] — expected { threshold, keys } + schema link"
                );
            }
            const custom = await this.getCustomPolicies();
            custom[name] = {
                aliases: [name],
                addr: tip.addr,
                schemaAddr: tip.frame.rel8ns?.schema?.[0] || null,
                schemaIb: tip.frame.data?.schema_ib || null,
                ownerPublicKey: String(keys[0]),
                ownerHash: null,
                keyName: null,
                note: `imported from ${ib}`,
            };
            await navi.storage.item.set(STORAGE.policies, custom);
            return custom[name];
        }

        async deletePolicyAlias(nameRaw) {
            const name = String(nameRaw || "").trim().toLowerCase();
            if (!name) throw new Error("policy alias required");
            const custom = await this.getCustomPolicies();
            if (!custom[name]) {
                throw new Error(
                    `no local policy alias '${name}' (known: ${Object.keys(custom).join(", ") || "none"})`
                );
            }
            const removed = custom[name];
            delete custom[name];
            await navi.storage.item.set(STORAGE.policies, custom);
            return { name, addr: removed.addr, note: removed.note || "" };
        }

        async clearPolicyAliases() {
            const custom = await this.getCustomPolicies();
            const names = Object.keys(custom);
            await navi.storage.item.set(STORAGE.policies, {});
            return { cleared: names };
        }

        // --- tip / commit -------------------------------------------------

        async getTip(rawIb) {
            await this.loadBase();
            const ib = encodePath(rawIb);
            if (!ib) throw new Error("ib required");
            const url = this.resolveUrl(`foobarch/tip/${ib}`);
            const res = await fetch(url, { method: "GET" });
            if (res.status === 404) return null;
            const text = await res.text();
            if (!res.ok) {
                throw new Error(`GET tip ${ib} -> ${res.status}: ${text}`);
            }
            return JSON.parse(text);
        }

        getKindOf(frame) {
            const get = frame?.data?.method?.GET;
            return get ? String(get.kind || "").toLowerCase() || null : null;
        }

        /** Verb the host treats as commit: PUT/PATCH are commit unless the block says otherwise. */
        commitMethodForTip(frame) {
            const block = frame?.data?.method;
            if (!block || typeof block !== "object") return "PUT";
            for (const m of ["PUT", "PATCH"]) {
                const c = block[m];
                if (!c || String(c.kind || "").toLowerCase() === "commit") return m;
            }
            for (const [m, c] of Object.entries(block)) {
                if (String(c?.kind || "").toLowerCase() === "commit") return m;
            }
            throw new Error(
                `${frame?.ib || "tip"} declares no commit verb in data.method — it cannot be updated over HTTP`
            );
        }

        async commitEnvelope(ib, envelope, opts = {}) {
            const fromStash = !opts.usageToken;
            let pay = null;
            let token = "";
            if (!fromStash) {
                token = String(opts.usageToken).trim();
                if (!token) throw new Error("--token requires a non-empty usage token");
            } else if (typeof this.tokens().pay === "function") {
                pay = await this.tokens().pay(this.tokenHost());
                if (pay.mode === "reserve") this.tokens().attach?.(envelope?.newIbGib, pay);
                else token = pay.token;
            } else {
                token = await this.takeToken();
            }
            const body = JSON.stringify(envelope);
            const tip = await this.getTip(ib);
            const parentAddr =
                tip && !tip.tombstone ? tip.addr : null;
            const method = tip?.frame
                ? this.commitMethodForTip(tip.frame)
                : "PUT";

            /** @type {Record<string, string>} */
            const headers = { "Content-Type": "application/json" };

            const gated = !!(parentAddr && tip?.frame?.rel8ns?.policy?.[0]);
            let signedWith = null;
            if (!opts.noSign && opts.sign !== false) {
                signedWith = await this.signProposal({
                    ib,
                    parentAddr: parentAddr || "",
                    body,
                    keyName: opts.keyName,
                    force: gated,
                });
                if (signedWith?.headers) Object.assign(headers, signedWith.headers);
            }

            if (token) headers[HEADER.usageToken] = token;
            const refund = async () => {
                if (token && (pay?.mode === "header" || (!pay && fromStash))) {
                    await this.tokens().giveBack(this.tokenHost(), token);
                }
            };

            const url = this.resolveUrl(ib);
            this.log(`${method} commit`, ib);
            let res;
            let text;
            try {
                res = await fetch(url, { method, headers, body });
                text = await res.text();
            } catch (err) {
                await refund();
                throw err;
            }
            if (!res.ok) {
                if (!/consumed|invalid usage token/i.test(text)) await refund();
                throw new Error(
                    `${method} /${ib} -> ${res.status}: ${text.slice(0, 400)}`
                );
            }
            let json = null;
            try {
                json = JSON.parse(text);
            } catch {
                /* ignore */
            }
            const addr =
                res.headers.get(HEADER.ibGib) ||
                res.headers.get("x-foobarch-ib^gib") ||
                json?.addr ||
                null;
            return {
                status: res.status,
                addr,
                method,
                json,
                signedWith,
                tokensLeft: await this.tokenCount(),
                tokenSource: pay?.mode === "reserve" ? "reserve" : fromStash ? "stash" : "flag",
            };
        }

        async buildBinEnvelope({
            ib,
            bytes,
            contentType,
            policyAddr,
            parentAddr,
            n,
            extraData = null,
        }) {
            const u8 = toUint8(bytes);
            const sha = await sha256Hex(u8);
            /** @type {Record<string, unknown>} */
            const rel8ns = {
                bin: [`bin ${sha}`],
                past: parentAddr ? [String(parentAddr)] : [],
                tjp: [],
                dna: [],
            };
            if (policyAddr) rel8ns.policy = [String(policyAddr)];
            const frame = {
                ib,
                gib: "",
                data: {
                    ...(extraData && typeof extraData === "object" ? extraData : {}),
                    parts: [
                        "network_proposal",
                        "ibgib_frame",
                        "manifest",
                        "json",
                    ],
                    park: "defer",
                    content_type: contentType,
                    default_method: "GET",
                    method: {
                        GET: { kind: "bin" },
                        PUT: { kind: "commit" },
                        PATCH: { kind: "commit" },
                        DELETE: { kind: "tombstone" },
                    },
                    n: n != null ? Number(n) : 0,
                    timestamp: new Date().toUTCString(),
                },
                rel8ns,
            };
            // The host stores frames by ib^gib (insert-or-replace), so gib must
            // differ per generation even when the bin bytes are unchanged.
            frame.gib = (
                await sha256Hex(JSON.stringify({ ib, data: frame.data, rel8ns }))
            ).toUpperCase();
            return {
                transform: parentAddr ? "mut8" : "firstGen",
                newIbGib: frame,
                dnas: [],
                intermediateIbGibs: [],
                bin: {
                    sha256: sha,
                    bytes_b64: bytesToB64(u8),
                    content_type: contentType,
                    byte_length: u8.length,
                },
            };
        }

        async propose({
            ib: rawIb,
            body,
            contentType,
            policy,
            keyName,
            noSign = false,
            usageToken = null,
            replace = false,
            data = null,
        }) {
            await this.loadBase();
            const ib = encodePath(rawIb);
            if (!ib) throw new Error("--path required");
            if (body == null) throw new Error("nothing to propose");

            const ct =
                contentType ||
                guessContentType(ib, typeof body === "string" ? body : "");
            const tip = await this.getTip(ib);
            const parentAddr =
                tip && !tip.tombstone ? tip.addr : null;
            const getKind = parentAddr ? this.getKindOf(tip.frame) : null;
            if (getKind && getKind !== "bin" && !replace) {
                throw new Error(
                    `${ib} is a ${getKind} park (GET kind ${getKind}); publishing content would replace it — pass --replace to do that`
                );
            }
            const n = parentAddr
                ? Number(tip.frame?.data?.n || 0) + 1
                : 0;
            const policyAddr = await this.resolveProtect(policy, tip);
            // firstGen only attaches --protect; overwrites keep existing gate
            const attachPolicy =
                !parentAddr && policyAddr ? policyAddr : null;

            const envelope = await this.buildBinEnvelope({
                ib,
                bytes: body,
                contentType: ct,
                policyAddr: attachPolicy,
                parentAddr,
                n,
                extraData: data,
            });

            const result = await this.commitEnvelope(ib, envelope, {
                keyName,
                noSign,
                usageToken,
            });

            const index = (await navi.storage.item.get(STORAGE.proposed)) || [];
            const list = Array.isArray(index) ? index : [];
            list.push({
                at: new Date().toISOString(),
                ib,
                addr: result.addr,
                contentType: ct,
                transform: envelope.transform,
            });
            await navi.storage.item.set(STORAGE.proposed, list.slice(-200));

            return {
                ib,
                contentType: ct,
                transform: envelope.transform,
                ...result,
            };
        }

        async fetchHref(hrefRaw) {
            await this.loadBase();
            const href = String(hrefRaw || "").trim();
            if (!href) throw new Error("href required");
            let url;
            if (/^https?:\/\//i.test(href)) {
                url = href;
            } else {
                url = this.resolveUrl(encodePath(href)).toString();
            }
            this.log("GET href", url);
            const res = await fetch(url, {
                method: "GET",
                headers: {
                    Accept:
                        "text/html, text/plain, application/javascript, application/navi-module, */*",
                },
            });
            const buf = new Uint8Array(await res.arrayBuffer());
            if (!res.ok) {
                throw new Error(
                    `GET href -> ${res.status}: ${new TextDecoder().decode(buf).slice(0, 200)}`
                );
            }
            const ct =
                res.headers.get("Content-Type") ||
                guessContentType(href, new TextDecoder().decode(buf.slice(0, 500)));
            return { bytes: buf, contentType: ct.split(";")[0].trim(), url };
        }
    }

    const svc = new NetProposer();

    const HELP = [
        "netproposer — hostparkinator_5000 bin-park network_proposal commits",
        "",
        "  netproposer host [url|reset]           host preference (default: navi.origin); alias: base",
        "  netproposer tokens                     navi.tokens count for the base origin",
        "  netproposer tokens add <token…>        add usage tokens to navi.tokens",
        "  netproposer keychain | keychain connect",
        "  netproposer propose string|file|href … --path <ib>",
        "      [--type mime] [--protect|--policy alias|addr|live]",
        "      [--key name] [--token …] [--no-sign] [--replace]",
        "      --replace: allow overwriting a park whose GET is not bin (mod/proxy/redirect…)",
        "  netproposer tip|get <ib>",
        "  netproposer policy create keys <alias> --key <name> [--path policies/<ib>]",
        "  netproposer policy import <alias> [--path …]",
        "  netproposer policy del <alias>         drop local alias (does not admin-delete tip)",
        "  netproposer policies",
        "  netproposer index | clear index|policies",
        "",
        "  Each commit spends one navi.tokens token (refunded if the host refuses the write).",
        "  Get tokens on hypertext/intro, or: relay tokens add <token…>.",
        "  Write gate = schema tip (Lua) → policy (keys + rel8ns.schema) → content rel8ns.policy.",
        "  policy create keys needs foobarch.schema.keys.v1 on the host and self-locks the policy tip.",
        "  Writes are signed proposal-write-v1 via keychain when mounted (required on gated tips).",
    ].join("\n");

    const run = async (...rawArgs) => {
        const args = tokenize(rawArgs);
        if (!args.length || args[0] === "help" || args[0] === "-h") return HELP;
        const verb = String(args[0]).toLowerCase();
        try {
            await svc.loadBase();
            switch (verb) {
                case "host":
                case "base":
                case "url": {
                    if (args[1]) await svc.setBase(args[1]);
                    return `host=${svc.baseUrl}${svc.hostPinned ? " (pinned; reset: netproposer host reset)" : " (follows navi.origin)"}`;
                }
                case "tokens": {
                    const sub = String(args[1] || "").toLowerCase();
                    if (sub === "add") {
                        const list = args.slice(2).filter(Boolean);
                        if (!list.length) return "usage: netproposer tokens add <token…>";
                        const r = await svc.addTokens(list);
                        return `added ${r.added} — ${r.count} token(s) for ${svc.tokenHost()}`;
                    }
                    if (sub === "count" || !args[1]) {
                        return `${await svc.tokenCount()} token(s) for ${svc.tokenHost()} (navi.tokens)`;
                    }
                    return "usage: netproposer tokens [count] | tokens add <token…>";
                }
                case "keychain": {
                    if (String(args[1] || "").toLowerCase() === "connect") {
                        const r = await svc.keychainConnect();
                        if (r.already) {
                            return `keychain already mounted — keys: ${(r.keys || []).join(", ") || "(none)"}`;
                        }
                        return `keychain connected from ${r.connected} — keys: ${(r.keys || []).join(", ") || "(none)"}`;
                    }
                    const status = await svc.keychainStatus();
                    if (!status.mounted) return `keychain: not mounted\n  ${status.hint}`;
                    return [
                        "keychain: mounted",
                        status.keys?.length
                            ? `  keys: ${status.keys.join(", ")}`
                            : "  keys: (none — keychain create default)",
                    ].join("\n");
                }
                case "tip":
                case "get": {
                    const ib = encodePath(args.slice(1).join("/"));
                    const tip = await svc.getTip(ib);
                    if (!tip) return `no tip for ${ib}`;
                    return JSON.stringify(tip, null, 2);
                }
                case "policies": {
                    const custom = await svc.getCustomPolicies();
                    const lines = Object.entries(custom).map(([name, e]) => {
                        return `  ${name}\n    ${e.addr}\n    ${e.note || ""}`;
                    });
                    return lines.length
                        ? lines.join("\n")
                        : "(no policies — netproposer policy create keys <alias> --key default)";
                }
                case "policy": {
                    const sub = String(args[1] || "").toLowerCase();
                    if (sub === "create") {
                        const kind = String(args[2] || "").toLowerCase();
                        const usage =
                            "usage: netproposer policy create keys <alias> --key <keychain-name> [--path policies/<ib>]";
                        if (
                            kind !== "keys" &&
                            kind !== "keys.v1" &&
                            kind !== "foobarch.keys.v1"
                        ) {
                            return `unknown kind '${kind || ""}' — use: policy create keys <alias> …\n${usage}`;
                        }
                        const { flags, positional } = parseFlags(args.slice(3));
                        const alias = positional[0];
                        if (!alias) return usage;
                        const r = await svc.createKeyPolicy(
                            alias,
                            flags.key || "default",
                            flags.path || ""
                        );
                        return [
                            `created keys write gate '${r.name}' (schema ${r.schemaAddr})`,
                            `policy ${r.addr} (self-locked; threshold 1, key '${r.keyName}')`,
                        ].join("\n");
                    }
                    if (sub === "import") {
                        const { flags, positional } = parseFlags(args.slice(2));
                        const alias = positional[0];
                        if (!alias) {
                            return "usage: netproposer policy import <alias> [--path policies/<ib>]";
                        }
                        const r = await svc.importPolicy(alias, flags.path || "");
                        return `imported '${alias}' → ${r.addr}`;
                    }
                    if (
                        sub === "del" ||
                        sub === "delete" ||
                        sub === "rm" ||
                        sub === "drop"
                    ) {
                        const alias = String(args[2] || "").trim();
                        if (!alias) {
                            return "usage: netproposer policy del <alias>";
                        }
                        const r = await svc.deletePolicyAlias(alias);
                        return `dropped local alias '${r.name}' (was ${r.addr}) — tip on host unchanged`;
                    }
                    return "usage: netproposer policy create|import|del …";
                }
                case "propose": {
                    const { flags, positional } = parseFlags(args.slice(1));
                    const kind = String(positional[0] || "").toLowerCase();
                    const rest = positional.slice(1);
                    if (!flags.path) {
                        return "usage: netproposer propose string|file|href … --path <ib> […]";
                    }
                    if (flags.baseUrl) await svc.setBase(flags.baseUrl);

                    if (kind === "string" || kind === "str" || kind === "text") {
                        const text = rest.join(" ");
                        const r = await svc.propose({
                            ib: flags.path,
                            body: text,
                            contentType: flags.contentType,
                            policy: flags.policy,
                            keyName: flags.key,
                            noSign: !!flags.noSign,
                            usageToken: flags.token,
                            replace: !!flags.replace,
                        });
                        return `proposed ${r.transform} ${r.ib} (${r.contentType}) tokensLeft=${r.tokensLeft}${r.addr ? `\n${r.addr}` : ""}`;
                    }
                    if (kind === "file") {
                        const fileKey = rest.join(" ") || flags.path;
                        const entry =
                            typeof navi.storage?.file?.get === "function"
                                ? await navi.storage.file.get(fileKey)
                                : null;
                        if (!entry?.media) {
                            throw new Error(
                                `no navi.storage.file entry '${fileKey}'`
                            );
                        }
                        const r = await svc.propose({
                            ib: flags.path,
                            body: entry.media,
                            contentType:
                                flags.contentType ||
                                entry.mime ||
                                guessContentType(fileKey, entry.media),
                            policy: flags.policy,
                            keyName: flags.key,
                            noSign: !!flags.noSign,
                            usageToken: flags.token,
                            replace: !!flags.replace,
                        });
                        return `proposed file '${fileKey}' ${r.transform} ${r.ib} tokensLeft=${r.tokensLeft}${r.addr ? `\n${r.addr}` : ""}`;
                    }
                    if (kind === "href" || kind === "url") {
                        const href = rest.join("/") || rest.join(" ");
                        const got = await svc.fetchHref(href);
                        const r = await svc.propose({
                            ib: flags.path,
                            body: got.bytes,
                            contentType: flags.contentType || got.contentType,
                            policy: flags.policy,
                            keyName: flags.key,
                            noSign: !!flags.noSign,
                            usageToken: flags.token,
                            replace: !!flags.replace,
                        });
                        return `proposed href '${href}' ${r.transform} ${r.ib} (${r.contentType}) tokensLeft=${r.tokensLeft}${r.addr ? `\n${r.addr}` : ""}`;
                    }
                    return "usage: netproposer propose string|file|href … --path <ib>";
                }
                case "index": {
                    const list =
                        (await navi.storage.item.get(STORAGE.proposed)) || [];
                    if (!Array.isArray(list) || !list.length) return "(empty)";
                    return list
                        .slice(-20)
                        .map(
                            (e) =>
                                `${e.at || "?"} ${e.transform || ""} ${e.ib} ${e.addr || ""}`
                        )
                        .join("\n");
                }
                case "clear": {
                    const what = String(args[1] || "").toLowerCase();
                    if (what === "index") {
                        await navi.storage.item.set(STORAGE.proposed, []);
                        return "index cleared";
                    }
                    if (what === "policies" || what === "policy") {
                        const r = await svc.clearPolicyAliases();
                        return r.cleared.length
                            ? `policies cleared: ${r.cleared.join(", ")}`
                            : "policies cleared (was empty)";
                    }
                    return "usage: netproposer clear index|policies";
                }
                default:
                    return `unknown: ${verb}\n\n${HELP}`;
            }
        } catch (error) {
            return `error: ${error.message || error}`;
        }
    };

    return {
        name: "netproposer",
        version: "0.4.2",
        description:
            "Commit bin-park network_proposals to hostparkinator_5000 (navi.tokens + keychain)",

        moduleInfo: {
            name: "netproposer",
            version: "0.4.2",
            description:
                "Commit bin-park network_proposals to hostparkinator_5000 (schema→policy write gates)",
        },

        commands: {
            netproposer: {
                name: "netproposer",
                description:
                    "netproposer tokens|propose|policy|tip|base|keychain — foobarch commits",
                execute: async (...args) => run(...args),
            },
        },

        propose: (...a) => svc.propose(...a),
        getTip: (...a) => svc.getTip(...a),
        getHost: async () => svc.loadBase(),
        setHost: (url) => svc.setBase(url),
        tokenCount: async () => (await svc.loadBase(), svc.tokenCount()),
        getKindOf: (frame) => svc.getKindOf(frame),
        policies: () => svc.getCustomPolicies(),
        createKeyPolicy: (...a) => svc.createKeyPolicy(...a),
        importPolicy: (...a) => svc.importPolicy(...a),

        onMount: async () => {
            await svc.loadBase();
            const n = await svc.tokenCount();
            const kc = !!svc.keychain();
            if (typeof navi.callout === "function") {
                navi.callout(
                    `[netproposer] ready v0.3.0 — base ${svc.baseUrl} — ${n} token(s) — keychain ${kc ? "yes" : "no"}`
                );
            }
        },

        onUnmount: async () => {
            for (const t of timers) clearTimeout(t);
            timers.length = 0;
            for (const o of observers) {
                try {
                    o.disconnect();
                } catch {
                    /* ignore */
                }
            }
            observers.length = 0;
            for (const { target, type, handler, options } of eventListeners) {
                try {
                    target.removeEventListener(type, handler, options);
                } catch {
                    /* ignore */
                }
            }
            eventListeners.length = 0;
            for (const el of createdElements) {
                try {
                    el.remove();
                } catch {
                    /* ignore */
                }
            }
            createdElements.length = 0;
            for (const style of addedStyles) {
                try {
                    style.remove();
                } catch {
                    /* ignore */
                }
            }
            addedStyles.length = 0;
            void isBrowser;
        },
    };
};
