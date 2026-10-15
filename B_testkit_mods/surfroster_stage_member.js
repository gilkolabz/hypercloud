/**
 * surfroster_stage_member — scranton_lobby stage affordances (one mod, three descriptors):
 *
 *   stage_member  post     — the posted frame is a stage member (data.post.stage_dir says where).
 *                            "stage" places it onto your current stage (stagedir place).
 *   stage_dir     post     — the posted frame is a whole stage (stage_dir JSON, "post stage on this
 *                            page…"). "apply" replaces your stage with it.
 *   stagedir      address  — stagedir/{page}: shared stage directions, one signed row per placement
 *                            { member, slot, pos }. "place" applies a row onto your current stage.
 *
 * Trusted authors (scranton_lobby trust …): on surf, their stage_dir post is applied (the latest one),
 * then their stage_member posts and stagedir rows are placed — skipping members already on stage and
 * posts whose park changed since they were posted.
 *
 * Gates and the personal filter are applied by scranton_lobby (≥ 1.11.0) before onSurf: a post's
 * gate.from / a row's `from` must match the page you arrived from, and hidden authors never act.
 *
 * Members placed on their own (trusted, on surf) carry data-unstage-on-leave, so surf keepstage
 * (surf ≥ 1.8.15) leaves them behind when you surf away. Members you place by hand stay.
 *
 * Requires: scranton_lobby ≥ 1.10.0, stagedir ≥ 3.7.20.
 */

const VERSION = "0.5.1";
const LEGACY_TRUST_KEY = "navi:surfroster_stage_member:trusted";

const HELP = [
    `surfroster_stage_member ${VERSION} — scranton_lobby stage affordances`,
    "",
    "  stage_member (post)     place one posted member onto your stage",
    "  stage_dir (post)        replace your stage with a posted whole stage",
    "  stagedir (address)      stagedir/<page>: shared placements anyone can add (one signed row each)",
    "",
    "Trusted authors' directions apply themselves on surf (scranton_lobby trust key|identity …).",
    "",
    "  surfroster_stage_member                       this help",
    "  surfroster_stage_member direct <page> <member path> [SLOT] [pos] [--from <page>]   add a stagedir row",
    "      --from: trusted visitors get it placed on their own only when they arrive from that page.",
    "",
    "Post one member: jockey a stage-member → +1 \"scranton - post on this page…\".",
    "Post a whole stage: stagejockey menu → \"scranton - post stage on this page…\" (jockey_netproposer).",
].join("\n");

const cleanPath = (raw) =>
    String(raw || "")
        .trim()
        .replace(/^navi:/i, "")
        .replace(/^\/+|\/+$/g, "");

