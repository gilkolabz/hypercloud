/**
 * scranton_avatar — avi frames at scranton/avatar/{pubkey}, signed by that pubkey.
 * Surfroster shows thumbnail + alias only for people you trust (and yourself).
 *
 *   mount scranton_avatar
 *   scranton_avatar                   help
 *   scranton_avatar show [pubkey]
 *   scranton_avatar set alias|name|color|bio|style <value…>
 *   scranton_avatar thumb <park path>
 *   scranton_avatar link add|rm <ib^gib>
 *   scranton_avatar publish
 *
 * Schema stays at scranton/avatar (governor / policy). The mod park is scranton_avatar.
 */
const VERSION = "0.2.1";
const NAME = "scranton_avatar";
const ROOT = "scranton/avatar";
const POLICY_IB = `${ROOT}/policy`;
const CONTRACT = "scranton_avatar_v1";
const MOD_PARK = "scranton_avatar";

const HELP = [
    `scranton_avatar ${VERSION} — trusted avi cards (thumbnail + alias)`,
    "",
    `  mount ${MOD_PARK}`,
    "  scranton_avatar show [pubkey]",
    "  scranton_avatar set alias|name|color|bio|style <value…>",
    "  scranton_avatar thumb <park path>",
    "  scranton_avatar link add|rm <ib^gib>",
    "  scranton_avatar publish",
    "",
    "Surfroster roster: trust a pubkey, then their avi/name appears.",
    "Untrusted rows stay a pubkey. Your own avi always shows to you.",
].join("\n");

const hexColor = (s) => /^#[0-9A-Fa-f]{6}$/.test(String(s || ""));
const short = (pub) => (pub ? `${String(pub).slice(0, 10)}…` : "?");

