// Fofum Client Module - HTTP client for the Fofum identity confirmation API.
// Same-origin by default: /fofum/... (foobarch or local reverse proxy).

const FOFUM_BASE_URL = "/fofum";
const SESSION_TOKEN_KEY = "fofum_client_session_token";
const ADMIN_TOKEN_KEY = "fofum_client_admin_token";

export const register = (navi) => {
    const eventListeners = [];
    const createdElements = [];
    const addedStyles = [];
    const observers = [];
    const timers = [];

    function parseFlags(args) {
        const flags = {};
        const positional = [];

        for (let i = 0; i < args.length; i++) {
            const arg = args[i];
            if (arg === "--token" && i + 1 < args.length) {
                flags.token = args[++i];
            } else if (arg === "--admin" && i + 1 < args.length) {
                flags.admin = args[++i];
            } else {
                positional.push(arg);
            }
        }

        return { flags, positional };
    }

    function formatResult(result) {
        if (result === null || result === undefined) {
            return "(empty response)";
        }
        if (typeof result === "object") {
            return JSON.stringify(result, null, 2);
        }
        return String(result);
    }

    class FofumClient {
        constructor(baseUrl, naviInstance) {
            this.baseUrl = baseUrl.replace(/\/$/, "");
            this.navi = naviInstance;
        }

        buildUrl(path) {
            const suffix = path.startsWith("/") ? path : `/${path}`;
            const joined = `${this.baseUrl}${suffix}`;
            if (typeof this.navi?.resolveUrl === "function") {
                return this.navi.resolveUrl(joined.replace(/^\//, ""));
            }
            return joined;
        }

        async handleResponse(response) {
            const contentType = response.headers.get("Content-Type") || "";
            let body;

            if (contentType.includes("application/json")) {
                try {
                    body = await response.json();
                } catch {
                    body = await response.text();
                }
            } else {
                body = await response.text();
            }

            if (!response.ok) {
                const detail = typeof body === "object" ? JSON.stringify(body) : body;
                throw new Error(`HTTP ${response.status}: ${detail}`);
            }

            return body;
        }

        async request(path, { method = "GET", body, bearer } = {}) {
            const headers = {};
            if (body !== undefined) {
                headers["Content-Type"] = "application/json";
            }
            if (bearer) {
                headers.Authorization = `Bearer ${bearer}`;
            }

            const response = await globalThis.fetch(this.buildUrl(path), {
                method,
                headers,
                body: body !== undefined ? JSON.stringify(body) : undefined
            });
            return this.handleResponse(response);
        }

        async getStoredSessionToken() {
            return this.navi.storage.item.get(SESSION_TOKEN_KEY);
        }

        async getStoredAdminToken() {
            return this.navi.storage.item.get(ADMIN_TOKEN_KEY);
        }

        async setStoredSessionToken(token) {
            await this.navi.storage.item.set(SESSION_TOKEN_KEY, token);
        }

        async setStoredAdminToken(token) {
            await this.navi.storage.item.set(ADMIN_TOKEN_KEY, token);
        }

        async clearStoredSessionToken() {
            await this.navi.storage.item.del(SESSION_TOKEN_KEY);
        }

        async createAccount(username, password, usagePassword) {
            return this.request("/accounts/create", {
                method: "POST",
                body: { username, password, usage_password: usagePassword }
            });
        }

        async login(username, password) {
            const result = await this.request("/auth/login", {
                method: "POST",
                body: { username, password }
            });
            if (result?.data?.token) {
                await this.setStoredSessionToken(result.data.token);
            }
            return result;
        }

        async validate(token) {
            return this.request("/auth/validate", {
                method: "POST",
                body: { token }
            });
        }

        async prove(tokenA, tokenB) {
            return this.request("/auth/prove", {
                method: "POST",
                body: { token_a: tokenA, token_b: tokenB }
            });
        }

        async logout(token) {
            const result = await this.request("/auth/logout", {
                method: "POST",
                body: { token }
            });
            const stored = await this.getStoredSessionToken();
            if (stored === token) {
                await this.clearStoredSessionToken();
            }
            return result;
        }

        async whoami(token) {
            return this.request("/auth/whoami", { bearer: token });
        }

        async adminAuth(password) {
            const result = await this.request("/admin/auth", {
                method: "POST",
                body: { password }
            });
            if (result?.data?.token) {
                await this.setStoredAdminToken(result.data.token);
            }
            return result;
        }

        async adminInfo(adminToken) {
            return this.request("/admin/info", { bearer: adminToken });
        }

        async adminListUsers(adminToken) {
            return this.request("/admin/users", { bearer: adminToken });
        }

        async adminDeleteUser(username, adminToken) {
            return this.request(`/admin/users?username=${encodeURIComponent(username)}`, {
                method: "DELETE",
                bearer: adminToken
            });
        }
    }

    const client = new FofumClient(FOFUM_BASE_URL, navi);

    async function resolveSessionToken(flags) {
        if (flags.token) return flags.token;
        const stored = await client.getStoredSessionToken();
        if (!stored) {
            throw new Error("no session token — login first or pass --token");
        }
        return stored;
    }

    async function resolveAdminToken(flags) {
        if (flags.admin) return flags.admin;
        const stored = await client.getStoredAdminToken();
        if (!stored) {
            throw new Error("no admin token — run 'fofum admin auth' first or pass --admin");
        }
        return stored;
    }

    return {
        name: "fofum_client",
        version: "1.0.1",
        description: "HTTP client for the Fofum identity API at /fofum",

        moduleInfo: {
            name: "fofum_client",
            version: "1.0.1",
            description: "HTTP client for the Fofum identity API at /fofum"
        },

        commands: {
            fofum: {
                name: "fofum",
                description: "Fofum API: fofum <create|login|logout|validate|prove|whoami|admin> [args...]",
                execute: async (action, ...args) => {
                    if (!action) {
                        return [
                            "Fofum Client v1.0.1",
                            `Server: ${FOFUM_BASE_URL}`,
                            "",
                            "Identity confirmation service — register users, issue session tokens,",
                            "validate tokens, and prove two tokens belong to the same account.",
                            "",
                            "Endpoints (under /fofum):",
                            "  POST /accounts/create         Register account (usage_password required)",
                            "  POST /auth/login              Username + password → session token",
                            "  POST /auth/validate           Check if a token is valid",
                            "  POST /auth/prove              Prove token_a and token_b are same account",
                            "  POST /auth/logout             Revoke a session token",
                            "  GET  /auth/whoami             Bearer session token → account info",
                            "  POST /admin/auth              Usage password → admin bearer token",
                            "  GET  /admin/info              Admin session metadata",
                            "  GET  /admin/users             List usernames",
                            "  DELETE /admin/users?username= Delete account",
                            "",
                            "Usage:",
                            "  fofum create <username> <password> <usage_password>",
                            "  fofum login <username> <password>",
                            "  fofum logout [--token <token>]",
                            "  fofum validate [--token <token>]",
                            "  fofum prove <token_a> <token_b>",
                            "  fofum whoami [--token <token>]",
                            "  fofum admin auth <usage_password>",
                            "  fofum admin info [--admin <token>]",
                            "  fofum admin users [--admin <token>]",
                            "  fofum admin delete <username> [--admin <token>]",
                            "",
                            "Login and admin auth store tokens in Navi storage automatically.",
                            "",
                            "Programmatic access:",
                            "  navi.mod.fofum_client.client.login(username, password)",
                            "  navi.mod.fofum_client.client.validate(token)",
                            "  navi.mod.fofum_client.client.prove(tokenA, tokenB)",
                            "  navi.mod.fofum_client.client.whoami(token)",
                            "  navi.mod.fofum_client.client.adminAuth(password)",
                            "  navi.mod.fofum_client.client.adminListUsers(adminToken)",
                            "",
                            "Examples:",
                            "  fofum create alice secretpass YOUR_USAGE_PASSWORD",
                            "  fofum login alice secretpass",
                            "  fofum whoami",
                            "  fofum admin auth YOUR_USAGE_PASSWORD",
                            "  fofum admin users"
                        ].join("\n");
                    }

                    try {
                        switch (action) {
                            case "create": {
                                const { positional } = parseFlags(args);
                                if (positional.length < 3) {
                                    return "Usage: fofum create <username> <password> <usage_password>";
                                }
                                const [username, password, usagePassword] = positional;
                                const result = await client.createAccount(username, password, usagePassword);
                                return formatResult(result);
                            }

                            case "login": {
                                const { positional } = parseFlags(args);
                                if (positional.length < 2) {
                                    return "Usage: fofum login <username> <password>";
                                }
                                const [username, password] = positional;
                                const result = await client.login(username, password);
                                return formatResult(result);
                            }

                            case "logout": {
                                const { flags } = parseFlags(args);
                                const token = flags.token || await resolveSessionToken(flags);
                                const result = await client.logout(token);
                                return formatResult(result);
                            }

                            case "validate": {
                                const { flags } = parseFlags(args);
                                const token = flags.token || await resolveSessionToken(flags);
                                const result = await client.validate(token);
                                return formatResult(result);
                            }

                            case "prove": {
                                const { positional } = parseFlags(args);
                                if (positional.length < 2) {
                                    return "Usage: fofum prove <token_a> <token_b>";
                                }
                                const result = await client.prove(positional[0], positional[1]);
                                return formatResult(result);
                            }

                            case "whoami": {
                                const { flags } = parseFlags(args);
                                const token = flags.token || await resolveSessionToken(flags);
                                const result = await client.whoami(token);
                                return formatResult(result);
                            }

                            case "admin": {
                                const { flags, positional } = parseFlags(args);
                                if (positional.length === 0) {
                                    return "Usage: fofum admin <auth|info|users|delete> [args...]";
                                }

                                const [subAction, ...subArgs] = positional;

                                switch (subAction) {
                                    case "auth": {
                                        if (subArgs.length === 0) {
                                            return "Usage: fofum admin auth <usage_password>";
                                        }
                                        const result = await client.adminAuth(subArgs[0]);
                                        return formatResult(result);
                                    }

                                    case "info": {
                                        const adminToken = flags.admin || await resolveAdminToken(flags);
                                        const result = await client.adminInfo(adminToken);
                                        return formatResult(result);
                                    }

                                    case "users": {
                                        const adminToken = flags.admin || await resolveAdminToken(flags);
                                        const result = await client.adminListUsers(adminToken);
                                        return formatResult(result);
                                    }

                                    case "delete": {
                                        if (subArgs.length === 0) {
                                            return "Usage: fofum admin delete <username> [--admin <token>]";
                                        }
                                        const adminToken = flags.admin || await resolveAdminToken(flags);
                                        const result = await client.adminDeleteUser(subArgs[0], adminToken);
                                        return formatResult(result);
                                    }

                                    default:
                                        return `Unknown admin action: ${subAction}. Use: auth, info, users, delete`;
                                }
                            }

                            default:
                                return `Unknown action: ${action}. Type 'fofum' for help.`;
                        }
                    } catch (error) {
                        console.error("[fofum_client] Command failed:", error);
                        return `Error: ${error.message || "Unknown error"}`;
                    }
                }
            }
        },

        client,
        baseUrl: FOFUM_BASE_URL,

        onMount: async () => {
            console.log(`[fofum_client] Ready — Fofum at ${FOFUM_BASE_URL}`);
        },

        onUnmount: () => {
            eventListeners.forEach(({ element, event, handler }) => {
                element.removeEventListener(event, handler);
            });
            eventListeners.length = 0;

            createdElements.forEach(el => el.remove());
            createdElements.length = 0;

            addedStyles.forEach(style => style.remove());
            addedStyles.length = 0;

            observers.forEach(observer => observer.disconnect());
            observers.length = 0;

            timers.forEach(({ type, id }) => {
                if (type === "interval") clearInterval(id);
                if (type === "timeout") clearTimeout(id);
            });
            timers.length = 0;

            console.log("[fofum_client] Module unmounted");
        }
    };
};