const short = (pub) => (pub ? `${String(pub).slice(0, 12)}…` : "?");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const register = (navi) => {
    const unregister = [];
    let surfBefore = null;
    let arrival = null;

    const lobby = () => navi?.mod?.scranton_lobby?.lobby || null;
    const stage = () => navi?.mod?.stagedir?.stage || null;
    const origin = () =>
        String(navi.origin || globalThis.location?.origin || "https://foobarch.net").replace(/\/+$/, "");
    const say = (msg) => (typeof navi.callout === "function" ? navi.callout(msg) : console.log(msg));

    const stageRoot = () =>
        typeof document === "undefined" ? null : document.querySelector('[data-part~="stage"]');

    /** Remember the stage we are leaving the moment a surf starts. */
    const onCallin = (req) => {
        const park = String(typeof req === "string" ? req : req?.path || req?.input || "").replace(/^\/+/, "");
        const segs = park.split("/").filter(Boolean);
        const lead = /^navi$/i.test(segs[0] || "") ? segs[1] : segs[0];
        if (String(lead || "").toLowerCase() !== "surf") return;
        surfBefore = stageRoot();
        arrival = null;
    };

    /** The surf's own stage (shared by every plugin here for this surf). */
    const stageArrived = () => {
        if (!arrival) {
            const before = surfBefore;
            arrival = (async () => {
                const end = Date.now() + 8000;
                while (Date.now() < end) {
                    const root = stageRoot();
                    if (root && (!before || root !== before || !before.isConnected)) {
                        await sleep(50);
                        return root;
                    }
                    await sleep(100);
                }
                return null;
            })();
        }
        return arrival;
    };

    const onStage = (ib) => {
        const root = stageRoot();
        if (!root) return false;
        for (const el of root.querySelectorAll("[data-path]")) {
            if (cleanPath(el.getAttribute("data-path")) === ib) return true;
        }
        return false;
    };

    const needStage = () => {
        const st = stage();
        if (!st?.placeFromPath) throw new Error("stagedir is not mounted");
        if (!stageRoot()) throw new Error("no stage on this page (surf -p, or proscene first)");
        return st;
    };

    /** Tag the member holding `ib` so surf keepstage leaves it behind on the next surf. */
    const markUnstageOnLeave = (ib) => {
        const root = stageRoot();
        if (!root) return;
        for (const el of root.querySelectorAll("[data-path]")) {
            if (cleanPath(el.getAttribute("data-path")) !== ib) continue;
            let member = el;
            while (member.parentElement && !/^(USL|USC|USR|SL|CS|SR|DSL|DSC|DSR)$/.test(member.parentElement.id || "")) {
                member = member.parentElement;
                if (member === root) return;
            }
            member.setAttribute("data-unstage-on-leave", ib);
            return;
        }
    };

    /**
     * Place a hostparked member (its own stage_dir unless slot/pos are given).
     * auto: placed on its own for this page, so it unstages when you surf away.
     */
    const placeMember = async (ib, slot, pos, { auto = false } = {}) => {
        const st = needStage();
        if (onStage(ib)) return { skipped: `${ib} is already on the stage` };
        const at = slot && pos !== "" && pos != null && !Number.isNaN(Number(pos)) ? Number(pos) : null;
        const r = await st.placeFromPath(`${origin()}/${ib}`, slot || null, at);
        if (auto) markUnstageOnLeave(ib);
        await st.persist?.();
        return { placed: r };
    };

    /** Has the member park moved past the generation the lobby row pinned? */
    const moved = async (x) => {
        const res = await fetch(`${origin()}/foobarch/tip/${x.ib}`);
        if (!res.ok) return `${x.ib} unreadable (${res.status})`;
        const tip = await res.json();
        return tip?.addr && tip.addr !== x.addr ? `${x.ib} changed since it was posted` : false;
    };

    const trustActions = async (author) => {
        const l = lobby();
        if (!author || !l?.isTrusted) return [];
        const t = await l.isTrusted(author);
        if (t.trusted && t.via !== "key") return [];
        return [
            t.trusted
                ? {
                      id: "untrust",
                      label: "untrust author",
                      title: `Stop acting on ${author} automatically`,
                      run: async () => (await l.trustKey(author, false), `untrusted ${short(author)}`),
                  }
                : {
                      id: "trust",
                      label: "trust author",
                      title: `Apply this author's stage directions automatically when you surf to their page`,
                      run: async () => (await l.trustKey(author, true), `trusted ${short(author)} — their stage directions apply on surf`),
                  },
        ];
    };

    const trusted = async (author) => !!(author && (await lobby()?.isTrusted?.(author))?.trusted);

    // ─── stage_member (post) ───
    const placePost = async (x, { auto = false } = {}) => {
        const why = await moved(x);
        if (why && auto) return { skipped: why };
        const sd = x.post?.stage_dir || {};
        const r = await placeMember(x.ib, sd.slot || null, sd.slot ? sd.at : null, { auto });
        return { ...r, warning: why || "" };
    };

    const stageMember = {
        name: "stage_member",
        post_kind: "stage_member",
        label: "stage member",
        order: 20,
        describe: (x) => {
            const sd = x.post?.stage_dir || {};
            return `stage "${x.post?.label || x.ib}" at ${sd.slot || "?"}${sd.at != null ? `[${sd.at}]` : ""} · by ${short(x.post?.author)}`;
        },
        actions: async (x) => [
            {
                id: "stage",
                label: "stage",
                title: `Place ${x.ib} on this page's stage`,
                run: async () => {
                    const r = await placePost(x);
                    return r.skipped || `staged ${x.ib}${r.warning ? ` (${r.warning})` : ""}`;
                },
            },
            ...(await trustActions(x.post?.author)),
        ],
        onSurf: async (list, ctx) => {
            const mine = [];
            for (const x of list) if (await trusted(x.post?.author)) mine.push(x);
            if (!mine.length) return;
            if (!(await stageArrived())) return say(`[stage_member] ${ctx.path}: no stage arrived; ${mine.length} post(s) not staged`);
            for (const x of mine) {
                try {
                    const r = await placePost(x, { auto: true });
                    say(`[stage_member] ${r.skipped ? `skipped: ${r.skipped}` : `staged ${x.ib}`}`);
                } catch (e) {
                    say(`[stage_member] ${e.message || e}`);
                }
            }
        },
    };

    // ─── stage_dir (post): a whole stage ───
    const applyStage = async (x) => {
        const st = stage();
        if (!st?.installManifestContent) throw new Error("stagedir is not mounted");
        const { text } = await lobby().postContent(x);
        await st.installManifestContent(text, x.ib);
        return `applied stage ${x.post?.label || x.ib}`;
    };

    const stageDir = {
        name: "stage_dir",
        post_kind: "stage_dir",
        label: "whole stage",
        order: 0,
        describe: (x) => `whole stage "${x.post?.label || x.ib}" · by ${short(x.post?.author)}`,
        actions: async (x) => [
            { id: "apply", label: "apply", title: "Replace your stage with this one", run: () => applyStage(x) },
            ...(await trustActions(x.post?.author)),
        ],
        onSurf: async (list, ctx) => {
            let pick = null;
            for (const x of list) if (await trusted(x.post?.author)) pick = x;
            if (!pick) return;
            if (!(await stageArrived())) return say(`[stage_dir] ${ctx.path}: no stage arrived; not applied`);
            try {
                say(`[stage_dir] ${await applyStage(pick)}`);
            } catch (e) {
                say(`[stage_dir] ${e.message || e}`);
            }
        },
    };

    // ─── stagedir (address): stagedir/{page} rows { member, slot, pos } ───
    const placeRow = (row, opts) => placeMember(cleanPath(row.member), String(row.slot || "").trim() || null, String(row.pos ?? "").trim(), opts);

    const stagedirAddress = {
        name: "stagedir",
        address: "stagedir/{page}",
        label: "stage directions",
        order: 30,
        actions: async (read) =>
            read.rows.length
                ? [
                      {
                          id: "place-all",
                          label: "place all",
                          title: "Place every direction here onto your current stage",
                          run: async () => {
                              const out = [];
                              for (const row of read.rows) {
                                  const r = await placeRow(row).catch((e) => ({ skipped: e.message || String(e) }));
                                  out.push(r.skipped ? `skipped ${row.member}: ${r.skipped}` : `placed ${row.member}`);
                              }
                              return out.join(" · ");
                          },
                      },
                  ]
                : [],
        rowActions: async (row) => [
            {
                id: "place",
                label: "place",
                title: `Place ${row.member} at ${row.slot || "its own column"}${row.pos ? `[${row.pos}]` : ""}`,
                run: async () => {
                    const r = await placeRow(row);
                    return r.skipped || `placed ${row.member}`;
                },
            },
            ...(await trustActions(row.by)),
        ],
        onSurf: async (read, ctx) => {
            const mine = [];
            for (const row of read.rows) if (await trusted(row.by)) mine.push(row);
            if (!mine.length) return;
            if (!(await stageArrived())) return say(`[stagedir] ${ctx.path}: no stage arrived; ${mine.length} direction(s) not placed`);
            for (const row of mine) {
                try {
                    const r = await placeRow(row, { auto: true });
                    say(`[stagedir] ${r.skipped ? `skipped: ${r.skipped}` : `placed ${row.member}`}`);
                } catch (e) {
                    say(`[stagedir] ${row.member}: ${e.message || e}`);
                }
            }
        },
    };

    const plugins = [stageDir, stageMember, stagedirAddress];

    /** Carry the old per-mod trusted list into scranton_lobby trust once. */
    const migrateTrust = async () => {
        const l = lobby();
        if (!l?.trustKey) return;
        const old = await navi.storage.item.get(LEGACY_TRUST_KEY).catch(() => null);
        if (!Array.isArray(old) || !old.length) return;
        for (const k of old) if (typeof k === "string" && k) await l.trustKey(k, true, "from surfroster_stage_member");
        await navi.storage.item.set(LEGACY_TRUST_KEY, []);
    };

    const attach = () => {
        const l = lobby();
        if (!l?.registerAffordance) return;
        while (unregister.length) unregister.pop()();
        for (const p of plugins) unregister.push(l.registerAffordance(p));
    };

    return {
        name: "surfroster_stage_member",
        version: VERSION,
        description: "scranton_lobby stage affordances: stage_member + stage_dir posts, stagedir/{page} directions",
        moduleInfo: {
            name: "surfroster_stage_member",
            version: VERSION,
            description: "scranton_lobby stage affordances: stage_member + stage_dir posts, stagedir/{page} directions",
        },
        affordancePlugins: plugins,
        commands: {
            surfroster_stage_member: {
                name: "surfroster_stage_member",
                description: "help · direct <page> <member> [SLOT] [pos]",
                execute: async (verb, ...rest) => {
                    const args = [verb, ...rest].flatMap((a) => String(a ?? "").split(/\s+/)).filter(Boolean);
                    if (String(args[0] || "").toLowerCase() === "direct") {
                        const fi = args.indexOf("--from");
                        const from = fi >= 0 ? cleanPath(args.splice(fi, 2)[1]) : "";
                        const [, page, member, slot = "", pos = ""] = args;
                        if (!page || !member || (fi >= 0 && !from)) return "usage: surfroster_stage_member direct <page> <member path> [SLOT] [pos] [--from <page>]";
                        const r = await lobby().addressPush("stagedir", page, { member: cleanPath(member), slot, pos, from });
                        return `${r.created ? `created ${r.ib} · ` : ""}direction added: ${member}${slot ? ` → ${slot}${pos ? `[${pos}]` : ""}` : ""}${from ? ` (only when arriving from ${from})` : ""}`;
                    }
                    const seen = [];
                    for (const p of plugins) {
                        const a = await lobby()?.affordanceNamed?.(p.name).catch(() => null);
                        seen.push(`  ${p.name}: ${a?.plugin === p ? "ready" : a ? "seen (another interpreter)" : "not known to scranton_lobby"}`);
                    }
                    return [HELP, "", "scranton_lobby sees:", ...seen].join("\n");
                },
            },
        },
        onMount: async () => {
            if (typeof navi.on === "function") navi.on("callin", onCallin);
            attach();
            await migrateTrust().catch(() => {});
        },
        onUnmount: () => {
            if (typeof navi.off === "function") navi.off("callin", onCallin);
            while (unregister.length) unregister.pop()();
        },
    };
};