export const register = (navi) => {
    const eventListeners = [];
    const createdElements = [];
    const addedStyles = [];
    const observers = [];
    const timers = [];
    let unmenu = null;
    let unroot = null;
    let draft = null;
    let cache = new Map();

    const origin = () =>
        String(navi?.origin || navi?.mod?.netproposer?.host || "").replace(/\/+$/, "") ||
        "https://foobarch.net";

    const encodePath = (raw) =>
        String(raw || "")
            .trim()
            .replace(/^\/+/, "")
            .replace(/[:\s]+/g, "/")
            .replace(/\/+/g, "/")
            .replace(/\/+$/g, "");

    const lobby = () => navi?.mod?.scranton_lobby?.lobby || null;
    const say = (msg) => (typeof navi.callout === "function" ? navi.callout(msg) : console.log(msg));

    const sha256Hex = async (bytes) => {
        const buf = bytes instanceof Uint8Array ? bytes : new TextEncoder().encode(String(bytes ?? ""));
        const dig = await crypto.subtle.digest("SHA-256", buf);
        return [...new Uint8Array(dig)].map((b) => b.toString(16).padStart(2, "0")).join("");
    };

    const myPub = async () => {
        const l = lobby();
        if (l?.pubkey) return l.pubkey();
        const kc = navi.mod?.keychain;
        const k = await kc?.getDefault?.();
        if (!k?.publicKey) throw new Error("mount keychain + scranton_lobby first");
        return k.publicKey;
    };

    const aviIb = (pub) => `${ROOT}/${pub}`;

    const emptyDraft = (pub) => ({
        avi: {
            contract: CONTRACT,
            pubkey: pub,
            alias: "",
            name: "",
            color: "#4a7c23",
            bio: "",
            style: "meadow",
        },
        links: [],
        png: null,
        pngSha: "",
        n: 0,
        parentAddr: null,
    });

    const getTip = async (ib) => {
        const res = await fetch(`${origin()}/foobarch/tip/${encodeURIComponent(ib)}`);
        if (res.status === 404) return null;
        const text = await res.text();
        if (!res.ok) throw new Error(`tip ${ib} → ${res.status}: ${text.slice(0, 200)}`);
        const tip = JSON.parse(text);
        return tip?.tombstone ? null : tip;
    };

    const loadAvi = async (pub, { fresh = false } = {}) => {
        const ib = aviIb(pub);
        if (!fresh && cache.has(pub)) return cache.get(pub);
        const tip = await getTip(ib);
        if (!tip?.frame?.data?.avi) {
            const miss = { ok: false, ib, pub };
            cache.set(pub, miss);
            return miss;
        }
        const avi = tip.frame.data.avi;
        const bin = String(tip.frame.rel8ns?.bin?.[0] || "").replace(/^bin\s+/i, "");
        const hit = {
            ok: true,
            ib,
            pub,
            addr: tip.addr,
            avi,
            bin,
            links: Array.isArray(tip.frame.rel8ns?.links) ? tip.frame.rel8ns.links.map(String) : [],
            thumbUrl: `${origin()}/${ib}`,
            n: Number(tip.frame.data.n || 0),
            frame: tip.frame,
        };
        cache.set(pub, hit);
        return hit;
    };

    const ensureDraft = async () => {
        const pub = await myPub();
        if (draft?.avi?.pubkey === pub) return draft;
        const live = await loadAvi(pub, { fresh: true });
        draft = emptyDraft(pub);
        if (live.ok) {
            draft.avi = { ...draft.avi, ...live.avi };
            draft.links = [...live.links];
            draft.n = live.n;
            draft.parentAddr = live.addr;
            draft.pngSha = live.bin || "";
        }
        return draft;
    };

    const paintChip = (pub, avi, opts = {}) => {
        const wrap = document.createElement("span");
        wrap.style.cssText =
            "display:inline-flex;align-items:center;gap:0.35rem;vertical-align:middle;" +
            (avi?.color ? `color:${avi.color};` : "");
        if (avi) {
            const img = document.createElement("img");
            img.alt = avi.alias || avi.name || short(pub);
            img.width = opts.size || 22;
            img.height = opts.size || 22;
            img.style.cssText =
                "width:" +
                (opts.size || 22) +
                "px;height:" +
                (opts.size || 22) +
                "px;object-fit:cover;border-radius:3px;border:1px solid " +
                (avi.color || "#4a7c23") +
                ";background:" +
                (avi.color || "#4a7c23") +
                "22;";
            img.src = `${origin()}/${aviIb(pub)}`;
            wrap.appendChild(img);
        }
        const lab = document.createElement("span");
        const name = avi?.alias || avi?.name || short(pub);
        lab.textContent = name + (opts.suffix || "");
        lab.title = (avi?.bio ? avi.bio + "\n" : "") + pub;
        wrap.appendChild(lab);
        return wrap;
    };

    const maySeeAvi = async (pub, my) => {
        if (!pub) return false;
        if (pub === my) return true;
        const l = lobby();
        if (!l?.isTrusted) return false;
        const t = await l.isTrusted(pub).catch(() => null);
        return !!t?.trusted;
    };

    const paintRosterRow = async (li, pub, ctx = {}) => {
        const span = ctx.span;
        if (!span) return;
        span.replaceChildren();
        const suffix =
            (pub === ctx.op ? " (OP)" : "") + (pub === ctx.myPub ? " (you)" : "");
        const see = await maySeeAvi(pub, ctx.myPub);
        const live = see ? await loadAvi(pub).catch(() => null) : null;
        if (see && live?.ok) {
            span.appendChild(paintChip(pub, live.avi, { suffix }));
            if (live.links.length) {
                const more = document.createElement("span");
                more.style.cssText = "opacity:0.65;font-size:11px;margin-left:0.35rem;";
                more.textContent = "· " + live.links.length + " link(s)";
                more.title = live.links.join("\n");
                span.appendChild(more);
            }
        } else {
            span.textContent = pub + suffix;
            span.title = see ? pub : "trust this key to see their avi";
        }
    };

    const paintByCell = async (td, pub, ctx = {}) => {
        td.replaceChildren();
        const me =
            ctx.myPub ||
            (ctx.mine ? pub : (await lobby()?.lobbyKey?.().catch(() => null))?.publicKey) ||
            "";
        const suffix = pub && pub === me ? " (you)" : "";
        const see = await maySeeAvi(pub, me);
        const live = see ? await loadAvi(pub).catch(() => null) : null;
        if (see && live?.ok) td.appendChild(paintChip(pub, live.avi, { size: 16, suffix }));
        else td.textContent = short(pub) + suffix;
        td.title = pub || "";
    };

    const fillAviForm = (box, d, note) => {
        const $ = (s) => box.querySelector(s);
        $("[data-f=alias]").value = d.avi.alias || "";
        $("[data-f=name]").value = d.avi.name || "";
        $("[data-f=color]").value = d.avi.color || "#4a7c23";
        $("[data-f=bio]").value = d.avi.bio || "";
        if (note) note.textContent = d.pngSha ? "thumb sha " + d.pngSha.slice(0, 12) + "…" : "pick a png, then publish";
    };

    const wireAviForm = (box, { onPublished } = {}) => {
        const $ = (s) => box.querySelector(s);
        const note = $("[data-note]");
        $("[data-f=file]").addEventListener("change", async (ev) => {
            const f = ev.target.files?.[0];
            if (!f) return;
            const buf = new Uint8Array(await f.arrayBuffer());
            const d = await ensureDraft();
            d.png = buf;
            d.pngSha = await sha256Hex(buf);
            note.textContent = "thumb " + f.name + " · " + d.pngSha.slice(0, 12) + "…";
        });
        const pull = async () => {
            const d = await ensureDraft();
            d.avi.alias = $("[data-f=alias]").value.trim();
            d.avi.name = $("[data-f=name]").value.trim();
            d.avi.color = $("[data-f=color]").value.trim() || "#4a7c23";
            d.avi.bio = $("[data-f=bio]").value.trim();
            return d;
        };
        $("[data-act=pub]").addEventListener("click", async () => {
            await pull();
            try {
                note.textContent = await publishWithBin();
                onPublished?.();
            } catch (e) {
                note.textContent = e.message || String(e);
            }
        });
    };

    const aviFormHtml = () => `<label>alias <input data-f="alias" style="width:100%;box-sizing:border-box;" /></label>
<label>name <input data-f="name" style="width:100%;box-sizing:border-box;" /></label>
<label>color <input data-f="color" style="width:100%;box-sizing:border-box;" /></label>
<label>bio <textarea data-f="bio" rows="2" style="width:100%;box-sizing:border-box;"></textarea></label>
<label>png <input data-f="file" type="file" accept="image/png" /></label>
<div data-note style="opacity:0.75;font-size:11px;margin:0.35rem 0;"></div>
<button type="button" data-act="pub">publish avi</button>`;

    /** Surfroster roster slot: dropdown to create/edit your own avi. */
    const paintAviPanel = async (el, ctx = {}) => {
        if (!el) return;
        el.replaceChildren();
        const fold = document.createElement("details");
        fold.style.margin = "0.35rem 0";
        const sum = document.createElement("summary");
        sum.style.cssText = "cursor:pointer;font-weight:700;";
        sum.textContent = "your avi";
        sum.title = "publish a signed thumbnail + alias for your lobby key";
        const box = document.createElement("div");
        box.style.cssText = "margin:0.35rem 0;font-size:12px;";
        box.innerHTML = aviFormHtml();
        fold.append(sum, box);
        el.appendChild(fold);
        const d = await ensureDraft();
        fillAviForm(box, d, box.querySelector("[data-note]"));
        wireAviForm(box, { onPublished: ctx.onPublished });
    };

    const buildFrame = async (d) => {
        const pub = d.avi.pubkey;
        const ib = aviIb(pub);
        const data = {
            parts: ["network_proposal", "ibgib_frame", "manifest", "json"],
            park: "defer",
            contract: CONTRACT,
            content_type: "image/png",
            default_method: "GET",
            method: {
                GET: { kind: "bin" },
                PUT: { kind: "commit" },
                PATCH: { kind: "commit" },
            },
            avi: {
                contract: CONTRACT,
                pubkey: pub,
                alias: String(d.avi.alias || "").slice(0, 64),
                name: String(d.avi.name || "").slice(0, 64),
                color: hexColor(d.avi.color) ? d.avi.color : "#4a7c23",
                bio: String(d.avi.bio || "").slice(0, 280),
                style: String(d.avi.style || "").slice(0, 128),
            },
            n: d.parentAddr ? Number(d.n || 0) + 1 : 0,
            timestamp: new Date().toUTCString(),
        };
        const rel8ns = {
            policy: [POLICY_IB],
            past: d.parentAddr ? [d.parentAddr] : [],
            tjp: [],
            dna: [],
        };
        if (d.pngSha) rel8ns.bin = [`bin ${d.pngSha}`];
        if (d.links?.length) rel8ns.links = d.links.map(String);
        const gib = (await sha256Hex(JSON.stringify(data))).toUpperCase();
        return { ib, gib, data, rel8ns };
    };

    const publish = async () => {
        const l = lobby();
        if (!l?.commit) throw new Error("mount scranton_lobby first (needs tokens + sign)");
        const d = await ensureDraft();
        if (!d.png && !d.pngSha) throw new Error("set a png thumbnail first (avatar thumb … or the dropdown file picker)");
        if (d.png && !d.pngSha) d.pngSha = await sha256Hex(d.png);
        const live = await loadAvi(d.avi.pubkey, { fresh: true });
        if (live.ok) {
            d.parentAddr = live.addr;
            d.n = live.n;
        }
        const frame = await buildFrame(d);
        const extra = {};
        if (d.png) {
            extra.bin = {
                sha256: d.pngSha,
                bytes_b64: btoa(String.fromCharCode(...d.png)),
                content_type: "image/png",
            };
        }
        const envelope = {
            transform: d.parentAddr ? "mut8" : "firstGen",
            newIbGib: frame,
            dnas: [],
            intermediateIbGibs: [],
            ...extra,
        };
        const signer = await l.lobbyKey();
        const out = await l.commit(frame.ib, frame, {
            parentAddr: d.parentAddr,
            sign: true,
            signer,
        });
        cache.delete(d.avi.pubkey);
        d.parentAddr = out.addr;
        d.n = frame.data.n;
        return `published ${frame.ib} → ${out.addr}`;
    };

    // commit() on lobby doesn't attach envelope.bin. PUT ourselves when we have png bytes.
    const publishWithBin = async () => {
        const l = lobby();
        if (!l?.writeHeaders || !l?.putWithToken && !navi.tokens) {
            /* fall through */
        }
        const d = await ensureDraft();
        if (!d.png && !d.pngSha) throw new Error("set a png thumbnail first");
        if (d.png && !d.pngSha) d.pngSha = await sha256Hex(d.png);
        const live = await loadAvi(d.avi.pubkey, { fresh: true });
        if (live.ok) {
            d.parentAddr = live.addr;
            d.n = live.n;
        }
        const frame = await buildFrame(d);
        const envelope = {
            transform: d.parentAddr ? "mut8" : "firstGen",
            newIbGib: frame,
            dnas: [],
            intermediateIbGibs: [],
        };
        if (d.png) {
            let b64;
            if (typeof Buffer !== "undefined") b64 = Buffer.from(d.png).toString("base64");
            else {
                let bin = "";
                d.png.forEach((c) => (bin += String.fromCharCode(c)));
                b64 = btoa(bin);
            }
            envelope.bin = { sha256: d.pngSha, bytes_b64: b64, content_type: "image/png" };
        }
        const tokens = navi.tokens;
        const host = origin();
        let pay = null;
        let token = "";
        if (typeof tokens.pay === "function") {
            pay = await tokens.pay(host);
            if (pay.mode === "reserve") tokens.attach?.(frame, pay);
            else token = pay.token;
        } else {
            token = await tokens.take(host);
        }
        const body = JSON.stringify(envelope);
        const headers = await l.writeHeaders(frame.ib, body, {
            sign: true,
            parentAddr: d.parentAddr,
            signer: await l.lobbyKey(),
        });
        if (token) headers["X-Foobarch-Usage-Token"] = token;
        const res = await fetch(`${host}/${frame.ib}`, { method: "PUT", headers, body });
        const text = await res.text();
        if (!res.ok) {
            if (token && !/consumed|invalid usage token/i.test(text)) await tokens.giveBack(host, token);
            throw new Error(`PUT ${frame.ib} → ${res.status}: ${text.slice(0, 400)}`);
        }
        const result = JSON.parse(text);
        cache.delete(d.avi.pubkey);
        d.parentAddr = result.addr;
        d.n = frame.data.n;
        return `published ${frame.ib} → ${result.addr}`;
    };

    const openPanel = async () => {
        if (typeof document === "undefined") throw new Error("browser only");
        const existing = document.getElementById("scranton-avatar-panel");
        existing?.remove();
        const box = document.createElement("div");
        box.id = "scranton-avatar-panel";
        box.style.cssText =
            "position:fixed;z-index:99999;right:1rem;bottom:1rem;width:20rem;padding:0.75rem;background:#111;color:#efe;border:2px solid #4a7c23;font:13px/1.35 ui-monospace,Consolas,monospace;box-shadow:4px 4px 0 #1a330d;";
        box.innerHTML =
            `<div style="font-weight:700;margin:0 0 0.4rem;color:#9fd46a;">scranton_avatar</div>` +
            aviFormHtml() +
            `<div style="margin-top:0.35rem;"><button type="button" data-act="x">close</button></div>`;
        document.body.appendChild(box);
        createdElements.push(box);
        const d = await ensureDraft();
        fillAviForm(box, d, box.querySelector("[data-note]"));
        wireAviForm(box);
        box.querySelector("[data-act=x]").addEventListener("click", () => box.remove());
    };

    const resolveDropdown = () => {
        const dd = navi?.mod?.supermouse_plugin_dropdown?.dropdown;
        return dd && typeof dd.registerPluginMenu === "function" ? dd : null;
    };

    const dropdownMenu = {
        id: NAME,
        label: "scranton_avatar",
        build: () => [
            { label: "create / edit…", onClick: () => void openPanel().catch((e) => say(e.message || e)) },
            {
                label: "show mine",
                onClick: async () => {
                    const pub = await myPub();
                    const live = await loadAvi(pub, { fresh: true });
                    say(live.ok ? `${live.avi.alias || live.avi.name} · ${live.ib}` : "no avi yet — create / edit");
                },
            },
        ],
    };

    const hookDropdown = () => {
        const dd = resolveDropdown();
        if (!dd || unmenu) return !!unmenu;
        unmenu = dd.registerPluginMenu(dropdownMenu);
        if (typeof dd.registerRootMenu === "function") {
            unroot = dd.registerRootMenu({
                id: NAME,
                label: "scranton_avatar",
                action: () => void openPanel().catch((e) => say(e.message || e)),
            });
        }
        return true;
    };

    const run = async (...raw) => {
        const args = raw.flatMap((a) => String(a ?? "").split(/\s+/)).filter(Boolean);
        const cmd = String(args[0] || "").toLowerCase();
        if (!cmd || cmd === "help") return HELP;
        if (cmd === "show") {
            const pub = args[1] || (await myPub());
            const live = await loadAvi(pub, { fresh: true });
            if (!live.ok) return `no avi at ${aviIb(pub)}`;
            return JSON.stringify({ ib: live.ib, addr: live.addr, avi: live.avi, links: live.links }, null, 2);
        }
        if (cmd === "set") {
            const field = String(args[1] || "").toLowerCase();
            const val = args.slice(2).join(" ");
            const d = await ensureDraft();
            if (!["alias", "name", "color", "bio", "style"].includes(field)) return "scranton_avatar set alias|name|color|bio|style <value>";
            if (field === "color" && val && !hexColor(val)) return "color must be #rrggbb";
            d.avi[field] = val;
            return `draft ${field} = ${val}`;
        }
        if (cmd === "thumb") {
            const path = encodePath(args.slice(1).join(" "));
            if (!path) return "scranton_avatar thumb <park path>";
            const res = await fetch(`${origin()}/${path}`);
            if (!res.ok) throw new Error(`${path} → ${res.status}`);
            const buf = new Uint8Array(await res.arrayBuffer());
            const d = await ensureDraft();
            d.png = buf;
            d.pngSha = await sha256Hex(buf);
            return `draft thumb sha ${d.pngSha}`;
        }
        if (cmd === "link") {
            const op = String(args[1] || "").toLowerCase();
            const addr = args[2] || "";
            const d = await ensureDraft();
            if (op === "add" && addr) {
                if (!d.links.includes(addr)) d.links.push(addr);
                return `draft links ${d.links.length}`;
            }
            if (op === "rm" && addr) {
                d.links = d.links.filter((x) => x !== addr);
                return `draft links ${d.links.length}`;
            }
            return "scranton_avatar link add|rm <ib^gib>";
        }
        if (cmd === "publish") return await publishWithBin();
        return HELP;
    };

    const onTick = () => {
        if (!unmenu) hookDropdown();
    };

    return {
        name: NAME,
        version: VERSION,
        description: "trusted avi cards — thumbnail + alias only after you trust the pubkey",
        moduleInfo: {
            name: NAME,
            version: VERSION,
            description: "park scranton_avatar; avis at scranton/avatar/{pubkey}; surfroster paints trusted only",
            acknowledges: ["scranton/avatar", "scranton/lobby/v1"],
        },
        dropdownMenu,
        paintRosterRow,
        paintByCell,
        paintAviPanel,
        loadAvi,
        aviIb,
        commands: {
            scranton_avatar: {
                name: "scranton_avatar",
                description: "avi create / show / publish for your lobby pubkey",
                execute: async (...a) => {
                    try {
                        return await run(...a);
                    } catch (e) {
                        return `error: ${e.message || e}`;
                    }
                },
            },
        },
        onMount: () => {
            hookDropdown();
            const t = setInterval(onTick, 1500);
            timers.push(t);
            console.log(`[scranton_avatar] ${VERSION} — park ${MOD_PARK}; avis ${ROOT}/{pubkey}`);
        },
        onUnmount: () => {
            if (typeof unmenu === "function") unmenu();
            if (typeof unroot === "function") unroot();
            unmenu = unroot = null;
            for (const { target, type, fn, opts } of eventListeners) {
                try {
                    target.off?.(type, fn);
                    target.removeEventListener?.(type, fn, opts);
                } catch {
                    /* ignore */
                }
            }
            for (const t of timers) clearTimeout(t);
            for (const o of observers) o.disconnect?.();
            for (const el of createdElements) el.remove?.();
            for (const s of addedStyles) s.remove?.();
            document.getElementById("scranton-avatar-panel")?.remove();
        },
    };
};
