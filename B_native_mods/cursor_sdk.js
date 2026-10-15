/**
 * cursor_sdk — native-only Navi module: Cursor SDK local agent relay.
 *
 * Tip ledger (coarse): stream → navi.callout; one tip mut8 per turn end.
 * Resume fidelity stays with Cursor (agentId); tips are the navi-facing ledger.
 *
 * Callin:
 *   cursor_sdk help|status
 *   cursor_sdk key set|clear|status
 *   cursor_sdk cwd [path]
 *   cursor_sdk relay [on [alias]|off]   (whitelist cursor_sdk/edit, scoped to alias)
 *   cursor_sdk model [id|list]
 *   cursor_sdk vendor              # npm i @cursor/sdk into ~/.navi_shell/cursor_sdk/vendor
 *   cursor_sdk open [label]
 *   cursor_sdk resume [agentId]
 *   cursor_sdk say <prompt…>
 *   cursor_sdk cancel | close | here
 *   cursor_sdk convo [list|show|use <id>]
 *   cursor_sdk context tip <ib> […]
 *
 * Requires: navi_shell.exe / Node. First open/say/status auto-vendors @cursor/sdk
 * via npm into %APPDATA%\.navi_shell\cursor_sdk\vendor (or CURSOR_SDK_ROOT).
 */

