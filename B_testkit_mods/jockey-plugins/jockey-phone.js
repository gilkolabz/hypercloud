/**
 * jockey-phone — scrollbuffer + stage-member-add claims that require phonebook_client.
 *
 * Only exposes scrollbufferPlugin when navi.mod.phonebook_client is mounted.
 * If missing on mount, onMount throws so the mount fails outright.
 *
 * Scrollbuffer: +1 phone-subscribe on ibgib_frame — floating subject → report.
 * Scrollbuffer: +1 phone-text-ring on snoopy_object — ring text/<route> → html.
 * Scrollbuffer: +1 phone-text-write on snoopy_object — alias+text → write text/<route>.
 * Dropdown add (via stagejockey): ring-phonebook — only if stage_casting is on.
 *   subject input → phonebook_client.ring → stagemaker → jockey-move.
 */

function phonebookClient(navi) {
    return navi.mod?.phonebook_client || null;
}

function hasType(context, name) {
    const types = Array.isArray(context?.types) ? context.types : [];
    return types.includes(name) || context?.kind === name;
}

function normalizeRoute(raw) {
    return String(raw || "")
        .trim()
        .replace(/^https?:\/\/[^/]+/i, "")
        .replace(/^\/+/, "");
}

/** Route a snoopy_object was built from (snoopy_sniff shape). */
function snoopyRoute(context) {
    return normalizeRoute(context?.route || context?.name || context?.url || "");
}

/** Ring HTML as a jockey htmf object — chainable in the scrollbuffer. */
async function ringHtmlContext(client, subject) {
    const html = await client.ring(subject);
    return {
        types: ["htmf"],
        kind: "htmf",
        part: "htmf",
        label: `ring ${subject}`,
        html,
        value: html,
        presentation: { type: "htmf", value: html },
        subject,
    };
}

function resolveFrame(context) {
    const frame = context?.frame || context?.json || context?.value;
    if (!frame || typeof frame !== "object" || Array.isArray(frame)) return null;
    if (frame.ib == null || frame.gib == null) return null;
    return frame;
}

function suggestSubject(context, frame) {
    const alias =
        context?.alias ||
        (frame?.data && typeof frame.data === "object"
            ? frame.data.alias
            : null) ||
        frame?.alias ||
        null;
    if (alias && String(alias).trim()) return String(alias).trim();
    return "";
}

function dismissUi(ui) {
    if (!ui) return;
    try {
        ui.root?.remove();
    } catch {
        /* ignore */
    }
    for (const [type, el, fn, opts] of ui.listeners || []) {
        try {
            el.removeEventListener(type, fn, opts);
        } catch {
            /* ignore */
        }
    }
    ui.listeners = [];
}

function classifySubscribeError(err) {
    const msg = String(err?.message || err || "");
    if (/no phonebook usage tokens|no .*tokens/i.test(msg)) {
        return "fail! no tokens";
    }
    return "fail!";
}

function findClaim(navi, modName, claimId) {
    const plug = navi.mod?.[modName]?.scrollbufferPlugin;
    if (!plug || !Array.isArray(plug.claims)) return null;
    return plug.claims.find((c) => c.id === claimId) || null;
}

function pointerOf(api) {
    return {
        x: api?.jockey?._pointer?.x ?? api?.pointer?.x ?? 0,
        y: api?.jockey?._pointer?.y ?? api?.pointer?.y ?? 0,
    };
}

/**
 * Floating subject field → ringing… → ok!/fail! then fade 3s.
 * @returns {Promise<undefined>}
 */
