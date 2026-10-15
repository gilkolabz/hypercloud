/**
 * tabletop_render — generic JSON (json / manifest) → scrollable HTML table (html part).
 */

function hasType(context, name) {
    const types = Array.isArray(context?.types) ? context.types : [];
    return types.includes(name) || context?.kind === name;
}

function esc(s) {
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function cellText(value) {
    if (value == null) return "";
    if (typeof value === "object") {
        try {
            return JSON.stringify(value);
        } catch {
            return String(value);
        }
    }
    return String(value);
}

function tableHtml(value) {
    if (Array.isArray(value)) {
        if (!value.length) {
            return `<div class="tabletop-empty">(empty array)</div>`;
        }
        if (value.every((row) => row && typeof row === "object" && !Array.isArray(row))) {
            const keys = [...new Set(value.flatMap((row) => Object.keys(row)))];
            const head = keys.map((k) => `<th>${esc(k)}</th>`).join("");
            const body = value
                .map(
                    (row) =>
                        `<tr>${keys
                            .map((k) => `<td>${esc(cellText(row[k]))}</td>`)
                            .join("")}</tr>`
                )
                .join("");
            return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
        }
        const body = value
            .map((item, i) => `<tr><th>${i}</th><td>${esc(cellText(item))}</td></tr>`)
            .join("");
        return `<table><tbody>${body}</tbody></table>`;
    }

    if (value && typeof value === "object") {
        const body = Object.entries(value)
            .map(
                ([k, v]) =>
                    `<tr><th>${esc(k)}</th><td>${esc(cellText(v))}</td></tr>`
            )
            .join("");
        return `<table><tbody>${body}</tbody></table>`;
    }

    return `<table><tbody><tr><td>${esc(cellText(value))}</td></tr></tbody></table>`;
}

const HELP = [
    "tabletop_render — show JSON as a scrollable table.",
    "use: select a json or manifest object with stagejockey → +1 \"tabletop render\".",
    "needs: stagejockey",
].join("\n");

export const register = (navi) => {
    const scrollbufferPlugin = {
        id: "tabletop_render",
        name: "tabletop_render",
        claims: [
            {
                id: "table",
                direction: 1,
                types: ["json"],
                color: "coral",
                describe: () => ({ text: "tabletop render", color: "coral",
                    textShadow: "0 1px 2px #330000, 0 0 2px #000, 0 0 1px #000",
                }),
                matches: (context) =>
                    hasType(context, "json") ||
                    hasType(context, "manifest") ||
                    hasType(context, "stage_dir"),
                execute: (context) => {
                    const value = context.json ?? context.value ?? context.frame ?? context;
                    const inner = tableHtml(value);
                    const html = `
<div class="tabletop-render" style="box-sizing:border-box;max-width:min(80vw,48rem);max-height:min(48vh,22.4rem);overflow:auto;margin:0.35rem;padding:0.45rem 0.55rem;border:1px solid #9a9a9a;background:LightGray;color:#000;font:12px/1.35 monospace">
<style>.tabletop-render table{border-collapse:collapse;width:100%}.tabletop-render th,.tabletop-render td{border:1px solid #b0b0b0;padding:0.2rem 0.35rem;text-align:left;vertical-align:top;word-break:break-word}.tabletop-render th{background:#d4d4d4;font-weight:600}</style>
${inner}
</div>`.trim();
                    return {
                        types: ["htmf"],
                        kind: "htmf",
                        part: "htmf",
                        label: context.label ? `table ${context.label}` : "tabletop",
                        html,
                        value: html,
                    };
                },
            },
        ],
    };

    return {
        name: "tabletop_render",
        commands: {
            tabletop_render: { name: "tabletop_render", description: "help", execute: async () => HELP },
        },
        version: "0.2.3",
        description: "Scrollbuffer: json/manifest → htmf table part",
        moduleInfo: {
            name: "tabletop_render",
            version: "0.2.3",
            description: "Scrollbuffer: json/manifest → htmf table part",
        },
        scrollbufferPlugin,
    };
};
