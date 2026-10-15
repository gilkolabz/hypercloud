/**
 * jockey_cursor — thin stagejockey adapter for cursor_edit_client.
 * Packs redselect context + prompt; all relay/apply lives in cursor_edit_client.
 *
 * Requires: stagejockey, cursor_edit_client mounted.
 */

function hasType(context, name) {
    const types = Array.isArray(context?.types) ? context.types : [];
    return types.includes(name) || context?.kind === name;
}

function pickEl(context) {
    return (
        context?.el ||
        context?.element ||
        context?.node ||
        context?.target ||
        null
    );
}

const HELP = [
    "jockey_cursor — send a selected piece of the page to Cursor for a live edit.",
    "use: select an htmf, element, stage-member, or text with stagejockey → +1 \"cursor-edit\",",
    "     type what you want changed; cursor_edit_client relays it and applies the reply.",
    "needs: stagejockey, cursor_edit_client",
].join("\n");

export const register = (navi) => {
    const VERSION = "0.1.4";

    const client = () => {
        const mod = navi.mod?.cursor_edit_client;
        if (!mod || typeof mod.edit !== "function") {
            throw new Error("mount cursor_edit_client first");
        }
        return mod;
    };

    const promptOnce = (seed = "") =>
        new Promise((resolve) => {
            const existing = document.getElementById("jockey-cursor-prompt");
            if (existing) existing.remove();
            const box = document.createElement("div");
            box.id = "jockey-cursor-prompt";
            box.style.cssText =
                "position:fixed;z-index:2147483646;left:50%;top:20%;transform:translateX(-50%);background:#fff;color:#111;border:double 4px #000;padding:0.75rem;min-width:18rem;font:13px/1.35 ui-monospace,Consolas,monospace;";
            box.innerHTML = `<div style="font-weight:700;margin:0 0 0.35rem;">cursor edit</div>
              <textarea id="jc-ta" rows="4" style="width:100%;box-sizing:border-box;font:inherit;"></textarea>
              <div style="margin-top:0.35rem;display:flex;gap:0.35rem;">
                <button type="button" id="jc-ok">send</button>
                <button type="button" id="jc-x">cancel</button>
              </div>`;
            document.documentElement.appendChild(box);
            const ta = box.querySelector("#jc-ta");
            ta.value = seed;
            ta.focus();
            const done = (v) => {
                box.remove();
                resolve(v);
            };
            box.querySelector("#jc-ok").onclick = () => done(ta.value);
            box.querySelector("#jc-x").onclick = () => done(null);
            ta.onkeydown = (e) => {
                if (e.key === "Escape") done(null);
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    done(ta.value);
                }
            };
        });

    const scrollbufferPlugin = {
        id: "jockey_cursor",
        name: "jockey_cursor",
        claims: [
            {
                id: "cursor-edit",
                direction: 1,
                types: ["htmf", "htm-element", "stage-member", "text"],
                color: "black",
                describe: () => ({
                    text: "cursor-edit",
                    color: "black",
                    textShadow:
                        "0 0 6px lime, 0 1px 2px #0f0, 0 0 2px #003300",
                }),
                matches: (context) =>
                    hasType(context, "htmf") ||
                    hasType(context, "htm-element") ||
                    hasType(context, "stage-member") ||
                    hasType(context, "text"),
                async execute(context, api) {
                    const el = pickEl(context);
                    const prompt = await promptOnce(
                        "Describe the change (returns cursor_edit_v1 ops)…"
                    );
                    if (prompt == null || !String(prompt).trim()) {
                        return undefined;
                    }
                    const selection = {
                        dataPath:
                            el?.getAttribute?.("data-path") ||
                            context?.dataPath ||
                            "",
                        dataPart:
                            el?.getAttribute?.("data-part") ||
                            context?.kind ||
                            "",
                        dataHash:
                            el?.getAttribute?.("data-hash") ||
                            context?.dataHash ||
                            "",
                        slot: context?.slot || "",
                        outerHTML:
                            el instanceof HTMLElement
                                ? el.outerHTML.slice(0, 80000)
                                : "",
                        text:
                            el instanceof HTMLElement
                                ? String(el.textContent || "").slice(0, 8000)
                                : String(context?.text || "").slice(0, 8000),
                    };
                    const out = await client().edit(
                        { prompt: String(prompt).trim(), selection },
                        { selectionEl: el instanceof HTMLElement ? el : null }
                    );
                    const n = out.ops?.length || 0;
                    navi.callout?.(
                        n
                            ? `[jockey_cursor] ops=${n} — finality box`
                            : `[jockey_cursor] ops=0 — see finality / tip navi:cursor_edit_client:last`
                    );
                    if (typeof api?.terminate === "function") api.terminate();
                    return (
                        out.last ||
                        out.parsed ||
                        out.summary ||
                        out
                    );
                },
            },
        ],
    };

    return {
        name: "jockey_cursor",
        commands: {
            jockey_cursor: { name: "jockey_cursor", description: "help", execute: async () => HELP },
        },
        version: VERSION,
        description:
            "Thin stagejockey +1 cursor-edit → cursor_edit_client (no relay logic here)",
        moduleInfo: {
            name: "jockey_cursor",
            version: VERSION,
            description: "Adapter claim for cursor_edit_client",
        },
        scrollbufferPlugin,
        onMount: () => {
            console.log(
                `[jockey_cursor] ready — needs cursor_edit_client + stagejockey`
            );
        },
    };
};
