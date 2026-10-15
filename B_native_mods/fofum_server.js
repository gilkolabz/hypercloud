/**
 * fofum_server — native-only Navi module: Fofum identity API on :3114.
 *
 * Drop-in for hypercloud/fofum HTTP shape. Accounts, sessions, and admin
 * tokens live in navi.storage.tip (not BadgerDB / .fofum_config.json).
 *
 * Callin:
 *   fofum_server start [port]     Bind localhost (default 3114)
 *   fofum_server stop | status | help
 *   fofum_server password         Show usage password
 *   fofum_server users            List usernames
 *
 * HTTP (localhost, CORS like Go fofum):
 *   GET  /
 *   POST /admin/auth
 *   GET  /admin/info
 *   GET  /admin/users
 *   DELETE /admin/users?username=
 *   POST /accounts/create
 *   POST /auth/login
 *   POST /auth/validate
 *   POST /auth/prove
 *   POST /auth/logout
 *   GET  /auth/whoami
 */

export const register = (navi) => {
    const isBrowser =
        typeof window !== "undefined" && typeof window.document !== "undefined";
    const isNode =
        typeof process !== "undefined" &&
        !!(process.versions && process.versions.node);

    const eventListeners = [];
    const createdElements = [];
    const addedStyles = [];
    const observers = [];
    const timers = [];

    const DEFAULT_PORT = 3114;
    const LISTEN_HOST = "localhost";
    const TOKEN_TTL_MS = 2 * 60 * 60 * 1000;
    const USERNAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{2,63}$/;
    const SECRET_CHARSET =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

    const TIP = {
        config: "fofum_server/config",
        users: "fofum_server/users",
        user: (username) => `fofum_server/user/${username}`,
        session: (token) => `fofum_server/session/${token}`,
    };

    const STORAGE = {
        port: "fofum_server.port",
    };

    const nodeRequire = (id) => navi.require(id);

    function log(...args) {
        console.log("[fofum_server]", ...args);
    }

    function warn(...args) {
        console.warn("[fofum_server]", ...args);
    }

    function generateSecret(n = 32) {
        const crypto = nodeRequire("crypto");
        const bytes = crypto.randomBytes(n);
        let out = "";
        for (let i = 0; i < n; i++) {
            out += SECRET_CHARSET[bytes[i] % SECRET_CHARSET.length];
        }
        return out;
    }

    function hashPassword(password) {
        const crypto = nodeRequire("crypto");
        const salt = crypto.randomBytes(16).toString("hex");
        const hash = crypto
            .scryptSync(String(password), salt, 64)
            .toString("hex");
        return { algo: "scrypt", salt, hash };
    }

    function checkPassword(stored, password) {
        if (!stored || typeof stored !== "object") return false;
        const crypto = nodeRequire("crypto");
        const salt = String(stored.salt || "");
        const want = String(stored.hash || "");
        if (!salt || !want) return false;
        const got = crypto.scryptSync(String(password), salt, 64).toString("hex");
        try {
            return crypto.timingSafeEqual(
                Buffer.from(got, "hex"),
                Buffer.from(want, "hex")
            );
        } catch {
            return false;
        }
    }

    function validateUsername(username) {
        if (!USERNAME_RE.test(String(username || ""))) {
            return "username must be 3-64 chars, alphanumeric start, [a-zA-Z0-9._-] only";
        }
        return null;
    }

    class FofumNativeServer {
        constructor() {
            this.port = DEFAULT_PORT;
            this.server = null;
            this.listening = false;
            this.usagePassword = null;
            /** @type {Record<string, { created_at: string, expires_at: string, last_used: string }>} */
            this.activeAdmin = {};
            this._lock = Promise.resolve();
            this._configReady = false;
        }

        async withLock(fn) {
            const prev = this._lock;
            let release;
            this._lock = new Promise((r) => {
                release = r;
            });
            await prev;
            try {
                return await fn();
            } finally {
                release();
            }
        }

        ensureNative() {
            if (isBrowser || !isNode) {
                throw new Error(
                    "fofum_server is native-only (navi_shell.exe / Node) — cannot bind ports in the browser"
                );
            }
        }

        async tipGetData(ib) {
            const tip = await navi.storage.tip.get(ib);
            return tip?.data?.fofum_server ?? null;
        }

        async tipPut(ib, payload, parts) {
            await navi.storage.tip.mut8(
                ib,
                {
                    parts: parts || ["fofum_server", "ibgib_frame", "json"],
                    fofum_server: payload,
                },
                { create: true }
            );
        }

        async tipDel(ib) {
            try {
                await navi.storage.tip.del(ib);
            } catch {
                /* ignore missing */
            }
        }

        async loadPrefs() {
            const port = await navi.storage.item.get(STORAGE.port);
            if (port != null && port !== "") {
                const n = Number(port);
                if (Number.isFinite(n) && n > 0) this.port = n;
            }
        }

        async ensureConfig() {
            if (this._configReady && this.usagePassword) return;
            this.ensureNative();
            await this.loadPrefs();
            const data = await this.tipGetData(TIP.config);
            if (data && data.usage_password) {
                this.usagePassword = String(data.usage_password);
                this.activeAdmin =
                    data.active_admin && typeof data.active_admin === "object"
                        ? { ...data.active_admin }
                        : {};
                if (data.port != null) {
                    const n = Number(data.port);
                    if (Number.isFinite(n) && n > 0) this.port = n;
                }
            } else {
                this.usagePassword = generateSecret(20);
                this.activeAdmin = {};
                await this.saveConfig();
                log(`usage password generated: ${this.usagePassword}`);
                log(
                    "save this password — required for account creation and admin auth"
                );
            }
            this._configReady = true;
        }

        async saveConfig() {
            await this.tipPut(
                TIP.config,
                {
                    usage_password: this.usagePassword,
                    active_admin: this.activeAdmin,
                    port: this.port,
                    updated_at: new Date().toISOString(),
                },
                ["fofum_server", "config", "ibgib_frame", "json"]
            );
            await navi.storage.item.set(STORAGE.port, this.port);
        }

        async loadUserIndex() {
            const data = await this.tipGetData(TIP.users);
            const names = data?.usernames;
            return Array.isArray(names) ? names.map(String) : [];
        }

        async saveUserIndex(usernames) {
            const unique = [...new Set(usernames.map(String))].sort();
            await this.tipPut(
                TIP.users,
                {
                    usernames: unique,
                    count: unique.length,
                    updated_at: new Date().toISOString(),
                },
                ["fofum_server", "users", "ibgib_frame", "json"]
            );
            return unique;
        }

        async getAccount(username) {
            const data = await this.tipGetData(TIP.user(username));
            if (!data || !data.username) return null;
            return data;
        }

        async createAccount(username, password) {
            const bad = validateUsername(username);
            if (bad) throw Object.assign(new Error(bad), { code: "BAD_USERNAME" });
            const existing = await this.getAccount(username);
            if (existing) {
                throw Object.assign(new Error("username already exists"), {
                    code: "EXISTS",
                });
            }
            const now = new Date().toISOString();
            const acc = {
                id: generateSecret(32),
                username,
                password_hash: hashPassword(password),
                created_at: now,
            };
            await this.tipPut(
                TIP.user(username),
                acc,
                ["fofum_server", "user", "ibgib_frame", "json"]
            );
            const index = await this.loadUserIndex();
            if (!index.includes(username)) {
                index.push(username);
                await this.saveUserIndex(index);
            }
            return {
                id: acc.id,
                username: acc.username,
                created_at: acc.created_at,
            };
        }

        async deleteAccount(username) {
            const acc = await this.getAccount(username);
            if (!acc) throw new Error("account not found");
            await this.tipDel(TIP.user(username));
            const index = await this.loadUserIndex();
            await this.saveUserIndex(index.filter((n) => n !== username));
            return username;
        }

        async issueSession(acc) {
            const now = Date.now();
            const sess = {
                token: generateSecret(32),
                account_id: acc.id,
                username: acc.username,
                created_at: new Date(now).toISOString(),
                expires_at: new Date(now + TOKEN_TTL_MS).toISOString(),
            };
            await this.tipPut(
                TIP.session(sess.token),
                sess,
                ["fofum_server", "session", "ibgib_frame", "json"]
            );
            return sess;
        }

        async login(username, password) {
            const acc = await this.getAccount(String(username || "").trim());
            if (!acc || !checkPassword(acc.password_hash, password)) {
                throw Object.assign(new Error("invalid credentials"), {
                    code: "AUTH",
                });
            }
            return this.issueSession(acc);
        }

        async resolveToken(token) {
            const t = String(token || "").trim();
            if (!t) throw new Error("invalid token");
            const sess = await this.tipGetData(TIP.session(t));
            if (!sess || !sess.token) throw new Error("invalid token");
            if (Date.now() > Date.parse(sess.expires_at)) {
                await this.revokeToken(t);
                throw new Error("token expired");
            }
            return sess;
        }

        async revokeToken(token) {
            const t = String(token || "").trim();
            if (!t) return;
            await this.tipDel(TIP.session(t));
        }

        async proveSameAccount(tokenA, tokenB) {
            const a = String(tokenA || "").trim();
            const b = String(tokenB || "").trim();
            if (a === b) {
                const sess = await this.resolveToken(a);
                return { same: true, account_id: sess.account_id };
            }
            const sA = await this.resolveToken(a);
            const sB = await this.resolveToken(b);
            return {
                same: sA.account_id === sB.account_id,
                account_id: sA.account_id,
            };
        }

        async issueAdminToken() {
            const token = generateSecret(32);
            const now = Date.now();
            this.activeAdmin[token] = {
                created_at: new Date(now).toISOString(),
                expires_at: new Date(now + TOKEN_TTL_MS).toISOString(),
                last_used: new Date(now).toISOString(),
            };
            await this.saveConfig();
            return token;
        }

        async authenticateAdminToken(token) {
            const t = String(token || "").trim();
            const entry = this.activeAdmin[t];
            if (!entry) throw new Error("invalid token");
            if (Date.now() > Date.parse(entry.expires_at)) {
                delete this.activeAdmin[t];
                await this.saveConfig();
                throw new Error("token expired");
            }
            entry.last_used = new Date().toISOString();
            this.activeAdmin[t] = entry;
            await this.saveConfig();
            return entry;
        }

        extractBearer(req) {
            const h = this.header(req, "Authorization") || "";
            if (h.length > 7 && h.slice(0, 7).toLowerCase() === "bearer ") {
                return h.slice(7).trim();
            }
            return "";
        }

        header(req, name) {
            const want = name.toLowerCase();
            for (const [k, v] of Object.entries(req.headers || {})) {
                if (String(k).toLowerCase() === want) {
                    return Array.isArray(v) ? v[0] : v;
                }
            }
            return null;
        }

        sendJson(res, status, body) {
            const payload = JSON.stringify(body);
            res.writeHead(status, {
                "Content-Type": "application/json; charset=utf-8",
                "Content-Length": Buffer.byteLength(payload),
            });
            res.end(payload);
            return status;
        }

        sendText(res, status, text) {
            const buf = Buffer.from(String(text), "utf8");
            res.writeHead(status, {
                "Content-Type": "text/plain; charset=utf-8",
                "Content-Length": buf.length,
            });
            res.end(buf);
            return status;
        }

        applyCors(req, res) {
            const origin = this.header(req, "Origin");
            if (origin) {
                res.setHeader("Access-Control-Allow-Origin", origin);
            }
            res.setHeader(
                "Access-Control-Allow-Methods",
                "GET, POST, DELETE, OPTIONS"
            );
            res.setHeader(
                "Access-Control-Allow-Headers",
                "Content-Type, Authorization"
            );
            res.setHeader("Access-Control-Allow-Credentials", "true");
        }

        readBody(req) {
            return new Promise((resolve, reject) => {
                const chunks = [];
                req.on("data", (c) => chunks.push(c));
                req.on("end", () => resolve(Buffer.concat(chunks)));
                req.on("error", reject);
            });
        }

        async readJson(req) {
            const buf = await this.readBody(req);
            if (!buf.length) return {};
            try {
                return JSON.parse(buf.toString("utf8"));
            } catch {
                const err = new Error("invalid JSON");
                err.code = "BAD_JSON";
                throw err;
            }
        }

        api(success, message, data, error) {
            const out = { success, message };
            if (data !== undefined) out.data = data;
            if (error !== undefined) out.error = error;
            return out;
        }

        rootText() {
            return `Fofum — identity confirmation service (navi tip-backed)

Public:
  POST /accounts/create     — register (requires usage_password in body)
  POST /auth/login          — username + password → session token
  POST /auth/validate       — check if a token is valid (for other services)
  POST /auth/prove          — prove token_a and token_b are same account
  POST /auth/logout         — revoke a token
  GET  /auth/whoami         — Bearer session token → account info

Admin (Bearer admin token from POST /admin/auth):
  POST /admin/auth
  GET  /admin/info
  GET  /admin/users
  DELETE /admin/users?username=

Usage password: fofum_server password (tip fofum_server/config).
Accounts / sessions: navi tips under fofum_server/user/* and fofum_server/session/*.
Listening: http://${LISTEN_HOST}:${this.port}
`;
        }

        async handleRequest(req, res) {
            this.applyCors(req, res);
            const method = (req.method || "GET").toUpperCase();
            if (method === "OPTIONS") {
                res.writeHead(200);
                res.end();
                return;
            }

            let pathname = "/";
            let url;
            try {
                const host = req.headers.host || "localhost";
                url = new URL(req.url || "/", `http://${host}`);
                pathname = decodeURIComponent(url.pathname || "/");
            } catch {
                this.sendJson(
                    res,
                    400,
                    this.api(false, "bad request")
                );
                return;
            }

            navi.callout?.(`[fofum_server] ← ${method} ${pathname}`);

            try {
                await this.ensureConfig();

                if (method === "GET" && pathname === "/") {
                    this.sendText(res, 200, this.rootText());
                    return;
                }

                if (method === "POST" && pathname === "/admin/auth") {
                    let body;
                    try {
                        body = await this.readJson(req);
                    } catch {
                        this.sendJson(
                            res,
                            400,
                            this.api(false, "invalid JSON")
                        );
                        return;
                    }
                    if (body.password !== this.usagePassword) {
                        this.sendJson(
                            res,
                            401,
                            this.api(false, "invalid password")
                        );
                        return;
                    }
                    const token = await this.withLock(() =>
                        this.issueAdminToken()
                    );
                    this.sendJson(
                        res,
                        200,
                        this.api(true, "admin authentication successful", {
                            token,
                        })
                    );
                    return;
                }

                if (method === "GET" && pathname === "/admin/info") {
                    const token = this.extractBearer(req);
                    if (!token) {
                        this.sendJson(
                            res,
                            401,
                            this.api(false, "missing bearer token")
                        );
                        return;
                    }
                    try {
                        const t = await this.withLock(() =>
                            this.authenticateAdminToken(token)
                        );
                        this.sendJson(
                            res,
                            200,
                            this.api(true, "admin info", {
                                created_at: t.created_at,
                                expires_at: t.expires_at,
                                last_used: t.last_used,
                            })
                        );
                    } catch (e) {
                        this.sendJson(
                            res,
                            401,
                            this.api(
                                false,
                                "invalid admin token",
                                undefined,
                                e.message || String(e)
                            )
                        );
                    }
                    return;
                }

                if (method === "GET" && pathname === "/admin/users") {
                    const token = this.extractBearer(req);
                    if (!token) {
                        this.sendJson(
                            res,
                            401,
                            this.api(false, "missing bearer token")
                        );
                        return;
                    }
                    try {
                        await this.withLock(() =>
                            this.authenticateAdminToken(token)
                        );
                        const names = await this.loadUserIndex();
                        this.sendJson(
                            res,
                            200,
                            this.api(true, "users listed", {
                                usernames: names,
                                count: names.length,
                            })
                        );
                    } catch (e) {
                        this.sendJson(
                            res,
                            401,
                            this.api(
                                false,
                                "invalid admin token",
                                undefined,
                                e.message || String(e)
                            )
                        );
                    }
                    return;
                }

                if (method === "DELETE" && pathname === "/admin/users") {
                    const token = this.extractBearer(req);
                    if (!token) {
                        this.sendJson(
                            res,
                            401,
                            this.api(false, "missing bearer token")
                        );
                        return;
                    }
                    try {
                        await this.withLock(() =>
                            this.authenticateAdminToken(token)
                        );
                    } catch (e) {
                        this.sendJson(
                            res,
                            401,
                            this.api(
                                false,
                                "invalid admin token",
                                undefined,
                                e.message || String(e)
                            )
                        );
                        return;
                    }
                    const username = url.searchParams.get("username") || "";
                    if (!username) {
                        this.sendJson(
                            res,
                            400,
                            this.api(false, "username query param required")
                        );
                        return;
                    }
                    try {
                        await this.withLock(() => this.deleteAccount(username));
                        this.sendJson(
                            res,
                            200,
                            this.api(true, "account deleted", { username })
                        );
                    } catch (e) {
                        this.sendJson(
                            res,
                            404,
                            this.api(
                                false,
                                "delete failed",
                                undefined,
                                e.message || String(e)
                            )
                        );
                    }
                    return;
                }

                if (method === "POST" && pathname === "/accounts/create") {
                    let body;
                    try {
                        body = await this.readJson(req);
                    } catch {
                        this.sendJson(
                            res,
                            400,
                            this.api(false, "invalid JSON")
                        );
                        return;
                    }
                    if (body.usage_password !== this.usagePassword) {
                        this.sendJson(
                            res,
                            403,
                            this.api(false, "invalid usage password")
                        );
                        return;
                    }
                    if (String(body.password || "").length < 8) {
                        this.sendJson(
                            res,
                            400,
                            this.api(
                                false,
                                "password must be at least 8 characters"
                            )
                        );
                        return;
                    }
                    try {
                        const acc = await this.withLock(() =>
                            this.createAccount(
                                String(body.username || "").trim(),
                                body.password
                            )
                        );
                        this.sendJson(
                            res,
                            201,
                            this.api(true, "account created", {
                                account_id: acc.id,
                                username: acc.username,
                                created_at: acc.created_at,
                            })
                        );
                    } catch (e) {
                        if (e.code === "BAD_USERNAME") {
                            this.sendJson(
                                res,
                                400,
                                this.api(false, e.message)
                            );
                            return;
                        }
                        this.sendJson(
                            res,
                            409,
                            this.api(
                                false,
                                "account creation failed",
                                undefined,
                                e.message || String(e)
                            )
                        );
                    }
                    return;
                }

                if (method === "POST" && pathname === "/auth/login") {
                    let body;
                    try {
                        body = await this.readJson(req);
                    } catch {
                        this.sendJson(
                            res,
                            400,
                            this.api(false, "invalid JSON")
                        );
                        return;
                    }
                    try {
                        const sess = await this.withLock(() =>
                            this.login(body.username, body.password)
                        );
                        this.sendJson(
                            res,
                            200,
                            this.api(true, "login successful", {
                                token: sess.token,
                                account_id: sess.account_id,
                                username: sess.username,
                                expires_at: sess.expires_at,
                            })
                        );
                    } catch {
                        this.sendJson(
                            res,
                            401,
                            this.api(false, "login failed")
                        );
                    }
                    return;
                }

                if (method === "POST" && pathname === "/auth/validate") {
                    let body;
                    try {
                        body = await this.readJson(req);
                    } catch {
                        this.sendJson(
                            res,
                            400,
                            this.api(false, "invalid JSON")
                        );
                        return;
                    }
                    try {
                        const sess = await this.resolveToken(body.token);
                        this.sendJson(
                            res,
                            200,
                            this.api(true, "token valid", {
                                valid: true,
                                account_id: sess.account_id,
                                username: sess.username,
                                expires_at: sess.expires_at,
                            })
                        );
                    } catch {
                        this.sendJson(
                            res,
                            200,
                            this.api(true, "token invalid", { valid: false })
                        );
                    }
                    return;
                }

                if (method === "POST" && pathname === "/auth/prove") {
                    let body;
                    try {
                        body = await this.readJson(req);
                    } catch {
                        this.sendJson(
                            res,
                            400,
                            this.api(false, "invalid JSON")
                        );
                        return;
                    }
                    try {
                        const proof = await this.proveSameAccount(
                            body.token_a,
                            body.token_b
                        );
                        this.sendJson(
                            res,
                            200,
                            this.api(true, "proof complete", {
                                proved: true,
                                both_valid: true,
                                same_account: proof.same,
                                account_id: proof.account_id,
                            })
                        );
                    } catch {
                        this.sendJson(
                            res,
                            200,
                            this.api(
                                true,
                                "could not prove — one or both tokens invalid",
                                {
                                    proved: false,
                                    same_account: false,
                                    both_valid: false,
                                }
                            )
                        );
                    }
                    return;
                }

                if (method === "POST" && pathname === "/auth/logout") {
                    let body;
                    try {
                        body = await this.readJson(req);
                    } catch {
                        this.sendJson(
                            res,
                            400,
                            this.api(false, "invalid JSON")
                        );
                        return;
                    }
                    await this.withLock(() => this.revokeToken(body.token));
                    this.sendJson(
                        res,
                        200,
                        this.api(true, "token revoked")
                    );
                    return;
                }

                if (method === "GET" && pathname === "/auth/whoami") {
                    const token = this.extractBearer(req);
                    if (!token) {
                        this.sendJson(
                            res,
                            401,
                            this.api(false, "missing bearer token")
                        );
                        return;
                    }
                    try {
                        const sess = await this.resolveToken(token);
                        this.sendJson(
                            res,
                            200,
                            this.api(true, "session active", {
                                account_id: sess.account_id,
                                username: sess.username,
                                expires_at: sess.expires_at,
                            })
                        );
                    } catch {
                        this.sendJson(
                            res,
                            401,
                            this.api(false, "invalid token")
                        );
                    }
                    return;
                }

                this.sendText(res, 404, "404 page not found\n");
            } catch (error) {
                console.error("[fofum_server]", error);
                this.sendJson(
                    res,
                    500,
                    this.api(
                        false,
                        "internal error",
                        undefined,
                        error.message || String(error)
                    )
                );
            }
        }

        async start(port = this.port) {
            this.ensureNative();
            await this.ensureConfig();
            if (port) this.port = Number(port) || DEFAULT_PORT;
            await this.saveConfig();

            if (this.listening && this.server) {
                return `already listening on ${this.port}`;
            }

            const http = nodeRequire("http");
            this.server = http.createServer((req, res) => {
                void this.handleRequest(req, res);
            });

            await new Promise((resolve, reject) => {
                this.server.once("error", reject);
                this.server.listen(this.port, LISTEN_HOST, () => resolve());
            });
            this.listening = true;
            return `listening on http://${LISTEN_HOST}:${this.port}`;
        }

        async stop() {
            if (!this.server || !this.listening) return "not listening";
            const server = this.server;
            await new Promise((resolve) => server.close(() => resolve()));
            this.server = null;
            this.listening = false;
            return "stopped";
        }

        status() {
            return {
                native: isNode && !isBrowser,
                listening: this.listening,
                host: LISTEN_HOST,
                port: this.port,
                usage_password_set: !!this.usagePassword,
                admin_sessions: Object.keys(this.activeAdmin || {}).length,
                tips: {
                    config: TIP.config,
                    users: TIP.users,
                    user_prefix: "fofum_server/user/",
                    session_prefix: "fofum_server/session/",
                },
            };
        }
    }

    const svc = new FofumNativeServer();

    const HELP = [
        "fofum_server — tip-backed Fofum identity API (native only)",
        "",
        "  fofum_server start [port]     Bind localhost (default 3114)",
        "  fofum_server stop | status | help",
        "  fofum_server password         Show usage password",
        "  fofum_server users            List registered usernames",
        "",
        "Same HTTP API as Go fofum; state in navi tips under fofum_server/*.",
        "Mount: torus/testkit/native/fofum_server (hostpark).",
        "Also mount torus/native/server_manager for `servers start fofum_server`.",
    ].join("\n");

    const run = async (...rawArgs) => {
        const args = rawArgs.flatMap((a) =>
            typeof a === "string" ? a.split(/\s+/).filter(Boolean) : [a]
        ).filter((a) => a != null && a !== "");
        const verb = String(args[0] || "help").toLowerCase();
        try {
            switch (verb) {
                case "help":
                case "--help":
                case "-h":
                    return HELP;
                case "start":
                    return await svc.start(args[1]);
                case "stop":
                    return await svc.stop();
                case "status":
                    return JSON.stringify(svc.status(), null, 2);
                case "password":
                    await svc.ensureConfig();
                    return `usage password: ${svc.usagePassword}`;
                case "users":
                    await svc.ensureConfig();
                    return JSON.stringify(
                        {
                            usernames: await svc.loadUserIndex(),
                        },
                        null,
                        2
                    );
                default:
                    return `unknown: ${verb}\n\n${HELP}`;
            }
        } catch (error) {
            console.error("[fofum_server]", error);
            return `error: ${error.message || error}`;
        }
    };

    return {
        name: "fofum_server",
        version: "1.0.0",
        description:
            "Native Fofum identity HTTP — tip-backed accounts/sessions (port 3114)",

        moduleInfo: {
            name: "fofum_server",
            version: "1.0.0",
            description:
                "Native Fofum identity HTTP — tip-backed accounts/sessions (port 3114)",
        },

        server: svc,
        start: (...a) => svc.start(...a),
        stop: () => svc.stop(),
        status: () => svc.status(),

        commands: {
            fofum_server: {
                name: "fofum_server",
                description:
                    "fofum_server start|stop|status|password|users — tip-backed Fofum",
                execute: async (...args) => run(...args),
            },
        },

        onMount: async () => {
            if (!isBrowser && isNode) {
                try {
                    await svc.ensureConfig();
                } catch (e) {
                    warn("ensureConfig on mount:", e.message || e);
                }
            } else {
                await svc.loadPrefs();
            }
            const mgr = navi.mod?.server_manager;
            if (mgr && typeof mgr.register === "function") {
                try {
                    mgr.register({
                        id: "fofum_server",
                        name: "fofum_server",
                        description: "tip-backed Fofum identity HTTP API",
                        defaultPort: DEFAULT_PORT,
                        module: "fofum_server",
                        start: (port) => svc.start(port),
                        stop: () => svc.stop(),
                        status: () => svc.status(),
                    });
                } catch (err) {
                    warn(
                        "server_manager.register failed:",
                        err.message || err
                    );
                }
            } else {
                log(
                    "tip: mount torus/native/server_manager for `servers` control"
                );
            }
            if (isBrowser || !isNode) {
                log(
                    "mounted (browser/non-Node) — start will refuse; native only"
                );
                return;
            }
            log(
                `ready v1.0.0 — tip-backed identities; fofum_server start [${svc.port}]`
            );
        },

        onUnmount: () => {
            const mgr = navi.mod?.server_manager;
            if (mgr && typeof mgr.unregister === "function") {
                try {
                    mgr.unregister("fofum_server");
                } catch {
                    /* ignore */
                }
            }
            if (svc.listening) {
                void svc.stop().catch(() => {});
            }
            for (const t of timers) clearTimeout(t);
            for (const o of observers) {
                try {
                    o.disconnect?.();
                } catch {
                    /* ignore */
                }
            }
            for (const { target, type, fn, opts } of eventListeners) {
                try {
                    target.removeEventListener(type, fn, opts);
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
