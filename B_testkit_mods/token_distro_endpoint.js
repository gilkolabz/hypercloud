/**
 * token_distro_endpoint — mint + distribute foobarch usage tokens to approved keychain identities.
 *
 * Roles (pick once per navi: `token_distro_endpoint role distributor|approver`):
 *   distributor — holds the mint password, keeps approvals + ledger, mints on claim
 *                 (each approval is spent by exactly one claim).
 *                 Wraps relay callins so only token_distro_endpoint/{ping,status,request,claim,admin} pass.
 *   approver    — receives access requests in an inbox (relay), approves/denies/revokes by
 *                 signing admin ops with its keychain-derived key.
 *   requester   — default (no role): request access + claim tokens into the tokens tip (navi.tokens).
 *
 * Identity: keychain `derive token_distro` — deterministic child of the default key, with a
 * bind proof signed by the default key. The child pubkey is what gets allowlisted + tracked.
 *
 * Wire: POST JSON { payload: "<json>", sig, bind? }; sig = ed25519("{prefix}\n{payload}").
 * Requesters reach the distributor through a hostpark proxy (default https://foobarch.net/token_distro),
 * peers reach each other directly via https://foobarch.net/navi-{alias}/token_distro_endpoint/….
 */

export const register = (navi) => {
    const NAME = "token_distro_endpoint";
    const VERSION = "0.5.3";
    const PREFS_KEY = "token_distro.prefs";
    const STATE_KEY = "token_distro.state";
    const MINT_KEY = "token_distro.mint";
    const TOKENS_IB = "tokens";
    const KEY_LABEL = "token_distro";
    const PREFIX = {
        request: "token-distro-request-v1",
        claim: "token-distro-claim-v1",
        admin: "token-distro-admin-v1",
        inbox: "token-distro-inbox-v1",
    };
    const BIND_PREFIX = "keychain-bind-v1";
    const TS_WINDOW_MS = 5 * 60 * 1000;
    const MAX_PER_APPROVAL = 1000;
    const DEFAULTS = {
        role: "",
        alias: "",
        relayHost: "https://foobarch.net",
        endpoint: "https://foobarch.net/token_distro",
        mintHost: "https://foobarch.net",
        perClaim: 20,
        peer: null,
        gate: { on: null, extra: [] },
    };
    const ENDPOINT_VERBS = {
        distributor: ["ping", "status", "request", "claim", "admin"],
        approver: ["ping", "inbox"],
        "": ["ping"],
    };

    const timers = [];
    let prefs = { ...DEFAULTS };
    let gateRestore = null;

    const say = (msg) => {
        const text = `[${NAME}] ${msg}`;
        try {
            if (typeof navi.callout === "function") navi.callout(text);
            else console.log(text);
        } catch {
            console.log(text);
        }
    };

    const normHost = (raw) => String(raw || "").trim().replace(/\/+$/, "");

    const normPath = (raw) => {
        let s = String(raw || "").trim();
        try {
            s = decodeURIComponent(s);
        } catch {
            /* keep */
        }
        return s
            .replace(/^\/+/, "")
            .replace(/[:\s]+/g, "/")
            .replace(/\/+/g, "/")
            .replace(/\/+$/, "")
            .toLowerCase();
    };

    const sanitizeAlias = (a) =>
        String(a || "")
            .trim()
            .replace(/^navi-/i, "")
            .replace(/[^a-zA-Z0-9._-]+/g, "");

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

    const sha256Hex = async (text) => {
        const dig = await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(String(text ?? ""))
        );
        return [...new Uint8Array(dig)].map((b) => b.toString(16).padStart(2, "0")).join("");
    };

    const randomHex = (n = 12) => {
        const u8 = new Uint8Array(n);
        crypto.getRandomValues(u8);
        return [...u8].map((b) => b.toString(16).padStart(2, "0")).join("");
    };

    const verifySig = async (publicKey, message, signature) => {
        try {
            const key = await crypto.subtle.importKey(
                "jwk",
                { kty: "OKP", crv: "Ed25519", x: String(publicKey) },
                { name: "Ed25519" },
                false,
                ["verify"]
            );
            return await crypto.subtle.verify(
                { name: "Ed25519" },
                key,
                b64urlToBytes(signature),
                new TextEncoder().encode(String(message))
            );
        } catch {
            return false;
        }
    };

    /** Ed25519 public key as base64url (32 bytes → 43 chars). */
    const PUB_RE = /^[A-Za-z0-9_-]{43}$/;
    const shortPub = (p) => (p ? `${String(p).slice(0, 10)}…` : "?");
    /** Shortest prefix (min 3) of id that no other id in `all` shares. */
    const shortestPrefix = (id, all) => {
        for (let n = 3; n < id.length; n++) {
            const p = id.slice(0, n);
            if (!all.some((x) => x !== id && x.startsWith(p))) return p;
        }
        return id;
    };

    // ─── prefs / state ────────────────────────────────────────────────

    const loadPrefs = async () => {
        const raw = await navi.storage.item.get(PREFS_KEY);
        const p = raw && typeof raw === "object" ? raw : {};
        prefs = {
            ...DEFAULTS,
            ...p,
            gate: { ...DEFAULTS.gate, ...(p.gate || {}) },
        };
        delete prefs.perDay;
        return prefs;
    };

    const savePrefs = async (patch = {}) => {
        prefs = { ...prefs, ...patch };
        await navi.storage.item.set(PREFS_KEY, prefs);
        return prefs;
    };

    const loadState = async () => {
        const raw = await navi.storage.item.get(STATE_KEY);
        const s = raw && typeof raw === "object" ? raw : {};
        const state = {
            allow: s.allow || {},
            pending: s.pending || {},
            ledger: s.ledger || {},
            nonces: s.nonces || {},
            inbox: s.inbox || {},
            claims: Array.isArray(s.claims) ? s.claims : [],
            revoked: s.revoked || {},
        };
        // Pre-0.3 approvals stayed on the allowlist after claiming; an approval is one claim.
        for (const [pub, a] of Object.entries(state.allow)) {
            const spent = state.claims.find((c) => c.pub === pub && !c.grant && c.at >= (a.addedAt || ""));
            if (spent) {
                spent.grant = a;
                delete state.allow[pub];
            }
        }
        return state;
    };

    const saveState = async (s) => {
        const cutoff = Date.now() - TS_WINDOW_MS * 2;
        for (const [n, ts] of Object.entries(s.nonces || {})) {
            if (ts < cutoff) delete s.nonces[n];
        }
        await navi.storage.item.set(STATE_KEY, s);
    };

    // ─── keychain identity ────────────────────────────────────────────

    const keychain = () => {
        const kc = navi.mod?.keychain;
        if (!kc) throw new Error("mount keychain first (keychain ≥ 1.5.0)");
        if (typeof kc.derive !== "function" || typeof kc.signMessage !== "function") {
            throw new Error("keychain ≥ 1.5.0 required (derive/signMessage) — remount keychain");
        }
        return kc;
    };

    const identity = async () => {
        const kc = keychain();
        if (!(await kc.get("default"))) await kc.create("default");
        return kc.derive(KEY_LABEL, "default");
    };

    const signEnvelope = async (kind, body) => {
        const kc = keychain();
        const id = await identity();
        const payload = JSON.stringify({
            v: 1,
            kind,
            ts: Date.now(),
            nonce: randomHex(12),
            pub: id.publicKey,
            ...body,
        });
        const { signature } = await kc.signMessage({
            message: `${PREFIX[kind]}\n${payload}`,
            key: KEY_LABEL,
        });
        return { id, env: { payload, sig: signature } };
    };

    /** Verify envelope sig + ts window + nonce; returns parsed payload. */
    const openEnvelope = async (raw, kind, state) => {
        let env = raw;
        if (typeof raw === "string") {
            try {
                env = JSON.parse(raw);
            } catch {
                throw new Error("body must be JSON");
            }
        }
        if (!env || typeof env.payload !== "string" || !env.sig) {
            throw new Error("envelope { payload, sig } required");
        }
        let p;
        try {
            p = JSON.parse(env.payload);
        } catch {
            throw new Error("payload must be JSON");
        }
        if (p.kind !== kind || p.v !== 1) throw new Error(`expected ${kind} v1 payload`);
        if (!p.pub) throw new Error("payload.pub required");
        if (!(await verifySig(p.pub, `${PREFIX[kind]}\n${env.payload}`, env.sig))) {
            throw new Error("bad signature");
        }
        if (!Number.isFinite(p.ts) || Math.abs(Date.now() - p.ts) > TS_WINDOW_MS) {
            throw new Error("stale or future timestamp");
        }
        const nonce = String(p.nonce || "");
        if (!nonce) throw new Error("nonce required");
        if (state.nonces[nonce]) throw new Error("replayed nonce");
        state.nonces[nonce] = p.ts;
        return { env, p };
    };

    const verifyBind = (p, bindSig) =>
        verifySig(
            p.parent,
            [BIND_PREFIX, p.parent, p.pub, p.label].join("\n"),
            bindSig
        );

    // ─── HTTP ─────────────────────────────────────────────────────────

    const postJson = async (url, body, headers = {}) => {
        const res = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Navi-Shell-Wait": "1",
                ...headers,
            },
            body: JSON.stringify(body),
        });
        const text = await res.text();
        let json = null;
        try {
            json = JSON.parse(text);
        } catch {
            /* non-json */
        }
        if (!res.ok || !json || json.ok === false) {
            const err = json?.error || text.slice(0, 240) || `HTTP ${res.status}`;
            throw new Error(`${url} → ${res.status}: ${err}`);
        }
        return json;
    };

    const getJson = async (url, headers = {}) => {
        const res = await fetch(url, { headers: { "X-Navi-Shell-Wait": "1", ...headers } });
        const text = await res.text();
        let json = null;
        try {
            json = JSON.parse(text);
        } catch {
            /* non-json */
        }
        if (!res.ok || !json) throw new Error(`${url} → ${res.status}: ${text.slice(0, 240)}`);
        return json;
    };

    const relayUrl = (alias, verb) =>
        `${normHost(prefs.relayHost)}/navi-${alias}/${NAME}/${verb}`;

    const peerHeaders = () =>
        prefs.peer?.token ? { "X-Navi-Shell-Usage-Token": prefs.peer.token } : {};

    const endpointUrl = (verb) => {
        const e = String(prefs.endpoint || "").trim();
        if (/^navi-/i.test(e)) return relayUrl(sanitizeAlias(e), verb);
        return `${normHost(e)}/${verb}`;
    };

    // ─── relay gate (wraps dispatchCallin on this navi instance) ─────

    const gateEnabled = () => {
        if (prefs.gate.on === true || prefs.gate.on === false) return prefs.gate.on;
        return prefs.role === "distributor";
    };

    const gateAllowList = () => [
        ...(ENDPOINT_VERBS[prefs.role] || ENDPOINT_VERBS[""]).map((v) => `${NAME}/${v}`),
        ...(prefs.gate.extra || []).map(normPath).filter(Boolean),
    ];

    const relayAllowed = (path) => {
        const p = normPath(path);
        return gateAllowList().some((a) => p === a || p.startsWith(a + "/"));
    };

    const installGate = () => {
        if (gateRestore) return;
        const hadOwn = Object.prototype.hasOwnProperty.call(navi, "dispatchCallin");
        const prev = navi.dispatchCallin;
        const wrapped = async function (input) {
            if (input && typeof input === "object" && input.viaRelay && gateEnabled()) {
                const path = input.path != null ? input.path : input.input;
                if (!relayAllowed(path)) {
                    throw new Error(
                        `blocked from relay by ${NAME} gate: ${normPath(path) || "(empty)"}`
                    );
                }
            }
            return prev.call(navi, input);
        };
        navi.dispatchCallin = wrapped;

        // Older native builds relay via dispatchRelayRemainder (no body, never dispatchCallin).
        const hadOwnOld = Object.prototype.hasOwnProperty.call(navi, "dispatchRelayRemainder");
        const prevOld =
            typeof navi.dispatchRelayRemainder === "function" ? navi.dispatchRelayRemainder : null;
        const wrappedOld = prevOld
            ? async function (remainder, method) {
                  const rem = String(remainder || "").replace(/^\/+/, "").trim();
                  if (rem && gateEnabled() && !relayAllowed(rem)) {
                      throw new Error(`blocked from relay by ${NAME} gate: ${normPath(rem)}`);
                  }
                  return prevOld.call(navi, remainder, method);
              }
            : null;
        if (wrappedOld) navi.dispatchRelayRemainder = wrappedOld;

        gateRestore = () => {
            if (navi.dispatchCallin === wrapped) {
                if (hadOwn) navi.dispatchCallin = prev;
                else delete navi.dispatchCallin;
            }
            if (wrappedOld && navi.dispatchRelayRemainder === wrappedOld) {
                if (hadOwnOld) navi.dispatchRelayRemainder = prevOld;
                else delete navi.dispatchRelayRemainder;
            }
        };
    };

    const removeGate = () => {
        if (gateRestore) gateRestore();
        gateRestore = null;
    };

    /** Navi ≥ relay whitelist: register our paths with the shell instead of wrapping dispatch. */
    const coreWhitelist = () =>
        navi.relayWhitelist && typeof navi.relayWhitelist.add === "function" ? navi.relayWhitelist : null;

    const syncGate = async () => {
        const wl = coreWhitelist();
        if (!wl) {
            installGate();
            return;
        }
        removeGate();
        wl.add(NAME, gateAllowList());
        if (prefs.role === "distributor" && prefs.gate.on !== false && !(await wl.isOn())) {
            await wl.on();
            say("relay whitelist turned ON (distributor default) — only token_distro_endpoint verbs reach this navi");
        }
    };

    const gateText = async () => {
        const wl = coreWhitelist();
        if (!wl) return `relay gate: ${gateEnabled() ? "ON" : "off"} — allow ${gateAllowList().join(", ")}`;
        return `relay whitelist: ${(await wl.isOn()) ? "ON" : "off"} — ${NAME} adds ${gateAllowList().join(", ")}`;
    };

    // ─── requester ────────────────────────────────────────────────────

    const appendTokens = async (host, tokens) => {
        if (typeof navi.tokens?.add === "function") {
            const r = await navi.tokens.add(host, tokens);
            return { host, added: r.added, count: r.count };
        }
        let tip = await navi.storage.tip.get(TOKENS_IB);
        const data = { ...(tip?.data || {}) };
        if (!data.parts) data.parts = ["navi_park", "ibgib_frame", "manifest", "json"];
        data.hosts = data.hosts && typeof data.hosts === "object" ? { ...data.hosts } : {};
        const cur = String(data.hosts[host]?.unused || "")
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean);
        const next = [...cur, ...tokens];
        data.hosts[host] = { ...(data.hosts[host] || {}), unused: next.join("\n") + "\n" };
        if (!data.default_host) data.default_host = host;
        await navi.storage.tip.mut8(TOKENS_IB, data, { create: true });
        return { host, added: tokens.length, count: next.length };
    };

    const requestAccess = async (note) => {
        const id = await identity();
        const { env } = await signEnvelope("request", {
            parent: id.parentPublicKey,
            label: id.label,
            note: String(note || "").slice(0, 280),
        });
        env.bind = id.bind.signature;
        return postJson(endpointUrl("request"), env);
    };

    const claimTokens = async () => {
        const { env } = await signEnvelope("claim", {});
        const r = await postJson(endpointUrl("claim"), env);
        const tokens = Array.isArray(r.tokens) ? r.tokens : [];
        if (!tokens.length) throw new Error("distributor returned no tokens");
        const host = normHost(r.host) || "https://foobarch.net";
        const stored = await appendTokens(host, tokens);
        return { host, received: tokens.length, stash: stored.count };
    };

    const statusRemote = async () => {
        const id = await identity();
        return getJson(`${endpointUrl("status")}/${encodeURIComponent(id.publicKey)}`);
    };

    // ─── distributor endpoint ─────────────────────────────────────────

    const readMintPassword = async () => {
        const v = await navi.storage.item.get(MINT_KEY);
        return v ? String(v) : "";
    };

    const mint = async (count) => {
        const pw = await readMintPassword();
        if (!pw) throw new Error("distributor has no mint password set");
        const host = normHost(prefs.mintHost);
        const res = await fetch(`${host}/foobarch/tokens`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Foobarch-Usage-Password": pw,
            },
            body: JSON.stringify({ count }),
        });
        const text = await res.text();
        if (!res.ok) throw new Error(`mint → ${res.status}: ${text.slice(0, 200)}`);
        const tokens = JSON.parse(text).tokens;
        if (!Array.isArray(tokens) || !tokens.length) throw new Error("mint returned no tokens");
        return { host, tokens };
    };

    /** Requester address as seen through Caddy → hostpark proxy → relay (headers lowercased). */
    const requesterSource = () => {
        const h = navi.callinRequest?.headers || {};
        const get = (name) => {
            for (const [k, v] of Object.entries(h)) {
                if (String(k).toLowerCase() === name && v != null) return String(v).trim();
            }
            return "";
        };
        const xff = get("x-forwarded-for");
        const ip = get("cf-connecting-ip") || xff.split(",")[0].trim() || get("x-real-ip");
        return { ip: ip || null, xff: xff || null, ua: get("user-agent").slice(0, 200) || null };
    };

    /** 16-hex mint-set lead(s) — one mint call shares a lead. */
    const mintLeads = (tokens) => [...new Set(tokens.map((t) => String(t).slice(0, 16)))];

    /** Forward a pending request to the linked approver's inbox (idempotent on the approver side). */
    const notifyApprover = async (id, request) => {
        if (!prefs.peer?.alias) return { notified: false, notifyError: "no approver linked" };
        try {
            const { env: fwd } = await signEnvelope("inbox", { from: prefs.alias || null, id, request });
            await postJson(relayUrl(prefs.peer.alias, "inbox"), fwd, peerHeaders());
            return { notified: true, notifyError: null };
        } catch (e) {
            return { notified: false, notifyError: String(e.message || e) };
        }
    };

    const onRequest = async (body) => {
        const state = await loadState();
        const { env, p } = await openEnvelope(body, "request", state);
        if (!p.parent || !p.label || !env.bind) throw new Error("parent, label, bind required");
        if (!(await verifyBind(p, env.bind))) throw new Error("bind proof does not verify");
        if (state.allow[p.pub]) {
            await saveState(state);
            return { ok: true, allowed: true, pub: p.pub };
        }
        const waiting = Object.values(state.pending).find((r) => r.pub === p.pub);
        if (waiting) {
            await saveState(state);
            const { notified, notifyError } = await notifyApprover(waiting.id, waiting.request);
            say(`access request ${waiting.id} asked again${notified ? " → approver re-notified" : ` (${notifyError})`}`);
            return { ok: true, allowed: false, pending: waiting.id, notified, already: true, ...(notifyError ? { notify_error: notifyError } : {}) };
        }
        const id = (await sha256Hex(`${p.pub}\n${env.sig}`)).slice(0, 12);
        const src = requesterSource();
        state.pending[id] = {
            id,
            pub: p.pub,
            parent: p.parent,
            label: p.label,
            note: p.note || "",
            ...src,
            request: { payload: env.payload, sig: env.sig, bind: env.bind },
            at: new Date().toISOString(),
        };
        await saveState(state);
        const { notified, notifyError } = await notifyApprover(id, env);
        say(`access request ${id} from ${shortPub(p.pub)}${notified ? " → approver notified" : ` (${notifyError})`}`);
        return { ok: true, allowed: false, pending: id, notified, ...(notifyError ? { notify_error: notifyError } : {}) };
    };

    const onClaim = async (body) => {
        const state = await loadState();
        const { p } = await openEnvelope(body, "claim", state);
        const grant = state.allow[p.pub];
        if (!grant) {
            await saveState(state);
            return { ok: false, error: "no approved request to claim — send a request first" };
        }
        const minted = await mint(Math.max(1, Number(grant.count) || Number(prefs.perClaim) || DEFAULTS.perClaim));
        const at = new Date().toISOString();
        const leads = mintLeads(minted.tokens);
        const row = state.ledger[p.pub] || { total: 0 };
        state.ledger[p.pub] = {
            parent: grant.parent || row.parent || null,
            total: (row.total || 0) + minted.tokens.length,
            last: at,
        };
        state.claims.push({
            at,
            pub: p.pub,
            lead: leads[0],
            ...(leads.length > 1 ? { leads } : {}),
            count: minted.tokens.length,
            host: minted.host,
            ...requesterSource(),
            grant,
        });
        delete state.allow[p.pub];
        await saveState(state);
        say(`claim ${minted.tokens.length} → ${shortPub(p.pub)} (approval "${grant.memo || ""}" spent)`);
        return { ok: true, host: minted.host, tokens: minted.tokens };
    };

    const onStatus = async (pubRaw) => {
        const pub = String(pubRaw || "").trim();
        const base = { ok: true, name: NAME, version: VERSION };
        if (!pub) return base;
        const state = await loadState();
        const pendingId = Object.values(state.pending).find((r) => r.pub === pub)?.id || null;
        return { ...base, pub, allowed: !!state.allow[pub], pending: pendingId };
    };

    /** `approval` = the approver's signed admin envelope { payload, sig } (null for local ops). */
    const applyAdmin = async (state, op, args, by, approval = null) => {
        const now = new Date().toISOString();
        if (op === "allow") {
            const pub = String(args.pub || "").trim();
            const memo = String(args.memo || "").trim();
            if (!memo) throw new Error("allow: memo required (who is asking)");
            const pend =
                state.pending[args.id] ||
                Object.values(state.pending).find((r) => r.pub === pub);
            const target = pend?.pub || pub;
            if (!target) throw new Error("allow: id or pub required");
            let count = null;
            if (args.count != null) {
                count = Math.floor(Number(args.count));
                if (!(count >= 1 && count <= MAX_PER_APPROVAL)) {
                    throw new Error(`allow: count must be 1..${MAX_PER_APPROVAL}`);
                }
            }
            state.allow[target] = {
                ...(count != null ? { count } : {}),
                parent: pend?.parent || args.parent || null,
                label: pend?.label || null,
                note: pend?.note || "",
                memo,
                ip: pend?.ip || null,
                xff: pend?.xff || null,
                ua: pend?.ua || null,
                requestedAt: pend?.at || null,
                request: pend?.request || null,
                approval,
                addedAt: now,
                by,
            };
            if (pend) delete state.pending[pend.id];
            return { allowed: target, memo, count: count ?? prefs.perClaim };
        }
        if (op === "deny") {
            const pend =
                state.pending[args.id] ||
                Object.values(state.pending).find((r) => r.pub === args.pub);
            if (!pend) throw new Error("deny: no such pending request");
            delete state.pending[pend.id];
            return { denied: pend.id };
        }
        if (op === "revoke") {
            const pub = String(args.pub || "").trim();
            if (!state.allow[pub]) throw new Error("revoke: no unclaimed approval for that pub");
            state.revoked[pub] = { ...state.allow[pub], revokedAt: now, revokedBy: by, revocation: approval };
            delete state.allow[pub];
            return { revoked: pub };
        }
        if (op === "list") {
            return { allow: state.allow, pending: state.pending, ledger: state.ledger };
        }
        if (op === "audit") {
            const q = String(args.q || "").trim();
            const claims = q
                ? state.claims.filter(
                      (c) =>
                          c.pub === q ||
                          (c.leads || [c.lead]).some((l) => l && (q.startsWith(l) || l.startsWith(q)))
                  )
                : state.claims.slice(-50);
            const who = {};
            for (const c of claims) {
                const a = c.grant || state.allow[c.pub] || state.revoked[c.pub] || null;
                if (!who[c.pub] || c.grant) {
                    who[c.pub] = a
                        ? { memo: a.memo || null, ip: a.ip, note: a.note, addedAt: a.addedAt, by: a.by, revokedAt: a.revokedAt || null }
                        : null;
                }
            }
            return { q: q || null, claims, who };
        }
        if (op === "config") {
            const patch = {};
            if (args.perClaim != null) patch.perClaim = Math.max(1, Number(args.perClaim) || 1);
            await savePrefs(patch);
            return { perClaim: prefs.perClaim };
        }
        throw new Error(`unknown admin op '${op}' — allow|deny|revoke|list|audit|config`);
    };

    /** Requester ip / forwarding / user-agent never leave the distributor. */
    const SOURCE_FIELDS = new Set(["ip", "xff", "ua"]);
    const redactSource = (v) => {
        if (Array.isArray(v)) return v.map(redactSource);
        if (!v || typeof v !== "object") return v;
        const o = {};
        for (const [k, x] of Object.entries(v)) {
            if (!SOURCE_FIELDS.has(k)) o[k] = redactSource(x);
        }
        return o;
    };

    const onAdmin = async (body) => {
        const state = await loadState();
        const { env, p } = await openEnvelope(body, "admin", state);
        if (!prefs.peer?.pub || p.pub !== prefs.peer.pub) {
            await saveState(state);
            return { ok: false, error: "admin signer is not the linked approver" };
        }
        const out = redactSource(
            await applyAdmin(state, String(p.op || ""), p.args || {}, p.pub, {
                payload: env.payload,
                sig: env.sig,
            })
        );
        await saveState(state);
        if (p.op !== "list" && p.op !== "audit") {
            say(`admin ${p.op} by approver ${shortPub(p.pub)}${p.args?.memo ? ` — memo "${p.args.memo}"` : ""}`);
        }
        return { ok: true, op: p.op, ...out };
    };

    // ─── approver endpoint ────────────────────────────────────────────

    const onInbox = async (body) => {
        const state = await loadState();
        const { p } = await openEnvelope(body, "inbox", state);
        if (!prefs.peer?.pub || p.pub !== prefs.peer.pub) {
            await saveState(state);
            return { ok: false, error: "inbox sender is not the linked distributor" };
        }
        const req = p.request;
        let rp;
        try {
            rp = JSON.parse(req?.payload || "");
        } catch {
            rp = null;
        }
        if (
            !rp ||
            !(await verifySig(rp.pub, `${PREFIX.request}\n${req.payload}`, req.sig)) ||
            !(await verifyBind(rp, req.bind))
        ) {
            await saveState(state);
            return { ok: false, error: "forwarded request does not verify" };
        }
        state.inbox[p.id] = {
            id: p.id,
            pub: rp.pub,
            parent: rp.parent,
            label: rp.label,
            note: rp.note || "",
            from: p.from || null,
            at: new Date().toISOString(),
        };
        await saveState(state);
        say(
            `access request ${p.id} from key ${shortPub(rp.pub)}` +
                (rp.note ? ` — "${rp.note}"` : "") +
                `\n  approve: ${NAME} approve ${p.id.slice(0, 4)} [--count <n>] <memo: who is asking>` +
                `\n  deny:    ${NAME} deny ${p.id.slice(0, 4)}   (any unique start of the id works)`
        );
        return { ok: true, queued: p.id };
    };

    const sendAdmin = async (op, args = {}) => {
        if (!prefs.peer?.alias) throw new Error(`link a distributor first: ${NAME} link <alias>`);
        const { env } = await signEnvelope("admin", { op, args });
        return postJson(relayUrl(prefs.peer.alias, "admin"), env, peerHeaders());
    };

    // ─── shared: role / alias / link ─────────────────────────────────

    const pingBody = async () => {
        let pub = null;
        try {
            pub = (await identity()).publicKey;
        } catch {
            /* keychain not mounted */
        }
        return {
            ok: true,
            name: NAME,
            version: VERSION,
            role: prefs.role || "requester",
            alias: prefs.alias || null,
            pub,
        };
    };

    const link = async (aliasRaw, token) => {
        const alias = sanitizeAlias(aliasRaw);
        if (!alias) throw new Error(`usage: ${NAME} link <alias> [usageToken]`);
        const want = prefs.role === "distributor" ? "approver" : "distributor";
        const headers = token ? { "X-Navi-Shell-Usage-Token": token } : {};
        const ping = await getJson(relayUrl(alias, "ping"), headers);
        if (ping.name !== NAME) throw new Error(`navi-${alias} is not running ${NAME}`);
        if (ping.role !== want) {
            throw new Error(`navi-${alias} is role '${ping.role}', expected '${want}'`);
        }
        if (!ping.pub) throw new Error(`navi-${alias} has no keychain identity yet`);
        await savePrefs({ peer: { alias, pub: ping.pub, role: ping.role, token: token || "" } });
        return `linked ${want} navi-${alias} pub=${shortPub(ping.pub)} (pinned)`;
    };

    const aliasCheck = async () => {
        if (!prefs.alias) return "no alias set";
        const me = (await identity()).publicKey;
        try {
            const ping = await getJson(relayUrl(prefs.alias, "ping"));
            const same = ping.pub === me;
            return `navi-${prefs.alias} live role=${ping.role} ${same ? "✓ this navi" : "✗ different identity: " + shortPub(ping.pub)}`;
        } catch (e) {
            return `navi-${prefs.alias} not reachable: ${e.message || e}`;
        }
    };

    const setMintPassword = async (mode, arg) => {
        const m = String(mode || "").toLowerCase();
        let pw = "";
        if (m === "env") {
            const name = arg || "FOOBARCH_MINT_PASSWORD";
            pw = String((globalThis.process?.env || {})[name] || "");
            if (!pw) throw new Error(`env ${name} is empty`);
        } else if (m === "file") {
            if (typeof navi.require !== "function") throw new Error("password file needs a native navi");
            const file = arg || `${globalThis.process?.env?.HOME || "."}/token_distro.pw`;
            pw = String(navi.require("fs").readFileSync(file, "utf8")).trim();
            if (!pw) throw new Error(`${file} is empty`);
        } else if (m === "clear") {
            await navi.storage.item.set(MINT_KEY, "");
            return "mint password cleared";
        } else if (m === "status" || !m) {
            return (await readMintPassword()) ? "mint password set" : "mint password NOT set";
        } else {
            throw new Error(`usage: ${NAME} password env [VAR] | file <path> | clear | status`);
        }
        await navi.storage.item.set(MINT_KEY, pw);
        return "mint password stored (never returned over relay)";
    };

    const statusLocal = async () => {
        const lines = [
            `${NAME} v${VERSION}`,
            `role: ${prefs.role || "requester (no role set)"}`,
            `alias: ${prefs.alias || "-"}`,
        ];
        try {
            lines.push(`identity: ${(await identity()).publicKey}`);
        } catch (e) {
            lines.push(`identity: (${e.message || e})`);
        }
        if (prefs.role) {
            lines.push(
                `peer: ${prefs.peer ? `navi-${prefs.peer.alias} (${prefs.peer.role}) pub=${shortPub(prefs.peer.pub)}` : "- (link <alias>)"}`
            );
            lines.push(await gateText());
        }
        if (prefs.role === "distributor") {
            const s = await loadState();
            lines.push(
                `mint: ${normHost(prefs.mintHost)} password ${(await readMintPassword()) ? "set" : "NOT set"}`,
                `tokens per approval: ${prefs.perClaim}`,
                `approved (unclaimed): ${Object.keys(s.allow).length}  pending: ${Object.keys(s.pending).length}  claims: ${s.claims.length}`
            );
        } else if (prefs.role === "approver") {
            const s = await loadState();
            lines.push(`inbox: ${Object.keys(s.inbox).length}`);
        } else {
            lines.push(`endpoint: ${prefs.endpoint}`);
        }
        return lines.join("\n");
    };

    const HELP = [
        `${NAME} v${VERSION} — mint + distribute foobarch usage tokens to approved keychain identities`,
        "",
        "  role distributor|approver|requester   Pick this navi's party (first mount asks)",
        "  status                                Local summary",
        "  alias <name> | alias check            Assign / verify this navi's relay alias",
        "  advertise [days]                      relay advertise <alias> (default 365d)",
        "  link <alias> [usageToken]             Pin the peer (approver↔distributor) by ping pubkey",
        "  gate on|off|status|allow <p>|drop <p> Relay verb whitelist (distributor default ON)",
        "",
        "requester:",
        "  request [note…]                       Ask the approver for tokens (derived keychain key)",
        "  claim                                 Collect an approved request's tokens → tokens tip",
        "  whoami                                Pending? approved?",
        "  endpoint <url|navi-alias>             Where to reach the distributor",
        "",
        "approver:",
        "  inbox                                 Pending requests",
        "  approve <id> [--count <n>] <memo…>    One approval = one claim of n tokens (default perClaim, max 1000); memo is signed + kept",
        "  deny <id>                             Drop a pending request",
        "  revoke <pub>                          Withdraw an approval that hasn't been claimed yet",
        "  allowlist                             Approved-unclaimed + pending + ledger",
        "  audit [lead|pub]                      Claim records (16-hex mint lead → pub, memo; ip only on distributor)",
        "  config perClaim <n>                   Tokens minted per approval",
        "",
        "distributor:",
        "  password env [VAR] | file [path] (default $HOME/token_distro.pw) | clear | status",
        "  mint-host <url>   config perClaim <n>   allowlist   audit [lead|pub]",
    ].join("\n");

    const json = (o) => JSON.stringify(o, null, 2);

    const runEndpoint = async (verb, rest) => {
        const body = navi.callinRequest?.body;
        if (verb === "ping") return json(await pingBody());
        if (prefs.role === "distributor") {
            if (verb === "status") return json(await onStatus(rest[0]));
            if (verb === "request") return json(await onRequest(body));
            if (verb === "claim") return json(await onClaim(body));
            if (verb === "admin") return json(await onAdmin(body));
        }
        if (prefs.role === "approver" && verb === "inbox") return json(await onInbox(body));
        return json({ ok: false, error: `'${verb}' is not served by role '${prefs.role || "requester"}'` });
    };

    const run = async (...rawArgs) => {
        const args = rawArgs
            .flatMap((a) => String(a ?? "").split(/\s+/))
            .filter((a) => a.length);
        const verb = String(args[0] || "help").toLowerCase();
        const rest = args.slice(1);
        await loadPrefs();

        const viaRelay = !!navi.callinRequest?.viaRelay;
        const served = ENDPOINT_VERBS[prefs.role] || ENDPOINT_VERBS[""];
        if (viaRelay) {
            if (!served.includes(verb)) {
                return json({ ok: false, error: `'${verb}' is local-only` });
            }
            try {
                return await runEndpoint(verb, rest);
            } catch (e) {
                return json({ ok: false, error: String(e.message || e) });
            }
        }
        if (navi.callinRequest?.body && served.includes(verb) && verb !== "ping") {
            try {
                return await runEndpoint(verb, rest);
            } catch (e) {
                return json({ ok: false, error: String(e.message || e) });
            }
        }

        try {
            switch (verb) {
                case "help":
                case "-h":
                    return HELP;
                case "ping":
                    return json(await pingBody());
                case "status":
                    return await statusLocal();
                case "role": {
                    const r = String(rest[0] || "").toLowerCase();
                    if (!r) return `role: ${prefs.role || "requester"}`;
                    if (!["distributor", "approver", "requester"].includes(r)) {
                        return `usage: ${NAME} role distributor|approver|requester`;
                    }
                    const role = r === "requester" ? "" : r;
                    if (role !== prefs.role) await savePrefs({ role, peer: null });
                    await syncGate();
                    if (role) await identity();
                    return [
                        `role set: ${r}`,
                        role === "distributor"
                            ? `next: ${NAME} password file <path> · alias <name> · advertise · link <approver-alias>`
                            : role === "approver"
                              ? `next: ${NAME} alias <name> · advertise · link <distributor-alias>`
                              : `next: ${NAME} request <note> · claim`,
                        role ? await gateText() : "",
                    ]
                        .filter(Boolean)
                        .join("\n");
                }
                case "alias": {
                    const a = rest[0];
                    if (!a) return `alias: ${prefs.alias || "-"}`;
                    if (a.toLowerCase() === "check") return await aliasCheck();
                    const alias = sanitizeAlias(a);
                    if (!alias) return "alias must be [a-zA-Z0-9._-]+";
                    await savePrefs({ alias });
                    return `alias: ${alias} (advertise to publish, alias check to verify)`;
                }
                case "advertise": {
                    if (!prefs.alias) return `set alias first: ${NAME} alias <name>`;
                    const days = Math.max(1, Number(rest[0]) || 365);
                    const callin = typeof navi.callin === "function" ? navi.callin : navi.dispatchCallin;
                    const r = await callin.call(navi, `relay advertise ${prefs.alias} ${days * 86400}`);
                    return typeof r === "string" ? r : json(r);
                }
                case "link":
                    if (!prefs.role) return "requesters use `endpoint`, not link";
                    return await link(rest[0], rest[1]);
                case "unlink":
                    await savePrefs({ peer: null });
                    return "peer cleared";
                case "gate": {
                    const sub = String(rest[0] || "status").toLowerCase();
                    const g = { ...prefs.gate, extra: [...(prefs.gate.extra || [])] };
                    if (sub === "on") g.on = true;
                    else if (sub === "off") g.on = false;
                    else if (sub === "default") g.on = null;
                    else if (sub === "allow" && rest[1]) g.extra = [...new Set([...g.extra, normPath(rest[1])])];
                    else if (sub === "drop" && rest[1]) g.extra = g.extra.filter((x) => x !== normPath(rest[1]));
                    else if (sub !== "status") return `usage: ${NAME} gate on|off|default|status|allow <path>|drop <path>`;
                    if (sub !== "status") await savePrefs({ gate: g });
                    const wl = coreWhitelist();
                    if (wl && sub === "on") await wl.on();
                    if (wl && sub === "off") await wl.off();
                    await syncGate();
                    return await gateText();
                }
                case "endpoint": {
                    if (!rest[0]) return `endpoint: ${prefs.endpoint}`;
                    await savePrefs({ endpoint: rest[0] });
                    return `endpoint: ${prefs.endpoint}`;
                }
                case "request":
                    return json(await requestAccess(rest.join(" ")));
                case "claim":
                    return json(await claimTokens());
                case "whoami":
                    return json(await statusRemote());
                case "inbox": {
                    const s = await loadState();
                    const rows = Object.values(s.inbox);
                    if (!rows.length) return "(inbox empty)";
                    const ids = rows.map((r) => r.id);
                    return [
                        ...rows.map(
                            (r) =>
                                `request ${shortestPrefix(r.id, ids)}  (${r.at})\n` +
                                `  from key ${shortPub(r.pub)}\n` +
                                `  note: ${r.note ? `"${r.note}"` : "(none)"}`
                        ),
                        "",
                        `approve <id> <memo…>   deny <id>   — any unique start of the id works`,
                    ].join("\n");
                }
                case "approve":
                case "deny":
                case "revoke": {
                    const key = rest[0];
                    let countArg = null;
                    const memoWords = [];
                    for (let i = 1; i < rest.length; i++) {
                        const a = rest[i];
                        const eq = /^--count=(.*)$/i.exec(a);
                        if (verb === "approve" && (eq || /^(--count|-n)$/i.test(a))) {
                            const v = eq ? eq[1] : rest[++i];
                            if (!/^\d+$/.test(v || "")) return `--count needs a whole number 1..${MAX_PER_APPROVAL}`;
                            countArg = Number(v);
                        } else {
                            memoWords.push(a);
                        }
                    }
                    const memo = memoWords.join(" ").trim();
                    if (!key || (verb === "approve" && !memo)) {
                        return verb === "approve"
                            ? `usage: ${NAME} approve <id|pub> [--count <n>] <memo: who is asking, kept signed at the distributor>`
                            : `usage: ${NAME} ${verb} <id|pub>`;
                    }
                    if (countArg != null && (countArg < 1 || countArg > MAX_PER_APPROVAL)) {
                        return `count must be 1..${MAX_PER_APPROVAL} (default ${prefs.perClaim})`;
                    }
                    const op = verb === "approve" ? "allow" : verb;
                    let id = null;
                    if (verb !== "revoke") {
                        const s = await loadState();
                        const pool = Object.keys(prefs.role === "distributor" ? s.pending : s.inbox);
                        const hits = pool.filter((x) => x.startsWith(key.toLowerCase()));
                        if (hits.length > 1) return `'${key}' matches ${hits.length} requests (${hits.join(", ")}) — type more of the id`;
                        if (hits.length === 1) id = hits[0];
                        else if (/^[0-9a-f]{12}$/i.test(key)) id = key.toLowerCase();
                        else if (!PUB_RE.test(key)) return `no request id starting with '${key}' — see ${NAME} inbox`;
                    } else if (!PUB_RE.test(key)) {
                        return `revoke needs the full public key (43 chars) — see ${NAME} allowlist`;
                    }
                    const isId = !!id;
                    const argsOut = isId ? { id } : { pub: key };
                    if (verb === "approve") argsOut.memo = memo.slice(0, 280);
                    if (countArg != null) argsOut.count = countArg;
                    if (prefs.role === "distributor") {
                        const s = await loadState();
                        const out = await applyAdmin(s, op, argsOut, "local");
                        await saveState(s);
                        return json(out);
                    }
                    const out = await sendAdmin(op, argsOut);
                    if (isId) {
                        const s = await loadState();
                        delete s.inbox[id];
                        await saveState(s);
                    }
                    return json(out);
                }
                case "allowlist": {
                    if (prefs.role === "distributor") {
                        const s = await loadState();
                        return json(await applyAdmin(s, "list", {}, "local"));
                    }
                    return json(await sendAdmin("list"));
                }
                case "audit": {
                    const argsOut = { q: rest[0] || "" };
                    if (prefs.role === "distributor") {
                        const s = await loadState();
                        return json(await applyAdmin(s, "audit", argsOut, "local"));
                    }
                    if (prefs.role !== "approver") return "audit is distributor/approver-only";
                    return json(await sendAdmin("audit", argsOut));
                }
                case "config": {
                    const argsOut = {};
                    for (let i = 0; i < rest.length; i += 2) {
                        const k = String(rest[i] || "").toLowerCase();
                        if (k === "perclaim") argsOut.perClaim = Number(rest[i + 1]);
                    }
                    if (!Object.keys(argsOut).length) return `usage: ${NAME} config perClaim <n>`;
                    if (prefs.role === "distributor") {
                        const s = await loadState();
                        return json(await applyAdmin(s, "config", argsOut, "local"));
                    }
                    return json(await sendAdmin("config", argsOut));
                }
                case "password": {
                    if (prefs.role !== "distributor") return "password is distributor-only";
                    // Callin paths split on "/" — rejoin file path segments.
                    const tail = rest.slice(1);
                    let arg = tail[0];
                    if (String(rest[0]).toLowerCase() === "file" && tail.length) {
                        arg = tail.join("/");
                        if (!/^[A-Za-z]:|^\.{1,2}$|^~/.test(tail[0])) arg = "/" + arg;
                    }
                    return await setMintPassword(rest[0], arg);
                }
                case "mint-host": {
                    if (!rest[0]) return `mint-host: ${prefs.mintHost}`;
                    await savePrefs({ mintHost: normHost(rest[0]) });
                    return `mint-host: ${prefs.mintHost}`;
                }
                default:
                    return `unknown: ${verb}\n\n${HELP}`;
            }
        } catch (e) {
            return `error: ${e.message || e}`;
        }
    };

    const svc = {
        identity,
        requestAccess,
        claimTokens,
        status: statusRemote,
        prefs: () => ({ ...prefs, peer: prefs.peer ? { ...prefs.peer, token: prefs.peer.token ? "(set)" : "" } : null }),
    };

    return {
        name: NAME,
        version: VERSION,
        description: "Mint + distribute foobarch usage tokens to approved keychain identities",

        moduleInfo: {
            name: NAME,
            version: VERSION,
            description:
                "Roles distributor|approver|requester; relay gate wraps dispatchCallin; keychain-derived identities",
        },

        commands: {
            [NAME]: {
                name: NAME,
                methods: ["GET", "POST"],
                description: `${NAME} role|status|request|claim|approve|… (help)`,
                execute: async (...args) => run(...args),
            },
        },

        distro: svc,

        onMount: async () => {
            await loadPrefs();
            await syncGate();
            if (!prefs.role) {
                timers.push(
                    setTimeout(() => {
                        say(
                            `mounted v${VERSION} as requester. Running the distro? pick a party:\n` +
                                `  ${NAME} role distributor   (mints; relay whitelist ON)\n` +
                                `  ${NAME} role approver      (desktop; receives access requests)\n` +
                                `  requesters: ${NAME} request <note>  then  ${NAME} claim`
                        );
                    }, 0)
                );
            } else {
                console.log(
                    `[${NAME}] ready v${VERSION} — role ${prefs.role}, ${await gateText()}`
                );
            }
        },

        onUnmount: () => {
            removeGate();
            coreWhitelist()?.remove(NAME);
            for (const t of timers) clearTimeout(t);
            timers.length = 0;
        },
    };
};
