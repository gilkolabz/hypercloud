/**
 * skelly — snapshot / restore navi tip+bin space (except the root `navi` tip).
 *
 *   skelly export
 *     Pack latest tips + referenced bins into navi:skelly:export.
 *     Returns the bundle so it can be passed into other commands.
 *
 *   skelly import <path…>
 *     Resolve path via navi.fetch (park-check → hostpark), seed tips+bins 1:1.
 */

export const register = (navi) => {
    const NAME = "skelly";
    const VERSION = "1.0.8";
    const EXPORT_IB = "navi:skelly:export";
    const KIND = "navi.skelly.export";

    const slashfold = (raw) => {
        let s = String(raw == null ? "" : raw).trim();
        if (!s) return "";
        if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s;
        return s
            .replace(/\s+/g, "/")
            .replace(/^\/+/, "")
            .replace(/\/{3,}/g, "//");
    };

    const parseBinSha = (ref) => {
        const m = String(ref || "")
            .trim()
            .match(/^bin\s+([0-9a-fA-F]+)$/i);
        return m ? m[1].toLowerCase() : "";
    };

    const ibSegs = (ib) =>
        String(ib || "")
            .trim()
            .replace(/^\/+/, "")
            .split(/[/:\s]+/)
            .filter(Boolean);

    const isRootNavi = (ib) => {
        const segs = ibSegs(ib);
        return segs.length === 1 && segs[0] === "navi";
    };

    const isExportIb = (ib) => {
        const segs = ibSegs(ib);
        return (
            segs.length === 3 &&
            segs[0] === "navi" &&
            segs[1] === "skelly" &&
            segs[2] === "export"
        );
    };

    const isExportBundleMedia = (media) => {
        const t = String(media || "").trim();
        return t.charAt(0) === "{" && t.indexOf('"kind":"' + KIND + '"') !== -1;
    };

    const now = () => {
        try {
            if (navi.stamp && typeof navi.stamp.time === "function") {
                return navi.stamp.time();
            }
        } catch {
            /* fall through */
        }
        return new Date().toISOString();
    };

    /**
     * Accepts a bundle object, its JSON text, a { media } bin record, or a tip
     * frame whose rel8ns.bin points at the bundle bin in local storage.
     */
    const parseBundle = async (raw, depth = 0) => {
        if (depth > 3) throw new Error("not a skelly export bundle (nested too deep)");
        if (typeof raw === "string") {
            const t = raw.trim();
            if (!t) throw new Error("empty skelly payload");
            let parsed;
            try {
                parsed = JSON.parse(t);
            } catch {
                throw new Error(
                    "not a skelly export bundle (not JSON: " + JSON.stringify(t.slice(0, 60)) + ")"
                );
            }
            return parseBundle(parsed, depth + 1);
        }
        if (raw && typeof raw === "object" && !Array.isArray(raw)) {
            if (raw.kind === KIND) return raw;
            if (typeof raw.media === "string") return parseBundle(raw.media, depth + 1);
            if (raw.error) throw new Error(String(raw.error));
            const binRefs = Array.isArray(raw.rel8ns?.bin) ? raw.rel8ns.bin : [];
            const sha = parseBinSha(binRefs[0]);
            if (sha) {
                const rec = await navi.storage.bin.get(sha);
                if (rec && typeof rec.media === "string") {
                    return parseBundle(rec.media, depth + 1);
                }
                throw new Error(
                    "got tip frame " + (raw.ib || "?") + " but its bundle bin " +
                        sha.slice(0, 12) + "… is not on this device"
                );
            }
            throw new Error(
                "not a skelly export bundle (got " +
                    (raw.ib ? "tip " + raw.ib : "keys " + Object.keys(raw).slice(0, 6).join(",")) +
                    ")"
            );
        }
        throw new Error("not a skelly export bundle");
    };

    const packExport = async () => {
        const ibs = await navi.storage.tip.list();
        const tips = [];
        const bins = {};
        const missing_bins = [];
        for (const ib of ibs) {
            if (isRootNavi(ib) || isExportIb(ib)) continue;
            const tip = await navi.storage.tip.get(ib);
            if (!tip || typeof tip !== "object") continue;
            const frame = {
                ib: tip.ib || ib,
                gib: tip.gib || "",
                data: tip.data && typeof tip.data === "object" ? tip.data : {},
                rel8ns:
                    tip.rel8ns && typeof tip.rel8ns === "object"
                        ? tip.rel8ns
                        : {},
            };
            tips.push(frame);
            const refs = Array.isArray(frame.rel8ns.bin) ? frame.rel8ns.bin : [];
            for (const ref of refs) {
                const sha = parseBinSha(ref);
                if (!sha || bins[sha]) continue;
                const rec = await navi.storage.bin.get(sha);
                if (!rec || typeof rec.media !== "string") {
                    missing_bins.push(sha);
                    continue;
                }
                if (isExportBundleMedia(rec.media)) continue;
                bins[sha] = {
                    media: rec.media,
                    mime: rec.mime || "application/octet-stream",
                };
            }
        }
        const bundle = {
            kind: KIND,
            version: 1,
            exported_at: now(),
            tip_count: tips.length,
            bin_count: Object.keys(bins).length,
            tips,
            bins,
        };
        if (missing_bins.length) bundle.missing_bins = missing_bins;
        return bundle;
    };

    const writeExportTip = async (bundle) => {
        const json = JSON.stringify(bundle);
        const sha = await navi.storage.bin.putMedia({
            media: json,
            mime: "application/json; charset=utf-8",
        });
        const ref = navi.storage.bin.ref(sha);
        const existing = await navi.storage.tip.get(EXPORT_IB);
        const oldSha = parseBinSha(
            Array.isArray(existing?.rel8ns?.bin) ? existing.rel8ns.bin[0] : ""
        );
        const data = {
            parts: ["skelly_export", "ibgib_frame", "manifest", "json"],
            park: "capture",
            default_method: "GET",
            content_type: "application/json; charset=utf-8",
            exported_at: bundle.exported_at,
            tip_count: bundle.tip_count,
            bin_count: bundle.bin_count,
            http: {
                GET: { kind: "bin", mode: "sync" },
            },
            about: {
                label: "skelly export",
                description:
                    "Packed latest navi tips+bins (root navi tip excluded).",
            },
        };
        if (existing && existing.data) {
            await navi.storage.tip.mut8(EXPORT_IB, data, {
                rel8ns: { bin: [ref] },
            });
        } else {
            await navi.storage.tip.set({
                ib: EXPORT_IB,
                gib: "",
                data,
                rel8ns: { bin: [ref], past: [], tjp: [], dna: [] },
            });
        }
        const tip = await navi.storage.tip.get(EXPORT_IB);
        if (oldSha && oldSha !== sha && navi.storage.bin.del) {
            try {
                await navi.storage.bin.del(oldSha);
            } catch {
                /* leftover pack bin — ignore */
            }
        }
        return {
            ib: EXPORT_IB,
            sha,
            ref,
            gib: (tip && tip.gib) || "",
            n: tip && tip.data && tip.data.n != null ? tip.data.n : 0,
        };
    };

    const runExport = async () => {
        const bundle = await packExport();
        const stored = await writeExportTip(bundle);
        try {
            navi.callout(
                "[skelly] export " +
                    stored.ib +
                    (stored.gib ? "^" + stored.gib : "")
            );
        } catch {
            /* ignore */
        }
        bundle.stored = stored;
        return bundle;
    };

    /** Park-check → hostpark via navi.fetch (same pipe as SW / mount). */
    const loadBundle = async (folded) => {
        if (typeof navi.fetch !== "function") {
            throw new Error("navi.fetch unavailable");
        }
        const accept = "application/json, text/plain, */*";
        // Relay parks (navi-<alias>/…): X-Navi-Shell-Wait makes the host hold this
        // request and return the device's reply instead of a 202 job ticket.
        const relay =
            /^navi-[a-zA-Z0-9._-]+(\/|$)/.test(folded) && typeof navi.resolveUrl === "function";
        const res = relay
            ? await fetch(navi.resolveUrl("/" + folded), {
                  headers: { Accept: accept, "X-Navi-Shell-Wait": "1" },
              })
            : await navi.fetch(folded, { headers: { Accept: accept } });
        const text = await res.text();
        if (!res.ok) {
            let why = text.slice(0, 400);
            try {
                const j = JSON.parse(text);
                if (j && j.error) why = String(j.error);
            } catch {
                /* keep slice */
            }
            throw new Error(
                "navi.fetch " + folded + " → " + res.status + ": " + why
            );
        }
        return await parseBundle(text);
    };

    /** Seed from an already-fetched bundle (text/object/frame) — no second fetch. */
    const importBundle = async (raw, from = "") => {
        const bundle = await parseBundle(raw);
        const seeded = await seedBundle(bundle);
        return {
            ok: true,
            from: from || null,
            exported_at: bundle.exported_at || null,
            ...seeded,
        };
    };

    const seedBundle = async (bundle) => {
        const bins = bundle.bins && typeof bundle.bins === "object" ? bundle.bins : {};
        let binsWritten = 0;
        for (const [sha, rec] of Object.entries(bins)) {
            if (!rec || typeof rec.media !== "string") continue;
            await navi.storage.bin.put(String(sha).toLowerCase(), {
                media: rec.media,
                mime: rec.mime || "application/octet-stream",
            });
            binsWritten += 1;
        }
        const tips = Array.isArray(bundle.tips) ? bundle.tips : [];
        let tipsWritten = 0;
        for (const frame of tips) {
            if (!frame || !frame.ib) continue;
            if (isRootNavi(frame.ib)) continue;
            await navi.storage.tip.set({
                ib: frame.ib,
                gib: frame.gib || "",
                data: frame.data && typeof frame.data === "object" ? frame.data : {},
                rel8ns:
                    frame.rel8ns && typeof frame.rel8ns === "object"
                        ? frame.rel8ns
                        : { past: [], tjp: [], dna: [] },
            });
            tipsWritten += 1;
        }
        return { tipsWritten, binsWritten };
    };

    const runImport = async (...args) => {
        // Multi-arg callins slashfold (`navi-hq01 skelly export` → path).
        // A single arg is an ib/path as-is (spaces in filenames must survive).
        const folded =
            args.length > 1
                ? slashfold(args.join(" "))
                : String(args[0] ?? "").trim();
        if (!folded) {
            throw new Error("usage: skelly import <path>");
        }
        const bundle = await loadBundle(folded);
        const seeded = await seedBundle(bundle);
        return {
            ok: true,
            from: folded,
            exported_at: bundle.exported_at || null,
            ...seeded,
        };
    };

    const runHelp = async () =>
        [
            "skelly v" + VERSION,
            "",
            "  skelly export",
            "      Pack latest tips (except ib navi) + bins → navi:skelly:export; return the bundle.",
            "  skelly import <path…>",
            "      Slashfold path, load bundle, seed tips+bins 1:1.",
        ].join("\n");

    const runSkelly = async (verb, ...rest) => {
        const v = String(verb || "").trim().toLowerCase();
        if (!v || v === "help") return await runHelp();
        if (v === "export") return await runExport();
        if (v === "import") return await runImport(...rest);
        throw new Error("unknown skelly command '" + v + "' — try: skelly help");
    };

    return {
        name: NAME,
        version: VERSION,
        description:
            "Export/import navi tip+bin space (root navi excluded) via navi:skelly:export.",
        moduleInfo: {
            name: NAME,
            version: VERSION,
            description:
                "Export/import navi tip+bin space (root navi excluded) via navi:skelly:export.",
        },
        export: runExport,
        import: runImport,
        importBundle,
        commands: {
            skelly: {
                name: "skelly",
                description: "skelly export | skelly import <path>",
                execute: runSkelly,
            },
            export: {
                name: "export",
                description: "Pack tips+bins to navi:skelly:export; return the bundle",
                execute: runExport,
            },
            import: {
                name: "import",
                description: "skelly import <path…> — seed from a bundle path",
                execute: runImport,
            },
        },
    };
};
