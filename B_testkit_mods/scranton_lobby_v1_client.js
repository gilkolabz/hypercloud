/**
 * scranton_lobby_v1_client — roster + append-index lobbies on foobarch hostpark.
 *
 * Contract: scranton_lobby_v1
 * Default ib: scranton/lobby/v1/{path}
 * Alias ib:   {alias}/scranton/lobby/v1/{path}
 *
 * data.lobby.creator — OP pubkey (may kick and edit any append row).
 * data.lobby.roster — presence map (join / leave / kick; create lists the OP).
 * data.lobby.append — [{ addr, by, at }] ib^gib notice board (CRUD via callin).
 *
 * Spends one navi.tokens usage token (navi.origin host) per write + keychain (proposal-write-v1).
 * Alias `sprinter`: lobbies live in the sprinter relay mod (GET/POST /{ib}); no tokens spent.
 *
 * Callin:
 *   scranton_lobby tokens count [host]
 *   scranton_lobby alias [name|-]
 *   scranton_lobby create <path>
 *   scranton_lobby join|leave|roster|ib <path>
 *   scranton_lobby kick <path> <pubkey>
 *   scranton_lobby enter <path>   — join if exists (surf helper)
 *   scranton_lobby exit           — leave current lobby
 *   scranton_lobby here           — show current lobby ib
 *   scranton_lobby append list|push|update|delete …
 *   scranton_lobby posts [path]
 *   scranton_lobby script post <page> <park> [--callin] [--from <page>] [label…]
 *   scranton_lobby affordance list|add|rm|read|push|delete …
 *   scranton_lobby trust|untrust|trusted|frens …   (trust store + signed <identity>/frens)
 *   scranton_lobby hide|unhide|show|hidden …       (personal filter, local only)
 *
 * Posts: append rows whose frame carries data.post (author = row signer).
 * Affordances: descriptors at scranton/affordance/v1/<name> + plugin mods; address affordances
 * (e.g. comments/{page}) are separate frames under their own policy — the lobby is not mutated.
 */

