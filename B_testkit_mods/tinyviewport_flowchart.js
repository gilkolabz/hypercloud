/**
 * tinyviewport_flowchart — flow-model plugin for tinyviewport_manager.
 *
 * Classifies flow-model artifacts in the current tipspace view, color-codes nodes
 * by role (flow, launch, ui, manager, …), and draws journey edges (routes,
 * policy, launch→flow, config links).
 *
 * Requires tinyviewport_manager mounted first:
 *   mount flowerpot/hypercloud/testkit/mods/legacy/tinyviewport_manager.js
 *   mount flowerpot/hypercloud/testkit/mods/legacy/tinyviewport_flowchart.js
 */
export const register = (navi) => {
    const VERSION = "0.1.26";
    const PLUGIN_ID = "flowchart";
    /** Logical px at scale 100%; fragment multiplies by scale pref. */
    const NODE_W = 78;
    const NODE_H = 54;
    const LAYOUT_PREFIX = "flow";
    /** Bump when band/docs order changes — invalidates view-offset bags. */
    const LAYOUT_REV = "13";
    const WAREZ_SUBJECT =
        "flowerpot/hypercloud/testkit/mods/legacy/tinyviewport_flowchart.js";
    const WAREZ_MANIFEST = "flowerpot/hypercloud/testkit/mods/tinyviewport_flowchart";

    let unregister = null;

    const FLOW_EDGE = {
        route: "#3498db",
        policy: "#9b59b6",
        entry: "#f39c12",
        launch: "#e74c3c",
        config: "#95a5a6",
        goal: "#e67e22",
    };

    const FLOW_PALETTE = {
        flow: { fill: "#1a5276", text: "#ecf0f1", stroke: "#3498db", flair: "◆" },
        launch: { fill: "#6c3483", text: "#f5eef8", stroke: "#af7ac5", flair: "▶" },
        /** QA / shopping index over launch_index — not a product screen. */
        linker: { fill: "#5b2c6f", text: "#f5eef8", stroke: "#d2b4de", flair: "☰" },
        ui: { fill: "#21618c", text: "#ebf5fb", stroke: "#5dade2", flair: "□" },
        manager: { fill: "#186a3b", text: "#eafaf1", stroke: "#58d68d", flair: "M" },
        registry: { fill: "#9a7d0a", text: "#fef9e7", stroke: "#f4d03f", flair: "R" },
        init: { fill: "#117864", text: "#e8f8f5", stroke: "#48c9b0", flair: "I" },
        module: { fill: "#566573", text: "#f4f6f7", stroke: "#85929e", flair: "·" },
        config: { fill: "#424949", text: "#f2f3f4", stroke: "#aab7b8", flair: "⚙" },
        session: { fill: "#922b21", text: "#fdedec", stroke: "#e74c3c", flair: "∷" },
        catalog: { fill: "#4a235a", text: "#f5eef8", stroke: "#a569bd", flair: "≡" },
        readme: { fill: "#2c3e50", text: "#ecf0f1", stroke: "#85929e", flair: "R" },
        devguide: { fill: "#1b2631", text: "#f4f6f7", stroke: "#5d6d7e", flair: "◉" },
        doc: { fill: "#717d7e", text: "#fdfefe", stroke: "#b2babb", flair: "?" },
        schema: { fill: "#0e6655", text: "#e8f8f5", stroke: "#1abc9c", flair: "Σ" },
        artifact: { fill: "#7e5109", text: "#fef9e7", stroke: "#d4ac0d", flair: "◇" },
        assets: { fill: "#7e5109", text: "#fef9e7", stroke: "#d4ac0d", flair: "◇" },
        skin: { fill: "#a04000", text: "#fef5e7", stroke: "#e67e22", flair: "◐" },
        goals: { fill: "#1e8449", text: "#eafaf1", stroke: "#58d68d", flair: "G" },
        ops: { fill: "#6c3483", text: "#f5eef8", stroke: "#bb8fce", flair: "O" },
    };

    /** Vertical bands top→bottom. */
    const FLOW_BAND_ORDER = [
        "config", // cfg first
        "launch", // boot
        "modules", // init / mgr / reg
        "flow", // flow artifact under modules
        "meta",
        "ui",
        "artifact",
        "docs",
        "other",
    ];

    const flowBandForKind = (kind) => {
        if (kind === "launch" || kind === "linker") return "launch";
        if (kind === "config") return "config";
        if (kind === "flow") return "flow";
        if (
            kind === "init" ||
            kind === "manager" ||
            kind === "registry" ||
            kind === "module"
        ) {
            return "modules";
        }
        if (kind === "ui" || kind === "skin" || kind === "assets") return "ui";
        if (kind === "schema" || kind === "artifact") return "artifact";
        if (kind === "readme" || kind === "devguide" || kind === "doc") return "docs";
        if (kind === "session" || kind === "catalog" || kind === "goals" || kind === "ops")
            return "meta";
        return "other";
    };

    /** L→R order within a band (lower first). */
    const flowLayoutOrderForKind = (kind) => {
        if (kind === "goals") return 0;
        if (kind === "ops") return 1;
        if (kind === "session") return 2;
        if (kind === "catalog") return 3;
        if (kind === "linker") return 0; // leftmost in boot band — hub to all boots
        if (kind === "skin") return 0; // product skin leftmost in ui band
        if (kind === "init") return 0;
        if (kind === "manager") return 1;
        if (kind === "registry") return 2;
        if (kind === "module") return 3;
        // docs defaults; project readme / explicit pass overrides below
        if (kind === "devguide") return 10;
        if (kind === "readme") return 100;
        if (kind === "doc") return 200;
        return 50;
    };

    const isProjectReadmePath = (ib, project, flowerpotRoot) => {
        const p = normalizeParkPath(ib).toLowerCase();
        if (!p.endsWith("/readme.md") && p !== "readme.md") return false;
        const proj = String(project || "")
            .trim()
            .toLowerCase();
        if (proj) {
            if (p === `${proj}/readme.md` || p.endsWith(`/${proj}/readme.md`)) {
                return true;
            }
            // config.project often matches the product folder name anywhere in path
            if (p.includes(`/${proj}/readme.md`)) return true;
        }
        const root = normalizeParkPath(flowerpotRoot).toLowerCase();
        if (root && (p === `${root}/readme.md` || p.endsWith(`/${root}/readme.md`))) {
            return true;
        }
        return false;
    };

    const PRODUCT_UI_ROUTES = new Set([
        "jobs",
        "job",
        "area",
        "punch",
        "launch",
        "list",
        "edit",
        "create",
    ]);

    const resolveManager = () => {
        const mod = navi?.mod || globalThis?.navi?.mod;
        return mod?.tinyviewport_manager || null;
    };

    const normalizeParkPath = (raw) => {
        let p = String(raw || "").trim();
        if (!p) return "";
        p = p.replace(/^\/+/, "").replace(/\\/g, "/");
        if (p.startsWith("flowerpot/")) p = p.slice("flowerpot/".length);
        if (p.startsWith("navi:")) p = p.slice("navi:".length);
        if (p.startsWith("navi/")) p = p.slice("navi/".length);
        // project:rel/file → rel/file (fsdevopstracker tip ib)
        const projRel = p.match(/^([a-z0-9_-]+):([^:]+(?:\/[^:]*)*)$/i);
        if (projRel && !/:devops:(goals|ops)$/i.test(p)) {
            p = projRel[2];
        }
        return p.replace(/\/+$/, "");
    };

    const pathLeaf = (p) => {
        const s = normalizeParkPath(p);
        const parts = s.split("/").filter(Boolean);
        return parts[parts.length - 1] || s;
    };

    /** QA program index under launch/ — lists boots from launch_index.json. */
    const isLaunchLinkerPath = (ibOrBase) => {
        const base = pathLeaf(normalizeParkPath(ibOrBase)).toLowerCase();
        return (
            base === "linker.html" ||
            base === "linker.htm" ||
            base === "linker"
        );
    };

    const pathVariants = (raw) => {
        const p = normalizeParkPath(raw);
        if (!p) return [];
        const out = [p];
        if (p.endsWith(".html")) {
            const bare = p.slice(0, -".html".length);
            if (bare && !out.includes(bare)) out.push(bare);
        } else {
            const withHtml = `${p}.html`;
            if (!out.includes(withHtml)) out.push(withHtml);
        }
        return out;
    };

    const pathsMatch = (a, b) => {
        const va = pathVariants(a);
        const vb = pathVariants(b);
        for (const x of va) {
            if (vb.includes(x)) return true;
        }
        return false;
    };

    const getFrameText = async (frame) => {
        if (!frame || typeof frame !== "object") return "";
        if (frame.data?.html != null) return String(frame.data.html);
        if (frame.data?.json != null) {
            try {
                return JSON.stringify(frame.data.json);
            } catch {
                return String(frame.data.json);
            }
        }
        const ref = Array.isArray(frame.rel8ns?.bin)
            ? frame.rel8ns.bin[0]
            : null;
        const sha = String(ref || "")
            .trim()
            .match(/^bin\s+([0-9a-fA-F]+)$/)?.[1]
            ?.toLowerCase();
        if (!sha || !navi.storage?.bin?.get) return "";
        try {
            const bin = await navi.storage.bin.get(sha);
            if (bin?.media == null) return "";
            return String(bin.media);
        } catch {
            return "";
        }
    };

    const parseDocHeading = (text) => {
        for (const line of String(text || "").split(/\r?\n/)) {
            const m = line.match(/^\s*(#\s*.+?)\s*$/);
            if (m) return m[1].trim();
        }
        return "";
    };

    const headingBody = (heading) =>
        String(heading || "").replace(/^#\s*/, "").trim();

    /** True when body looks like a JSON Schema document. */
    const looksLikeJsonSchema = (text) => {
        const t = String(text || "");
        if (!t) return false;
        if (/\$schema"\s*:\s*"[^"]*json-schema/i.test(t)) return true;
        if (
            /"\$id"\s*:/.test(t) &&
            /"type"\s*:\s*"(?:object|array|string|number|integer|boolean|null)"/.test(t) &&
            /"properties"\s*:/.test(t)
        ) {
            return true;
        }
        return false;
    };

    const classifyFromTipData = (tip, text = "") => {
        const data = tip?.data || {};
        const artifactType = String(data.artifact_type || "").toLowerCase();
        if (artifactType === "goals" || artifactType === "ops") return artifactType;
        if (artifactType === "skin") return "skin";
        if (artifactType === "assets") return "assets";
        const parts = Array.isArray(data.parts) ? data.parts.join(" ") : "";
        if (/fsdevopstracker_goals/i.test(parts)) return "goals";
        if (/fsdevopstracker_ops/i.test(parts)) return "ops";
        if (data.event?.kind === "ops-batch") return "ops";
        const json =
            data.json && typeof data.json === "object"
                ? data.json
                : parseJsonLoose(text);
        if (json?.goals && Array.isArray(json.goals)) return "goals";
        if (json?.ops && Array.isArray(json.ops)) return "ops";
        return null;
    };

    const classifyFlowKind = (ib, text = "", tip = null) => {
        const rawIb = String(ib || "");
        if (/:devops:goals$/i.test(rawIb)) return "goals";
        if (/:devops:ops$/i.test(rawIb)) return "ops";

        const fromTip = classifyFromTipData(tip, text);
        if (fromTip) return fromTip;

        const path = normalizeParkPath(ib);
        const lower = path.toLowerCase();
        const base = pathLeaf(path);
        const t = String(text || "");

        if (/:session:/i.test(ib) || /session:/i.test(ib)) return "session";
        if (base === "config.json" || /\/config\.json$/i.test(lower)) return "config";
        if (
            /\/devops\/goals\.json$/i.test(lower) ||
            (base === "goals.json" && /\/devops\//i.test(lower))
        ) {
            return "goals";
        }
        if (
            /\/devops\/ops\.json$/i.test(lower) ||
            (base === "ops.json" && /\/devops\//i.test(lower))
        ) {
            return "ops";
        }
        if (
            /artifacts\.json$/i.test(base) ||
            /programs\.json$/i.test(base) ||
            /launch_index\.json$/i.test(base) ||
            /registry_index\.json$/i.test(base)
        ) {
            return "catalog";
        }
        if (/_skin\.css$/i.test(base) || (/\.css$/i.test(base) && /skin/i.test(base))) {
            return "skin";
        }
        if (/\/schema\//i.test(lower) && /\.json$/i.test(base)) return "schema";
        if (/\.json$/i.test(base) && looksLikeJsonSchema(t)) return "schema";
        if (/\/data\//i.test(lower) && /\.json$/i.test(base)) return "artifact";
        if (/\/flow\/.+\.json$/i.test(lower) || /^flow\//i.test(lower)) {
            if (/"routes"\s*:/.test(t) && /"policy"\s*:/.test(t)) return "flow";
            if (/"entry"\s*:/.test(t) && /"routes"\s*:/.test(t)) return "flow";
            if (!t) return "flow";
            return "artifact";
        }
        if (/^readme\.md$/i.test(base) || /\/readme\.md$/i.test(lower)) return "readme";
        if (/devguide/i.test(lower) || /devguide/i.test(base)) return "devguide";
        if (/\/launch\//i.test(lower) || /^launch\//i.test(lower)) {
            if (isLaunchLinkerPath(base)) return "linker";
            if (/\.html?$/i.test(base)) return "launch";
            return "launch";
        }
        if (
            (/\/programs\//i.test(lower) || /^programs\//i.test(lower)) &&
            /\.json$/i.test(base)
        ) {
            return "catalog";
        }
        if (/\/ui\//i.test(lower) || /^ui\//i.test(lower)) {
            if (/_skin\.css$/i.test(base) || (/\.css$/i.test(base) && /skin/i.test(base))) {
                return "skin";
            }
            if (/launch/i.test(base)) return "launch";
            return "ui";
        }
        if (/\/modules\//i.test(lower) || /^modules\//i.test(lower)) {
            if (/_manager\.js$/i.test(base)) return "manager";
            if (/_registry\.js$/i.test(base)) return "registry";
            if (/_init\.js$/i.test(base)) return "init";
            return "module";
        }
        if (/\.(md|txt)$/i.test(base)) return "doc";
        if (/\.html?$/i.test(base)) {
            if (/launch/i.test(base) || /\bFLOW(?:_ARTIFACT)?\s*=/.test(t))
                return "launch";
            return "ui";
        }
        if (/\.js$/i.test(base) && /export\s+const\s+register/.test(t)) {
            if (/_manager\.js$/i.test(base)) return "manager";
            if (/_registry\.js$/i.test(base)) return "registry";
            if (/_init\.js$/i.test(base)) return "init";
            return "module";
        }
        const json = parseJsonLoose(t);
        if (json?.goals && Array.isArray(json.goals)) return "goals";
        if (json?.ops && Array.isArray(json.ops)) return "ops";
        return null;
    };

    const parseJsonLoose = (text) => {
        const t = String(text || "").trim();
        if (!t || t[0] !== "{") return null;
        try {
            return JSON.parse(t);
        } catch {
            return null;
        }
    };

    const tMatch = (text, re) => {
        const m = String(text || "").match(re);
        if (!m) return "";
        return m[1] || m[2] || "";
    };

    const extractFlowMeta = (kind, ib, text) => {
        const path = normalizeParkPath(ib);
        const base = pathLeaf(path);
        const heading = parseDocHeading(text);
        const meta = { ib: path, kind, title: path, heading };
        if (kind === "flow") {
            const json = parseJsonLoose(text);
            meta.json = json;
            meta.id = json?.id || base.replace(/\.json$/i, "");
            meta.entry = json?.entry || "";
            meta.routeKeys = json?.routes ? Object.keys(json.routes) : [];
            meta.title = `flow ${meta.id}${meta.entry ? ` · entry=${meta.entry}` : ""}`;
            meta.shortLabel = String(meta.id || "flow").slice(0, 10);
        } else if (kind === "linker") {
            meta.routeKey = "linker";
            meta.shortLabel = "linker";
            meta.title = "launch linker · program index (launch_index)";
            meta.hub = true;
        } else if (kind === "ui" || kind === "launch") {
            const lowerPath = path.toLowerCase();
            const inUi = /\/ui\//i.test(lowerPath) || /^ui\//i.test(lowerPath);
            const inLaunch = /\/launch\//i.test(lowerPath) || /^launch\//i.test(lowerPath);
            const looksLaunch = /launch/i.test(base);
            const hubInLaunch = inLaunch && isLaunchLinkerPath(base);
            if (inUi && looksLaunch) {
                meta.pathAnomaly = "launch-in-ui";
            } else if (
                inLaunch &&
                !looksLaunch &&
                !hubInLaunch &&
                /\.html?$/i.test(base)
            ) {
                meta.pathAnomaly = "screen-in-launch";
            }
            meta.routeKey = base.replace(/\.html?$/i, "");
            meta.productScreen = PRODUCT_UI_ROUTES.has(meta.routeKey);
            const anomaly =
                meta.pathAnomaly === "launch-in-ui"
                    ? " · ⚠ launch should be launch/"
                    : meta.pathAnomaly === "screen-in-launch"
                      ? " · ⚠ screen should be ui/"
                      : "";
            meta.title = `${kind} ${meta.routeKey}${meta.productScreen ? " · product" : ""}${anomaly}`;
            meta.shortLabel =
                kind === "launch"
                    ? "boot"
                    : String(meta.routeKey || "ui").slice(0, 8);
        } else if (kind === "manager") {
            meta.shortLabel = "mgr";
            meta.title = `manager ${base}`;
        } else if (kind === "registry") {
            meta.shortLabel = "reg";
            meta.title = `registry ${base}`;
        } else if (kind === "init") {
            meta.shortLabel = "init";
            meta.title = `init ${base}`;
        } else if (kind === "config") {
            const json = parseJsonLoose(text);
            meta.json = json;
            meta.shortLabel = "cfg";
            meta.title = `config ${json?.project || base}`;
        } else if (kind === "session") {
            meta.shortLabel = "sess";
            meta.title = `session ${pathLeaf(ib)}`;
        } else if (kind === "catalog") {
            const json = parseJsonLoose(text);
            meta.json = json;
            meta.shortLabel = "cat";
            meta.title = `catalog ${base}`;
            if (json?.flow) {
                meta.flowRef = normalizeParkPath(String(json.flow));
            }
            if (json?.launch) {
                meta.launchRef = normalizeParkPath(String(json.launch));
            }
            if (json?.id && /:program:/i.test(String(json.id))) {
                meta.programId = String(json.id);
            }
            if (Array.isArray(json?.programs)) {
                meta.programEntries = json.programs;
            }
        } else if (kind === "readme" || kind === "devguide" || kind === "doc") {
            const body = headingBody(heading);
            const fallback =
                kind === "readme" ? "readme" : kind === "devguide" ? "guide" : "doc";
            meta.shortLabel = body || fallback;
            meta.title = body || `${kind} ${base}`;
        } else if (kind === "schema") {
            const json = parseJsonLoose(text);
            meta.json = json;
            if (json?.$id) meta.schemaId = String(json.$id);
            if (json?.$schema) meta.schemaDraft = String(json.$schema);
            if (json?.title) meta.schemaTitle = String(json.title);
            if (json?.type) meta.schemaType = String(json.type);
            const leaf = meta.schemaId
                ? pathLeaf(meta.schemaId)
                : base.replace(/\.json$/i, "");
            meta.shortLabel = String(meta.schemaTitle || leaf || "schema").slice(0, 12);
            meta.title = meta.schemaTitle
                ? `schema ${meta.schemaTitle}${meta.schemaId ? ` · ${meta.schemaId}` : ""}`
                : `schema ${meta.schemaId || base}`;
        } else if (kind === "artifact") {
            meta.shortLabel = base.replace(/\.json$/i, "").slice(0, 10);
            meta.title = `artifact ${base}`;
            const json = parseJsonLoose(text);
            if (json?.$id) meta.schemaId = String(json.$id);
            if (json?.id && !json?.routes) meta.recordId = String(json.id);
        } else if (kind === "goals") {
            const json = parseJsonLoose(text);
            meta.json = json;
            const goals = json?.goals || [];
            const open = goals.filter((g) => g.status !== "done").length;
            meta.shortLabel = "goals";
            meta.title = `goals ${json?.project || ""} · ${open} open`;
            if (json?.phase != null) meta.phase = json.phase;
        } else if (kind === "ops") {
            const json = parseJsonLoose(text);
            meta.json = json;
            const count = (json?.ops || []).length;
            meta.shortLabel = "ops";
            meta.title = `ops ${json?.project || ""} · ${count} entries`;
            if (json?.phase != null) meta.phase = json.phase;
        } else if (kind === "module") {
            meta.shortLabel = pathLeaf(base).replace(/\.js$/i, "").slice(0, 8);
            meta.title = `module ${base}`;
        }
        if (kind === "launch") {
            const m =
                tMatch(text, /\bFLOW(?:_ARTIFACT)?\s*=\s*["']([^"']+)["']/) ||
                tMatch(text, /data-path=["']([^"']+)["']/);
            if (m) meta.flowRef = normalizeParkPath(m);
            const initM = tMatch(
                text,
                /\bINIT\s*=\s*["']([^"']+)["']|mount\s+["']?([^\s"']+)/
            );
            if (initM) meta.initRef = normalizeParkPath(initM);
        }
        return meta;
    };

    const buildFlowNodeLabel = (kind, meta = {}, node = {}) => {
        let label = meta.shortLabel || kind || "?";
        if (kind === "flow" && meta.entry) label = `${label}\n→${meta.entry}`;
        else if (kind === "ui" && meta.routeKey) label = meta.routeKey.slice(0, 9);
        else if (kind === "goals") label = `goals\n${meta.json?.goals?.length || 0}`;
        else if (kind === "ops") label = `ops\n${meta.json?.ops?.length || 0}`;
        if (node.n != null && kind !== "flow") {
            label = `${label}\n${node.n}`;
        }
        return label;
    };

    const buildFlowDetail = (kind, meta = {}, node = {}) => {
        const lines = [];
        if (kind === "schema") lines.push("JSON Schema");
        if (meta.productScreen) lines.push("product screen");
        if (kind === "ui" && meta.productScreen) lines.push("artifact family: product");
        if (meta.entry) lines.push(`entry: ${meta.entry}`);
        if (meta.routeKeys?.length) {
            lines.push(`routes: ${meta.routeKeys.join(", ")}`);
        }
        if (meta.routeKey && kind !== "flow" && kind !== "linker") {
            lines.push(`route: ${meta.routeKey}`);
        }
        if (kind === "linker") {
            lines.push("program shopping index");
            lines.push("lists all launch/ boots from launch_index.json");
        }
        if (meta.id && kind === "flow") lines.push(`id: ${meta.id}`);
        if (meta.schemaTitle && kind === "schema") lines.push(`title: ${meta.schemaTitle}`);
        if (meta.schemaId) lines.push(`$id: ${meta.schemaId}`);
        if (meta.schemaType) lines.push(`type: ${meta.schemaType}`);
        if (meta.schemaDraft) lines.push(`$schema: ${meta.schemaDraft}`);
        if (meta.recordId) lines.push(`record: ${meta.recordId}`);
        if (kind === "goals" && meta.json) {
            const goals = meta.json.goals || [];
            const open = goals.filter((g) => g.status !== "done").length;
            if (meta.json.phase != null) lines.push(`phase: ${meta.json.phase}`);
            lines.push(`${open} open / ${goals.length} goals`);
        }
        if (kind === "ops" && meta.json) {
            if (meta.json.phase != null) lines.push(`phase: ${meta.json.phase}`);
            lines.push(`${(meta.json.ops || []).length} artifact associations`);
        }
        if (meta.heading && kind !== "flow") lines.push(meta.heading);
        if (node.n != null) lines.push(`n=${node.n}`);
        const ib = String(node.ib || meta.ib || "").trim();
        if (ib) lines.push(ib);
        return {
            flair: FLOW_PALETTE[kind]?.flair || "·",
            kind,
            heading: meta.title || `${kind} ${ib}`,
            lines,
        };
    };

    const styleNode = (node, frame) => {
        // Only claim tips we classified. Past gens stay on the lineage stack
        // (black square + n) whenever lineage is enabled.
        const isFlowTip =
            node?.kind === "tip" ||
            (node?.flowKind && node?.source === PLUGIN_ID);
        if (!isFlowTip) return null;

        const ib = String(node?.ib || frame?.ib || "");
        const tipFrame = frame || node?.frame;
        const kind =
            node?.flowKind ||
            classifyFlowKind(ib, "", tipFrame) ||
            classifyFromTipData(tipFrame);
        if (!kind || !FLOW_PALETTE[kind]) return null;
        const pal = FLOW_PALETTE[kind];
        let meta = node?.flowMeta;
        if (!meta) {
            let text = "";
            const data = tipFrame?.data || {};
            if (data.json != null) {
                try {
                    text = JSON.stringify(data.json);
                } catch {
                    text = String(data.json);
                }
            } else if (data.goals) {
                try {
                    text = JSON.stringify({
                        project: data.project,
                        goals: data.goals,
                        phase: data.phase,
                    });
                } catch {
                    text = "";
                }
            } else if (data.event?.kind === "ops-batch") {
                try {
                    text = JSON.stringify({
                        project: data.project,
                        event: data.event,
                        phase: data.phase,
                    });
                } catch {
                    text = "";
                }
            }
            meta = extractFlowMeta(kind, ib, text);
        }
        return {
            fill: pal.fill,
            text: pal.text,
            stroke: meta.pathAnomaly ? "#e67e22" : pal.stroke,
            flair: meta.pathAnomaly ? "!" : pal.flair,
            flairColor: pal.text,
            label: buildFlowNodeLabel(kind, meta, node),
            title: meta.title || `${kind} ${ib}`,
            width: NODE_W,
            height: NODE_H,
            detail: buildFlowDetail(kind, meta, node),
        };
    };

    const resolveBootOpenUrl = (ib) => {
        const path = normalizeParkPath(ib);
        if (!path) return "";
        const naviApi = navi || globalThis.navi;
        if (naviApi?.resolveUrl) {
            try {
                const u = String(naviApi.resolveUrl(path) || "").trim();
                if (u) return u;
            } catch {
                /* fall through */
            }
        }
        const origin = String(
            naviApi?.origin ||
                (typeof globalThis.location !== "undefined"
                    ? globalThis.location.origin
                    : "")
        ).replace(/\/+$/, "");
        const rel = path.replace(/^\/+/, "");
        if (origin) return `${origin}/${rel}`;
        return `/${rel}`;
    };

    const resolveSpanIb = (node, frame) => {
        const raw = String(node?.ib || frame?.ib || "");
        if (/:devops:ops$/i.test(raw)) return raw;
        if (/:devops:goals$/i.test(raw)) return raw;
        if (/^navi:relay:log$/i.test(raw)) return "navi:relay:log";
        if (/^navi:mod$/i.test(raw)) return "navi:mod";
        const path = normalizeParkPath(raw);
        if (/\/devops\/ops\.json$/i.test(path)) {
            const project =
                frame?.data?.project ||
                node?.flowMeta?.json?.project ||
                path.match(/^([^/]+)\//)?.[1];
            if (project) return `${project}:devops:ops`;
        }
        return null;
    };

    const buildLineageScrub = (spanIb, label, startIndex = 0) => {
        const tipApi = navi?.storage?.tip;
        if (!tipApi?.span && !tipApi?.lineage) return null;
        return {
            id: `${PLUGIN_ID}:lineage:${spanIb}`,
            label: label || "lineage",
            total: 1,
            index: Math.max(0, Number(startIndex) || 0),
            async step(index) {
                const want = Math.max(
                    0,
                    Math.min(Number(index) || 0, 99999)
                );
                let hits = [];
                if (tipApi.span) {
                    hits = await tipApi.span(spanIb, { dir: "all" });
                } else if (tipApi.lineage) {
                    hits = (await tipApi.lineage(spanIb)).slice().reverse();
                }
                if (!Array.isArray(hits) || !hits.length) return null;
                const hit = hits[want] || hits[hits.length - 1];
                const fr = hit?.frame || hit;
                let detail = "";
                if (tipApi.spanDiff) {
                    try {
                        const diff = await tipApi.spanDiff(spanIb, {
                            dir: "all",
                            fold: true,
                        });
                        const d = diff.deltas[want];
                        if (d) {
                            detail = `${d.kind}${d.path ? ` ${d.path}` : d.key ? ` ${d.key}` : ""}`;
                        }
                    } catch {
                        /* ignore */
                    }
                }
                return { frame: fr, detail };
            },
        };
    };

    const overlayNode = async (node, frame) => {
        const kind = node?.flowKind;
        const isBoot =
            kind === "launch" ||
            kind === "linker" ||
            node?.flowBand === "launch" ||
            node?.layoutBand === "launch" ||
            node?.flowBand === "boot" ||
            node?.layoutBand === "boot";
        if (isBoot) {
            const ib = normalizeParkPath(node?.ib || frame?.ib || "");
            if (!ib) return null;
            const url = resolveBootOpenUrl(ib);
            const openBoot = () => {
                if (typeof globalThis.open === "function") {
                    globalThis.open(url, "_blank", "noopener,noreferrer");
                }
            };
            const isLinker = kind === "linker" || isLaunchLinkerPath(ib);
            return {
                actions: [
                    {
                        id: "open_boot",
                        label: isLinker ? "open linker" : "open boot",
                        title: isLinker
                            ? `Open launch linker (program index) — ${ib}`
                            : `Open ${ib} in a new tab`,
                        href: url,
                        run: openBoot,
                    },
                ],
            };
        }

        const spanIb = resolveSpanIb(node, frame);
        if (spanIb) {
            const tipApi = navi?.storage?.tip;
            let total = 1;
            try {
                if (tipApi?.lineage) {
                    total = (await tipApi.lineage(spanIb)).length || 1;
                }
            } catch {
                total = 1;
            }
            if (total > 1) {
                const scrub = buildLineageScrub(
                    spanIb,
                    `${kind || "tip"} lineage`,
                    total - 1
                );
                if (scrub) {
                    scrub.total = total;
                    return { scrub };
                }
            }
        }

        return null;
    };

    const contribute = async (ctx) => {
        const viewIbs = ctx.viewIbs
            ? [...ctx.viewIbs]
            : [ctx.baseIb].filter(Boolean);
        const nodes = [];
        const edges = [];
        const catalog = new Map();

        const indexRecord = (ib, rec) => {
            catalog.set(ib, rec);
            for (const v of pathVariants(ib)) {
                if (!catalog.has(v)) catalog.set(v, rec);
            }
            if (rec.meta?.id) {
                for (const v of pathVariants(rec.meta.id)) {
                    if (!catalog.has(v)) catalog.set(v, rec);
                }
            }
        };

        const findByPath = (rawPath) => {
            const p = normalizeParkPath(rawPath);
            if (!p) return null;
            for (const v of pathVariants(p)) {
                if (catalog.has(v)) return catalog.get(v);
            }
            for (const rec of catalog.values()) {
                if (pathsMatch(rec.ib, p)) return rec;
            }
            return null;
        };

        const eachRecord = (fn) => {
            const seen = new Set();
            for (const rec of catalog.values()) {
                if (seen.has(rec.addr)) continue;
                seen.add(rec.addr);
                fn(rec);
            }
        };

        for (const ib of viewIbs) {
            let tip = null;
            try {
                tip = await ctx.tipApi().get(ib);
            } catch {
                tip = null;
            }
            if (!tip) continue;
            const addr = ctx.frameAddr(tip);
            if (!addr) continue;
            const text = await getFrameText(tip);
            const kind =
                classifyFlowKind(ib, text, tip) || classifyFromTipData(tip, text);
            if (!kind) continue;
            const meta = extractFlowMeta(kind, ib, text);
            const flowBand = flowBandForKind(kind);
            const layoutBandRank = Math.max(0, FLOW_BAND_ORDER.indexOf(flowBand));
            const rec = { ib, addr, frame: tip, kind, meta, text, flowBand };
            indexRecord(ib, rec);
            nodes.push({
                addr,
                ib,
                frame: tip,
                stub: false,
                kind: "tip",
                flowKind: kind,
                flowMeta: meta,
                flowBand,
                flowLayoutOrder: flowLayoutOrderForKind(kind),
                layoutPrefix: LAYOUT_PREFIX,
                layoutBand: flowBand,
                layoutBandRank,
                layoutOrder: flowLayoutOrderForKind(kind),
                row: `${LAYOUT_PREFIX}:${flowBand}`,
                source: PLUGIN_ID,
            });
        }

        // Project name from config.json → pin root readme leftmost, label it.
        let projectName = "";
        let flowerpotRoot = "";
        eachRecord((rec) => {
            if (rec.kind !== "config" || !rec.meta?.json) return;
            const j = rec.meta.json;
            if (!projectName && j.project) projectName = String(j.project).trim();
            const root = j.flowerpot?.root || j.root;
            if (!flowerpotRoot && root) flowerpotRoot = String(root).trim();
        });

        if (projectName || flowerpotRoot) {
            for (const n of nodes) {
                if (n.flowKind !== "readme") continue;
                if (!isProjectReadmePath(n.ib, projectName, flowerpotRoot)) continue;
                n.flowMeta = {
                    ...(n.flowMeta || {}),
                    projectReadme: true,
                    project: projectName || n.flowMeta?.project,
                    shortLabel: projectName || n.flowMeta?.shortLabel || "readme",
                    title: projectName
                        ? `readme ${projectName}`
                        : n.flowMeta?.title || "project readme",
                };
                n.flowLayoutOrder = 0;
                n.layoutOrder = 0;
                n.layoutPrefix = LAYOUT_PREFIX;
                n.layoutBand = n.flowBand || "docs";
                n.row = `${LAYOUT_PREFIX}:${n.layoutBand}`;
            }
        }

        // Docs L→R: project readme → devguide → other readmes/docs.
        for (const n of nodes) {
            if (n.layoutBand !== "docs" && n.flowBand !== "docs") continue;
            let order = 200;
            if (n.flowMeta?.projectReadme) order = 0;
            else if (n.flowKind === "devguide") order = 10;
            else if (n.flowKind === "readme") order = 100;
            else if (n.flowKind === "doc") order = 150;
            n.flowLayoutOrder = order;
            n.layoutOrder = order;
        }

        // UI route order from flow artifacts (for layout left→right)
        const routeOrder = [];
        eachRecord((rec) => {
            if (rec.kind !== "flow" || !rec.meta?.json?.routes) return;
            for (const k of Object.keys(rec.meta.json.routes)) {
                if (!routeOrder.includes(k)) routeOrder.push(k);
            }
        });
        for (const n of nodes) {
            if (n.flowKind !== "ui" || !n.flowMeta?.routeKey) continue;
            const idx = routeOrder.indexOf(n.flowMeta.routeKey);
            n.flowRouteOrder = idx >= 0 ? idx : 999;
            if (idx >= 0) {
                n.flowLayoutOrder = idx;
                n.layoutOrder = idx;
            }
        }

        const pushEdge = (from, to, patch = {}) => {
            const f = String(from || "").trim();
            const t = String(to || "").trim();
            if (!f || !t || f === t) return;
            edges.push({
                from: f,
                to: t,
                source: PLUGIN_ID,
                ...patch,
            });
        };

        const resolveRouteUrl = (url) => {
            const park = normalizeParkPath(
                String(url || "")
                    .replace(/^\/flowerpot\//i, "")
                    .replace(/^\/+/, "")
            );
            return findByPath(park);
        };

        const resolveRouteKey = (routes, routeKey) => {
            const url = routes?.[routeKey];
            if (!url) return null;
            return resolveRouteUrl(url);
        };

        eachRecord((rec) => {
            if (rec.kind !== "flow" || !rec.meta?.json) return;
            const flow = rec.meta.json;
            const routes = flow.routes || {};

            const entryHit = resolveRouteKey(routes, flow.entry);
            if (entryHit) {
                pushEdge(rec.addr, entryHit.addr, {
                    rel: "flow_entry",
                    color: FLOW_EDGE.entry,
                });
            }

            for (const [routeKey, url] of Object.entries(routes)) {
                const hit = resolveRouteUrl(url);
                if (!hit) continue;
                pushEdge(rec.addr, hit.addr, {
                    rel: `flow_route:${routeKey}`,
                    color: FLOW_EDGE.route,
                });
            }

            for (const [fromRoute, outcomes] of Object.entries(flow.policy || {})) {
                const fromHit = resolveRouteKey(routes, fromRoute);
                if (!fromHit) continue;
                for (const [event, toRoute] of Object.entries(outcomes || {})) {
                    const toHit = resolveRouteKey(routes, toRoute);
                    if (!toHit || toHit.addr === fromHit.addr) continue;
                    pushEdge(fromHit.addr, toHit.addr, {
                        rel: `flow_policy:${fromRoute}.${event}→${toRoute}`,
                        color: FLOW_EDGE.policy,
                        dash: "5 4",
                    });
                }
            }
        });

        eachRecord((rec) => {
            if (rec.kind !== "launch") return;
            if (rec.meta?.flowRef) {
                const hit = findByPath(rec.meta.flowRef);
                if (hit) {
                    pushEdge(rec.addr, hit.addr, {
                        rel: "flow_launch",
                        color: FLOW_EDGE.launch,
                    });
                }
            }
            if (rec.meta?.initRef) {
                const hit = findByPath(rec.meta.initRef);
                if (hit) {
                    pushEdge(rec.addr, hit.addr, {
                        rel: "flow_init",
                        color: FLOW_EDGE.config,
                        dash: "3 3",
                    });
                }
            }
        });

        const joinProjectPath = (root, rel) => {
            const r = normalizeParkPath(String(root || "").replace(/\/+$/, ""));
            const p = normalizeParkPath(String(rel || "").replace(/^\/+/, ""));
            if (!p) return r;
            if (!r) return p;
            if (p.startsWith(r + "/") || p === r) return p;
            return `${r}/${p}`;
        };

        eachRecord((rec) => {
            if (rec.kind !== "config" || !rec.meta?.json) return;
            const fp = rec.meta.json.flowerpot || rec.meta.json;
            const links = [
                ["flow_config:flow", fp.flow_artifact],
                ["flow_config:manager", fp.manager_module],
                ["flow_config:registry", fp.registry_module],
                ["flow_config:init", fp.init_module],
                ["flow_config:launch", fp.launch_fragment],
                ["flow_config:skin", fp.skin_css || fp.skin],
                ["flow_config:launch_index", fp.launch_index],
                ["flow_config:program", fp.program_manifest],
                ["flow_config:seed", fp.seed_data],
            ];
            const linked = new Set();
            let skinHit = null;
            for (const [rel, path] of links) {
                if (!path) continue;
                const hit = findByPath(path);
                if (!hit) continue;
                linked.add(hit.addr);
                if (rel === "flow_config:skin") skinHit = hit;
                pushEdge(rec.addr, hit.addr, {
                    rel,
                    color:
                        rel === "flow_config:skin"
                            ? FLOW_EDGE.goal
                            : FLOW_EDGE.config,
                    dash: "2 4",
                });
            }
            // Product skin wraps every launch + ui screen (ensureFlowSkin / L3).
            if (skinHit) {
                eachRecord((r) => {
                    if (
                        r.kind !== "ui" &&
                        r.kind !== "launch" &&
                        r.kind !== "linker"
                    ) {
                        return;
                    }
                    pushEdge(skinHit.addr, r.addr, {
                        rel: "flow_skin",
                        color: FLOW_EDGE.goal,
                        dash: "3 2",
                    });
                });
            }
            // One config.json — fan out to every program launch/flow from launch_index.
            const idxCandidates = [
                joinProjectPath(flowerpotRoot, "data/launch_index.json"),
                "data/launch_index.json",
            ];
            let idxHit = null;
            for (const p of idxCandidates) {
                idxHit = findByPath(p);
                if (idxHit) break;
            }
            const programs =
                idxHit?.meta?.programEntries ||
                idxHit?.meta?.json?.programs ||
                [];
            for (const prog of programs) {
                const pid = String(prog?.id || prog?.launch || prog?.flow || "").trim();
                if (prog?.flow) {
                    const hit = findByPath(joinProjectPath(flowerpotRoot, prog.flow));
                    if (hit) {
                        pushEdge(rec.addr, hit.addr, {
                            rel: pid
                                ? `flow_config:flow:${pid}`
                                : "flow_config:flow",
                            color: FLOW_EDGE.config,
                            dash: "2 4",
                        });
                    }
                }
                if (prog?.launch) {
                    const hit = findByPath(joinProjectPath(flowerpotRoot, prog.launch));
                    if (!hit || linked.has(hit.addr)) continue;
                    pushEdge(rec.addr, hit.addr, {
                        rel: pid
                            ? `flow_config:launch:${pid}`
                            : "flow_config:launch",
                        color: FLOW_EDGE.config,
                        dash: "2 4",
                    });
                    linked.add(hit.addr);
                }
            }
        });

        eachRecord((rec) => {
            if (rec.kind !== "catalog") return;
            const link = (refPath, rel, color) => {
                if (!refPath) return;
                const hit = findByPath(refPath);
                if (!hit) return;
                pushEdge(rec.addr, hit.addr, { rel, color, dash: "4 3" });
            };
            link(rec.meta?.flowRef, "catalog_flow", FLOW_EDGE.route);
            link(rec.meta?.launchRef, "catalog_launch", FLOW_EDGE.launch);
            const layers = rec.meta?.json?.layers;
            if (layers && typeof layers === "object") {
                const root = flowerpotRoot || "";
                for (const [layer, paths] of Object.entries(layers)) {
                    if (!Array.isArray(paths)) continue;
                    for (const p of paths) {
                        const hit = findByPath(joinProjectPath(root, p));
                        if (!hit) continue;
                        const isSkin = hit.kind === "skin";
                        pushEdge(rec.addr, hit.addr, {
                            rel: `layer_${layer}`,
                            color: isSkin ? FLOW_EDGE.goal : FLOW_EDGE.config,
                            dash: "4 3",
                        });
                    }
                }
            }
            const entries = rec.meta?.programEntries;
            if (Array.isArray(entries) && entries.length) {
                const root = flowerpotRoot || "";
                for (const p of entries) {
                    if (p.manifest) {
                        link(joinProjectPath(root, p.manifest), "index_manifest", FLOW_EDGE.config);
                    }
                    if (p.flow) {
                        link(joinProjectPath(root, p.flow), "index_flow", FLOW_EDGE.route);
                    }
                    if (p.launch) {
                        link(joinProjectPath(root, p.launch), "index_launch", FLOW_EDGE.launch);
                    }
                }
            }
        });

        // Launch linker → every program boot (+ optional index catalog edge).
        eachRecord((rec) => {
            if (rec.kind !== "linker") return;
            const idxCandidates = [
                joinProjectPath(flowerpotRoot, "data/launch_index.json"),
                "data/launch_index.json",
            ];
            let idxHit = null;
            for (const p of idxCandidates) {
                idxHit = findByPath(p);
                if (idxHit) break;
            }
            if (idxHit) {
                pushEdge(rec.addr, idxHit.addr, {
                    rel: "linker_index",
                    color: FLOW_EDGE.config,
                    dash: "3 3",
                });
            }
            const programs =
                idxHit?.meta?.programEntries ||
                idxHit?.meta?.json?.programs ||
                [];
            for (const prog of programs) {
                if (!prog?.launch) continue;
                const hit = findByPath(
                    joinProjectPath(flowerpotRoot, prog.launch)
                );
                if (!hit) continue;
                pushEdge(rec.addr, hit.addr, {
                    rel: `linker_launch:${prog.id || prog.launch}`,
                    color: FLOW_EDGE.launch,
                    dash: "4 3",
                });
            }
        });

        const opEntries = [];
        eachRecord((rec) => {
            if (rec.kind !== "ops" || !rec.meta?.json) return;
            const j = rec.meta.json;
            if (Array.isArray(j.ops)) {
                for (const entry of j.ops) opEntries.push({ entry, rec });
            }
        });
        for (const { entry, rec } of opEntries) {
            const relPath = String(entry.path || "")
                .replace(/^ti_punch:/, "")
                .replace(/^\/+/, "");
            if (!relPath || relPath.startsWith("devops/")) continue;
            const hit = findByPath(relPath);
            if (!hit) continue;
            pushEdge(rec.addr, hit.addr, {
                rel: entry.goal_id
                    ? `goal:${entry.goal_id}`
                    : `op:${entry.op || "change"}`,
                color: FLOW_EDGE.goal,
                dash: "6 3",
            });
        }

        return {
            nodes,
            edges,
            layout: {
                prefix: LAYOUT_PREFIX,
                bands: FLOW_BAND_ORDER,
                rev: LAYOUT_REV,
            },
        };
    };

    const pluginDef = {
        id: PLUGIN_ID,
        label: "flow model (types + journey edges)",
        description:
            "Classify flow-model artifacts, color nodes by role, draw routes / policy / launch / config links.",
        enabledByDefault: false,
        source: "module",
        layout: {
            prefix: LAYOUT_PREFIX,
            bands: FLOW_BAND_ORDER,
            rev: LAYOUT_REV,
        },
        legend: [
            { id: "flow_route", label: "flow route", color: FLOW_EDGE.route },
            { id: "flow_policy", label: "policy transition", color: FLOW_EDGE.policy },
            { id: "flow_entry", label: "flow entry", color: FLOW_EDGE.entry },
            { id: "flow_launch", label: "launch → flow", color: FLOW_EDGE.launch },
            { id: "flow_config", label: "config link", color: FLOW_EDGE.config },
            { id: "flow_skin", label: "product skin", color: FLOW_EDGE.goal },
            { id: "flow_goal", label: "goal / ops", color: FLOW_EDGE.goal },
            { id: "flow_goal", label: "goal → artifact", color: FLOW_EDGE.goal },
        ],
        contribute,
        styleNode,
        overlayNode,
    };

    const mountPlugin = () => {
        const mgr = resolveManager();
        if (!mgr || typeof mgr.registerPlugin !== "function") {
            if (typeof navi.callout === "function") {
                navi.callout(
                    "[tinyviewport_flowchart] needs tinyviewport_manager mounted first"
                );
            }
            return false;
        }
        try {
            mgr.unregisterPlugin?.(PLUGIN_ID);
        } catch {
            /* ignore */
        }
        unregister = mgr.registerPlugin(pluginDef);
        return true;
    };

    return {
        name: "tinyviewport_flowchart",
        version: VERSION,
        description:
            "Flow-model tinyviewport plugin — artifact typing, labels, journey edges",

        moduleInfo: {
            name: "tinyviewport_flowchart",
            version: VERSION,
            description: "Registers flowchart plugin on tinyviewport_manager",
        },

        warezSubject: WAREZ_SUBJECT,
        warezManifest: WAREZ_MANIFEST,

        /** Called by manager reindex / remount so checkbox returns without remounting us. */
        attachTinyviewportPlugin: () => {
            const ok = mountPlugin();
            if (ok && typeof navi.callout === "function") {
                navi.callout(
                    `[tinyviewport_flowchart] reattach v${VERSION} L${LAYOUT_REV} ${FLOW_BAND_ORDER.join("→")}`
                );
            }
            return ok;
        },

        onMount: async () => {
            if (mountPlugin()) {
                if (typeof navi.callout === "function") {
                    navi.callout(
                        `[tinyviewport_flowchart] v${VERSION} L${LAYOUT_REV} bands ${FLOW_BAND_ORDER.join("→")}`
                    );
                }
            }
        },

        onUnmount: async () => {
            try {
                unregister?.();
            } catch {
                /* ignore */
            }
            unregister = null;
            try {
                resolveManager()?.unregisterPlugin?.(PLUGIN_ID);
            } catch {
                /* ignore */
            }
        },
    };
};
