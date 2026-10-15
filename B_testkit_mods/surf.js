/**
 * surf, stage branch — the shell's built-in surf (navi_shell surf 1.8.16, the embedded branch)
 * with stage compatibility. Same module name and verb; hostparked at `surf` and listed on warez.
 * warez_updater check surf swaps it in (unmounts surf, then loads the park by callin).
 *
 * Adds keepstage: surf -k / --no-k, surf -settings keepstage <true|false>.
 * The current stage's members follow the surf and land behind the new page's members in each
 * slot (new CS0 stays CS0, old CS0 becomes CS1). Members marked data-unstage-on-leave stay behind.
 * With members to keep and no stage on the new page, the surf lands on a proscene stage.
 *
 * The shell replants its built-in surf on every boot; this one takes over once remounted.
 */
export const register = (navi) => {
                const SURF_TIP = "surf";
                const NAVI_MODULE_MIME = "application/navi-module";
                const IB_GIB_HEADER = "x-ib^gib";
                const DEFAULT_SETTINGS = { savesurfs: false, proscene: false, keepstage: false };
                const SETTINGS_BACKUP = "surf_settings_backup";
                const SHELTER_PART = "surf-shelter";
                /** @type {Set<Element>} insertion-ordered immune nodes (strong refs). */
                const persisted = new Set();
                let shelterEl = null;

                function getBaseMime(contentType) {
                    return String(contentType || "").split(";")[0].trim().toLowerCase();
                }

                function isNaviModuleMime(contentType) {
                    return getBaseMime(contentType) === NAVI_MODULE_MIME;
                }

                function isJavaScriptMime(contentType) {
                    const base = getBaseMime(contentType);
                    return base === "text/javascript" || base === "application/javascript" || base === "application/x-javascript";
                }

                function isNaviModuleSource(content) {
                    const hasRegister = /export\s+(?:const|function)\s+register\s*[=({]/.test(content);
                    const hasModuleInfo = /export\s+const\s+moduleInfo\s*=\s*\{[^}]*\bname\s*:\s*["'][^"']+["']/.test(content);
                    const hasDefaultExport = /export\s+default\s+\{[^}]*\bname\s*:\s*["'][^"']+["']/.test(content);
                    return hasRegister || (hasModuleInfo && hasDefaultExport);
                }

                function isNaviModule(content, contentType) {
                    if (isNaviModuleMime(contentType)) return true;
                    return isJavaScriptMime(contentType) && isNaviModuleSource(content);
                }

                /**
                 * slashfold — typed whitespace → / (like surf/browse arg join).
                 * Does NOT fold :, so navi:hypertext welcome → navi:hypertext/welcome.
                 * Preserves // stage delimiters. Absolute URLs unchanged.
                 * String → string; Uint8Array/ArrayBufferView → same type (utf-8).
                 * @see A_document/slashfold.md
                 */
                function slashfoldString(raw) {
                    let s = String(raw == null ? "" : raw).trim();
                    if (!s) return "";
                    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s;
                    return s
                        .replace(/\s+/g, "/")
                        .replace(/^\/+/, "")
                        .replace(/\/{3,}/g, "//");
                }

                async function storageKeyExists(s) {
                    try {
                        if (navi.storage && navi.storage.tip && typeof navi.storage.tip.get === "function") {
                            const tip = await navi.storage.tip.get(s);
                            if (tip) return true;
                        }
                    } catch (e) { /* ignore */ }
                    return false;
                }

                /**
                 * slashfold — typed whitespace → / unless the exact storage key exists.
                 * If the string has whitespace and that tip/file key is present, keep it.
                 * Else whitespace → / (keeps navi: and //). Absolute URLs unchanged.
                 * Async. @see A_document/slashfold.md
                 */
                async function slashfold(input) {
                    if (input == null) return input;
                    const foldText = async (text) => {
                        const s = String(text == null ? "" : text).trim();
                        if (!s) return "";
                        if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s;
                        if (/\s/.test(s) && await storageKeyExists(s)) return s;
                        return slashfoldString(s);
                    };
                    if (typeof input === "string") return await foldText(input);
                    if (typeof Uint8Array !== "undefined" && input instanceof Uint8Array) {
                        const text = new TextDecoder().decode(input);
                        return new TextEncoder().encode(await foldText(text));
                    }
                    if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView && ArrayBuffer.isView(input)) {
                        const u8 = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
                        const text = new TextDecoder().decode(u8);
                        const out = new TextEncoder().encode(await foldText(text));
                        if (input instanceof Uint8Array) return out;
                        return out;
                    }
                    return await foldText(String(input));
                }

                async function ensureSettings() {
                    const tip = await navi.storage.tip.get(SURF_TIP);
                    if (!tip || !tip.data) {
                        throw new Error("[surf] " + SURF_TIP + " tip missing");
                    }
                    if (!tip.data.settings || typeof tip.data.settings !== "object") {
                        const kept = await readSettingsBackup();
                        await navi.storage.tip.mut8(SURF_TIP, {
                            settings: Object.assign({}, DEFAULT_SETTINGS, kept || {})
                        });
                        navi.callout("[surf] " + (kept ? "Restored" : "Initialized") + " settings on " + SURF_TIP);
                        const again = await navi.storage.tip.get(SURF_TIP);
                        return again.data.settings;
                    }
                    return tip.data.settings;
                }

                /**
                 * Pinning a hostparked surf replaces the local surf tip and its data.settings,
                 * so settings are mirrored in a storage item and restored from it.
                 */
                async function readSettingsBackup() {
                    try {
                        const kept = await navi.storage.item.get(SETTINGS_BACKUP);
                        return kept && typeof kept === "object" ? kept : null;
                    } catch {
                        return null;
                    }
                }

                async function writeSettingsBackup(settings) {
                    try {
                        await navi.storage.item.set(SETTINGS_BACKUP, Object.assign({}, settings));
                    } catch { /* tip copy still holds them */ }
                }

                async function saveSettings(settings) {
                    await navi.storage.tip.mut8(SURF_TIP, { settings: settings });
                    await writeSettingsBackup(settings);
                }

                /** surf -settings [proscene|keepstage|savesurfs] [true|false]. */
                async function setSurfSetting(key, value) {
                    const settings = await ensureSettings();
                    if (!key) {
                        return "proscene: " + !!settings.proscene + "\nkeepstage: " + !!settings.keepstage;
                    }
                    const notes = {
                        proscene: "surf lands in Center Stage; surf --no-p for body",
                        keepstage: "stage members ride along behind the new page's; surf --no-k to drop them",
                        savesurfs: "",
                    };
                    if (!Object.prototype.hasOwnProperty.call(notes, key)) {
                        return "Unknown setting: " + key + " (proscene, keepstage)";
                    }
                    if (value === undefined || value === "") return key + ": " + !!settings[key];
                    const enabled = value === "true" || value === "1" || value === "on";
                    settings[key] = enabled;
                    await saveSettings(settings);
                    return key + " set to " + enabled + (enabled && notes[key] ? " (" + notes[key] + ")" : "");
                }

                async function saveResourceBin(media, mime) {
                    return await navi.storage.bin.putMedia({ media: media, mime: mime });
                }

                /** Sync install id for data-hash (same scheme as horizon_stagedir). */
                function hashContentSync(text) {
                    const s = String(text == null ? "" : text);
                    let h = 0x811c9dc5;
                    for (let i = 0; i < s.length; i++) {
                        h ^= s.charCodeAt(i);
                        h = Math.imul(h, 0x01000193);
                    }
                    const stamp =
                        Date.now().toString(16) +
                        (Math.floor(Math.random() * 0x10000) >>> 0)
                            .toString(16)
                            .padStart(4, "0");
                    return (
                        (h >>> 0).toString(16).padStart(8, "0") +
                        s.length.toString(16).padStart(6, "0") +
                        stamp
                    );
                }

                function stampDataHash(el, contentHash) {
                    if (!el || el.nodeType !== 1 || !contentHash) return;
                    if (el.hasAttribute("data-hash")) return;
                    el.setAttribute("data-hash", String(contentHash));
                }

                async function loadResourceFromTip(ib) {
                    const media = await navi.storage.bin.mediaFromTip(ib);
                    return { mime: NAVI_MODULE_MIME, media: media };
                }

                async function makeRequest(path, options = {}) {
                    const raw = String(path == null ? "" : path).trim();
                    const local = await navi.park.check(raw, {
                        gatePassthru: (function (h) {
                            if (!h) return false;
                            const v = String(h["X-Navi-Gate-Passthru"] || h["x-navi-gate-passthru"] || "").trim().toLowerCase();
                            return v === "1" || v === "true" || v === "yes";
                        })(options && options.headers)
                    });
                    if (local && local.hit) {
                        return {
                            content: local.body,
                            contentType: local.mime || "application/octet-stream",
                            ibGib: local.ib || null
                        };
                    }

                    const url = encodeURI(navi.resolveUrl(path));
                    const headers = Object.assign({
                        "Accept": "text/plain, text/javascript, application/javascript, application/navi-module",
                        "Content-Type": "text/plain"
                    }, options && options.headers ? options.headers : {});

                    const response = await globalThis.fetch(url, {
                        method: options.method || "GET",
                        headers
                    });
                    if (!response.ok) {
                        throw new Error("HTTP " + response.status + ": " + response.statusText);
                    }

                    const content = await response.text();
                    const contentType = response.headers.get("content-type") || "";
                    const ibGib = response.headers.get(IB_GIB_HEADER);
                    return { content, contentType, ibGib };
                }

                function ensureShelter() {
                    if (typeof document === "undefined" || !document.documentElement) {
                        throw new Error("[surf] persist shelter requires a document");
                    }
                    if (shelterEl && shelterEl.isConnected) return shelterEl;
                    shelterEl = document.createElement("div");
                    shelterEl.setAttribute("data-part", SHELTER_PART);
                    shelterEl.setAttribute("hidden", "");
                    shelterEl.style.display = "none";
                    document.documentElement.appendChild(shelterEl);
                    return shelterEl;
                }

                /** Move a live node via moveBefore() when both ends are connected, so iframes/video keep state. */
                function placeLive(parent, el, ref) {
                    const before = ref || null;
                    if (typeof parent.moveBefore === "function" && el.isConnected && parent.isConnected) {
                        try {
                            parent.moveBefore(el, before);
                            return;
                        } catch { /* fall through */ }
                    }
                    parent.insertBefore(el, before);
                }

                function persist(el) {
                    if (!el || el.nodeType !== 1) {
                        throw new Error("[surf] persist requires an Element");
                    }
                    persisted.add(el);
                    return el;
                }

                function unpersist(el) {
                    return persisted.delete(el);
                }

                function isPersisted(el) {
                    return persisted.has(el);
                }

                function listPersisted() {
                    return Array.from(persisted);
                }

                function parkPersisted() {
                    if (!document.body || persisted.size === 0) return;
                    const shelter = ensureShelter();
                    for (const el of Array.from(persisted)) {
                        if (document.body.contains(el)) {
                            placeLive(shelter, el);
                        }
                    }
                }

                function restorePersisted() {
                    if (!document.body) return;
                    for (const el of Array.from(persisted)) {
                        if (el.isConnected) {
                            placeLive(document.body, el);
                        } else {
                            persisted.delete(el);
                        }
                    }
                }

                /** stagejockey's prosceneBody(nodes) → CS element, or null when not mounted. */
                function findProsceneBody() {
                    const mods = navi.mod || {};
                    const direct = mods.supermouse_plugin_stagejockey;
                    if (direct && typeof direct.prosceneBody === "function") return direct.prosceneBody;
                    for (const key of Object.keys(mods)) {
                        if (typeof mods[key]?.prosceneBody === "function") return mods[key].prosceneBody;
                    }
                    return null;
                }

                const STAGE_SLOT_IDS = ["USL", "USC", "USR", "SL", "CS", "SR", "DSL", "DSC", "DSR"];
                /** Left columns index inside-out: logical 0 is the DOM-last child. */
                const STAGE_LEFT_SLOTS = new Set(["USL", "SL", "DSL"]);

                function stageRootIn(el) {
                    return el ? el.querySelector('[data-part~="stage"]') : null;
                }

                function stageColumn(root, slot) {
                    for (const el of Array.from(root.querySelectorAll("#" + slot))) {
                        if (el.closest('[data-part~="stage"]') === root) return el;
                    }
                    return null;
                }

                function isStageOccupant(el) {
                    if (!el || el.nodeType !== 1) return false;
                    if (el.hasAttribute("data-stagejockey-shield")) return false;
                    return !(String(el.tagName).toUpperCase() === "BR" && el.hasAttribute("data-stagedir-sep"));
                }

                /**
                 * keepstage: lift the current stage's members out of their columns, by slot in
                 * logical order, into the shelter (still connected, so they keep state).
                 * Members marked data-unstage-on-leave are left behind.
                 */
                function liftStage() {
                    const root = stageRootIn(document.body);
                    const carried = {};
                    let count = 0;
                    if (!root) return { carried, count };
                    const shelter = ensureShelter();
                    for (const slot of STAGE_SLOT_IDS) {
                        const col = stageColumn(root, slot);
                        if (!col) continue;
                        let kids = Array.from(col.children).filter(isStageOccupant);
                        if (STAGE_LEFT_SLOTS.has(slot)) kids = kids.reverse();
                        kids = kids.filter((el) => !el.hasAttribute("data-unstage-on-leave"));
                        if (!kids.length) continue;
                        for (const el of kids) placeLive(shelter, el);
                        carried[slot] = kids;
                        count += kids.length;
                    }
                    return { carried, count };
                }

                /** Append lifted members after the new stage's own: new CS0 stays CS0, old CS0 becomes CS1. */
                function landStage(carried) {
                    const root = stageRootIn(document.body);
                    const sep = navi.mod && navi.mod.stagedir && navi.mod.stagedir.stage;
                    let homeless = 0;
                    for (const slot of Object.keys(carried)) {
                        const col = root ? stageColumn(root, slot) || stageColumn(root, "CS") : null;
                        if (!col) {
                            for (const el of carried[slot]) placeLive(document.body, el);
                            homeless += carried[slot].length;
                            continue;
                        }
                        const left = STAGE_LEFT_SLOTS.has(col.id);
                        for (const el of carried[slot]) {
                            placeLive(col, el, left ? col.firstChild : null);
                        }
                        if (sep && typeof sep.syncMemberSeparators === "function") {
                            try { sep.syncMemberSeparators(col); } catch { /* ignore */ }
                        }
                    }
                    if (homeless) navi.callout("[surf] keepstage: no stage to land on; " + homeless + " member(s) appended to body");
                }

                /** First hypertext htmf path in a fetched page, as a URL (/hypertext/enter). */
                function hypertextUrlFromHtml(html) {
                    const m = String(html || "").match(/data-path="(hypertext\/[^"]+)"/);
                    if (!m) return "";
                    const at = m.index || 0;
                    const around = String(html).slice(Math.max(0, at - 120), at + m[0].length + 80);
                    if (!around.includes('data-part="htmf"') && !around.includes("data-part='htmf'")) return "";
                    return "/" + m[1].replace(/^\/+/, "");
                }

                function currentHistoryPath() {
                    try {
                        const stored = sessionStorage.getItem("htmx-current-path-for-history");
                        if (stored) return stored;
                    } catch { /* ignore */ }
                    return (location.pathname || "/") + (location.search || "");
                }

                /** Same snapshot HTMX writes before hx-push-url: body HTML, title, scroll. */
                function snapshotHtmxHistory() {
                    if (typeof sessionStorage === "undefined" || typeof document === "undefined") return;
                    if (document.querySelector('[hx-history="false" i],[data-hx-history="false" i]')) return;
                    const historyElt = document.querySelector("[hx-history-elt],[data-hx-history-elt]") || document.body;
                    if (!historyElt) return;
                    const path = currentHistoryPath();
                    const clone = historyElt.cloneNode(true);
                    clone.querySelectorAll(".htmx-request").forEach((el) => el.classList.remove("htmx-request"));
                    clone.querySelectorAll("[data-disabled-by-htmx]").forEach((el) => el.removeAttribute("disabled"));
                    const item = { url: path, content: clone.innerHTML, title: document.title, scroll: window.scrollY };
                    let cache = [];
                    try {
                        cache = JSON.parse(sessionStorage.getItem("htmx-history-cache") || "[]") || [];
                    } catch { cache = []; }
                    if (!Array.isArray(cache)) cache = [];
                    for (let i = 0; i < cache.length; i++) {
                        if (cache[i] && cache[i].url === path) {
                            cache.splice(i, 1);
                            break;
                        }
                    }
                    cache.push(item);
                    const cap = (globalThis.htmx && globalThis.htmx.config && globalThis.htmx.config.historyCacheSize) || 10;
                    while (cache.length > cap) cache.shift();
                    try { sessionStorage.setItem("htmx-history-cache", JSON.stringify(cache)); } catch { /* quota */ }
                    try { history.replaceState({ htmx: true }, document.title, location.href); } catch { /* ignore */ }
                }

                /**
                 * Record the page we are leaving, before its DOM is replaced.
                 * Boot at / replaces the current history entry. A later surf pushes.
                 */
                function planHypertextHistory(url) {
                    if (!url || typeof location === "undefined" || typeof history === "undefined") return null;
                    const here = (location.pathname || "/") + (location.search || "");
                    if (here === url || location.pathname === url) return null;
                    const atRoot = location.pathname === "/" || location.pathname === "";
                    if (!atRoot) snapshotHtmxHistory();
                    return { url: url, replace: atRoot };
                }

                function commitHypertextHistory(plan) {
                    if (!plan) return;
                    try {
                        if (plan.replace) history.replaceState({ htmx: true }, document.title, plan.url);
                        else history.pushState({ htmx: true }, "", plan.url);
                        sessionStorage.setItem("htmx-current-path-for-history", plan.url);
                    } catch { /* ignore */ }
                }

                async function surf(path, opts = {}) {
                    if (typeof document === "undefined" || !document.body) {
                        navi.callout("[surf] surf requires a browser document");
                        throw new Error("[surf] surf requires a browser document");
                    }
                    // HTTP fetch: spaces become %20 on the wire; park lookup turns them back.
                    // Do not park-check in-page — SW observers (snoopy) must see the GET.
                    // opts.host: X-Navi-Park-Bypass → SW skips localpark, answer comes from the host.
                    const url = encodeURI(navi.resolveUrl(path));
                    const headers = { Accept: "text/html, text/plain, image/*" };
                    if (opts.host) headers["X-Navi-Park-Bypass"] = "1";
                    const response = await globalThis.fetch(url, { headers });
                    if (!response.ok) {
                        throw new Error("HTTP " + response.status + ": " + response.statusText);
                    }
                    const parkIb = response.headers.get("X-Navi-Park-Ib");
                    const parkKind = response.headers.get("X-Navi-Park-Kind");
                    if (parkIb) {
                        navi.callout(
                            "[surf] park hit " + parkIb + " (" + (parkKind || "?") + ")"
                        );
                    }
                    const responseMime = String(response.headers.get("content-type") || "")
                        .split(";")[0].trim().toLowerCase();
                    let html;
                    if (responseMime.startsWith("image/")) {
                        // A picture on its own. Localpark file bins may hold a data: URL string.
                        const blob = await response.blob();
                        const head = await blob.slice(0, 5).text();
                        const src = head === "data:" ? await blob.text() : URL.createObjectURL(blob);
                        const img = document.createElement("img");
                        img.src = src;
                        img.alt = String(path || "").split("/").pop() || "image";
                        img.setAttribute("data-path", String(path || "").replace(/^\/+/, ""));
                        html = img.outerHTML;
                    } else {
                        html = await response.text();
                    }
                    const contentHash = hashContentSync(html);
                    const hypertextPlan = planHypertextHistory(hypertextUrlFromHtml(html));
                    let settings = {};
                    try {
                        settings = await ensureSettings();
                    } catch { /* defaults */ }
                    let wantStage = opts.proscene;
                    if (wantStage === undefined) wantStage = !!settings.proscene;
                    const keepStage = opts.keepstage === undefined ? !!settings.keepstage : !!opts.keepstage;
                    parkPersisted();
                    const lifted = keepStage ? liftStage() : { carried: {}, count: 0 };
                    const template = document.createElement("template");
                    template.innerHTML = html;
                    const nodes = Array.from(template.content.childNodes);
                    // Content that brings its own stage (horizon/v1, jockeystage) lands as-is.
                    const ownStage = nodes.some((n) => n.nodeType === 1 && (
                        n.matches('[data-part~="stage"]') || n.querySelector('[data-part~="stage"]')
                    ));
                    // Kept members need a stage to land on.
                    if (lifted.count && opts.proscene !== false) wantStage = true;
                    const prosceneBody = wantStage && !ownStage ? findProsceneBody() : null;
                    if (wantStage && !ownStage && !prosceneBody) {
                        navi.callout("[surf] proscene needs supermouse_plugin_stagejockey mounted; surfing into body");
                    }
                    let holder = document.body;
                    if (prosceneBody) {
                        holder = prosceneBody(nodes);
                    } else {
                        document.body.replaceChildren(...nodes);
                    }
                    for (const node of Array.from(holder.children)) {
                        if (node.nodeType === 1) {
                            stampDataHash(node, contentHash);
                            // Nested data-part roots (e.g. enter htmf inside horizon/v1)
                            // get their own install hash from their outerHTML.
                            try {
                                for (const part of Array.from(
                                    node.querySelectorAll("[data-part]")
                                )) {
                                    if (
                                        part instanceof HTMLElement &&
                                        !part.hasAttribute("data-hash")
                                    ) {
                                        stampDataHash(
                                            part,
                                            hashContentSync(part.outerHTML)
                                        );
                                    }
                                }
                            } catch {
                                /* ignore */
                            }
                        }
                    }
                    holder.querySelectorAll("script").forEach((oldScript) => {
                        const script = document.createElement("script");
                        for (const attr of oldScript.attributes) {
                            script.setAttribute(attr.name, attr.value);
                        }
                        script.textContent = oldScript.textContent;
                        oldScript.replaceWith(script);
                    });
                    const htmxApi = globalThis.htmx;
                    if (htmxApi && typeof htmxApi.process === "function") {
                        for (const node of Array.from(holder.children)) {
                            if (node.nodeType === 1) {
                                htmxApi.process(node);
                            }
                        }
                    }
                    if (lifted.count) landStage(lifted.carried);
                    restorePersisted();
                    commitHypertextHistory(hypertextPlan);
                    // Page landed. Settings and other surf commands never reach here,
                    // so listeners (scranton follow) see the page, not the command line.
                    try { navi.emit?.("surf", String(path || "").replace(/^\/+/, "")); } catch { /* ignore */ }
                    return "[surf] Surfing " + url + (lifted.count ? " (kept " + lifted.count + " stage member(s))" : "");
                }

                /**
                 * Full document load of origin / — PWA stand-in for a hard
                 * browser navigate/reload of the shell (re-run navi_shell + init).
                 */
                function surfrefresh() {
                    if (typeof window === "undefined" || !window.location) {
                        throw new Error("[surf] surfrefresh requires a browser window");
                    }
                    const root = window.location.origin + "/";
                    const atRoot =
                        (window.location.pathname === "/" || window.location.pathname === "")
                        && !window.location.search
                        && !window.location.hash;
                    if (atRoot) {
                        window.location.reload();
                    } else {
                        window.location.replace(root);
                    }
                    return "[surf] surfrefresh " + root;
                }

                async function browse(route, options = {}) {
                    try {
                        const { content, contentType, ibGib } = await makeRequest(route, options);
                        const settings = await ensureSettings();
                        const baseMime = getBaseMime(contentType);
                        const naviModule = isNaviModule(content, contentType);
                        const saveMime = naviModule ? NAVI_MODULE_MIME : baseMime || "text/plain";

                        // browse is text-only: modules reveal their source, never auto-mount.
                        if (settings.savesurfs) {
                            const sha = await saveResourceBin(content, saveMime);
                            navi.callout("[surf] saved bin " + sha + (naviModule ? " (module)" : ""));
                        }

                        return content;
                    } catch (error) {
                        const msg = error && error.message ? error.message : String(error);
                        return "Error fetching " + route + ": " + msg;
                    }
                }

                function calloutMountError(summary, explain) {
                    const line = explain ? summary + " — " + explain : summary;
                    navi.callout(line);
                    return line;
                }

                async function mountFromTip(ib) {
                    const tipIb = String(ib || "").replace(/^\/+/, "");
                    try {
                        navi.callout("[surf] Loading tip: " + tipIb);
                        const entry = await loadResourceFromTip(tipIb);
                        if (!entry || !entry.media) {
                            return calloutMountError(
                                "Error: no bin on tip: " + tipIb,
                                "remount needs a planted park (tip navi:<name> with a bin); install via mount <route> first"
                            );
                        }
                        if (!isNaviModuleSource(entry.media)) {
                            return calloutMountError(
                                "Error: " + tipIb + " bin is not a Navi module",
                                "bin must export register (or moduleInfo + default export with name); browse the tip media to inspect"
                            );
                        }
                        await navi.mount(entry.media);
                        return "[surf] Mounted " + tipIb;
                    } catch (error) {
                        const msg = error && error.message ? error.message : String(error);
                        return calloutMountError(
                            "Error mounting tip " + tipIb + ": " + msg,
                            "loads tip bin, runs register(), syncs navi:mod; check syntax, register() return { name }, and park tips"
                        );
                    }
                }

                async function mount(target, options = {}) {
                    const raw = String(target || "").trim();
                    if (/^navi(?:[/:\s]|$)/.test(raw)) {
                        return await mountFromTip(raw);
                    }
                    // Route install always reads the host. A local tip on the same ib is often the
                    // frame JSON, and mount would refuse it; mount navi:<name> is the local remount.
                    try {
                        const url = encodeURI(navi.resolveUrl(raw));
                        const headers = Object.assign({
                            "Accept": "text/plain, text/javascript, application/javascript, application/navi-module",
                            "X-Navi-Park-Bypass": "1"
                        }, options && options.headers ? options.headers : {});
                        const response = await globalThis.fetch(url, { method: "GET", headers, cache: "no-store" });
                        if (!response.ok) {
                            throw new Error("HTTP " + response.status + ": " + response.statusText);
                        }
                        const content = await response.text();
                        const contentType = response.headers.get("content-type") || "";
                        if (!isNaviModule(content, contentType)) {
                            return calloutMountError(
                                "Error: " + target + " is not a Navi module",
                                "expected MIME application/navi-module or JS with export register; use browse to read the text (mount does not install HTML/JSON)"
                            );
                        }
                        const mod = await navi.mount(content);
                        const name = mod && mod.name ? String(mod.name) : "";
                        return name
                            ? "[surf] Installed & mounted navi:" + name
                            : "[surf] Installed & mounted " + target;
                    } catch (error) {
                        const msg = error && error.message ? error.message : String(error);
                        return calloutMountError(
                            "Error mounting " + target + ": " + msg,
                            "install fetches the route, runs register(), then plants tip+bin as navi:<name> from the live name"
                        );
                    }
                }

                async function unmount(modName, opts) {
                    const name = String(modName || "").trim();
                    const kill = !!(opts && opts.kill);
                    if (!name) {
                        return "Usage: unmount [-k] <modname>  (e.g. unmount pecklogger; -k also storage kills its park tip)";
                    }
                    const mod = navi.mod && navi.mod[name];
                    if (!mod) {
                        const known = typeof navi.listModules === "function"
                            ? navi.listModules().join(", ")
                            : Object.keys(navi.mod || {}).join(", ");
                        return calloutMountError(
                            "Error: navi.mod." + name + " is not mounted"
                                + (known ? " (mounted: " + known + ")" : ""),
                            "unmount drops a live register() module and removes it from the remount ledger (navi:mod); remount with mount navi:" +
                                name +
                                " if the park tip still exists"
                        );
                    }
                    try {
                        await navi.unmount(mod);
                    } catch (error) {
                        const msg = error && error.message ? error.message : String(error);
                        return calloutMountError(
                            "Error unmounting " + name + ": " + msg,
                            "onUnmount runs then the module is removed from navi.mod / navi:mod index"
                        );
                    }
                    if (!kill) return "[surf] Unmounted " + name;
                    try {
                        const killed = await navi.storage.kill(name);
                        return "[surf] Unmounted " + name + "\n" + killed;
                    } catch (error) {
                        const msg = error && error.message ? error.message : String(error);
                        return "[surf] Unmounted " + name + "\n[kill] not done: " + msg;
                    }
                }

                return {
                    name: "surf",
                    version: "1.9.6",
                    description: "Interactive CLI to interact with foobarch routing system",

                    moduleInfo: {
                        name: "surf",
                        version: "1.9.6",
                        description: "surf + keepstage (stage direction across surfs); tip/bin settings, data-hash FNV+ts+entropy"
                    },

                    commands: {
                        surf: {
                            name: "surf",
                            description: "Navigate to a foobarch route (fetch HTML, then swap)",
                            execute: async (segment, ...args) => {
                                if (segment === "-settings" || segment === "--settings") {
                                    const rest = args.flatMap((a) => String(a).split(/\s+/)).filter(Boolean);
                                    return await setSurfSetting(rest[0], rest[1]);
                                }
                                if (!segment) {
                                    return [
                                        "surf v1.9.6 (stage)",
                                        "",
                                        "Usage:",
                                        "  surf <route>              Navigate to route, render HTML (images shown on their own)",
                                        "  surf -h <route>           Same, but skip localpark: render what the host serves",
                                        "  surf -p <route>           Surf onto an empty proscene stage: content lands in Center Stage",
                                        "  surf --no-p <route>       Plain body surf even when -settings proscene is on",
                                        "  surf -k <route>           Keep the stage: current members follow, behind the new page's in each slot",
                                        "                            (new CS0 stays CS0, old CS0 becomes CS1); data-unstage-on-leave members drop",
                                        "  surf --no-k <route>       Drop the stage even when -settings keepstage is on",
                                        "  surf -settings            Show proscene and keepstage",
                                        "  surf -settings proscene <true|false>    every surf acts like -p (default false)",
                                        "  surf -settings keepstage <true|false>   every surf acts like -k (default false)",
                                        "  surfrefresh               Hard reload origin / (PWA page reload)",
                                        "  browse <route>            Fetch text; modules show source (no mount)",
                                        "  mount <route|navi:name> Plant tip+bin & mount, or remount from tip",
                                        "  unmount [-k] <modname>    Unmount navi.mod.<modname> (-k: then storage kill its tip)",
                                        "",
                                        "DOM (programmatic on navi.mod.surf):",
                                        "  persist(el) / unpersist(el) / isPersisted(el) / listPersisted()",
                                        "  slashfold(str|bytes)      optional fold; surf/browse passthru is not folded",
                                        "  X-Navi-Gate-Passthru      skip data.gate winner in delimiter race",
                                        "",
                                        "Modules live as tip+bin (navi:<name>), including surf."
                                    ].join("\n");
                                }
                                const words = [segment, ...args].filter(Boolean);
                                const flags = new Set(["-h", "--host", "-p", "--proscene", "--no-p", "-k", "--keepstage", "--no-k"]);
                                const host = words.some((w) => w === "-h" || w === "--host");
                                const proscene = words.includes("--no-p")
                                    ? false
                                    : words.some((w) => w === "-p" || w === "--proscene") || undefined;
                                const keepstage = words.includes("--no-k")
                                    ? false
                                    : words.some((w) => w === "-k" || w === "--keepstage") || undefined;
                                const joined = words.filter((w) => !flags.has(w)).join("/");
                                if (!joined) return "Usage: surf [-h] [-p|--no-p] [-k|--no-k] <route>";
                                const path = "/" + String(joined || "").replace(/^\/+/, "");
                                return await surf(path, { host, proscene, keepstage });
                            }
                        },
                        browse: {
                            name: "browse",
                            description: "Fetch a foobarch route and return its text (modules show source, no mount)",
                            execute: async (route, ...args) => {
                                if (!route) {
                                    return "Usage: browse <route>  (e.g. browse manifest)";
                                }
                                const joined = [route, ...args].join(" ").trim();
                                return await browse(joined, {});
                            }
                        },
                        surfrefresh: {
                            name: "surfrefresh",
                            description: "Hard reload origin / (PWA stand-in for a browser reload of the shell)",
                            execute: async () => {
                                return surfrefresh();
                            }
                        },
                        mount: {
                            name: "mount",
                            description: "Install & mount a Navi module (route → tip+bin, or remount navi:name)",
                            execute: async (target, ...args) => {
                                if (!target) {
                                    return "Usage: mount <route|navi:name>  (e.g. mount potter/x, or mount navi:potter)";
                                }
                                const joined = [target, ...args].join(" ").trim();
                                return await mount(joined);
                            }
                        },
                        unmount: {
                            name: "unmount",
                            description: "Unmount a registered module by name (navi.mod.<modname>); -k also storage kills its park tip",
                            execute: async (...args) => {
                                const words = args.map((a) => String(a ?? "").trim()).filter(Boolean);
                                const kill = words.some((w) => w === "-k" || w === "--kill");
                                const rest = words.filter((w) => w !== "-k" && w !== "--kill");
                                return await unmount(rest[0], { kill });
                            }
                        },
                        surf_settings: {
                            name: "surf_settings",
                            description: "View or update surf settings (same as surf -settings)",
                            execute: async (key, value) => setSurfSetting(key, value)
                        }
                    },

                    surf,
                    surfrefresh,
                    browse,
                    mount,
                    unmount,
                    ensureSettings,
                    persist,
                    unpersist,
                    isPersisted,
                    listPersisted,
                    slashfold,

                    onMount: async () => {
                        await writeSettingsBackup(await ensureSettings());
                        navi.callout("[surf] Ready (v1.9.6, stage branch)");
                    },

                    onUnmount: () => {
                        navi.callout("[surf] Module unmounted");
                    }
                };
            };