export const register = (navi) => {
    const eventListeners = [];
    const createdElements = [];
    const addedStyles = [];
    const observers = [];
    const timers = [];

    const CONTRACT = "scranton_lobby_v1";
    const POLICY_IB = "scranton/lobby/v1/policy";
    /** Alias served by the sprinter relay mod: reads/writes go to /{ib}, no usage tokens. */
    const SPRINTER_ALIAS = "sprinter";
    const isSprinterIb = (ib) => String(ib || "").startsWith(SPRINTER_ALIAS + "/");
    /** A few lobbies were written with `op` instead of `creator`; same pubkey. */
    const opOf = (lobby) => String(lobby?.creator || lobby?.op || "");
    /** The host runs no policy on firstGen, so a tip without the lobby policy is ungated. */
    const isPolicedLobby = (frame) =>
        frame?.data?.contract === CONTRACT &&
        frame?.data?.lobby?.contract === CONTRACT &&
        Array.isArray(frame?.rel8ns?.policy) &&
        frame.rel8ns.policy.some((p) => p === POLICY_IB || String(p).startsWith(POLICY_IB + "^"));
   const STORAGE_ALIAS = "scranton_lobby_v1.alias";
    const STORAGE_HERE = "scranton_lobby_v1.here";
    const STORAGE_FOLLOW = "scranton_lobby_v1.follow";
    const LOBBY_KEY_LABEL = "scranton_lobby";

    const normalizeHost = (raw) =>
        String(raw || "")
            .trim()
            .replace(/\/+$/, "");

    const originHost = () => {
        const o =
            (typeof navi.origin === "string" && navi.origin) ||
            (typeof navi.getOrigin === "function" && navi.getOrigin()) ||
            "";
        return normalizeHost(o) || "https://foobarch.net";
    };

    const encodePath = (raw) =>
        String(raw || "")
            .trim()
            .replace(/^\/+/, "")
            .replace(/[:\s]+/g, "/")
            .replace(/\/+/g, "/")
            .replace(/\/+$/g, "");

    const sha256Hex = async (bytes) => {
        const buf =
            bytes instanceof ArrayBuffer
                ? bytes
                : bytes?.buffer
                  ? bytes.buffer
                  : new TextEncoder().encode(String(bytes ?? ""));
        const digest = await crypto.subtle.digest("SHA-256", buf);
        return [...new Uint8Array(digest)]
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
    };

    class ScrantonLobby {
        constructor() {
            this.alias = "";
            this.hereIb = "";
            /** Follow: the surf event (a page that landed) joins or creates that page's lobby. */
            this.follow = false;
            this.surfChain = Promise.resolve();
            this.surfGen = 0;
        }

        async loadPrefs() {
            this.alias = String(
                (await navi.storage.item.get(STORAGE_ALIAS)) || ""
            ).trim();
            this.hereIb = String(
                (await navi.storage.item.get(STORAGE_HERE)) || ""
            ).trim();
            this.follow = (await navi.storage.item.get(STORAGE_FOLLOW)) === true;
        }

        async setFollow(on) {
            this.follow = !!on;
            await navi.storage.item.set(STORAGE_FOLLOW, this.follow);
            return this.follow;
        }

        async setAlias(raw) {
            const v = String(raw || "").trim();
            if (v === "-" || v.toLowerCase() === "clear") {
                this.alias = "";
            } else {
                this.alias = encodePath(v);
            }
            await navi.storage.item.set(STORAGE_ALIAS, this.alias);
            return this.alias || "(cleared — default scranton/lobby/v1/…)";
        }

        async setHere(ib) {
            this.hereIb = String(ib || "").trim();
            await navi.storage.item.set(STORAGE_HERE, this.hereIb);
        }

        lobbyIb(pathRaw) {
            const p = encodePath(pathRaw);
            if (!p) throw new Error("path required");
            if (this.alias) return `${this.alias}/scranton/lobby/v1/${p}`;
            return `scranton/lobby/v1/${p}`;
        }

        parseLobbyPathFromSurf(raw) {
            const s = encodePath(raw);
            if (!s) return null;
            const re = /(?:^|\/)(?:([^/]+)\/)?scranton\/lobby\/v1\/(.+)$/i;
            const m = s.match(re);
            if (!m) return null;
            return {
                alias: m[1] || "",
                path: m[2],
                ib: m[1]
                    ? `${m[1]}/scranton/lobby/v1/${m[2]}`
                    : `scranton/lobby/v1/${m[2]}`,
            };
        }

        // ─── tokens (navi.tokens stash) ─────────────────────────────────

        tokens() {
            if (!navi.tokens) {
                throw new Error("this navi shell has no navi.tokens — reload to get the current navi_shell.js");
            }
            return navi.tokens;
        }

        async tokensCount(hostRaw) {
            const host = normalizeHost(hostRaw) || originHost();
            return { host, count: await this.tokens().count(host) };
        }

        // ─── keychain / commit ────────────────────────────────────────────

        keychain() {
            const kc = navi.mod?.keychain;
            if (!kc) throw new Error("mount keychain first");
            return kc;
        }

        async defaultKey() {
            const kc = this.keychain();
            const get = kc.get || kc.keychain?.get;
            if (typeof get !== "function") throw new Error("keychain.get missing");
            let key = await get.call(kc, "default");
            if (!key?.publicKey) {
                const create = kc.create || kc.keychain?.create;
                if (typeof create !== "function") {
                    throw new Error("no default key — keychain create default");
                }
                key = await create.call(kc, "default");
            }
            return { name: "default", publicKey: key.publicKey };
        }

        /**
         * Lobby identity: keychain-derived child of default (keeps the main pubkey out of
         * lobby tips). Falls back to default when keychain lacks derive or signs via relay.
         */
        async lobbyKey() {
            const kc = this.keychain();
            const relay =
                typeof kc.getRelay === "function" ? await kc.getRelay() : null;
            if (typeof kc.derive !== "function" || relay?.enabled) {
                return this.defaultKey();
            }
            await this.defaultKey();
            const d = await kc.derive(LOBBY_KEY_LABEL, "default");
            return { name: d.name, publicKey: d.publicKey };
        }

        /** Keep signing with default in lobbies where default already holds OP/roster/rows. */
        async signerFor(prevLobby) {
            const lobbyKey = await this.lobbyKey();
            if (lobbyKey.name === "default" || !prevLobby) return lobbyKey;
            const legacy = await this.defaultKey();
            const pub = legacy.publicKey;
            const present =
                opOf(prevLobby) === pub ||
                !!prevLobby.roster?.[pub] ||
                (Array.isArray(prevLobby.append) &&
                    prevLobby.append.some((r) => r && r.by === pub));
            return present ? legacy : lobbyKey;
        }

        async pubkey() {
            return (await this.lobbyKey()).publicKey;
        }

        async getTip(ib) {
            const origin = originHost();
            if (isSprinterIb(ib)) {
                const res = await fetch(`${origin}/${ib}`, {
                    headers: { Accept: "application/json", "X-Navi-Shell-Wait": "1" },
                });
                const text = await res.text();
                let j;
                try {
                    j = JSON.parse(text);
                } catch {
                    throw new Error(`sprinter ${ib} → ${res.status}: ${text.slice(0, 200)}`);
                }
                if (j?.ok === false) {
                    if (j.status === 404) return null;
                    throw new Error(`sprinter ${ib}: ${j.error || "failed"}`);
                }
                return j;
            }
            // Writes build on this tip, so ask the host (and park what it says).
            return await parkedTip(ib, { fresh: true, check: lobbyCheck(ib) });
        }

        /** Lobby for reading (posts, surf hooks): the parked copy first, the host lazily. */
        async readTip(ib) {
            if (isSprinterIb(ib)) return this.getTip(ib);
            return await parkedTip(ib, { check: lobbyCheck(ib) });
        }

        async getFrameJson(ib) {
            const origin = originHost();
            const res = await fetch(`${origin}/${ib}`, {
                headers: { Accept: "application/json" },
            });
            const text = await res.text();
            if (res.status === 404) return null;
            if (!res.ok) throw new Error(`GET ${ib} → ${res.status}: ${text.slice(0, 200)}`);
            try {
                return JSON.parse(text);
            } catch {
                // kind=frame may return tip wrapper
                const tip = await this.getTip(ib);
                return tip?.frame || null;
            }
        }

        async commit(ib, frame, { parentAddr = null, sign = true, signer = null } = {}) {
            const origin = originHost();
            const envelope = {
                transform: parentAddr ? "mut8" : "firstGen",
                newIbGib: frame,
                dnas: [],
                intermediateIbGibs: [],
            };
            const body = JSON.stringify(envelope);
            if (isSprinterIb(ib)) {
                const headers = await this.writeHeaders(ib, body, { sign, parentAddr, signer });
                headers["X-Navi-Shell-Wait"] = "1";
                const res = await fetch(`${origin}/${ib}`, { method: "POST", headers, body });
                const text = await res.text();
                let result;
                try {
                    result = JSON.parse(text);
                } catch {
                    throw new Error(`sprinter ${ib} → ${res.status}: ${text.slice(0, 400)}`);
                }
                if (!result?.ok) throw new Error(`sprinter ${ib}: ${result?.error || "write refused"}`);
                return { result, frame, addr: result.addr };
            }
            const tokens = this.tokens();
            let pay = null;
            let token = "";
            if (typeof tokens.pay === "function") {
                pay = await tokens.pay(origin);
                if (pay.mode === "reserve") tokens.attach?.(frame, pay);
                else token = pay.token;
            } else {
                token = await tokens.take(origin);
            }
            const bodyPaid = JSON.stringify(envelope);
            let res;
            let text;
            try {
                ({ res, text } = await this.putWithToken(origin, ib, bodyPaid, token, { sign, parentAddr, signer }));
            } catch (e) {
                if (token) await tokens.giveBack(origin, token);
                throw e;
            }
            if (!res.ok) {
                if (token && !/consumed|invalid usage token/i.test(text)) await tokens.giveBack(origin, token);
                throw new Error(`PUT ${ib} → ${res.status}: ${text.slice(0, 400)}`);
            }
            let result;
            try {
                result = JSON.parse(text);
            } catch {
                result = { raw: text };
            }
            const addr = result.addr || res.headers.get("X-Foobarch-ib^gib");
            await parkCommitted(ib, frame, addr).catch((e) =>
                console.warn(`[scranton_lobby] park ${ib}:`, e.message || e)
            );
            return { result, frame, addr };
        }

        async putWithToken(origin, ib, body, token, { sign, parentAddr, signer }) {
            const headers = await this.writeHeaders(ib, body, { sign, parentAddr, signer });
            if (token) headers["X-Foobarch-Usage-Token"] = token;
            const res = await fetch(`${origin}/${ib}`, {
                method: "PUT",
                headers,
                body,
            });
            return { res, text: await res.text() };
        }

        async writeHeaders(ib, body, { sign, parentAddr, signer }) {
            /** @type {Record<string, string>} */
            const headers = { "Content-Type": "application/json" };
            if (sign) {
                const kc = this.keychain();
                const signed = await kc.signWrite({
                    ib,
                    parentAddr: parentAddr || "",
                    body,
                    contentType: "application/json",
                    key: (signer || (await this.lobbyKey())).name,
                    scheme: "proposal",
                });
                const h =
                    typeof kc.buildSignHeaders === "function"
                        ? kc.buildSignHeaders(signed)
                        : {
                              "X-Flowerpot-Sign-Keys": signed.publicKey,
                              "X-Flowerpot-Signatures": signed.signature,
                          };
                Object.assign(headers, h);
                if (h["X-Flowerpot-Sign-Keys"]) {
                    headers["X-Foobarch-Sign-Keys"] = h["X-Flowerpot-Sign-Keys"];
                }
                if (h["X-Flowerpot-Signatures"]) {
                    headers["X-Foobarch-Signatures"] = h["X-Flowerpot-Signatures"];
                }
            }
            return headers;
        }

        async buildLobbyFrame(ib, lobby, { parentAddr = null, n = 0, base = null } = {}) {
            if (base?.data && parentAddr) {
                const data = {
                    ...base.data,
                    lobby,
                    n,
                    timestamp: new Date().toUTCString(),
                };
                const gib = (await sha256Hex(JSON.stringify(data))).toUpperCase();
                return {
                    ib,
                    gib,
                    data,
                    rel8ns: { ...(base.rel8ns || {}), past: [parentAddr] },
                };
            }
            const data = {
                parts: ["network_proposal", "ibgib_frame", "manifest", "json"],
                park: "defer",
                contract: CONTRACT,
                about: {
                    label: CONTRACT,
                    description:
                        "Scranton lobby v1 — roster + append ib^gib index",
                },
                lobby,
                default_method: "GET",
                method: {
                    GET: { kind: "frame" },
                    PUT: { kind: "commit" },
                    PATCH: { kind: "commit" },
                },
                n,
                timestamp: new Date().toUTCString(),
            };
            const gib = (await sha256Hex(JSON.stringify(data))).toUpperCase();
            return {
                ib,
                gib,
                data,
                rel8ns: {
                    policy: [POLICY_IB],
                    past: parentAddr ? [parentAddr] : [],
                    tjp: [],
                    dna: [],
                },
            };
        }

        /** Clone lobby shape; ensure roster object + append array. */
        normalizeLobby(prev) {
            const base =
                prev && typeof prev === "object" ? { ...prev } : {};
            if (base.op && !base.creator) base.creator = base.op;
            delete base.op;
            return {
                ...base,
                contract: CONTRACT,
                roster:
                    base.roster && typeof base.roster === "object"
                        ? { ...base.roster }
                        : {},
                append: this.normalizeAppend(base.append),
            };
        }

        normalizeAppend(raw) {
            if (!Array.isArray(raw)) return [];
            const out = [];
            for (const row of raw) {
                if (!row || typeof row !== "object") continue;
                const addr = String(row.addr || "").trim();
                if (!addr) continue;
                out.push({
                    addr,
                    by: String(row.by || "").trim(),
                    at: String(row.at || "").trim(),
                });
            }
            return out;
        }

        async mut8Lobby(ib, tip, nextLobby, signer) {
            const n = Number(tip.frame?.data?.n || 0) + 1;
            const lobby = this.normalizeLobby(nextLobby);
            const frame = await this.buildLobbyFrame(ib, lobby, {
                parentAddr: tip.addr,
                n,
                base: tip.frame,
            });
            const out = await this.commit(ib, frame, {
                parentAddr: tip.addr,
                sign: true,
                signer: signer || (await this.signerFor(tip.frame?.data?.lobby)),
            });
            return { out, lobby, frame, n };
        }

        async create(pathRaw) {
            const ib = this.lobbyIb(pathRaw);
            const existing = await this.getTip(ib);
            if (existing && !existing.tombstone) {
                throw new Error(`lobby already exists: ${ib}`);
            }
            const signer = await this.lobbyKey();
            const pub = signer.publicKey;
            const now = new Date().toISOString();
            const ts = Math.floor(Date.now() / 1000);
            const lobby = {
                contract: CONTRACT,
                path: encodePath(pathRaw),
                created_at: now,
                creator: pub,
                roster: {
                    [pub]: { joined_at: now, ts },
                },
                append: [],
            };
            const frame = await this.buildLobbyFrame(ib, lobby, { n: 0 });
            const out = await this.commit(ib, frame, {
                parentAddr: null,
                sign: true,
                signer,
            });
            await this.setHere(ib);
            return { ok: true, action: "create", ib, addr: out.addr, lobby, frame };
        }

        async roster(pathRaw) {
            const ib = this.lobbyIb(pathRaw);
            const tip = await this.getTip(ib);
            if (!tip || tip.tombstone) throw new Error(`no lobby at ${ib}`);
            return {
                ok: true,
                ib,
                addr: tip.addr,
                lobby: tip.frame?.data?.lobby || null,
                frame: tip.frame,
            };
        }

        async join(pathRaw, { parked = false } = {}) {
            const ib = this.lobbyIb(pathRaw);
            const tip = (parked && (await this.peekLocal?.(ib))) || (await this.getTip(ib));
            if (!tip || tip.tombstone) throw new Error(`no lobby at ${ib}`);
            const prev = tip.frame?.data?.lobby;
            if (!prev) throw new Error("lobby tip missing data.lobby");
            const signer = await this.signerFor(prev);
            const pub = signer.publicKey;
            if (prev.roster?.[pub]) {
                await this.setHere(ib);
                return {
                    ok: true,
                    action: "already",
                    ib,
                    lobby: this.normalizeLobby(prev),
                    frame: tip.frame,
                };
            }
            const now = new Date().toISOString();
            const ts = Math.floor(Date.now() / 1000);
            const lobby = this.normalizeLobby(prev);
            lobby.roster = {
                ...lobby.roster,
                [pub]: { joined_at: now, ts },
            };
            const { out, frame } = await this.mut8Lobby(ib, tip, lobby, signer);
            await this.setHere(ib);
            return {
                ok: true,
                action: "join",
                ib,
                addr: out.addr,
                lobby,
                frame,
            };
        }

        async leave(pathRaw) {
            const ib = pathRaw ? this.lobbyIb(pathRaw) : this.hereIb;
            if (!ib) throw new Error("no path / no current lobby");
            const tip = await this.getTip(ib);
            if (!tip || tip.tombstone) throw new Error(`no lobby at ${ib}`);
            const prev = tip.frame?.data?.lobby;
            if (!prev) throw new Error("lobby tip missing data.lobby");
            const signer = await this.signerFor(prev);
            const pub = signer.publicKey;
            if (!prev.roster?.[pub]) {
                if (this.hereIb === ib) await this.setHere("");
                return {
                    ok: true,
                    action: "already_absent",
                    ib,
                    lobby: this.normalizeLobby(prev),
                    frame: tip.frame,
                };
            }
            const lobby = this.normalizeLobby(prev);
            delete lobby.roster[pub];
            const { out, frame } = await this.mut8Lobby(ib, tip, lobby, signer);
            if (this.hereIb === ib) await this.setHere("");
            return {
                ok: true,
                action: "leave",
                ib,
                addr: out.addr,
                lobby,
                frame,
            };
        }

        async kick(pathRaw, pubkeyRaw) {
            const ib = this.lobbyIb(pathRaw);
            const victim = String(pubkeyRaw || "").trim();
            if (!victim) throw new Error("pubkey required");
            const tip = await this.getTip(ib);
            if (!tip || tip.tombstone) throw new Error(`no lobby at ${ib}`);
            const prev = tip.frame?.data?.lobby;
            if (!prev) throw new Error("lobby tip missing data.lobby");
            const signer = await this.signerFor(prev);
            if (signer.publicKey !== opOf(prev)) throw new Error("only the OP may kick");
            if (!prev.roster?.[victim]) throw new Error("pubkey not on roster");
            const lobby = this.normalizeLobby(prev);
            delete lobby.roster[victim];
            const { out, frame } = await this.mut8Lobby(ib, tip, lobby, signer);
            return {
                ok: true,
                action: "kick",
                ib,
                addr: out.addr,
                lobby,
                frame,
            };
        }

        /** Join if lobby exists (same as join; surf helper name). */
        async enter(pathRaw) {
            const ib = this.lobbyIb(pathRaw);
            const tip = await this.getTip(ib);
            if (!tip || tip.tombstone) {
                return {
                    ok: false,
                    error: `no lobby at ${ib} — scranton_lobby create ${encodePath(pathRaw)}`,
                };
            }
            return this.join(pathRaw);
        }

        resolveAppendIndex(append, key) {
            const list = this.normalizeAppend(append);
            const raw = String(key ?? "").trim();
            if (!raw) throw new Error("append index or addr required");
            if (/^\d+$/.test(raw)) {
                const i = parseInt(raw, 10);
                if (i < 0 || i >= list.length) {
                    throw new Error(`append index out of range: ${i}`);
                }
                return i;
            }
            const i = list.findIndex((r) => r.addr === raw);
            if (i < 0) throw new Error(`append addr not found: ${raw}`);
            return i;
        }

        async appendList(pathRaw) {
            const ib = this.lobbyIb(pathRaw);
            const tip = await this.getTip(ib);
            if (!tip || tip.tombstone) throw new Error(`no lobby at ${ib}`);
            const lobby = this.normalizeLobby(tip.frame?.data?.lobby);
            return {
                ok: true,
                ib,
                addr: tip.addr,
                append: lobby.append,
                n: lobby.append.length,
            };
        }

        async appendPush(pathRaw, addrRaw) {
            const addr = String(addrRaw || "").trim();
            if (!addr) throw new Error("ib^gib (or tip ib) required");
            const ib = this.lobbyIb(pathRaw);
            const tip = await this.getTip(ib);
            if (!tip || tip.tombstone) throw new Error(`no lobby at ${ib}`);
            const prev = tip.frame?.data?.lobby;
            if (!prev) throw new Error("lobby tip missing data.lobby");
            const signer = await this.signerFor(prev);
            const lobby = this.normalizeLobby(prev);
            lobby.append.push({
                addr,
                by: signer.publicKey,
                at: new Date().toISOString(),
            });
            const { out, frame } = await this.mut8Lobby(ib, tip, lobby, signer);
            return {
                ok: true,
                action: "append_push",
                ib,
                addr: out.addr,
                row: lobby.append[lobby.append.length - 1],
                append: lobby.append,
                frame,
            };
        }

        async appendUpdate(pathRaw, key, addrRaw) {
            const addr = String(addrRaw || "").trim();
            if (!addr) throw new Error("new addr required");
            const ib = this.lobbyIb(pathRaw);
            const tip = await this.getTip(ib);
            if (!tip || tip.tombstone) throw new Error(`no lobby at ${ib}`);
            const prev = tip.frame?.data?.lobby;
            if (!prev) throw new Error("lobby tip missing data.lobby");
            const lobby = this.normalizeLobby(prev);
            const i = this.resolveAppendIndex(lobby.append, key);
            lobby.append[i] = {
                ...lobby.append[i],
                addr,
                at: new Date().toISOString(),
            };
            const { out, frame } = await this.mut8Lobby(ib, tip, lobby);
            return {
                ok: true,
                action: "append_update",
                ib,
                addr: out.addr,
                index: i,
                row: lobby.append[i],
                append: lobby.append,
                frame,
            };
        }

        async appendDelete(pathRaw, key) {
            const ib = this.lobbyIb(pathRaw);
            const tip = await this.getTip(ib);
            if (!tip || tip.tombstone) throw new Error(`no lobby at ${ib}`);
            const prev = tip.frame?.data?.lobby;
            if (!prev) throw new Error("lobby tip missing data.lobby");
            const lobby = this.normalizeLobby(prev);
            const i = this.resolveAppendIndex(lobby.append, key);
            const removed = lobby.append.splice(i, 1)[0];
            const { out, frame } = await this.mut8Lobby(ib, tip, lobby);
            return {
                ok: true,
                action: "append_delete",
                ib,
                addr: out.addr,
                removed,
                append: lobby.append,
                frame,
            };
        }

        /** Surfs run one at a time; a surf that is overtaken by a newer one skips its join. */
        onSurfPath(surfPath) {
            const gen = ++this.surfGen;
            const run = this.surfChain.then(() => this.surfTo(surfPath, gen));
            this.surfChain = run.catch(() => {});
            return run;
        }

        async surfTo(surfPath, gen) {
            const hit = this.parseLobbyPathFromSurf(surfPath);
            let target = null;
            if (hit) {
                if (hit.alias) await this.setAlias(hit.alias);
                else if (this.alias) await this.setAlias("-");
                target = { path: hit.path, ib: hit.ib };
            } else if (this.follow) {
                const p = encodePath(surfPath);
                if (p) target = { path: p, ib: this.lobbyIb(p) };
            }
            const prevHere = this.hereIb;
            if (prevHere && (!target || target.ib !== prevHere)) {
                try {
                    const tip = await this.getTip(prevHere);
                    if (tip && !tip.tombstone) {
                        const prev = tip.frame?.data?.lobby;
                        const signer = await this.signerFor(prev);
                        const pub = signer.publicKey;
                        if (prev?.roster?.[pub]) {
                            const lobby = this.normalizeLobby(prev);
                            delete lobby.roster[pub];
                            await this.mut8Lobby(prevHere, tip, lobby, signer);
                        }
                    }
                } catch (e) {
                    console.warn(
                        "[scranton_lobby_v1] leave on surf-away:",
                        e.message || e
                    );
                }
                await this.setHere("");
            }
            if (!target || gen !== this.surfGen) return null;
            try {
                const parked = await this.peekLocal?.(target.ib);
                if (!parked) {
                    const tip = await this.getTip(target.ib);
                    if (!tip || tip.tombstone) {
                        if (this.follow) return await this.create(target.path);
                        return null;
                    }
                }
                try {
                    return await this.join(target.path, { parked: !!parked });
                } catch (e) {
                    if (!parked) throw e;
                    return await this.join(target.path);
                }
            } catch (e) {
                return { ok: false, error: e.message || String(e), ib: target.ib };
            }
        }
    }

    const svc = new ScrantonLobby();

    // ─── settings ─────────────────────────────────────────────────────
    // Scranton's own steps plus one step per affordance plugin that has prefSteps(ctx) → fields.
    // surfroster shows every step not seen yet as a wizard, and all of them as its settings panel.
    // Field: { key, label, help?, type: "toggle"|"choice"|"number", options?: [{ value, label }],
    //          default, min?, max?, when?: [key, value] (only matters while that key has that value) }.
    const STORAGE_SETTINGS = "scranton_lobby_v1.settings";
    const PARK_KINDS = ["lobby", "address", "descriptor", "frens", "content"];
    const SCRANTON_STEPS = [
        {
            id: "scranton.park",
            label: "Localpark",
            help: "Keep copies of scranton frames in this navi, under the host's own ib^gib. Pages you've been to load from here first and still work offline.",
            fields: [
                { key: "park.on", label: "keep copies of scranton frames here", type: "toggle", default: true },
                { key: "park.lobby", label: "lobbies (rosters and posts)", type: "toggle", default: true, when: ["park.on", true] },
                { key: "park.address", label: "address frames (comments, stage directions, links…)", type: "toggle", default: true, when: ["park.on", true] },
                { key: "park.descriptor", label: "affordance descriptors", type: "toggle", default: true, when: ["park.on", true] },
                { key: "park.frens", label: "frens lists and policies", type: "toggle", default: true, when: ["park.on", true] },
                { key: "park.content", label: "posted frames and post content", type: "toggle", default: true, when: ["park.on", true] },
            ],
        },
        {
            id: "scranton.host",
            label: "Host checks",
            help: "A parked frame is shown right away; the host is asked when it's read, and a difference is settled then. Nothing polls.",
            fields: [
                {
                    key: "host.check",
                    label: "when a parked frame is read, ask the host",
                    type: "choice",
                    default: "throttle",
                    options: [
                        { value: "always", label: "on every read" },
                        { value: "throttle", label: "at most once every N seconds per frame" },
                        { value: "manual", label: "only when I press refresh" },
                    ],
                    when: ["park.on", true],
                },
                { key: "host.seconds", label: "N seconds", type: "number", default: 15, min: 1, max: 86400, when: ["host.check", "throttle"] },
                {
                    key: "host.frame_rules",
                    label: "let a frame set its own interval (data.localpark.check_s)",
                    type: "toggle",
                    default: false,
                    when: ["park.on", true],
                },
            ],
        },
        {
            id: "scranton.writes",
            label: "Your rows",
            help: "Comments, stage directions, links and other address rows you add or delete.",
            fields: [
                {
                    key: "write.capture",
                    label: "save my rows here first, then hostpark them",
                    help: "off: a row appears only once the host has taken it",
                    type: "toggle",
                    default: true,
                },
                {
                    key: "write.conflict",
                    label: "the host changed while rows of mine are still hostparking",
                    type: "choice",
                    default: "both",
                    options: [
                        { value: "both", label: "show the host's frame with my rows on top, and send mine" },
                        { value: "host", label: "take the host's frame and drop my pending rows" },
                        { value: "local", label: "keep showing my view until I sync" },
                    ],
                    when: ["write.capture", true],
                },
            ],
        },
        {
            id: "scranton.hooks",
            label: "Surf hooks",
            help: "Stage directions and navi-scripts run from parked frames when you arrive. A host refresh can bring more.",
            fields: [
                {
                    key: "hooks.rerun",
                    label: "the host has a different version of an item the hooks already ran",
                    type: "choice",
                    default: "skip",
                    options: [
                        { value: "skip", label: "don't run it again" },
                        { value: "run", label: "run the host's version too" },
                    ],
                },
            ],
        },
    ];
    const SCRANTON_FIELDS = new Map(SCRANTON_STEPS.flatMap((s) => s.fields.map((f) => [f.key, f])));

    let settingsCache = null;
    const loadSettings = async () => {
        if (settingsCache) return settingsCache;
        const v = await navi.storage.item.get(STORAGE_SETTINGS);
        settingsCache = {
            values: v?.values && typeof v.values === "object" ? v.values : {},
            affordances: v?.affordances && typeof v.affordances === "object" ? v.affordances : {},
            seen: Array.isArray(v?.seen) ? v.seen.filter((x) => typeof x === "string") : [],
        };
        return settingsCache;
    };
    const saveSettings = async () => {
        if (settingsCache) await navi.storage.item.set(STORAGE_SETTINGS, settingsCache);
    };
    const coerceField = (f, v) => {
        if (f.type === "toggle") return v === true || v === "true" || v === "on" || v === "1" || v === 1;
        if (f.type === "number") {
            const n = Number(v);
            if (!Number.isFinite(n)) throw new Error(`${f.key} needs a number`);
            return Math.min(f.max ?? Infinity, Math.max(f.min ?? -Infinity, n));
        }
        if (f.type === "choice") {
            const s = String(v);
            if (!(f.options || []).some((o) => String(o.value) === s)) {
                throw new Error(`${f.key}: one of ${(f.options || []).map((o) => o.value).join("|")}`);
            }
            return (f.options || []).find((o) => String(o.value) === s).value;
        }
        return v;
    };
    const setting = async (key) => {
        const v = (await loadSettings()).values[key];
        return v === undefined ? SCRANTON_FIELDS.get(key)?.default : v;
    };

    const pluginSteps = async () => {
        const out = [];
        for (const a of await svc.affordances().catch(() => [])) {
            if (typeof a.plugin?.prefSteps !== "function") continue;
            const fields = await Promise.resolve(a.plugin.prefSteps({ lobby: svc, affordance: a })).catch(() => []);
            if (!Array.isArray(fields) || !fields.length) continue;
            out.push({
                id: `affordance.${a.name}`,
                affordance: a.name,
                label: a.descriptor?.label || a.plugin.label || a.name,
                help: a.descriptor?.description || "",
                fields: fields.filter((f) => f?.key && f.type),
            });
        }
        return out;
    };

    /** Every step with each field's current value (`value`). */
    svc.settingSteps = async () => {
        const s = await loadSettings();
        const steps = [...SCRANTON_STEPS, ...(await pluginSteps())];
        return steps.map((step) => {
            const vals = step.affordance ? s.affordances[step.affordance] || {} : s.values;
            return {
                ...step,
                seen: s.seen.includes(step.id),
                fields: step.fields.map((f) => ({ ...f, value: vals[f.key] === undefined ? f.default : vals[f.key] })),
            };
        });
    };
    /** Steps the wizard still has to show (never seen: first run, or an affordance that showed up since). */
    svc.settingsNeeded = async () => (await svc.settingSteps()).filter((s) => !s.seen);
    /** patch: { key: value }. affordance: the plugin step's affordance name. */
    svc.setSettings = async (patch, affordance = "") => {
        const s = await loadSettings();
        const fields = affordance
            ? new Map(((await pluginSteps()).find((x) => x.affordance === affordance)?.fields || []).map((f) => [f.key, f]))
            : SCRANTON_FIELDS;
        const into = affordance ? (s.affordances[affordance] ||= {}) : s.values;
        for (const [k, v] of Object.entries(patch || {})) {
            const f = fields.get(k);
            if (!f) throw new Error(`no setting ${affordance ? `${affordance}:` : ""}${k}`);
            into[k] = coerceField(f, v);
        }
        await saveSettings();
        return into;
    };
    svc.markSettingsSeen = async (ids) => {
        const s = await loadSettings();
        s.seen = [...new Set([...s.seen, ...(ids || [])])];
        await saveSettings();
    };
    /** defaults: also put every value back to its default. Either way the wizard shows again. */
    svc.resetSettings = async ({ defaults = false } = {}) => {
        const s = await loadSettings();
        s.seen = [];
        if (defaults) {
            s.values = {};
            s.affordances = {};
        }
        await saveSettings();
    };
    svc.setting = setting;
    /** A plugin's own setting (its field default when unset). */
    svc.affordanceSetting = async (name, key) => {
        const v = (await loadSettings()).affordances[name]?.[key];
        if (v !== undefined) return v;
        return ((await pluginSteps()).find((x) => x.affordance === name)?.fields || []).find((f) => f.key === key)?.default;
    };

    // ─── localpark (affordance layer) ─────────────────────────────────
    // Scranton frames (lobbies, address affordances, descriptors, posted generations, frens) are parked
    // in this navi at their own ib under the host's gib, so a parked frame has the host's ib^gib.
    // Reads that drive affordances answer from the parked copy and refresh from the host lazily;
    // writes read the host first because they must build on its current generation.
    // Address rows (comments, stagedir, links…) are captured local-first as pending ops in the park
    // ledger; readers show them at once and the host write follows (or `scranton_lobby park sync`).
    // The parked tip itself is only ever a frame the host has, so "identical addr" means "same frame".
    // Host moved while you have pending rows: the affordance plugin's parkConflict(local, host, ctx),
    // else the write.conflict setting, picks "both" (newest host frame + your pending rows, the default),
    // "host" (drop the pending rows) or "local" (keep the parked frame until you sync).
    // What gets parked, when the host is asked and whether rows are captured are settings (above).
    const STORAGE_PARK = "scranton_lobby_v1.park";
    const CONFLICT_PICKS = ["both", "host", "local"];
    let parkLedger = null;
    const parkListeners = new Set();
    const refreshing = new Map();
    const refreshedAt = new Map();
    const refreshChecks = new Map();
    const syncing = new Set();

    const parkKindOf = (ib) => {
        const s = String(ib || "");
        if (/(^|\/)scranton\/lobby\/v1\//.test(s)) return "lobby";
        if (s === "scranton/affordance/v1" || s.startsWith("scranton/affordance/v1/")) return "descriptor";
        if (s.startsWith("policies/") || s.endsWith("/frens")) return "frens";
        return "address";
    };
    const parks = async (kind) => PARK_KINDS.includes(kind) && (await setting("park.on")) && (await setting(`park.${kind}`)) !== false;

    /** How long a parked frame is trusted before a read asks the host again (Infinity: only on refresh). */
    const checkEveryMs = async (local) => {
        if (await setting("host.frame_rules")) {
            const s = Number(local?.frame?.data?.localpark?.check_s);
            if (Number.isFinite(s) && s >= 0) return s * 1000;
        }
        const mode = await setting("host.check");
        if (mode === "always") return 0;
        if (mode === "manual") return Infinity;
        return Number(await setting("host.seconds")) * 1000;
    };

    const isOffline = (e) => e instanceof TypeError;
    const addrOf = (ib, gib) => `${ib}^${gib}`;
    const splitAddr = (addr) => {
        const s = String(addr || "");
        const i = s.indexOf("^");
        return i < 0 ? [s, ""] : [s.slice(0, i), s.slice(i + 1)];
    };
    const rowKey = (row) => `${row?.by || ""}|${row?.at || ""}`;
    const lobbyCheck = (ib) => (tip) => {
        if (tip && !tip.tombstone && !isPolicedLobby(tip.frame)) {
            throw new Error(`${ib} is not a policed lobby (no ${POLICY_IB} rel8n); refusing to use it`);
        }
    };

    const loadLedger = async () => {
        if (parkLedger) return parkLedger;
        const v = await navi.storage.item.get(STORAGE_PARK);
        parkLedger = { ibs: v?.ibs && typeof v.ibs === "object" ? v.ibs : {} };
        return parkLedger;
    };
    const saveLedger = async () => {
        if (parkLedger) await navi.storage.item.set(STORAGE_PARK, parkLedger);
    };
    const ledgerRow = async (ib) => (await loadLedger()).ibs[ib] || null;
    const patchLedger = async (ib, patch) => {
        const l = await loadLedger();
        const next = { ...(l.ibs[ib] || {}), ...patch };
        for (const [k, v] of Object.entries(next)) {
            if (v == null || (k === "pending" && Array.isArray(v) && !v.length)) delete next[k];
        }
        l.ibs[ib] = next;
        await saveLedger();
        return next;
    };
    const dropLedger = async (ib) => {
        const l = await loadLedger();
        delete l.ibs[ib];
        await saveLedger();
    };

    svc.onPark = (fn) => {
        parkListeners.add(fn);
        return () => parkListeners.delete(fn);
    };
    const emitPark = (ev) => {
        for (const fn of parkListeners) {
            try {
                fn(ev);
            } catch (e) {
                console.warn("[scranton_lobby] park listener:", e.message || e);
            }
        }
    };

    /** The parked frame at exactly `ib`, shaped like a host tip ({ ib, addr, frame, local }). */
    const localTip = async (ib) => {
        const frame = await navi.storage.tip.get(ib).catch(() => null);
        if (!frame?.data || !frame.gib || frame.ib !== ib) return null;
        return { ib, addr: addrOf(ib, frame.gib), frame, tombstone: false, local: true };
    };
    svc.peekLocal = localTip;

    /**
     * Park a host tip under its own gib. pointer:false keeps it in frame space only. Moving the pointer
     * drops the generation it replaces (the host keeps history), except the remembered first one.
     */
    const parkTip = async (tip, { pointer = true, kind = "" } = {}) => {
        const gib = String(tip?.frame?.gib || splitAddr(tip?.addr)[1] || "");
        if (!tip?.ib || !tip.frame?.data || !gib) return null;
        if (!(await parks(kind || parkKindOf(tip.ib)))) return null;
        const frame = { ib: tip.ib, gib, data: tip.frame.data, rel8ns: tip.frame.rel8ns || {} };
        const addr = addrOf(tip.ib, gib);
        if (!pointer) {
            await navi.storage.tip.frame.put(frame);
            return addr;
        }
        const prev = (await localTip(tip.ib))?.addr;
        await navi.storage.tip.set(frame);
        const row = await ledgerRow(tip.ib);
        if (prev && prev !== addr && prev !== row?.first && prev !== row?.host) {
            await navi.storage.tip.frame.del(prev).catch(() => null);
        }
        return addr;
    };

    const hostTip = async (ib) => {
        const res = await fetch(`${originHost()}/foobarch/tip/${encodeURIComponent(ib)}`, {
            headers: { Accept: "application/json", "X-Navi-Park-Bypass": "1" },
        });
        if (res.status === 404) return null;
        const text = await res.text();
        if (!res.ok) throw new Error(`tip ${ib} → ${res.status}: ${text.slice(0, 200)}`);
        const tip = JSON.parse(text);
        return tip?.tombstone ? null : tip;
    };

    const conflictPick = async (ib, row, local, host) => {
        const name = row?.pending?.[0]?.name;
        const a = name ? await svc.affordanceNamed(name).catch(() => null) : null;
        if (typeof a?.plugin?.parkConflict === "function") {
            const pick = await a.plugin.parkConflict(local, host, { ib, lobby: svc, affordance: a, pending: row.pending });
            if (CONFLICT_PICKS.includes(pick)) return pick;
        }
        return await setting("write.conflict");
    };

    /** Settle the parked copy of `ib` against what the host says now. */
    const reconcile = async (ib, host) => {
        const local = await localTip(ib);
        const row = await ledgerRow(ib);
        const pending = row?.pending || [];
        if (!host) {
            if (local && !pending.length && row?.host) {
                await navi.storage.tip.del(ib);
                await dropLedger(ib);
                emitPark({ ib, change: "gone", was: local.addr });
                return "gone";
            }
            return local ? "local" : "none";
        }
        if (local?.addr === host.addr) {
            if (row?.host !== host.addr) await patchLedger(ib, { host: host.addr });
            return "same";
        }
        const pick = pending.length ? await conflictPick(ib, row, local, host) : "host";
        if (pick === "local") {
            if (row?.host === host.addr) return "local";
            await parkTip(host, { pointer: false });
            await patchLedger(ib, { host: host.addr });
        } else {
            await parkTip(host);
            await patchLedger(ib, { host: host.addr, ...(pick === "host" ? { pending: null, error: null } : {}) });
        }
        emitPark({ ib, change: pick, addr: host.addr, was: local?.addr || null });
        if (pick === "both" && pending.length) void syncLater(ib);
        return pick;
    };

    const refreshLater = async (ib, check, local = null, { force = false } = {}) => {
        if (check) refreshChecks.set(ib, check);
        else check = refreshChecks.get(ib) || null;
        if (refreshing.has(ib)) return refreshing.get(ib);
        if (!force) {
            const every = await checkEveryMs(local);
            if (every === Infinity) return null;
            if (refreshedAt.has(ib) && Date.now() - refreshedAt.get(ib) < every) return null;
        }
        if (refreshing.has(ib)) return refreshing.get(ib);
        const p = hostTip(ib)
            .then(async (t) => {
                if (t && check) check(t);
                return reconcile(ib, t);
            })
            .catch((e) => console.warn(`[scranton_lobby] park refresh ${ib}:`, e.message || e))
            .finally(() => {
                refreshing.delete(ib);
                refreshedAt.set(ib, Date.now());
            });
        refreshing.set(ib, p);
        return p;
    };

    /**
     * Local-first tip. Default: the parked frame now and the host lazily (first sight waits for the
     * host). fresh: the host now (parked as it arrives); offline falls back to the parked frame.
     */
    const parkedTip = async (ib, { fresh = false, check = null } = {}) => {
        if (!(await parks(parkKindOf(ib)))) {
            const host = await hostTip(ib);
            if (host && check) check(host);
            return host;
        }
        if (!fresh) {
            const local = await localTip(ib);
            let ok = !!local;
            if (local && check) {
                try {
                    check(local);
                } catch {
                    ok = false;
                }
            }
            if (ok) {
                void refreshLater(ib, check, local);
                return local;
            }
        }
        let host;
        try {
            host = await hostTip(ib);
        } catch (e) {
            const local = isOffline(e) ? await localTip(ib) : null;
            if (local) return local;
            throw e;
        }
        if (host && check) check(host);
        if (check) refreshChecks.set(ib, check);
        refreshedAt.set(ib, Date.now());
        await reconcile(ib, host);
        return host;
    };
    svc.parkedTip = parkedTip;

    /** Ask the host now about every parked frame read this session (the refresh button; the only way in manual mode). */
    svc.refreshParked = async () => {
        const ibs = [...new Set([...refreshedAt.keys(), ...refreshChecks.keys()])];
        await Promise.all(ibs.map((ib) => refreshLater(ib, null, null, { force: true })));
        return ibs.length;
    };

    /** A write the host accepted: its frame is now the host's, so park it as the tip. */
    const parkCommitted = async (ib, frame, addr) => {
        if (!(await parks(parkKindOf(ib)))) return;
        const mine = addrOf(ib, frame.gib);
        await parkTip({ ib, addr: mine, frame });
        await patchLedger(ib, { host: addr || mine, error: null });
        refreshedAt.set(ib, addr && addr !== mine ? 0 : Date.now());
        if (addr && addr !== mine) void refreshLater(ib);
    };

    // ─── posts + affordances ──────────────────────────────────────────
    //
    // A post is a frame appended (POSTed) to a page's lobby: data.post = { v, kind, page, lobby, author, … }.
    // It counts only when post.author === the row's `by` (the lobby schema already makes `by` sign the row),
    // post.page is the lobby's page, and post.lobby names that lobby.
    //
    // An affordance is a way of identifying and interpreting frames:
    //   post affordance    — claims posts of one kind (post_kind)
    //   address affordance — a frame at address(page), e.g. comments/{page}: anyone may create it, its own
    //                        policy gates every write, and the page's lobby never changes.
    // Sources, merged by name: descriptor frames at scranton/affordance/v1/<name> (listed by the index tip
    // scranton/affordance/v1 plus local names), registerAffordance(def), and mounted mods exposing
    // `affordancePlugin`. A descriptor may name an interpreter mod; without one, plain JSON is enough.
    //   plugin def: { name, post_kind?, address?, label?, describe?(x, ctx), actions?(x, ctx), onSurf?(list, ctx),
    //                 prefSteps?(ctx) → fields, parkConflict?(local, host, ctx), rerunHost?(item, ctx) }
    const AFFORDANCE_ROOT = "scranton/affordance/v1";
    const STORAGE_AFFORDANCES = "scranton_lobby_v1.affordances";
    const DESCRIPTOR_TTL_MS = 60_000;
    const affordancePlugins = new Map();
    const frameCache = new Map();
    let descriptorCache = null;

    /** Any tip, local-first (getTip only accepts policed lobbies). */
    const rawTip = (ib, opts) => parkedTip(ib, opts);
    const hasPolicy = (frame, policyIb) =>
        Array.isArray(frame?.rel8ns?.policy) &&
        frame.rel8ns.policy.some((p) => p === policyIb || String(p).startsWith(policyIb + "^"));

    svc.affordanceIb = (name) => `${AFFORDANCE_ROOT}/${encodePath(name)}`;

    svc.registerAffordance = (def) => {
        if (!def?.name) throw new Error("affordance needs a name");
        affordancePlugins.set(def.name, def);
        return () => {
            if (affordancePlugins.get(def.name) === def) affordancePlugins.delete(def.name);
        };
    };
    svc.unregisterAffordance = (name) => affordancePlugins.delete(name);

    /** A mod may interpret several affordances: `affordancePlugins: [...]` and/or `affordancePlugin`. */
    const modPlugins = (mod) => [...(Array.isArray(mod?.affordancePlugins) ? mod.affordancePlugins : []), mod?.affordancePlugin].filter((p) => p?.name);

    /** Registered plugins plus any mounted mod exposing affordance plugins (pull discovery). */
    const pluginMap = () => {
        const out = new Map(affordancePlugins);
        for (const mod of Object.values(navi.mod || {})) {
            for (const p of modPlugins(mod)) if (!out.has(p.name)) out.set(p.name, p);
        }
        return out;
    };

    svc.localAffordanceNames = async () => {
        const v = await navi.storage.item.get(STORAGE_AFFORDANCES);
        return Array.isArray(v) ? v.filter((x) => typeof x === "string" && x) : [];
    };
    svc.setLocalAffordance = async (name, on) => {
        const set = new Set(await svc.localAffordanceNames());
        if (on) set.add(encodePath(name));
        else set.delete(encodePath(name));
        await navi.storage.item.set(STORAGE_AFFORDANCES, [...set]);
        descriptorCache = null;
        return [...set];
    };

    /** Descriptors from scranton/affordance/v1 (index) + local names; cached for a minute. */
    svc.loadDescriptors = async ({ fresh = false } = {}) => {
        if (!fresh && descriptorCache && Date.now() - descriptorCache.at < DESCRIPTOR_TTL_MS) {
            return descriptorCache.map;
        }
        const names = new Set(await svc.localAffordanceNames());
        try {
            const index = await rawTip(AFFORDANCE_ROOT, { fresh });
            for (const n of index?.frame?.data?.affordances?.names || []) {
                if (typeof n === "string" && n) names.add(n);
            }
        } catch (e) {
            console.warn("[scranton_lobby] affordance index:", e.message || e);
        }
        const map = new Map();
        await Promise.all(
            [...names].map(async (name) => {
                try {
                    const tip = await rawTip(svc.affordanceIb(name), { fresh });
                    const d = tip?.frame?.data?.affordance;
                    if (d && typeof d === "object") map.set(name, { ...d, name, ib: svc.affordanceIb(name), addr: tip.addr });
                } catch (e) {
                    console.warn(`[scranton_lobby] affordance ${name}:`, e.message || e);
                }
            })
        );
        descriptorCache = { at: Date.now(), map };
        return map;
    };

    /** Every known affordance: { name, descriptor, plugin, post_kind, address }. */
    svc.affordances = async () => {
        const descriptors = await svc.loadDescriptors();
        const plugins = pluginMap();
        const out = [];
        for (const [name, d] of descriptors) {
            const mod = d.interpreter?.mod ? navi.mod?.[d.interpreter.mod] : null;
            const plugin = plugins.get(name) || modPlugins(mod).find((p) => p.name === name) || null;
            out.push({ name, descriptor: d, plugin, post_kind: d.post_kind || plugin?.post_kind || "", address: d.address || plugin?.address || "" });
        }
        for (const [name, plugin] of plugins) {
            if (descriptors.has(name)) continue;
            out.push({ name, descriptor: null, plugin, post_kind: plugin.post_kind || "", address: plugin.address || "" });
        }
        return out;
    };
    svc.affordanceForPostKind = async (kind) => (await svc.affordances()).find((a) => a.post_kind && a.post_kind === kind) || null;
    svc.affordanceNamed = async (name) => (await svc.affordances()).find((a) => a.name === name) || null;

    const SCRIPT_PARK = "scranton:scripts";
    const isScriptFrame = (frame) =>
        frame?.data?.post?.kind === "navi_script" ||
        String(frame?.data?.content_type || "").split(";")[0].trim().toLowerCase() === "application/navi-script";
    /** Posted script generations live here, keyed by their real ib^gib, never as a tip at the script address. */
    const scriptFrame = async (addr) => {
        const bag = await navi.storage.item.get(SCRIPT_PARK).catch(() => null);
        const frame = bag?.frames?.[addr];
        return frame?.data ? frame : null;
    };
    const rememberScriptFrame = async (addr, frame) => {
        const bag = (await navi.storage.item.get(SCRIPT_PARK).catch(() => null)) || {};
        const frames = { ...(bag.frames || {}) };
        if (!frames[addr]) {
            frames[addr] = frame;
            await navi.storage.item.set(SCRIPT_PARK, { ...bag, frames }).catch(() => null);
        }
        const ib = splitAddr(addr)[0];
        const local = ib ? await localTip(ib).catch(() => null) : null;
        if (local && isScriptFrame(local.frame)) {
            await navi.storage.tip.del(ib).catch(() => null);
            return;
        }
        const sitting = await navi.storage.tip.frame.get(addr).catch(() => null);
        if (sitting && isScriptFrame(sitting)) await navi.storage.tip.frame.del(addr).catch(() => null);
    };

    /** A generation by ib^gib: frame space first; host frames whose gib is sha256(data) get parked there. */
    svc.getFrameByAddr = async (addr, { kind = "content" } = {}) => {
        if (frameCache.has(addr)) return frameCache.get(addr);
        let frame = await scriptFrame(addr);
        if (!frame?.data) frame = await navi.storage.tip.frame.get(addr).catch(() => null);
        if (frame?.data && isScriptFrame(frame)) await rememberScriptFrame(addr, frame);
        if (!frame?.data) {
            const res = await fetch(`${originHost()}/foobarch/frame/${encodeURIComponent(addr)}`, {
                headers: { Accept: "application/json", "X-Navi-Park-Bypass": "1" },
            });
            if (res.status === 404) return null;
            if (!res.ok) throw new Error(`frame ${addr} → ${res.status}`);
            frame = await res.json();
            const [ib, gib] = splitAddr(addr);
            if (ib && gib && frame?.data && (await sha256Hex(JSON.stringify(frame.data))).toUpperCase() === gib) {
                if (isScriptFrame(frame)) await rememberScriptFrame(addr, frame);
                else await parkTip({ ib, addr, frame }, { pointer: false, kind }).catch(() => null);
            }
        }
        frameCache.set(addr, frame);
        return frame;
    };

    /** Append rows of the page's lobby, resolved to post frames (read-only, no tokens). */
    svc.postsFor = async (pathRaw) => {
        const path = encodePath(pathRaw);
        const ib = svc.lobbyIb(path);
        const tip = await svc.readTip(ib);
        if (!tip || tip.tombstone) return { ib, lobby: false, list: [] };
        const rows = svc.normalizeAppend(tip.frame?.data?.lobby?.append);
        const list = await Promise.all(
            rows.map(async (row, index) => {
                const item = { index, row, addr: row.addr, ib: row.addr.split("^")[0], post: null, kind: "", valid: false, reason: "" };
                try {
                    const frame = await svc.getFrameByAddr(row.addr);
                    const p = frame?.data?.post;
                    if (!p || typeof p !== "object") {
                        item.reason = "not a post";
                        return item;
                    }
                    item.frame = frame;
                    item.post = p;
                    item.kind = String(p.kind || "");
                    if (p.author !== row.by) item.reason = "author did not sign this row";
                    else if (encodePath(p.page) !== path) item.reason = `posted to ${p.page}, not this page`;
                    else if (p.lobby && encodePath(p.lobby) !== ib) item.reason = `names lobby ${p.lobby}, not ${ib}`;
                    else item.valid = true;
                } catch (e) {
                    item.reason = e.message || String(e);
                }
                return item;
            })
        );
        return { ib, lobby: true, list };
    };

    // ─── address affordances (e.g. comments/{page}) ───
    // Descriptor fields: address ("comments/{page}"), key (data key of the state, default name),
    // policy_ib (every write gate), fields ({ text: { max } } — what a row carries besides by/at),
    // columns (render order). Valid instance: carries policy_ib since its first generation, which
    // started with no rows; state.affordance names the descriptor; state.page is the page.

    const addressDescriptor = async (name) => {
        const a = await svc.affordanceNamed(name);
        const d = a?.descriptor;
        if (!d?.address) throw new Error(`no address affordance '${name}' (scranton_lobby affordance list)`);
        if (!d.policy_ib) throw new Error(`affordance '${name}' names no policy_ib`);
        return d;
    };
    svc.addressOf = (d, pageRaw) => encodePath(String(d.address).replace("{page}", encodePath(pageRaw)));
    const stateKey = (d) => d.key || d.name;

    /** First generation of `ib` (remembered in the park ledger; the frame itself lives in frame space). */
    const firstGeneration = async (ib) => {
        const known = (await ledgerRow(ib))?.first;
        if (known) {
            const f = await svc.getFrameByAddr(known, { kind: "address" }).catch(() => null);
            if (f) return f;
        }
        const res = await fetch(`${originHost()}/foobarch/span/${ib}?dir=forward&limit=1&addrsOnly=1`);
        if (!res.ok) throw new Error(`span ${ib} → ${res.status}`);
        const addr = (await res.json())?.hits?.[0];
        if (!addr) return null;
        if (await parks("address")) await patchLedger(ib, { first: addr });
        return svc.getFrameByAddr(addr, { kind: "address" });
    };

    /**
     * Your pending ops laid over committed rows. Pushes not on the host yet carry `_pending: true` and
     * `_park`: "created - hostparking..." while the write is in flight, or what's holding it up.
     */
    const parkStatus = (error) => (error ? `created - hostpark waiting: ${error} (scranton_lobby park sync retries)` : "created - hostparking...");
    const withPending = (rows, pending, error = "") => {
        let view = rows.slice();
        for (const op of pending) {
            if (op.op === "push" && !view.some((r) => rowKey(r) === rowKey(op.row))) view.push({ ...op.row, _pending: true, _park: parkStatus(error) });
            if (op.op === "delete") view = view.filter((r) => rowKey(r) !== op.key);
        }
        return view;
    };

    /**
     * Read an address affordance for a page: { ib, exists, valid, reason, rows, committedRows, pending, state, tip }.
     * `rows` is what to show (committed rows plus your pending ones); `committedRows` is what the frame holds.
     * fresh: read the host now (writes); default reads the parked frame and refreshes lazily.
     */
    svc.readAddress = async (name, pageRaw, { fresh = false } = {}) => {
        const d = await addressDescriptor(name);
        const page = encodePath(pageRaw);
        const ib = svc.addressOf(d, page);
        const tip = await rawTip(ib, { fresh });
        const parkRow = await ledgerRow(ib);
        const pending = parkRow?.pending || [];
        const parkError = pending.length ? parkRow?.error || "" : "";
        if (!tip) {
            const rows = withPending([], pending, parkError);
            return { name, ib, page, exists: false, valid: false, reason: "", rows, committedRows: [], pending: pending.length, descriptor: d };
        }
        const key = stateKey(d);
        const state = tip.frame?.data?.[key];
        const out = { name, ib, page, exists: true, valid: false, reason: "", rows: [], committedRows: [], pending: pending.length, state, tip, descriptor: d };
        if (!hasPolicy(tip.frame, d.policy_ib)) out.reason = `not gated by ${d.policy_ib}`;
        else if (!state || typeof state !== "object") out.reason = `no data.${key}`;
        else if (state.affordance !== d.ib) out.reason = `names affordance ${state.affordance || "(none)"}, not ${d.ib}`;
        else if (encodePath(state.page) !== page) out.reason = `for page ${state.page}, not ${page}`;
        else {
            const first = await firstGeneration(ib).catch(() => null);
            const firstRows = first?.data?.[key]?.rows;
            if (!first || !hasPolicy(first, d.policy_ib)) out.reason = "first generation was not gated";
            else if (!Array.isArray(firstRows) || firstRows.length) out.reason = "first generation did not start empty";
            else out.valid = true;
        }
        out.committedRows = out.valid && Array.isArray(state.rows) ? state.rows : [];
        out.rows = out.valid ? withPending(out.committedRows, pending, parkError) : [];
        return out;
    };

    const buildAddressFrame = async (ib, d, page, state, { base = null, parentAddr = null, n = 0 } = {}) => {
        const key = stateKey(d);
        const data = base
            ? { ...base.data, [key]: state, n, timestamp: new Date().toUTCString() }
            : {
                  parts: ["network_proposal", "ibgib_frame", "manifest", "json"],
                  contract: d.ib,
                  about: { label: d.label || d.name, description: d.description || `${d.name} for ${page}` },
                  [key]: state,
                  default_method: "GET",
                  method: { GET: { kind: "frame" }, PUT: { kind: "commit" }, PATCH: { kind: "commit" } },
                  n,
                  timestamp: new Date().toUTCString(),
              };
        const gib = (await sha256Hex(JSON.stringify(data))).toUpperCase();
        const rel8ns = base
            ? { ...(base.rel8ns || {}), past: [parentAddr] }
            : { policy: [d.policy_ib], past: [], tjp: [], dna: [] };
        return { ib, gib, data, rel8ns };
    };
    svc.buildAddressFrame = buildAddressFrame;

    /** An error that retrying can't fix (bad frame, policy refusal): the pending op is dropped. */
    const permanent = (msg) => Object.assign(new Error(msg), { permanent: true });
    const isPermanent = (e) => {
        if (e?.permanent) return true;
        const status = Number(/→ (\d{3})/.exec(String(e?.message || ""))?.[1] || 0);
        return status >= 400 && status < 500 && status !== 409 && status !== 429 && !/usage token/i.test(String(e?.message || ""));
    };

    const pendingOf = async (ib) => (await ledgerRow(ib))?.pending || [];
    const samePending = (a, b) => a.op === b.op && (a.op === "push" ? rowKey(a.row) === rowKey(b.row) : a.key === b.key);
    const addPending = async (ib, op) => patchLedger(ib, { pending: [...(await pendingOf(ib)), op] });
    const removePending = async (ib, op) => patchLedger(ib, { pending: (await pendingOf(ib)).filter((p) => !samePending(p, op)) });

    /** Apply one row op on the host's current generation (creating the frame for a first push). */
    const applyAddressOp = async (d, ib, page, op) => {
        const signer = await svc.lobbyKey();
        let read = await svc.readAddress(op.name, page, { fresh: true });
        if (read.exists && !read.valid) throw permanent(`${ib} exists but is not a valid ${op.name} frame: ${read.reason}`);
        let created = false;
        if (!read.exists) {
            if (op.op !== "push") return { addr: null, already: true };
            const state = { affordance: d.ib, page, lobby: svc.lobbyIb(page), created_at: op.row.at, creator: signer.publicKey, rows: [] };
            await svc.commit(ib, await buildAddressFrame(ib, d, page, state), { parentAddr: null, sign: true, signer });
            read = await svc.readAddress(op.name, page, { fresh: true });
            created = true;
        }
        const rows = read.committedRows;
        let next;
        if (op.op === "push") {
            if (rows.some((r) => rowKey(r) === rowKey(op.row))) return { addr: read.tip.addr, already: true, created };
            next = [...rows, op.row];
        } else {
            const hit = rows.find((r) => rowKey(r) === op.key);
            if (!hit) return { addr: read.tip.addr, already: true };
            if (hit.by !== signer.publicKey) throw permanent("only the row's author can delete it");
            next = rows.filter((r) => r !== hit);
        }
        const tip = read.tip;
        const frame = await buildAddressFrame(ib, d, page, { ...read.state, rows: next }, {
            base: tip.frame,
            parentAddr: tip.addr,
            n: Number(tip.frame?.data?.n || 0) + 1,
        });
        const out = await svc.commit(ib, frame, { parentAddr: tip.addr, sign: true, signer });
        return { addr: out.addr, created };
    };

    /** Capture an op locally, then try the host; a retryable failure leaves it pending. */
    const captureAddressOp = async (d, ib, page, op) => {
        if (!(await setting("write.capture"))) {
            const r = await applyAddressOp(d, ib, page, op);
            emitPark({ ib, change: "synced" });
            return { ...r, pending: false };
        }
        await addPending(ib, op);
        if (syncing.has(ib)) {
            emitPark({ ib, change: "pending" });
            return { pending: true, error: "", note: "created - hostparking..." };
        }
        await patchLedger(ib, { error: null });
        emitPark({ ib, change: "pending" });
        syncing.add(ib);
        try {
            const r = await applyAddressOp(d, ib, page, op);
            await removePending(ib, op);
            await patchLedger(ib, { error: null });
            emitPark({ ib, change: "synced" });
            return { ...r, pending: false };
        } catch (e) {
            const msg = e?.message || String(e);
            if (isPermanent(e)) {
                await removePending(ib, op);
                emitPark({ ib, change: "dropped" });
                throw e;
            }
            await patchLedger(ib, { error: msg });
            return { pending: true, error: msg };
        } finally {
            syncing.delete(ib);
        }
    };

    /** Replay pending row ops against the host (all ibs, or one). Stops an ib at its first retryable failure. */
    svc.parkSync = async (onlyIb = "") => {
        const out = [];
        for (const [ib, row] of Object.entries((await loadLedger()).ibs)) {
            if (onlyIb && ib !== onlyIb) continue;
            if (syncing.has(ib) || !row.pending?.length) continue;
            syncing.add(ib);
            let stuck = false;
            await patchLedger(ib, { error: null });
            emitPark({ ib, change: "pending" });
            try {
                for (const op of row.pending) {
                    try {
                        const d = await addressDescriptor(op.name);
                        const r = await applyAddressOp(d, ib, op.page, op);
                        await removePending(ib, op);
                        out.push({ ib, op: op.op, ok: true, addr: r.addr || null });
                    } catch (e) {
                        const drop = isPermanent(e);
                        if (drop) await removePending(ib, op);
                        await patchLedger(ib, { error: e.message || String(e) });
                        out.push({ ib, op: op.op, ok: false, error: e.message || String(e), dropped: drop });
                        if (!drop) {
                            stuck = true;
                            break;
                        }
                    }
                }
                if (!(await pendingOf(ib)).length) await patchLedger(ib, { error: null });
                emitPark({ ib, change: "synced" });
            } finally {
                syncing.delete(ib);
            }
            // Rows captured while this sync ran weren't in its list.
            if (!stuck && (await pendingOf(ib)).length) void syncLater(ib);
        }
        return out;
    };
    const syncLater = (ib) => svc.parkSync(ib).catch((e) => console.warn(`[scranton_lobby] park sync ${ib}:`, e.message || e));

    /**
     * Add one row (fields + by + at), captured local-first: readers see it at once (pending), then it
     * goes to the host. Creates the address frame first when missing (2 tokens then).
     */
    svc.addressPush = async (name, pageRaw, fields) => {
        const d = await addressDescriptor(name);
        const page = encodePath(pageRaw);
        const ib = svc.addressOf(d, page);
        const signer = await svc.lobbyKey();
        const row = {};
        for (const [f, spec] of Object.entries(d.fields || {})) {
            const v = String(fields?.[f] ?? "");
            if (!v.trim() && spec?.min !== 0) throw new Error(`${f} required`);
            if (spec?.max && v.length > spec.max) throw new Error(`${f} is longer than ${spec.max}`);
            row[f] = v;
        }
        row.by = signer.publicKey;
        row.at = new Date().toISOString();
        const r = await captureAddressOp(d, ib, page, { op: "push", name, page, row });
        return r.pending
            ? { ok: true, action: `${name}_push`, ib, row, pending: true, error: r.error, note: parkStatus(r.error) }
            : { ok: true, action: `${name}_push`, ib, addr: r.addr, row, created: !!r.created };
    };

    /** Remove one of your own rows (index into the rows readAddress shows). A pending row is just dropped. */
    svc.addressDelete = async (name, pageRaw, index) => {
        const read = await svc.readAddress(name, pageRaw);
        const row = read.rows[Number(index)];
        if (!row) throw new Error(`no row ${index}`);
        const signer = await svc.lobbyKey();
        if (row.by !== signer.publicKey) throw new Error("only the row's author can delete it");
        if (row._pending) {
            await removePending(read.ib, { op: "push", row });
            emitPark({ ib: read.ib, change: "dropped" });
            return { ok: true, action: `${name}_delete`, ib: read.ib, removed: row, note: "deleted before it was hostparked" };
        }
        if (!read.exists || !read.valid) throw new Error(`no valid ${name} frame at ${read.ib}${read.reason ? `: ${read.reason}` : ""}`);
        const { _pending, ...clean } = row;
        const r = await captureAddressOp(read.descriptor, read.ib, read.page, { op: "delete", name, page: read.page, key: rowKey(clean) });
        return r.pending
            ? { ok: true, action: `${name}_delete`, ib: read.ib, removed: clean, pending: true, error: r.error, note: `deleted - hostpark waiting: ${r.error} (scranton_lobby park sync retries)` }
            : { ok: true, action: `${name}_delete`, ib: read.ib, addr: r.addr, removed: clean };
    };

    const bytesSha256 = async (bytes) => {
        const dig = await globalThis.crypto.subtle.digest("SHA-256", bytes);
        return Array.from(new Uint8Array(dig), (b) => b.toString(16).padStart(2, "0")).join("");
    };

    /**
     * The posted generation's content. Frames carry only `bin <sha>`, so fetch the park from the
     * host (local park may still be the previous bin) and accept the bytes only when they hash
     * to the posted generation's bin (a later swap is refused).
     */
    svc.postContent = async (x) => {
        const frame = x.frame || (await svc.getFrameByAddr(x.addr));
        const want = String(frame?.rel8ns?.bin?.[0] || "").split(" ")[1]?.toLowerCase();
        if (!want) throw new Error(`${x.addr} has no content`);
        const contentType = frame.data?.content_type || "";
        // Bins are addressed by sha, so a parked bin with the posted sha is the posted bytes.
        const parked = await navi.storage.bin.get(want).catch(() => null);
        if (typeof parked?.media === "string" && (await sha256Hex(parked.media)) === want) {
            return { text: parked.media, contentType };
        }
        const res = await fetch(`${originHost()}/${x.ib}`, {
            headers: { Accept: "*/*", "X-Navi-Park-Bypass": "1" },
        });
        if (!res.ok) throw new Error(`${x.ib} → ${res.status}`);
        const bytes = await res.arrayBuffer();
        if ((await bytesSha256(bytes)) !== want) throw new Error(`${x.ib} changed since it was posted`);
        const text = new TextDecoder().decode(bytes);
        if ((await parks("content")) && (await sha256Hex(text)) === want) {
            await navi.storage.bin.put(want, { media: text, mime: contentType || "text/plain" }).catch(() => null);
        }
        return { text, contentType };
    };

    // ─── trust ───
    // Trusted keys are lobby pubkeys (the `by` / post.author keys). Trusting an identity trusts every
    // key on its frens list: <identity>/frens with data.frens { identity, keys[], labels?, identities? }
    // and data.frens_sig { key, sig } — an ed25519 signature over FRENS_SIG_PREFIX + JSON(frens) by a key
    // listed in policies/<identity> (data.keys), or by an editor the identity named in
    // data.frens_editors { identity, editors[], sig: { key, sig } } (signed over EDITORS_SIG_PREFIX +
    // JSON({ identity, editors }) by a policies/<identity> key). frens.identities are identities this
    // one vouches for: followed while the trust entry's hops allow (default 1 = keys only).
    // Plugins ask lobby.isTrusted(pubkey) before acting alone.
    const STORAGE_TRUST = "scranton_lobby_v1.trust";
    const FRENS_SIG_PREFIX = "scranton-frens-v1\n";
    const EDITORS_SIG_PREFIX = "scranton-frens-editors-v1\n";
    const FRENS_TTL_MS = 60_000;
    const MAX_HOPS = 3;
    const frensCache = new Map();

    svc.frensIb = (identity) => `${encodePath(identity)}/frens`;
    svc.frensMessage = (frens) => FRENS_SIG_PREFIX + JSON.stringify(frens);
    svc.editorsMessage = (identity, editors) => EDITORS_SIG_PREFIX + JSON.stringify({ identity, editors });

    const verifyEd25519 = async (publicKey, message, signature) => {
        try {
            const b = atob(String(signature).replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(String(signature).length / 4) * 4, "="));
            const sig = Uint8Array.from(b, (c) => c.charCodeAt(0));
            const key = await globalThis.crypto.subtle.importKey("jwk", { kty: "OKP", crv: "Ed25519", x: String(publicKey) }, { name: "Ed25519" }, false, ["verify"]);
            return await globalThis.crypto.subtle.verify({ name: "Ed25519" }, key, sig, new TextEncoder().encode(message));
        } catch {
            return false;
        }
    };

    /** <identity>/frens, checked against the identity's policy keys: { ib, exists, valid, reason, keys, labels, signer }. */
    svc.readFrens = async (identityRaw, { fresh = false } = {}) => {
        const identity = encodePath(identityRaw);
        const hit = frensCache.get(identity);
        if (!fresh && hit && Date.now() - hit.at < FRENS_TTL_MS) return hit.out;
        const ib = svc.frensIb(identity);
        const out = { identity, ib, exists: false, valid: false, reason: "", keys: [], labels: {}, identities: [], signer: "", editors: [], idKeys: [], tip: null };
        const tip = await rawTip(ib, { fresh });
        if (tip) {
            out.exists = true;
            out.tip = tip;
            const frens = tip.frame?.data?.frens;
            const sig = tip.frame?.data?.frens_sig;
            const policy = await rawTip(`policies/${identity}`, { fresh }).catch(() => null);
            const idKeys = Array.isArray(policy?.frame?.data?.keys) ? policy.frame.data.keys : [];
            out.idKeys = idKeys;
            const ed = tip.frame?.data?.frens_editors;
            if (
                ed?.identity === identity &&
                Array.isArray(ed.editors) &&
                ed.sig?.key &&
                idKeys.includes(ed.sig.key) &&
                (await verifyEd25519(ed.sig.key, svc.editorsMessage(identity, ed.editors), ed.sig.sig))
            ) {
                out.editors = ed.editors.filter((k) => typeof k === "string" && k);
            }
            if (!frens || typeof frens !== "object" || !Array.isArray(frens.keys)) out.reason = "no data.frens.keys";
            else if (frens.identity !== identity) out.reason = `names identity ${frens.identity || "(none)"}`;
            else if (!idKeys.length) out.reason = `policies/${identity} lists no keys`;
            else if (!sig?.key || !(idKeys.includes(sig.key) || out.editors.includes(sig.key))) out.reason = `not signed by a policies/${identity} key or a named editor`;
            else if (!(await verifyEd25519(sig.key, svc.frensMessage(frens), sig.sig))) out.reason = "bad signature";
            else {
                out.valid = true;
                out.keys = frens.keys.filter((k) => typeof k === "string" && k);
                out.labels = frens.labels && typeof frens.labels === "object" ? frens.labels : {};
                out.identities = Array.isArray(frens.identities) ? frens.identities.filter((k) => typeof k === "string" && k).map(encodePath) : [];
                out.signer = sig.key;
            }
        }
        frensCache.set(identity, { at: Date.now(), out });
        return out;
    };

    /**
     * Change <identity>/frens from this browser: your lobby key must be an editor the identity named
     * (frens_editors) and on the write policy (policies/<identity>/frens — `_hostpark_frens.mjs editor add`).
     * edit: { add?, rm?, label?, addIdentity?, rmIdentity? }. 1 token.
     */
    svc.frensEdit = async (identityRaw, edit = {}) => {
        const cur = await svc.readFrens(identityRaw, { fresh: true });
        if (!cur.exists) throw new Error(`${cur.ib} does not exist yet (the identity creates it: _hostpark_frens.mjs init)`);
        const signer = await svc.lobbyKey();
        if (!cur.editors.includes(signer.publicKey)) throw new Error(`your lobby key is not an editor of ${cur.ib} (ask the identity: _hostpark_frens.mjs --identity ${cur.identity} editor add ${signer.publicKey})`);
        if (!cur.valid && !/signature|signed/.test(cur.reason)) throw new Error(`${cur.ib}: ${cur.reason}`);
        const prev = cur.tip.frame.data.frens || {};
        const keys = Array.isArray(prev.keys) ? [...prev.keys] : [];
        const labels = prev.labels && typeof prev.labels === "object" ? { ...prev.labels } : {};
        const identities = Array.isArray(prev.identities) ? [...prev.identities] : [];
        const k = String(edit.add || edit.rm || "").trim();
        if (edit.add) {
            if (!keys.includes(k)) keys.push(k);
            if (edit.label) labels[k] = String(edit.label);
        } else if (edit.rm) {
            if (!keys.includes(k)) throw new Error(`${k} is not on ${cur.ib}`);
            keys.splice(keys.indexOf(k), 1);
            delete labels[k];
        } else if (edit.addIdentity) {
            const id = encodePath(edit.addIdentity);
            if (id === cur.identity) throw new Error("an identity cannot vouch for itself");
            if (!identities.includes(id)) identities.push(id);
        } else if (edit.rmIdentity) {
            const id = encodePath(edit.rmIdentity);
            if (!identities.includes(id)) throw new Error(`${id} is not vouched for on ${cur.ib}`);
            identities.splice(identities.indexOf(id), 1);
        } else {
            throw new Error("nothing to change");
        }
        const frens = { identity: cur.identity, keys, labels, ...(identities.length ? { identities } : {}), updated_at: new Date().toISOString() };
        const signed = await svc.keychain().signMessage({ message: svc.frensMessage(frens), key: signer.name });
        const tip = cur.tip;
        const data = { ...tip.frame.data, frens, frens_sig: { key: signed.publicKey, sig: signed.signature }, n: Number(tip.frame.data.n || 0) + 1, timestamp: new Date().toUTCString() };
        const rel8ns = { ...(tip.frame.rel8ns || {}), past: [tip.addr] };
        const gib = (await sha256Hex(JSON.stringify({ data, rel8ns }))).toUpperCase();
        const out = await svc.commit(cur.ib, { ib: cur.ib, gib, data, rel8ns }, { parentAddr: tip.addr, sign: true, signer });
        frensCache.delete(cur.identity);
        return { ok: true, ib: cur.ib, addr: out.addr, keys: keys.length, identities };
    };

    svc.trustList = async () => {
        const v = await navi.storage.item.get(STORAGE_TRUST);
        return {
            keys: v?.keys && typeof v.keys === "object" ? v.keys : {},
            identities: v?.identities && typeof v.identities === "object" ? v.identities : {},
        };
    };
    const saveTrust = (t) => navi.storage.item.set(STORAGE_TRUST, t);

    svc.trustKey = async (pub, on = true, label = "") => {
        const k = String(pub || "").trim();
        if (!k) throw new Error("pubkey required");
        const t = await svc.trustList();
        if (on) t.keys[k] = { label: String(label || ""), at: new Date().toISOString() };
        else delete t.keys[k];
        await saveTrust(t);
        return t;
    };
    /** hops: 1 = the identity's frens keys; 2 = also the keys of identities it vouches for; … (max 3). */
    svc.trustIdentity = async (identityRaw, on = true, hops = 1) => {
        const id = encodePath(identityRaw);
        if (!id) throw new Error("identity required");
        const h = Math.max(1, Math.min(MAX_HOPS, Math.floor(Number(hops) || 1)));
        const t = await svc.trustList();
        if (on) t.identities[id] = { at: new Date().toISOString(), hops: h };
        else delete t.identities[id];
        await saveTrust(t);
        return t;
    };

    /** { trusted, via: "key" | "frens of <identity>" | "frens of <b> (via <a>)" | "" } */
    svc.isTrusted = async (pub) => {
        const k = String(pub || "");
        if (!k) return { trusted: false, via: "" };
        const t = await svc.trustList();
        if (t.keys[k]) return { trusted: true, via: "key" };
        const seen = new Set();
        let level = Object.entries(t.identities).map(([id, v]) => ({ id, hops: Math.min(MAX_HOPS, Number(v?.hops) || 1), path: [] }));
        while (level.length) {
            const next = [];
            for (const n of level) {
                if (seen.has(n.id)) continue;
                seen.add(n.id);
                const f = await svc.readFrens(n.id).catch(() => null);
                if (!f?.valid) continue;
                if (f.keys.includes(k)) return { trusted: true, via: `frens of ${n.id}${n.path.length ? ` (via ${n.path.join(" → ")})` : ""}` };
                if (n.hops > 1) for (const id of f.identities) next.push({ id, hops: n.hops - 1, path: [...n.path, n.id] });
            }
            level = next;
        }
        return { trusted: false, via: "" };
    };

    // ─── personal filter ───
    // Local only (never written to any frame): hidden authors (keys), hidden post kinds, and an
    // only-trusted mode. Hidden posts and rows are left out of surf hooks and folded away in surfroster.
    const STORAGE_HIDE = "scranton_lobby_v1.hide";
    svc.hideList = async () => {
        const v = await navi.storage.item.get(STORAGE_HIDE);
        return {
            keys: v?.keys && typeof v.keys === "object" ? v.keys : {},
            kinds: v?.kinds && typeof v.kinds === "object" ? v.kinds : {},
            only_trusted: v?.only_trusted !== false,
        };
    };
    const saveHide = (h) => navi.storage.item.set(STORAGE_HIDE, h);
    svc.hideKey = async (pub, on = true, label = "") => {
        const k = String(pub || "").trim();
        if (!k) throw new Error("pubkey required");
        const h = await svc.hideList();
        if (on) h.keys[k] = { label: String(label || ""), at: new Date().toISOString() };
        else delete h.keys[k];
        await saveHide(h);
        return h;
    };
    svc.hideKind = async (kind, on = true) => {
        const k = String(kind || "").trim();
        if (!k) throw new Error("kind required");
        const h = await svc.hideList();
        if (on) h.kinds[k] = { at: new Date().toISOString() };
        else delete h.kinds[k];
        await saveHide(h);
        return h;
    };
    svc.setOnlyTrusted = async (on) => {
        const h = await svc.hideList();
        h.only_trusted = !!on;
        await saveHide(h);
        return h;
    };
    /** { hidden, why } for an author key and (for posts) a kind. */
    svc.isHidden = async (author, kind = "") => {
        const h = await svc.hideList();
        if (author && h.keys[author]) return { hidden: true, why: "author hidden" };
        if (kind && h.kinds[kind]) return { hidden: true, why: `${kind} hidden` };
        if (h.only_trusted && author !== (await svc.lobbyKey().catch(() => null))?.publicKey && !(await svc.isTrusted(author)).trusted) {
            return { hidden: true, why: "not trusted (showing trusted only)" };
        }
        return { hidden: false, why: "" };
    };

    // ─── gates ───
    // A post may carry post.gate { from }, a row a `from` field: it applies itself on surf only when you
    // arrive from that page. `from` is a surf path; a trailing * matches any path under the prefix.
    svc.prevSurfPath = "";
    svc.gateOpen = (from, arrivedFrom = svc.prevSurfPath) => {
        const want = String(from || "").trim();
        if (!want) return true;
        const was = encodePath(arrivedFrom);
        if (want.endsWith("/*")) {
            const p = encodePath(want.slice(0, -2));
            return was === p || was.startsWith(p + "/");
        }
        if (want.endsWith("*")) return was.startsWith(encodePath(want.slice(0, -1)));
        return was === encodePath(want);
    };
    svc.gateOf = (item) => String(item?.post?.gate?.from ?? item?.from ?? "").trim();

    svc.lastSurfPath = "";

    /**
     * On surf, in plugin `order` (default 10; a whole-stage replace goes before placements):
     * post affordances get that page's valid posts of their kind; address affordances get readAddress().
     */
    // Reads here are local-first, so a page you've been to directs your stage from what's parked.
    // When the host refresh brings something new for this page, the hooks run again with only the
    // posts and rows they haven't been handed yet this visit. An item they already ran whose host
    // version differs (same row, other content) runs again only if the plugin's rerunHost(item, ctx)
    // says so, else when the hooks.rerun setting is "run".
    let surfSeen = { page: "", ibs: new Set(), keys: new Map() };
    const runSurfPlugins = async (surfPath, arrivedFrom = "", { again = false, scripts = true, onlyAddrs = null } = {}) => {
        const page = encodePath(surfPath);
        if (!page) return;
        if (again && surfSeen.page !== page) return;
        if (!again) surfSeen = { page, ibs: new Set([svc.lobbyIb(page)]), keys: new Map() };
        const seen = surfSeen;
        const rerun = await setting("hooks.rerun");
        const fresh = async (key, print, item, a, ctx) => {
            if (!seen.keys.has(key)) {
                seen.keys.set(key, print);
                return true;
            }
            if (seen.keys.get(key) === print) return false;
            const yes = typeof a.plugin.rerunHost === "function" ? !!(await a.plugin.rerunHost(item, ctx)) : rerun === "run";
            if (yes) seen.keys.set(key, print);
            return yes;
        };
        const rowPrint = (row) => {
            const { _pending, _park, ...clean } = row;
            return JSON.stringify(clean);
        };
        const acts = async (author, kind, gate) => svc.gateOpen(gate, arrivedFrom) && !(await svc.isHidden(author, kind)).hidden;
        const hooks = (await svc.affordances().catch(() => []))
            .filter((a) => (a.post_kind || a.address) && typeof a.plugin?.onSurf === "function")
            .sort((a, b) => (a.plugin.order ?? 10) - (b.plugin.order ?? 10));
        if (!hooks.length) return;
        let found = null;
        if (hooks.some((a) => a.post_kind)) {
            try {
                found = await svc.postsFor(page);
            } catch (e) {
                console.warn("[scranton_lobby] posts:", e.message || e);
            }
        }
        for (const a of hooks) {
            if (a.post_kind === "navi_script" && !scripts) continue;
            const ctx = { path: page, lobby: svc, affordance: a, arrivedFrom };
            try {
                if (a.post_kind) {
                    const mine = [];
                    for (const x of found?.list || []) {
                        if (onlyAddrs && !onlyAddrs.has(x.addr)) continue;
                        if (!x.valid || x.kind !== a.post_kind || !(await acts(x.post?.author, x.kind, svc.gateOf(x)))) continue;
                        if (await fresh(`post|${x.addr}`, x.addr, x, a, ctx)) mine.push(x);
                    }
                    if (mine.length) await a.plugin.onSurf(mine, ctx);
                } else if (a.descriptor) {
                    const read = await svc.readAddress(a.name, page);
                    seen.ibs.add(read.ib);
                    const rows = [];
                    for (const row of read.valid ? read.rows : []) {
                        if ((await acts(row.by, "", svc.gateOf(row))) && (await fresh(`${read.ib}|${rowKey(row)}`, rowPrint(row), row, a, ctx))) rows.push(row);
                    }
                    if (rows.length) await a.plugin.onSurf({ ...read, rows }, ctx);
                }
            } catch (e) {
                console.warn(`[scranton_lobby] affordance ${a.name}:`, e.message || e);
            }
        }
    };

    svc.runSurfPlugins = runSurfPlugins;

    const NAVI_SCRIPT_MIME = "application/navi-script";
    const shortPub = (pub) => (pub ? `${String(pub).slice(0, 12)}…` : "?");
    const naviScriptJsProgram = (text) => {
        const kept = [];
        for (const line of String(text ?? "")
            .replace(/^\uFEFF/, "")
            .replace(/\r\n/g, "\n")
            .split("\n")) {
            const t = line.trim();
            if (!t || t.startsWith("#") || t.startsWith("//")) continue;
            kept.push(line.replace(/\s+$/, ""));
        }
        return kept.join("\n").trim();
    };
    svc.runNaviScriptPost = async (x) => {
        const { text } = await svc.postContent(x);
        const ib = String(x.ib || "").replace(/^navi:/i, "");
        if (typeof navi.script !== "function") throw new Error("navi.script is not available in this navi");
        const mode = x.post?.mode === "callin" ? "callin" : "js";
        const commands =
            mode === "callin"
                ? String(text || "").split(/\r?\n/)
                : (() => {
                      const body = naviScriptJsProgram(text);
                      return body ? [body] : [];
                  })();
        const r = await navi.script(commands, { mode, onError: "stop", label: ib });
        return `ran ${ib}: ${r?.ran ?? "?"} snippet(s)`;
    };
    const naviScriptPost = async (argsIn) => {
        const args = [...argsIn];
        const fi = args.indexOf("--from");
        const from = fi >= 0 ? encodePath(args.splice(fi, 2)[1]) : "";
        const flags = new Set(args.filter((a) => a.startsWith("--")));
        const [page, parkRaw, ...labelParts] = args.filter((a) => !a.startsWith("--"));
        const ib = encodePath(parkRaw);
        if (!page || !ib || (fi >= 0 && !from)) {
            return "usage: scranton_lobby script post <page> <script park path> [--callin] [--from <page>] [label…]";
        }
        const np = navi.mod?.netproposer;
        if (typeof np?.propose !== "function") throw new Error("mount netproposer first");
        const host = String((await np.getHost?.()) || "").replace(/\/+$/, "");
        const res = await fetch(`${host || ""}/${ib}`);
        if (!res.ok) throw new Error(`${ib} → ${res.status}`);
        const text = await res.text();
        if (!text.trim()) throw new Error(`${ib} is empty`);
        const pagePath = encodePath(page);
        let lt = await svc.getTip(svc.lobbyIb(pagePath));
        if (!lt || lt.tombstone) {
            await svc.create(pagePath);
            lt = await svc.getTip(svc.lobbyIb(pagePath));
        }
        const author = (await svc.signerFor(lt.frame?.data?.lobby)).publicKey;
        const mode = flags.has("--callin") ? "callin" : "js";
        const postData = {
            v: 1,
            kind: "navi_script",
            page: pagePath,
            lobby: svc.lobbyIb(pagePath),
            author,
            label: labelParts.join(" ") || ib.split("/").pop(),
            mode,
            ...(from ? { gate: { from } } : {}),
            created_at: new Date().toISOString(),
        };
        const r = await np.propose({
            ib,
            body: text,
            contentType: NAVI_SCRIPT_MIME,
            data: { post: postData, script_mode: mode, method: { GET: { kind: "bin" }, POST: { kind: "bin", script_mode: mode } } },
        });
        if (!r.addr) throw new Error(`${ib} saved but the host returned no address; append it by hand: scranton_lobby append push`);
        await svc.appendPush(pagePath, r.addr);
        return `posted script ${r.addr} on ${pagePath} → ${postData.lobby}${from ? ` (only when arriving from ${from})` : ""}`;
    };
    const naviScriptPlugin = {
        name: "navi_script",
        post_kind: "navi_script",
        label: "navi-script",
        order: 50,
        describe: (x) => `script "${x.post?.label || x.ib}"${x.post?.mode === "callin" ? " (callin)" : ""} · by ${shortPub(x.post?.author)}`,
        actions: async (x) => {
            const author = x.post?.author;
            const extra = [];
            if (author) {
                const t = await svc.isTrusted(author);
                if (!t.trusted || t.via === "key") {
                    extra.push(
                        t.trusted
                            ? {
                                  id: "untrust",
                                  label: "untrust author",
                                  title: `Stop auto-running scripts by ${author}`,
                                  run: async () => (await svc.trustKey(author, false), `untrusted ${shortPub(author)}`),
                              }
                            : {
                                  id: "trust",
                                  label: "trust author",
                                  title: `Run this author's posted scripts automatically when you surf to their page`,
                                  run: async () => (await svc.trustKey(author, true), `trusted ${shortPub(author)} — their scripts run on surf`),
                              }
                    );
                }
            }
            return [
                {
                    id: "show",
                    label: "show",
                    title: "Show the posted script text",
                    run: async () => ({ text: `${x.ib}:`, show: (await svc.postContent(x)).text }),
                },
                { id: "run", label: "run", title: `POST ${x.ib} (application/navi-script)`, run: () => svc.runNaviScriptPost(x) },
                ...extra,
            ];
        },
        onSurf: async (list, ctx) => {
            const say = (msg) => (typeof navi.callout === "function" ? navi.callout(msg) : console.log(msg));
            for (const x of list) {
                if (!(await svc.isTrusted(x.post?.author)).trusted) continue;
                try {
                    say(`[navi_script] ${ctx.path}: ${await svc.runNaviScriptPost(x)}`);
                } catch (e) {
                    say(`[navi_script] ${x.ib}: ${e.message || e}`);
                }
            }
        },
    };
    svc.registerAffordance(naviScriptPlugin);

    svc.onPark((ev) => {
        if (ev.change !== "host" && ev.change !== "both") return;
        if (!surfSeen.page || !surfSeen.ibs.has(ev.ib)) return;
        const inLobby = svc.hereIb && svc.hereIb === svc.lobbyIb(surfSeen.page);
        void runSurfPlugins(surfSeen.page, svc.prevSurfPath, { again: true, scripts: !!inLobby });
    });

    const HELP = [
        "scranton_lobby_v1_client — roster + append index (contract scranton_lobby_v1)",
        "",
        "  scranton_lobby tokens count [host]    unused tokens in the navi tokens stash (each write spends one)",
        "  scranton_lobby alias [name|-]         prefix {alias}/scranton/lobby/v1/…",
        "  scranton_lobby follow [on|off]        on: every surf leaves the old lobby and joins/creates the page's lobby",
        "  scranton_lobby create <path>          firstGen + self on roster; empty append",
        "  scranton_lobby join|leave|roster|ib <path>",
        "  scranton_lobby kick <path> <pubkey>   OP only",
        "  scranton_lobby enter <path> | exit | here | key | help",
        "  scranton_lobby append list <path>",
        "  scranton_lobby append push <path> <ib^gib>",
        "  scranton_lobby append update <path> <index|addr> <ib^gib>",
        "  scranton_lobby append delete <path> <index|addr>",
        "  scranton_lobby posts [path]           append rows that are posts (default: last surfed page)",
        "  scranton_lobby script post <page> <park> [--callin] [--from <page>] [label…]",
        "      re-park application/navi-script with data.post and append it; run is POST of that park",
        "  scranton_lobby affordance list | add <name> | rm <name>",
        "  scranton_lobby affordance read <name> [path]",
        "  scranton_lobby affordance push <name> <path> <text…>",
        "  scranton_lobby affordance delete <name> <path> <index>",
        "  scranton_lobby trust                  trusted keys + identities",
        "  scranton_lobby trust key <pubkey> [label] | untrust key <pubkey>",
        "  scranton_lobby trust identity <id> [hops] | untrust identity <id>   (every key on <id>/frens; hops 2-3 also follow the identities it vouches for)",
        "  scranton_lobby frens <id>             read + verify <id>/frens",
        "  scranton_lobby frens <id> add <pubkey> [label] | rm <pubkey>        edit it (your lobby key must be a named editor; 1 token)",
        "  scranton_lobby frens <id> vouch <identity> | unvouch <identity>",
        "  scranton_lobby trusted <pubkey>       is this key trusted, and why",
        "  scranton_lobby hide key <pubkey> [label] | hide kind <post kind> | unhide key|kind …",
        "  scranton_lobby show all|trusted       show everyone (minus hidden) or trusted authors only",
        "  scranton_lobby hidden                 your filter",
        "  scranton_lobby park                   localpark: parked scranton frames, pending rows, conflict pick",
        "  scranton_lobby park sync [ib]         send pending rows to the host",
        "  scranton_lobby park conflict both|host|local   host moved while rows are pending: show both (default), take host, keep local",
        "  scranton_lobby park refresh [ib] | drop <ib>   ask the host now (all frames read this session, or one) / forget the parked copy",
        "  scranton_lobby settings [list]        localpark, host checks, your rows, surf hooks, plus affordance settings",
        "  scranton_lobby settings set <key>|<affordance>:<key> <value>",
        "  scranton_lobby settings wizard|reset  walk through them again in surfroster (reset: back to defaults too)",
        "",
        "Posts: frames with data.post { kind, page, lobby, author } POSTed (appended) to a page's lobby.",
        "Valid only when author = the row's signer. A post affordance claims each kind.",
        `Affordances: ways to identify + interpret frames — descriptors at ${AFFORDANCE_ROOT}/<name>,`,
        "mods exposing affordancePlugin, or lobby.registerAffordance. Address affordances (e.g. comments/{page})",
        "live beside the page under their own policy; the lobby is never touched.",
        "Trust: plugins act on their own (auto-stage, auto-run) only for trusted authors. Your lobby key: scranton_lobby key.",
        "Gates: a post with post.gate.from (or a row with from) applies itself only when you arrive from that page (trailing * = prefix).",
        "Filter: hidden authors and kinds never act and are folded away in surfroster; nothing is written anywhere.",
        "Localpark: scranton frames are parked here under the host's ib^gib; reads and surf hooks use them first and",
        "refresh from the host lazily. Rows you add show at once and stay pending until the host takes them.",
        "",
        `Policy: ${POLICY_IB}  Tokens: navi.tokens`,
    ].join("\n");

    const fmt = (obj) =>
        typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);

    const run = async (...rawArgs) => {
        const args = rawArgs
            .flatMap((a) =>
                typeof a === "string" ? a.split(/\s+/).filter(Boolean) : [a]
            )
            .filter((a) => a != null && a !== "");
        const verb = String(args[0] || "help").toLowerCase();
        try {
            await svc.loadPrefs();
            switch (verb) {
                case "help":
                case "--help":
                case "-h":
                    return HELP;
                case "key":
                    return await svc.pubkey();
                case "alias":
                    if (args[1] == null) return svc.alias || "(none)";
                    return await svc.setAlias(args[1]);
                case "here":
                    return svc.hereIb || "(none)";
                case "posts": {
                    const path = encodePath(args.slice(1).join(" ")) || svc.lastSurfPath;
                    if (!path) return "usage: scranton_lobby posts <path>";
                    const r = await svc.postsFor(path);
                    if (!r.lobby) return `no lobby at ${r.ib}`;
                    if (!r.list.length) return `${r.ib}: no append rows`;
                    const lines = [`${r.ib}:`];
                    for (const x of r.list) {
                        const a = x.kind ? await svc.affordanceForPostKind(x.kind) : null;
                        const state = x.valid ? (a ? `→ ${a.name}${a.plugin ? "" : " (interpreter not mounted)"}` : "(no affordance)") : `✗ ${x.reason}`;
                        lines.push(`  [${x.index}] ${x.kind || "-"} ${x.addr} ${state}`);
                    }
                    return lines.join("\n");
                }
                case "script": {
                    const sub = String(args[1] || "").toLowerCase();
                    if (sub !== "post") return "usage: scranton_lobby script post <page> <script park path> [--callin] [--from <page>] [label…]";
                    return await naviScriptPost(args.slice(2));
                }
                case "affordance":
                case "affordances": {
                    const sub = String(args[1] || "list").toLowerCase();
                    if (sub === "list") {
                        await svc.loadDescriptors({ fresh: true });
                        const list = await svc.affordances();
                        if (!list.length) return "no affordances known";
                        return list
                            .map((a) => {
                                const what = a.post_kind ? `post kind ${a.post_kind}` : a.address ? `address ${a.address}` : "-";
                                const src = [a.descriptor ? a.descriptor.ib : "", a.plugin ? `plugin ${a.plugin.name}` : a.descriptor?.interpreter?.mod ? `needs mod ${a.descriptor.interpreter.mod}` : ""]
                                    .filter(Boolean)
                                    .join(" · ");
                                return `  ${a.name} — ${what} — ${src}`;
                            })
                            .join("\n");
                    }
                    if (sub === "add" || sub === "rm") {
                        if (!args[2]) return `usage: scranton_lobby affordance ${sub} <name>`;
                        const names = await svc.setLocalAffordance(args[2], sub === "add");
                        return `local affordances: ${names.join(", ") || "(none)"}`;
                    }
                    const name = args[2];
                    if (sub === "read") {
                        if (!name) return "usage: scranton_lobby affordance read <name> [path]";
                        const path = encodePath(args.slice(3).join(" ")) || svc.lastSurfPath;
                        const r = await svc.readAddress(name, path);
                        if (!r.exists) return `${r.ib}: none yet`;
                        if (!r.valid) return `${r.ib}: ✗ ${r.reason}`;
                        const cols = r.descriptor.columns || Object.keys(r.rows[0] || {});
                        return [`${r.ib}: ${r.rows.length} row(s)`, ...r.rows.map((row, i) => `  [${i}] ${cols.map((c) => (c === "by" ? String(row[c] || "").slice(0, 12) : row[c])).join(" · ")}`)].join("\n");
                    }
                    if (sub === "push") {
                        if (!name || args.length < 5) return "usage: scranton_lobby affordance push <name> <path> <text…>";
                        const d = await addressDescriptor(name);
                        const field = Object.keys(d.fields || {})[0];
                        if (!field) return `${name} rows take no fields`;
                        return fmt(await svc.addressPush(name, args[3], { [field]: args.slice(4).join(" ") }));
                    }
                    if (sub === "delete" || sub === "rm-row") {
                        if (!name || args.length < 5) return "usage: scranton_lobby affordance delete <name> <path> <index>";
                        return fmt(await svc.addressDelete(name, args[3], args[4]));
                    }
                    return "usage: scranton_lobby affordance list|add|rm|read|push|delete …";
                }
                case "trust":
                case "untrust": {
                    const on = verb === "trust";
                    const what = String(args[1] || "").toLowerCase();
                    if (!what && on) {
                        const t = await svc.trustList();
                        const keys = Object.entries(t.keys).map(([k, v]) => `  key ${k}${v.label ? ` (${v.label})` : ""}`);
                        const ids = [];
                        for (const [id, v] of Object.entries(t.identities)) {
                            const f = await svc.readFrens(id).catch((e) => ({ valid: false, reason: e.message || String(e), keys: [] }));
                            const hops = Number(v?.hops) > 1 ? ` · ${v.hops} hops` : "";
                            ids.push(`  identity ${id}${hops} — ${f.valid ? `${f.keys.length} fren(s)${f.identities.length ? `, vouches for ${f.identities.join(", ")}` : ""}` : f.exists === false ? "no frens frame yet" : `✗ ${f.reason}`}`);
                        }
                        return [...keys, ...ids].join("\n") || "trusting nobody yet";
                    }
                    if (what === "key" && args[2]) {
                        await svc.trustKey(args[2], on, args.slice(3).join(" "));
                        return `${on ? "trusted" : "untrusted"} key ${args[2]}`;
                    }
                    if (what === "identity" && args[2]) {
                        const t = await svc.trustIdentity(args[2], on, args[3]);
                        const id = encodePath(args[2]);
                        return on ? `trusted identity ${id} (${t.identities[id].hops} hop${t.identities[id].hops > 1 ? "s" : ""})` : `untrusted identity ${id}`;
                    }
                    return "usage: scranton_lobby trust [key <pubkey> [label] | identity <id> [hops]] · untrust key|identity …";
                }
                case "frens": {
                    if (!args[1]) return "usage: scranton_lobby frens <identity> [add <pubkey> [label] | rm <pubkey> | vouch <identity> | unvouch <identity>]";
                    const sub = String(args[2] || "").toLowerCase();
                    if (sub) {
                        if (!args[3]) return `usage: scranton_lobby frens ${args[1]} ${sub} <${sub.includes("vouch") ? "identity" : "pubkey"}>`;
                        const edit =
                            sub === "add" ? { add: args[3], label: args.slice(4).join(" ") }
                            : sub === "rm" ? { rm: args[3] }
                            : sub === "vouch" ? { addIdentity: args[3] }
                            : sub === "unvouch" ? { rmIdentity: args[3] }
                            : null;
                        if (!edit) return "usage: scranton_lobby frens <identity> add|rm|vouch|unvouch …";
                        const r = await svc.frensEdit(args[1], edit);
                        return `${r.ib} → ${r.addr} · ${r.keys} fren(s)${r.identities.length ? ` · vouches for ${r.identities.join(", ")}` : ""}`;
                    }
                    const f = await svc.readFrens(args[1], { fresh: true });
                    if (!f.exists) return `${f.ib}: none`;
                    if (!f.valid) return `${f.ib}: ✗ ${f.reason}`;
                    return [
                        `${f.ib}: signed by ${f.signer.slice(0, 12)}… · ${f.keys.length} fren(s)${f.editors.length ? ` · ${f.editors.length} editor(s)` : ""}`,
                        ...f.keys.map((k) => `  ${k}${f.labels[k] ? ` (${f.labels[k]})` : ""}`),
                        ...f.identities.map((id) => `  vouches for identity ${id}`),
                    ].join("\n");
                }
                case "hide":
                case "unhide": {
                    const on = verb === "hide";
                    const what = String(args[1] || "").toLowerCase();
                    if (what === "key" && args[2]) {
                        await svc.hideKey(args[2], on, args.slice(3).join(" "));
                        return `${on ? "hiding" : "showing"} author ${args[2]}`;
                    }
                    if (what === "kind" && args[2]) {
                        await svc.hideKind(args[2], on);
                        return `${on ? "hiding" : "showing"} ${args[2]} posts`;
                    }
                    return "usage: scranton_lobby hide key <pubkey> [label] | hide kind <post kind> · unhide key|kind …";
                }
                case "show": {
                    const v = String(args[1] || "").toLowerCase();
                    if (v !== "all" && v !== "trusted") return "usage: scranton_lobby show all|trusted";
                    await svc.setOnlyTrusted(v === "trusted");
                    return v === "trusted" ? "showing trusted authors only" : "showing everyone (minus hidden)";
                }
                case "hidden": {
                    const h = await svc.hideList();
                    const lines = [
                        h.only_trusted ? "showing trusted authors only" : "showing everyone (minus hidden)",
                        ...Object.entries(h.keys).map(([k, v]) => `  key ${k}${v.label ? ` (${v.label})` : ""}`),
                        ...Object.keys(h.kinds).map((k) => `  kind ${k}`),
                    ];
                    return lines.join("\n");
                }
                case "park": {
                    const sub = String(args[1] || "status").toLowerCase();
                    const target = args.slice(2).join("/");
                    if (sub === "status") {
                        const l = await loadLedger();
                        const rows = Object.entries(l.ibs);
                        const pending = rows.filter(([, r]) => r.pending?.length);
                        return [
                            `localpark: ${(await setting("park.on")) ? "on" : "off"} · ${rows.length} scranton ib(s) tracked · conflict pick: ${await setting("write.conflict")}`,
                            ...pending.map(([ib, r]) => `  ${ib}: ${r.pending.length} pending${r.error ? ` (last error: ${r.error})` : ""}`),
                            pending.length ? "send them: scranton_lobby park sync" : "nothing pending",
                        ].join("\n");
                    }
                    if (sub === "sync") {
                        const r = await svc.parkSync(target);
                        if (!r.length) return "nothing pending";
                        return r.map((x) => `  ${x.ib} ${x.op}: ${x.ok ? `ok ${x.addr || ""}` : `${x.dropped ? "dropped" : "still pending"} — ${x.error}`}`).join("\n");
                    }
                    if (sub === "conflict") {
                        const pick = String(args[2] || "").toLowerCase();
                        if (!pick) return `conflict pick: ${await setting("write.conflict")}`;
                        if (!CONFLICT_PICKS.includes(pick)) return "usage: scranton_lobby park conflict both|host|local";
                        await svc.setSettings({ "write.conflict": pick });
                        return `conflict pick: ${pick}`;
                    }
                    if (sub === "refresh") {
                        if (!target) return `asked the host about ${await svc.refreshParked()} parked frame(s)`;
                        const tip = await parkedTip(target, { fresh: true });
                        return tip ? `${target} → ${tip.addr}` : `${target}: not on the host`;
                    }
                    if (sub === "drop") {
                        if (!target) return "usage: scranton_lobby park drop <ib>";
                        await navi.storage.tip.del(target);
                        await dropLedger(target);
                        return `forgot the parked copy of ${target}`;
                    }
                    return "usage: scranton_lobby park [status|sync [ib]|conflict both|host|local|refresh [ib]|drop <ib>]";
                }
                case "settings": {
                    const sub = String(args[1] || "").toLowerCase();
                    if (!sub || sub === "list") {
                        const steps = await svc.settingSteps();
                        return steps
                            .map((s) =>
                                [
                                    `${s.label}${s.seen ? "" : " (not set up yet)"}`,
                                    ...s.fields.map((f) => `  ${s.affordance ? `${s.affordance}:` : ""}${f.key} = ${JSON.stringify(f.value)}  — ${f.label}`),
                                ].join("\n")
                            )
                            .join("\n");
                    }
                    if (sub === "set") {
                        const raw = String(args[2] || "");
                        if (!raw || args[3] === undefined) return "usage: scranton_lobby settings set <key>|<affordance>:<key> <value>";
                        const [aff, key] = raw.includes(":") ? raw.split(/:(.*)/s) : ["", raw];
                        const out = await svc.setSettings({ [key]: args.slice(3).join(" ") }, aff);
                        return `${raw} = ${JSON.stringify(out[key])}`;
                    }
                    if (sub === "wizard") {
                        await svc.resetSettings();
                        return "surfroster will walk you through the settings again (values kept)";
                    }
                    if (sub === "reset") {
                        await svc.resetSettings({ defaults: true });
                        return "settings back to defaults; surfroster will walk you through them again";
                    }
                    return "usage: scranton_lobby settings [list|set <key> <value>|wizard|reset]";
                }
                case "trusted": {
                    if (!args[1]) return "usage: scranton_lobby trusted <pubkey>";
                    const r = await svc.isTrusted(args[1]);
                    return r.trusted ? `trusted (${r.via})` : "not trusted";
                }
                case "follow": {
                    const v = String(args[1] || "").toLowerCase();
                    if (v === "on" || v === "off") await svc.setFollow(v === "on");
                    else if (v) return "usage: scranton_lobby follow [on|off]";
                    return `follow ${svc.follow ? "on — every surf joins or creates that page's lobby" : "off — only surfs into …/scranton/lobby/v1/… join"}`;
                }
                case "tokens": {
                    const sub = String(args[1] || "count").toLowerCase();
                    if (sub === "count") {
                        return fmt(await svc.tokensCount(args[2]));
                    }
                    return "usage: scranton_lobby tokens count [host]";
                }
                case "create":
                    return fmt(await svc.create(encodePath(args.slice(1).join(" "))));
                case "join":
                    return fmt(await svc.join(encodePath(args.slice(1).join(" "))));
                case "leave":
                    return fmt(
                        await svc.leave(
                            args[1] ? encodePath(args.slice(1).join(" ")) : ""
                        )
                    );
                case "kick": {
                    if (args.length < 3) {
                        return "usage: scranton_lobby kick <path> <pubkey>";
                    }
                    const guest = args[args.length - 1];
                    const path = encodePath(args.slice(1, -1).join(" "));
                    return fmt(await svc.kick(path, guest));
                }
                case "roster":
                    return fmt(await svc.roster(encodePath(args.slice(1).join(" "))));
                case "enter":
                    return fmt(await svc.enter(encodePath(args.slice(1).join(" "))));
                case "ib":
                    return svc.lobbyIb(encodePath(args.slice(1).join(" ")));
                case "exit":
                    return fmt(await svc.leave(""));
                case "append": {
                    const sub = String(args[1] || "list").toLowerCase();
                    if (sub === "list") {
                        const path = encodePath(args.slice(2).join(" "));
                        if (!path) return "usage: scranton_lobby append list <path>";
                        return fmt(await svc.appendList(path));
                    }
                    if (sub === "push") {
                        if (args.length < 4) {
                            return "usage: scranton_lobby append push <path> <ib^gib>";
                        }
                        const addr = args[args.length - 1];
                        const path = encodePath(args.slice(2, -1).join(" "));
                        return fmt(await svc.appendPush(path, addr));
                    }
                    if (sub === "update") {
                        if (args.length < 5) {
                            return "usage: scranton_lobby append update <path> <index|addr> <ib^gib>";
                        }
                        const addr = args[args.length - 1];
                        const key = args[args.length - 2];
                        const path = encodePath(args.slice(2, -2).join(" "));
                        return fmt(await svc.appendUpdate(path, key, addr));
                    }
                    if (sub === "delete" || sub === "del" || sub === "rm") {
                        if (args.length < 4) {
                            return "usage: scranton_lobby append delete <path> <index|addr>";
                        }
                        const key = args[args.length - 1];
                        const path = encodePath(args.slice(2, -1).join(" "));
                        return fmt(await svc.appendDelete(path, key));
                    }
                    return "usage: scranton_lobby append list|push|update|delete …";
                }
                default:
                    return `unknown: ${verb}\n\n${HELP}`;
            }
        } catch (e) {
            return `error: ${e.message || e}`;
        }
    };

    /** Page that actually landed. Surf's own commands (settings, flags) do not emit this. */
    const onSurf = async (surfPath) => {
        try {
            const page = encodePath(
                typeof surfPath === "string" ? surfPath : surfPath?.path || ""
            );
            if (!page) return;
            const arrivedFrom = svc.lastSurfPath;
            if (arrivedFrom !== page) svc.prevSurfPath = arrivedFrom;
            svc.lastSurfPath = page;
            const hit = svc.parseLobbyPathFromSurf(page);
            const lobbyIb = hit?.ib || (svc.follow ? svc.lobbyIb(page) : "");
            const local = lobbyIb ? await localTip(lobbyIb) : null;
            const localAddrs = lobbyIb
                ? new Set(svc.normalizeAppend(local?.frame?.data?.lobby?.append).map((r) => r.addr))
                : null;
            const result = await svc.onSurfPath(page);
            if (result) {
                navi.callout?.(
                    `[scranton_lobby] ${result.ok === false ? result.error : result.action || "ok"} ${result.ib || ""}`
                );
            }
            const entered = !!(result && result.ok !== false && svc.hereIb);
            await runSurfPlugins(page, svc.prevSurfPath, { scripts: entered, onlyAddrs: localAddrs });
            if (!lobbyIb) return;
            const now = await localTip(lobbyIb);
            if (now?.addr && now.addr !== local?.addr) {
                await runSurfPlugins(page, svc.prevSurfPath, { again: true, scripts: entered && svc.hereIb === lobbyIb });
            }
            void refreshLater(lobbyIb, lobbyCheck(lobbyIb), now || local, { force: true });
        } catch (e) {
            console.warn("[scranton_lobby] surf hook:", e.message || e);
        }
    };

    return {
        name: "scranton_lobby",
        version: "1.14.6",
        description:
            "scranton_lobby_v1 — roster + append ib^gib index (hostpark)",

        moduleInfo: {
            name: "scranton_lobby",
            version: "1.14.6",

    return {
        name: "scranton_lobby",
        version: "1.14.0",
        description:
            "scranton_lobby_v1 — roster + append ib^gib index (hostpark)",

        moduleInfo: {
            name: "scranton_lobby",
            version: "1.14.0",
            description:
                "Contract scranton_lobby_v1 — roster join/leave/kick; append list/push/update/delete",
            contract: CONTRACT,
            policy_ib: POLICY_IB,
        },

        commands: {
            scranton_lobby: {
                name: "scranton_lobby",
                description:
                    "scranton_lobby create|join|leave|kick|roster|enter|append|script post|tokens",
                execute: async (...args) => run(...args),
            },
        },

        /** Live service for HTMF / other mods (roster, append*, hereIb, …). */
        lobby: svc,
        affordancePlugin: naviScriptPlugin,

        onMount: async () => {
            await svc.loadPrefs();
            if (typeof navi.on === "function") {
                navi.on("callin", onCallin);
                eventListeners.push({
                    target: navi,
                    type: "callin",
                    fn: onCallin,
                });
            }
            console.log(
                `[scranton_lobby_v1_client] ready — contract ${CONTRACT}; policy ${POLICY_IB}`
            );
        },

        onUnmount: () => {
            for (const { target, type, fn, opts } of eventListeners) {
                try {
                    target.off?.(type, fn);
                    target.removeEventListener?.(type, fn, opts);
                } catch {
                    /* ignore */
                }
            }
            for (const t of timers) clearTimeout(t);
            for (const o of observers) {
                try {
                    o.disconnect?.();
                } catch {
                    /* ignore */
                }
            }
            for (const el of createdElements) {
                try {
                    el.remove?.();
                } catch {
                    /* ignore */
                }
            }
            for (const style of addedStyles) {
                try {
                    style.remove?.();
                } catch {
                    /* ignore */
                }
            }
        },
    };
};
