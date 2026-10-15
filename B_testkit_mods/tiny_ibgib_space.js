/**
 * tiny_ibgib_space — local ibgib space on navi.storage, using globalThis.tsgib.
 *
 * Depends on @ibgib/ts-gib (https://gitlab.com/ibgib/ts-gib): low-level ibgib
 * graph primitives (frames, mut8/rel8/fork, dna). A browser-global build is
 * vendored as a flowerpot mirror at
 * flowerpot/hypercloud/testkit/vendor/tsgib.min.js and loaded on init via
 * navi.mount (classic IIFE → globalThis.tsgib).
 *
 * Flowerpot-free space: frames by addr, optional tip by tjp (or ib fallback).
 * No routes, policies, asides, or flowerpot bin packing.
 *
 *   mount hypercloud/testkit/mods/legacy/tiny_ibgib_space.js
 *   tiny help | create | mut8 | get | tip | list | index | unique | lineage
 *       | delete | clear | status
 */
export const register = (navi) => {
    /** @deprecated legacy item/shim keys — read/migrate only, never write */
    const LEGACY_FRAME_PREFIX = "navi:ibgib:frame:";
    const LEGACY_TIP_PREFIX = "navi:ibgib:tip:";
    const TSGIB_VENDOR_ROUTE = "flowerpot/hypercloud/testkit/vendor/tsgib.min.js";

    let tsgibReady = null;

    function lib() {
        const g = globalThis.tsgib;
        if (!g || !g.V1 || !g.getIbGibAddr) {
            throw new Error(
                "[tiny_ibgib_space] globalThis.tsgib missing — vendor load failed or not finished"
            );
        }
        return g;
    }

    /**
     * Ensure globalThis.tsgib exists by navi.mount'ing the vendored IIFE.
     * Idempotent.
     */
    async function ensureTsgib() {
        if (globalThis.tsgib?.V1?.Factory_V1) return globalThis.tsgib;
        if (tsgibReady) return tsgibReady;
        tsgibReady = (async () => {
            const url =
                typeof navi.resolveUrl === "function"
                    ? navi.resolveUrl(TSGIB_VENDOR_ROUTE)
                    : `/${TSGIB_VENDOR_ROUTE}`;
            const res = await fetch(url);
            const code = await res.text();
            if (!res.ok) {
                throw new Error(
                    `[tiny_ibgib_space] GET ${TSGIB_VENDOR_ROUTE} → ${res.status}: ${code.slice(0, 120)}`
                );
            }
            // IIFE assigns globalThis.tsgib (footer in the esbuild bundle).
            await navi.mount(code);
            if (!globalThis.tsgib?.V1) {
                throw new Error(
                    "[tiny_ibgib_space] navi.mount ran vendor but globalThis.tsgib was not set"
                );
            }
            return globalThis.tsgib;
        })().catch((err) => {
            tsgibReady = null;
            throw err;
        });
        return tsgibReady;
    }

    function tipApi() {
        const tip = navi.storage?.tip;
        if (!tip || typeof tip.get !== "function" || typeof tip.set !== "function") {
            throw new Error(
                "navi.storage.tip unavailable — update navi_shell"
            );
        }
        return tip;
    }

    function addrOf(ibGib) {
        return lib().getIbGibAddr({ ibGib });
    }

    function tjpKey(ibGib) {
        const tjp = ibGib?.rel8ns?.tjp;
        if (Array.isArray(tjp) && tjp[0]) return String(tjp[0]);
        return addrOf(ibGib);
    }

    function stripGib(raw) {
        const s = String(raw || "");
        const caret = s.indexOf("^");
        return caret > 0 ? s.slice(0, caret) : s;
    }

    function frameAddr(frame) {
        if (!frame || typeof frame !== "object") return "";
        const ib = String(frame.ib || "").trim();
        const gib = String(frame.gib || "").trim();
        if (ib && gib) return `${ib}^${gib}`;
        try {
            return addrOf(frame);
        } catch {
            return "";
        }
    }

    function isCascadeFrame(frame) {
        if (!frame || typeof frame !== "object") return false;
        if (String(frame?.data?.source || "") === "cascade") return true;
        const c = frame?.rel8ns?.cascade_of;
        return Array.isArray(c) && c.length > 0;
    }

    function isLegacyWrapperIb(ib) {
        const s = String(ib || "");
        return (
            s.startsWith(LEGACY_TIP_PREFIX) || s.startsWith(LEGACY_FRAME_PREFIX)
        );
    }

    async function putFrame(ibGib) {
        if (!ibGib || ibGib.ib == null) {
            throw new Error("putFrame requires ibGib with ib");
        }
        const tip = tipApi();
        const gib = String(ibGib.gib || "").trim();
        if (!gib) {
            throw new Error("putFrame requires ibGib.gib");
        }
        const addr = frameAddr(ibGib) || addrOf(ibGib);
        if (typeof tip.frame?.put !== "function") {
            throw new Error("navi.storage.tip.frame.put unavailable");
        }
        await tip.frame.put(ibGib);
        return addr;
    }

    async function putTransformResult(result) {
        const all = [];
        if (result?.newIbGib) all.push(result.newIbGib);
        if (Array.isArray(result?.intermediateIbGibs)) {
            all.push(...result.intermediateIbGibs);
        }
        if (Array.isArray(result?.dnas)) all.push(...result.dnas);
        const addrs = [];
        for (const frame of all) {
            if (frame && frame.ib != null) addrs.push(await putFrame(frame));
        }
        return { head: result?.newIbGib || null, addrs };
    }

    async function getFrame(addr) {
        const a = String(addr || "").trim();
        if (!a) return null;
        const tip = tipApi();
        if (typeof tip.frame?.get === "function") {
            const hit = await tip.frame.get(a);
            if (hit && typeof hit === "object") return hit;
        }
        // Migrate legacy shim tip that held the frame in data.value
        const legacyTip = await tip.get(LEGACY_FRAME_PREFIX + a);
        const legacyVal = legacyTip?.data?.value;
        if (legacyVal && typeof legacyVal === "object" && legacyVal.ib != null) {
            try {
                if (legacyVal.gib) await tip.frame.put(legacyVal);
            } catch {
                /* best-effort */
            }
            return legacyVal;
        }
        return null;
    }

    /**
     * Point tip at addr. Tip ib is the frame's ib (no navi:ibgib:tip: wrapper).
     * key may be the tip ib or a tjp addr; only frame.ib becomes the tip key.
     */
    async function setTip(key, addr) {
        const a = String(addr || "").trim();
        if (!a) throw new Error("tip addr required");
        const frame = await getFrame(a);
        if (!frame) throw new Error(`unknown addr ${a}`);
        await tipApi().set(frame);
        return a;
    }

    async function migrateLegacyTipPointer(key) {
        const k = String(key || "").trim();
        if (!k || k.includes("^")) return null;
        const tip = tipApi();
        const legacyTip = await tip.get(LEGACY_TIP_PREFIX + k);
        const raw = legacyTip?.data?.value;
        const addr =
            typeof raw === "string" && raw.includes("^")
                ? raw
                : frameAddr(raw);
        if (!addr) return null;
        const frame = await getFrame(addr);
        if (!frame) return null;
        if (String(frame.ib || "") === k) {
            await tip.set(frame);
        }
        try {
            if (typeof tip.del === "function") await tip.del(LEGACY_TIP_PREFIX + k);
        } catch {
            /* best-effort drop wrapper tip */
        }
        return addr;
    }

    async function getTip(key) {
        const k = String(key || "").trim();
        if (!k) return null;
        const tip = tipApi();
        const live = await tip.get(k);
        if (live && typeof live === "object") {
            const addr = frameAddr(live);
            if (addr) return addr;
        }
        return migrateLegacyTipPointer(k);
    }

    async function create({ ib, data, rel8ns } = {}) {
        await ensureTsgib();
        const { V1 } = lib();
        const { Factory_V1 } = V1;
        const result = await Factory_V1.firstGen({
            ib: ib || "ib",
            data: data && typeof data === "object" ? data : undefined,
            rel8ns: rel8ns && typeof rel8ns === "object" ? rel8ns : undefined,
            dna: true,
            nCounter: true,
            tjp: { uuid: true, timestamp: true },
            linkedRel8ns: [V1.Rel8n?.past, V1.Rel8n?.ancestor, V1.Rel8n?.dna].filter(
                Boolean
            ),
        });
        const stored = await putTransformResult(result);
        const head = stored.head;
        const addr = addrOf(head);
        await setTip(tjpKey(head), addr);
        await setTip(head.ib, addr);
        return { addr, ibGib: head, tjp: tjpKey(head) };
    }

    async function mut8Data(addr, dataToAddOrPatch, dataToRemove, opts = {}) {
        await ensureTsgib();
        const { V1 } = lib();
        const src = await getFrame(addr);
        if (!src) throw new Error(`unknown addr ${addr}`);
        const result = await V1.mut8({
            src,
            dataToAddOrPatch:
                dataToAddOrPatch && typeof dataToAddOrPatch === "object"
                    ? dataToAddOrPatch
                    : undefined,
            dataToRemove:
                dataToRemove && typeof dataToRemove === "object"
                    ? dataToRemove
                    : undefined,
            dna: true,
            nCounter: true,
            linkedRel8ns: [V1.Rel8n?.past, V1.Rel8n?.dna].filter(Boolean),
        });
        const stored = await putTransformResult(result);
        const head = stored.head;
        const newAddr = addrOf(head);
        const updateTip = opts.updateTip !== false;
        if (updateTip) {
            await setTip(tjpKey(head), newAddr);
            await setTip(head.ib, newAddr);
        }
        return { addr: newAddr, ibGib: head, tjp: tjpKey(head) };
    }

    /**
     * Add/remove custom rel8ns (ib^gib addrs). Custom names are linked
     * (latest-only) together with past/dna unless opts.linkedRel8ns given.
     * opts.updateTip === false → store the new frame without moving the tip
     * (used for cascade snapshots that must not author the tip past line).
     */
    async function rel8Addrs(addr, rel8nsToAddByAddr, opts = {}) {
        await ensureTsgib();
        const { V1 } = lib();
        const src = await getFrame(addr);
        if (!src) throw new Error(`unknown addr ${addr}`);
        const add =
            rel8nsToAddByAddr && typeof rel8nsToAddByAddr === "object"
                ? rel8nsToAddByAddr
                : undefined;
        const remove =
            opts.rel8nsToRemoveByAddr &&
            typeof opts.rel8nsToRemoveByAddr === "object"
                ? opts.rel8nsToRemoveByAddr
                : undefined;
        if (!add && !remove) {
            throw new Error("rel8 requires rel8nsToAddByAddr and/or rel8nsToRemoveByAddr");
        }
        const linkedRel8ns = Array.isArray(opts.linkedRel8ns)
            ? opts.linkedRel8ns.map(String)
            : [
                  V1.Rel8n?.past,
                  V1.Rel8n?.dna,
                  ...Object.keys(add || {}),
                  ...Object.keys(remove || {}),
              ].filter(Boolean);
        const result = await V1.rel8({
            src,
            rel8nsToAddByAddr: add,
            rel8nsToRemoveByAddr: remove,
            dna: true,
            linkedRel8ns: [...new Set(linkedRel8ns)],
        });
        const stored = await putTransformResult(result);
        const head = stored.head;
        const newAddr = addrOf(head);
        const updateTip = opts.updateTip !== false;
        if (updateTip) {
            await setTip(tjpKey(head), newAddr);
            await setTip(head.ib, newAddr);
        }
        return { addr: newAddr, ibGib: head, tjp: tjpKey(head) };
    }

    // ─── Index / unique / lineage / delete / clear ───────────────────────────

    /**
     * @param {string} [prefix] filter tip ibs / frame addrs
     * @returns {Promise<{ frames: string[], tips: string[] }>}
     */
    async function listIndex(prefix = "") {
        const tip = tipApi();
        const p = String(prefix || "").trim();
        const rawTips = ((await tip.list()) || []).map(String);

        // Migrate legacy navi:ibgib:tip:<ib> wrappers when listing.
        for (const ib of rawTips) {
            if (!ib.startsWith(LEGACY_TIP_PREFIX)) continue;
            const key = ib.slice(LEGACY_TIP_PREFIX.length);
            if (p && key !== p && !key.startsWith(p)) continue;
            try {
                await migrateLegacyTipPointer(key);
            } catch {
                /* best-effort */
            }
        }

        let tips = ((await tip.list()) || [])
            .map(String)
            .filter((ib) => !isLegacyWrapperIb(ib));
        if (p) {
            tips = tips.filter((ib) => ib === p || ib.startsWith(p));
        }

        const frameSet = new Set();
        if (typeof tip.frame?.list === "function") {
            if (p) {
                for (const ib of tips) {
                    for (const addr of (await tip.frame.list(ib)) || []) {
                        frameSet.add(String(addr));
                    }
                }
                for (const addr of (await tip.frame.list()) || []) {
                    const a = String(addr);
                    if (
                        a === p ||
                        a.startsWith(p + "^") ||
                        stripGib(a) === p ||
                        stripGib(a).startsWith(p + ":") ||
                        stripGib(a).startsWith(p)
                    ) {
                        frameSet.add(a);
                    }
                }
            } else {
                for (const addr of (await tip.frame.list()) || []) {
                    frameSet.add(String(addr));
                }
            }
        }

        return {
            frames: [...frameSet].sort(),
            tips: [...new Set(tips)].sort(),
        };
    }

    /**
     * Unique tip ibs / frame ibs under optional prefix.
     * @param {"ibs"|"tips"|"addrs"|"all"} kind
     * @param {string} [prefix]
     */
    async function unique(kind = "ibs", prefix = "") {
        const { frames, tips } = await listIndex(prefix);
        const k = String(kind || "ibs").toLowerCase();
        if (k === "tips") {
            return { kind: "tips", values: [...new Set(tips)].sort() };
        }
        if (k === "addrs" || k === "frames") {
            return { kind: "addrs", values: [...new Set(frames)].sort() };
        }
        const ibs = new Set(tips.map(stripGib));
        for (const addr of frames) ibs.add(stripGib(addr));
        if (k === "all") {
            return {
                kind: "all",
                ibs: [...ibs].filter(Boolean).sort(),
                tips: [...new Set(tips)].sort(),
                addrs: [...new Set(frames)].sort(),
            };
        }
        return { kind: "ibs", values: [...ibs].filter(Boolean).sort() };
    }

    /**
     * Walk past from tip (or addr). opts.directOnly skips cascade frames in the
     * returned list (still walks through them).
     * @param {string} tipOrIb
     * @param {{ directOnly?: boolean, fromAddr?: string }} [opts]
     */
    async function lineage(tipOrIb, opts = {}) {
        const key = String(tipOrIb || "").trim();
        let addr =
            opts.fromAddr != null
                ? String(opts.fromAddr)
                : (await getTip(key)) || (key.includes("^") ? key : "");
        if (!addr && key) addr = (await getTip(key)) || "";
        const versions = [];
        const seen = new Set();
        while (addr && !seen.has(addr)) {
            seen.add(addr);
            const frame = await getFrame(addr);
            if (!frame) break;
            const cascade = isCascadeFrame(frame);
            if (!opts.directOnly || !cascade) {
                versions.push({ addr, frame, cascade });
            }
            const past = frame?.rel8ns?.past;
            addr = Array.isArray(past) && past[0] ? String(past[0]) : "";
        }
        versions.reverse();
        return {
            ib: key,
            tip: opts.fromAddr ? null : await getTip(key),
            versions,
            count: versions.length,
        };
    }

    /**
     * Rich index for a base ib (viewport-shaped).
     * @param {string} baseIb
     */
    async function indexUnder(baseIb) {
        const base = String(baseIb || "").trim();
        if (!base) throw new Error("base ib required");
        const { frames, tips } = await listIndex(base);
        const leafTips = tips.filter(
            (ib) => ib !== base && ib.startsWith(base + ":")
        );
        const tipAddr = await getTip(base);
        const direct = tipAddr
            ? await lineage(base, { directOnly: true, fromAddr: tipAddr })
            : { versions: [], tip: null, count: 0 };
        const cascadeSnapshots = [];
        for (const addr of frames) {
            const frame = await getFrame(addr);
            if (!frame || !isCascadeFrame(frame)) continue;
            const c = frame?.rel8ns?.cascade_of;
            if (!Array.isArray(c) || !c.length) continue;
            // Only frames whose ib is exactly base (main column cascades)
            if (stripGib(frame.ib || addr) !== base) continue;
            cascadeSnapshots.push({ addr, frame });
        }
        return {
            baseIb: base,
            frames,
            tips,
            leafTips,
            tipAddr,
            directLineage: direct.versions,
            cascadeSnapshots,
            unique: await unique("all", base),
        };
    }

    async function deleteFrame(addr) {
        const a = String(addr || "").trim();
        if (!a) throw new Error("addr required");
        const tip = tipApi();
        if (typeof tip.frame?.del === "function") {
            await tip.frame.del(a);
        }
        // Drop legacy wrapper tip if present
        try {
            if (typeof tip.del === "function") {
                await tip.del(LEGACY_FRAME_PREFIX + a);
            }
        } catch {
            /* ignore */
        }
        return { deleted: "frame", addr: a };
    }

    async function deleteTip(key) {
        const k = String(key || "").trim();
        if (!k) throw new Error("tip key required");
        const tip = tipApi();
        if (typeof tip.del === "function") {
            await tip.del(k);
        }
        try {
            if (typeof tip.del === "function") {
                await tip.del(LEGACY_TIP_PREFIX + k);
            }
        } catch {
            /* ignore */
        }
        return { deleted: "tip", key: k };
    }

    /**
     * Delete tip pointer(s) + all frames for this ib (past walk + same-ib frames).
     * Also clears leaf tips under baseIb:… when clearing a base.
     */
    async function clearLineage(ib, opts = {}) {
        const key = String(ib || "").trim();
        if (!key) throw new Error("ib required");
        const includeLeaves = opts.includeLeaves !== false;
        const tip = tipApi();
        const { frames, tips } = await listIndex(key);
        const toDeleteFrames = new Set();
        const tipAddr = await getTip(key);
        if (tipAddr) {
            const lin = await lineage(key, { fromAddr: tipAddr });
            for (const v of lin.versions) toDeleteFrames.add(v.addr);
            const all = await lineage(key, {
                fromAddr: tipAddr,
                directOnly: false,
            });
            for (const v of all.versions) toDeleteFrames.add(v.addr);
        }
        for (const addr of frames) {
            if (stripGib(addr) === key || addr.startsWith(key + "^")) {
                toDeleteFrames.add(addr);
            }
        }
        const tipKeys = new Set([key]);
        for (const t of tips) {
            if (t === key || (includeLeaves && t.startsWith(key + ":"))) {
                tipKeys.add(t);
            }
        }
        for (const t of tips) {
            const v = await getTip(t);
            if (v && toDeleteFrames.has(v)) tipKeys.add(t);
        }

        const deletedFrames = [];
        for (const addr of toDeleteFrames) {
            await deleteFrame(addr);
            deletedFrames.push(addr);
        }
        const deletedTips = [];
        for (const t of tipKeys) {
            if (typeof tip.del === "function") await tip.del(t);
            deletedTips.push(t);
            if (includeLeaves) {
                const leafFrames = (await listIndex(t)).frames;
                for (const addr of leafFrames) {
                    if (toDeleteFrames.has(addr)) continue;
                    await deleteFrame(addr);
                    deletedFrames.push(addr);
                }
            }
        }
        return {
            ib: key,
            deletedFrames: [...new Set(deletedFrames)],
            deletedTips: [...new Set(deletedTips)],
            frameCount: [...new Set(deletedFrames)].length,
            tipCount: [...new Set(deletedTips)].length,
        };
    }

    async function clearPrefix(prefix) {
        const p = String(prefix || "").trim();
        if (!p) throw new Error("prefix required (use clear all for everything)");
        const tip = tipApi();
        const { frames, tips } = await listIndex(p);
        for (const addr of frames) await deleteFrame(addr);
        for (const t of tips) {
            if (typeof tip.del === "function") await tip.del(t);
        }
        // Sweep leftover legacy wrappers under this prefix
        for (const ib of (await tip.list()) || []) {
            const s = String(ib);
            if (
                s.startsWith(LEGACY_TIP_PREFIX + p) ||
                s.startsWith(LEGACY_FRAME_PREFIX + p)
            ) {
                try {
                    await tip.del(s);
                } catch {
                    /* ignore */
                }
            }
        }
        return {
            prefix: p,
            deletedFrames: frames,
            deletedTips: tips,
            frameCount: frames.length,
            tipCount: tips.length,
        };
    }

    /**
     * Wipe jockey tiny tips + any leftover legacy ibgib:tip/frame wrappers.
     * Matches: htmf:/jockey:htmf: prefixes, or tip frames whose parts include
     * htmf / tiny-clone. Does not delete unrelated tips (snoopy, navi:mod, …).
     */
    async function clearAll() {
        const tip = tipApi();
        const deletedTips = [];
        const deletedFrames = [];
        const all = ((await tip.list()) || []).map(String);
        const isTinyParts = (parts) => {
            if (!Array.isArray(parts)) return false;
            return (
                parts.includes("htmf") ||
                parts.includes("tiny-clone") ||
                parts.includes("html_fragment")
            );
        };
        for (const ib of all) {
            let wipe =
                ib.startsWith("htmf:") ||
                ib.startsWith("jockey:htmf:") ||
                ib.startsWith(LEGACY_TIP_PREFIX) ||
                ib.startsWith(LEGACY_FRAME_PREFIX);
            if (!wipe) {
                try {
                    const frame = await tip.get(ib);
                    wipe = isTinyParts(frame?.data?.parts);
                } catch {
                    wipe = false;
                }
            }
            if (!wipe) continue;
            const frames = ((await tip.frame?.list?.(ib)) || []).map(String);
            deletedFrames.push(...frames);
            if (typeof tip.del === "function") await tip.del(ib);
            deletedTips.push(ib);
        }
        for (const addr of (await tip.frame?.list?.()) || []) {
            const a = String(addr);
            const ibPart = stripGib(a);
            let wipe =
                ibPart.startsWith("htmf:") ||
                ibPart.startsWith("jockey:htmf:");
            if (!wipe) {
                try {
                    const frame = await tip.frame?.get?.(a);
                    wipe = isTinyParts(frame?.data?.parts);
                } catch {
                    wipe = false;
                }
            }
            if (!wipe) continue;
            await deleteFrame(a);
            deletedFrames.push(a);
        }
        return {
            deletedFrames: [...new Set(deletedFrames)],
            deletedTips: [...new Set(deletedTips)],
            frameCount: [...new Set(deletedFrames)].length,
            tipCount: [...new Set(deletedTips)].length,
        };
    }

    function parseJsonArg(raw, label) {
        if (raw == null || raw === "") return undefined;
        try {
            return JSON.parse(raw);
        } catch (e) {
            throw new Error(`${label} must be JSON: ${e.message || e}`);
        }
    }

    const HELP = [
        "tiny_ibgib_space — local ibgib space on navi.storage.tip",
        "",
        "  tiny status",
        "  tiny create <ib> [json-data]",
        "  tiny mut8 <addr> <json-dataToAddOrPatch>",
        "  tiny rel8 <addr> <json-rel8nsToAddByAddr>",
        "  tiny get <addr>",
        "  tiny tip <tjp-or-ib>",
        "  tiny set-tip <tjp-or-ib> <addr>",
        "",
        "  tiny list [prefix]              frames + tips (optional prefix)",
        "  tiny index [prefix|ib]          rich index (uniques + under-ib board)",
        "  tiny unique ibs|tips|addrs|all [prefix]",
        "  tiny lineage <ib> [--direct]    walk past from tip (skip cascades if --direct)",
        "",
        "  tiny delete frame <addr>",
        "  tiny delete tip <ib>",
        "  tiny clear lineage <ib>         tip + frames for ib (+ leaf :… by default)",
        "  tiny clear prefix <prefix>      frames/tips matching prefix",
        "  tiny clear all --yes            wipe htmf/tiny-clone tips (+ legacy htmf: / jockey:htmf:)",
        "",
        "Tips save as bare tip ibs via navi.storage.tip (no navi:ibgib:tip: prefix).",
        `Uses @ibgib/ts-gib (https://gitlab.com/ibgib/ts-gib) — low-level ibgib`,
        "graph primitives (frames, mut8/rel8/fork, dna). A browser-global build is",
        `vendored as a mirror at ${TSGIB_VENDOR_ROUTE} and loaded on init.`,
    ].join("\n");

    const run = async (...rawArgs) => {
        const args =
            rawArgs.length === 1 && typeof rawArgs[0] === "string"
                ? String(rawArgs[0]).trim().split(/\s+/).filter(Boolean)
                : rawArgs.map(String).filter(Boolean);
        const verb = String(args[0] || "help").toLowerCase();

        if (verb === "help" || verb === "-h") return HELP;

        if (verb === "status") {
            let ok = false;
            try {
                await ensureTsgib();
                lib();
                ok = true;
            } catch {
                ok = false;
            }
            let counts = null;
            try {
                const idx = await listIndex("");
                counts = {
                    frames: idx.frames.length,
                    tips: idx.tips.length,
                };
            } catch {
                /* list may be unavailable */
            }
            return JSON.stringify(
                {
                    tsgib: ok,
                    vendor: TSGIB_VENDOR_ROUTE,
                    frame_prefix: "(none — navi.storage.tip.frame)",
                    tip_prefix: "(none — navi.storage.tip by ib)",
                    legacy_frame_prefix: LEGACY_FRAME_PREFIX,
                    legacy_tip_prefix: LEGACY_TIP_PREFIX,
                    counts,
                },
                null,
                2
            );
        }

        const needsLib = new Set([
            "create",
            "mut8",
            "rel8",
            "get",
            "tip",
            "set-tip",
            "set_tip",
            "lineage",
            "index",
        ]);
        if (needsLib.has(verb)) await ensureTsgib();

        if (verb === "create") {
            const ib = args[1];
            if (!ib) return "Usage: tiny create <ib> [json-data]";
            const data = parseJsonArg(args.slice(2).join(" "), "data");
            const out = await create({ ib, data });
            return JSON.stringify(out, null, 2);
        }

        if (verb === "mut8") {
            const addr = args[1];
            const patchRaw = args.slice(2).join(" ");
            if (!addr || !patchRaw) {
                return "Usage: tiny mut8 <addr> <json-dataToAddOrPatch>";
            }
            const patch = parseJsonArg(patchRaw, "patch");
            const out = await mut8Data(addr, patch);
            return JSON.stringify(out, null, 2);
        }

        if (verb === "rel8") {
            const addr = args[1];
            const addRaw = args.slice(2).join(" ");
            if (!addr || !addRaw) {
                return "Usage: tiny rel8 <addr> <json-rel8nsToAddByAddr>";
            }
            const add = parseJsonArg(addRaw, "rel8nsToAddByAddr");
            const out = await rel8Addrs(addr, add);
            return JSON.stringify(out, null, 2);
        }

        if (verb === "get") {
            const addr = args[1];
            if (!addr) return "Usage: tiny get <addr>";
            const frame = await getFrame(addr);
            if (!frame) return `not found: ${addr}`;
            return JSON.stringify(frame, null, 2);
        }

        if (verb === "tip") {
            const key = args[1];
            if (!key) return "Usage: tiny tip <tjp-or-ib>";
            const tip = await getTip(key);
            if (!tip) return `no tip for ${key}`;
            const frame = await getFrame(tip);
            return JSON.stringify({ key, addr: tip, ibGib: frame }, null, 2);
        }

        if (verb === "set-tip" || verb === "set_tip") {
            const key = args[1];
            const addr = args[2];
            if (!key || !addr) return "Usage: tiny set-tip <tjp-or-ib> <addr>";
            await setTip(key, addr);
            return `tip ${key} → ${addr}`;
        }

        if (verb === "list") {
            const prefix = args[1] || "";
            const out = await listIndex(prefix);
            return JSON.stringify(out, null, 2);
        }

        if (verb === "index") {
            const prefix = args[1] || "";
            if (prefix) {
                const under = await indexUnder(prefix);
                return JSON.stringify(
                    {
                        ...under,
                        directLineage: under.directLineage.map((v) => ({
                            addr: v.addr,
                            n: v.frame?.data?.n,
                            cascade: v.cascade,
                        })),
                        cascadeSnapshots: under.cascadeSnapshots.map((v) => ({
                            addr: v.addr,
                            cascade_of: v.frame?.rel8ns?.cascade_of,
                            mutation_of: v.frame?.rel8ns?.mutation_of,
                        })),
                    },
                    null,
                    2
                );
            }
            const idx = await listIndex("");
            const u = await unique("all", "");
            return JSON.stringify(
                {
                    frameCount: idx.frames.length,
                    tipCount: idx.tips.length,
                    unique: u,
                },
                null,
                2
            );
        }

        if (verb === "unique") {
            const kind = args[1] || "ibs";
            const prefix = args[2] || "";
            if (!["ibs", "tips", "addrs", "frames", "all"].includes(kind)) {
                return "Usage: tiny unique ibs|tips|addrs|all [prefix]";
            }
            return JSON.stringify(await unique(kind, prefix), null, 2);
        }

        if (verb === "lineage") {
            const ib = args[1];
            if (!ib) return "Usage: tiny lineage <ib> [--direct]";
            const directOnly = args.includes("--direct") || args.includes("-d");
            const out = await lineage(ib, { directOnly });
            return JSON.stringify(
                {
                    ib: out.ib,
                    tip: out.tip,
                    count: out.count,
                    versions: out.versions.map((v) => ({
                        addr: v.addr,
                        n: v.frame?.data?.n,
                        source: v.frame?.data?.source,
                        cascade: v.cascade,
                    })),
                },
                null,
                2
            );
        }

        if (verb === "delete" || verb === "del" || verb === "rm") {
            const what = String(args[1] || "").toLowerCase();
            const target = args[2];
            if ((what === "frame" || what === "addr") && target) {
                return JSON.stringify(await deleteFrame(target), null, 2);
            }
            if (what === "tip" && target) {
                return JSON.stringify(await deleteTip(target), null, 2);
            }
            return "Usage: tiny delete frame <addr> | tiny delete tip <ib>";
        }

        if (verb === "clear") {
            const what = String(args[1] || "").toLowerCase();
            if (what === "lineage") {
                const ib = args[2];
                if (!ib) return "Usage: tiny clear lineage <ib>";
                return JSON.stringify(await clearLineage(ib), null, 2);
            }
            if (what === "prefix") {
                const prefix = args[2];
                if (!prefix) return "Usage: tiny clear prefix <prefix>";
                return JSON.stringify(await clearPrefix(prefix), null, 2);
            }
            if (what === "all") {
                if (!args.includes("--yes") && !args.includes("-y")) {
                    return "Refusing: tiny clear all requires --yes";
                }
                return JSON.stringify(await clearAll(), null, 2);
            }
            return "Usage: tiny clear lineage <ib> | prefix <p> | all --yes";
        }

        return `unknown: ${verb}\n\n${HELP}`;
    };

    const space = {
        create,
        mut8: mut8Data,
        rel8: rel8Addrs,
        get: getFrame,
        put: putFrame,
        tip: getTip,
        setTip,
        addrOf,
        lib,
        ensureTsgib,
        vendorRoute: TSGIB_VENDOR_ROUTE,
        FRAME_PREFIX: LEGACY_FRAME_PREFIX,
        TIP_PREFIX: "",
        LEGACY_FRAME_PREFIX,
        LEGACY_TIP_PREFIX,
        isCascadeFrame,
        listIndex,
        unique,
        lineage,
        indexUnder,
        deleteFrame,
        deleteTip,
        clearLineage,
        clearPrefix,
        clearAll,
    };

    return {
        name: "tiny_ibgib_space",
        version: "1.2.2",
        description:
            "Local ibgib space on navi.storage.tip (no navi:ibgib:tip: wrapper)",
        moduleInfo: {
            name: "tiny_ibgib_space",
            version: "1.2.2",
            description:
                "clearAll wipes htmf/tiny-clone parts + legacy htmf:/jockey:htmf:",
        },
        space,
        commands: {
            tiny: {
                name: "tiny",
                description:
                    "tiny create|mut8|rel8|get|tip|list|index|unique|lineage|delete|clear|status|help",
                execute: async (...args) => run(...args),
            },
        },
        onMount: async () => {
            try {
                await ensureTsgib();
                console.log(
                    `[tiny_ibgib_space] ready (tsgib from ${TSGIB_VENDOR_ROUTE}) — try: tiny index`
                );
            } catch (e) {
                console.warn("[tiny_ibgib_space]", e.message || e);
            }
        },
        onUnmount: () => {
            console.log("[tiny_ibgib_space] unmounted (globalThis.tsgib left in place)");
        },
    };
};