function openSubscribeUi(navi, context, api) {
    return new Promise((resolve) => {
        const ui = { listeners: [] };
        const frame = resolveFrame(context);
        const client = phonebookClient(navi);
        const pt = pointerOf(api);

        const root = document.createElement("div");
        root.setAttribute("name", "jockey-phone-subscribe");
        root.style.cssText = [
            "position:fixed",
            "z-index:2147483646",
            "pointer-events:auto",
            "font:600 12px/1.2 monospace",
            "transition:opacity 3s ease",
            "opacity:1",
            "min-width:12rem",
            "background:transparent",
        ].join(";");

        root.style.left = `${pt.x + 16}px`;
        root.style.top = `${pt.y - 8}px`;
        root.style.transform = "translateY(-100%)";

        const input = document.createElement("input");
        input.type = "text";
        input.placeholder = "subject";
        input.value = suggestSubject(context, frame);
        input.autocomplete = "off";
        input.spellcheck = false;
        input.style.cssText = [
            "display:block",
            "width:100%",
            "box-sizing:border-box",
            "margin:0",
            "padding:6px 8px",
            "border:3px solid limegreen",
            "border-radius:0",
            "outline:none",
            "box-shadow:none",
            "background:#111",
            "color:#eee",
            "font:inherit",
        ].join(";");

        const status = document.createElement("div");
        status.style.cssText = [
            "display:none",
            "padding:6px 8px",
            "background:transparent",
            "color:#fff",
            "text-shadow:0 1px 2px #000, 0 0 1px #000",
            "white-space:nowrap",
            "font:inherit",
        ].join(";");

        root.appendChild(input);
        root.appendChild(status);

        let settled = false;
        const finish = (next) => {
            if (settled) return;
            settled = true;
            dismissUi(ui);
            resolve(next);
        };

        const cancel = () => finish(undefined);

        const showStatus = (text, color) => {
            input.style.display = "none";
            status.style.display = "block";
            status.textContent = text;
            status.style.color = color;
        };

        const fadeAndFinish = () => {
            root.style.opacity = "0";
            setTimeout(() => finish(undefined), 3000);
        };

        const submit = async () => {
            if (settled) return;
            const subject = String(input.value || "").trim();
            if (!subject) return;

            input.disabled = true;
            showStatus("ringing...", "#fff");

            try {
                if (!client || typeof client.subscribe !== "function") {
                    throw new Error("phonebook_client not mounted");
                }
                if (!frame) throw new Error("ibgib_frame missing ib/gib");

                await client.subscribe(subject, frame);
                showStatus("ok!", "#0f0");
                if (typeof navi.callout === "function") {
                    navi.callout(`[jockey-phone] subscribed ${subject}`);
                }
            } catch (err) {
                console.error("[jockey-phone]", err);
                showStatus(classifySubscribeError(err), "#f66");
                if (typeof navi.callout === "function") {
                    navi.callout(`[jockey-phone] ${err.message || err}`);
                }
            }
            fadeAndFinish();
        };

        const onKey = (e) => {
            if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                cancel();
                return;
            }
            if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                void submit();
            }
        };
        input.addEventListener("keydown", onKey);
        ui.listeners.push(["keydown", input, onKey, false]);

        const onDocDown = (e) => {
            if (root.contains(e.target)) return;
            if (input.style.display === "none") return;
            e.preventDefault();
            e.stopPropagation();
            cancel();
        };
        document.addEventListener("mousedown", onDocDown, true);
        ui.listeners.push(["mousedown", document, onDocDown, true]);

        document.body.appendChild(root);
        ui.root = root;
        try {
            input.focus();
            input.select();
        } catch {
            /* ignore */
        }
    });
}

/**
 * Subject prompt for ring-phonebook. Resolves to trimmed subject or undefined.
 * @returns {Promise<string|undefined>}
 */
