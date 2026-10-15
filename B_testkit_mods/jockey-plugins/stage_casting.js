/**
 * stage_casting — wrap part-typed objects into an offstage-member so
 * jockey-move can place them on the stage.
 *
 * Claim types:"*" = universal (any part), but matches skips stage-member /
 * offstage-member — only cast things not yet on stage or prepped for stage.
 * Execute preserves the concrete data-part name (htmf / text / href / …).
 */

function hasType(context, name) {
    const types = Array.isArray(context?.types) ? context.types : [];
    return types.includes(name) || context?.kind === name;
}

function resolvePart(context) {
    if (context.part) return String(context.part).toLowerCase();
    if (context.presentation?.type) {
        return String(context.presentation.type).toLowerCase();
    }
    if (context.type && context.type !== "offstage-member" && context.type !== "stage-member") {
        return String(context.type).toLowerCase();
    }
    const types = Array.isArray(context?.types) ? context.types : [];
    const hit = types.find(
        (t) => t && t !== "stage-member" && t !== "offstage-member" && t !== "*"
    );
    return hit ? String(hit).toLowerCase() : "";
}

function partValue(context) {
    return String(
        context.presentation?.value ??
            context.value ??
            context.html ??
            context.text ??
            context.href ??
            ""
    );
}

function partNames(raw) {
    return String(raw || "")
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);
}

function isExclusivePart(type, name) {
    const parts = partNames(type);
    return parts.length === 1 && parts[0] === name;
}

const HELP = [
    "stage_casting — get anything ready to be placed on the stage.",
    "use: select any part that is not on the stage yet with stagejockey → +1 \"stagemaker\".",
    "     It becomes an offstage-member that jockey_move can place.",
    "needs: stagejockey (jockey_move to place it)",
].join("\n");

export const register = (navi) => {
    const scrollbufferPlugin = {
        id: "stage_casting",
        name: "stage_casting",
        claims: [
            {
                id: "stagemaker",
                direction: 1,
                // Any concrete part (html/text/href/…) that is not already staged
                // or prepped — stage-member / offstage-member skip casting.
                types: ["*"],
                color: "salmon",
                describe: () => ({ text: "stagemaker", color: "salmon",
                    textShadow: "0 1px 2px #330000, 0 0 2px #000, 0 0 1px #000",
                }),
                matches: (context) => {
                    if (
                        hasType(context, "stage-member") ||
                        hasType(context, "offstage-member")
                    ) {
                        return false;
                    }
                    // Need something castable: a part name or punchable value.
                    return !!(resolvePart(context) || partValue(context));
                },
                execute: (context) => {
                    const part = resolvePart(context);
                    if (part === "href" || hasType(context, "href")) {
                        const href = String(
                            context.href ||
                                context.presentation?.value ||
                                context.value ||
                                ""
                        ).replace(/^\/+/, "");
                        return {
                            types: ["offstage-member", "href"],
                            kind: "offstage-member",
                            label: `cast href ${href}`,
                            part: "href",
                            type: "href",
                            value: href,
                            occupant: { type: "href", value: href },
                        };
                    }

                    if (isExclusivePart(part, "text") || hasType(context, "text")) {
                        const text = partValue(context);
                        const path = String(
                            context.path ||
                                context.mediaPath ||
                                context.presentation?.path ||
                                ""
                        ).trim();
                        const wrap = document.createElement("span");
                        wrap.textContent = text;
                        const html = wrap.outerHTML;
                        const occupant = { type: "htmf", value: html };
                        if (path) occupant.path = path.replace(/^\/+/, "");
                        return {
                            types: ["offstage-member", "htmf"],
                            kind: "offstage-member",
                            label: path ? `cast text ${path}` : "cast text",
                            part: "htmf",
                            type: "htmf",
                            value: html,
                            ...(path ? { path } : {}),
                            occupant,
                        };
                    }

                    const value = partValue(context);
                    const type = part || "htmf";
                    const parts = partNames(type);
                    const path = String(
                        context.path ||
                            context.mediaPath ||
                            context.presentation?.path ||
                            ""
                    ).trim();
                    const occupant = { type, value };
                    if (path) occupant.path = path.replace(/^\/+/, "");
                    return {
                        types: ["offstage-member", ...parts],
                        kind: "offstage-member",
                        label: path ? `cast ${type} ${path}` : `cast ${type}`,
                        part: type,
                        type,
                        value,
                        ...(path ? { path } : {}),
                        occupant,
                    };
                },
            },
        ],
    };

    return {
        name: "stage_casting",
        commands: {
            stage_casting: { name: "stage_casting", description: "help", execute: async () => HELP },
        },
        version: "0.2.11",
        description: "Scrollbuffer: unbound parts → offstage-member (not stage/offstage)",
        moduleInfo: {
            name: "stage_casting",
            version: "0.2.11",
            description: "Scrollbuffer: unbound parts → offstage-member (not stage/offstage)",
        },
        scrollbufferPlugin,
    };
};
