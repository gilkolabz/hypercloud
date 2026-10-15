/**
 * tinyviewport_stagejockey_live — expand supermouse_stagejockey_live tip
 * frames into a select / claim / textselect graph (not past-lineage n-squares).
 *
 *   mount flowerpot/…/tinyviewport_manager.js
 *   mount flowerpot/…/tinyviewport_stagejockey_live.js
 *
 * Open tip ib `supermouse_stagejockey_live`, enable plugin "stagejockey live"
 * (on by default). Turn lineage off if you only want this view.
 */
export const register = (navi) => {
    const VERSION = "0.1.1";
    const PLUGIN_ID = "stagejockey_live";
    const LIVE_IB = "supermouse_stagejockey_live";
    const LAYOUT_PREFIX = "sjlive";
    const LAYOUT_REV = "1";
    const BANDS = ["ix", "step", "type", "claim", "path"];

    const WAREZ_SUBJECT =
        "flowerpot/hypercloud/testkit/mods/legacy/tinyviewport_stagejockey_live.js";
    const WAREZ_MANIFEST =
        "flowerpot/hypercloud/testkit/mods/tinyviewport_stagejockey_live";

    const EDGE = {
        ix: "#6c5ce7",
        step: "#0984e3",
        type: "#00b894",
        claim: "#e17055",
        path: "#fdcb6e",
        next: "#636e72",
        text: "#a29bfe",
    };

    let unregister = null;

    const tipApi = () => {
        const tip = navi?.storage?.tip;
        if (!tip || typeof tip.get !== "function") {
            throw new Error("navi.storage.tip unavailable");
        }
        return tip;
    };

    const resolveManager = () => {
        const m = navi?.mod?.tinyviewport_manager;
        if (m && typeof m.registerPlugin === "function") return m;
        return null;
    };

    const isLiveTip = (ib, tip) => {
        const key = String(ib || "").trim();
        if (key === LIVE_IB) return true;
        const parts = tip?.data?.parts;
        if (Array.isArray(parts) && parts.map(String).includes("stagejockey_live")) {
            return true;
        }
        const v = tip?.data?.value;
        return !!(v && typeof v === "object" && v.interactionId);
    };

    const synGib = (seed) => {
        let h = 0x811c9dc5;
        const s = String(seed || "");
        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 0x01000193);
        }
        return `syn${(h >>> 0).toString(16).padStart(8, "0")}`;
    };

    const synAddr = (ib, seed) => `${ib}^${synGib(seed)}`;

    const synFrame = (ib, gib, { label, value, kind }) => ({
        ib,
        gib,
        data: {
            parts: ["stagejockey_live_node", "json"],
            kind: kind || "node",
            about: { label: String(label || kind || "node") },
            value: value != null ? value : { label },
        },
        rel8ns: { past: [], tjp: [], dna: [] },
    });

    const packNode = ({
        ib,
        seed,
        label,
        seq,
        value,
        kind,
        band,
        order,
        source = PLUGIN_ID,
    }) => {
        const gib = synGib(seed);
        const addr = `${ib}^${gib}`;
        const frame = synFrame(ib, gib, { label, value, kind });
        return {
            addr,
            ib,
            frame,
            stub: false,
            kind: "sjlive",
            seq: seq != null ? seq : null,
            sjLabel: String(label || ""),
            sjKind: kind || band,
            layoutPrefix: LAYOUT_PREFIX,
            layoutBand: band,
            layoutBandRank: Math.max(0, BANDS.indexOf(band)),
            layoutOrder: order != null ? order : 0,
            row: `${LAYOUT_PREFIX}:${band}`,
            source,
        };
    };

    const contribute = async (ctx) => {
        const base = String(ctx.baseIb || "").trim();
        const nodes = [];
        const edges = [];
        if (!base) return { nodes, edges };

        let tip = null;
        try {
            tip = await ctx.tipApi().get(base);
        } catch {
            tip = null;
        }
        if (!isLiveTip(base, tip)) {
            return { nodes, edges };
        }

        const frameMap = new Map();
        const tipAddr = tip ? ctx.frameAddr(tip) : "";
        if (tipAddr) frameMap.set(tipAddr, tip);

        try {
            const listed = ((await ctx.tipApi().frame?.list?.(base)) || []).map(
                String
            );
            for (const addr of listed) {
                if (!addr || frameMap.has(addr)) continue;
                const f = await ctx.getFrame(addr);
                if (f) frameMap.set(addr, f);
            }
        } catch {
            /* optional */
        }

        // Walk past so we still get frames if list is thin.
        let cur = tip;
        let guard = 0;
        while (cur && guard++ < 64) {
            const past =
                Array.isArray(cur.rel8ns?.past) && cur.rel8ns.past[0]
                    ? String(cur.rel8ns.past[0])
                    : "";
            if (!past || frameMap.has(past)) break;
            const f = await ctx.getFrame(past);
            if (!f) break;
            frameMap.set(past, f);
            cur = f;
        }

        const chain = [];
        for (let f = tip, g = 0; f && g < 512; g++) {
            const a = g === 0 ? tipAddr : ctx.frameAddr(f);
            if (!a || chain.includes(a)) break;
            chain.push(a);
            const past =
                Array.isArray(f.rel8ns?.past) && f.rel8ns.past[0]
                    ? String(f.rel8ns.past[0])
                    : "";
            f = past ? frameMap.get(past) : null;
        }
        chain.reverse();
        const seqOf = new Map(chain.map((a, i) => [a, i]));
        const stampOf = (f) => {
            const t = Date.parse(f?.data?.timestamp);
            return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
        };
        const frames = [...frameMap.entries()].sort((a, b) => {
            const sa = seqOf.get(a[0]);
            const sb = seqOf.get(b[0]);
            if (sa != null && sb != null) return sa - sb;
            const ta = stampOf(a[1]);
            const tb = stampOf(b[1]);
            if (ta !== tb) return ta - tb;
            return String(a[0]).localeCompare(String(b[0]));
        });

        const ixNodes = new Map();
        const stepsByIx = new Map();

        let stepOrd = 0;
        for (const [addr, frame] of frames) {
            const v = frame?.data?.value;
            if (!v || typeof v !== "object") continue;
            const iid = String(v.interactionId || "").trim() || "anon";
            const n = seqOf.get(addr);
            const via = v.via && typeof v.via === "object" ? v.via : null;
            const viaKind = String(via?.kind || via?.claimId || "step");
            const stepLabel =
                via?.claimId != null
                    ? `${viaKind}:${via.claimId}`
                    : viaKind;

            if (!ixNodes.has(iid)) {
                const ix = packNode({
                    ib: `${LIVE_IB}/ix/${iid}`,
                    seed: `ix:${iid}`,
                    label: iid.length > 18 ? iid.slice(0, 16) + "…" : iid,
                    seq: null,
                    value: { interactionId: iid, kind: v.interactionKind },
                    kind: "interaction",
                    band: "ix",
                    order: ixNodes.size,
                });
                ixNodes.set(iid, ix);
                nodes.push(ix);
                stepsByIx.set(iid, []);
            }
            const ixAddr = ixNodes.get(iid).addr;

            const step = packNode({
                ib: `${LIVE_IB}/step/${iid}/${n != null ? n : stepOrd}`,
                seed: `step:${addr}`,
                label: stepLabel,
                seq: n,
                value: {
                    via,
                    holding: v.holding,
                    select: v.select,
                    scrollbuffer: v.scrollbuffer,
                },
                kind: "step",
                band: "step",
                order: stepOrd++,
            });
            nodes.push(step);
            edges.push({
                from: ixAddr,
                to: step.addr,
                rel: "step",
                color: EDGE.step,
                source: PLUGIN_ID,
            });

            const prevSteps = stepsByIx.get(iid);
            if (prevSteps.length) {
                edges.push({
                    from: prevSteps[prevSteps.length - 1],
                    to: step.addr,
                    rel: "next",
                    color: EDGE.next,
                    source: PLUGIN_ID,
                });
            }
            prevSteps.push(step.addr);

            const ctxPack = v.context || null;
            const types = Array.isArray(ctxPack?.types)
                ? ctxPack.types.map(String).filter((t) => t && t !== ">>")
                : [];
            let prevType = null;
            types.forEach((t, i) => {
                const tn = packNode({
                    ib: `${LIVE_IB}/type/${iid}/${n}/${i}`,
                    seed: `type:${addr}:${i}:${t}`,
                    label: t,
                    seq: i,
                    value: { type: t, context: ctxPack },
                    kind: "type",
                    band: "type",
                    order: i,
                });
                nodes.push(tn);
                if (i === 0) {
                    edges.push({
                        from: step.addr,
                        to: tn.addr,
                        rel: "types",
                        color: EDGE.type,
                        source: PLUGIN_ID,
                    });
                }
                if (prevType) {
                    edges.push({
                        from: prevType,
                        to: tn.addr,
                        rel: "nest",
                        color: EDGE.type,
                        source: PLUGIN_ID,
                    });
                }
                prevType = tn.addr;
            });

            if (ctxPack?.textSpan) {
                const span = ctxPack.textSpan;
                const textLab =
                    span.text != null
                        ? String(span.text).slice(0, 24)
                        : `${span.start}-${span.end}`;
                const tn = packNode({
                    ib: `${LIVE_IB}/text/${iid}/${n}`,
                    seed: `text:${addr}`,
                    label: textLab || "text",
                    seq: null,
                    value: { textSpan: span },
                    kind: "text",
                    band: "type",
                    order: 90,
                });
                nodes.push(tn);
                edges.push({
                    from: step.addr,
                    to: tn.addr,
                    rel: "text",
                    color: EDGE.text,
                    source: PLUGIN_ID,
                });
            }

            const path =
                (ctxPack && ctxPack.path) ||
                (v.select && v.select.path) ||
                "";
            if (path) {
                const pn = packNode({
                    ib: `${LIVE_IB}/path/${encodeURIComponent(path).slice(0, 80)}`,
                    seed: `path:${path}`,
                    label:
                        path.length > 28
                            ? "…" + path.slice(-26)
                            : path,
                    seq: null,
                    value: { path },
                    kind: "path",
                    band: "path",
                    order: 0,
                });
                // Dedupe path nodes by addr
                if (!nodes.some((x) => x.addr === pn.addr)) nodes.push(pn);
                edges.push({
                    from: step.addr,
                    to: pn.addr,
                    rel: "path",
                    color: EDGE.path,
                    source: PLUGIN_ID,
                });
            }

            const claims = Array.isArray(v.claims) ? v.claims : [];
            claims.forEach((c, i) => {
                if (!c) return;
                const lab =
                    c.text ||
                    c.claimId ||
                    `${c.pluginId || "claim"}@${c.position}`;
                const cn = packNode({
                    ib: `${LIVE_IB}/claim/${iid}/${n}/${c.claimId || i}`,
                    seed: `claim:${addr}:${c.pluginId}:${c.claimId}:${c.position}`,
                    label: String(lab).slice(0, 28),
                    seq: c.position,
                    value: c,
                    kind: "claim",
                    band: "claim",
                    order: Number(c.position) || i,
                });
                nodes.push(cn);
                edges.push({
                    from: step.addr,
                    to: cn.addr,
                    rel: "claim",
                    color: EDGE.claim,
                    source: PLUGIN_ID,
                });
            });
        }

        return {
            nodes,
            edges,
            layout: {
                prefix: LAYOUT_PREFIX,
                bands: BANDS,
                rev: LAYOUT_REV,
            },
        };
    };

    const styleNode = (node) => {
        if (node?.source !== PLUGIN_ID && node?.kind !== "sjlive") return null;
        const band = node.layoutBand || node.sjKind || "step";
        const fill =
            band === "ix"
                ? EDGE.ix
                : band === "claim"
                  ? EDGE.claim
                  : band === "type"
                    ? EDGE.type
                    : band === "path"
                      ? EDGE.path
                      : EDGE.step;
        const label =
            node.sjLabel ||
            node.frame?.data?.about?.label ||
            (node.seq != null ? String(node.seq) : "·");
        return {
            fill,
            stroke: "#222",
            text: "#fff",
            label: String(label).slice(0, 18),
            width: Math.min(160, 28 + String(label).length * 7),
            height: 28,
            flair: null,
            title: node.frame?.data?.about?.label || label,
        };
    };

    const pluginDef = {
        id: PLUGIN_ID,
        label: "stagejockey live (select/claim graph)",
        description:
            "Expand supermouse_stagejockey_live frames into interaction → step → types/claims (not past n-squares).",
        enabledByDefault: true,
        source: "module",
        layout: {
            prefix: LAYOUT_PREFIX,
            bands: BANDS,
            rev: LAYOUT_REV,
        },
        legend: [
            { id: "sj_ix", label: "interaction", color: EDGE.ix },
            { id: "sj_step", label: "step (via)", color: EDGE.step },
            { id: "sj_type", label: "type nest", color: EDGE.type },
            { id: "sj_claim", label: "claim", color: EDGE.claim },
            { id: "sj_path", label: "data-path", color: EDGE.path },
            { id: "sj_next", label: "next step", color: EDGE.next },
        ],
        contribute,
        styleNode,
    };

    const mountPlugin = () => {
        const mgr = resolveManager();
        if (!mgr || typeof mgr.registerPlugin !== "function") {
            if (typeof navi.callout === "function") {
                navi.callout(
                    "[tinyviewport_stagejockey_live] needs tinyviewport_manager mounted first"
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
        name: "tinyviewport_stagejockey_live",
        version: VERSION,
        description:
            "Tinyviewport plugin — stagejockey live select/claim graph (not lineage)",

        moduleInfo: {
            name: "tinyviewport_stagejockey_live",
            version: VERSION,
            description:
                "Registers stagejockey_live graph plugin on tinyviewport_manager",
        },

        warezSubject: WAREZ_SUBJECT,
        warezManifest: WAREZ_MANIFEST,
        LIVE_IB,
        PLUGIN_ID,

        attachTinyviewportPlugin: () => {
            const ok = mountPlugin();
            if (ok && typeof navi.callout === "function") {
                navi.callout(
                    `[tinyviewport_stagejockey_live] reattach v${VERSION}`
                );
            }
            return ok;
        },

        onMount: async () => {
            mountPlugin();
            if (typeof navi.callout === "function") {
                navi.callout(
                    `[tinyviewport_stagejockey_live] v${VERSION} — open ${LIVE_IB}; disable lineage for this view`
                );
            }
        },

        onUnmount: async () => {
            try {
                if (typeof unregister === "function") unregister();
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
