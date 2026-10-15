/**
 * sprinter_server — sprinter: "we proudly bring you version S"
 *
 * Fast lane for scranton_lobby_v1 lobbies. The hostpark park `sprinter` relays
 * every /sprinter/… request to this mod (navi park sprinter_server/…) on a relayed navi, so lobby reads and
 * writes never touch foobarch tip storage, frame history, or usage tokens.
 * This mod is the authority: it checks proposal-write-v1 signatures, whitelists the
 * whole create frame against the client template, and whitelists every mut8 against
 * its parent with the same rules as C_devops/scranton/lobby_v1_schema.lua.
 *
 * Relay (public, via https://<host>/sprinter/…):
 *   GET  /sprinter                              { ok, name, version, tagline, lobbies }
 *   GET  /sprinter/scranton/lobby/v1/{path}     { ib, addr, tombstone, frame }  | { ok:false, status:404 }
 *   POST /sprinter/scranton/lobby/v1/{path}     body = firstGen|mut8 envelope, signed headers → { ok, addr }
 *
 * eoas — live element registers keyed by data-hash (written by sprinter_client):
 *   GET  /sprinter/eoas/{hash}                  the element's raw HTML (served as text/plain)
 *   GET  /sprinter/eoas/{hash}/state            { hash, owner, rev, attrs, watch, deadzone, tag, … }
 *   GET  /sprinter/eoas/{hash}/{prop}           { ok, hash, prop, value } — record field, else attribute
 *   GET  /sprinter/eoas/{hash}/attrs/{name}     { ok, hash, prop, value }
 *   POST /sprinter/eoas                         { check: [{ hash, attrs }] } → { results: { hash: { stale, changed, attrs } } }
 *   POST /sprinter/eoas/{hash}/check            { attrs } → { registered, stale, changed, attrs }
 *   POST /sprinter/eoas/{hash}                  { v:1, hash, rev, html, attrs, watch?, deadzone?, tag? } signed;
 *                                               rev 0 registers (signer owns it), rev n+1 updates (owner only)
 *   POST /sprinter/eoas/{hash}/drop             { v:1, hash, drop:true, rev } signed by the owner
 *   Stale = a watched attribute differs from the record, beyond its deadzone when both values are numbers.
 *
 * Local:
 *   sprinter_server status | list | drop <path> | eoas list|show|drop <hash> | help
 */

