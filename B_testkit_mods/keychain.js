// keychain — ed25519 keys for keys.v1 write/read policies (Flowerpot + foobarch).
//
// Matching schema: flowerpot.schema.keys.v1
// Canonical write message:
//   {prefix}\n{ib}\n{parentAddr}\n{sha256hex(body)}\n{contentType}
// Prefixes:
//   flowerpot-write-v1  — Flowerpot pots (default; potter)
//   proposal-write-v1   — foobarch_host / network_proposal commits (netproposer)
// Headers:
//   X-Flowerpot-Sign-Keys / X-Flowerpot-Signatures (base64url ed25519)
//
// Local keys live in navi.storage.item under keychain.keys (full entry incl. priv).
// Optional relay mode: sign via /navi-{alias}/keychain/rpc so an exe navi can
// hold the private key and the browser never receives it.

export const register = (navi) => {
    const eventListeners = [];
    const createdElements = [];
    const addedStyles = [];
    const observers = [];
    const timers = [];

    const SCHEMA_IB = "flowerpot.schema.keys.v1";
    const FLOWERPOT_WRITE_PREFIX = "flowerpot-write-v1";
    const PROPOSAL_WRITE_PREFIX = "proposal-write-v1";
    const WRITE_SIGN_PREFIX = FLOWERPOT_WRITE_PREFIX;
    const READ_SIGN_PREFIX = "flowerpot-read-v1";
    const STORAGE_KEY = "keychain.keys";
    const PREFS_KEY = "keychain.prefs";
    const DEFAULT_NAME = "default";
    const VERSION = "1.5.0";

    const resolveWritePrefix = (opts = {}) => {
        if (opts.prefix != null && String(opts.prefix).trim()) {
            return String(opts.prefix).trim();
        }
        const scheme = String(opts.scheme || "").toLowerCase();
        if (
            scheme === "proposal" ||
            scheme === "foobarch" ||
            scheme === "netproposal"
        ) {
            return PROPOSAL_WRITE_PREFIX;
        }
        return FLOWERPOT_WRITE_PREFIX;
    };

    const b64urlFromBytes = (bytes) => {
        let bin = "";
        const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
        const b64 =
            typeof btoa === "function"
                ? btoa(bin)
                : Buffer.from(u8).toString("base64");
        return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
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

    const writeMessage = async ({
        ib,
        parentAddr = "",
        body,
        contentType,
        prefix,
    }) => {
        const contentSha256 = await sha256Hex(body);
        return [
            prefix || WRITE_SIGN_PREFIX,
            ib,
            parentAddr || "",
            contentSha256,
            contentType || "application/octet-stream",
        ].join("\n");
    };

    const readMessage = ({ ib, timestamp = "" }) =>
        [
            READ_SIGN_PREFIX,
            ib,
            timestamp === "" || timestamp == null ? "" : String(timestamp),
        ].join("\n");

    const importPrivate = async (publicKey, privateKey) => {
        return subtle().importKey(
            "jwk",
            { kty: "OKP", crv: "Ed25519", x: publicKey, d: privateKey },
            { name: "Ed25519" },
            false,
            ["sign"]
        );
    };

    const signBytes = async (publicKey, privateKey, messageUtf8) => {
        const key = await importPrivate(publicKey, privateKey);
        const sig = await subtle().sign(
            { name: "Ed25519" },
            key,
            new TextEncoder().encode(messageUtf8)
        );
        return b64urlFromBytes(sig);
    };

    const publicKeyHash = async (publicKeyX) => {
        const dig = await subtle().digest(
            "SHA-256",
            new TextEncoder().encode(publicKeyX)
        );
        return Array.from(new Uint8Array(dig))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("")
            .slice(0, 16);
    };

    const b64urlToBytes = (s) => {
        const b64 = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
        const pad = b64 + "===".slice((b64.length + 3) % 4);
        if (typeof atob === "function") {
            const bin = atob(pad);
            const u8 = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
            return u8;
        }
        return new Uint8Array(Buffer.from(pad, "base64"));
    };

    // Ed25519 PKCS#8 wrapper for a raw 32-byte seed.
    const PKCS8_ED25519_PREFIX = new Uint8Array([
        0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70,
        0x04, 0x22, 0x04, 0x20,
    ]);

    const keyPairFromSeed = async (seed) => {
        const der = new Uint8Array(PKCS8_ED25519_PREFIX.length + 32);
        der.set(PKCS8_ED25519_PREFIX, 0);
        der.set(seed.slice(0, 32), PKCS8_ED25519_PREFIX.length);
        const priv = await subtle().importKey(
            "pkcs8",
            der,
            { name: "Ed25519" },
            true,
            ["sign"]
        );
        const jwk = await subtle().exportKey("jwk", priv);
        return { publicKey: jwk.x, privateKey: jwk.d };
    };

    const DERIVE_PREFIX = "keychain-derive-v1";
    const BIND_PREFIX = "keychain-bind-v1";

    const bindMessage = ({ parentPublicKey, publicKey, label }) =>
        [BIND_PREFIX, parentPublicKey, publicKey, label].join("\n");

    const verifyBytes = async (publicKey, messageUtf8, signatureB64url) => {
        try {
            const key = await subtle().importKey(
                "jwk",
                { kty: "OKP", crv: "Ed25519", x: String(publicKey) },
                { name: "Ed25519" },
                false,
                ["verify"]
            );
            return await subtle().verify(
                { name: "Ed25519" },
                key,
                b64urlToBytes(signatureB64url),
                new TextEncoder().encode(String(messageUtf8))
            );
        } catch {
            return false;
        }
    };

    const sanitizeAlias = (alias) =>
        String(alias || "")
            .trim()
            .toLowerCase()
            .replace(/^navi-/, "")
            .replace(/[^a-z0-9_-]+/g, "");

    class Keychain {
        constructor() {
            this.schemaIb = SCHEMA_IB;
            this._prefs = { relayAlias: "", relayKey: DEFAULT_NAME };
            this._prefsLoaded = false;
        }

        async loadPrefs() {
            if (this._prefsLoaded) return this._prefs;
            const raw = await navi.storage.item.get(PREFS_KEY);
            if (raw && typeof raw === "object") {
                this._prefs = {
                    relayAlias: sanitizeAlias(raw.relayAlias || ""),
                    relayKey:
                        String(raw.relayKey || DEFAULT_NAME).trim() ||
                        DEFAULT_NAME,
                };
            }
            this._prefsLoaded = true;
            return this._prefs;
        }

        async savePrefs(patch = {}) {
            await this.loadPrefs();
            if (patch.relayAlias != null) {
                this._prefs.relayAlias = sanitizeAlias(patch.relayAlias);
            }
            if (patch.relayKey != null) {
                this._prefs.relayKey =
                    String(patch.relayKey || DEFAULT_NAME).trim() ||
                    DEFAULT_NAME;
            }
            await navi.storage.item.set(PREFS_KEY, { ...this._prefs });
            return { ...this._prefs };
        }

        async getRelay() {
            const p = await this.loadPrefs();
            return {
                alias: p.relayAlias || "",
                key: p.relayKey || DEFAULT_NAME,
                enabled: !!p.relayAlias,
            };
        }

        async setRelay(alias, keyName = DEFAULT_NAME) {
            const a = sanitizeAlias(alias);
            if (!a) throw new Error("relay alias required");
            return this.savePrefs({
                relayAlias: a,
                relayKey: keyName || DEFAULT_NAME,
            });
        }

        async clearRelay() {
            return this.savePrefs({ relayAlias: "", relayKey: DEFAULT_NAME });
        }

        async relayTransport() {
            const raw = await navi.storage.item.get("relay");
            const prefs = raw && typeof raw === "object" ? raw : {};
            let host = String(prefs.host || navi?.origin || "")
                .trim()
                .replace(/\/+$/, "");
            if (!host) throw new Error("relay host missing — run relay host <url>");
            host = host
                .replace(/^wss:/i, "https:")
                .replace(/^ws:/i, "http:");
            return {
                host,
                token: String(prefs.token || "").trim(),
            };
        }

        resolveFetchUrl(route, host) {
            const p = String(route || "").replace(/^\/+/, "");
            return `${String(host || "").replace(/\/+$/, "")}/${p}`;
        }

        async peerFetch(alias, remainder, opts = {}) {
            const a = sanitizeAlias(alias);
            if (!a) throw new Error("relay alias required");
            const transport = await this.relayTransport();
            let rem = String(remainder || "").replace(/^\/+/, "");
            const path = rem ? `navi-${a}/${rem}` : `navi-${a}/`;
            const bust = `_kc=${Date.now()}`;
            const base = this.resolveFetchUrl(path, transport.host);
            const url = base.includes("?") ? `${base}&${bust}` : `${base}?${bust}`;
            const method = String(opts.method || "GET").toUpperCase();
            const init = {
                method,
                headers: { ...(opts.headers || {}) },
                cache: "no-store",
            };
            if (
                transport.token &&
                !init.headers["X-Navi-Shell-Usage-Token"] &&
                !init.headers["x-navi-shell-usage-token"]
            ) {
                init.headers["X-Navi-Shell-Usage-Token"] = transport.token;
            }
            if (opts.body != null && method !== "GET" && method !== "HEAD") {
                init.body =
                    typeof opts.body === "string"
                        ? opts.body
                        : JSON.stringify(opts.body);
                if (!init.headers["Content-Type"] && !init.headers["content-type"]) {
                    init.headers["Content-Type"] = "application/json; charset=utf-8";
                }
            }
            const res = await fetch(url, init);
            const text = await res.text();
            return { ok: res.ok, status: res.status, text, url };
        }

        parseJsonish(text) {
            const raw = String(text || "").trim();
            if (!raw) return null;
            try {
                return JSON.parse(raw);
            } catch {
                const start = raw.indexOf("{");
                const end = raw.lastIndexOf("}");
                if (start >= 0 && end > start) {
                    try {
                        return JSON.parse(raw.slice(start, end + 1));
                    } catch {
                        return null;
                    }
                }
                return null;
            }
        }

        /**
         * Ping a relay alias: live shell + keychain mounted + named key present.
         * Does not fetch private keys.
         */
        async pingRelay(alias, keyName) {
            await this.loadPrefs();
            const a = sanitizeAlias(alias || this._prefs.relayAlias);
            const key =
                String(keyName || this._prefs.relayKey || DEFAULT_NAME).trim() ||
                DEFAULT_NAME;
            if (!a) throw new Error("relay alias required — keychain relay <alias> [key]");

            const out = {
                alias: a,
                key,
                live: false,
                hasKeychain: false,
                hasKey: false,
                publicKey: null,
                hash: null,
                error: null,
                ping: null,
                rpc: null,
            };

            try {
                const live = await this.peerFetch(a, "");
                out.ping = { status: live.status, text: live.text.slice(0, 240) };
                out.live = live.ok;
                if (!live.ok) {
                    out.error = `alias not live (${live.status})`;
                    return out;
                }
            } catch (e) {
                out.error = String(e.message || e);
                return out;
            }

            try {
                const res = await this.peerFetch(a, "keychain/rpc", {
                    method: "POST",
                    body: { op: "has", key },
                });
                out.rpc = { status: res.status, text: res.text.slice(0, 400) };
                if (!res.ok) {
                    out.error = `keychain rpc failed (${res.status})`;
                    return out;
                }
                const data = this.parseJsonish(res.text);
                if (!data || data.ok === false) {
                    out.error = data?.error || "keychain rpc bad response";
                    return out;
                }
                out.hasKeychain = true;
                out.hasKey = !!data.has;
                out.publicKey = data.publicKey || null;
                out.hash = data.hash || null;
                if (!out.hasKey) out.error = `no key '${key}' on ${a}`;
            } catch (e) {
                out.error = String(e.message || e);
            }
            return out;
        }

        async relayRpc(op, payload = {}) {
            await this.loadPrefs();
            const a = this._prefs.relayAlias;
            if (!a) throw new Error("relay not set — keychain relay <alias> [key]");
            const body = {
                ...payload,
                op,
                key: payload.key || this._prefs.relayKey || DEFAULT_NAME,
            };
            const res = await this.peerFetch(a, "keychain/rpc", {
                method: "POST",
                body,
            });
            if (!res.ok) {
                throw new Error(
                    `relay ${a} keychain/rpc ${op} → ${res.status}: ${res.text.slice(0, 200)}`
                );
            }
            const data = this.parseJsonish(res.text);
            if (!data || data.ok === false) {
                throw new Error(data?.error || `relay rpc ${op} failed`);
            }
            return data;
        }

        async loadAll() {
            const raw = await navi.storage.item.get(STORAGE_KEY);
            if (!raw) return {};
            if (typeof raw === "object" && !Array.isArray(raw)) return { ...raw };
            try {
                const parsed = JSON.parse(String(raw));
                return parsed && typeof parsed === "object" ? parsed : {};
            } catch {
                return {};
            }
        }

        async saveAll(map) {
            await navi.storage.item.set(STORAGE_KEY, map);
        }

        async list() {
            const all = await this.loadAll();
            return Object.keys(all).sort();
        }

        async get(name = DEFAULT_NAME) {
            const all = await this.loadAll();
            return all[name] || null;
        }

        async has(name = DEFAULT_NAME) {
            const entry = await this.get(name);
            if (!entry?.publicKey) return { has: false, name };
            return {
                has: true,
                name: entry.name || name,
                publicKey: entry.publicKey,
                hash: entry.hash || null,
                schemaIb: entry.schemaIb || SCHEMA_IB,
            };
        }

        async create(name = DEFAULT_NAME) {
            const n = String(name || DEFAULT_NAME).trim() || DEFAULT_NAME;
            const pair = await subtle().generateKey(
                { name: "Ed25519" },
                true,
                ["sign", "verify"]
            );
            const privJwk = await subtle().exportKey("jwk", pair.privateKey);
            const pubJwk = await subtle().exportKey("jwk", pair.publicKey);
            const entry = {
                name: n,
                publicKey: pubJwk.x,
                privateKey: privJwk.d,
                hash: await publicKeyHash(pubJwk.x),
                schemaIb: SCHEMA_IB,
                createdAt: new Date().toISOString(),
            };
            const all = await this.loadAll();
            all[n] = entry;
            await this.saveAll(all);
            return { name: n, publicKey: entry.publicKey, hash: entry.hash };
        }

        async importKey(name, publicKey, privateKey) {
            const n = String(name || DEFAULT_NAME).trim() || DEFAULT_NAME;
            if (!publicKey || !privateKey) throw new Error("publicKey and privateKey required");
            await importPrivate(publicKey, privateKey);
            const entry = {
                name: n,
                publicKey: String(publicKey),
                privateKey: String(privateKey),
                hash: await publicKeyHash(String(publicKey)),
                schemaIb: SCHEMA_IB,
                createdAt: new Date().toISOString(),
                imported: true,
            };
            const all = await this.loadAll();
            all[n] = entry;
            await this.saveAll(all);
            return { name: n, publicKey: entry.publicKey, hash: entry.hash };
        }

        /**
         * Deterministic child key: seed = sha256("keychain-derive-v1\n{label}\n" || parent seed).
         * Re-derivable from the parent private key; parent signs a bind proof
         * "keychain-bind-v1\n{parentPub}\n{childPub}\n{label}" anyone can verify.
         */
        async derive(label, from = DEFAULT_NAME) {
            const l = String(label || "").trim();
            if (!l) throw new Error("derive: label required");
            const parentName = String(from || DEFAULT_NAME).trim() || DEFAULT_NAME;
            if (l === parentName) throw new Error("derive: label must differ from parent");
            const parent = await this.resolve(parentName);
            const existing = await this.get(l);
            if (
                existing?.derivedFrom?.publicKey === parent.publicKey &&
                existing?.bind?.signature
            ) {
                return this.derivedView(existing);
            }
            if (existing && !existing.derivedFrom) {
                throw new Error(`key '${l}' exists and is not derived — pick another label`);
            }
            const prefix = new TextEncoder().encode(`${DERIVE_PREFIX}\n${l}\n`);
            const parentSeed = b64urlToBytes(parent.privateKey);
            const buf = new Uint8Array(prefix.length + parentSeed.length);
            buf.set(prefix, 0);
            buf.set(parentSeed, prefix.length);
            const seed = new Uint8Array(await subtle().digest("SHA-256", buf));
            const pair = await keyPairFromSeed(seed);
            const message = bindMessage({
                parentPublicKey: parent.publicKey,
                publicKey: pair.publicKey,
                label: l,
            });
            const signature = await signBytes(
                parent.publicKey,
                parent.privateKey,
                message
            );
            const entry = {
                name: l,
                publicKey: pair.publicKey,
                privateKey: pair.privateKey,
                hash: await publicKeyHash(pair.publicKey),
                schemaIb: SCHEMA_IB,
                createdAt: new Date().toISOString(),
                derivedFrom: { name: parent.name || parentName, publicKey: parent.publicKey },
                bind: { label: l, message, signature },
            };
            const all = await this.loadAll();
            all[l] = entry;
            await this.saveAll(all);
            return this.derivedView(entry);
        }

        derivedView(entry) {
            return {
                name: entry.name,
                publicKey: entry.publicKey,
                hash: entry.hash,
                parentPublicKey: entry.derivedFrom?.publicKey || null,
                label: entry.bind?.label || entry.name,
                bind: entry.bind
                    ? { message: entry.bind.message, signature: entry.bind.signature }
                    : null,
            };
        }

        async verifyBind({ parentPublicKey, publicKey, label, signature }) {
            return verifyBytes(
                parentPublicKey,
                bindMessage({ parentPublicKey, publicKey, label }),
                signature
            );
        }

        async signMessage({ message, key = DEFAULT_NAME }) {
            const entry = await this.resolve(key);
            const signature = await signBytes(
                entry.publicKey,
                entry.privateKey,
                String(message ?? "")
            );
            return { publicKey: entry.publicKey, signature, key: entry.name };
        }

        async verify({ publicKey, message, signature }) {
            return verifyBytes(publicKey, message, signature);
        }

        async del(name) {
            const all = await this.loadAll();
            if (!all[name]) return false;
            delete all[name];
            await this.saveAll(all);
            return true;
        }

        async resolve(name) {
            const entry = await this.get(name || DEFAULT_NAME);
            if (!entry) {
                throw new Error(
                    `no key '${name || DEFAULT_NAME}' — keychain create ${name || DEFAULT_NAME}`
                );
            }
            return entry;
        }

        async signWriteLocal({
            ib,
            parentAddr = "",
            body,
            contentType = "application/octet-stream",
            key = DEFAULT_NAME,
            prefix,
            scheme,
        }) {
            if (!ib) throw new Error("signWrite: ib required");
            const entry = await this.resolve(key);
            const writePrefix = resolveWritePrefix({ prefix, scheme });
            const message = await writeMessage({
                ib,
                parentAddr,
                body,
                contentType,
                prefix: writePrefix,
            });
            const signature = await signBytes(
                entry.publicKey,
                entry.privateKey,
                message
            );
            return {
                publicKey: entry.publicKey,
                signature,
                message,
                schemaIb: SCHEMA_IB,
                hash: entry.hash,
                key: entry.name,
                prefix: writePrefix,
                via: "local",
            };
        }

        async signReadLocal({
            ib,
            timestamp = "",
            key = DEFAULT_NAME,
            prefix = "",
        }) {
            if (!ib) throw new Error("signRead: ib required");
            const entry = await this.resolve(key);
            const ts =
                timestamp === "" || timestamp == null ? "" : String(timestamp);
            const readPrefix = String(prefix || "").trim() || READ_SIGN_PREFIX;
            const message = [readPrefix, ib, ts].join("\n");
            const signature = await signBytes(
                entry.publicKey,
                entry.privateKey,
                message
            );
            return {
                publicKey: entry.publicKey,
                signature,
                message,
                timestamp: ts,
                schemaIb: SCHEMA_IB,
                key: entry.name,
                prefix: readPrefix,
                via: "local",
            };
        }

        async signWrite(opts = {}) {
            await this.loadPrefs();
            if (this._prefs.relayAlias) {
                const data = await this.relayRpc("signWrite", {
                    ib: opts.ib,
                    parentAddr: opts.parentAddr || "",
                    body: opts.body,
                    contentType: opts.contentType || "application/octet-stream",
                    key: opts.key || this._prefs.relayKey || DEFAULT_NAME,
                    prefix: opts.prefix,
                    scheme: opts.scheme,
                });
                return { ...data, via: "relay:" + this._prefs.relayAlias };
            }
            return this.signWriteLocal(opts);
        }

        async signRead(opts = {}) {
            await this.loadPrefs();
            if (this._prefs.relayAlias) {
                const data = await this.relayRpc("signRead", {
                    ib: opts.ib,
                    timestamp: opts.timestamp || "",
                    key: opts.key || this._prefs.relayKey || DEFAULT_NAME,
                    prefix: opts.prefix || "",
                });
                return { ...data, via: "relay:" + this._prefs.relayAlias };
            }
            return this.signReadLocal(opts);
        }

        /** Handle POST /navi-{alias}/keychain/rpc — never returns privateKey. */
        async handleRpc(raw) {
            let req = raw;
            if (typeof raw === "string") {
                try {
                    req = JSON.parse(raw);
                } catch {
                    throw new Error("rpc body must be JSON");
                }
            }
            if (!req || typeof req !== "object") throw new Error("rpc body required");
            const op = String(req.op || "").trim();
            const key = String(req.key || DEFAULT_NAME).trim() || DEFAULT_NAME;

            if (op === "has" || op === "ping") {
                const h = await this.has(key);
                return { ok: true, op, ...h };
            }
            if (op === "list") {
                const names = await this.list();
                const keys = [];
                for (const n of names) {
                    const e = await this.get(n);
                    keys.push({
                        name: n,
                        hash: e?.hash || null,
                        publicKey: e?.publicKey || null,
                    });
                }
                return { ok: true, op, keys };
            }
            if (op === "getPublic") {
                const e = await this.get(key);
                if (!e) return { ok: true, op, has: false, key };
                return {
                    ok: true,
                    op,
                    has: true,
                    name: e.name,
                    publicKey: e.publicKey,
                    hash: e.hash,
                    schemaIb: e.schemaIb || SCHEMA_IB,
                    createdAt: e.createdAt || null,
                };
            }
            if (op === "signWrite") {
                const signed = await this.signWriteLocal({
                    ib: req.ib,
                    parentAddr: req.parentAddr || "",
                    body: req.body,
                    contentType: req.contentType || "application/octet-stream",
                    key,
                    prefix: req.prefix,
                    scheme: req.scheme,
                });
                return {
                    ok: true,
                    op,
                    publicKey: signed.publicKey,
                    signature: signed.signature,
                    message: signed.message,
                    schemaIb: signed.schemaIb,
                    hash: signed.hash,
                    key: signed.key,
                    prefix: signed.prefix,
                };
            }
            if (op === "signRead") {
                const signed = await this.signReadLocal({
                    ib: req.ib,
                    timestamp: req.timestamp || "",
                    key,
                    prefix: req.prefix || "",
                });
                return {
                    ok: true,
                    op,
                    publicKey: signed.publicKey,
                    signature: signed.signature,
                    message: signed.message,
                    timestamp: signed.timestamp,
                    schemaIb: signed.schemaIb,
                    key: signed.key,
                    prefix: signed.prefix,
                };
            }
            throw new Error(
                `unknown rpc op '${op}' — has|list|getPublic|signWrite|signRead`
            );
        }

        buildSignHeaders({ publicKey, signature }) {
            return {
                "X-Flowerpot-Sign-Keys": publicKey,
                "X-Flowerpot-Signatures": signature,
            };
        }

        buildReadHeaders({ publicKey, signature, timestamp }) {
            const h = {
                "X-Flowerpot-Sign-Keys": publicKey,
                "X-Flowerpot-Signatures": signature,
                "X-Foobarch-Sign-Keys": publicKey,
                "X-Foobarch-Signatures": signature,
            };
            if (timestamp !== undefined && timestamp !== "" && timestamp != null) {
                const ts = String(timestamp);
                // foobarch authorizeRead expects *-Read-Timestamp
                h["X-Flowerpot-Read-Timestamp"] = ts;
                h["X-Foobarch-Read-Timestamp"] = ts;
            }
            return h;
        }
    }

    const chain = new Keychain();

    const tokenize = (args) => {
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
                (a.startsWith('"') && a.endsWith('"')) ||
                (a.startsWith("'") && a.endsWith("'"))
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
            if (t === "--key" || t === "--name") flags.key = tokens[++i];
            else if (t === "--pub" || t === "--public") flags.publicKey = tokens[++i];
            else if (t === "--priv" || t === "--private") flags.privateKey = tokens[++i];
            else if (t === "--ib") flags.ib = tokens[++i];
            else if (t === "--parent") flags.parentAddr = tokens[++i];
            else if (t === "--type") flags.contentType = tokens[++i];
            else if (t === "--body") flags.body = tokens[++i];
            else if (t === "--timestamp" || t === "--ts") flags.timestamp = tokens[++i];
            else if (t === "--priv-show") flags.showPriv = true;
            else positional.push(t);
        }
        return { flags, positional };
    };

    const HELP = [
        `keychain — Flowerpot ed25519 keystore (schema ${SCHEMA_IB})`,
        "",
        "  keychain create [name]              Generate Ed25519 pair (default name: default)",
        "  keychain list                       List local key names",
        "  keychain show [name]                Show public key + hash (+ --priv-show)",
        "  keychain del <name>                 Delete a local key",
        "  keychain import <name> --pub x --priv d",
        "  keychain derive <label> [from]      Deterministic child key + bind proof signed by parent",
        "  keychain sign write|read …          Sign (local, or via relay if set)",
        "  keychain relay <alias> [key]        Sign via /navi-{alias}/keychain/rpc",
        "  keychain relay off                  Clear relay; use local keys",
        "  keychain ping [alias] [key]         Live + has keychain + has key?",
        "",
        "  rpc (POST JSON): has|list|getPublic|signWrite|signRead — never returns privateKey.",
    ].join("\n");

    const run = async (...rawArgs) => {
        const args = tokenize(rawArgs);
        if (!args.length || args[0] === "help" || args[0] === "-h") return HELP;

        const verb = String(args[0]).toLowerCase();
        const { flags, positional } = parseFlags(args.slice(1));

        try {
            switch (verb) {
                case "create": {
                    const name = positional[0] || flags.key || DEFAULT_NAME;
                    const created = await chain.create(name);
                    return `created '${created.name}' hash=${created.hash}\npub=${created.publicKey}`;
                }
                case "list": {
                    const names = await chain.list();
                    if (!names.length) return "(no keys — keychain create)";
                    const all = await chain.loadAll();
                    return names
                        .map(
                            (n) =>
                                `  ${n}  hash=${all[n].hash || "?"}  schema=${all[n].schemaIb || SCHEMA_IB}`
                        )
                        .join("\n");
                }
                case "show": {
                    const name = positional[0] || flags.key || DEFAULT_NAME;
                    const entry = await chain.get(name);
                    if (!entry) return `no key '${name}'`;
                    const lines = [
                        `name: ${entry.name}`,
                        `hash: ${entry.hash}`,
                        `schema: ${entry.schemaIb || SCHEMA_IB}`,
                        `publicKey: ${entry.publicKey}`,
                        `createdAt: ${entry.createdAt || "?"}`,
                    ];
                    if (flags.showPriv) lines.push(`privateKey: ${entry.privateKey}`);
                    return lines.join("\n");
                }
                case "del":
                case "delete":
                case "rm": {
                    const name = positional[0] || flags.key;
                    if (!name) return "usage: keychain del <name>";
                    return (await chain.del(name))
                        ? `deleted '${name}'`
                        : `no key '${name}'`;
                }
                case "import": {
                    const name = positional[0] || flags.key || DEFAULT_NAME;
                    if (!flags.publicKey || !flags.privateKey) {
                        return "usage: keychain import <name> --pub <x> --priv <d>";
                    }
                    const imported = await chain.importKey(
                        name,
                        flags.publicKey,
                        flags.privateKey
                    );
                    return `imported '${imported.name}' hash=${imported.hash}`;
                }
                case "derive": {
                    const label = positional[0];
                    if (!label) return "usage: keychain derive <label> [from]";
                    const d = await chain.derive(label, positional[1] || flags.key || DEFAULT_NAME);
                    return JSON.stringify(d, null, 2);
                }
                case "relay": {
                    const arg0 = String(positional[0] || "").toLowerCase();
                    if (!arg0 || arg0 === "status" || arg0 === "show") {
                        const r = await chain.getRelay();
                        return r.enabled
                            ? `relay ${r.alias} key=${r.key}`
                            : "relay off (local keys)";
                    }
                    if (arg0 === "off" || arg0 === "clear" || arg0 === "-" || arg0 === "none") {
                        await chain.clearRelay();
                        return "relay off (local keys)";
                    }
                    const key = positional[1] || flags.key || DEFAULT_NAME;
                    const prefs = await chain.setRelay(arg0, key);
                    return `relay ${prefs.relayAlias} key=${prefs.relayKey}`;
                }
                case "ping": {
                    const alias = positional[0];
                    const keyName = positional[1] || flags.key;
                    const out = await chain.pingRelay(alias, keyName);
                    return JSON.stringify(out, null, 2);
                }
                case "rpc": {
                    const body =
                        navi?.callinRequest?.body != null &&
                        String(navi.callinRequest.body).trim()
                            ? navi.callinRequest.body
                            : positional[0] || null;
                    const result = await chain.handleRpc(body);
                    return JSON.stringify(result, null, 2);
                }
                case "sign": {
                    const kind = String(positional[0] || "").toLowerCase();
                    if (kind === "write") {
                        if (!flags.ib || flags.body == null) {
                            return "usage: keychain sign write --ib <path> --type <mime> --body <bytes> [--parent addr] [--key name]";
                        }
                        const signed = await chain.signWrite({
                            ib: flags.ib,
                            parentAddr: flags.parentAddr || "",
                            body: flags.body,
                            contentType: flags.contentType || "text/plain",
                            key: flags.key || DEFAULT_NAME,
                        });
                        return JSON.stringify(
                            {
                                publicKey: signed.publicKey,
                                signature: signed.signature,
                                schemaIb: signed.schemaIb,
                                message: signed.message,
                                via: signed.via,
                            },
                            null,
                            2
                        );
                    }
                    if (kind === "read") {
                        if (!flags.ib) {
                            return "usage: keychain sign read --ib <path> [--timestamp unix] [--key name]";
                        }
                        const signed = await chain.signRead({
                            ib: flags.ib,
                            timestamp: flags.timestamp || "",
                            key: flags.key || DEFAULT_NAME,
                        });
                        return JSON.stringify(
                            {
                                publicKey: signed.publicKey,
                                signature: signed.signature,
                                timestamp: signed.timestamp,
                                via: signed.via,
                            },
                            null,
                            2
                        );
                    }
                    return "usage: keychain sign write|read ...";
                }
                default:
                    return `unknown: ${verb}\n\n${HELP}`;
            }
        } catch (error) {
            return `error: ${error.message || error}`;
        }
    };

    return {
        name: "keychain",
        version: VERSION,
        description: `Flowerpot ed25519 keychain for ${SCHEMA_IB}`,

        moduleInfo: {
            name: "keychain",
            version: VERSION,
            description: `Flowerpot ed25519 keychain for ${SCHEMA_IB}`,
            schemaIb: SCHEMA_IB,
        },

        schemaIb: SCHEMA_IB,
        WRITE_SIGN_PREFIX,
        FLOWERPOT_WRITE_PREFIX,
        PROPOSAL_WRITE_PREFIX,
        READ_SIGN_PREFIX,

        keychain: chain,
        create: (...a) => chain.create(...a),
        list: (...a) => chain.list(...a),
        get: (...a) => chain.get(...a),
        has: (...a) => chain.has(...a),
        importKey: (...a) => chain.importKey(...a),
        del: (...a) => chain.del(...a),
        derive: (...a) => chain.derive(...a),
        verifyBind: (...a) => chain.verifyBind(...a),
        signMessage: (...a) => chain.signMessage(...a),
        verify: (...a) => chain.verify(...a),
        signWrite: (...a) => chain.signWrite(...a),
        signRead: (...a) => chain.signRead(...a),
        signReadLocal: (...a) => chain.signReadLocal(...a),
        getRelay: (...a) => chain.getRelay(...a),
        setRelay: (...a) => chain.setRelay(...a),
        clearRelay: (...a) => chain.clearRelay(...a),
        pingRelay: (...a) => chain.pingRelay(...a),
        buildSignHeaders: (...a) => chain.buildSignHeaders(...a),
        buildReadHeaders: (...a) => chain.buildReadHeaders(...a),

        commands: {
            keychain: {
                name: "keychain",
                methods: ["GET", "POST"],
                description: "Keychain control helper",
                execute: async (...args) => run(...args),
            },
        },

        onMount: async () => {
            await chain.loadPrefs();
            const names = await chain.list();
            const r = await chain.getRelay();
            console.log(
                `[keychain] ready v${VERSION} — schema ${SCHEMA_IB} — ${names.length} key(s)` +
                    (r.enabled ? ` — relay ${r.alias} key=${r.key}` : " — local")
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
            console.log("[keychain] unmounted");
        },
    };
};
