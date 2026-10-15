// supermouse_plugin_dropdown — introduces the classic-styled dropdown pattern
// as a supermouse plugin. Owns menu UI; supermouse only supplies rightclick (etc).
// Other plugins may registerShowGate / registerPluginMenu (under plugins) or
// registerRootMenu (top-level ▸ next to callin / plugins).

export const register = (navi) => {
    const isBrowser = typeof window !== "undefined" && typeof window.document !== "undefined";

    const eventListeners = [];
    const createdElements = [];
    const addedStyles = [];
    const timers = [];

    const PLUGIN_ID = "dropdown";
    let unregister = null;
    let hostEventHandler = null;

    const STYLES = {
        menu: [
            "position:fixed",
            "background:#f0f0f0",
            "border:2px outset #f0f0f0",
            "padding:2px",
            "min-width:140px",
            "max-width:300px",
            // Tall stagejockey nests: scroll inside the menu instead of growing
            // past the viewport (esp. when page scroll is enabled).
            "max-height:min(80vh, calc(100vh - 16px))",
            "overflow-x:hidden",
            "overflow-y:auto",
            "z-index:10000",
            "font-family:sans-serif",
            "font-size:12px",
            "box-sizing:border-box"
        ].join(";"),
        item: [
            "padding:4px 8px",
            "background:#f0f0f0",
            "cursor:pointer",
            "border:1px solid transparent",
            "margin:1px",
            "user-select:none",
            "box-sizing:border-box"
        ].join(";"),
        vanity: "font-style:italic;color:#00bfff;cursor:default;",
        checkbox: "font-family:monospace;",
        input: [
            "width:100%",
            "padding:2px 4px",
            "border:1px inset #f0f0f0",
            "background:white",
            "font-family:monospace",
            "font-size:12px",
            "outline:none",
            "box-sizing:border-box"
        ].join(";")
    };

    const COLORS = { hover: "#316ac5", normal: "#f0f0f0" };

    const resolveSuperMouse = () => {
        const mod = navi?.mod || globalThis?.navi?.mod;
        if (!mod) return null;
        if (mod.supermouse?.supermouse) return mod.supermouse.supermouse;
        const hit = Object.values(mod).find(
            (entry) => entry?.supermouse && typeof entry.supermouse.registerPlugin === "function"
        );
        return hit?.supermouse || null;
    };

    const selfUnmount = (reason, { wtf = true } = {}) => {
        const msg = wtf
            ? `[supermouse_plugin_dropdown] WTF — ${reason}`
            : `[supermouse_plugin_dropdown] ${reason}`;
        if (typeof navi.callout === "function") navi.callout(msg);
        else console.warn(msg);

        const run = () => {
            const mod = navi?.mod?.supermouse_plugin_dropdown;
            if (mod && typeof navi.unmount === "function") navi.unmount(mod);
        };
        if (typeof queueMicrotask === "function") queueMicrotask(run);
        else setTimeout(run, 0);
    };

    const watchHost = () => {
        if (typeof navi?.on !== "function") return;
        hostEventHandler = (msg) => {
            if (msg?.kind === "unmount") {
                selfUnmount("supermouse unmounted — cascading", { wtf: false });
            }
        };
        navi.on("supermouse", hostEventHandler);
    };

    const unwatchHost = () => {
        if (hostEventHandler && typeof navi?.off === "function") {
            navi.off("supermouse", hostEventHandler);
        }
        hostEventHandler = null;
    };

    class DropdownMenu {
        constructor() {
            this.menu = null;
            this.openSub = null;
            this.openExt = null;
            this.host = null;
            this.styleEl = null;
            this._dismiss = null;
            this._dismissTimer = null;
            this.showGates = [];
            this.pluginMenus = new Map();
            this.rootMenus = new Map();
            this.callinActive = false;
            this._at = { x: 0, y: 0 };
            this.openNest = null;
        }

        attach(host) {
            this.host = host;
            this.ensureStyles();
        }

        registerShowGate(fn) {
            if (typeof fn !== "function") throw new Error("[dropdown] show gate must be a function");
            this.showGates.push(fn);
            return () => {
                this.showGates = this.showGates.filter((g) => g !== fn);
            };
        }

        allowShow(ctx) {
            for (const gate of this.showGates) {
                try {
                    if (gate(ctx) === false) return false;
                } catch (err) {
                    console.error("[dropdown] show gate failed", err);
                }
            }
            return true;
        }

        registerPluginMenu(def = {}) {
            const id = def.id;
            if (!id || typeof id !== "string") throw new Error("[dropdown] plugin menu requires id");
            if (typeof def.build !== "function") throw new Error("[dropdown] plugin menu requires build()");
            this.pluginMenus.set(id, {
                id,
                label: def.label || id,
                build: def.build
            });
            return () => this.pluginMenus.delete(id);
        }

        /**
         * Top-level root entry (alongside callin / plugins).
         * - build() → submenu (label ▸)
         * - action()/execute()/onClick() alone → leaf button that runs and closes
         */
        registerRootMenu(def = {}) {
            const id = def.id;
            if (!id || typeof id !== "string") throw new Error("[dropdown] root menu requires id");
            const action =
                typeof def.action === "function"
                    ? def.action
                    : typeof def.execute === "function"
                      ? def.execute
                      : typeof def.onClick === "function"
                        ? def.onClick
                        : null;
            const build = typeof def.build === "function" ? def.build : null;
            if (!build && !action) {
                throw new Error("[dropdown] root menu requires build() or action()");
            }
            this.rootMenus.set(id, {
                id,
                label: def.label || id,
                title: def.title || "",
                build,
                action,
            });
            return () => this.rootMenus.delete(id);
        }

        ensureStyles() {
            if (this.styleEl || !isBrowser) return;
            const style = document.createElement("style");
            style.id = "supermouse-dropdown-styles";
            style.textContent = `
                #supermouse-dropdown-menu .smd-item:hover:not(.smd-vanity):not(.smd-input-row) {
                    background: ${COLORS.hover} !important;
                    color: white !important;
                }
                #supermouse-dropdown-menu .smd-vanity:hover {
                    background: ${COLORS.normal} !important;
                    color: #00bfff !important;
                }
                #supermouse-dropdown-menu .smd-input-row:hover {
                    background: ${COLORS.normal} !important;
                    color: black !important;
                }
            `;
            document.head.appendChild(style);
            this.styleEl = style;
            addedStyles.push(style);
        }

        destroy() {
            this.close();
            this.showGates = [];
            this.pluginMenus.clear();
            this.rootMenus.clear();
            this.openNest = null;
            if (this.styleEl) {
                this.styleEl.remove();
                this.styleEl = null;
            }
            this.host = null;
        }

        _clearDismiss() {
            if (this._dismissTimer != null) {
                clearTimeout(this._dismissTimer);
                this._dismissTimer = null;
            }
            if (this._dismiss) {
                const { onDocDown, onKey } = this._dismiss;
                document.removeEventListener("mousedown", onDocDown, true);
                document.removeEventListener("keydown", onKey, true);
                this._dismiss = null;
            }
        }

        close() {
            this._clearDismiss();
            this.callinActive = false;
            if (this.menu) {
                this.menu.remove();
                this.menu = null;
            }
            this.openSub = null;
            this.openExt = null;
            this.openNest = null;
        }

        _runCallin(command) {
            const cmd = String(command ?? "").trim();
            if (!cmd) return;
            try {
                if (this.host && typeof this.host.callin === "function") {
                    this.host.callin(cmd);
                } else if (typeof navi === "function") {
                    navi(cmd);
                } else if (typeof globalThis.navi === "function") {
                    globalThis.navi(cmd);
                } else {
                    console.warn("[dropdown] navi callin unavailable");
                }
            } catch (err) {
                console.error("[dropdown] callin failed", err);
            }
        }

        /** Classic-style navi('callin') — sits before plugins (settings). */
        _appendCallinItem(menu) {
            const row = this._item("navi('callin')");
            row.dataset.smdCallin = "true";
            row.addEventListener("click", (e) => {
                e.stopPropagation();
                this._activateCallin(row);
            });
            menu.appendChild(row);
        }

        _activateCallin(row) {
            if (!row || row.dataset.smdCallinActive === "1") return;

            // Always inline (classic desktop). Avoid prompt() — touch laptops
            // often trip isMobile via maxTouchPoints and get a dialog instead.
            this.callinActive = true;
            row.dataset.smdCallinActive = "1";
            row.classList.add("smd-input-row");
            row.textContent = "";

            const input = document.createElement("input");
            input.style.cssText = STYLES.input;
            input.placeholder = "Enter command...";
            input.setAttribute("aria-label", "navi callin");
            row.appendChild(input);
            input.focus();
            input.select();

            input.addEventListener("click", (e) => e.stopPropagation());
            input.addEventListener("mousedown", (e) => e.stopPropagation());

            const resetLabel = () => {
                this.callinActive = false;
                row.dataset.smdCallinActive = "0";
                row.classList.remove("smd-input-row");
                row.textContent = "navi('callin')";
            };

            input.addEventListener("keydown", (e) => {
                e.stopPropagation();
                if (e.key === "Enter") {
                    const command = input.value.trim();
                    if (command) this._runCallin(command);
                    this.callinActive = false;
                    this.close();
                } else if (e.key === "Escape") {
                    e.preventDefault();
                    resetLabel();
                }
            });

            input.addEventListener("blur", () => {
                setTimeout(() => {
                    if (this.menu && this.callinActive && row.isConnected) {
                        resetLabel();
                    }
                }, 10);
            });
        }

        /** Clamp fixed menu to the visual viewport using last righttap (_at). */
        _place() {
            if (!this.menu || !this._at) return;
            const x = this._at.x;
            const y = this._at.y;
            const vv = window.visualViewport;
            const vw = vv?.width ?? window.innerWidth;
            const vh = vv?.height ?? window.innerHeight;
            const ox = vv?.offsetLeft ?? 0;
            const oy = vv?.offsetTop ?? 0;
            // Clear prior size so getBoundingClientRect reflects content growth
            // after nest/plugins expand (max-height still caps via CSS).
            this.menu.style.maxHeight = "";
            const maxH = Math.max(48, Math.floor(vh - 16));
            this.menu.style.maxHeight = `${maxH}px`;
            const rect = this.menu.getBoundingClientRect();
            const left = Math.max(ox + 8, Math.min(ox + x, ox + vw - rect.width - 8));
            const top = Math.max(oy + 8, Math.min(oy + y, oy + vh - rect.height - 8));
            this.menu.style.left = `${left}px`;
            this.menu.style.top = `${top}px`;
        }

        show(x, y) {
            if (!isBrowser || !this.host) return;
            this.close();
            this._at = { x: Number(x) || 0, y: Number(y) || 0 };

            const menu = document.createElement("div");
            menu.id = "supermouse-dropdown-menu";
            menu.style.cssText = STYLES.menu;
            this.menu = menu;
            createdElements.push(menu);

            const vanity = this._item("supermouse! dropdown", { vanity: true });
            menu.appendChild(vanity);

            // Before plugins/settings — same idea as classic supermouse navi('callin').
            this._appendCallinItem(menu);

            // Formal top-level extension menus (e.g. stagejockey ▸).
            this._appendRootMenus(menu);

            const pluginsItem = this._item("plugins");
            pluginsItem.addEventListener("click", (e) => {
                e.stopPropagation();
                this._togglePluginsSub(pluginsItem);
            });
            menu.appendChild(pluginsItem);

            // Prefer documentElement (same as pecklogger): survives body scrollport quirks.
            const mount = document.documentElement || document.body;
            mount.appendChild(menu);
            this._place();

            const onDocDown = (e) => {
                if (this.menu && !this.menu.contains(e.target)) this.close();
            };
            const onKey = (e) => {
                // While callin input is open, Escape is handled by the input (reset label).
                if (e.key === "Escape" && !this.callinActive) this.close();
            };
            this._dismissTimer = setTimeout(() => {
                this._dismissTimer = null;
                document.addEventListener("mousedown", onDocDown, true);
                document.addEventListener("keydown", onKey, true);
                this._dismiss = { onDocDown, onKey };
            }, 0);
        }

        _discoverRootMenus() {
            const menus = new Map(this.rootMenus);
            try {
                const names =
                    typeof navi.listModules === "function"
                        ? navi.listModules()
                        : Object.keys(navi.mod || {});
                for (const name of names) {
                    const mod = navi.mod?.[name];
                    const def = mod?.rootDropdownMenu;
                    if (!def?.id || menus.has(def.id)) continue;
                    const action =
                        typeof def.action === "function"
                            ? def.action
                            : typeof def.execute === "function"
                              ? def.execute
                              : typeof def.onClick === "function"
                                ? def.onClick
                                : null;
                    const build = typeof def.build === "function" ? def.build : null;
                    if (!build && !action) continue;
                    menus.set(def.id, {
                        id: def.id,
                        label: def.label || def.id,
                        title: def.title || "",
                        build,
                        action,
                    });
                }
            } catch (err) {
                console.error("[dropdown] root menu discovery failed", err);
            }
            return menus;
        }

        _appendRootMenus(menu) {
            for (const ext of this._discoverRootMenus().values()) {
                const leaf = typeof ext.action === "function" && typeof ext.build !== "function";
                const row = this._item(leaf ? ext.label : `${ext.label} ▸`);
                row.dataset.smdRoot = ext.id;
                if (ext.title) row.title = ext.title;
                row.addEventListener("click", (e) => {
                    e.stopPropagation();
                    if (leaf) {
                        this.close();
                        try {
                            ext.action({
                                close: () => this.close(),
                                pointer: () => ({ ...(this._at || { x: 0, y: 0 }) }),
                            });
                        } catch (err) {
                            console.error("[dropdown] root action failed", err);
                        }
                        return;
                    }
                    this._toggleRootMenu(row, ext);
                });
                menu.appendChild(row);
            }
        }

        _menuBuildApi(parentItem, { scope = "root", nest = false } = {}) {
            const mark = (el) => {
                if (scope === "plugins") {
                    el.dataset.smdSub = "plugins";
                    el.dataset.smdExt = "true";
                } else if (nest) {
                    el.dataset.smdRootSub = "true";
                    el.dataset.smdNest = "true";
                } else {
                    el.dataset.smdRootSub = "true";
                }
                return el;
            };
            return {
                styles: STYLES,
                pointer: () => ({ ...(this._at || { x: 0, y: 0 }) }),
                close: () => this.close(),
                item: (text, opts) => mark(this._item(text, opts)),
                inputRow: (label, value, onCommit) => {
                    const row = document.createElement("div");
                    row.className = "smd-item smd-input-row";
                    row.style.cssText = STYLES.item;
                    mark(row);
                    row.addEventListener("click", (e) => e.stopPropagation());

                    const lab = document.createElement("div");
                    lab.textContent = label;
                    lab.style.cssText = "margin-bottom:2px;font-size:11px;color:#333;";
                    row.appendChild(lab);

                    const input = document.createElement("input");
                    input.style.cssText = STYLES.input;
                    input.value = value;
                    input.addEventListener("click", (e) => e.stopPropagation());
                    input.addEventListener("keydown", (e) => {
                        e.stopPropagation();
                        if (e.key === "Enter") {
                            onCommit(input.value.trim());
                            input.blur();
                        } else if (e.key === "Escape") {
                            input.value = value;
                            input.blur();
                        }
                    });
                    input.addEventListener("blur", () => {
                        onCommit(input.value.trim());
                    });
                    row.appendChild(input);
                    return row;
                },
                insertAfter: (el) => {
                    let cursor = parentItem;
                    const sel =
                        nest
                            ? "[data-smd-nest='true']"
                            : scope === "plugins"
                              ? "[data-smd-ext='true']"
                              : "[data-smd-root-sub='true']:not([data-smd-nest='true'])";
                    const last = [...this.menu.querySelectorAll(sel)].pop();
                    if (last) cursor = last;
                    cursor.parentNode.insertBefore(el, cursor.nextSibling);
                    this._place();
                },
                toggleNested: (nestParent, buildFn) => {
                    this._toggleNested(nestParent, buildFn);
                },
            };
        }

        _clearRootSub() {
            if (!this.menu) return;
            [...this.menu.querySelectorAll("[data-smd-root-sub]")].forEach((n) => n.remove());
            this.openExt = null;
            this.openNest = null;
        }

        _clearNest() {
            if (!this.menu) return;
            [...this.menu.querySelectorAll("[data-smd-nest='true']")].forEach((n) => n.remove());
            this.openNest = null;
        }

        _toggleRootMenu(parentItem, ext) {
            if (this.openExt === parentItem) {
                this._clearRootSub();
                this._place();
                return;
            }
            this._clearSub();
            this._clearRootSub();
            const api = this._menuBuildApi(parentItem, { scope: "root" });
            ext.build(api);
            this.openExt = parentItem;
            this._place();
        }

        _toggleNested(parentItem, buildFn) {
            if (this.openNest === parentItem) {
                this._clearNest();
                this._place();
                return;
            }
            this._clearNest();
            const api = this._menuBuildApi(parentItem, { scope: "root", nest: true });
            buildFn(api);
            this.openNest = parentItem;
            this._place();
        }

        _item(text, { vanity = false, checkbox = false } = {}) {
            const el = document.createElement("div");
            el.className = vanity ? "smd-item smd-vanity" : "smd-item";
            el.style.cssText = STYLES.item + (vanity ? STYLES.vanity : "") + (checkbox ? STYLES.checkbox : "");
            el.textContent = text;
            return el;
        }

        _clearSub() {
            if (!this.menu) return;
            [...this.menu.querySelectorAll("[data-smd-sub]")].forEach((n) => n.remove());
            this.openSub = null;
            this.openExt = null;
            // opening plugins clears any open root nest/ext as well
            this._clearRootSub();
        }

        _clearExt() {
            if (!this.menu) return;
            [...this.menu.querySelectorAll("[data-smd-ext='true']")].forEach((n) => n.remove());
            this.openExt = null;
        }

        _togglePluginsSub(parentItem) {
            if (this.openSub === parentItem) {
                this._clearSub();
                return;
            }
            this._clearSub();
            if (!this.host) return;

            const plugins = this.host.listPlugins();
            let insertAfter = parentItem;

            plugins.forEach((p) => {
                const mark = p.enabled ? "[x]" : "[ ]";
                const row = this._item(`${mark} ${p.id}`, { checkbox: true });
                row.dataset.smdSub = "plugins";
                row.title = p.description || p.name;
                row.addEventListener("click", (e) => {
                    e.stopPropagation();
                    this.host.togglePlugin(p.id);
                    this._clearSub();
                    this._togglePluginsSub(parentItem);
                });
                insertAfter.parentNode.insertBefore(row, insertAfter.nextSibling);
                insertAfter = row;
            });

            if (!plugins.length) {
                const empty = this._item("(no plugins)", { vanity: true });
                empty.dataset.smdSub = "plugins";
                parentItem.parentNode.insertBefore(empty, parentItem.nextSibling);
                insertAfter = empty;
            }

            // Pull menus from registerPluginMenu + any mounted mod.dropdownMenu
            const menus = new Map(this.pluginMenus);
            try {
                const names =
                    typeof navi.listModules === "function"
                        ? navi.listModules()
                        : Object.keys(navi.mod || {});
                for (const name of names) {
                    const mod = navi.mod?.[name];
                    const def = mod?.dropdownMenu;
                    if (def?.id && typeof def.build === "function" && !menus.has(def.id)) {
                        menus.set(def.id, {
                            id: def.id,
                            label: def.label || def.id,
                            build: def.build
                        });
                    }
                }
            } catch (err) {
                console.error("[dropdown] plugin menu discovery failed", err);
            }

            for (const ext of menus.values()) {
                const row = this._item(`${ext.label} ▸`);
                row.dataset.smdSub = "plugins";
                row.addEventListener("click", (e) => {
                    e.stopPropagation();
                    this._togglePluginMenu(row, ext);
                });
                insertAfter.parentNode.insertBefore(row, insertAfter.nextSibling);
                insertAfter = row;
            }

            this.openSub = parentItem;
            this._place();
        }

        _togglePluginMenu(parentItem, ext) {
            if (this.openExt === parentItem) {
                this._clearExt();
                this._place();
                return;
            }
            this._clearExt();

            const api = {
                styles: STYLES,
                item: (text, opts) => {
                    const el = this._item(text, opts);
                    el.dataset.smdSub = "plugins";
                    el.dataset.smdExt = "true";
                    return el;
                },
                inputRow: (label, value, onCommit) => {
                    const row = document.createElement("div");
                    row.className = "smd-item smd-input-row";
                    row.style.cssText = STYLES.item;
                    row.dataset.smdSub = "plugins";
                    row.dataset.smdExt = "true";
                    row.addEventListener("click", (e) => e.stopPropagation());

                    const lab = document.createElement("div");
                    lab.textContent = label;
                    lab.style.cssText = "margin-bottom:2px;font-size:11px;color:#333;";
                    row.appendChild(lab);

                    const input = document.createElement("input");
                    input.style.cssText = STYLES.input;
                    input.value = value;
                    input.addEventListener("click", (e) => e.stopPropagation());
                    input.addEventListener("keydown", (e) => {
                        e.stopPropagation();
                        if (e.key === "Enter") {
                            onCommit(input.value.trim());
                            input.blur();
                        } else if (e.key === "Escape") {
                            input.value = value;
                            input.blur();
                        }
                    });
                    input.addEventListener("blur", () => {
                        onCommit(input.value.trim());
                    });
                    row.appendChild(input);
                    return row;
                },
                insertAfter: (el) => {
                    let cursor = parentItem;
                    const last = [...this.menu.querySelectorAll("[data-smd-ext='true']")].pop();
                    if (last) cursor = last;
                    cursor.parentNode.insertBefore(el, cursor.nextSibling);
                    this._place();
                }
            };

            ext.build(api);
            this.openExt = parentItem;
            this._place();
        }
    }

    const menu = new DropdownMenu();

    const onRightTap = (ctx) => {
        if (!menu.allowShow(ctx)) return;
        menu.show(ctx.x, ctx.y);
    };

    return {
        name: "supermouse_plugin_dropdown",
        version: "0.5.2",
        description: "Classic dropdown UI — righttap; root menus (▸ or leaf action) + plugins",

        moduleInfo: {
            name: "supermouse_plugin_dropdown",
            version: "0.5.2",
            description: "Classic dropdown UI — root ▸ menus or leaf action buttons + plugins"
        },

        menu,
        PLUGIN_ID,

        registerShowGate: (fn) => menu.registerShowGate(fn),
        registerPluginMenu: (def) => menu.registerPluginMenu(def),
        registerRootMenu: (def) => menu.registerRootMenu(def),

        commands: {
            dropdown: {
                name: "dropdown",
                description: "dropdown <status|help>",
                execute: async (subcommand) => {
                    if (!subcommand || subcommand === "help") {
                        return [
                            "supermouse_plugin_dropdown v0.5.1",
                            "Opens on supermouse righttap (right button up with almost no move).",
                            "Hold+move is for other plugins (e.g. stagejockey) — see: supermouse triggers",
                            "",
                            "  dropdown status",
                            "  dropdown help"
                        ].join("\n");
                    }
                    if (subcommand === "status") {
                        const host = resolveSuperMouse();
                        const plug = host?.getPlugin?.(PLUGIN_ID);
                        return [
                            `dropdown menu open: ${menu.menu ? "yes" : "no"}`,
                            `registered with supermouse: ${host ? "yes" : "no"}`,
                            `plugin enabled: ${plug ? (plug.enabled ? "yes" : "no") : "n/a"}`,
                            `root menus: ${[...menu.rootMenus.keys()].join(", ") || "(none)"}`,
                            `plugin menus: ${[...menu.pluginMenus.keys()].join(", ") || "(none)"}`
                        ].join("\n");
                    }
                    return `Unknown: ${subcommand}. Type 'dropdown help'.`;
                }
            }
        },

        onMount: async () => {
            if (!isBrowser) {
                selfUnmount("browser environment required");
                return;
            }

            const host = resolveSuperMouse();
            if (!host) {
                selfUnmount("supermouse must be mounted first");
                return;
            }

            menu.attach(host);

            unregister = host.registerPlugin({
                id: PLUGIN_ID,
                name: "Dropdown",
                description: "Opens on righttap (right up, no move)",
                modes: ["righttap"],
                enabled: true,
                onRightTap,
                onDisable: () => {
                    menu.close();
                },
                onEnable: () => {
                    menu.attach(host);
                }
            });

            watchHost();

            if (typeof navi.emit === "function") {
                navi.emit("supermouse_plugin_dropdown", { kind: "mount" });
            }

            if (typeof navi.callout === "function") {
                navi.callout("[supermouse_plugin_dropdown] mounted — righttap opens menu");
            } else {
                console.log("[supermouse_plugin_dropdown] mounted — righttap opens menu");
            }
        },

        onUnmount: () => {
            unwatchHost();

            if (typeof unregister === "function") {
                try {
                    unregister();
                } catch (_) {
                    /* host may already be gone */
                }
                unregister = null;
            }

            menu.destroy();

            eventListeners.forEach(({ element, event, handler, capture }) => {
                element.removeEventListener(event, handler, !!capture);
            });
            eventListeners.length = 0;

            createdElements.forEach((el) => el.remove());
            createdElements.length = 0;

            addedStyles.forEach((style) => style.remove());
            addedStyles.length = 0;

            timers.forEach(({ type, id }) => {
                if (type === "interval") clearInterval(id);
                if (type === "timeout") clearTimeout(id);
            });
            timers.length = 0;

            if (typeof navi.callout === "function") {
                navi.callout("[supermouse_plugin_dropdown] unmounted");
            } else {
                console.log("[supermouse_plugin_dropdown] unmounted");
            }
        }
    };
};