export const register = (navi) => {
    const isBrowser =
        typeof window !== "undefined" && typeof window.document !== "undefined";
    const isNode =
        typeof process !== "undefined" &&
        !!(process.versions && process.versions.node);

    const eventListeners = [];
    const timers = [];

    const VERSION = "0.3.0";
    const RELAY_OWNER = "cursor_sdk";
    const RELAY_PATHS = ["cursor_sdk/edit"];
    const SECRETS_IB = "navi:cursor_sdk:secrets";
    const SESSION_IB = "navi:cursor_sdk:session";
    const SPEC_IB = "navi:cursor_sdk:spec";
    const CONVO_PREFIX = "navi:cursor_sdk:convo:";
    const DEFAULT_MODEL = "composer-2.5";
    const SDK_PKG = "@cursor/sdk";
    const RIPGREP_ENV = "CURSOR_RIPGREP_PATH";
    const AGENTS_MAX = 8000;
    const EDIT_SCHEMA_TEXT = [
        "Live browser edits MUST reply with a single JSON object (optional ```json fence) matching cursor_edit_v1:",
        '{"v":1,"ops":[',
        '  {"op":"replace_outerHTML","dataHash":"…","html":"…"},',
        '  {"op":"replace_text","dataHash":"…","text":"…"},',
        '  {"op":"callin","path":"remount/…","note":"…"}',
        "]}",
        "Only those ops. Prefer dataHash from the pack.selection. Do not invent hostpark/fsdevops pushes for this path.",
    ].join("\n");

    const nodeRequire = (id) => navi.require(id);

    /** Same root as navi_shell Node storage: %APPDATA%\.navi_shell on Windows. */
    function naviShellDir() {
        const path = nodeRequire("path");
        const os = nodeRequire("os");
        if (process.platform === "win32") {
            const roaming =
                process.env.APPDATA ||
                path.join(os.homedir(), "AppData", "Roaming");
            return path.join(roaming, ".navi_shell");
        }
        return path.join(os.homedir(), ".navi_shell");
    }

    function vendorRoot() {
        const path = nodeRequire("path");
        const env = String(process.env.CURSOR_SDK_ROOT || "").trim();
        if (env) return env;
        return path.join(naviShellDir(), "cursor_sdk", "vendor");
    }

    const callout = (msg) => {
        try {
            if (typeof navi.callout === "function") navi.callout(msg);
        } catch {
            /* ignore */
        }
    };

    const log = (msg) => {
        try {
            console.log(`[cursor_sdk] ${msg}`);
        } catch {
            /* ignore */
        }
    };

    const ensureNative = () => {
        if (isBrowser || !isNode) {
            throw new Error("cursor_sdk is native-only (navi_shell.exe / Node)");
        }
    };

    const newConvoId = () => {
        const t = Date.now().toString(36);
        const r = Math.random().toString(36).slice(2, 8);
        return `${t}-${r}`;
    };

    const convoIbFor = (id) => `${CONVO_PREFIX}${id}`;

    /** @type {any} */
    let agentHandle = null;
    /** @type {any} */
    let activeRun = null;
    /** @type {any} */
    let sdkCache = null;

    class CursorSdkRelay {
        constructor() {
            this.cwd = "";
            this.model = DEFAULT_MODEL;
            this.agentId = "";
            this.convoId = "";
            this.convoIb = "";
            this.label = "";
            /** @type {string[]} */
            this.contextTips = [];
            /** @type {{ id: string, ib: string, label: string, at: string }[]} */
            this.knownConvos = [];
            this.relayAlias = "hq01";
            /** Opt-in: whitelist cursor_sdk/edit for relay, only via relayAlias. */
            this.relayOn = false;
        }

        async loadSession() {
            ensureNative();
            const tip = await navi.storage.tip.get(SESSION_IB);
            const d = tip?.data || {};
            if (typeof d.cwd === "string" && d.cwd.trim()) this.cwd = d.cwd.trim();
            if (typeof d.model === "string" && d.model.trim()) {
                this.model = d.model.trim();
            }
            if (typeof d.agentId === "string") this.agentId = d.agentId.trim();
            if (typeof d.convoId === "string") this.convoId = d.convoId.trim();
            if (typeof d.convoIb === "string") this.convoIb = d.convoIb.trim();
            if (typeof d.label === "string") this.label = d.label.trim();
            if (typeof d.relayAlias === "string" && d.relayAlias.trim()) {
                this.relayAlias = d.relayAlias.trim().replace(/^navi-/i, "");
            }
            this.relayOn = d.relayOn === true;
            this.contextTips = Array.isArray(d.contextTips)
                ? d.contextTips.map(String).filter(Boolean)
                : [];
            this.knownConvos = Array.isArray(d.knownConvos)
                ? d.knownConvos.filter((x) => x && x.id)
                : [];
            if (!this.cwd) {
                try {
                    this.cwd = process.cwd();
                } catch {
                    this.cwd = ".";
                }
            }
            return d;
        }

        async saveSession(patch = {}) {
            ensureNative();
            const tip = await navi.storage.tip.get(SESSION_IB);
            const prev = tip?.data && typeof tip.data === "object" ? tip.data : {};
            const next = {
                ...prev,
                parts: [
                    "cursor_sdk_session",
                    "ibgib_frame",
                    "manifest",
                    "json",
                ],
                about: {
                    label: SESSION_IB,
                    description:
                        "Active Cursor SDK session (agentId, cwd, model, convo)",
                },
                cwd: this.cwd,
                model: this.model,
                agentId: this.agentId,
                convoId: this.convoId,
                convoIb: this.convoIb,
                label: this.label,
                relayAlias: this.relayAlias,
                relayOn: this.relayOn,
                contextTips: this.contextTips,
                knownConvos: this.knownConvos,
                ...patch,
            };
            if (patch.relayOn != null) this.relayOn = patch.relayOn === true;
            if (patch.cwd != null) this.cwd = String(patch.cwd);
            if (patch.model != null) this.model = String(patch.model);
            if (patch.agentId != null) this.agentId = String(patch.agentId);
            if (patch.convoId != null) this.convoId = String(patch.convoId);
            if (patch.convoIb != null) this.convoIb = String(patch.convoIb);
            if (patch.label != null) this.label = String(patch.label);
            if (patch.relayAlias != null) {
                this.relayAlias = String(patch.relayAlias)
                    .trim()
                    .replace(/^navi-/i, "");
            }
            if (Array.isArray(patch.contextTips)) {
                this.contextTips = patch.contextTips.map(String);
            }
            if (Array.isArray(patch.knownConvos)) {
                this.knownConvos = patch.knownConvos;
            }
            await navi.storage.tip.mut8(SESSION_IB, next, {
                create: true,
                replaceData: true,
            });
            return next;
        }

        async getApiKey() {
            const env = String(process.env.CURSOR_API_KEY || "").trim();
            if (env) return env;
            const tip = await navi.storage.tip.get(SECRETS_IB);
            const k = String(tip?.data?.apiKey || tip?.data?.key || "").trim();
            if (k) return k;
            throw new Error(
                "no API key — cursor_sdk key set <key> or set CURSOR_API_KEY"
            );
        }

        async keyStatus() {
            let fromEnv = false;
            let fromTip = false;
            try {
                fromEnv = !!String(process.env.CURSOR_API_KEY || "").trim();
            } catch {
                /* ignore */
            }
            try {
                const tip = await navi.storage.tip.get(SECRETS_IB);
                fromTip = !!(
                    tip?.data?.apiKey ||
                    tip?.data?.key
                );
            } catch {
                /* ignore */
            }
            return {
                present: fromEnv || fromTip,
                source: fromEnv ? "env" : fromTip ? "tip" : "missing",
            };
        }

        async keySet(raw) {
            const key = String(raw || "").trim();
            if (!key) throw new Error("usage: cursor_sdk key set <key>");
            await navi.storage.tip.mut8(
                SECRETS_IB,
                {
                    parts: [
                        "cursor_sdk_secrets",
                        "ibgib_frame",
                        "manifest",
                        "json",
                    ],
                    about: {
                        label: SECRETS_IB,
                        description: "Cursor API key (local; never log)",
                    },
                    apiKey: key,
                },
                { create: true, replaceData: true }
            );
            return { ok: true, source: "tip", present: true };
        }

        async keyClear() {
            await navi.storage.tip.mut8(
                SECRETS_IB,
                {
                    parts: [
                        "cursor_sdk_secrets",
                        "ibgib_frame",
                        "manifest",
                        "json",
                    ],
                    about: {
                        label: SECRETS_IB,
                        description: "Cursor API key (local; never log)",
                    },
                    apiKey: "",
                },
                { create: true, replaceData: true }
            );
            return { ok: true, present: false };
        }

        tryLoadSdkFrom(base, tried) {
            const path = nodeRequire("path");
            const fs = nodeRequire("fs");
            const { createRequire } = nodeRequire("module");
            if (!base) return null;
            const nm = path.join(base, "node_modules", "@cursor", "sdk");
            if (!fs.existsSync(nm) && !fs.existsSync(path.join(base, "package.json"))) {
                return null;
            }
            tried.push(base);
            try {
                const pkg = fs.existsSync(path.join(base, "package.json"))
                    ? path.join(base, "package.json")
                    : path.join(nm, "package.json");
                const req = createRequire(pkg);
                const mod = req(SDK_PKG);
                if (mod?.Agent) return mod;
            } catch (e) {
                tried.push(`${base}: ${e.message || e}`);
            }
            const flat = path.join(nm, "dist", "index.js");
            if (fs.existsSync(flat)) {
                try {
                    const req = createRequire(flat);
                    const mod = req(flat);
                    if (mod?.Agent) return mod;
                } catch (e) {
                    tried.push(`${flat}: ${e.message || e}`);
                }
            }
            return null;
        }

        sdkSearchRoots() {
            const path = nodeRequire("path");
            const roots = [];
            const seen = new Set();
            const add = (p) => {
                const n = String(p || "").trim();
                if (!n || seen.has(n)) return;
                seen.add(n);
                roots.push(n);
            };
            add(vendorRoot());
            add(String(process.env.CURSOR_SDK_ROOT || "").trim());
            try {
                add(process.cwd());
            } catch {
                /* ignore */
            }
            if (this.cwd) add(this.cwd);
            try {
                add(path.resolve(__dirname, ".."));
                add(path.resolve(__dirname, "../.."));
            } catch {
                /* ignore */
            }
            add(path.join(process.cwd(), "B_native_mods", "vendor"));
            return roots;
        }

        /**
         * npm-install @cursor/sdk into the vendor root (idempotent).
         * Same pattern as spacebarz_fusion vendor.
         */
        ensureVendor(opts = {}) {
            ensureNative();
            const path = nodeRequire("path");
            const fs = nodeRequire("fs");
            const { spawnSync } = nodeRequire("child_process");
            const dest = vendorRoot();
            const force = !!opts.force;
            const marker = path.join(dest, "node_modules", "@cursor", "sdk");
            if (!force && fs.existsSync(marker)) {
                return { ok: true, path: dest, installed: false, skipped: true };
            }
            fs.mkdirSync(dest, { recursive: true });
            const pkgPath = path.join(dest, "package.json");
            if (!fs.existsSync(pkgPath)) {
                fs.writeFileSync(
                    pkgPath,
                    JSON.stringify(
                        {
                            name: "navi-cursor-sdk-vendor",
                            private: true,
                            description:
                                "Auto-managed by navi cursor_sdk — do not edit by hand",
                        },
                        null,
                        2
                    ) + "\n"
                );
            }
            callout(`[cursor_sdk] vendor: npm install ${SDK_PKG} → ${dest}`);
            log(`vendor npm install ${SDK_PKG} in ${dest}`);
            const npm = process.platform === "win32" ? "npm.cmd" : "npm";
            const r = spawnSync(
                npm,
                ["install", SDK_PKG, "--omit=dev", "--no-fund", "--no-audit"],
                {
                    cwd: dest,
                    encoding: "utf8",
                    shell: process.platform === "win32",
                    env: { ...process.env, npm_config_update_notifier: "false" },
                    timeout: 10 * 60 * 1000,
                }
            );
            if (r.error || r.status !== 0) {
                const detail = [
                    r.error?.message,
                    r.error?.code,
                    r.status != null ? `status=${r.status}` : "",
                    (r.stderr || "").trim(),
                    (r.stdout || "").trim(),
                ]
                    .filter(Boolean)
                    .join(" | ")
                    .slice(0, 800);
                throw new Error(
                    `npm install ${SDK_PKG} in ${dest} failed: ${detail || "(no output — is npm on PATH for navi_shell?)"}`
                );
            }
            if (!fs.existsSync(marker)) {
                throw new Error(
                    `npm install finished but ${marker} missing — check network / npm registry`
                );
            }
            sdkCache = null;
            return { ok: true, path: dest, installed: true, skipped: false };
        }

        /**
         * Local agents need ripgrep configured before search/ignore maps.
         * Prefer CURSOR_RIPGREP_PATH, then @cursor/sdk-<plat>-<arch>/bin/rg,
         * then Cursor IDE bundled rg, then PATH.
         */
        resolveRipgrepPath() {
            ensureNative();
            const path = nodeRequire("path");
            const fs = nodeRequire("fs");
            const exe = process.platform === "win32" ? "rg.exe" : "rg";
            const candidates = [];
            const add = (p) => {
                const n = String(p || "").trim();
                if (n) candidates.push(n);
            };

            add(process.env[RIPGREP_ENV]);

            // SDK platform package beside our vendor install
            try {
                const { createRequire } = nodeRequire("module");
                const req = createRequire(
                    path.join(vendorRoot(), "package.json")
                );
                const plat = `@cursor/sdk-${process.platform}-${process.arch}`;
                const pkgJson = req.resolve(`${plat}/package.json`);
                add(path.join(path.dirname(pkgJson), "bin", exe));
            } catch {
                /* ignore */
            }
            add(
                path.join(
                    vendorRoot(),
                    "node_modules",
                    `@cursor/sdk-${process.platform}-${process.arch}`,
                    "bin",
                    exe
                )
            );

            // Cursor IDE install (common Windows layouts)
            const localApp =
                process.env.LOCALAPPDATA ||
                path.join(
                    nodeRequire("os").homedir(),
                    "AppData",
                    "Local"
                );
            for (const leaf of ["cursor", "Cursor"]) {
                add(
                    path.join(
                        localApp,
                        "Programs",
                        leaf,
                        "resources",
                        "app",
                        "node_modules",
                        "@vscode",
                        "ripgrep",
                        "bin",
                        exe
                    )
                );
            }

            // PATH lookup
            try {
                const { spawnSync } = nodeRequire("child_process");
                const which = process.platform === "win32" ? "where.exe" : "which";
                const r = spawnSync(which, ["rg"], {
                    encoding: "utf8",
                    shell: process.platform === "win32",
                });
                const line = String(r.stdout || "")
                    .split(/\r?\n/)
                    .map((l) => l.trim())
                    .find(Boolean);
                if (line) add(line);
            } catch {
                /* ignore */
            }

            for (const c of candidates) {
                try {
                    if (c && path.isAbsolute(c) && fs.existsSync(c)) return c;
                } catch {
                    /* ignore */
                }
            }
            return "";
        }

        ensureRipgrepConfigured() {
            ensureNative();
            const path = this.resolveRipgrepPath();
            if (!path) {
                throw new Error(
                    "ripgrep (rg) not found — set CURSOR_RIPGREP_PATH or install Cursor / ensure @cursor/sdk-* platform package"
                );
            }
            process.env[RIPGREP_ENV] = path;

            // Prefer public configure helper when present (some SDK builds).
            try {
                const sdk = this.resolveSdk();
                if (typeof sdk.configureRipgrepPath === "function") {
                    sdk.configureRipgrepPath(path);
                } else if (typeof sdk.configureCursorSdk === "function") {
                    // No-op for ripgrep; env is what Agent.create uses.
                }
            } catch {
                /* env alone is enough for Agent.create path */
            }
            return { ok: true, path };
        }

        resolveSdk() {
            if (sdkCache) return sdkCache;
            ensureNative();
            const tried = [];
            for (const base of this.sdkSearchRoots()) {
                const mod = this.tryLoadSdkFrom(base, tried);
                if (mod) {
                    sdkCache = mod;
                    return mod;
                }
            }
            // Auto-vendor then retry from vendor root only
            this.ensureVendor();
            const mod = this.tryLoadSdkFrom(vendorRoot(), tried);
            if (mod) {
                sdkCache = mod;
                return mod;
            }
            throw new Error(
                `${SDK_PKG} still missing after vendor. tried: ${tried
                    .slice(0, 10)
                    .join(" | ")}`
            );
        }

        async status() {
            await this.loadSession();
            const key = await this.keyStatus();
            let sdk = "unresolved";
            let ripgrep = "missing";
            try {
                this.resolveSdk();
                sdk = "ok";
            } catch (e) {
                sdk = `missing (${e.message || e})`;
            }
            try {
                const rg = this.ensureRipgrepConfigured();
                ripgrep = rg.path;
            } catch (e) {
                ripgrep = `missing (${e.message || e})`;
            }
            return {
                version: VERSION,
                key: key.source,
                sdk,
                ripgrep,
                vendor: vendorRoot(),
                cwd: this.cwd,
                model: this.model,
                agentId: this.agentId || null,
                convoId: this.convoId || null,
                convoIb: this.convoIb || null,
                label: this.label || null,
                agentLive: !!agentHandle,
                runLive: !!activeRun,
                relayAlias: this.relayAlias,
                relayOn: this.relayOn,
                contextTips: this.contextTips,
                knownConvos: this.knownConvos.length,
            };
        }

        async setCwd(raw) {
            await this.loadSession();
            const path = nodeRequire("path");
            const fs = nodeRequire("fs");
            let next = String(raw || "").trim();
            if (!next) return { cwd: this.cwd };
            // Relay URL segments drop the colon from C:/… → C/XO/…
            if (/^[A-Za-z][/\\]/.test(next) && !/^[A-Za-z]:/.test(next)) {
                next = `${next[0]}:${next.slice(1)}`;
            }
            next = path.resolve(next);
            if (!fs.existsSync(next)) {
                throw new Error(`cwd does not exist: ${next}`);
            }
            this.cwd = next;
            await this.saveSession({ cwd: next });
            return { cwd: this.cwd };
        }

        async setModel(raw) {
            await this.loadSession();
            const id = String(raw || "").trim();
            if (!id) return { model: this.model };
            if (id.toLowerCase() === "list") {
                return this.listModels();
            }
            this.model = id;
            await this.saveSession({ model: id });
            return { model: this.model };
        }

        async listModels() {
            const apiKey = await this.getApiKey();
            const { Cursor } = this.resolveSdk();
            if (!Cursor?.models?.list) {
                return { models: [DEFAULT_MODEL], note: "list unavailable" };
            }
            const models = await Cursor.models.list({ apiKey });
            return { models };
        }

        async rememberConvo(meta) {
            const id = meta.id;
            const rest = this.knownConvos.filter((c) => c.id !== id);
            rest.unshift({
                id,
                ib: meta.ib,
                label: meta.label || id,
                at: meta.at || new Date().toISOString(),
            });
            this.knownConvos = rest.slice(0, 40);
            await this.saveSession({ knownConvos: this.knownConvos });
        }

        async ensureConvoTip(label) {
            if (!this.convoId) {
                this.convoId = newConvoId();
                this.convoIb = convoIbFor(this.convoId);
                this.label = label || this.label || this.convoId;
            }
            if (!this.convoIb) this.convoIb = convoIbFor(this.convoId);
            const tip = await navi.storage.tip.get(this.convoIb);
            if (!tip?.data) {
                await navi.storage.tip.mut8(
                    this.convoIb,
                    {
                        parts: [
                            "cursor_sdk_convo",
                            "ibgib_frame",
                            "manifest",
                            "json",
                        ],
                        about: {
                            label: this.convoIb,
                            description: "Cursor SDK conversation ledger",
                        },
                        convoId: this.convoId,
                        label: this.label,
                        agentId: this.agentId || "",
                        turns: [],
                        contextTips: this.contextTips,
                    },
                    { create: true, replaceData: true }
                );
            }
            await this.rememberConvo({
                id: this.convoId,
                ib: this.convoIb,
                label: this.label,
            });
            await this.saveSession({
                convoId: this.convoId,
                convoIb: this.convoIb,
                label: this.label,
            });
            return this.convoIb;
        }

        async appendTurns(turns) {
            if (!this.convoIb) await this.ensureConvoTip();
            const tip = await navi.storage.tip.get(this.convoIb);
            const prev = tip?.data && typeof tip.data === "object" ? tip.data : {};
            const list = Array.isArray(prev.turns) ? [...prev.turns] : [];
            for (const t of turns) list.push(t);
            await navi.storage.tip.mut8(
                this.convoIb,
                {
                    ...prev,
                    parts: [
                        "cursor_sdk_convo",
                        "ibgib_frame",
                        "manifest",
                        "json",
                    ],
                    about: {
                        label: this.convoIb,
                        description: "Cursor SDK conversation ledger",
                    },
                    convoId: this.convoId,
                    label: this.label,
                    agentId: this.agentId || prev.agentId || "",
                    turns: list,
                    contextTips: this.contextTips,
                },
                { create: true, replaceData: true }
            );
            return list.length;
        }

        async disposeAgent() {
            if (activeRun) {
                try {
                    if (
                        typeof activeRun.supports === "function" &&
                        activeRun.supports("cancel")
                    ) {
                        await activeRun.cancel();
                    }
                } catch {
                    /* ignore */
                }
                activeRun = null;
            }
            if (agentHandle) {
                try {
                    const dispose = agentHandle[Symbol.asyncDispose];
                    if (typeof dispose === "function") {
                        await dispose.call(agentHandle);
                    } else if (typeof agentHandle.close === "function") {
                        await agentHandle.close();
                    }
                } catch (e) {
                    log(`dispose: ${e.message || e}`);
                }
                agentHandle = null;
            }
        }

        async open(labelRaw, opts = {}) {
            await this.loadSession();
            const apiKey = await this.getApiKey();
            this.ensureRipgrepConfigured();
            const { Agent } = this.resolveSdk();
            await this.disposeAgent();

            const reuseConvo = !!opts.reuseConvo && !!this.convoId;
            if (!reuseConvo) {
                this.convoId = newConvoId();
                this.convoIb = convoIbFor(this.convoId);
                this.label =
                    String(labelRaw || "").trim() || `convo-${this.convoId}`;
            } else if (String(labelRaw || "").trim()) {
                this.label = String(labelRaw).trim();
            } else if (!this.label) {
                this.label = this.convoId;
            }

            agentHandle = await Agent.create({
                apiKey,
                model: { id: this.model },
                local: { cwd: this.cwd || process.cwd() },
            });
            this.agentId = String(
                agentHandle.agentId || agentHandle.agent_id || ""
            ).trim();
            await this.ensureConvoTip(this.label);
            await this.saveSession({
                agentId: this.agentId,
                convoId: this.convoId,
                convoIb: this.convoIb,
                label: this.label,
            });
            return {
                ok: true,
                action: reuseConvo ? "open-reuse-convo" : "open",
                agentId: this.agentId,
                convoId: this.convoId,
                convoIb: this.convoIb,
                cwd: this.cwd,
                model: this.model,
                label: this.label,
            };
        }

        agentMissingError(err) {
            const msg = String(err?.message || err || "");
            const name = String(err?.name || err?.code || "");
            return (
                /not found/i.test(msg) ||
                /AgentNotFound/i.test(msg) ||
                /AgentNotFound/i.test(name)
            );
        }

        /** Live handle or resume; stale agentId → open (keep convo tip). */
        async ensureAgent() {
            if (agentHandle) return { ok: true, action: "live" };
            if (this.agentId) {
                try {
                    return await this.resume(this.agentId);
                } catch (e) {
                    if (!this.agentMissingError(e)) throw e;
                    const stale = this.agentId;
                    log(`stale agent ${stale}: ${e.message || e}`);
                    callout(
                        `[cursor_sdk] agent ${stale.slice(0, 12)}… gone — opening new`
                    );
                    this.agentId = "";
                    await this.saveSession({ agentId: "" });
                }
            }
            return await this.open(this.label || undefined, {
                reuseConvo: true,
            });
        }

        async resume(agentIdRaw) {
            await this.loadSession();
            const apiKey = await this.getApiKey();
            this.ensureRipgrepConfigured();
            const { Agent } = this.resolveSdk();
            const id = String(agentIdRaw || this.agentId || "").trim();
            if (!id) throw new Error("usage: cursor_sdk resume <agentId>");
            await this.disposeAgent();
            agentHandle = await Agent.resume(id, { apiKey });
            this.agentId = String(
                agentHandle.agentId || agentHandle.agent_id || id
            ).trim();
            if (!this.convoId) {
                this.convoId = newConvoId();
                this.convoIb = convoIbFor(this.convoId);
                this.label = this.label || `resume-${this.agentId.slice(0, 8)}`;
            }
            await this.ensureConvoTip(this.label);
            await this.saveSession({ agentId: this.agentId });
            return {
                ok: true,
                action: "resume",
                agentId: this.agentId,
                convoId: this.convoId,
                convoIb: this.convoIb,
            };
        }

        async setRelayAlias(raw) {
            await this.loadSession();
            const a = String(raw || "")
                .trim()
                .replace(/^navi-/i, "");
            if (!a) return { relayAlias: this.relayAlias };
            this.relayAlias = a;
            await this.saveSession({ relayAlias: a });
            this.applyRelayWhitelist();
            return { relayAlias: this.relayAlias };
        }

        /**
         * Register (or drop) cursor_sdk/edit on the navi relay whitelist, scoped to
         * relayAlias. Returns a problem string, or "" when the whitelist matches relayOn.
         */
        applyRelayWhitelist() {
            const wl = navi.relayWhitelist;
            if (!wl || typeof wl.add !== "function") {
                return "this navi_shell has no relay whitelist API — update navi_shell";
            }
            if (!this.relayOn) {
                wl.remove(RELAY_OWNER);
                return "";
            }
            const entry = wl.add(RELAY_OWNER, RELAY_PATHS, { alias: this.relayAlias });
            if (Array.isArray(entry) || entry?.alias !== this.relayAlias) {
                // Older shells ignore the alias and would open the path through every alias.
                wl.remove(RELAY_OWNER);
                return "this navi_shell cannot scope whitelist entries to an alias — update navi_shell (not registered)";
            }
            return "";
        }

        async relayStatus() {
            const wl = navi.relayWhitelist;
            const whitelistOn = wl && typeof wl.isOn === "function" ? await wl.isOn() : null;
            const problem = this.applyRelayWhitelist();
            const notes = [];
            if (problem) notes.push(problem);
            if (whitelistOn === false) {
                notes.push(
                    "relay whitelist is OFF: every park path (all cursor_sdk verbs included) is reachable through every alias — run: relay whitelist on"
                );
            }
            if (this.relayOn && !problem) {
                notes.push(
                    `callers need the alias token if one is set: relay alias-token ${this.relayAlias} new, then relay advertise ${this.relayAlias}`
                );
            }
            return {
                relay: this.relayOn ? "on" : "off",
                alias: this.relayAlias,
                paths: this.relayOn && !problem ? RELAY_PATHS : [],
                whitelist: whitelistOn == null ? "unknown" : whitelistOn ? "on" : "off",
                notes,
            };
        }

        async setRelay(on, alias) {
            await this.loadSession();
            if (alias) {
                this.relayAlias = String(alias).trim().replace(/^navi-/i, "") || this.relayAlias;
            }
            await this.saveSession({ relayOn: !!on, relayAlias: this.relayAlias });
            return this.relayStatus();
        }

        async loadSpecText() {
            try {
                const tip = await navi.storage.tip.get(SPEC_IB);
                if (!tip?.data) return "";
                if (typeof tip.data.text === "string") return tip.data.text;
                if (typeof tip.data.spec === "string") return tip.data.spec;
                if (typeof tip.data.body === "string") return tip.data.body;
                return JSON.stringify(tip.data).slice(0, AGENTS_MAX);
            } catch {
                return "";
            }
        }

        loadAgentsMd() {
            try {
                const path = nodeRequire("path");
                const fs = nodeRequire("fs");
                const roots = [this.cwd, process.cwd()].filter(Boolean);
                for (const root of roots) {
                    for (const name of [
                        "AGENTS.md",
                        "C_devops/cursor_sdk_spec.md",
                    ]) {
                        const p = path.join(root, name);
                        if (fs.existsSync(p)) {
                            return fs.readFileSync(p, "utf8").slice(0, AGENTS_MAX);
                        }
                    }
                }
            } catch {
                /* ignore */
            }
            return "";
        }

        async buildPrompt(userText, opts = {}) {
            const bits = [];
            const forEdit = !!opts.forEdit;
            if (forEdit || opts.includeSpec !== false) {
                const spec = await this.loadSpecText();
                if (spec) {
                    bits.push("## navi:cursor_sdk:spec");
                    bits.push(spec.slice(0, AGENTS_MAX));
                    bits.push("");
                }
                const agents = this.loadAgentsMd();
                if (agents) {
                    bits.push("## AGENTS.md / repo spec");
                    bits.push(agents);
                    bits.push("");
                }
            }
            if (forEdit) {
                bits.push("## cursor_edit_v1 protocol");
                bits.push(EDIT_SCHEMA_TEXT);
                bits.push("");
            }
            if (this.contextTips.length) {
                bits.push(
                    "Navi tipspace context (study these tips via the runtime / ask the user for tip gets if needed):"
                );
                for (const ib of this.contextTips) {
                    bits.push(`- tip ib: ${ib}`);
                    try {
                        const tip = await navi.storage.tip.get(ib);
                        if (tip?.data) {
                            const preview = JSON.stringify(tip.data).slice(
                                0,
                                1200
                            );
                            bits.push(`  data preview: ${preview}`);
                        } else {
                            bits.push("  (no local tip data)");
                        }
                    } catch (e) {
                        bits.push(`  (read failed: ${e.message || e})`);
                    }
                }
                bits.push("");
            }
            if (opts.pack && typeof opts.pack === "object") {
                bits.push("## edit pack (from browser mod)");
                bits.push(JSON.stringify(opts.pack, null, 2).slice(0, 48000));
                bits.push("");
            }
            bits.push(userText);
            return bits.join("\n");
        }

        parseCursorEditV1(text) {
            const raw = String(text || "");
            const tryParse = (s) => {
                try {
                    const o = JSON.parse(s);
                    if (o && typeof o === "object" && Number(o.v) === 1) {
                        return {
                            v: 1,
                            ops: Array.isArray(o.ops) ? o.ops : [],
                        };
                    }
                } catch {
                    /* ignore */
                }
                return null;
            };
            const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
            if (fence) {
                const hit = tryParse(fence[1].trim());
                if (hit) return hit;
            }
            const start = raw.indexOf("{");
            const end = raw.lastIndexOf("}");
            if (start >= 0 && end > start) {
                const hit = tryParse(raw.slice(start, end + 1));
                if (hit) return hit;
            }
            return null;
        }

        extractAssistantText(event) {
            if (!event || typeof event !== "object") return "";
            if (event.type === "assistant" && event.message?.content) {
                let out = "";
                for (const block of event.message.content) {
                    if (block?.type === "text" && block.text) out += block.text;
                }
                return out;
            }
            if (typeof event.text === "string") return event.text;
            return "";
        }

        async sendTurn(userLedgerText, fullPrompt) {
            this.ensureRipgrepConfigured();
            await this.ensureAgent();
            if (!agentHandle) throw new Error("no agent — open or resume first");

            await this.ensureConvoTip(this.label);
            callout(
                `[cursor_sdk] say… (${String(userLedgerText || "").slice(0, 80)})`
            );

            const run = await agentHandle.send(fullPrompt);
            activeRun = run;
            let streamed = "";
            try {
                if (typeof run.stream === "function") {
                    for await (const event of run.stream()) {
                        const chunk = this.extractAssistantText(event);
                        if (chunk) {
                            streamed += chunk;
                            callout(`[cursor_sdk] ${chunk}`);
                        }
                    }
                }
                const result = await run.wait();
                activeRun = null;
                const finalText =
                    (result && result.result) ||
                    streamed ||
                    (result?.status === "error"
                        ? `error: ${result.error?.message || result.status}`
                        : "");
                const runId = String(result?.id || run.id || "").trim();
                const at = new Date().toISOString();
                await this.appendTurns([
                    { role: "user", text: String(userLedgerText || ""), runId, at },
                    {
                        role: "assistant",
                        text: String(finalText || ""),
                        runId,
                        at,
                        status: result?.status || "finished",
                    },
                ]);
                return {
                    ok: result?.status !== "error",
                    status: result?.status || "finished",
                    runId,
                    agentId: this.agentId,
                    convoIb: this.convoIb,
                    result: String(finalText || ""),
                };
            } catch (e) {
                activeRun = null;
                throw e;
            }
        }

        async say(promptRaw) {
            await this.loadSession();
            const userText = String(promptRaw || "").trim();
            if (!userText) throw new Error("usage: cursor_sdk say <prompt…>");
            const fullPrompt = await this.buildPrompt(userText);
            const out = await this.sendTurn(userText, fullPrompt);
            return { ...out, action: "say" };
        }

        /**
         * Browser/mod edit path: pack + prompt → agent → cursor_edit_v1 ops.
         * Does not apply DOM (browser cursor_edit_client does).
         */
        async edit(packRaw) {
            await this.loadSession();
            const pack =
                packRaw && typeof packRaw === "object"
                    ? packRaw
                    : { prompt: String(packRaw || "") };
            const prompt = String(pack.prompt || pack.text || "").trim();
            if (!prompt) throw new Error("edit needs pack.prompt");
            const fullPrompt = await this.buildPrompt(prompt, {
                forEdit: true,
                pack,
            });
            const out = await this.sendTurn(prompt, fullPrompt);
            const parsed = this.parseCursorEditV1(out.result);
            return {
                ...out,
                action: "edit",
                ops: parsed?.ops || [],
                parsed: parsed || null,
            };
        }

        async cancel() {
            if (!activeRun) return { ok: true, action: "cancel", note: "no run" };
            if (
                typeof activeRun.supports === "function" &&
                activeRun.supports("cancel")
            ) {
                await activeRun.cancel();
            }
            activeRun = null;
            return { ok: true, action: "cancel" };
        }

        async close() {
            await this.disposeAgent();
            return { ok: true, action: "close", agentId: this.agentId || null };
        }

        async here() {
            await this.loadSession();
            return {
                agentId: this.agentId || null,
                convoId: this.convoId || null,
                convoIb: this.convoIb || null,
                cwd: this.cwd,
                model: this.model,
                label: this.label || null,
                agentLive: !!agentHandle,
            };
        }

        async convoList() {
            await this.loadSession();
            return { convos: this.knownConvos };
        }

        async convoShow(idRaw) {
            await this.loadSession();
            const id = String(idRaw || this.convoId || "").trim();
            if (!id) throw new Error("usage: cursor_sdk convo show <id>");
            const ib = convoIbFor(id);
            const tip = await navi.storage.tip.get(ib);
            if (!tip?.data) throw new Error(`no convo tip at ${ib}`);
            return { ib, data: tip.data };
        }

        async convoUse(idRaw) {
            await this.loadSession();
            const id = String(idRaw || "").trim();
            if (!id) throw new Error("usage: cursor_sdk convo use <id>");
            const ib = convoIbFor(id);
            const tip = await navi.storage.tip.get(ib);
            if (!tip?.data) throw new Error(`no convo tip at ${ib}`);
            this.convoId = id;
            this.convoIb = ib;
            this.label = String(tip.data.label || id);
            if (tip.data.agentId) this.agentId = String(tip.data.agentId);
            await this.saveSession({
                convoId: this.convoId,
                convoIb: this.convoIb,
                label: this.label,
                agentId: this.agentId,
            });
            return {
                ok: true,
                action: "convo use",
                convoId: id,
                convoIb: ib,
                agentId: this.agentId || null,
            };
        }

        async contextTip(ibs) {
            await this.loadSession();
            const add = (Array.isArray(ibs) ? ibs : [ibs])
                .map((x) => String(x || "").trim())
                .filter(Boolean);
            if (!add.length) {
                return { contextTips: this.contextTips };
            }
            const set = new Set(this.contextTips);
            for (const ib of add) set.add(ib);
            this.contextTips = [...set];
            await this.saveSession({ contextTips: this.contextTips });
            if (this.convoIb) {
                try {
                    const tip = await navi.storage.tip.get(this.convoIb);
                    if (tip?.data) {
                        await navi.storage.tip.mut8(
                            this.convoIb,
                            { ...tip.data, contextTips: this.contextTips },
                            { create: true, replaceData: true }
                        );
                    }
                } catch {
                    /* ignore */
                }
            }
            return { contextTips: this.contextTips };
        }
    }

    // __dirname stand-in for Function-mounted modules
    let __dirname = ".";
    try {
        const path = nodeRequire("path");
        __dirname = path.join(process.cwd(), "B_native_mods");
    } catch {
        /* ignore */
    }

    const svc = new CursorSdkRelay();

    const HELP = [
        `cursor_sdk v${VERSION} — Cursor SDK local agent relay (native)`,
        "",
        "  cursor_sdk help|status",
        "  cursor_sdk key set <key> | key clear | key status",
        "  cursor_sdk cwd [path]",
        "  cursor_sdk model [id|list]",
        "  cursor_sdk vendor [force]     # auto npm i @cursor/sdk into appdata vendor",
        "  cursor_sdk ripgrep|rg         # resolve + set CURSOR_RIPGREP_PATH",
        "  cursor_sdk open [label]",
        "  cursor_sdk resume [agentId]",
        "  cursor_sdk say <prompt…>",
        "  cursor_sdk edit               # POST JSON {prompt,selection,navi,extras} (or prompt args)",
        "  cursor_sdk alias [name]       # relay alias for edits (default hq01)",
        "  cursor_sdk relay [on [alias]|off]   # opt-in: whitelist cursor_sdk/edit for relay, only via that alias (off by default)",
        "  cursor_sdk cancel | close | here",
        "  cursor_sdk convo list|show [id]|use <id>",
        "  cursor_sdk context tip <ib> [ib…]",
        "",
        `Tips: ${SECRETS_IB}, ${SESSION_IB}, ${SPEC_IB}, ${CONVO_PREFIX}{id}`,
        "Vendor: %APPDATA%\\.navi_shell\\cursor_sdk\\vendor (auto on first open/say)",
        "Edit protocol: browser mods POST cursor_sdk/edit → cursor_edit_v1 ops (apply client-side)",
    ].join("\n");

    const fmt = (obj) =>
        typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);

    const readEditPack = (argTail) => {
        const req =
            navi.callinRequest ||
            (typeof navi.getCallinRequest === "function"
                ? navi.getCallinRequest()
                : null);
        if (req?.body != null && String(req.body).trim()) {
            try {
                const parsed = JSON.parse(String(req.body));
                if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                    return parsed;
                }
            } catch {
                return { prompt: String(req.body) };
            }
        }
        const prompt = argTail.join(" ").trim();
        return { prompt };
    };

    const run = async (...rawArgs) => {
        ensureNative();
        const args = rawArgs
            .flatMap((a) =>
                typeof a === "string" ? a.split(/\s+/).filter(Boolean) : [a]
            )
            .map((a) => String(a))
            .filter((a) => a.length);
        const verb = String(args[0] || "help").toLowerCase();
        try {
            await svc.loadSession();
            switch (verb) {
                case "help":
                case "--help":
                case "-h":
                case "":
                    return HELP;
                case "status":
                    return fmt(await svc.status());
                case "key": {
                    const sub = String(args[1] || "status").toLowerCase();
                    if (sub === "status") return fmt(await svc.keyStatus());
                    if (sub === "clear") return fmt(await svc.keyClear());
                    if (sub === "set") {
                        return fmt(await svc.keySet(args.slice(2).join(" ")));
                    }
                    return "usage: cursor_sdk key set|clear|status";
                }
                case "cwd": {
                    const raw = args.slice(1).join("/");
                    return fmt(await svc.setCwd(raw));
                }
                case "model":
                    return fmt(
                        await svc.setModel(args.slice(1).join(" ") || "")
                    );
                case "vendor": {
                    const force = /^(force|reinstall|-f)$/i.test(
                        String(args[1] || "")
                    );
                    return fmt(svc.ensureVendor({ force }));
                }
                case "ripgrep":
                case "rg":
                    return fmt(svc.ensureRipgrepConfigured());
                case "alias":
                    if (args[1] == null) return svc.relayAlias || "(none)";
                    return fmt(await svc.setRelayAlias(args[1]));
                case "relay": {
                    const sub = String(args[1] || "status").toLowerCase();
                    if (sub === "status") return fmt(await svc.relayStatus());
                    if (sub === "on") return fmt(await svc.setRelay(true, args[2] || ""));
                    if (sub === "off") return fmt(await svc.setRelay(false));
                    return "usage: cursor_sdk relay [status|on [alias]|off]";
                }
                case "open":
                    return fmt(await svc.open(args.slice(1).join(" ")));
                case "resume":
                    return fmt(await svc.resume(args[1] || ""));
                case "say": {
                    const prompt = args.slice(1).join(" ");
                    return fmt(await svc.say(prompt));
                }
                case "edit":
                    return fmt(await svc.edit(readEditPack(args.slice(1))));
                case "cancel":
                    return fmt(await svc.cancel());
                case "close":
                    return fmt(await svc.close());
                case "here":
                    return fmt(await svc.here());
                case "convo": {
                    const sub = String(args[1] || "list").toLowerCase();
                    if (sub === "list") return fmt(await svc.convoList());
                    if (sub === "show") {
                        return fmt(await svc.convoShow(args[2] || ""));
                    }
                    if (sub === "use") {
                        return fmt(await svc.convoUse(args[2] || ""));
                    }
                    return "usage: cursor_sdk convo list|show|use";
                }
                case "context": {
                    const sub = String(args[1] || "").toLowerCase();
                    if (sub === "tip") {
                        return fmt(await svc.contextTip(args.slice(2)));
                    }
                    return "usage: cursor_sdk context tip <ib> […]";
                }
                default:
                    return `unknown: ${verb}\n\n${HELP}`;
            }
        } catch (e) {
            return `error: ${e.message || e}`;
        }
    };

    return {
        name: "cursor_sdk",
        version: VERSION,
        description:
            "Cursor SDK local agent relay — tip session/convo ledger + callout stream",

        moduleInfo: {
            name: "cursor_sdk",
            version: VERSION,
            description:
                "Native Cursor SDK relay (local cwd agent; tip-backed sessions)",
        },

        /** Programmatic API for fsdevops facade / other mods. */
        relay: svc,
        run,
        edit: (pack) => svc.edit(pack),
        say: (...a) => svc.say(a.join(" ")),
        parseCursorEditV1: (t) => svc.parseCursorEditV1(t),
        setRelayAlias: (a) => svc.setRelayAlias(a),
        open: (...a) => svc.open(a.join(" ")),
        resume: (...a) => svc.resume(a[0] || ""),
        close: () => svc.close(),
        cancel: () => svc.cancel(),
        here: () => svc.here(),
        status: () => svc.status(),
        setCwd: (p) => svc.setCwd(p),

        commands: {
            cursor_sdk: {
                name: "cursor_sdk",
                description:
                    "cursor_sdk open|say|resume|cwd|key|model|vendor|convo|context — Cursor SDK relay",
                execute: async (...args) => run(...args),
            },
        },

        onMount: async () => {
            if (isBrowser || !isNode) {
                log("mounted (browser/non-Node) — callins will refuse; native only");
                return;
            }
            try {
                await svc.loadSession();
                const relayProblem = svc.applyRelayWhitelist();
                if (svc.relayOn) {
                    log(relayProblem ? `relay: ${relayProblem}` : `relay: cursor_sdk/edit whitelisted via ${svc.relayAlias}`);
                }
                // Warm vendor in background so first say is faster
                timers.push(
                    setTimeout(() => {
                        try {
                            svc.ensureVendor();
                            svc.ensureRipgrepConfigured();
                        } catch (e) {
                            log(`vendor/rg warm: ${e.message || e}`);
                        }
                    }, 50)
                );
            } catch (e) {
                log(`session load: ${e.message || e}`);
            }
            log(`ready v${VERSION}`);
        },

        onUnmount: async () => {
            try {
                await svc.disposeAgent();
            } catch {
                /* ignore */
            }
            for (const t of timers) clearTimeout(t);
            for (const { target, type, fn, opts } of eventListeners) {
                try {
                    target.off?.(type, fn);
                    target.removeEventListener?.(type, fn, opts);
                } catch {
                    /* ignore */
                }
            }
            log("unmounted");
        },
    };
};
