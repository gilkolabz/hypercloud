const DEFAULT_BASE_URL = "/flowerpot";

const HEADERS = {
    usageToken: "X-Flowerpot-Usage-Token",
    usagePassword: "X-Flowerpot-Usage-Password",
    accessSecret: "X-Flowerpot-Access-Secret",
    frameAccessSecret: "X-Flowerpot-Frame-Access-Secret",
    publicRead: "X-Flowerpot-Public-Read",
    ibGib: "X-Flowerpot-ib^gib",
};

const STORAGE_KEYS = {
    baseUrl: "flowerpot.base_url",
    usagePassword: "flowerpot.usage_password",
    usageToken: "flowerpot.usage_token",
    lastRead: "flowerpot.last_read",
};

function isTextLike(contentType) {
    const ct = (contentType || "").toLowerCase();
    return ct.includes("json") || ct.startsWith("text/") || ct.includes("javascript") || ct.includes("xml");
}

function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}

function parseFlags(args) {
    const flags = {};
    const positional = [];
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === "--secret" && i + 1 < args.length) flags.secret = args[++i];
        else if (arg === "--password" && i + 1 < args.length) flags.password = args[++i];
        else if (arg === "--url" && i + 1 < args.length) flags.url = args[++i];
        else if (arg === "--count" && i + 1 < args.length) flags.count = args[++i];
        else if (arg === "--addr" && i + 1 < args.length) flags.addr = args[++i];
        else if (arg === "--token" && i + 1 < args.length) flags.token = args[++i];
        else if (arg === "--type" && i + 1 < args.length) flags.contentType = args[++i];
        else if (arg === "--public-read") flags.publicRead = true;
        else if (arg === "--file" && i + 1 < args.length) flags.file = args[++i];
        else positional.push(arg);
    }
    return { flags, positional };
}

function formatResult(result) {
    if (result == null) return "(empty)";
    if (typeof result === "object") return JSON.stringify(result, null, 2);
    return String(result);
}

function guessContentType(filePath) {
    const ext = filePath.split(".").pop()?.toLowerCase();
    const types = {
        js: "application/javascript", mjs: "application/javascript", json: "application/json",
        html: "text/html", css: "text/css", md: "text/markdown", txt: "text/plain",
        svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
        gif: "image/gif", webp: "image/webp", wasm: "application/wasm",
    };
    return types[ext] || "application/octet-stream";
}

