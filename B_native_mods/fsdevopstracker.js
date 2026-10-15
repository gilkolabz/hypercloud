/**
 * fsdevopstracker — native tip-only flow-model project indexer + REPL.
 *
 * Callin:
 *   fsdevopstracker start|help|status|use|list|query|get|reinit|link
 *   fsdevopstracker put|append|mut8|ops|disk-push|hostpark-push
 *   fsdevopstracker goals|goal|sprint|pending …
 *
 * CRUD over callin multiplex (preferred for spaces / large text):
 *   POST path fsdevopstracker/append  body JSON { path, goal, body }
 *   (reads navi.callinRequest — works for local callin and relay alike)
 *
 * Tip space is the working set. disk-push dumps bins back onto the project root (overwrite).
 *
 * Relay testing: project route_prefix (from config.json flowerpot.root) mirrors to
 *   navi/<route_prefix>/<rel>  →  GET …/navi-jumbo/<route_prefix>/<rel>
 * Production: hostpark-push → remote hostpark at <route_prefix>/<rel> (push = hostpark config).
 * Usage tokens: mint externally, stash at a logical path, then `token stash` + `token feed`.
 */

export const register = (navi) => {
    const isBrowser =
        typeof window !== "undefined" && typeof window.document !== "undefined";
    const isNode =
        typeof process !== "undefined" &&
        !!(process.versions && process.versions.node);

    const CONFIG_IB = "fsdevopstracker:config";
    const VERSION = "0.9.3";
    const KEYCHAIN_MOUNT =
        "flowerpot/hypercloud/testkit/mods/legacy/keychain.js";
    const DEFAULT_HOSTPARK_HOST = String(
        navi?.origin || "https://foobarch.net"
    ).replace(/\/+$/, "");
    const LAYERS = [
        {
            id: "L0",
            label: "schema + facts shape",
            check: (s) => s.hasSchema || s.hasRegistry,
        },
        {
            id: "L1",
            label: "registry module",
            check: (s) => s.hasRegistry,
        },
        {
            id: "L2",
            label: "flow + manager + screens",
            check: (s) => s.hasFlow && s.hasManager && s.hasUi,
        },
        {
            id: "L3",
            label: "launch + bootstrap",
            check: (s) => s.hasLaunch,
        },
        {
            id: "L4",
            label: "routes / policy growth",
            check: (s) => s.hasFlow && s.uiCount >= 3,
        },
        {
            id: "L5",
            label: "extra resting modules",
            check: (s) => s.moduleCount >= 3,
        },
        {
            id: "L6",
            label: "variants / alt launches",
            check: (s) => s.launchCount >= 2 || s.flowCount >= 2,
        },
        {
            id: "L7",
            label: "programs / instances / builder",
            check: (s) => s.hasCatalog,
        },
        {
            id: "L8",
            label: "linker / graph / devops index",
            check: (s) => s.hasCatalog && s.hasDoc,
        },
    ];
    const DEFAULT_GOAL_SEEDS = LAYERS.map((L) => ({
        id: `layer-${L.id.toLowerCase()}`,
        text: `Complete ${L.id}: ${L.label}`,
        layer: L.id,
        status: "open",
        seeded: true,
    }));
    const SKIP_DIRS = new Set([
        ".git",
        "node_modules",
        ".navi_shell",
        "dist",
        "vendor",
    ]);
    const MAX_FILE_BYTES = 2 * 1024 * 1024;
    const ARTIFACT_TYPES = new Set([
        "ui",
        "launch",
        "flow",
        "module",
        "config",
        "doc",
        "data",
        "catalog",
        "schema",
        "pwa",
        "goals",
        "ops",
        "file",
    ]);

    const log = (...args) => console.log("[fsdevopstracker]", ...args);
    const out = (msg) => navi.callout(String(msg));

    const nodeRequire = (id) => navi.require(id);

    const HELP = [
        "fsdevopstracker — tip-only flow-model project tracker (native)",
        "",
        "CONCURRENCY: every project-scoped op requires project=<name>",
        "  (or REPL: use <name> sets an in-memory session default for this mount only).",
        "  Shared config active_project is NOT used for ops — safe to relay two projects at once.",
        "",
        "exit                 leave fsdevops> and restore navi>",
        "help                 this text",
        "init <name> <path> [y|n]  register + index (POST JSON {name,root} for relay paths)",
        "reinit project=<name>     wipe tips + re-comb project root (keeps devops goals/sprint tips)",
        "status               list projects in config (+ REPL session default)",
        "use <project>        REPL session default only (not shared; callin must still pass project=)",
        "list project=<name> [type]   list artifacts",
        "query project=<name> type=<t> path=<substr>",
        "get project=<name> <rel> | get <project:rel>",
        "link project=<name>  re-run link pass on planted tips",
        "mirror project=<name>  rebuild navi/<route_prefix>/… park mirrors (relay GET)",
        "",
        "route project=<name>               show logical route_prefix",
        "route project=<name> set prefix=<p>",
        "",
        "push project=<name>  hostpark config (policy, key, token stash)",
        "push project=<name> policy=<ib> key=<name>",
        "",
        "token project=<name> status|reset|load|feed|stash|add …",
        "keychain               mount legacy keychain mod if missing",
        "",
        "hostpark-push project=<name> <rel>|all goal=<why>",
        "  all = every tip in THAT project only (never other projects; skips :devops:)",
        "  prefer listing changed rels — do not hostpush all unless bootstrapping",
        "hostpush …            alias of hostpark-push",
        "",
        "put|append|mut8 project=<name> <path> goal=<why> body=<text>",
        "  callin POST JSON   { project, path, goal, body }",
        "ops project=<name> [n]",
        "ops-export project=<name>",
        "ops-reset project=<name>",
        "disk-push project=<name> [path=<substr>]",
        "",
        "goals project=<name>",
        "goal project=<name> add text=<t> [layer=L2]",
        "goal project=<name> done|open <id>",
        "sprint project=<name> …",
        "pending project=<name>",
        "",
        "cursor project=<name> status|open|say|here|close …",
        "  optional — needs mount flowerpot/torus/native/cursor_sdk",
        "  open sets cwd to the project root; say streams via cursor_sdk",
        "  cursor project=<name> say <prompt…> [goal=<why>]",
        "",
        "Blank enter prints: type help",
        "During init / y-n / put wizard, exit still leaves the entire fsdevops> session.",
    ].join("\n");

    /** @type {"idle"|"init_name"|"init_path"|"init_yn"|"crud_goal"|"crud_body"} */
    let mode = "idle";
    /** @type {{ name?: string, root?: string, op?: string, path?: string, goal?: string, project?: string, bodyLines?: string[] } | null} */
    let draft = null;
    let replActive = false;
    /**
     * REPL-only default project for this mounted instance.
     * Never written to the shared config tip — concurrent callins must pass project=.
     * @type {string | null}
     */
    let replSessionProject = null;

    const PROJECT_REQUIRED =
        "project required — pass project=<name> on every op (concurrent-safe). " +
        "REPL only: `use <name>` sets an in-memory session default for this mount.";

    const defaultConfig = () => ({
        projects: {},
        active_project: null,
    });

    async function loadConfig() {
        const tip = await navi.storage.tip.get(CONFIG_IB);
        const data = tip?.data?.fsdevopstracker;
        if (data && typeof data === "object") {
            return {
                projects:
                    data.projects && typeof data.projects === "object"
                        ? { ...data.projects }
                        : {},
                active_project: data.active_project ?? null,
            };
        }
        return defaultConfig();
    }

    async function saveConfig(cfg) {
        await navi.storage.tip.mut8(
            CONFIG_IB,
            {
                parts: ["fsdevopstracker_config", "ibgib_frame", "manifest", "json"],
                fsdevopstracker: {
                    projects: cfg.projects || {},
                    active_project: cfg.active_project ?? null,
                },
            },
            { create: true }
        );
    }

    /**
     * Resolve project for an op. Never uses shared config active_project
     * (that raced under concurrent relay). Order:
     *   1) explicit name
     *   2) REPL in-memory session default (actor starts with "repl")
     */
    async function requireProject(explicit, actor = "") {
        const cfg = await loadConfig();
        let name = String(explicit || "").trim();
        if (
            !name &&
            /^repl/i.test(String(actor || "")) &&
            replSessionProject
        ) {
            name = replSessionProject;
        }
        if (!name) throw new Error(PROJECT_REQUIRED);
        if (!cfg.projects[name]) throw new Error(`unknown project: ${name}`);
        return { cfg, name, project: cfg.projects[name] };
    }

    /** project= from kv, else positional[i] when that slot is the project name. */
    function projectToken(kv, positional, positionalIndex = 0) {
        const fromKv = String(kv?.project || "").trim();
        if (fromKv) return fromKv;
        return String(positional?.[positionalIndex] || "").trim();
    }

    function stripRoutePrefix(s) {
        return String(s || "")
            .replace(/^(?:flowerpot|hostpark)[/:]/i, "")
            .replace(/^\/+|\/+$/g, "");
    }

    const stripFlowerpotPrefix = stripRoutePrefix;

    function resolveHostparkHost(rawHost) {
        const raw = String(rawHost || "").replace(/\/+$/, "");
        if (!raw || /flowerpot/i.test(raw)) return DEFAULT_HOSTPARK_HOST;
        if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
            return `https://${raw}`;
        }
        return raw;
    }

    /** Policy tip ib only — never store addr^gib (host resolves via getTip(ib)). */
    function normalizePolicyIb(addr) {
        const a = String(addr || "").trim();
        if (!a || a === "policies") return "";
        return a.includes("^") ? a.split("^")[0] : a;
    }

    function hostparkCfg(project) {
        const src =
            project?.hostpark && typeof project.hostpark === "object"
                ? { ...project.hostpark }
                : project?.push && typeof project.push === "object"
                  ? { ...project.push }
                  : project?.publish && typeof project.publish === "object"
                    ? { ...project.publish }
                  : project?.flowerpot && typeof project.flowerpot === "object"
                    ? { ...project.flowerpot }
                    : {};
        const route_prefix = stripRoutePrefix(
            src.route_prefix || project?.route_prefix || ""
        );
        const storedHost = String(src.host || "").trim();
        const host =
            !storedHost ||
            storedHost === "https" ||
            storedHost === "http"
                ? DEFAULT_HOSTPARK_HOST
                : resolveHostparkHost(storedHost);
        return {
            host,
            route_prefix,
            policy_addr: normalizePolicyIb(src.policy_addr || src.policy),
            key_name: String(src.key_name || "fsdevopstracker").trim(),
            token_stash_path: stripRoutePrefix(
                src.token_stash_path || src.stash || ""
            ),
            spare_tokens: Array.isArray(src.spare_tokens)
                ? src.spare_tokens.map(String)
                : [],
        };
    }

    async function patchHostparkConfig(name, patch) {
        const cfg = await loadConfig();
        const cur = cfg.projects[name] || {};
        const next = { ...patch };
        if (next.policy != null || next.policy_addr != null) {
            next.policy_addr = normalizePolicyIb(
                next.policy_addr || next.policy || ""
            );
            delete next.policy;
        }
        const hp = { ...hostparkCfg(cur), ...next };
        cfg.projects[name] = {
            ...cur,
            hostpark: hp,
            push: hp,
            route_prefix: hp.route_prefix,
        };
        await saveConfig(cfg);
        return hp;
    }

    /** Parse consumable token JSON (potter / devops stash shape). */
    function parseTokenPayload(text) {
        const parsed = JSON.parse(String(text).replace(/^\uFEFF/, "").trim());
        let incoming = [];
        if (Array.isArray(parsed)) incoming = parsed;
        else if (parsed && Array.isArray(parsed["spare tokens"])) {
            incoming = parsed["spare tokens"];
        } else if (parsed && Array.isArray(parsed.tokens)) {
            incoming = parsed.tokens;
        } else {
            throw new Error(
                'expected JSON array, {"spare tokens":[…]}, or {"tokens":[…]}'
            );
        }
        return incoming.map(String).filter(Boolean);
    }

    async function feedTokenStash(name, rawPath) {
        const { project } = await requireProject(name);
        const fp = hostparkCfg(project);
        const path = stripFlowerpotPrefix(rawPath || fp.token_stash_path);
        if (!path) {
            throw new Error(
                "token feed needs stash path — token stash path=<route> or token feed <route>"
            );
        }
        if (typeof fetch !== "function") {
            throw new Error("fetch unavailable — cannot load token stash");
        }
        const res = await fetch(`${fp.host}/${path}`);
        const text = await res.text();
        if (!res.ok) {
            throw new Error(`GET ${path} → ${res.status}: ${text.slice(0, 200)}`);
        }
        const incoming = parseTokenPayload(text);
        const tokens = await getSpareTokens(name);
        let added = 0;
        const seen = new Set(tokens);
        for (const t of incoming) {
            if (seen.has(t)) continue;
            seen.add(t);
            tokens.push(t);
            added++;
        }
        await patchHostparkConfig(name, { token_stash_path: path });
        await persistSpareTokens(name);
        return { path, added, spare: tokens.length };
    }

    async function loadTokenFile(name, filePath) {
        const fs = nodeRequire("fs");
        const raw = String(filePath || "").trim();
        if (!raw) throw new Error("usage: token load <file.json>");
        const text = fs.readFileSync(raw, "utf8");
        const incoming = parseTokenPayload(text);
        const tokens = await getSpareTokens(name);
        const seen = new Set(tokens);
        let added = 0;
        for (const t of incoming) {
            if (seen.has(t)) continue;
            seen.add(t);
            tokens.unshift(t); // fresh first — consumed leftovers sit at end
            added++;
        }
        await persistSpareTokens(name);
        return { file: raw, added, spare: tokens.length };
    }

    function logicalRoute(routePrefix, rel) {
        const p = stripFlowerpotPrefix(routePrefix);
        const r = String(rel || "").replace(/^\/+/, "");
        return p ? `${p}/${r}` : r;
    }

    function mirrorParkIb(routePrefix, rel) {
        const route = logicalRoute(routePrefix, rel);
        if (!route) return "";
        return `navi/${route}`.replace(/\/+/g, "/");
    }

    async function readFlowerpotRootFromDisk(rootAbs) {
        const fs = nodeRequire("fs");
        const pathMod = nodeRequire("path");
        const cfgPath = pathMod.join(rootAbs, "config.json");
        if (!fs.existsSync(cfgPath)) return "";
        try {
            const j = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
            const root = j?.flowerpot?.root || j?.flowerpot_root || "";
            return stripFlowerpotPrefix(root);
        } catch {
            return "";
        }
    }

    async function mirrorParkTip(
        projectName,
        routePrefix,
        primaryIb,
        rel,
        sha,
        mime,
        encoding
    ) {
        const prefix = stripFlowerpotPrefix(routePrefix);
        if (!prefix) return null;
        const mib = mirrorParkIb(prefix, rel);
        if (!mib) return null;
        await navi.storage.tip.mut8(
            mib,
            {
                parts: [
                    "fsdevopstracker_mirror",
                    "ibgib_frame",
                    "park",
                    "bin",
                ],
                project: projectName,
                path: rel,
                route: logicalRoute(prefix, rel),
                mirror_of: primaryIb,
                content_type: mime,
                encoding,
                source: "fsdevopstracker:mirror",
                method: { GET: { kind: "bin" } },
            },
            {
                create: true,
                replaceData: true,
                rel8ns: { bin: [`bin ${sha}`], past: [] },
            }
        );
        return mib;
    }

    async function wipeMirrorTips(routePrefix) {
        const prefix = stripFlowerpotPrefix(routePrefix);
        if (!prefix) return 0;
        const ibPrefix = `navi/${prefix}/`;
        const tips = await navi.storage.tip.list();
        let n = 0;
        for (const ib of tips) {
            if (!String(ib).startsWith(ibPrefix)) continue;
            try {
                await navi.storage.tip.del(ib);
                n++;
            } catch {
                /* ignore */
            }
        }
        return n;
    }

    /** Fetch module bytes from flowerpot route (warez subject.ib shape). */
    async function fetchRouteModule(spec) {
        const raw = String(spec || "").trim().replace(/^\/+/, "");
        const routes = [];
        const add = (p) => {
            const r = String(p || "").trim().replace(/^\/+/, "");
            if (r && !routes.includes(r)) routes.push(r);
        };
        add(raw);
        if (!/^flowerpot\//i.test(raw)) {
            add(`flowerpot/${raw}`);
        }
        const origins = [
            String(navi?.origin || DEFAULT_HOSTPARK_HOST).replace(/\/+$/, ""),
            "https://foobarch.net",
        ].filter((v, i, a) => v && a.indexOf(v) === i);
        const headers = {
            Accept: "application/navi-module, application/javascript, text/plain",
        };
        let lastErr = null;
        for (const route of routes) {
            for (const origin of origins) {
                const url = `${origin}/${route}`;
                try {
                    const res = await fetch(url, { headers });
                    const code = await res.text();
                    if (res.ok) return code;
                    lastErr = new Error(
                        `GET ${route} → ${res.status}: ${code.slice(0, 160)}`
                    );
                } catch (e) {
                    lastErr = e;
                }
            }
        }
        throw lastErr || new Error(`could not fetch module route: ${raw}`);
    }

    async function ensureKeychainMounted() {
        if (navi.mod?.keychain?.signWrite) return;
        const spec = KEYCHAIN_MOUNT;
        const mountLine = `mount ${spec}`;
        try {
            const surfMount = navi.mod?.surf?.commands?.mount?.execute;
            if (typeof surfMount === "function") {
                const result = await surfMount(spec);
                const msg = String(result || "");
                if (/^Error:/i.test(msg)) {
                    throw new Error(msg.replace(/^Error:\s*/i, ""));
                }
            } else if (typeof navi.mount === "function") {
                const code = await fetchRouteModule(spec);
                await navi.mount(code);
            } else {
                throw new Error("navi.mount unavailable");
            }
        } catch (e) {
            throw new Error(
                `keychain mount failed: ${e?.message || e} — try: ${mountLine}`
            );
        }
        if (!navi.mod?.keychain?.signWrite) {
            throw new Error(
                `keychain not mounted — fsdevopstracker keychain  (tried ${mountLine})`
            );
        }
    }

    /** In-memory spare tokens — shift in RAM; flush once after hostpark-push (not per file). */
    const tokenBagCache = new Map(); // name → string[]

    async function getSpareTokens(name) {
        if (tokenBagCache.has(name)) return tokenBagCache.get(name);
        const cfg = await loadConfig();
        const fp = hostparkCfg(cfg.projects[name]);
        const tokens = fp.spare_tokens.slice();
        tokenBagCache.set(name, tokens);
        return tokens;
    }

    async function persistSpareTokens(name) {
        const tokens = tokenBagCache.get(name);
        if (!tokens) return;
        await patchHostparkConfig(name, { spare_tokens: tokens.slice() });
    }

    async function takeProjectToken(name) {
        const tokens = await getSpareTokens(name);
        if (!tokens.length) {
            throw new Error(
                "no hostpark tokens — token feed <stash-path> or token load <file>"
            );
        }
        return tokens.shift();
    }

    async function returnProjectToken(name, token) {
        const tokens = await getSpareTokens(name);
        tokens.unshift(String(token));
    }

    function sha256Hex(buf) {
        const crypto = nodeRequire("crypto");
        return crypto.createHash("sha256").update(buf).digest("hex");
    }

    function buildHostparkShellFrame(ib, bytes, opts) {
        const sha = sha256Hex(bytes);
        const gib = sha.toUpperCase();
        /** @type {Record<string, unknown>} */
        const rel8ns = {
            bin: [`bin ${sha}`],
            past: opts.parentAddr ? [String(opts.parentAddr)] : [],
            tjp: [],
            dna: [],
        };
        if (opts.policyIb) {
            rel8ns.policy = [String(opts.policyIb)];
        }
        return {
            ib,
            gib,
            data: {
                parts: ["network_proposal", "ibgib_frame", "manifest", "json"],
                park: "defer",
                content_type: opts.contentType,
                default_method: "GET",
                method: {
                    GET: { kind: "bin" },
                    PUT: { kind: "commit" },
                },
                n: opts.n || 0,
                timestamp: new Date().toUTCString(),
            },
            rel8ns,
        };
    }

    function buildHostparkPutEnvelope(frame, bytes, contentType) {
        const sha = sha256Hex(bytes);
        const transform =
            Array.isArray(frame.rel8ns?.past) && frame.rel8ns.past.length
                ? "mut8"
                : "firstGen";
        return {
            transform,
            newIbGib: frame,
            dnas: [],
            intermediateIbGibs: [],
            bin: {
                sha256: sha,
                content_type: contentType,
                byte_length: bytes.length,
                bytes_b64: bytes.toString("base64"),
            },
        };
    }

    async function remoteHostparkTip(host, ib) {
        if (typeof fetch !== "function") {
            throw new Error("fetch unavailable — cannot reach hostpark");
        }
        const res = await fetch(
            `${host}/foobarch/tip/${encodeURIComponent(ib)}`
        );
        if (res.status === 404) return null;
        const text = await res.text();
        if (!res.ok) {
            throw new Error(`hostpark tip ${ib} → ${res.status}: ${text.slice(0, 200)}`);
        }
        return JSON.parse(text);
    }

    async function hostparkPut(name, route, bodyBuf, contentType, keyName) {
        const fp = hostparkCfg((await requireProject(name)).project);
        await ensureKeychainMounted();
        const keys = await navi.mod.keychain.list();
        if (!keys.includes(keyName)) {
            throw new Error(
                `keychain has no key '${keyName}' — import the authorized policy key ` +
                    `(keychain import ${keyName} --pub … --priv …) then push key=${keyName}. ` +
                    `Refusing to create a random key that would fail policies/torus.`
            );
        }
        const buf = Buffer.isBuffer(bodyBuf)
            ? bodyBuf
            : Buffer.from(bodyBuf ?? []);
        let lastErr = null;
        for (let attempt = 0; attempt < 8; attempt++) {
            const token = await takeProjectToken(name);
            let held = true;
            try {
                const live = await remoteHostparkTip(fp.host, route);
                const parentAddr =
                    live && !live.tombstone ? String(live.addr || "") : "";
                if (!parentAddr && !fp.policy_addr) {
                    throw new Error(
                        "first hostpark-push on route needs push policy=<ib> (e.g. policies/torus)"
                    );
                }
                const n = parentAddr
                    ? Number(live?.frame?.data?.n || 0) + 1
                    : 0;
                const frame = buildHostparkShellFrame(route, buf, {
                    policyIb: fp.policy_addr,
                    parentAddr: parentAddr || null,
                    n,
                    contentType,
                });
                const envelope = buildHostparkPutEnvelope(frame, buf, contentType);
                const bodyStr = JSON.stringify(envelope);
                /** @type {Record<string, string>} */
                const headers = {
                    "Content-Type": "application/json",
                    "X-Foobarch-Usage-Token": token,
                    "X-Flowerpot-Usage-Token": token,
                };
                if (
                    fp.policy_addr &&
                    (parentAddr || !live) &&
                    navi.mod?.keychain?.signWrite
                ) {
                    const signed = await navi.mod.keychain.signWrite({
                        ib: route,
                        parentAddr: parentAddr || "",
                        body: bodyStr,
                        contentType: "application/json",
                        key: keyName,
                        scheme: "proposal",
                    });
                    Object.assign(
                        headers,
                        navi.mod.keychain.buildSignHeaders({
                            publicKey: signed.publicKey,
                            signature: signed.signature,
                        })
                    );
                }
                const res = await fetch(`${fp.host}/${route}`, {
                    method: "PUT",
                    headers,
                    body: bodyStr,
                });
                const text = await res.text();
                if (!res.ok) {
                    if (/already consumed/i.test(text)) {
                        held = false;
                        lastErr = new Error(
                            `hostpark PUT ${route} → ${res.status}: ${text.slice(0, 240)}`
                        );
                        continue;
                    }
                    throw new Error(
                        `hostpark PUT ${route} → ${res.status}: ${text.slice(0, 240)}`
                    );
                }
                held = false;
                let addr =
                    res.headers.get("x-flowerpot-ib^gib") ||
                    res.headers.get("x-foobarch-ib^gib") ||
                    "";
                if (!addr) {
                    try {
                        addr = JSON.parse(text).addr || "";
                    } catch {
                        addr = "";
                    }
                }
                return addr || route;
            } catch (err) {
                if (held) await returnProjectToken(name, token);
                throw err;
            }
        }
        throw lastErr || new Error(`hostpark PUT ${route}: too many dead tokens`);
    }

    async function rebuildMirrors(projectName) {
        const { name, project } = await requireProject(projectName);
        const fp = hostparkCfg(project);
        if (!fp.route_prefix) {
            throw new Error("no route_prefix — route set prefix=… or index with config.json flowerpot.root");
        }
        await wipeMirrorTips(fp.route_prefix);
        const ibs = await listProjectIbs(name);
        let n = 0;
        for (const ib of ibs) {
            if (String(ib).includes(":devops:")) continue;
            const tip = await navi.storage.tip.get(ib);
            const rel = tip?.data?.path;
            const sha = tip?.rel8ns?.bin?.[0]?.replace(/^bin\s+/, "");
            if (!rel || !sha) continue;
            await mirrorParkTip(
                name,
                fp.route_prefix,
                ib,
                rel,
                sha,
                tip.data?.content_type || mimeFor(rel),
                tip.data?.encoding || "utf8"
            );
            n++;
        }
        return n;
    }

    function mimeFor(rel) {
        const ext = String(rel).split(".").pop()?.toLowerCase() || "";
        const map = {
            html: "text/html; charset=utf-8",
            htm: "text/html; charset=utf-8",
            js: "application/javascript",
            mjs: "application/javascript",
            json: "application/json",
            md: "text/markdown; charset=utf-8",
            txt: "text/plain; charset=utf-8",
            css: "text/css; charset=utf-8",
            svg: "image/svg+xml",
            png: "image/png",
            jpg: "image/jpeg",
            jpeg: "image/jpeg",
            gif: "image/gif",
            webp: "image/webp",
            ico: "image/x-icon",
            bmp: "image/bmp",
            avif: "image/avif",
            woff: "font/woff",
            woff2: "font/woff2",
            ttf: "font/ttf",
            otf: "font/otf",
            mp3: "audio/mpeg",
            wav: "audio/wav",
            ogg: "audio/ogg",
            mp4: "video/mp4",
            webm: "video/webm",
            webmanifest: "application/manifest+json",
            lua: "text/x-lua",
        };
        return map[ext] || "application/octet-stream";
    }

    function classifyArtifact(rel, media) {
        const r = String(rel).replace(/\\/g, "/");
        const base = r.split("/").pop() || "";
        const lower = r.toLowerCase();
        const text = typeof media === "string" ? media : "";

        if (base === "config.json") return "config";
        if (base === "goals.json" && /\/devops\//i.test(lower)) return "goals";
        if (base === "ops.json" && /\/devops\//i.test(lower)) return "ops";
        if (/^goals\.md$/i.test(base) || /\/goals\.md$/i.test(lower))
            return "goals";
        if (/\.(md|txt)$/i.test(base) || /devguide|readme/i.test(base))
            return "doc";

        // Shared L3 product skin CSS (prefer ui/{product}_skin.css).
        if (
            /_skin\.css$/i.test(base) ||
            (/\.css$/i.test(base) && /skin/i.test(base))
        ) {
            return "skin";
        }

        // Static visual / audio / font bytes — not screen roles (ui/).
        // Prefer project folder assets/ (aliases art/, media/).
        if (
            /\/(assets|art|media)\//i.test(lower) ||
            /^(assets|art|media)\//i.test(lower) ||
            /\.(svg|png|jpe?g|gif|webp|ico|bmp|avif|woff2?|ttf|otf|mp3|wav|ogg|mp4|webm)$/i.test(
                base
            )
        ) {
            return "assets";
        }

        if (
            /artifacts\.json$/i.test(base) ||
            /programs\.json$/i.test(base) ||
            /folder_instances\.json$/i.test(base) ||
            /launch_index\.json$/i.test(base) ||
            /registry_index\.json$/i.test(base)
        ) {
            return "catalog";
        }

        if (/\/flow\/.+\.json$/i.test(lower) || /^flow\//i.test(lower)) {
            if (/"routes"\s*:/.test(text) && /"policy"\s*:/.test(text))
                return "flow";
            return "data";
        }

        if (/\/launch\//i.test(lower) || /^launch\//i.test(lower)) {
            if (/\.html?$/i.test(base)) return "launch";
            return "launch";
        }

        if (
            /\/programs\//i.test(lower) ||
            /^programs\//i.test(lower)
        ) {
            if (/\.json$/i.test(base)) return "catalog";
        }

        if (/\/ui\//i.test(lower) || /^ui\//i.test(lower)) {
            if (
                /_skin\.css$/i.test(base) ||
                (/\.css$/i.test(base) && /skin/i.test(base))
            ) {
                return "skin";
            }
            return "ui";
        }

        if (/\/modules\/.+\.js$/i.test(lower) || /^modules\//i.test(lower)) {
            if (/_manager\.js$/i.test(base)) return "module";
            if (/_registry\.js$/i.test(base)) return "module";
            if (/_init\.js$/i.test(base)) return "module";
            return "module";
        }

        if (/\/schema\//i.test(lower) || /^schema\//i.test(lower)) return "schema";
        if (/\/data\//i.test(lower) || /^data\//i.test(lower)) {
            if (/"id"\s*:/.test(text) && /"source_rel"\s*:/.test(text))
                return "catalog";
            return "data";
        }
        if (/\/pwa\//i.test(lower) || /\.webmanifest$/i.test(base)) return "pwa";
        if (/\.html?/i.test(base)) {
            if (/launch/i.test(base) || /\bFLOW\s*=/.test(text)) return "launch";
            return "ui";
        }
        if (/\.js$/i.test(base) && /export\s+const\s+register/.test(text))
            return "module";
        return "file";
    }

    function moduleRole(rel) {
        const base = String(rel).split("/").pop() || "";
        if (/_manager\.js$/i.test(base)) return "manager";
        if (/_registry\.js$/i.test(base)) return "registry";
        if (/_init\.js$/i.test(base)) return "init";
        return null;
    }

    function walkFiles(fs, pathMod, rootAbs) {
        const outFiles = [];
        const stack = [rootAbs];
        while (stack.length) {
            const dir = stack.pop();
            let entries;
            try {
                entries = fs.readdirSync(dir, { withFileTypes: true });
            } catch (err) {
                out(`skip unreadable dir: ${dir} (${err.message || err})`);
                continue;
            }
            for (const ent of entries) {
                const name = ent.name;
                if (name === "." || name === "..") continue;
                if (SKIP_DIRS.has(name)) continue;
                const full = pathMod.join(dir, name);
                if (ent.isDirectory()) stack.push(full);
                else if (ent.isFile()) outFiles.push(full);
            }
        }
        return outFiles;
    }

    function toRelPosix(pathMod, rootAbs, fileAbs) {
        let rel = pathMod.relative(rootAbs, fileAbs);
        rel = rel.split(pathMod.sep).join("/");
        return rel.replace(/^(\.\/)+/, "");
    }

    async function plantFileTip(projectName, rel, buf, mime, routePrefix) {
        const ib = `${projectName}:${rel}`;
        let media;
        let encoding = "utf8";
        const textish =
            /^text\//.test(mime) ||
            /javascript|json|xml|svg|lua|markdown/.test(mime) ||
            /\.(html?|js|mjs|json|md|txt|css|svg|lua|webmanifest)$/i.test(rel);
        if (textish) media = buf.toString("utf8");
        else {
            media = buf.toString("base64");
            encoding = "base64";
        }
        const sha = await navi.storage.bin.putMedia({ media, mime });
        const text = textish ? media : "";
        const artifact_type = classifyArtifact(rel, text);
        const role = artifact_type === "module" ? moduleRole(rel) : null;
        /** @type {Record<string, any>} */
        const data = {
            parts: [
                "fsdevopstracker_artifact",
                "ibgib_frame",
                "manifest",
                "json",
            ],
            project: projectName,
            path: rel,
            artifact_type,
            content_type: mime,
            encoding,
            source: "fsdevopstracker:index",
            links: [],
            route: routePrefix
                ? logicalRoute(routePrefix, rel)
                : undefined,
        };
        if (role) data.module_role = role;
        await navi.storage.tip.mut8(ib, data, {
            create: true,
            replaceData: true,
            rel8ns: { bin: [`bin ${sha}`], past: [] },
        });
        if (routePrefix) {
            await mirrorParkTip(
                projectName,
                routePrefix,
                ib,
                rel,
                sha,
                mime,
                encoding
            );
        }
        return { ib, artifact_type, rel, media: text, sha, mime, encoding };
    }

    async function listProjectIbs(projectName) {
        const tips = await navi.storage.tip.list();
        const prefix = `${projectName}:`;
        return tips
            .filter((ib) => String(ib).startsWith(prefix))
            .sort((a, b) => String(a).localeCompare(String(b)));
    }

    function resolveRefToIb(projectName, relSet, ref) {
        const raw = String(ref || "").trim();
        if (!raw) return null;
        if (raw.startsWith(`${projectName}:`)) return raw;
        let s = raw
            .replace(/^['"]|['"]$/g, "")
            .replace(/\\/g, "/")
            .replace(/^\/+/, "");
        if (s.startsWith("flowerpot/")) s = s.slice("flowerpot/".length);
        if (s.startsWith("navi/")) s = s.slice("navi/".length);
        if (relSet.has(s)) return `${projectName}:${s}`;
        for (const rel of relSet) {
            if (s.endsWith("/" + rel) || s.endsWith(rel)) {
                if (s.length === rel.length || s.endsWith("/" + rel))
                    return `${projectName}:${rel}`;
            }
        }
        // flowerpot/…/ui/x.html → try ui/x.html
        const m = s.match(/(?:^|\/)((?:ui|flow|modules|data|schema|pwa)\/.+)$/i);
        if (m && relSet.has(m[1])) return `${projectName}:${m[1]}`;
        return null;
    }

    function pushLink(bag, fromIb, kind, targetIb, via) {
        if (!targetIb || targetIb === fromIb) return;
        const key = `${kind}|${targetIb}`;
        if (bag[fromIb].seen.has(key)) return;
        bag[fromIb].seen.add(key);
        bag[fromIb].links.push({
            kind,
            target_ib: targetIb,
            via: via || kind,
        });
        if (!bag[fromIb].rel[kind]) bag[fromIb].rel[kind] = [];
        if (!bag[fromIb].rel[kind].includes(targetIb)) {
            bag[fromIb].rel[kind].push(targetIb);
        }
    }

    async function linkProject(projectName) {
        const ibs = await listProjectIbs(projectName);
        const relSet = new Set(
            ibs.map((ib) => String(ib).slice(projectName.length + 1))
        );
        /** @type {Record<string, { links: any[], rel: Record<string, string[]>, seen: Set<string>, patch: Record<string, any> }>} */
        const bag = {};
        for (const ib of ibs) {
            bag[ib] = { links: [], rel: {}, seen: new Set(), patch: {} };
        }

        const loadMedia = async (ib) => {
            try {
                return await navi.storage.bin.mediaFromTip(ib);
            } catch {
                return null;
            }
        };

        for (const ib of ibs) {
            const tip = await navi.storage.tip.get(ib);
            const type = tip?.data?.artifact_type;
            const rel = tip?.data?.path || String(ib).slice(projectName.length + 1);
            const media = await loadMedia(ib);
            if (media == null) continue;

            if (type === "flow") {
                let j;
                try {
                    j = JSON.parse(media);
                } catch {
                    continue;
                }
                const routes = j.routes || {};
                for (const [key, url] of Object.entries(routes)) {
                    const target = resolveRefToIb(projectName, relSet, url);
                    if (target)
                        pushLink(bag, ib, "route", target, `routes.${key}`);
                }
                if (j.entry != null) bag[ib].patch.flow_entry = j.entry;
                if (j.id != null) bag[ib].patch.flow_id = j.id;
            }

            if (type === "config") {
                let j;
                try {
                    j = JSON.parse(media);
                } catch {
                    continue;
                }
                const fp = j.flowerpot || j;
                for (const [k, v] of Object.entries(fp)) {
                    if (typeof v !== "string") continue;
                    const target = resolveRefToIb(projectName, relSet, v);
                    if (!target) continue;
                    const kind =
                        /flow/i.test(k)
                            ? "flow"
                            : /manager|registry|init|module/i.test(k)
                              ? "module"
                              : /launch/i.test(k)
                                ? "launch"
                                : "ref";
                    pushLink(bag, ib, kind, target, k);
                }
            }

            if (type === "launch") {
                const flowM = media.match(
                    /(?:const|let|var)\s+FLOW\s*=\s*["']([^"']+)["']/
                );
                const initM = media.match(
                    /(?:const|let|var)\s+INIT\s*=\s*["']([^"']+)["']/
                );
                if (flowM) {
                    const t = resolveRefToIb(projectName, relSet, flowM[1]);
                    if (t) pushLink(bag, ib, "flow", t, "FLOW");
                }
                if (initM) {
                    const t = resolveRefToIb(projectName, relSet, initM[1]);
                    if (t) pushLink(bag, ib, "module", t, "INIT");
                }
                const mountM = media.matchAll(
                    /mount\s+(?:flowerpot\/)?([^\s"']+)/gi
                );
                for (const m of mountM) {
                    const t = resolveRefToIb(projectName, relSet, m[1]);
                    if (t) pushLink(bag, ib, "module", t, "mount");
                }
            }

            if (type === "catalog") {
                let j;
                try {
                    j = JSON.parse(media);
                } catch {
                    continue;
                }
                const walk = (node, via) => {
                    if (!node || typeof node !== "object") return;
                    if (typeof node.source_rel === "string") {
                        const t = resolveRefToIb(
                            projectName,
                            relSet,
                            node.source_rel
                        );
                        if (t) pushLink(bag, ib, "artifact", t, via || "source_rel");
                    }
                    if (typeof node.flow_id === "string") {
                        /* typed id — keep as data annotation only */
                    }
                    for (const [k, v] of Object.entries(node)) {
                        if (v && typeof v === "object") walk(v, k);
                    }
                };
                if (j.artifacts) walk(j.artifacts, "artifacts");
                else walk(j, rel);
            }
        }

        let linked = 0;
        for (const ib of ibs) {
            const entry = bag[ib];
            const hasLinks = entry.links.length > 0;
            const hasPatch = Object.keys(entry.patch).length > 0;
            if (!hasLinks && !hasPatch) continue;
            const tip = await navi.storage.tip.get(ib);
            const priorBin = tip?.rel8ns?.bin;
            await navi.storage.tip.mut8(
                ib,
                {
                    ...(hasLinks ? { links: entry.links } : {}),
                    ...entry.patch,
                },
                {
                    rel8ns: {
                        ...(priorBin ? { bin: priorBin } : {}),
                        ...entry.rel,
                    },
                }
            );
            linked++;
        }
        out(`link pass: ${linked} tip(s) with edges`);
        return linked;
    }

    async function wipeProjectTips(name, opts = {}) {
        const keepDevops = !!opts.keepDevops;
        const tips = await navi.storage.tip.list();
        const prefix = `${name}:`;
        const devopsPrefix = `${name}:devops:`;
        let n = 0;
        for (const ib of tips) {
            if (ib === CONFIG_IB) continue;
            if (!String(ib).startsWith(prefix)) continue;
            if (keepDevops && String(ib).startsWith(devopsPrefix)) continue;
            try {
                await navi.storage.tip.del(ib);
                n++;
            } catch {
                /* ignore */
            }
        }
        return n;
    }

    function opsIb(projectName) {
        return `${projectName}:devops:ops`;
    }
    function goalsIb(projectName) {
        return `${projectName}:devops:goals`;
    }
    function sprintIb(projectName) {
        return `${projectName}:devops:sprint`;
    }
    function progressIb(projectName) {
        return `${projectName}:devops:progress`;
    }

    function opEntryKey(entry) {
        if (!entry || typeof entry !== "object") return "";
        return (
            entry.id ||
            `${entry.path || entry.target_ib || ""}|${entry.at || ""}|${entry.goal || entry.op || ""}`
        );
    }

    async function walkOpsFrames(projectName) {
        const ib = opsIb(projectName);
        if (typeof navi.storage?.tip?.lineage === "function") {
            return await navi.storage.tip.lineage(ib);
        }
        const head = await navi.storage.tip.get(ib);
        if (!head) return [];
        const hits = [];
        const seen = new Set();
        let frame = head;
        while (frame) {
            const tipIb = String(frame.ib || ib).trim();
            const gib = String(frame.gib || "").trim();
            if (!gib) break;
            const addr = `${tipIb}^${gib}`;
            if (seen.has(addr)) break;
            seen.add(addr);
            hits.push({ addr, ib: tipIb, gib, frame });
            const past0 = Array.isArray(frame.rel8ns?.past)
                ? String(frame.rel8ns.past[0] || "").trim()
                : "";
            if (!past0) break;
            frame = await navi.storage.tip.frame.get(past0);
        }
        return hits;
    }

    function opsFromFrameData(data) {
        const ev = data?.event;
        if (ev?.kind === "ops-batch" && Array.isArray(ev.ops)) {
            return {
                action: String(ev.action || "add").toLowerCase(),
                ops: ev.ops,
            };
        }
        if (data?.op && typeof data.op === "object") {
            return { action: "add", ops: [data.op] };
        }
        if (Array.isArray(data?.ops)) {
            return { action: "add", ops: data.ops };
        }
        return null;
    }

    async function loadOps(projectName) {
        const hits = await walkOpsFrames(projectName);
        const outOps = [];
        const seen = new Set();
        for (const hit of hits.slice().reverse()) {
            const frame = hit.frame || hit;
            const batch = opsFromFrameData(frame?.data || {});
            if (!batch) continue;
            if (batch.action === "remove") {
                for (const entry of batch.ops) {
                    const key = opEntryKey(entry);
                    if (!key) continue;
                    const idx = outOps.findIndex((e) => opEntryKey(e) === key);
                    if (idx >= 0) outOps.splice(idx, 1);
                    seen.delete(key);
                }
                continue;
            }
            for (const entry of batch.ops) {
                const key = opEntryKey(entry);
                if (!key || seen.has(key)) continue;
                seen.add(key);
                outOps.push(entry);
            }
        }
        return outOps;
    }

    async function saveOpBulkEvent(projectName, opts = {}) {
        const action = String(opts.action || "add").toLowerCase();
        const batch = Array.isArray(opts.ops) ? opts.ops : [];
        if (!batch.length) return null;
        const ib = opsIb(projectName);
        let tip = await navi.storage.tip.get(ib);
        if (!tip?.data) {
            tip = await navi.storage.tip.mut8(
                ib,
                {
                    parts: [
                        "fsdevopstracker_ops",
                        "ibgib_frame",
                        "manifest",
                        "json",
                    ],
                    project: projectName,
                    artifact_type: "ops",
                    about: {
                        label: ib,
                        description:
                            "devops ops — ops-batch event per mut8 (lineage via past)",
                    },
                },
                { create: true }
            );
        }
        const event = {
            kind: "ops-batch",
            action: action === "remove" ? "remove" : "add",
            at: opts.at || new Date().toISOString(),
            actor: String(opts.actor || "fsdevopstracker"),
            ops: batch,
        };
        await navi.storage.tip.mut8(
            ib,
            {
                parts: [
                    "fsdevopstracker_ops",
                    "ibgib_frame",
                    "manifest",
                    "json",
                ],
                project: projectName,
                artifact_type: "ops",
                event,
            },
            { replaceData: true }
        );
        return event;
    }

    /**
     * Optional bulk snapshot only. Source of truth is `{project}:devops:ops`
     * delta frames (one ops-batch mut8 per append) — never rewrite this on put.
     */
    async function syncOpsExportFile(projectName) {
        const cfg = await loadConfig();
        const rootAbs = String(cfg.projects?.[projectName]?.root || "").trim();
        if (!rootAbs) return null;
        const fs = nodeRequire("fs");
        const pathMod = nodeRequire("path");
        const ops = await loadOps(projectName);
        const rel = "devops/ops.json";
        const abs = pathMod.join(rootAbs, rel);
        const payload = {
            project: projectName,
            description:
                "Optional bulk snapshot of :devops:ops frames — tip lineage is authoritative",
            ops,
        };
        const text = `${JSON.stringify(payload, null, 2)}\n`;
        fs.mkdirSync(pathMod.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, text, "utf8");
        const routePrefix = await readFlowerpotRootFromDisk(rootAbs);
        await plantFileTip(
            projectName,
            rel,
            Buffer.from(text, "utf8"),
            "application/json; charset=utf-8",
            routePrefix
        );
        return rel;
    }

    async function importOpsBulk(projectName, entries, opts = {}) {
        const normalized = (Array.isArray(entries) ? entries : []).map((entry) => {
            const e = { ...entry };
            if (!e.id) e.id = `op-${Date.now()}`;
            if (!e.at) e.at = new Date().toISOString();
            return e;
        });
        if (!normalized.length) return 0;
        const existing = await loadOps(projectName);
        const existingKeys = new Set(existing.map((e) => opEntryKey(e)));
        const missing = normalized.filter((e) => !existingKeys.has(opEntryKey(e)));
        if (!missing.length) return 0;
        await saveOpBulkEvent(projectName, {
            action: "add",
            ops: missing,
            actor: opts.actor || "import",
            at: opts.at,
        });
        return missing.length;
    }

    async function appendOp(projectName, entry) {
        const normalized = { ...entry };
        if (!normalized.id) normalized.id = `op-${Date.now()}`;
        if (!normalized.at) normalized.at = new Date().toISOString();
        // One delta frame on :devops:ops — do not materialize a balloon ops.json.
        await saveOpBulkEvent(projectName, {
            action: "add",
            ops: [normalized],
            actor: normalized.actor || "fsdevopstracker",
            at: normalized.at,
        });
        return normalized;
    }

    /** Import devops/goals.json + devops/ops.json into :devops: tips. */
    async function importDevopsExports(projectName) {
        const goalsFileIb = `${projectName}:devops/goals.json`;
        const opsFileIb = `${projectName}:devops/ops.json`;
        let imported = 0;

        try {
            const goalsTip = await navi.storage.tip.get(goalsFileIb);
            if (goalsTip) {
                const media = await navi.storage.bin.mediaFromTip(goalsFileIb);
                const parsed = JSON.parse(String(media || "{}"));
                if (Array.isArray(parsed.goals) && parsed.goals.length) {
                    await saveGoalsDoc(
                        projectName,
                        parsed.goals,
                        Number(parsed.next_id) || parsed.goals.length + 1
                    );
                    imported++;
                }
            }
        } catch (err) {
            out(`devops goals import skip: ${err.message || err}`);
        }

        let opsImported = 0;
        try {
            const opsTip = await navi.storage.tip.get(opsFileIb);
            if (opsTip) {
                const media = await navi.storage.bin.mediaFromTip(opsFileIb);
                const parsed = JSON.parse(String(media || "{}"));
                if (Array.isArray(parsed.ops) && parsed.ops.length) {
                    opsImported = await importOpsBulk(projectName, parsed.ops, {
                        actor: "import",
                    });
                }
            }
        } catch (err) {
            out(`devops ops.json import skip: ${err.message || err}`);
        }

        if (opsImported) imported++;
        if (imported) {
            out(
                `devops import: ${imported} doc(s) → tip space (${opsImported} op(s))`
            );
        }
        return imported;
    }

    async function reimportOpsFromExport(projectName) {
        const ib = opsIb(projectName);
        try {
            await navi.storage.tip.del(ib);
        } catch {
            /* ignore */
        }
        const opsFileIb = `${projectName}:devops/ops.json`;
        let parsed = null;
        try {
            const opsTip = await navi.storage.tip.get(opsFileIb);
            if (opsTip) {
                const media = await navi.storage.bin.mediaFromTip(opsFileIb);
                parsed = JSON.parse(String(media || "{}"));
            }
        } catch (err) {
            out(`devops ops.json tip read skip: ${err.message || err}`);
        }
        if (!Array.isArray(parsed?.ops) || !parsed.ops.length) {
            const cfg = await loadConfig();
            const rootAbs = String(cfg.projects?.[projectName]?.root || "").trim();
            if (rootAbs) {
                const fs = nodeRequire("fs");
                const pathMod = nodeRequire("path");
                const abs = pathMod.join(rootAbs, "devops/ops.json");
                if (fs.existsSync(abs)) {
                    parsed = JSON.parse(fs.readFileSync(abs, "utf8"));
                }
            }
        }
        if (!Array.isArray(parsed?.ops) || !parsed.ops.length) {
            throw new Error("no ops[] in devops/ops.json");
        }
        return importOpsBulk(projectName, parsed.ops, {
            actor: "ops-reset",
            at: parsed.ops[0]?.at || new Date().toISOString(),
        });
    }

    async function cmdOpsReset(args, actor = "callin") {
        const { kv, positional } = parseKvArgs(args);
        const { name } = await requireProject(
            projectToken(kv, positional, 0),
            actor
        );
        const n = await reimportOpsFromExport(name);
        return `ops-reset: project=${name} imported ${n} op(s) as ops-batch`;
    }

    async function cmdOpsExport(args, actor = "callin") {
        const { kv, positional } = parseKvArgs(args);
        const { name } = await requireProject(
            projectToken(kv, positional, 0),
            actor
        );
        const rel = await syncOpsExportFile(name);
        if (!rel) throw new Error(`project "${name}" has no root — cannot write ops.json`);
        return `ops-export: ${name}:${rel} (optional snapshot; :devops:ops remains authoritative)`;
    }

    async function loadGoalsDoc(projectName) {
        const tip = await navi.storage.tip.get(goalsIb(projectName));
        const goals = tip?.data?.goals;
        return {
            tip,
            goals: Array.isArray(goals) ? goals.slice() : [],
            next_id: Number(tip?.data?.next_id) || 1,
        };
    }

    async function saveGoalsDoc(projectName, goals, nextId) {
        await navi.storage.tip.mut8(
            goalsIb(projectName),
            {
                parts: [
                    "fsdevopstracker_goals",
                    "ibgib_frame",
                    "manifest",
                    "json",
                ],
                project: projectName,
                artifact_type: "goals",
                goals,
                next_id: nextId,
            },
            { create: true }
        );
    }

    async function ensureGoalsSeeded(projectName) {
        const doc = await loadGoalsDoc(projectName);
        if (doc.goals.length) return doc;
        const seeded = DEFAULT_GOAL_SEEDS.map((g) => ({
            ...g,
            created_at: new Date().toISOString(),
        }));
        await saveGoalsDoc(projectName, seeded, 1);
        return { goals: seeded, next_id: 1 };
    }

    async function loadSprintDoc(projectName) {
        const tip = await navi.storage.tip.get(sprintIb(projectName));
        return {
            current: tip?.data?.current || null,
            history: Array.isArray(tip?.data?.history)
                ? tip.data.history.slice()
                : [],
        };
    }

    async function saveSprintDoc(projectName, current, history) {
        await navi.storage.tip.mut8(
            sprintIb(projectName),
            {
                parts: [
                    "fsdevopstracker_sprint",
                    "ibgib_frame",
                    "manifest",
                    "json",
                ],
                project: projectName,
                artifact_type: "sprint",
                current,
                history,
            },
            { create: true }
        );
    }

    async function scanProjectSignals(projectName) {
        const ibs = await listProjectIbs(projectName);
        const s = {
            hasSchema: false,
            hasRegistry: false,
            hasManager: false,
            hasInit: false,
            hasFlow: false,
            hasUi: false,
            hasLaunch: false,
            hasCatalog: false,
            hasDoc: false,
            hasConfig: false,
            uiCount: 0,
            moduleCount: 0,
            launchCount: 0,
            flowCount: 0,
            artifactCount: ibs.filter(
                (ib) => !String(ib).startsWith(`${projectName}:devops:`)
            ).length,
        };
        for (const ib of ibs) {
            if (String(ib).startsWith(`${projectName}:devops:`)) continue;
            const tip = await navi.storage.tip.get(ib);
            const t = tip?.data?.artifact_type;
            const role = tip?.data?.module_role;
            if (t === "schema") s.hasSchema = true;
            if (t === "flow") {
                s.hasFlow = true;
                s.flowCount++;
            }
            if (t === "ui") {
                s.hasUi = true;
                s.uiCount++;
            }
            if (t === "launch") {
                s.hasLaunch = true;
                s.launchCount++;
            }
            if (t === "catalog") s.hasCatalog = true;
            if (t === "doc" || t === "goals") s.hasDoc = true;
            if (t === "config") s.hasConfig = true;
            if (t === "module") {
                s.moduleCount++;
                if (role === "registry") s.hasRegistry = true;
                if (role === "manager") s.hasManager = true;
                if (role === "init") s.hasInit = true;
            }
        }
        return s;
    }

    async function refreshProgress(projectName) {
        const signals = await scanProjectSignals(projectName);
        const layers = LAYERS.map((L) => ({
            id: L.id,
            label: L.label,
            met: !!L.check(signals),
        }));
        const firstOpen = layers.find((l) => !l.met);
        const snap = {
            at: new Date().toISOString(),
            signals,
            layers,
            focus_layer: firstOpen?.id || "done",
        };
        await navi.storage.tip.mut8(
            progressIb(projectName),
            {
                parts: [
                    "fsdevopstracker_progress",
                    "ibgib_frame",
                    "manifest",
                    "json",
                ],
                project: projectName,
                artifact_type: "progress",
                ...snap,
            },
            { create: true }
        );
        const cfg = await loadConfig();
        if (cfg.projects[projectName]) {
            cfg.projects[projectName] = {
                ...cfg.projects[projectName],
                focus_layer: snap.focus_layer,
                active_sprint: (await loadSprintDoc(projectName)).current?.name || null,
            };
            await saveConfig(cfg);
        }
        return snap;
    }

    async function cmdGoals(args, actor = "callin") {
        const { kv, positional } = parseKvArgs(args);
        const { name } = await requireProject(
            projectToken(kv, positional, 0),
            actor
        );
        const doc = await ensureGoalsSeeded(name);
        if (!doc.goals.length) return `goals: (empty) project=${name}`;
        const lines = doc.goals.map((g) => {
            const st = g.status === "done" ? "done" : "open";
            const layer = g.layer ? ` [${g.layer}]` : "";
            return `  ${st.padEnd(4)} ${g.id}${layer} — ${g.text}`;
        });
        const open = doc.goals.filter((g) => g.status !== "done").length;
        return [
            `goals project=${name} open=${open}/${doc.goals.length}`,
            ...lines,
        ].join("\n");
    }

    async function cmdGoal(args, actor = "callin") {
        const sub = String(args[0] || "").toLowerCase();
        const rest = args.slice(1);
        const parsed = parseKvArgs(rest);
        const kv = mergeCallinKv({ ...parsed.kv });
        const { positional } = parsed;
        const { name } = await requireProject(kv.project, actor);
        if (sub === "add") {
            const text = String(kv.text || positional.join(" ") || "").trim();
            if (!text) throw new Error("usage: goal add text=<why> [layer=L2]");
            const doc = await ensureGoalsSeeded(name);
            const maxId = doc.goals.reduce((max, goal) => {
                const match = String(goal.id || "").match(/^g(\d+)$/);
                return match ? Math.max(max, Number(match[1])) : max;
            }, 0);
            const nextId = Math.max(doc.next_id, maxId + 1);
            const id = `g${nextId}`;
            const goal = {
                id,
                text,
                layer: kv.layer || null,
                status: "open",
                created_at: new Date().toISOString(),
            };
            doc.goals.push(goal);
            await saveGoalsDoc(name, doc.goals, nextId + 1);
            await appendOp(name, {
                op: "goal-add",
                target_ib: goalsIb(name),
                goal: text,
                actor: "repl:human",
                at: new Date().toISOString(),
                goal_id: id,
            });
            return `added ${id}`;
        }
        if (sub === "done" || sub === "open") {
            const id = String(kv.id || positional[0] || "").trim();
            if (!id) throw new Error(`usage: goal ${sub} <id>`);
            const doc = await ensureGoalsSeeded(name);
            const g = doc.goals
                .slice()
                .reverse()
                .find((x) => x.id === id);
            if (!g) throw new Error(`unknown goal: ${id}`);
            g.status = sub === "done" ? "done" : "open";
            g.updated_at = new Date().toISOString();
            await saveGoalsDoc(name, doc.goals, doc.next_id);
            await appendOp(name, {
                op: `goal-${sub}`,
                target_ib: goalsIb(name),
                goal: g.text,
                actor: "repl:human",
                at: new Date().toISOString(),
                goal_id: id,
            });
            return `${id} → ${g.status}`;
        }
        throw new Error("usage: goal add|done|open …");
    }

    async function cmdSprint(args, actor = "callin") {
        const sub = String(args[0] || "").toLowerCase();
        const rest = args.slice(1);
        const { kv, positional } = parseKvArgs(rest);

        if (!sub || sub === "show" || sub === "status") {
            const { name } = await requireProject(
                projectToken(kv, [args[0]].filter(Boolean), 0) || kv.project,
                actor
            );
            const doc = await loadSprintDoc(name);
            if (!doc.current && !doc.history.length) {
                return `sprint: (none) project=${name} — sprint start name=<n>`;
            }
            const lines = [];
            if (doc.current) {
                lines.push(
                    `current: ${doc.current.name} layer=${doc.current.layer || "?"} focus=${doc.current.focus || ""} started=${doc.current.started_at || "?"}`
                );
            } else lines.push("current: (none)");
            const hist = doc.history.slice(-5);
            if (hist.length) {
                lines.push("recent:");
                for (const h of hist) {
                    lines.push(
                        `  ${h.name} layer=${h.layer || "?"} closed=${h.closed_at || "?"} note=${h.note || ""}`
                    );
                }
            }
            return [`sprint project=${name}`, ...lines].join("\n");
        }

        if (sub === "start") {
            const { name } = await requireProject(kv.project, actor);
            const sprintName = String(
                kv.name || positional[0] || ""
            ).trim();
            if (!sprintName)
                throw new Error(
                    "usage: sprint start project=<p> name=<n> [layer=L3] [focus=<text>]"
                );
            const doc = await loadSprintDoc(name);
            if (doc.current) {
                throw new Error(
                    `sprint already open: ${doc.current.name} — sprint close first`
                );
            }
            const current = {
                name: sprintName,
                layer: kv.layer || null,
                focus: kv.focus || positional.slice(1).join(" ") || "",
                started_at: new Date().toISOString(),
            };
            await saveSprintDoc(name, current, doc.history);
            const cfg = await loadConfig();
            if (cfg.projects[name]) {
                cfg.projects[name].active_sprint = sprintName;
                await saveConfig(cfg);
            }
            await appendOp(name, {
                op: "sprint-start",
                target_ib: sprintIb(name),
                goal: kv.focus || `start sprint ${sprintName}`,
                actor: "repl:human",
                at: new Date().toISOString(),
                sprint: sprintName,
            });
            return `sprint started: ${sprintName}`;
        }

        if (sub === "close") {
            const { name } = await requireProject(kv.project, actor);
            const doc = await loadSprintDoc(name);
            if (!doc.current) throw new Error("no open sprint");
            const closed = {
                ...doc.current,
                closed_at: new Date().toISOString(),
                note: kv.note || positional.join(" ") || "",
            };
            doc.history.push(closed);
            await saveSprintDoc(name, null, doc.history);
            const cfg = await loadConfig();
            if (cfg.projects[name]) {
                cfg.projects[name].active_sprint = null;
                await saveConfig(cfg);
            }
            // mark layer goals done if sprint.layer matches
            if (closed.layer) {
                const gdoc = await ensureGoalsSeeded(name);
                let changed = false;
                for (const g of gdoc.goals) {
                    if (g.layer === closed.layer && g.status !== "done") {
                        g.status = "done";
                        g.updated_at = closed.closed_at;
                        changed = true;
                    }
                }
                if (changed) await saveGoalsDoc(name, gdoc.goals, gdoc.next_id);
            }
            await refreshProgress(name);
            await appendOp(name, {
                op: "sprint-close",
                target_ib: sprintIb(name),
                goal: closed.note || `close sprint ${closed.name}`,
                actor: "repl:human",
                at: closed.closed_at,
                sprint: closed.name,
            });
            return `sprint closed: ${closed.name}`;
        }

        throw new Error("usage: sprint | sprint start|close …");
    }

    async function cmdPending(args, actor = "callin") {
        const { kv, positional } = parseKvArgs(args);
        const { name } = await requireProject(
            projectToken(kv, positional, 0),
            actor
        );
        await ensureGoalsSeeded(name);
        const progress = await refreshProgress(name);
        const gdoc = await loadGoalsDoc(name);
        const sprint = await loadSprintDoc(name);
        const openGoals = gdoc.goals.filter((g) => g.status !== "done");
        const lines = [
            `pending project=${name}`,
            `focus_layer: ${progress.focus_layer}`,
            sprint.current
                ? `sprint: ${sprint.current.name} (${sprint.current.layer || "no-layer"}) ${sprint.current.focus || ""}`
                : "sprint: (none)",
            "layers:",
        ];
        for (const L of progress.layers) {
            lines.push(`  ${L.met ? "[x]" : "[ ]"} ${L.id} ${L.label}`);
        }
        lines.push(`open goals (${openGoals.length}):`);
        if (!openGoals.length) lines.push("  (none)");
        else {
            for (const g of openGoals.slice(0, 30)) {
                const layer = g.layer ? ` [${g.layer}]` : "";
                lines.push(`  ${g.id}${layer} — ${g.text}`);
            }
        }
        return lines.join("\n");
    }

    function resolveArtifactIb(projectName, token) {
        const t = String(token || "").trim();
        if (!t) throw new Error("path/ib required");
        if (t.includes(":")) return t;
        return `${projectName}:${t.replace(/^\/+/, "").replace(/\\/g, "/")}`;
    }

    /**
     * Path-arg body escapes only (`body=hello\nworld` in the URL).
     * Never apply to JSON POST bodies — JSON.parse already decoded escapes, and
     * source files contain literal `\n` / `\t` / `\r` (e.g. `.join("\n")`) that
     * must stay two characters.
     */
    function unescapeBody(s) {
        return String(s ?? "")
            .replace(/\\n/g, "\n")
            .replace(/\\t/g, "\t")
            .replace(/\\r/g, "\r");
    }

    function parseKvArgs(args) {
        /** @type {Record<string, string>} */
        const kv = {};
        const positional = [];
        for (const a of args) {
            const m = String(a).match(/^([a-zA-Z_]+)=(.*)$/);
            if (m) kv[m[1].toLowerCase()] = m[2];
            else positional.push(String(a));
        }
        return { kv, positional };
    }

    /**
     * Fill missing kv fields from the in-flight callin multiplex
     * (`navi.callinRequest`). Path args win; JSON body / raw body fill gaps.
     * Prefer POST body for spaces and large text instead of stuffing the URL.
     */
    function mergeCallinKv(kv) {
        const req =
            (navi && navi.callinRequest) ||
            (navi &&
                typeof navi.getCallinRequest === "function" &&
                navi.getCallinRequest()) ||
            null;
        if (!req || req.body == null || String(req.body) === "") return kv;
        const raw = String(req.body);
        try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                for (const [k, v] of Object.entries(parsed)) {
                    const key = String(k).toLowerCase();
                    if (!Object.prototype.hasOwnProperty.call(kv, key)) {
                        kv[key] = v == null ? "" : String(v);
                        if (key === "body") kv._bodyFromJson = true;
                    }
                }
                return kv;
            }
        } catch {
            /* not JSON — treat as body text */
        }
        if (!Object.prototype.hasOwnProperty.call(kv, "body")) {
            kv.body = raw;
            kv._bodyFromJson = true;
        }
        return kv;
    }

    async function writeArtifactMedia(projectName, ib, media, mime, encoding) {
        const tip = await navi.storage.tip.get(ib);
        if (!tip) throw new Error(`no tip ${ib}`);
        const priorGib = tip.gib || "";
        const sha = await navi.storage.bin.putMedia({
            media,
            mime: mime || tip.data?.content_type || "text/plain; charset=utf-8",
        });
        const next = await navi.storage.tip.mut8(
            ib,
            {
                encoding: encoding || tip.data?.encoding || "utf8",
                content_type:
                    mime || tip.data?.content_type || "text/plain; charset=utf-8",
            },
            {
                rel8ns: {
                    bin: [`bin ${sha}`],
                },
            }
        );
        const cfg = await loadConfig();
        const fp = hostparkCfg(cfg.projects[projectName]);
        if (fp.route_prefix) {
            await mirrorParkTip(
                projectName,
                fp.route_prefix,
                ib,
                tip.data?.path || ib.slice(projectName.length + 1),
                sha,
                mime || tip.data?.content_type,
                encoding || tip.data?.encoding || "utf8"
            );
        }
        return {
            before_gib: priorGib,
            after_gib: next.gib || "",
            path: tip.data?.path || ib.slice(projectName.length + 1),
        };
    }

    async function cmdCrud(op, args, actor = "repl:human") {
        const parsed = parseKvArgs(args);
        const kv = mergeCallinKv({ ...parsed.kv });
        const positional = parsed.positional;
        const { name } = await requireProject(kv.project, actor);
        const pathTok = kv.path || positional[0];
        if (!pathTok) {
            throw new Error(
                `usage: ${op} project=<name> <path> goal=<why> body=<text>` +
                    `   or POST JSON { project, path, goal, body }`
            );
        }
        const goal = String(kv.goal || "").trim();
        const hasBody = Object.prototype.hasOwnProperty.call(kv, "body");
        if (!goal || !hasBody) {
            // start interactive wizard when called from REPL without body
            if (actor === "repl:human" && !hasBody) {
                const proj = kv.project || replSessionProject;
                if (!proj) throw new Error(PROJECT_REQUIRED);
                draft = {
                    op,
                    path: pathTok,
                    project: proj,
                    bodyLines: [],
                };
                mode = "crud_goal";
                return `goal for ${op} ${pathTok}?`;
            }
            throw new Error(`${op} requires project=<name> goal=<why> and body=<text>`);
        }
        const ib = resolveArtifactIb(name, pathTok);
        const tip = await navi.storage.tip.get(ib);
        if (!tip) throw new Error(`no tip ${ib} — index/reinit first`);
        const enc = tip.data?.encoding || "utf8";
        if (enc === "base64" && op === "append") {
            throw new Error("append not supported on base64 (binary) tips");
        }
        let media;
        // JSON POST body is already exact file bytes; only unescape URL path args.
        const body = kv._bodyFromJson
            ? String(kv.body ?? "")
            : unescapeBody(kv.body);
        if (op === "append") {
            let cur = "";
            try {
                cur = (await navi.storage.bin.mediaFromTip(ib)) || "";
            } catch {
                cur = "";
            }
            media = cur + body;
        } else {
            // put / mut8 — replace
            media = body;
        }
        const written = await writeArtifactMedia(
            name,
            ib,
            media,
            tip.data?.content_type,
            "utf8"
        );
        const entry = {
            op,
            target_ib: ib,
            path: written.path,
            goal,
            actor,
            at: new Date().toISOString(),
            before_gib: written.before_gib,
            after_gib: written.after_gib,
            bytes: media.length,
        };
        await appendOp(name, entry);
        return `${op} ok ${ib} (${media.length} chars) goal=${goal}`;
    }

    async function finishInteractiveCrud(actor = "repl:human") {
        const op = draft?.op;
        const pathTok = draft?.path;
        const goal = String(draft?.goal || "").trim();
        const body = (draft?.bodyLines || []).join("\n");
        mode = "idle";
        draft = null;
        if (!op || !pathTok || !goal) throw new Error("crud cancelled — incomplete");
        return cmdCrud(
            op,
            [
                `project=${draft.project || replSessionProject || ""}`,
                `path=${pathTok}`,
                `goal=${goal}`,
                `body=${body}`,
            ],
            actor
        );
    }

    async function cmdOps(args, actor = "callin") {
        const { kv, positional } = parseKvArgs(args);
        const nTok = positional.find((a) => /^\d+$/.test(String(a)));
        const projPos = positional.find((a) => !/^\d+$/.test(String(a)));
        const { name } = await requireProject(
            projectToken(kv, projPos ? [projPos] : [], 0),
            actor
        );
        const n = Math.min(200, Math.max(1, Number(nTok || 20)));
        const ops = await loadOps(name);
        if (!ops.length) return `ops: (empty) project=${name}`;
        const slice = ops.slice(-n);
        const lines = slice.map((e, i) => {
            const idx = ops.length - slice.length + i;
            return `  #${idx} ${e.at || "?"} ${e.op} ${e.path || e.target_ib} — ${e.goal || ""}`;
        });
        return [`ops project=${name} showing ${slice.length}/${ops.length}`, ...lines].join(
            "\n"
        );
    }

    async function cmdRoute(args, actor = "callin") {
        const { kv, positional } = parseKvArgs(args);
        mergeCallinKv(kv);
        const { name, project } = await requireProject(kv.project, actor);
        const sub = String(positional[0] || "").toLowerCase();
        if (sub === "set" || kv.prefix) {
            const prefix = stripFlowerpotPrefix(
                kv.prefix || positional.slice(1).join(" ")
            );
            if (!prefix) {
                throw new Error(
                    "usage: route project=<name> set prefix=<logical/route>"
                );
            }
            await patchHostparkConfig(name, { route_prefix: prefix });
            const n = await rebuildMirrors(name);
            return `route_prefix=${prefix} (rebuilt ${n} mirror(s))`;
        }
        const fp = hostparkCfg(project);
        if (!fp.route_prefix) return `route: (unset) project=${name}`;
        return [
            `route project=${name}`,
            `  prefix: ${fp.route_prefix}`,
            `  relay GET:  …/navi-jumbo/${fp.route_prefix}/<rel>`,
            `  local park: navi/${fp.route_prefix}/<rel>`,
            `  hostpark:   ${fp.host}/${fp.route_prefix}/<rel>`,
        ].join("\n");
    }

    async function cmdPush(args, actor = "callin") {
        const { kv } = parseKvArgs(args);
        mergeCallinKv(kv);
        const { name, project } = await requireProject(kv.project, actor);
        const patchKeys = [
            "host",
            "policy",
            "policy_addr",
            "key",
            "key_name",
            "stash",
            "token_stash_path",
        ];
        const wantsPatch =
            patchKeys.some((k) => kv[k] != null && String(kv[k]).length) ||
            ["origin", "default", ""].includes(
                String(kv.host ?? "__unset__").trim().toLowerCase()
            );
        if (wantsPatch) {
            const patch = {};
            if (kv.host != null) {
                const h = String(kv.host).trim().toLowerCase();
                patch.host =
                    !h || h === "origin" || h === "default" ? "" : kv.host;
            }
            if (kv.policy || kv.policy_addr) {
                patch.policy_addr = normalizePolicyIb(
                    kv.policy || kv.policy_addr
                );
            }
            if (kv.key || kv.key_name) patch.key_name = kv.key || kv.key_name;
            if (kv.stash || kv.token_stash_path) {
                patch.token_stash_path = stripRoutePrefix(
                    kv.stash || kv.token_stash_path
                );
            }
            await patchHostparkConfig(name, patch);
            return "push config updated";
        }
        const hp = hostparkCfg(project);
        return [
            `push project=${name}`,
            `  host: ${hp.host}`,
            `  route_prefix: ${hp.route_prefix || "(unset)"}`,
            `  policy_addr: ${hp.policy_addr || "(unset)"}`,
            `  key_name: ${hp.key_name}`,
            `  token_stash_path: ${hp.token_stash_path || "(unset)"}`,
            `  spare_tokens: ${hp.spare_tokens.length}`,
        ].join("\n");
    }

    async function cmdToken(args, actor = "callin") {
        const parsed = parseKvArgs(args);
        const kv = mergeCallinKv({ ...parsed.kv });
        const { positional } = parsed;
        const { name, project } = await requireProject(kv.project, actor);
        const sub = String(positional[0] || "status").toLowerCase();
        if (sub === "status") {
            const tokens = await getSpareTokens(name);
            const fp = hostparkCfg(project);
            return [
                `tokens project=${name} spare=${tokens.length}`,
                `  stash: ${fp.token_stash_path || "(unset)"}`,
            ].join("\n");
        }
        if (sub === "stash") {
            const path = stripFlowerpotPrefix(
                kv.path || positional.slice(1).join(" ")
            );
            if (!path) {
                throw new Error("usage: token stash path=<logical/route>");
            }
            await patchHostparkConfig(name, { token_stash_path: path });
            return `token stash path=${path}`;
        }
        if (sub === "feed") {
            const path = kv.path || positional.slice(1).join(" ").trim() || "";
            const row = await feedTokenStash(name, path || null);
            await appendOp(name, {
                op: "token-feed",
                goal: `feed ${row.added} token(s) from ${row.path}`,
                actor,
                at: new Date().toISOString(),
                path: row.path,
                added: row.added,
            });
            return `fed ${row.added} token(s) from ${row.path} (spare=${row.spare})`;
        }
        if (sub === "reset") {
            tokenBagCache.set(name, []);
            await persistSpareTokens(name);
            return `token reset (spare=0)`;
        }
        if (sub === "load") {
            const file = kv.file || positional.slice(1).join(" ").trim();
            const row = await loadTokenFile(name, file);
            await appendOp(name, {
                op: "token-load",
                goal: `load ${row.added} token(s) from ${row.file}`,
                actor,
                at: new Date().toISOString(),
                path: row.file,
                added: row.added,
            });
            return `loaded ${row.added} token(s) from ${row.file} (spare=${row.spare})`;
        }
        if (sub === "add") {
            const t = positional.slice(1).join(" ").trim() || kv.token;
            if (!t) throw new Error("usage: token add <token>");
            const tokens = await getSpareTokens(name);
            tokens.push(String(t).trim());
            await persistSpareTokens(name);
            return `token added (spare=${tokens.length})`;
        }
        throw new Error(
            "usage: token status|stash path=…|feed [path]|load <file>|reset|add <t>"
        );
    }

    async function cmdKeychain() {
        await ensureKeychainMounted();
        const keys = await navi.mod.keychain.list();
        return `keychain mounted (${KEYCHAIN_MOUNT}) keys: ${keys.join(", ") || "(none)"}`;
    }

    async function cmdHostparkPush(args, actor = "callin") {
        const parsed = parseKvArgs(args);
        const kv = mergeCallinKv({ ...parsed.kv });
        const positional = parsed.positional;
        const { name, project } = await requireProject(kv.project, actor);
        const hp = hostparkCfg(project);
        if (!hp.route_prefix) {
            throw new Error(
                "no route_prefix — route set prefix=… or index with config.json flowerpot.root"
            );
        }
        const goal = String(kv.goal || "").trim();
        if (!goal) throw new Error("hostpark-push requires goal=<why>");
        const pathTok = String(kv.path || "")
            .trim()
            .toLowerCase();
        const pushAll =
            pathTok === "all" ||
            pathTok === "*" ||
            String(positional[0] || "").toLowerCase() === "all" ||
            String(positional[0] || "").toLowerCase() === "*";
        let rels = [];
        if (pushAll) {
            // Single project only — listProjectIbs(name); never crosses projects.
            const ibs = await listProjectIbs(name);
            for (const ib of ibs) {
                if (String(ib).includes(":devops:")) continue;
                const tip = await navi.storage.tip.get(ib);
                if (tip?.data?.path) rels.push(String(tip.data.path));
            }
            if (!rels.length) {
                throw new Error(
                    `hostpark-push all: no tips in project=${name} (other projects untouched)`
                );
            }
        } else {
            // Prefer kv.path; else join positionals (callin may split ui/punch.html → ui, punch.html)
            let pathArg = String(kv.path || "").trim();
            if (!pathArg) {
                pathArg = positional.join("/").trim();
            }
            if (!pathArg) {
                throw new Error(
                    "usage: hostpark-push project=<name> <rel>|all goal=<why>"
                );
            }
            rels = pathArg.split(/\s+/).filter(Boolean);
        }
        const results = [];
        const opBatch = [];
        const at = new Date().toISOString();
        for (const rel of rels) {
            const clean = rel.replace(/^\/+/, "");
            const ib = `${name}:${clean}`;
            const tip = await navi.storage.tip.get(ib);
            if (!tip) throw new Error(`no tip ${ib}`);
            const media = await navi.storage.bin.mediaFromTip(ib);
            const enc = tip.data?.encoding || "utf8";
            const buf =
                enc === "base64"
                    ? Buffer.from(media, "base64")
                    : Buffer.from(media, "utf8");
            const route = logicalRoute(hp.route_prefix, clean);
            const addr = await hostparkPut(
                name,
                route,
                buf,
                tip.data?.content_type || mimeFor(clean),
                hp.key_name
            );
            const entry = {
                id: `op-${Date.now()}-${opBatch.length}`,
                op: "hostpark-push",
                path: clean,
                route,
                goal,
                actor,
                at,
                hostpark_addr: addr,
            };
            opBatch.push(entry);
            results.push(`${clean} → ${addr}`);
        }
        // One ops-batch delta frame for the whole push (not N×, and no ops.json balloon)
        await saveOpBulkEvent(name, {
            action: "add",
            ops: opBatch,
            actor,
            at,
        });
        await persistSpareTokens(name);
        return `hostpark-push ok (${results.length}):\n  ${results.join("\n  ")}`;
    }

    async function cmdMirror(args, actor = "callin") {
        const { kv, positional } = parseKvArgs(args);
        const { name } = await requireProject(
            projectToken(kv, positional, 0),
            actor
        );
        const n = await rebuildMirrors(name);
        return `mirror rebuilt ${n} park tip(s) for ${name}`;
    }

    async function cmdDiskPush(args, actor = "callin") {
        const { kv, positional } = parseKvArgs(args);
        const { name, project } = await requireProject(
            projectToken(kv, positional, 0),
            actor
        );
        const rootAbs = String(project.root || "").trim();
        if (!rootAbs) throw new Error(`project "${name}" has no root`);
        const fs = nodeRequire("fs");
        const pathMod = nodeRequire("path");
        const pathFilter = kv.path || null;
        const ibs = await listProjectIbs(name);
        let ok = 0;
        let skip = 0;
        for (const ib of ibs) {
            if (String(ib).startsWith(`${name}:devops:`)) {
                skip++;
                continue;
            }
            const tip = await navi.storage.tip.get(ib);
            const rel = String(tip?.data?.path || "").replace(/\\/g, "/");
            if (!rel || rel.includes("..")) {
                skip++;
                continue;
            }
            if (pathFilter && !rel.includes(pathFilter)) continue;
            let media;
            try {
                media = await navi.storage.bin.mediaFromTip(ib);
            } catch {
                skip++;
                continue;
            }
            if (typeof media !== "string") {
                skip++;
                continue;
            }
            const abs = pathMod.resolve(rootAbs, ...rel.split("/"));
            const rootResolved = pathMod.resolve(rootAbs);
            if (
                abs !== rootResolved &&
                !abs.startsWith(rootResolved + pathMod.sep)
            ) {
                out(`skip path escape: ${rel}`);
                skip++;
                continue;
            }
            fs.mkdirSync(pathMod.dirname(abs), { recursive: true });
            const enc = tip.data?.encoding || "utf8";
            const buf =
                enc === "base64"
                    ? Buffer.from(media, "base64")
                    : Buffer.from(media, "utf8");
            fs.writeFileSync(abs, buf);
            ok++;
        }
        await appendOp(name, {
            op: "disk-push",
            target_ib: `${name}:*`,
            path: pathFilter || "*",
            goal: kv.goal || "disk-push overwrite project root from tip bins",
            actor: "repl:human",
            at: new Date().toISOString(),
            written: ok,
            skipped: skip,
        });
        return `disk-push ${name}: wrote ${ok}, skipped ${skip} → ${rootAbs}`;
    }

    async function destroyProject(name) {
        const cfg = await loadConfig();
        delete cfg.projects[name];
        if (cfg.active_project === name) cfg.active_project = null;
        await saveConfig(cfg);
        const n = await wipeProjectTips(name);
        out(`destroyed project "${name}" (${n} tip(s) removed)`);
    }

    async function cmdInitProject(args) {
        const kv = mergeCallinKv({});
        const name = String(args[0] || kv.name || "").trim();
        const rootRaw = String(args[1] || kv.root || kv.path || "").trim();
        const indexAns = String(args[2] || kv.index || kv.y || "y")
            .trim()
            .toLowerCase();
        if (!name || !rootRaw) {
            return "usage: init <name> <path> [y|n]";
        }
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name)) {
            throw new Error("name: letters/digits/_/- only, start alnum");
        }
        const cfg = await loadConfig();
        if (cfg.projects[name]) {
            throw new Error(`project "${name}" already exists — use reinit`);
        }
        const fs = nodeRequire("fs");
        const pathMod = nodeRequire("path");
        const rootAbs = pathMod.resolve(rootRaw);
        let st;
        try {
            st = fs.statSync(rootAbs);
        } catch {
            throw new Error(`path does not exist: ${rootAbs}`);
        }
        if (!st.isDirectory()) {
            throw new Error(`not a directory: ${rootAbs}`);
        }
        cfg.projects[name] = {
            root: rootAbs,
            created_at: new Date().toISOString(),
            indexed_at: null,
            status: "pending_index",
            active_sprint: null,
        };
        cfg.active_project = name;
        await saveConfig(cfg);
        if (indexAns === "n" || indexAns === "no") {
            return `init registered: ${name} (not indexed)`;
        }
        await indexProject(name, rootAbs);
        return `init done: ${name}`;
    }

    async function cmdReinit(args, actor = "callin") {
        const { kv, positional } = parseKvArgs(args);
        const { name, project } = await requireProject(
            projectToken(kv, positional, 0),
            actor
        );
        const rootAbs = String(project.root || "").trim();
        if (!rootAbs) {
            throw new Error(`project "${name}" has no root path — run init`);
        }
        const fs = nodeRequire("fs");
        let st;
        try {
            st = fs.statSync(rootAbs);
        } catch {
            throw new Error(`root missing: ${rootAbs}`);
        }
        if (!st.isDirectory()) {
            throw new Error(`root not a directory: ${rootAbs}`);
        }
        const fp = hostparkCfg(project);
        const wiped = await wipeProjectTips(name, { keepDevops: true });
        const mirrors = fp.route_prefix
            ? await wipeMirrorTips(fp.route_prefix)
            : 0;
        out(
            `reinit "${name}" — cleared ${wiped} tip(s)${mirrors ? `, ${mirrors} mirror(s)` : ""}; re-indexing ${rootAbs}`
        );
        const cfg = await loadConfig();
        cfg.projects[name] = {
            ...(cfg.projects[name] || {}),
            root: rootAbs,
            status: "pending_index",
            indexed_at: null,
        };
        cfg.active_project = name;
        await saveConfig(cfg);
        await indexProject(name, rootAbs);
        return `reinit done: ${name}`;
    }

    async function indexProject(name, rootAbs) {
        const fs = nodeRequire("fs");
        const pathMod = nodeRequire("path");
        const routePrefix = await readFlowerpotRootFromDisk(rootAbs);
        const files = walkFiles(fs, pathMod, rootAbs);
        out(`indexing ${files.length} file(s) under ${rootAbs}…`);
        let ok = 0;
        let skip = 0;
        const byType = {};
        for (const fileAbs of files) {
            const rel = toRelPosix(pathMod, rootAbs, fileAbs);
            if (!rel || rel.includes("..")) {
                skip++;
                continue;
            }
            let st;
            try {
                st = fs.statSync(fileAbs);
            } catch {
                skip++;
                continue;
            }
            if (st.size > MAX_FILE_BYTES) {
                out(`skip large file (${st.size} B): ${rel}`);
                skip++;
                continue;
            }
            let buf;
            try {
                buf = fs.readFileSync(fileAbs);
            } catch (err) {
                out(`skip read fail: ${rel} (${err.message || err})`);
                skip++;
                continue;
            }
            const mime = mimeFor(rel);
            const planted = await plantFileTip(name, rel, buf, mime, routePrefix);
            ok++;
            byType[planted.artifact_type] =
                (byType[planted.artifact_type] || 0) + 1;
            if (ok % 25 === 0) out(`… ${ok}/${files.length}`);
        }
        const cfg = await loadConfig();
        cfg.projects[name] = {
            ...(cfg.projects[name] || {}),
            root: rootAbs,
            indexed_at: new Date().toISOString(),
            status: "active",
            file_count: ok,
            skipped: skip,
            route_prefix: routePrefix || cfg.projects[name]?.route_prefix || "",
            hostpark: {
                ...hostparkCfg(cfg.projects[name] || {}),
                ...(routePrefix ? { route_prefix: routePrefix } : {}),
            },
        };
        cfg.active_project = name;
        await saveConfig(cfg);
        const typeLine = Object.entries(byType)
            .map(([k, v]) => `${k}:${v}`)
            .join(" ");
        out(`index done: ${ok} planted, ${skip} skipped. ${typeLine}`);
        await linkProject(name);
        await importDevopsExports(name);
        return { ok, skip };
    }

    function parseQueryArgs(args) {
        /** @type {{ type?: string, path?: string, project?: string }} */
        const q = {};
        for (const a of args) {
            const m = String(a).match(/^([a-zA-Z_]+)=(.+)$/);
            if (m) {
                const k = m[1].toLowerCase();
                const v = m[2];
                if (k === "type") q.type = v.toLowerCase();
                else if (k === "path") q.path = v;
                else if (k === "project") q.project = v;
            } else if (!q.type && ARTIFACT_TYPES.has(String(a).toLowerCase())) {
                q.type = String(a).toLowerCase();
            }
        }
        return q;
    }

    async function cmdList(args, actor = "callin") {
        const { kv, positional } = parseKvArgs(args);
        mergeCallinKv(kv);
        const merged = [
            ...positional,
            ...Object.entries(kv).map(([k, v]) => `${k}=${v}`),
        ];
        const q = parseQueryArgs(merged);
        const { name } = await requireProject(q.project || kv.project, actor);
        const ibs = await listProjectIbs(name);
        const rows = [];
        for (const ib of ibs) {
            const tip = await navi.storage.tip.get(ib);
            const type = tip?.data?.artifact_type || "?";
            const path = tip?.data?.path || ib.slice(name.length + 1);
            const nLinks = Array.isArray(tip?.data?.links)
                ? tip.data.links.length
                : 0;
            if (q.type && type !== q.type) continue;
            if (q.path && !String(path).includes(q.path)) continue;
            rows.push({
                ib,
                type,
                path,
                links: nLinks,
                role: tip?.data?.module_role || "",
            });
        }
        if (!rows.length) return `(none) project=${name}`;
        const lines = rows.map((r) => {
            const role = r.role ? ` role=${r.role}` : "";
            const lk = r.links ? ` links=${r.links}` : "";
            return `  ${r.type.padEnd(8)} ${r.path}${role}${lk}`;
        });
        return [`project=${name} count=${rows.length}`, ...lines].join("\n");
    }

    async function cmdGet(args, actor = "callin") {
        const { kv, positional } = parseKvArgs(args);
        mergeCallinKv(kv);
        const token = String(kv.ib || positional.join(" ") || "").trim();
        if (!token) return "usage: get project=<name> <rel>   or get <project:rel>";
        let ib = token;
        if (!token.includes(":")) {
            const { name } = await requireProject(kv.project, actor);
            ib = `${name}:${token.replace(/^\/+/, "")}`;
        }
        const tip = await navi.storage.tip.get(ib);
        if (!tip) return `no tip ${ib}`;
        let preview = "";
        try {
            const media = await navi.storage.bin.mediaFromTip(ib);
            if (typeof media === "string") {
                preview =
                    media.length > 400
                        ? media.slice(0, 400) + "…"
                        : media;
            }
        } catch {
            preview = "(no bin media)";
        }
        const links = Array.isArray(tip.data?.links) ? tip.data.links : [];
        const linkLines = links.length
            ? links.map(
                  (l) => `  → ${l.kind} ${l.target_ib} (${l.via || ""})`
              )
            : ["  (no links)"];
        return [
            `ib: ${tip.ib}^${tip.gib || ""}`,
            `type: ${tip.data?.artifact_type || "?"}`,
            `path: ${tip.data?.path || "?"}`,
            `content_type: ${tip.data?.content_type || "?"}`,
            tip.data?.module_role ? `module_role: ${tip.data.module_role}` : null,
            "links:",
            ...linkLines,
            "--- preview ---",
            preview,
        ]
            .filter((x) => x != null)
            .join("\n");
    }

    async function cmdUse(args) {
        const name = String(args[0] || "").trim();
        if (!name) return "usage: use <project>  (REPL session default only)";
        const cfg = await loadConfig();
        if (!cfg.projects[name]) return `unknown project: ${name}`;
        const project = cfg.projects[name];
        const root = String(project.root || "").trim();
        if (root && !hostparkCfg(project).route_prefix) {
            const rp = await readFlowerpotRootFromDisk(root);
            if (rp) {
                cfg.projects[name] = {
                    ...project,
                    route_prefix: rp,
                    hostpark: { ...hostparkCfg(project), route_prefix: rp },
                    push: { ...hostparkCfg(project), route_prefix: rp },
                };
                await saveConfig(cfg);
            }
        }
        // In-memory only — does not stomp shared active_project (concurrent-safe).
        replSessionProject = name;
        return `session project=${name} (callin must still pass project=)`;
    }

    function requireCursorSdk() {
        const mod = navi.mod?.cursor_sdk;
        if (!mod || typeof mod.run !== "function") {
            throw new Error(
                "cursor_sdk not mounted — mount flowerpot/torus/native/cursor_sdk"
            );
        }
        return mod;
    }

    /**
     * Optional facade: fsdevops cursor … → navi.mod.cursor_sdk
     * Sets cwd from project root on open; logs a short ops line for say.
     */
    async function cmdCursor(args, actor = "callin") {
        const { kv, positional } = parseKvArgs(args);
        mergeCallinKv(kv);
        const subs = new Set(["status", "open", "say", "here", "close"]);
        let pos = [...positional];
        let projectName = String(kv.project || "").trim();
        if (
            !projectName &&
            pos[0] &&
            !subs.has(String(pos[0]).toLowerCase())
        ) {
            projectName = pos.shift();
        }
        const { name, project } = await requireProject(projectName, actor);
        const mod = requireCursorSdk();
        const sub = String(pos[0] || "status").toLowerCase();
        const rest = pos.slice(1);
        const root = String(project.root || "").trim();
        const goal = String(kv.goal || "").trim();

        if (sub === "status") {
            if (typeof mod.status === "function") {
                return JSON.stringify(
                    { project: name, root, ...(await mod.status()) },
                    null,
                    2
                );
            }
            return await mod.run("status");
        }
        if (sub === "here") {
            if (typeof mod.here === "function") {
                return JSON.stringify(
                    { project: name, ...(await mod.here()) },
                    null,
                    2
                );
            }
            return await mod.run("here");
        }
        if (sub === "close") {
            return await mod.run("close");
        }
        if (sub === "open") {
            if (root) await mod.run("cwd", root);
            const label = rest.join(" ") || name;
            const out = await mod.run("open", label);
            await appendOp(name, {
                op: "cursor-open",
                path: root || "(no root)",
                goal: goal || `cursor open ${label}`,
                actor: `fsdevops:${actor}`,
                note: String(out).slice(0, 240),
            });
            return out;
        }
        if (sub === "say") {
            const prompt = rest.join(" ").trim();
            if (!prompt) {
                return "usage: cursor project=<name> say <prompt…> [goal=<why>]";
            }
            if (root) {
                try {
                    await mod.run("cwd", root);
                } catch {
                    /* ignore if agent already open with different cwd */
                }
            }
            const out = await mod.run("say", prompt);
            await appendOp(name, {
                op: "cursor-say",
                path: root || "(no root)",
                goal: goal || prompt.slice(0, 160),
                actor: `fsdevops:${actor}`,
                note: String(out).slice(0, 240),
            });
            return out;
        }
        return (
            "usage: cursor project=<name> status|open|say|here|close …\n" +
            "  (requires mount flowerpot/torus/native/cursor_sdk)"
        );
    }

    async function statusText() {
        const cfg = await loadConfig();
        const names = Object.keys(cfg.projects);
        if (!names.length) return "no projects";
        const lines = names.map((n) => {
            const p = cfg.projects[n];
            const mark = n === replSessionProject ? "*" : " ";
            const route = hostparkCfg(p).route_prefix || "-";
            return `${mark} ${n}  status=${p.status || "?"}  route=${route}  root=${p.root || "?"}  files=${p.file_count ?? "-"}`;
        });
        return [
            `session: ${replSessionProject || "(none)"} — ops require project= (or REPL use)`,
            ...lines,
        ].join("\n");
    }

    function leaveRepl() {
        mode = "idle";
        draft = null;
        if (replActive) {
            replActive = false;
            try {
                navi.repl.pop();
            } catch (err) {
                out(`repl.pop failed: ${err.message || err}`);
            }
            out("[fsdevopstracker] back to navi>");
        }
    }

    async function handleReplLine(line) {
        const trimmed = String(line ?? "").trim();

        if (trimmed === "exit" || trimmed === "quit") {
            leaveRepl();
            return;
        }

        if (mode === "init_name") {
            if (!trimmed) {
                out("project name required (or exit)");
                return;
            }
            if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(trimmed)) {
                out("name: letters/digits/_/- only, start alnum");
                return;
            }
            const cfg = await loadConfig();
            if (cfg.projects[trimmed]) {
                out(`project "${trimmed}" already exists — pick another name`);
                return;
            }
            draft = { name: trimmed };
            mode = "init_path";
            out(`path for "${trimmed}"? (directory)`);
            return;
        }

        if (mode === "init_path") {
            if (!trimmed) {
                out("directory path required (or exit)");
                return;
            }
            const fs = nodeRequire("fs");
            const pathMod = nodeRequire("path");
            const rootAbs = pathMod.resolve(trimmed);
            let st;
            try {
                st = fs.statSync(rootAbs);
            } catch {
                out(`path does not exist: ${rootAbs}`);
                return;
            }
            if (!st.isDirectory()) {
                out(`not a directory: ${rootAbs}`);
                return;
            }
            draft = { ...(draft || {}), root: rootAbs };
            const cfg = await loadConfig();
            cfg.projects[draft.name] = {
                root: rootAbs,
                created_at: new Date().toISOString(),
                indexed_at: null,
                status: "pending_index",
                active_sprint: null,
            };
            await saveConfig(cfg);
            mode = "init_yn";
            out(
                `path ok. index new project "${draft.name}" into tip space? (y/n)`
            );
            return;
        }

        if (mode === "init_yn") {
            const ans = trimmed.toLowerCase();
            if (ans !== "y" && ans !== "n") {
                out("y or n only (or exit)");
                return;
            }
            const name = draft?.name;
            const root = draft?.root;
            if (ans === "n") {
                mode = "idle";
                draft = null;
                if (name) await destroyProject(name);
                else out("cancelled");
                return;
            }
            mode = "idle";
            draft = null;
            if (!name || !root) {
                out("missing draft — cancelled");
                return;
            }
            try {
                await indexProject(name, root);
            } catch (err) {
                out(`index failed: ${err.message || err}`);
            }
            return;
        }

        if (mode === "crud_goal") {
            if (!trimmed) {
                out("goal required (or exit)");
                return;
            }
            draft = { ...(draft || {}), goal: trimmed, bodyLines: [] };
            mode = "crud_body";
            out("body lines (end with a lone '.' )");
            return;
        }

        if (mode === "crud_body") {
            if (trimmed === ".") {
                try {
                    out(await finishInteractiveCrud());
                } catch (err) {
                    out(err.message || String(err));
                }
                return;
            }
            draft = {
                ...(draft || {}),
                bodyLines: [...(draft?.bodyLines || []), String(line ?? "")],
            };
            return;
        }

        if (!trimmed) {
            out("type help");
            return;
        }

        const parts = trimmed.split(/\s+/);
        const verb = parts[0].toLowerCase();
        const rest = parts.slice(1);

        try {
            if (verb === "help") {
                out(HELP);
                return;
            }
            if (verb === "status") {
                out(await statusText());
                return;
            }
            if (verb === "init") {
                mode = "init_name";
                draft = {};
                out("new project name?");
                return;
            }
            if (verb === "use") {
                out(await cmdUse(rest));
                return;
            }
            if (verb === "list") {
                out(await cmdList(rest, "repl:human"));
                return;
            }
            if (verb === "query") {
                out(await cmdList(rest, "repl:human"));
                return;
            }
            if (verb === "get") {
                out(await cmdGet(rest, "repl:human"));
                return;
            }
            if (verb === "link") {
                const { kv, positional } = parseKvArgs(rest);
                const { name } = await requireProject(
                    projectToken(kv, positional, 0),
                    "repl:human"
                );
                await linkProject(name);
                out(`linked project=${name}`);
                return;
            }
            if (verb === "mirror") {
                out(await cmdMirror(rest, "repl:human"));
                return;
            }
            if (verb === "route") {
                out(await cmdRoute(rest, "repl:human"));
                return;
            }
            if (verb === "push") {
                out(await cmdPush(rest, "repl:human"));
                return;
            }
            if (verb === "token") {
                out(await cmdToken(rest, "repl:human"));
                return;
            }
            if (verb === "keychain") {
                out(await cmdKeychain());
                return;
            }
            if (verb === "hostpark-push" || verb === "hostparkpush" || verb === "hostpush" || verb === "pot") {
                out(await cmdHostparkPush(rest, "repl:human"));
                return;
            }
            if (verb === "reinit") {
                out(await cmdReinit(rest, "repl:human"));
                return;
            }
            if (verb === "put" || verb === "append" || verb === "mut8") {
                out(
                    await cmdCrud(
                        verb === "mut8" ? "put" : verb,
                        rest,
                        "repl:human"
                    )
                );
                return;
            }
            if (verb === "ops") {
                out(await cmdOps(rest, "repl:human"));
                return;
            }
            if (verb === "ops-export" || verb === "opsexport") {
                out(await cmdOpsExport(rest, "repl:human"));
                return;
            }
            if (verb === "ops-reset" || verb === "opsreset") {
                out(await cmdOpsReset(rest, "repl:human"));
                return;
            }
            if (verb === "disk-push" || verb === "diskpush") {
                out(await cmdDiskPush(rest, "repl:human"));
                return;
            }
            if (verb === "goals") {
                out(await cmdGoals(rest, "repl:human"));
                return;
            }
            if (verb === "goal") {
                out(await cmdGoal(rest, "repl:human"));
                return;
            }
            if (verb === "sprint") {
                out(await cmdSprint(rest, "repl:human"));
                return;
            }
            if (verb === "pending") {
                out(await cmdPending(rest, "repl:human"));
                return;
            }
            if (verb === "cursor") {
                out(await cmdCursor(rest, "repl:human"));
                return;
            }
            out(`unknown: ${verb} — type help`);
        } catch (err) {
            out(err.message || String(err));
        }
    }

    function startRepl() {
        if (isBrowser || !isNode) {
            return "fsdevopstracker is native-only (navi_shell.exe)";
        }
        if (!navi.repl || typeof navi.repl.push !== "function") {
            return "navi.repl unavailable — rebuild navi_shell with repl.push/pop";
        }
        if (replActive) return "fsdevops> already active";
        mode = "idle";
        draft = null;
        replActive = true;
        navi.repl.push({
            prompt: "fsdevops> ",
            onLine: (line) => handleReplLine(line),
        });
        out("fsdevops> ready — type help (exit restores navi>)");
        return "ok";
    }

    const run = async (...rawArgs) => {
        const args =
            rawArgs.length === 1 && typeof rawArgs[0] === "string"
                ? String(rawArgs[0])
                      .trim()
                      .split(/\s+/)
                      .filter(Boolean)
                : rawArgs.map((a) => String(a)).filter((a) => a.length);
        const verb = (args[0] || "help").toLowerCase();
        const rest = args.slice(1);
        try {
            if (verb === "help" || verb === "") return HELP;
            if (verb === "start") return startRepl();
            if (verb === "status") return await statusText();
            if (verb === "init") return await cmdInitProject(rest);
            if (verb === "use") return await cmdUse(rest);
            if (verb === "list" || verb === "query") return await cmdList(rest, "callin");
            if (verb === "get") return await cmdGet(rest, "callin");
            if (verb === "reinit") return await cmdReinit(rest, "callin");
            if (verb === "put" || verb === "append" || verb === "mut8") {
                return await cmdCrud(
                    verb === "mut8" ? "put" : verb,
                    rest,
                    "callin"
                );
            }
            if (verb === "ops") return await cmdOps(rest, "callin");
            if (verb === "ops-export" || verb === "opsexport") {
                return await cmdOpsExport(rest, "callin");
            }
            if (verb === "ops-reset" || verb === "opsreset") {
                return await cmdOpsReset(rest, "callin");
            }
            if (verb === "disk-push" || verb === "diskpush") {
                return await cmdDiskPush(rest, "callin");
            }
            if (verb === "goals") return await cmdGoals(rest, "callin");
            if (verb === "goal") return await cmdGoal(rest, "callin");
            if (verb === "sprint") return await cmdSprint(rest, "callin");
            if (verb === "pending") return await cmdPending(rest, "callin");
            if (verb === "cursor") return await cmdCursor(rest, "callin");
            if (verb === "link") {
                const { kv, positional } = parseKvArgs(rest);
                mergeCallinKv(kv);
                const { name } = await requireProject(
                    projectToken(kv, positional, 0),
                    "callin"
                );
                const n = await linkProject(name);
                return `linked ${n} tip(s)`;
            }
            if (verb === "mirror") return await cmdMirror(rest, "callin");
            if (verb === "route") return await cmdRoute(rest, "callin");
            if (verb === "push") {
                return await cmdPush(rest, "callin");
            }
            if (verb === "token") return await cmdToken(rest, "callin");
            if (verb === "keychain") return await cmdKeychain();
            if (verb === "hostpark-push" || verb === "hostparkpush" || verb === "hostpush" || verb === "pot") {
                return await cmdHostparkPush(rest, "callin");
            }
            if (verb === "exit" && replActive) {
                leaveRepl();
                return "left fsdevops>";
            }
            return `unknown: ${verb}\n\n${HELP}`;
        } catch (err) {
            return `error: ${err.message || err}`;
        }
    };

    return {
        name: "fsdevopstracker",
        version: VERSION,
        description:
            "Native tip-only flow-model project indexer with fsdevops> REPL",
        about: {
            "commit-devnote": "__COMMIT_DEVNOTE__",
        },

        moduleInfo: {
            name: "fsdevopstracker",
            version: VERSION,
            description:
                "Index a local project into tip+bin; query/list/get; link pass",
        },

        // programmatic hooks for later CRUD / relay
        list: (...a) => cmdList(a),
        query: (...a) => cmdList(a),
        get: (...a) => cmdGet(a),
        use: (...a) => cmdUse(a),
        reinit: (...a) => cmdReinit(a),
        put: (...a) => cmdCrud("put", a, "api"),
        append: (...a) => cmdCrud("append", a, "api"),
        mut8: (...a) => cmdCrud("put", a, "api"),
        ops: (...a) => cmdOps(a),
        opsExport: (...a) => cmdOpsExport(a),
        opsReset: (...a) => cmdOpsReset(a),
        diskPush: (...a) => cmdDiskPush(a),
        goals: (...a) => cmdGoals(a),
        goal: (...a) => cmdGoal(a),
        sprint: (...a) => cmdSprint(a),
        pending: (...a) => cmdPending(a),
        link: async (project) => {
            const { name } = await requireProject(project, "api");
            return linkProject(name);
        },
        mirror: (...a) => cmdMirror(a, "api"),
        route: (...a) => cmdRoute(a, "api"),
        push: (...a) => cmdPush(a, "api"),
        hostparkPush: (...a) => cmdHostparkPush(a, "api"),
        pot: (...a) => cmdHostparkPush(a, "api"),
        token: (...a) => cmdToken(a, "api"),
        keychain: () => cmdKeychain(),

        cursor: (...a) => cmdCursor(a, "api"),

        commands: {
            fsdevopstracker: {
                name: "fsdevopstracker",
                description:
                    "fsdevopstracker start|…|hostpark-push|disk-push|mirror|route|token|push|keychain|cursor",
                execute: async (...args) => run(...args),
            },
            fsdevops: {
                name: "fsdevops",
                description:
                    "alias of fsdevopstracker (cursor|put|hostpark-push|…)",
                execute: async (...args) => run(...args),
            },
        },

        onMount: async () => {
            if (isBrowser || !isNode) {
                log("mounted (browser/non-Node) — start will refuse; native only");
                return;
            }
            log(`ready v${VERSION} — fsdevopstracker start`);
        },

        onUnmount: () => {
            if (replActive) leaveRepl();
            log("unmounted");
        },
    };
};
