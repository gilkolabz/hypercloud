/**
 * warez_updater — check live unit mods against hypernetizen/warez (hostpark
 * ib^gib index) and remount outdated ones from their short park path.
 *
 *   warez_updater check              update every outdated mounted mod
 *   warez_updater check <modname>    update one mod if outdated
 *   warez_updater status [modname]   report only (no mount/unmount)
 *   warez_updater help
 *
 * Index + park frames are read from foobarch_host (origin), never flowerpot
 * ?addr=. Pinned catalog gibs use GET /{park}^{gib} Accept: application/eframe
 * so method controls run on that non-tip frame. Remount callin uses tip /{park}.
 */
export const register = (navi) => {
    const VERSION = "0.2.4";
    const WAREZ_TIP = "hypernetizen/warez";

    const splitAddr = (addr) => {
        const a = String(addr || "");
        const i = a.lastIndexOf("^");
        if (i <= 0) return { ib: a, gib: "" };
        return { ib: a.slice(0, i), gib: a.slice(i + 1) };
    };

    const leafName = (pathOrName) => {
        const s = String(pathOrName || "").trim();
        if (!s) return "";
        const base = s.includes("/") ? s.slice(s.lastIndexOf("/") + 1) : s;
        return base.replace(/\.js$/i, "");
    };

    const isShortParkIb = (ib) => {
        const s = String(ib || "").trim();
        return !!s && !s.includes("/") && !s.includes(":");
    };

    const callout = (msg) => {
        if (typeof navi.callout === "function") navi.callout(String(msg ?? ""));
        else console.log(String(msg ?? ""));
    };

    /**
     * Hostpark path URL for ib or ib^gib (encode each segment; ^ → %5E).
     * Uses navi.resolveUrl / origin — not flowerpot.
     */
    const hostPathUrl = (ibPath) => {
        const raw = String(ibPath || "")
            .trim()
            .replace(/^\/+/, "");
        if (!raw) return "";
        const enc = raw
            .split("/")
            .filter(Boolean)
            .map((seg) => encodeURIComponent(seg))
            .join("/");
        if (typeof navi?.resolveUrl === "function") {
            try {
                const u = navi.resolveUrl("/" + enc);
                if (typeof u === "string" && u) return u;
            } catch {
                /* fall through */
            }
        }
        const origin = String(navi?.origin || globalThis.location?.origin || "")
            .replace(/\/+$/, "");
        return origin ? `${origin}/${enc}` : `/${enc}`;
    };

    const parkUrl = (parkIb) => hostPathUrl(parkIb);

    const pinUrl = (parkIb, gib) => {
        const ib = String(parkIb || "").trim().replace(/^\/+/, "");
        const g = String(gib || "").trim();
        if (!ib) return "";
        return g ? hostPathUrl(`${ib}^${g}`) : hostPathUrl(ib);
    };

    /** GET Accept: application/eframe → frame JSON (+ X-Foobarch-ib^gib). */
    const fetchEframeAt = async (ibPath) => {
        const url = hostPathUrl(ibPath);
        if (!url) throw new Error("empty host path");
        const res = await fetch(url, {
            headers: {
                Accept: "application/eframe",
                "X-Navi-Park-Bypass": "1",
            },
            cache: "no-store",
        });
        const text = await res.text();
        if (!res.ok) {
            throw new Error(`${res.status}: ${text.slice(0, 120)} (${url})`);
        }
        let json;
        try {
            json = JSON.parse(text);
        } catch (e) {
            throw new Error(`eframe not JSON: ${e?.message || e}`);
        }
        const tipAddr =
            res.headers.get("x-foobarch-ib^gib") ||
            (json?.ib && json?.gib ? `${json.ib}^${json.gib}` : null);
        return { json, addr: tipAddr, url };
    };

    /**
     * Warez index tip on hostpark (hypernetizen/warez). Frame data.frames[] or
     * tip payload with frames.
     */
    const getWarezTipJson = async () => {
        const { json, addr } = await fetchEframeAt(WAREZ_TIP);
        // eframe is the tip frame; frames list lives on data
        const data =
            json?.data && typeof json.data === "object" ? json.data : json;
        if (Array.isArray(data?.frames)) {
            return { json: data, addr };
        }
        if (Array.isArray(json?.frames)) {
            return { json, addr };
        }
        // Some tips store index as bin — try tip.data only
        return { json: data || json, addr };
    };

    /** Tip-only index: frames[] are hostpark tip ib^gib (short park ibs). */
    const loadWarezIndex = async () => {
        const { json: tip } = await getWarezTipJson();
        const frames = Array.isArray(tip?.frames)
            ? tip.frames.map(String)
            : Array.isArray(tip?.json?.frames)
              ? tip.json.frames.map(String)
              : [];
        return frames.map((frame) => {
            const { ib, gib } = splitAddr(frame);
            return {
                frame,
                parkIb: ib,
                gib,
                leaf: leafName(ib),
                short: isShortParkIb(ib),
            };
        });
    };

    /** Match installed navi.mod key to a warez park ib (exact, then suffix). */
    const matchIndexFrame = (index, modName) => {
        const want = String(modName || "").trim();
        if (!want) return null;
        const lower = want.toLowerCase();
        const exact = index.find(
            (e) =>
                e.parkIb === want ||
                e.parkIb.toLowerCase() === lower ||
                e.leaf === want ||
                e.leaf.toLowerCase() === lower
        );
        if (exact) return exact;
        const cands = index.filter((e) => {
            const leaf = e.leaf || e.parkIb;
            if (!leaf) return false;
            return (
                want.endsWith(`_${leaf}`) ||
                want.endsWith(leaf) ||
                leaf.endsWith(want) ||
                leaf.toLowerCase() === lower
            );
        });
        if (!cands.length) return null;
        if (cands.length === 1) return cands[0];
        cands.sort(
            (a, b) =>
                String(b.leaf || b.parkIb).length -
                String(a.leaf || a.parkIb).length
        );
        return cands[0];
    };

    const entryFromEframe = (frameMeta, tip) => {
        const data =
            tip && tip.data && typeof tip.data === "object" ? tip.data : tip || {};
        const about =
            data.about && typeof data.about === "object" ? data.about : {};
        const parkIb = frameMeta.parkIb || splitAddr(frameMeta.frame).ib;
        const naviName =
            about.navi_name != null
                ? String(about.navi_name)
                : data.module?.name != null
                  ? String(data.module.name)
                  : "";
        return {
            frame: frameMeta.frame,
            parkIb,
            gib: frameMeta.gib || "",
            name: about.name != null ? String(about.name) : parkIb,
            naviName,
            version: about.version != null ? String(about.version) : "",
            warezSubject:
                about.warez_subject != null
                    ? String(about.warez_subject)
                    : "",
            description:
                about.description != null ? String(about.description) : "",
        };
    };

    /**
     * Eframe for index parks we care about. Prefer pinned /{park}^{gib} so the
     * catalogued hostpark frame (not tip-only, not flowerpot ?addr) is read.
     */
    const loadEframesFor = async (index, modNames) => {
        const want = [...new Set(modNames.map(String).filter(Boolean))];
        const framesToFetch = new Map();
        for (const name of want) {
            const hit = matchIndexFrame(index, name);
            if (!hit?.frame || !hit.short) continue;
            if (!framesToFetch.has(hit.parkIb)) {
                framesToFetch.set(hit.parkIb, { meta: hit, hintName: name });
            }
        }
        const catalog = [];
        for (const [parkIb, { meta, hintName }] of framesToFetch) {
            try {
                const path = meta.gib
                    ? `${parkIb}^${meta.gib}`
                    : parkIb;
                const { json: tip } = await fetchEframeAt(path);
                catalog.push(entryFromEframe(meta, tip));
            } catch (err) {
                catalog.push({
                    frame: meta.frame,
                    parkIb,
                    gib: meta.gib || "",
                    name: hintName || parkIb,
                    naviName: "",
                    version: "",
                    warezSubject: "",
                    error: String(err?.message || err),
                });
            }
        }
        return { catalog, probed: framesToFetch.size };
    };

    const liveVersion = (mod) => {
        if (!mod || typeof mod !== "object") return "";
        for (const v of [
            mod.version,
            mod.moduleInfo?.version,
            mod.about?.version,
        ]) {
            if (v != null && String(v) !== "") return String(v);
        }
        return "";
    };

    /** True when warez version is newer than live (or live missing). */
    const isOutdated = (live, warez) => {
        const want = String(warez || "").trim();
        if (!want) return false;
        const have = String(live || "").trim();
        if (!have) return true;
        if (have === want) return false;
        const parse = (v) =>
            String(v)
                .split(/[.+-]/)
                .map((x) => {
                    const n = parseInt(x, 10);
                    return Number.isFinite(n) ? n : 0;
                });
        const a = parse(have);
        const b = parse(want);
        const n = Math.max(a.length, b.length);
        for (let i = 0; i < n; i++) {
            const x = a[i] || 0;
            const y = b[i] || 0;
            if (x < y) return true;
            if (x > y) return false;
        }
        return false;
    };

    const listLiveNames = () => {
        if (typeof navi.listModules === "function") {
            return navi.listModules().map(String);
        }
        return Object.keys(navi.mod || {});
    };

    const listInstalledNames = async () => {
        const live = new Set(listLiveNames());
        try {
            const tipApi = navi.storage?.tip;
            const unitIb =
                navi.entryPlug?.unitIb || navi.callUnitIb || null;
            if (tipApi?.get && unitIb) {
                const tip = await tipApi.get(unitIb);
                const mods = tip?.data?.unit?.mods;
                if (mods && typeof mods === "object") {
                    for (const k of Object.keys(mods)) live.add(String(k));
                }
            }
        } catch {
            /* live registry is enough */
        }
        return [...live].filter(Boolean).sort((a, b) => a.localeCompare(b));
    };

    const findWarezEntry = (catalog, modName) => {
        const want = String(modName || "").trim();
        if (!want) return null;
        const lower = want.toLowerCase();
        for (const e of catalog) {
            if (!e || e.error) continue;
            const keys = [e.naviName, e.name, e.parkIb]
                .map((k) => String(k || "").trim())
                .filter(Boolean);
            if (keys.some((k) => k === want || k.toLowerCase() === lower)) {
                return e;
            }
            if (
                keys.some(
                    (k) =>
                        want.endsWith(`_${k}`) ||
                        want.endsWith(k) ||
                        k.endsWith(want)
                )
            ) {
                return e;
            }
        }
        return null;
    };

    const resolveLiveKey = (entry, preferred) => {
        const keys = [preferred, entry?.naviName, entry?.name, entry?.parkIb]
            .map((k) => String(k || "").trim())
            .filter(Boolean);
        for (const k of keys) {
            if (navi.mod?.[k]) return k;
        }
        return keys[0] || "";
    };

    const mountOk = (msg) => {
        const s = String(msg ?? "");
        return s.length > 0 && !/^error\b/i.test(s);
    };

    /** Unmount live key, then pin hostpark park tip (callin GET /{park}). */
    const remountFromWarez = async (liveKey, parkIb) => {
        const park = String(parkIb || "").trim().replace(/^\/+/, "");
        if (!park) throw new Error("no park ib on warez index");
        const surf = navi.mod?.surf;
        const key = String(liveKey || "").trim();

        if (key && navi.mod?.[key]) {
            if (surf && typeof surf.unmount === "function") {
                const umsg = await surf.unmount(key);
                if (!mountOk(umsg)) {
                    throw new Error(String(umsg || "unmount failed"));
                }
            } else if (typeof navi.unmount === "function") {
                await navi.unmount(navi.mod[key]);
            } else {
                throw new Error("navi.unmount / surf.unmount unavailable");
            }
        }

        if (typeof navi.callin === "function") {
            const msg = await navi.callin({
                path: park,
                method: "GET",
                headers: { "X-Navi-Park-Bypass": "1" },
            });
            return msg != null
                ? String(msg)
                : `[warez_updater] callin ${park}`;
        }
        if (surf && typeof surf.mount === "function") {
            const msg = await surf.mount(park);
            if (!mountOk(msg)) throw new Error(String(msg || "mount failed"));
            return msg;
        }
        if (typeof navi === "function") {
            return await navi(park);
        }
        throw new Error("navi.callin unavailable");
    };

    const assess = (name, catalog) => {
        const entry = findWarezEntry(catalog, name);
        const liveKey = resolveLiveKey(entry, name);
        const mod = liveKey ? navi.mod?.[liveKey] : navi.mod?.[name];
        const live = liveVersion(mod);
        if (!entry || entry.error || !entry.parkIb) {
            return {
                name,
                liveKey: liveKey || name,
                live,
                warez: entry?.version || "",
                parkIb: entry?.parkIb || "",
                state: entry?.error ? "error" : "not_on_warez",
                error: entry?.error || "",
            };
        }
        const outdated = isOutdated(live, entry.version);
        return {
            name: entry.name || name,
            liveKey: liveKey || name,
            live,
            warez: entry.version,
            parkIb: entry.parkIb,
            state: !mod
                ? "not_mounted"
                : outdated
                  ? "outdated"
                  : "current",
        };
    };

    const formatRow = (r) => {
        if (r.state === "error") {
            return `  ! ${r.name} — ${r.error}`;
        }
        if (r.state === "not_on_warez") {
            return `  · ${r.liveKey} v${r.live || "?"} — not on warez`;
        }
        if (r.state === "not_mounted") {
            return `  ○ ${r.liveKey} — warez v${r.warez} (not mounted)`;
        }
        if (r.state === "outdated") {
            return `  ↑ ${r.liveKey} v${r.live || "?"} → v${r.warez} (${r.parkIb})`;
        }
        return `  ✓ ${r.liveKey} v${r.live}`;
    };

    const runCheck = async (opts = {}) => {
        const apply = opts.apply !== false;
        const only = String(opts.only || "").trim();
        const index = await loadWarezIndex();
        const installed = only
            ? [only]
            : await listInstalledNames();
        const { catalog, probed } = await loadEframesFor(index, installed);
        const rows = installed.map((n) => assess(n, catalog));
        const outdated = rows.filter((r) => r.state === "outdated");
        const lines = [
            `warez_updater v${VERSION} — ${apply ? "check" : "status"}` +
                (only ? ` ${only}` : "") +
                ` · index ${index.length} · eframes ${probed}`,
            ...rows.map(formatRow),
        ];

        if (!apply || !outdated.length) {
            const msg = lines.join("\n");
            callout(msg);
            return msg;
        }

        const order = [
            ...outdated.filter((r) => r.liveKey !== "warez_updater"),
            ...outdated.filter((r) => r.liveKey === "warez_updater"),
        ];
        for (const r of order) {
            try {
                const msg = await remountFromWarez(r.liveKey, r.parkIb);
                lines.push(`  remount ${r.liveKey} ← ${r.parkIb}: ${msg}`);
            } catch (err) {
                lines.push(
                    `  remount ${r.liveKey} FAILED: ${err?.message || err}`
                );
            }
        }
        const msg = lines.join("\n");
        callout(msg);
        return msg;
    };

    const helpText = () =>
        [
            `warez_updater v${VERSION}`,
            "  check [mod]   — remount outdated mounted mods from hostpark /{park}",
            "  status [mod]  — report only",
            "  help",
            "",
            "Index: GET /hypernetizen/warez (eframe). Parks: GET /{park}^{gib} (eframe).",
            "Never flowerpot ?addr=.",
        ].join("\n");

    const execute = async (...args) => {
        const tokens = args.map(String).filter(Boolean);
        const cmd = (tokens[0] || "help").toLowerCase();
        if (cmd === "help" || cmd === "-h" || cmd === "--help") {
            return helpText();
        }
        if (cmd === "status") {
            return await runCheck({
                apply: false,
                only: tokens.slice(1).join(" ").trim(),
            });
        }
        if (cmd === "check") {
            return await runCheck({
                apply: true,
                only: tokens.slice(1).join(" ").trim(),
            });
        }
        return `Unknown: ${cmd}. Type 'warez_updater help'.`;
    };

    const dropdownLeaf = {
        id: "warez_updater_check",
        label: "warez_updater-check",
        title: "Compare mounted mods with hypernetizen/warez; remount outdated",
        action: async () => {
            try {
                callout("[warez_updater] check…");
                await execute("check");
            } catch (err) {
                callout(
                    `[warez_updater] check failed: ${err?.message || err}`
                );
            }
        },
    };

    let unrootDropdown = null;
    let dropdownMountHandler = null;
    let retryTimer = null;

    const resolveDropdown = () => navi?.mod?.supermouse_plugin_dropdown || null;

    const unhookDropdown = () => {
        if (typeof unrootDropdown === "function") {
            try {
                unrootDropdown();
            } catch {
                /* ok */
            }
        }
        unrootDropdown = null;
    };

    const tryRegisterDropdown = () => {
        const dd = resolveDropdown();
        if (!dd || typeof dd.registerRootMenu !== "function") return false;
        if (unrootDropdown) return true;
        unrootDropdown = dd.registerRootMenu(dropdownLeaf);
        return true;
    };

    const stopRetry = () => {
        if (retryTimer) clearInterval(retryTimer);
        retryTimer = null;
    };

    return {
        name: "warez_updater",
        version: VERSION,
        description:
            "Check mounted mods against hostpark warez index; remount outdated parks",

        moduleInfo: {
            name: "warez_updater",
            version: VERSION,
            description:
                "warez_updater check [mod] — hostpark /{park}^{gib} eframes; callin /{park}",
        },

        commands: {
            warez_updater: {
                name: "warez_updater",
                execute,
                help: helpText,
            },
        },

        onMount: async () => {
            const hooked = tryRegisterDropdown();
            if (!hooked) {
                retryTimer = setInterval(() => {
                    if (tryRegisterDropdown()) stopRetry();
                }, 400);
                setTimeout(stopRetry, 15000);
            }
            if (typeof navi?.on === "function") {
                dropdownMountHandler = (msg) => {
                    if (msg?.kind === "mount" || msg?.kind === "unmount") {
                        unhookDropdown();
                        tryRegisterDropdown();
                    }
                };
                navi.on("supermouse_plugin_dropdown", dropdownMountHandler);
            }
            if (typeof navi.callout === "function") {
                navi.callout(
                    `[warez_updater] v${VERSION} — hostpark /{park}^{gib} · ` +
                        (hooked
                            ? "dropdown ▸ warez_updater-check"
                            : "waiting for supermouse_plugin_dropdown")
                );
            }
        },

        onUnmount: () => {
            stopRetry();
            if (dropdownMountHandler && typeof navi?.off === "function") {
                navi.off("supermouse_plugin_dropdown", dropdownMountHandler);
            }
            dropdownMountHandler = null;
            unhookDropdown();
        },
    };
};