export const register = (navi) => {
    class FlowerpotClient {
        constructor() {
            this.baseUrl = DEFAULT_BASE_URL;
        }

        log(...args) {
            console.log("[flowerpot_client]", ...args);
        }

        buildUrl(path) {
            const base = this.baseUrl.replace(/\/$/, "");
            return `${base}/${path.replace(/^\//, "")}`;
        }

        resolveUrl(path) {
            const built = this.buildUrl(path);
            if (/^https?:\/\//i.test(built)) return new URL(built);
            return new URL(built, globalThis.location?.origin || "http://localhost");
        }

        async parseError(response) {
            const ct = response.headers.get("Content-Type") || "";
            try {
                if (ct.includes("application/json")) return JSON.stringify(await response.json());
            } catch { /* fall through */ }
            return response.text();
        }

        async loadConfig() {
            this.baseUrl = (await navi.storage.item.get(STORAGE_KEYS.baseUrl)) || DEFAULT_BASE_URL;
            const usageToken = (await navi.storage.item.get(STORAGE_KEYS.usageToken)) || "";
            const usagePassword = (await navi.storage.item.get(STORAGE_KEYS.usagePassword)) || "";
            this.log("config loaded", { baseUrl: this.baseUrl, hasToken: !!usageToken });
            return { baseUrl: this.baseUrl, usageToken, usagePassword };
        }

        async saveConfig({ baseUrl, usageToken, usagePassword } = {}) {
            if (baseUrl) {
                await navi.storage.item.set(STORAGE_KEYS.baseUrl, baseUrl);
                this.baseUrl = baseUrl;
            }
            if (usagePassword) await navi.storage.item.set(STORAGE_KEYS.usagePassword, usagePassword);
            if (usageToken !== undefined) {
                if (usageToken === "") await navi.storage.item.del(STORAGE_KEYS.usageToken);
                else await navi.storage.item.set(STORAGE_KEYS.usageToken, usageToken);
            }
            return this.loadConfig();
        }

        async getUsageToken(explicit) {
            return explicit || (await navi.storage.item.get(STORAGE_KEYS.usageToken)) || "";
        }

        async clearUsageToken() {
            await navi.storage.item.del(STORAGE_KEYS.usageToken);
            this.log("usage token cleared");
        }

        async storeRead(route, contentType, body, addr) {
            const meta = { route, contentType, addr: addr || null, storedAt: new Date().toISOString() };
            if (isTextLike(contentType)) {
                if (contentType.toLowerCase().includes("json") && typeof body === "string") {
                    try {
                        meta.body = JSON.parse(body);
                    } catch {
                        meta.body = body;
                    }
                } else {
                    meta.body = typeof body === "string" ? body : String(body);
                }
                await navi.storage.item.set(STORAGE_KEYS.lastRead, meta);
            } else {
                const filePath = `flowerpot/last_read_${Date.now()}`;
                const payload = body instanceof ArrayBuffer ? arrayBufferToBase64(body) : String(body);
                await navi.storage.file.save(filePath, { media: payload, mime: contentType });
                meta.filePath = filePath;
                meta.encoding = "base64";
                await navi.storage.item.set(STORAGE_KEYS.lastRead, meta);
            }
            this.log("read stored", meta.filePath || STORAGE_KEYS.lastRead);
            return meta;
        }

        async getLastRead() {
            const raw = await navi.storage.item.get(STORAGE_KEYS.lastRead);
            if (!raw) return null;
            if (typeof raw === "object") return raw;
            try {
                return JSON.parse(raw);
            } catch {
                return raw;
            }
        }

        async get(route, { secret, addr } = {}) {
            const url = this.resolveUrl(route);
            if (addr) url.searchParams.set("addr", addr);
            if (secret) url.searchParams.set("access_secret", secret);
            const headers = secret ? { [HEADERS.accessSecret]: secret } : {};
            this.log("GET", url.pathname);
            const response = await fetch(url, { method: "GET", headers });
            const contentType = response.headers.get("Content-Type") || "application/octet-stream";
            const ibGib = response.headers.get(HEADERS.ibGib);
            if (!response.ok) throw new Error(`HTTP ${response.status}: ${await this.parseError(response)}`);
            const body = isTextLike(contentType) ? await response.text() : await response.arrayBuffer();
            return { body, contentType, addr: ibGib };
        }

        async read(route, opts = {}) {
            const result = await this.get(route, opts);
            const storage = await this.storeRead(route, result.contentType, result.body, result.addr);
            return { ...result, storage };
        }

        async post(route, { content, contentType, secret, publicRead, usageToken } = {}) {
            const token = await this.getUsageToken(usageToken);
            if (!token) throw new Error("usage token required");
            if (!contentType) throw new Error("content_type required");
            const payload = { content, content_type: contentType };
            if (secret) {
                payload.access_secret = secret;
                if (publicRead) payload.public_read = true;
            }
            const headers = {
                "Content-Type": "application/json",
                [HEADERS.usageToken]: token,
            };
            if (secret) headers[HEADERS.accessSecret] = secret;
            this.log("POST", route);
            const response = await fetch(this.buildUrl(route), {
                method: "POST", headers, body: JSON.stringify(payload),
            });
            const ibGib = response.headers.get(HEADERS.ibGib);
            if (!response.ok) throw new Error(`HTTP ${response.status}: ${await this.parseError(response)}`);
            const result = await response.json();
            await this.clearUsageToken();
            return { ...result, addr: ibGib };
        }

        async put(route, body, { contentType = "application/octet-stream", secret, publicRead, usageToken } = {}) {
            const token = await this.getUsageToken(usageToken);
            if (!token) throw new Error("usage token required");
            const headers = {
                "Content-Type": contentType,
                [HEADERS.usageToken]: token,
            };
            if (secret) {
                headers[HEADERS.accessSecret] = secret;
                headers[HEADERS.frameAccessSecret] = secret;
            }
            if (publicRead) headers[HEADERS.publicRead] = "true";
            this.log("PUT", route);
            const response = await fetch(this.buildUrl(route), { method: "PUT", headers, body });
            const ibGib = response.headers.get(HEADERS.ibGib);
            if (!response.ok) throw new Error(`HTTP ${response.status}: ${await this.parseError(response)}`);
            const result = await response.json();
            await this.clearUsageToken();
            return { ...result, addr: ibGib };
        }

        async delete(route, { secret } = {}) {
            const headers = secret ? { [HEADERS.accessSecret]: secret } : {};
            this.log("DELETE", route);
            const response = await fetch(this.buildUrl(route), { method: "DELETE", headers });
            const ibGib = response.headers.get(HEADERS.ibGib);
            if (!response.ok) throw new Error(`HTTP ${response.status}: ${await this.parseError(response)}`);
            const result = await response.json();
            return { ...result, addr: ibGib };
        }

        async listVersions(route, { secret, usagePassword } = {}) {
            const url = this.resolveUrl("_flowerpot/versions");
            url.searchParams.set("route", route);
            const headers = {};
            if (secret) headers[HEADERS.accessSecret] = secret;
            if (usagePassword) headers[HEADERS.usagePassword] = usagePassword;
            this.log("versions", route);
            const response = await fetch(url, { method: "GET", headers });
            if (!response.ok) throw new Error(`HTTP ${response.status}: ${await this.parseError(response)}`);
            return (await response.json()).data;
        }

        async mintTokens(usagePassword, count = 1) {
            this.log("mint", count);
            const response = await fetch(this.buildUrl("_flowerpot/tokens"), {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    [HEADERS.usagePassword]: usagePassword,
                },
                body: JSON.stringify({ count }),
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}: ${await this.parseError(response)}`);
            return response.json();
        }
    }

    const api = new FlowerpotClient();

    return {
        name: "flowerpot_client",
        version: "2.2.0",
        description: "Flowerpot ibgib storage API client",

        moduleInfo: {
            name: "flowerpot_client",
            version: "2.2.0",
            description: "Flowerpot ibgib storage API client",
        },

        loadConfig: (...args) => api.loadConfig(...args),
        saveConfig: (...args) => api.saveConfig(...args),
        read: (...args) => api.read(...args),
        get: (...args) => api.get(...args),
        post: (...args) => api.post(...args),
        put: (...args) => api.put(...args),
        delete: (...args) => api.delete(...args),
        listVersions: (...args) => api.listVersions(...args),
        mintTokens: (...args) => api.mintTokens(...args),
        getLastRead: (...args) => api.getLastRead(...args),
        clearUsageToken: (...args) => api.clearUsageToken(...args),

        commands: {
            flowerpot_client: {
                name: "flowerpot_client",
                description: "flowerpot_client <get|post|put|delete|versions|config|mint> [args...]",
                execute: async (action, ...args) => {
                    if (!action) {
                        return [
                            "flowerpot_client config [--url <base>] [--token <token>]",
                            "flowerpot_client get <route> [--secret <s>] [--addr <ib^gib>]",
                            "flowerpot_client post <route> <type> <content...> [--secret <s>] [--public-read] [--token <t>]",
                            "flowerpot_client put <route> <content...> [--type <mime>] [--secret <s>] [--token <t>]",
                            "flowerpot_client put <route> --file <path> [--type <mime>]",
                            "flowerpot_client delete <route> [--secret <s>]",
                            "flowerpot_client versions <route> [--secret <s>]",
                            "flowerpot_client mint [--password <pw>] [--count N]",
                        ].join("\n");
                    }
                    try {
                        const { flags, positional } = parseFlags(args);
                        switch (action) {
                            case "config":
                                if (flags.url || flags.token || flags.password) {
                                    await api.saveConfig({ baseUrl: flags.url, usageToken: flags.token, usagePassword: flags.password });
                                    return "saved";
                                }
                                return formatResult(await api.loadConfig());
                            case "get": {
                                if (!positional[0]) return "usage: flowerpot_client get <route>";
                                const r = await api.read(positional[0], { secret: flags.secret, addr: flags.addr });
                                return typeof r.body === "string" ? r.body : `[binary ${r.body.byteLength} bytes, stored]`;
                            }
                            case "post": {
                                if (positional.length < 3) return "usage: flowerpot_client post <route> <type> <content...>";
                                const [route, contentType, ...rest] = positional;
                                return formatResult(await api.post(route, {
                                    content: rest.join(" "), contentType,
                                    secret: flags.secret, publicRead: flags.publicRead, usageToken: flags.token,
                                }));
                            }
                            case "put": {
                                if (!positional[0]) return "usage: flowerpot_client put <route> <content...>";
                                const route = positional[0];
                                let body, contentType = flags.contentType;
                                if (flags.file) {
                                    body = await navi.storage.file.load(flags.file);
                                    if (body == null) return `not found: ${flags.file}`;
                                    if (!contentType) contentType = guessContentType(flags.file);
                                } else {
                                    if (positional.length < 2) return "usage: flowerpot_client put <route> <content...>";
                                    body = positional.slice(1).join(" ");
                                }
                                return formatResult(await api.put(route, body, {
                                    contentType: contentType || "text/plain",
                                    secret: flags.secret, publicRead: flags.publicRead, usageToken: flags.token,
                                }));
                            }
                            case "delete":
                                if (!positional[0]) return "usage: flowerpot_client delete <route>";
                                return formatResult(await api.delete(positional[0], { secret: flags.secret }));
                            case "versions":
                                if (!positional[0]) return "usage: flowerpot_client versions <route>";
                                return formatResult(await api.listVersions(positional[0], { secret: flags.secret }));
                            case "mint": {
                                const cfg = await api.loadConfig();
                                const pw = flags.password || cfg.usagePassword;
                                if (!pw) return "usage password required";
                                const result = await api.mintTokens(pw, flags.count ? parseInt(flags.count, 10) : 1);
                                if (result.tokens?.[0]) await api.saveConfig({ usageToken: result.tokens[0] });
                                return formatResult(result);
                            }
                            default:
                                return `unknown: ${action}`;
                        }
                    } catch (e) {
                        console.error("[flowerpot_client]", e);
                        return `error: ${e.message}`;
                    }
                },
            },
        },

        onMount: async () => {
            await api.loadConfig();
            console.log("[flowerpot_client] ready");
        },

        onUnmount: () => {
            console.log("[flowerpot_client] unmounted");
        },
    };
};
