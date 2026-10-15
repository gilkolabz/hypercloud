export const register = (navi) => {
    const isBrowser = typeof window !== "undefined" && typeof window.document !== "undefined";

    const STYLE_ID = "navi-overflow-default-scroll";
    const addedStyles = [];
    let previousRootOverflow = null;
    let previousRootOverflowX = null;
    let previousRootOverflowY = null;
    let previousOverflow = null;
    let previousOverflowX = null;
    let previousOverflowY = null;
    let enabled = false;

    function ensureScrollStyle() {
        if (!isBrowser) return null;
        let style = document.getElementById(STYLE_ID);
        if (!style) {
            style = document.createElement("style");
            style.id = STYLE_ID;
            // Scroll the root (html) only. Body must stay overflow:visible —
            // Chromium treats body overflow ≠ visible as a fixed containing
            // block, so position:fixed UI (dropdown, scrollbuffer) offsets by
            // scrollY and clips into the scrolled "overflow" region (e.g. after
            // surf.persist leaves tall content under a stage).
            style.textContent = `
                html {
                    overflow: auto !important;
                    overflow-x: auto !important;
                    overflow-y: auto !important;
                }
                body {
                    overflow: visible !important;
                    overflow-x: visible !important;
                    overflow-y: visible !important;
                }
            `;
            document.head.appendChild(style);
            addedStyles.push(style);
        }
        return style;
    }

    function removeScrollStyle() {
        if (!isBrowser) return;
        const style = document.getElementById(STYLE_ID);
        if (!style) return;
        style.remove();
        const idx = addedStyles.indexOf(style);
        if (idx >= 0) addedStyles.splice(idx, 1);
    }

    function applyEnable() {
        const root = document.documentElement;
        if (!isBrowser || !root || !document.body) {
            return "Error: browser document required";
        }
        ensureScrollStyle();
        root.style.overflow = "auto";
        root.style.overflowX = "auto";
        root.style.overflowY = "auto";
        // Override host body overflow:hidden without making body a scrollport.
        document.body.style.overflow = "visible";
        document.body.style.overflowX = "visible";
        document.body.style.overflowY = "visible";
        return null;
    }

    function enable() {
        const root = document.documentElement;
        if (!isBrowser || !root || !document.body) {
            return "Error: browser document required";
        }
        if (!enabled) {
            previousRootOverflow = root.style.overflow;
            previousRootOverflowX = root.style.overflowX;
            previousRootOverflowY = root.style.overflowY;
            previousOverflow = document.body.style.overflow;
            previousOverflowX = document.body.style.overflowX;
            previousOverflowY = document.body.style.overflowY;
        }
        const err = applyEnable();
        if (err) return err;
        enabled = true;
        return "overflow_default_scroll: enabled (html overflow auto; body visible)";
    }

    function disable() {
        const root = document.documentElement;
        if (!isBrowser || !root || !document.body) {
            return "Error: browser document required";
        }
        removeScrollStyle();
        root.style.overflow = previousRootOverflow ?? "";
        root.style.overflowX = previousRootOverflowX ?? "";
        root.style.overflowY = previousRootOverflowY ?? "";
        document.body.style.overflow = previousOverflow ?? "hidden";
        document.body.style.overflowX = previousOverflowX ?? "";
        document.body.style.overflowY = previousOverflowY ?? "";
        enabled = false;
        return "overflow_default_scroll: disabled (html/body overflow hidden)";
    }

    return {
        name: "overflow_default_scroll",
        version: "1.0.4",
        description:
            "Enable/disable document scrolling on html (body stays visible so fixed UI stays glued).",

        moduleInfo: {
            name: "overflow_default_scroll",
            version: "1.0.4",
            description:
                "Enable/disable document scrolling on html (body stays visible so fixed UI stays glued)."
        },

        commands: {
            overflow_default_scroll: {
                name: "overflow_default_scroll",
                description: "Toggle document overflow scrolling: overflow_default_scroll <enable|disable>",
                execute: async (action) => {
                    if (!action) {
                        return [
                            "overflow_default_scroll",
                            "",
                            "Usage:",
                            "  overflow_default_scroll enable   Allow page scroll (html); body overflow visible",
                            "  overflow_default_scroll disable  Restore host default (overflow hidden)",
                            "",
                            `Current: ${enabled ? "enabled" : "disabled"}`
                        ].join("\n");
                    }

                    switch (String(action).toLowerCase()) {
                        case "enable":
                        case "on":
                            return enable();
                        case "disable":
                        case "off":
                            return disable();
                        default:
                            return `Unknown action: ${action}. Use enable or disable.`;
                    }
                }
            }
        },

        enable,
        disable,

        onMount: async () => {
            const msg = enable();
            navi.callout("[overflow_default_scroll] " + String(msg || "mounted"));
        },

        onUnmount: () => {
            if (isBrowser && enabled) {
                disable();
            }
            addedStyles.forEach((style) => style.remove());
            addedStyles.length = 0;
            enabled = false;
            navi.callout("[overflow_default_scroll] Module unmounted");
        }
    };
};