function openRingSubjectUi(api) {
    return new Promise((resolve) => {
        const ui = { listeners: [] };
        const pt = pointerOf(api);

        const root = document.createElement("div");
        root.setAttribute("name", "jockey-phone-ring");
        root.style.cssText = [
            "position:fixed",
            "z-index:2147483646",
            "pointer-events:auto",
            "font:600 12px/1.2 monospace",
            "opacity:1",
            "min-width:12rem",
            "background:transparent",
        ].join(";");
        root.style.left = `${pt.x + 16}px`;
        root.style.top = `${pt.y - 8}px`;
        root.style.transform = "translateY(-100%)";

        const input = document.createElement("input");
        input.type = "text";
        input.placeholder = "subject (ring)";
        input.autocomplete = "off";
        input.spellcheck = false;
        input.style.cssText = [
            "display:block",
            "width:100%",
            "box-sizing:border-box",
            "margin:0",
            "padding:6px 8px",
            "border:3px solid limegreen",
            "border-radius:0",
            "outline:none",
            "box-shadow:none",
            "background:#111",
            "color:#eee",
            "font:inherit",
        ].join(";");

        root.appendChild(input);

        let settled = false;
        const finish = (next) => {
            if (settled) return;
            settled = true;
            dismissUi(ui);
            resolve(next);
        };

        const onKey = (e) => {
            if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                finish(undefined);
                return;
            }
            if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                const subject = String(input.value || "").trim();
                if (!subject) return;
                finish(subject);
            }
        };
        input.addEventListener("keydown", onKey);
        ui.listeners.push(["keydown", input, onKey, false]);

        const onDocDown = (e) => {
            if (root.contains(e.target)) return;
            e.preventDefault();
            e.stopPropagation();
            finish(undefined);
        };
        document.addEventListener("mousedown", onDocDown, true);
        ui.listeners.push(["mousedown", document, onDocDown, true]);

        document.body.appendChild(root);
        ui.root = root;
        try {
            input.focus();
        } catch {
            /* ignore */
        }
    });
}

/**
 * Floating alias input + text textarea (same green). Enter on either field →
 * writing… → ok!/fail! then fade 3s. Shift+Enter in the textarea = newline.
 * Writes to `subject` via phonebook_client.write({ alias, text }).
 * @returns {Promise<undefined>}
 */