export const register = (navi) => {
    const NAME = "sprinter_server";
    const VERSION = "1.2.0";
    const TAGLINE = "we proudly bring you version S";
    const ALIAS = "sprinter";
    const CONTRACT = "scranton_lobby_v1";
    const LOBBY_ROOT = "scranton/lobby/v1";
    const STATE_KEY = "sprinter.lobbies";
    const WRITE_PREFIX = "proposal-write-v1";
    const MAX_BODY = 256 * 1024;

    /** @type {Record<string, { addr: string, frame: any, at: string }>} */
    let lobbies = {};
    let loaded = false;
    let chain = Promise.resolve();

    const subtle = () => {
        const c = globalThis.crypto;
        if (!c?.subtle) throw new Error("WebCrypto subtle unavailable");
        return c.subtle;
    };

    const sha256Hex = async (s) => {
        const dig = await subtle().digest("SHA-256", new TextEncoder().encode(String(s ?? "")));
        return Array.from(new Uint8Array(dig))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
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

    const verifyEd25519 = async (publicKey, message, signature) => {
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
                b64urlToBytes(signature),
                new TextEncoder().encode(String(message))
            );
        } catch {
            return false;
        }
    };

    const header = (headers, name) => {
        if (!headers || typeof headers !== "object") return "";
        const want = name.toLowerCase();
        for (const [k, v] of Object.entries(headers)) {
            if (String(k).toLowerCase() === want) return Array.isArray(v) ? String(v[0] ?? "") : String(v ?? "");
        }
        return "";
    };

    const splitList = (s) =>
        String(s || "")
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean);

    /** First signer whose signature over the write message verifies. */
    const verifiedSigner = async (headers, message) => {
        const keys = splitList(header(headers, "x-foobarch-sign-keys") || header(headers, "x-flowerpot-sign-keys"));
        const sigs = splitList(header(headers, "x-foobarch-signatures") || header(headers, "x-flowerpot-signatures"));
        for (let i = 0; i < Math.min(keys.length, sigs.length); i++) {
            if (await verifyEd25519(keys[i], message, sigs[i])) return keys[i];
        }
        return null;
    };

    const json = (o) => JSON.stringify(o);
    const fail = (status, error) => json({ ok: false, status, error });

    async function load() {
        if (loaded) return;
        const raw = await navi.storage.item.get(STATE_KEY);
        lobbies = raw && typeof raw === "object" ? raw : {};
        loaded = true;
    }

    async function save() {
        await navi.storage.item.set(STATE_KEY, lobbies);
    }

    /** Serialize writes so concurrent mut8s see each other's addr. */
    const serial = (fn) => {
        const run = chain.then(fn, fn);
        chain = run.catch(() => {});
        return run;
    };

    // ─── lobby rules (mirror of lobby_v1_schema.lua) ────────────────────

    const POLICY_IB = `${LOBBY_ROOT}/policy`;
    const ADDR_MAX = 512;
    const SHORT_MAX = 64;
    /** Every key of a new lobby frame except data.lobby and data.timestamp, exactly as the client builds it. */
    const CREATE_DATA = {
        parts: ["network_proposal", "ibgib_frame", "manifest", "json"],
        park: "defer",
        contract: CONTRACT,
        about: { label: CONTRACT, description: "Scranton lobby v1 — roster + append ib^gib index" },
        default_method: "GET",
        method: { GET: { kind: "frame" }, PUT: { kind: "commit" }, PATCH: { kind: "commit" } },
        n: 0,
    };
    const CREATE_REL8NS = { policy: [POLICY_IB], past: [], tjp: [], dna: [] };

    const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
    const deepEqual = (a, b) => {
        if (a === b) return true;
        if (Array.isArray(a) !== Array.isArray(b) || !a || !b || typeof a !== "object" || typeof b !== "object") return false;
        const ka = Object.keys(a);
        const kb = Object.keys(b);
        return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]));
    };
    const without = (o, drop) => Object.fromEntries(Object.entries(isObj(o) ? o : {}).filter(([k]) => !drop.includes(k)));
    const extraKey = (o, allowed) => Object.keys(o).find((k) => !allowed.includes(k));
    const shortString = (v) => typeof v === "string" && v.length <= SHORT_MAX;

    const opOf = (l) => String(l?.creator || l?.op || "");
    const rosterKeys = (r) => (isObj(r) ? Object.keys(r).filter(Boolean).sort() : []);

    function checkRow(row) {
        if (!isObj(row)) return "append row must be an object";
        const bad = extraKey(row, ["addr", "by", "at"]);
        if (bad) return `append row field not allowed: ${bad}`;
        if (typeof row.addr !== "string" || row.addr.length > ADDR_MAX || !/^[^\s^]+\^[^\s^]+$/.test(row.addr)) {
            return "append addr must be ib^gib";
        }
        if (typeof row.by !== "string" || !row.by || row.by.length > ADDR_MAX) return "append row needs by";
        if (!shortString(row.at)) return "append row at must be a short string";
        return null;
    }

    function checkEntry(entry) {
        if (!isObj(entry)) return "roster entry required";
        const bad = extraKey(entry, ["joined_at", "ts"]);
        if (bad) return `roster entry field not allowed: ${bad}`;
        if (!shortString(entry.joined_at)) return "roster entry needs joined_at";
        if (typeof entry.ts !== "number" && !shortString(entry.ts)) return "roster entry needs ts";
        return null;
    }

    function checkCreate(ib, signer, frame) {
        const data = frame.data;
        if (!deepEqual(without(data, ["lobby", "timestamp"]), CREATE_DATA)) {
            return "new lobby data must match the scranton_lobby_v1 template";
        }
        if (!shortString(data.timestamp)) return "data.timestamp must be a short string";
        if (!deepEqual(frame.rel8ns, CREATE_REL8NS)) return `new lobby rel8ns must be exactly { policy: [${POLICY_IB}] }`;
        const l = data.lobby;
        const bad = extraKey(l, ["contract", "path", "created_at", "creator", "roster", "append"]);
        if (bad) return `lobby field not allowed: ${bad}`;
        if (l.contract !== CONTRACT) return `contract must be ${CONTRACT}`;
        if (`${ALIAS}/${LOBBY_ROOT}/${l.path}` !== ib) return "lobby.path must match the address";
        if (!shortString(l.created_at)) return "lobby.created_at must be a short string";
        if (l.creator !== signer) return "creator must be the signer";
        const keys = rosterKeys(l.roster);
        if (!isObj(l.roster) || keys.length !== 1 || keys[0] !== signer) return "new lobby roster must be just the creator";
        const entryErr = checkEntry(l.roster[signer]);
        if (entryErr) return entryErr;
        if (!Array.isArray(l.append) || l.append.length) return "new lobby append must be empty";
        return null;
    }

    function checkRoster(signer, prev, next) {
        const pr = isObj(prev.roster) ? prev.roster : {};
        const nr = next.roster;
        const added = [];
        for (const k of rosterKeys(nr)) {
            if (!Object.hasOwn(pr, k)) added.push(k);
            else if (!deepEqual(pr[k], nr[k])) return "existing roster entries may not change";
        }
        const removed = rosterKeys(pr).filter((k) => !Object.hasOwn(nr, k));
        if (added.length === 1 && !removed.length) {
            if (added[0] !== signer) return "join must be signed by the joining pubkey";
            return checkEntry(nr[added[0]]);
        }
        if (!added.length && removed.length === 1) {
            if (removed[0] === signer || signer === opOf(prev)) return null;
            return "only self (leave) or OP (kick) may remove a pubkey";
        }
        return "illegal roster diff (join one / leave-or-kick one only)";
    }

    function checkAppend(signer, prev, next) {
        const pa = Array.isArray(prev.append) ? prev.append : [];
        const na = next.append;
        const op = opOf(prev);
        if (na.length === pa.length + 1) {
            if (!pa.every((r, i) => deepEqual(r, na[i]))) return "append push must keep prior rows intact";
            const row = na[na.length - 1];
            const err = checkRow(row);
            if (err) return err;
            return row.by === signer ? null : "append push by must equal signer";
        }
        if (na.length === pa.length - 1) {
            let j = 0;
            let removed = null;
            for (const r of pa) {
                if (j < na.length && deepEqual(na[j], r)) j++;
                else if (removed) return "append delete must remove exactly one row";
                else removed = r;
            }
            if (!removed || j !== na.length) return "append delete mismatch";
            return removed.by === signer || signer === op ? null : "only row author or lobby OP may delete append row";
        }
        if (na.length === pa.length && na.length) {
            const changed = pa.map((r, i) => (deepEqual(r, na[i]) ? -1 : i)).filter((i) => i >= 0);
            if (changed.length !== 1) return changed.length ? "append update must change exactly one row" : "no append change";
            const i = changed[0];
            const err = checkRow(na[i]);
            if (err) return err;
            if (pa[i].by !== na[i].by) return "append row by is immutable";
            return pa[i].by === signer || signer === op ? null : "only row author or lobby OP may update append row";
        }
        return "illegal append diff (push one / delete one / update one)";
    }

    /** Whole-frame whitelist against the parent; mirror of lobby_v1_schema.lua authorize(). */
    function checkMut8(signer, prevFrame, frame, parentAddr) {
        const frozen = ["lobby", "n", "timestamp"];
        if (!deepEqual(without(prevFrame.data, frozen), without(frame.data, frozen))) {
            return "only data.lobby, data.n and data.timestamp may change";
        }
        if (frame.data.n !== Number(prevFrame.data.n || 0) + 1) return "data.n must be parent n + 1";
        if (!shortString(frame.data.timestamp)) return "data.timestamp must be a short string";
        if (!deepEqual(without(prevFrame.rel8ns, ["past"]), without(frame.rel8ns, ["past"]))) {
            return "only rel8ns.past may change";
        }
        if (!deepEqual(frame.rel8ns?.past, [parentAddr])) return "rel8ns.past must be exactly the parent addr";

        const prev = prevFrame.data.lobby;
        const next = frame.data.lobby;
        if (next.contract !== CONTRACT) return `contract must be ${CONTRACT}`;
        const fixed = ["roster", "append", "op", "creator"];
        if (!deepEqual(without(prev, fixed), without(next, fixed))) {
            return "only data.lobby.roster or data.lobby.append may change";
        }
        if (!opOf(prev) || opOf(prev) !== opOf(next)) return "creator immutable";
        if (next.op !== undefined && next.op !== prev.op) return "creator immutable";
        if (!isObj(next.roster) || !Array.isArray(next.append)) return "lobby.roster and lobby.append required";

        const rosterChanged = !deepEqual(isObj(prev.roster) ? prev.roster : {}, next.roster);
        const appendChanged = !deepEqual(Array.isArray(prev.append) ? prev.append : [], next.append);
        if (rosterChanged && appendChanged) return "mut8 must change roster or append, not both";
        if (!rosterChanged && !appendChanged) return "no lobby change";
        return rosterChanged ? checkRoster(signer, prev, next) : checkAppend(signer, prev, next);
    }

    // ─── relay endpoints ────────────────────────────────────────────────

    function lobbyIbFromArgs(args) {
        const rest = args.join("/");
        if (!rest.startsWith(LOBBY_ROOT + "/") || rest.length <= LOBBY_ROOT.length + 1) return null;
        if (rest.split("/").some((seg) => !seg || seg === "." || seg === "..")) return null;
        return `${ALIAS}/${rest}`;
    }

    async function onGet(ib) {
        await load();
        const row = lobbies[ib];
        if (!row) return fail(404, `no lobby at ${ib}`);
        return json({ ib, addr: row.addr, tombstone: false, frame: row.frame });
    }

    async function onPost(ib, req) {
        const body = String(req?.body ?? "");
        if (!body) return fail(400, "empty body");
        if (body.length > MAX_BODY) return fail(413, "body too large");
        let env;
        try {
            env = JSON.parse(body);
        } catch {
            return fail(400, "body not JSON");
        }
        const frame = env?.newIbGib;
        if (!isObj(frame)) return fail(400, "missing newIbGib");
        const frameExtra = extraKey(frame, ["ib", "gib", "data", "rel8ns"]);
        if (frameExtra) return fail(400, `newIbGib field not allowed: ${frameExtra}`);
        if (frame.ib !== ib) return fail(400, "newIbGib.ib must match the address");
        if (!isObj(frame.data) || !isObj(frame.data.lobby)) return fail(400, "newIbGib.data.lobby required");
        if (!isObj(frame.rel8ns)) return fail(400, "newIbGib.rel8ns required");
        if (String(frame.gib || "") !== (await sha256Hex(JSON.stringify(frame.data))).toUpperCase()) {
            return fail(400, "gib must be sha256 of data");
        }

        return serial(async () => {
            await load();
            const cur = lobbies[ib] || null;
            const parentAddr = String(frame.rel8ns?.past?.[0] || "");
            const transform = String(env.transform || "");
            if (transform === "firstGen") {
                if (cur) return fail(409, `lobby already exists: ${ib}`);
                if (parentAddr) return fail(400, "firstGen must not name a past");
            } else if (transform === "mut8") {
                if (!cur) return fail(404, `no lobby at ${ib}`);
                if (parentAddr !== cur.addr) return fail(409, "stale parent — refresh and retry");
            } else {
                return fail(400, "transform must be firstGen or mut8");
            }

            const message = [WRITE_PREFIX, ib, parentAddr, await sha256Hex(body), "application/json"].join("\n");
            const signer = await verifiedSigner(req?.headers, message);
            if (!signer) return fail(401, "no valid proposal-write-v1 signature");

            const err = cur ? checkMut8(signer, cur.frame, frame, parentAddr) : checkCreate(ib, signer, frame);
            if (err) return fail(403, err);

            const addr = `${ib}^${frame.gib}`;
            lobbies[ib] = { addr, frame, at: new Date().toISOString() };
            await save();
            return json({ ok: true, addr, ib, transform });
        });
    }

    // ─── eoas: live element records keyed by data-hash ──────────────────

    const EOAS = "eoas";
    const EOAS_INDEX_KEY = "sprinter.eoas.index";
    const eoasKey = (hash) => `sprinter.eoas.${hash}`;
    const eoasIb = (hash) => `${ALIAS}/${EOAS}/${hash}`;
    const EOAS_MAX_HTML = 64 * 1024;
    const EOAS_MAX_ATTRS = 64;
    const EOAS_MAX_VALUE = 4096;
    const EOAS_MAX_CHECK = 64;
    const EOAS_MAX_RECORDS = 2000;
    const HASH_RE = /^[A-Za-z0-9._-]{4,128}$/;
    const ATTR_RE = /^[A-Za-z_:][-A-Za-z0-9_.:]{0,127}$/;
    const EOAS_PROPS = ["hash", "owner", "rev", "attrs", "watch", "deadzone", "tag", "created_at", "updated_at", "html"];
    const WRITE_FIELDS = ["v", "hash", "rev", "html", "attrs", "watch", "deadzone", "tag"];

    /** @type {Set<string>|null} */
    let eoasIndex = null;
    /** @type {Map<string, any>} */
    const eoasCache = new Map();

    async function loadEoasIndex() {
        if (eoasIndex) return eoasIndex;
        const raw = await navi.storage.item.get(EOAS_INDEX_KEY);
        eoasIndex = new Set(Array.isArray(raw) ? raw.filter((h) => HASH_RE.test(String(h))) : []);
        return eoasIndex;
    }

    async function getRecord(hash) {
        if (!(await loadEoasIndex()).has(hash)) return null;
        if (!eoasCache.has(hash)) eoasCache.set(hash, (await navi.storage.item.get(eoasKey(hash))) || null);
        return eoasCache.get(hash);
    }

    async function putRecord(rec) {
        const index = await loadEoasIndex();
        eoasCache.set(rec.hash, rec);
        await navi.storage.item.set(eoasKey(rec.hash), rec);
        if (!index.has(rec.hash)) {
            index.add(rec.hash);
            await navi.storage.item.set(EOAS_INDEX_KEY, [...index]);
        }
    }

    async function dropRecord(hash) {
        const index = await loadEoasIndex();
        eoasCache.delete(hash);
        index.delete(hash);
        await navi.storage.item.set(EOAS_INDEX_KEY, [...index]);
        if (typeof navi.storage.item.del === "function") await navi.storage.item.del(eoasKey(hash));
        else await navi.storage.item.set(eoasKey(hash), null);
    }

    function cleanAttrs(raw) {
        if (!isObj(raw)) return { error: "attrs must be an object" };
        const keys = Object.keys(raw);
        if (keys.length > EOAS_MAX_ATTRS) return { error: `at most ${EOAS_MAX_ATTRS} attrs` };
        const attrs = {};
        for (const k of keys) {
            if (!ATTR_RE.test(k)) return { error: `bad attribute name: ${k.slice(0, 64)}` };
            const v = raw[k];
            if (typeof v !== "string" || v.length > EOAS_MAX_VALUE) return { error: `attr ${k} must be a string ≤ ${EOAS_MAX_VALUE}` };
            attrs[k] = v;
        }
        return { attrs };
    }

    /** null = every recorded attribute matters. */
    function cleanWatch(raw) {
        if (raw == null) return { watch: null };
        if (!Array.isArray(raw) || raw.length > EOAS_MAX_ATTRS || raw.some((n) => typeof n !== "string" || !ATTR_RE.test(n))) {
            return { error: "watch must be a list of attribute names" };
        }
        return { watch: raw.length ? [...new Set(raw)] : null };
    }

    function cleanDeadzone(raw) {
        if (raw == null) return { deadzone: {} };
        if (!isObj(raw) || Object.keys(raw).length > EOAS_MAX_ATTRS) return { error: "deadzone must be { attr: number }" };
        const deadzone = {};
        for (const [k, v] of Object.entries(raw)) {
            if (!ATTR_RE.test(k) || typeof v !== "number" || !Number.isFinite(v) || v < 0) {
                return { error: `deadzone ${k.slice(0, 64)} must be a number ≥ 0` };
            }
            deadzone[k] = v;
        }
        return { deadzone };
    }

    /** Watched attributes where the caller's value is off the record (outside any deadzone). */
    function changedAgainst(rec, attrs) {
        const have = isObj(attrs) ? attrs : {};
        const names = rec.watch || Object.keys(rec.attrs);
        const changed = [];
        for (const n of names) {
            if (!Object.hasOwn(rec.attrs, n)) continue;
            const want = rec.attrs[n];
            const got = have[n];
            if (got === want) continue;
            const dz = rec.deadzone?.[n];
            if (dz != null && got != null) {
                const a = Number(got);
                const b = Number(want);
                if (got !== "" && want !== "" && Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= dz) continue;
            }
            changed.push(n);
        }
        return changed;
    }

    async function checkOne(hash, attrs) {
        const rec = HASH_RE.test(String(hash)) ? await getRecord(hash) : null;
        if (!rec) return { hash, registered: false };
        const changed = changedAgainst(rec, attrs);
        return {
            hash,
            registered: true,
            rev: rec.rev,
            stale: changed.length > 0,
            changed,
            attrs: Object.fromEntries(changed.map((n) => [n, rec.attrs[n]])),
        };
    }

    const parseBody = (req) => {
        const body = String(req?.body ?? "");
        if (!body) return { error: fail(400, "empty body") };
        if (body.length > MAX_BODY) return { error: fail(413, "body too large") };
        try {
            return { body, value: JSON.parse(body) };
        } catch {
            return { error: fail(400, "body not JSON") };
        }
    };

    /** POST /sprinter/eoas  { check: [{ hash, attrs }] } — which of these have a register, and are they stale? */
    async function eoasCheck(req) {
        const p = parseBody(req);
        if (p.error) return p.error;
        const list = p.value?.check;
        if (!Array.isArray(list) || list.length > EOAS_MAX_CHECK) return fail(400, `check must be a list of ≤ ${EOAS_MAX_CHECK} { hash, attrs }`);
        const results = {};
        for (const item of list) {
            const hash = String(item?.hash || "");
            if (!HASH_RE.test(hash)) continue;
            const r = await checkOne(hash, item?.attrs);
            if (r.registered) results[hash] = r;
        }
        return json({ ok: true, results });
    }

    /** POST /sprinter/eoas/{hash}  — register (rev 0) or update (rev n+1); the first signer owns it. */
    async function eoasWrite(hash, req) {
        const p = parseBody(req);
        if (p.error) return p.error;
        const env = p.value;
        if (!isObj(env)) return fail(400, "body must be an object");
        const extra = extraKey(env, WRITE_FIELDS);
        if (extra) return fail(400, `field not allowed: ${extra}`);
        if (env.v !== 1) return fail(400, "v must be 1");
        if (env.hash !== hash) return fail(400, "hash must match the address");
        if (!Number.isInteger(env.rev) || env.rev < 0) return fail(400, "rev must be an integer ≥ 0");
        if (typeof env.html !== "string" || env.html.length > EOAS_MAX_HTML) return fail(400, `html must be a string ≤ ${EOAS_MAX_HTML}`);
        if (env.tag != null && !shortString(env.tag)) return fail(400, "tag must be a short string");
        const a = cleanAttrs(env.attrs);
        if (a.error) return fail(400, a.error);
        const w = cleanWatch(env.watch);
        if (w.error) return fail(400, w.error);
        const d = cleanDeadzone(env.deadzone);
        if (d.error) return fail(400, d.error);

        return serial(async () => {
            const cur = await getRecord(hash);
            const wantRev = cur ? cur.rev + 1 : 0;
            if (env.rev !== wantRev) return json({ ok: false, status: 409, error: `stale rev — expected ${wantRev}`, rev: cur ? cur.rev : -1 });
            const message = [WRITE_PREFIX, eoasIb(hash), "", await sha256Hex(p.body), "application/json"].join("\n");
            const signer = await verifiedSigner(req?.headers, message);
            if (!signer) return fail(401, "no valid proposal-write-v1 signature");
            if (cur && cur.owner !== signer) return fail(403, "only the key that registered this element may update it");
            if (!cur && (await loadEoasIndex()).size >= EOAS_MAX_RECORDS) return fail(507, "sprinter eoas is full");
            const now = new Date().toISOString();
            const rec = {
                hash,
                owner: signer,
                rev: wantRev,
                html: env.html,
                attrs: a.attrs,
                watch: env.watch === undefined && cur ? cur.watch : w.watch,
                deadzone: env.deadzone === undefined && cur ? cur.deadzone : d.deadzone,
                tag: env.tag != null ? env.tag : cur?.tag || "",
                created_at: cur?.created_at || now,
                updated_at: now,
            };
            await putRecord(rec);
            return json({ ok: true, hash, rev: rec.rev, ib: eoasIb(hash) });
        });
    }

    /** POST /sprinter/eoas/{hash}/drop  { v: 1, hash, drop: true, rev } signed by the owner. */
    async function eoasDrop(hash, req) {
        const p = parseBody(req);
        if (p.error) return p.error;
        const env = p.value;
        if (!isObj(env) || extraKey(env, ["v", "hash", "drop", "rev"]) || env.v !== 1 || env.hash !== hash || env.drop !== true) {
            return fail(400, "drop body must be { v: 1, hash, drop: true, rev }");
        }
        return serial(async () => {
            const cur = await getRecord(hash);
            if (!cur) return fail(404, `no register for ${hash}`);
            if (env.rev !== cur.rev) return json({ ok: false, status: 409, error: `stale rev — expected ${cur.rev}`, rev: cur.rev });
            const message = [WRITE_PREFIX, `${eoasIb(hash)}/drop`, "", await sha256Hex(p.body), "application/json"].join("\n");
            const signer = await verifiedSigner(req?.headers, message);
            if (!signer) return fail(401, "no valid proposal-write-v1 signature");
            if (signer !== cur.owner) return fail(403, "only the key that registered this element may drop it");
            await dropRecord(hash);
            return json({ ok: true, hash, dropped: true });
        });
    }

    async function eoasRelay(args, req, method) {
        if (!args.length) {
            if (method === "POST") return eoasCheck(req);
            return json({ ok: true, name: `${ALIAS}/${EOAS}`, version: VERSION, records: (await loadEoasIndex()).size });
        }
        const hash = args[0];
        if (!HASH_RE.test(hash)) return fail(400, "bad data-hash");
        const rest = args.slice(1);
        if (method === "POST") {
            if (!rest.length) return eoasWrite(hash, req);
            if (rest.length === 1 && rest[0] === "check") {
                const p = parseBody(req);
                if (p.error) return p.error;
                return json({ ok: true, ...(await checkOne(hash, p.value?.attrs)) });
            }
            if (rest.length === 1 && rest[0] === "drop") return eoasDrop(hash, req);
            return fail(404, "POST eoas/{hash}[/check|/drop]");
        }
        if (method !== "GET" && method !== "HEAD") return fail(405, `${method} not served`);
        const rec = await getRecord(hash);
        if (!rec) return fail(404, `no register for ${hash}`);
        // Raw element HTML as text: anyone may register markup, so it never renders on this origin.
        if (!rest.length) return { media: rec.html, mime: "text/plain; charset=utf-8" };
        if (rest.length === 1 && rest[0] === "state") return json({ ok: true, ...without(rec, ["html"]) });
        const prop = rest[0];
        if (rest.length === 2 && prop === "attrs") {
            if (!Object.hasOwn(rec.attrs, rest[1])) return fail(404, `no attr ${rest[1]} on ${hash}`);
            return json({ ok: true, hash, prop: rest[1], value: rec.attrs[rest[1]] });
        }
        if (rest.length !== 1) return fail(404, "GET eoas/{hash}[/state|/{prop}|/attrs/{name}]");
        if (EOAS_PROPS.includes(prop)) return json({ ok: true, hash, prop, value: rec[prop] });
        if (Object.hasOwn(rec.attrs, prop)) return json({ ok: true, hash, prop, value: rec.attrs[prop] });
        return fail(404, `no prop ${prop} on ${hash}`);
    }

    async function relay(args) {
        const req = navi.callinRequest || {};
        const method = String(req.method || "GET").toUpperCase();
        if (args[0] === EOAS) return eoasRelay(args.slice(1), req, method);
        if (!args.length) {
            await load();
            return json({ ok: true, name: ALIAS, version: VERSION, tagline: TAGLINE, lobbies: Object.keys(lobbies).length });
        }
        const ib = lobbyIbFromArgs(args);
        if (!ib) return fail(404, `sprinter serves ${LOBBY_ROOT}/{path}`);
        if (method === "GET" || method === "HEAD") return onGet(ib);
        if (method === "POST") return onPost(ib, req);
        return fail(405, `${method} not served`);
    }

    // ─── local operator commands ────────────────────────────────────────

    const HELP = [
        `${NAME} v${VERSION} — ${ALIAS}: ${TAGLINE}`,
        "",
        `  Serves ${LOBBY_ROOT}/{path} lobbies to the hostpark park '${ALIAS}' (relay).`,
        "",
        "  status          lobby count",
        "  list            lobby addresses",
        "  drop <path>     delete a lobby (operator)",
        "",
        `  Serves ${EOAS}/{data-hash} element registers (sprinter_client).`,
        "",
        "  eoas list               registered hashes",
        "  eoas show <hash>        one record (without html)",
        "  eoas drop <hash>        delete a register (operator)",
    ].join("\n");

    async function eoasLocal(args) {
        const verb = String(args[0] || "list").toLowerCase();
        const index = await loadEoasIndex();
        if (verb === "list") {
            if (!index.size) return "  (no element registers)";
            const rows = [];
            for (const h of [...index].sort()) {
                const r = await getRecord(h);
                rows.push(`  ${h}  <${r?.tag || "?"}> rev ${r?.rev ?? "?"}  ${r?.updated_at || ""}`);
            }
            return rows.join("\n");
        }
        const hash = String(args[1] || "");
        if (!HASH_RE.test(hash)) return `usage: ${NAME} eoas ${verb} <hash>`;
        if (verb === "show") {
            const r = await getRecord(hash);
            return r ? JSON.stringify(without(r, ["html"]), null, 2) : `no register for ${hash}`;
        }
        if (verb === "drop") {
            return serial(async () => {
                if (!(await getRecord(hash))) return `no register for ${hash}`;
                await dropRecord(hash);
                return `dropped ${eoasIb(hash)}`;
            });
        }
        return HELP;
    }

    async function local(args) {
        const verb = String(args[0] || "help").toLowerCase();
        if (verb === EOAS) return eoasLocal(args.slice(1));
        await load();
        if (verb === "status") {
            return `${NAME} v${VERSION} — ${ALIAS}: ${TAGLINE}\n  lobbies: ${Object.keys(lobbies).length}\n  element registers: ${(await loadEoasIndex()).size}`;
        }
        if (verb === "list") {
            const ibs = Object.keys(lobbies).sort();
            return ibs.length ? ibs.map((ib) => `  ${ib}  (${rosterKeys(lobbies[ib].frame?.data?.lobby?.roster).length} on roster)`).join("\n") : "  (no lobbies)";
        }
        if (verb === "drop") {
            const ib = lobbyIbFromArgs([...LOBBY_ROOT.split("/"), ...args.slice(1)]);
            if (!ib) return `usage: ${NAME} drop <path>`;
            return serial(async () => {
                if (!lobbies[ib]) return `no lobby at ${ib}`;
                delete lobbies[ib];
                await save();
                return `dropped ${ib}`;
            });
        }
        return HELP;
    }

    const run = async (...rawArgs) => {
        const args = rawArgs
            .flatMap((a) => String(a ?? "").split(/[\s/]+/))
            .filter((a) => a.length);
        if (navi.callinRequest?.viaRelay) {
            try {
                return await relay(args);
            } catch (e) {
                return fail(500, String(e?.message || e));
            }
        }
        try {
            return await local(args);
        } catch (e) {
            return `error: ${e?.message || e}`;
        }
    };

    return {
        name: NAME,
        version: VERSION,
        description: `${TAGLINE} — fast relay lane for scranton_lobby_v1 lobbies and eoas element registers`,

        moduleInfo: {
            name: NAME,
            version: VERSION,
            description: `${TAGLINE}. Relay-served lobby authority: signed writes, lobby rules, no foobarch tips or tokens.`,
        },

        commands: {
            [NAME]: {
                name: NAME,
                methods: ["GET", "POST"],
                description: `${NAME} status|list|drop <path>|eoas list|show|drop <hash> (help)`,
                execute: async (...args) => run(...args),
            },
        },

        sprinter: { alias: ALIAS, tagline: TAGLINE, get: (ib) => onGet(ib) },

        onMount: async () => {
            await load();
            navi.relayWhitelist?.add(NAME, [NAME]);
            console.log(`[${NAME}] v${VERSION} — ${TAGLINE} — ${Object.keys(lobbies).length} lobbies`);
        },

        onUnmount: () => {
            navi.relayWhitelist?.remove(NAME);
        },
    };
};
