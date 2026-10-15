/**
 * fetchgater — PoC monkey-patch of globalThis.fetch.
 *
 * Allows URLs that match an allowlist (prefix match on absolute URL).
 * Unknown fetches open a dialog: Allow once / Add to list / Deny.
 * Same-origin is seeded on arm (browser) so the shell keeps working.
 * Unmount / disarm restores the original fetch.
 *
 * Not a real security boundary — mount early for the demo to matter.
 *
 *   mount …/fetchgater.js
 *   fetchgater status | list | add <prefix|host> | remove <entry>
 *   fetchgater clear-once | arm | disarm | help
 *   unmount fetchgater
 */
export const register = (navi) => {
    const isBrowser =
        typeof window !== "undefined" && typeof window.document !== "undefined";

    const eventListeners = [];
    const createdElements = [];
    const timers = [];

    /** @type {typeof fetch | null} */
    let originalFetch = null;
    let armed = false;
    /** Absolute-URL prefixes (and raw hostnames as convenience). */
    const allowlist = [];
    /** Session-only one-shot allows (full absolute URL strings). */
    const onceAllowed = new Set();
    let pendingDialog = null;

    function callout(msg) {
        if (typeof navi.callout === "function") navi.callout(msg);
        else console.log(msg);
    }

    function toAbsoluteUrl(input) {
        let raw = input;
        if (input && typeof input === "object" && typeof input.url === "string") {
            raw = input.url;
        }
        raw = String(raw ?? "");
        try {
            if (typeof location !== "undefined" && location.href) {
                return new URL(raw, location.href).href;
            }
            return new URL(raw).href;
        } catch {
            return raw;
        }
    }

    function isAllowed(absUrl) {
        if (onceAllowed.has(absUrl)) return true;
        for (const entry of allowlist) {
            const e = String(entry || "").trim();
            if (!e) continue;
            if (absUrl === e || absUrl.startsWith(e)) return true;
            // hostname-only entry: "foobarch.net" or "https://foobarch.net"
            try {
                const u = new URL(absUrl);
                if (e === u.hostname || e === u.origin) return true;
                if (!e.includes("://") && u.hostname.endsWith(e.replace(/^\./, ""))) {
                    // ".example.com" style — keep simple: hostname === e or endsWith "."+e
                    if (u.hostname === e || u.hostname.endsWith("." + e)) return true;
                }
            } catch {
                /* ignore */
            }
        }
        return false;
    }

    function seedDefaults() {
        if (!isBrowser || typeof location === "undefined") return;
        // Same origin is usually needed for the shell itself.
        if (location.origin && !allowlist.includes(location.origin)) {
            allowlist.push(location.origin);
        }
    }

    /**
     * @returns {Promise<'once'|'always'|'deny'>}
     */
    function askUser(absUrl, method) {
        if (!isBrowser) {
            callout(`[fetchgater] deny (no UI): ${method} ${absUrl}`);
            return Promise.resolve("deny");
        }
        if (pendingDialog) {
            // Serialize: deny overlapping unknowns rather than stack modals.
            callout(`[fetchgater] busy — deny: ${method} ${absUrl}`);
            return Promise.resolve("deny");
        }

        return new Promise((resolve) => {
            const overlay = document.createElement("div");
            overlay.setAttribute("data-fetchgater", "1");
            overlay.style.cssText = [
                "position:fixed",
                "inset:0",
                "z-index:2147483646",
                "background:rgba(0,0,0,.45)",
                "display:flex",
                "align-items:center",
                "justify-content:center",
                "font-family:ui-monospace,Consolas,monospace",
                "font-size:13px",
            ].join(";");

            const box = document.createElement("div");
            box.style.cssText = [
                "background:#111",
                "color:#eee",
                "border:1px solid #666",
                "max-width:min(560px,92vw)",
                "padding:16px 18px",
                "box-shadow:0 8px 32px rgba(0,0,0,.5)",
            ].join(";");

            const title = document.createElement("div");
            title.textContent = "fetchgater — unknown fetch";
            title.style.cssText = "font-weight:700;margin-bottom:10px;color:#fc6;";

            const body = document.createElement("div");
            body.style.cssText = "word-break:break-all;margin-bottom:14px;line-height:1.4";
            body.innerHTML = `<div style="opacity:.7;margin-bottom:4px">${escapeHtml(
                method
            )}</div><div>${escapeHtml(absUrl)}</div>`;

            const row = document.createElement("div");
            row.style.cssText = "display:flex;flex-wrap:wrap;gap:8px";

            const finish = (choice) => {
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
                pendingDialog = null;
                resolve(choice);
            };

            const mkBtn = (label, choice, accent) => {
                const b = document.createElement("button");
                b.type = "button";
                b.textContent = label;
                b.style.cssText = [
                    "cursor:pointer",
                    "padding:6px 12px",
                    "border:1px solid #888",
                    "background:" + (accent || "#222"),
                    "color:#fff",
                    "font:inherit",
                ].join(";");
                b.addEventListener("click", () => finish(choice));
                return b;
            };

            row.appendChild(mkBtn("Allow once", "once", "#264"));
            row.appendChild(mkBtn("Add to list", "always", "#246"));
            row.appendChild(mkBtn("Deny", "deny", "#422"));

            const hint = document.createElement("div");
            hint.style.cssText = "margin-top:12px;opacity:.55;font-size:11px";
            hint.textContent =
                "PoC only. fetchgater list | add <prefix> | remove <prefix> | disarm";

            box.appendChild(title);
            box.appendChild(body);
            box.appendChild(row);
            box.appendChild(hint);
            overlay.appendChild(box);
            document.body.appendChild(overlay);
            createdElements.push(overlay);
            pendingDialog = overlay;
        });
    }

    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    async function gatedFetch(input, init) {
        const abs = toAbsoluteUrl(input);
        const method = String(
            (init && init.method) ||
                (input && typeof input === "object" && input.method) ||
                "GET"
        ).toUpperCase();

        if (isAllowed(abs)) {
            return originalFetch.call(globalThis, input, init);
        }

        const choice = await askUser(abs, method);
        if (choice === "deny") {
            throw new Error(`[fetchgater] denied ${method} ${abs}`);
        }
        if (choice === "always") {
            if (!allowlist.includes(abs)) {
                // Prefer origin prefix when possible so one allow covers the host path root
                let entry = abs;
                try {
                    const u = new URL(abs);
                    entry = u.origin + "/";
                } catch {
                    /* keep abs */
                }
                if (!allowlist.includes(entry)) allowlist.push(entry);
                callout(`[fetchgater] added ${entry}`);
            }
        }
        if (choice === "once") {
            onceAllowed.add(abs);
        }
        return originalFetch.call(globalThis, input, init);
    }

    function arm() {
        if (armed) return "already armed";
        if (typeof globalThis.fetch !== "function") {
            return "no globalThis.fetch";
        }
        originalFetch = globalThis.fetch.bind(globalThis);
        globalThis.fetch = gatedFetch;
        armed = true;
        seedDefaults();
        return `armed — allowlist ${allowlist.length} entr${allowlist.length === 1 ? "y" : "ies"}`;
    }

    function disarm() {
        if (!armed) return "not armed";
        if (originalFetch) globalThis.fetch = originalFetch;
        originalFetch = null;
        armed = false;
        if (pendingDialog && pendingDialog.parentNode) {
            pendingDialog.parentNode.removeChild(pendingDialog);
            pendingDialog = null;
        }
        return "disarmed — fetch restored";
    }

    const HELP = [
        "fetchgater — PoC allowlist gate on globalThis.fetch",
        "",
        "  fetchgater status",
        "  fetchgater list",
        "  fetchgater add <url-prefix|host>",
        "  fetchgater remove <exact-entry>",
        "  fetchgater clear-once",
        "  fetchgater arm | disarm | help",
        "",
        "Unknown fetches → dialog: Allow once | Add to list | Deny",
        "Same-origin is seeded on arm (browser). Not a real sandbox.",
    ].join("\n");

    const run = async (...rawArgs) => {
        const args =
            rawArgs.length === 1 && typeof rawArgs[0] === "string"
                ? String(rawArgs[0]).trim().split(/\s+/).filter(Boolean)
                : rawArgs.map(String).filter(Boolean);
        const verb = String(args[0] || "help").toLowerCase();

        if (verb === "help" || verb === "-h") return HELP;
        if (verb === "status") {
            return JSON.stringify(
                {
                    armed,
                    allowlist: [...allowlist],
                    once: [...onceAllowed],
                    browser: isBrowser,
                },
                null,
                2
            );
        }
        if (verb === "list") {
            return allowlist.length
                ? allowlist.map((e, i) => `${i + 1}. ${e}`).join("\n")
                : "(empty allowlist)";
        }
        if (verb === "add") {
            const entry = args.slice(1).join(" ").trim();
            if (!entry) return "Usage: fetchgater add <url-prefix|host>";
            if (!allowlist.includes(entry)) allowlist.push(entry);
            return `added ${entry}`;
        }
        if (verb === "remove") {
            const entry = args.slice(1).join(" ").trim();
            const i = allowlist.indexOf(entry);
            if (i < 0) return `not found: ${entry}`;
            allowlist.splice(i, 1);
            return `removed ${entry}`;
        }
        if (verb === "clear-once" || verb === "clear_once") {
            onceAllowed.clear();
            return "cleared session once-allows";
        }
        if (verb === "arm") return arm();
        if (verb === "disarm") return disarm();
        return `unknown: ${verb}\n\n${HELP}`;
    };

    return {
        name: "fetchgater",
        version: "1.0.0",
        description: "PoC allowlist gate on globalThis.fetch with allow/deny dialog",
        moduleInfo: {
            name: "fetchgater",
            version: "1.0.0",
            description: "PoC allowlist gate on globalThis.fetch with allow/deny dialog",
        },
        arm,
        disarm,
        commands: {
            fetchgater: {
                name: "fetchgater",
                description:
                    "fetchgater status|list|add|remove|arm|disarm — gate global fetch",
                execute: async (...args) => run(...args),
            },
        },
        onMount: () => {
            const msg = arm();
            callout(`[fetchgater] ${msg}`);
        },
        onUnmount: () => {
            disarm();
            for (const el of createdElements) {
                try {
                    if (el && el.parentNode) el.parentNode.removeChild(el);
                } catch {
                    /* ignore */
                }
            }
            createdElements.length = 0;
            eventListeners.length = 0;
            timers.length = 0;
            onceAllowed.clear();
            callout("[fetchgater] unmounted");
        },
    };
};