function openTextWriteUi(navi, subject, api) {
    return new Promise((resolve) => {
        const ui = { listeners: [] };
        const client = phonebookClient(navi);
        const pt = pointerOf(api);

        const root = document.createElement("div");
        root.setAttribute("name", "jockey-phone-write");
        root.style.cssText = [
            "position:fixed",
            "z-index:2147483646",
            "pointer-events:auto",
            "font:600 12px/1.2 monospace",
            "transition:opacity 3s ease",
            "opacity:1",
            "min-width:16rem",
            "background:transparent",
        ].join(";");
        root.style.left = `${pt.x + 16}px`;
        root.style.top = `${pt.y - 8}px`;
        root.style.transform = "translateY(-100%)";

        const fieldCss = [
            "display:block",
            "width:100%",
            "box-sizing:border-box",
            "margin:0",
            "padding:6px 8px",
            "border:3px solid limegreen",
            "border-radius:0",
            "outline:none",
            "box-shadow:none",
            "background:#111",
            "color:#eee",
            "font:inherit",
        ].join(";");

        const aliasInput = document.createElement("input");
        aliasInput.type = "text";
        aliasInput.placeholder = "alias";
        aliasInput.autocomplete = "off";
        aliasInput.spellcheck = false;
        aliasInput.style.cssText = fieldCss;

        const textArea = document.createElement("textarea");
        textArea.placeholder = "text";
        textArea.rows = 4;
        textArea.spellcheck = false;
        textArea.style.cssText =
            fieldCss + ";border-top:0;resize:vertical;min-height:5rem";

        const status = document.createElement("div");
        status.style.cssText = [
            "display:none",
            "padding:6px 8px",
            "background:transparent",
            "color:#fff",
            "text-shadow:0 1px 2px #000, 0 0 1px #000",
            "white-space:nowrap",
            "font:inherit",
        ].join(";");

        root.appendChild(aliasInput);
        root.appendChild(textArea);
        root.appendChild(status);

        let settled = false;
        const finish = (next) => {
            if (settled) return;
            settled = true;
            dismissUi(ui);
            resolve(next);
        };
        const cancel = () => finish(undefined);

        const showStatus = (text, color) => {
            aliasInput.style.display = "none";
            textArea.style.display = "none";
            status.style.display = "block";
            status.textContent = text;
            status.style.color = color;
        };

        const fadeAndFinish = () => {
            root.style.opacity = "0";
            setTimeout(() => finish(undefined), 3000);
        };

        const submit = async () => {
            if (settled) return;
            const alias = String(aliasInput.value || "").trim();
            const text = String(textArea.value || "").trim();
            if (!text) {
                textArea.focus();
                return;
            }

            aliasInput.disabled = true;
            textArea.disabled = true;
            showStatus("writing...", "#fff");

            try {
                if (!client || typeof client.write !== "function") {
                    throw new Error("phonebook_client.write unavailable");
                }
                await client.write(subject, { alias, text });
                showStatus("ok!", "#0f0");
                if (typeof navi.callout === "function") {
                    navi.callout(`[jockey-phone] wrote ${subject}`);
                }
            } catch (err) {
                console.error("[jockey-phone]", err);
                showStatus(classifySubscribeError(err), "#f66");
                if (typeof navi.callout === "function") {
                    navi.callout(`[jockey-phone] ${err.message || err}`);
                }
            }
            fadeAndFinish();
        };

        const onKey = (e) => {
            if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                cancel();
                return;
            }
            if (e.key === "Enter") {
                // Shift+Enter in the textarea inserts a newline.
                if (e.shiftKey && e.target === textArea) return;
                e.preventDefault();
                e.stopPropagation();
                void submit();
            }
        };
        aliasInput.addEventListener("keydown", onKey);
        textArea.addEventListener("keydown", onKey);
        ui.listeners.push(["keydown", aliasInput, onKey, false]);
        ui.listeners.push(["keydown", textArea, onKey, false]);

        const onDocDown = (e) => {
            if (root.contains(e.target)) return;
            if (status.style.display === "block") return;
            e.preventDefault();
            e.stopPropagation();
            cancel();
        };
        document.addEventListener("mousedown", onDocDown, true);
        ui.listeners.push(["mousedown", document, onDocDown, true]);

        document.body.appendChild(root);
        ui.root = root;
        try {
            aliasInput.focus();
        } catch {
            /* ignore */
        }
    });
}

async function runRingPhonebook(navi, api) {
    if (typeof document === "undefined") return undefined;
    if (!phonebookClient(navi)) {
        throw new Error("phonebook_client not mounted");
    }
    const stagemaker = findClaim(navi, "stage_casting", "stagemaker");
    if (!stagemaker) {
        throw new Error("stage_casting (stagemaker) not mounted");
    }
    const move = findClaim(navi, "jockey_move", "move");
    if (!move) {
        throw new Error("jockey_move not mounted");
    }

    const subject = await openRingSubjectUi(api);
    if (!subject) return undefined;

    const client = phonebookClient(navi);
    if (!client || typeof client.ring !== "function") {
        throw new Error("phonebook_client.ring unavailable");
    }

    if (typeof navi.callout === "function") {
        navi.callout(`[jockey-phone] ringing ${subject}…`);
    }
    const htmlCtx = await ringHtmlContext(client, subject);

    const offstage = await stagemaker.execute(htmlCtx, api);
    if (!offstage) return undefined;
    return move.execute(offstage, api);
}

const HELP = [
    "jockey_phone — phonebook claims for stagejockey.",
    "use (+1):",
    "  \"phone-subscribe\" on an ibgib_frame — float the subject and report on it",
    "  \"phone-text-ring\" on a snoopy_object — ring text/<route> and show the html",
    "  \"phone-text-write\" on a snoopy_object — write alias + text to text/<route>",
    "  stagejockey add menu: \"ring-phonebook\" (only while stage_casting is mounted)",
    "needs: stagejockey, phonebook_client (mount fails without it);",
    "       stage_casting + jockey_move for ring-phonebook",
].join("\n");

export const register = (navi) => {
    const PLUGIN = {
        id: "jockey-phone",
        name: "jockey-phone",
        claims: [
            {
                id: "phone-subscribe",
                direction: 1,
                types: ["ibgib_frame"],
                color: "limegreen",
                describe: () => ({
                    text: "phone-subscribe",
                    color: "limegreen",
                    textShadow: "0 1px 2px #001a00, 0 0 2px #000, 0 0 1px #000",
                }),
                matches: (context) =>
                    hasType(context, "ibgib_frame") && !!resolveFrame(context),
                async execute(context, api) {
                    if (typeof document === "undefined") return undefined;
                    return openSubscribeUi(navi, context, api);
                },
            },
            {
                id: "phone-text-ring",
                direction: 1,
                types: ["snoopy_object"],
                color: "springgreen",
                describe: () => ({
                    text: "phone-text-ring",
                    color: "springgreen",
                    textShadow: "0 1px 2px #001a00, 0 0 2px #000, 0 0 1px #000",
                }),
                matches: (context) =>
                    hasType(context, "snoopy_object") && !!snoopyRoute(context),
                async execute(context) {
                    const client = phonebookClient(navi);
                    if (!client || typeof client.ring !== "function") {
                        throw new Error("phonebook_client.ring unavailable");
                    }
                    const route = snoopyRoute(context);
                    if (!route) {
                        throw new Error("snoopy_object has no route to ring");
                    }
                    const subject = `text/${route}`;
                    if (typeof navi.callout === "function") {
                        navi.callout(`[jockey-phone] ringing ${subject}…`);
                    }
                    return ringHtmlContext(client, subject);
                },
            },
            {
                id: "phone-text-write",
                direction: 1,
                types: ["snoopy_object"],
                color: "springgreen",
                describe: () => ({
                    text: "phone-text-write",
                    color: "springgreen",
                    textShadow: "0 1px 2px #001a00, 0 0 2px #000, 0 0 1px #000",
                }),
                matches: (context) =>
                    hasType(context, "snoopy_object") && !!snoopyRoute(context),
                async execute(context, api) {
                    if (typeof document === "undefined") return undefined;
                    const client = phonebookClient(navi);
                    if (!client || typeof client.write !== "function") {
                        throw new Error("phonebook_client.write unavailable");
                    }
                    const route = snoopyRoute(context);
                    if (!route) {
                        throw new Error("snoopy_object has no route to write");
                    }
                    return openTextWriteUi(navi, `text/${route}`, api);
                },
            },
        ],
    };

    return {
        name: "jockey_phone",
        commands: {
            jockey_phone: { name: "jockey_phone", description: "help", execute: async () => HELP },
        },
        version: "0.6.1",
        description:
            "phone-subscribe + phone-text-ring + phone-text-write (scrollbuffer) + ring-phonebook (stage-member add)",
        moduleInfo: {
            name: "jockey_phone",
            version: "0.6.1",
            description:
                "phone-subscribe + phone-text-ring + phone-text-write (scrollbuffer) + ring-phonebook (stage-member add)",
        },

        get scrollbufferPlugin() {
            return phonebookClient(navi) ? PLUGIN : null;
        },

        /** Discovered by stagejockey dropdown → stage-member add. */
        get stageMemberAddPlugin() {
            if (!phonebookClient(navi)) return null;
            if (!findClaim(navi, "stage_casting", "stagemaker")) return null;
            return {
                id: "jockey-phone-add",
                claims: [
                    {
                        id: "ring-phonebook",
                        label: "ring-phonebook",
                        matches: () =>
                            !!findClaim(navi, "stage_casting", "stagemaker"),
                        async execute(api) {
                            return runRingPhonebook(navi, api);
                        },
                    },
                ],
            };
        },

        onMount: async () => {
            if (!phonebookClient(navi)) {
                throw new Error("requires phonebook_client (mount it first)");
            }
        },
    };
};
