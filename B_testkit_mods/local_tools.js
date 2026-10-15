/**
 * local_tools — init_script, tips, items, and files on navi.storage.
 *
 *   mount flowerpot/hypercloud/testkit/mods/legacy/local_tools.js
 *   local_tools help
 */
export const register = (navi) => {
    const VERSION = "2.0.0";
    const INIT_SCRIPT_IB = "navi:init_script";
    const FRAME_PREFIX = "navi:ibgib:frame:";
    const TIP_POINTER_PREFIX = "navi:ibgib:tip:";

    const tipApi = () => {
        const tip = navi?.storage?.tip;
        if (!tip || typeof tip.get !== "function" || typeof tip.list !== "function") {
            throw new Error("navi.storage.tip unavailable");
        }
        return tip;
    };

    const itemApi = () => {
        const item = navi?.storage?.item;
        if (!item || typeof item.get !== "function") {
            throw new Error("navi.storage.item unavailable");
        }
        return item;
    };

    const fileApi = () => {
        const file = navi?.storage?.file;
        if (!file || typeof file.list !== "function") {
            throw new Error("navi.storage.file unavailable");
        }
        return file;
    };

    const say = (msg) => {
        const text = String(msg ?? "");
        if (typeof navi?.callout === "function") navi.callout(`[local_tools] ${text}`);
        return text;
    };

    const formatValue = (value, { max = 4000 } = {}) => {
        if (value == null) return "(null)";
        if (typeof value === "string") return value;
        try {
            const json = JSON.stringify(value, null, 2);
            if (json.length <= max) return json;
            return `${json.slice(0, max)}… (${json.length} chars)`;
        } catch {
            return String(value);
        }
    };

    const tipAddr = (frame) => {
        if (!frame?.ib) return "";
        return frame.gib ? `${frame.ib}^${frame.gib}` : String(frame.ib);
    };

    const filterParkTips = (ibs) =>
        (Array.isArray(ibs) ? ibs : [])
            .map(String)
            .filter((ib) => {
                return (
                    !ib.startsWith(FRAME_PREFIX) &&
                    !ib.startsWith(TIP_POINTER_PREFIX)
                );
            })
            .sort((a, b) => a.localeCompare(b));

    class InitScriptManager {
        async getScript() {
            if (typeof navi.getInitScript === "function") {
                try {
                    const lines = await navi.getInitScript();
                    return Array.isArray(lines) ? lines.map(String) : [];
                } catch {
                    /* fall through */
                }
            }
            try {
                const frame = await tipApi().get(INIT_SCRIPT_IB);
                const script = frame?.data?.script;
                return Array.isArray(script) ? script.map(String) : [];
            } catch (error) {
                console.error("[local_tools] getScript failed", error);
                return [];
            }
        }

        async saveScript(commands) {
            const script = Array.isArray(commands) ? commands.map(String) : [];
            const tip = tipApi();
            if (typeof tip.mut8 !== "function") {
                throw new Error("navi.storage.tip.mut8 unavailable");
            }
            const prior = await tip.get(INIT_SCRIPT_IB);
            if (!prior) {
                throw new Error(`${INIT_SCRIPT_IB} tip missing — reseed navi shell`);
            }
            await tip.mut8(INIT_SCRIPT_IB, {
                script,
                n: (Number(prior.data?.n) || 0) + 1,
            });
            return true;
        }

        async addToScript(command) {
            const line = String(command || "").trim();
            if (!line) return "empty command";
            if (typeof navi.addToInitScript === "function") {
                await navi.addToInitScript(line);
                return say(`added init_script line: ${line}`);
            }
            const script = await this.getScript();
            script.push(line);
            await this.saveScript(script);
            return say(`added init_script line: ${line}`);
        }

        async removeFromScript(index) {
            const script = await this.getScript();
            if (index < 0 || index >= script.length) {
                return `invalid index ${index} (${script.length} line(s), 0-${Math.max(0, script.length - 1)})`;
            }
            const removed = script.splice(index, 1)[0];
            await this.saveScript(script);
            return say(`removed init_script[${index}]: ${removed}`);
        }

        async clearScript() {
            if (typeof navi.clearInitScript === "function") {
                await navi.clearInitScript();
                return say("init_script cleared");
            }
            await this.saveScript([]);
            return say("init_script cleared");
        }

        async listScript() {
            const script = await this.getScript();
            if (!script.length) {
                return `${INIT_SCRIPT_IB} — empty (no boot commands)`;
            }
            const lines = [`${INIT_SCRIPT_IB} (${script.length} line(s)):`];
            script.forEach((command, index) => {
                lines.push(`  ${index}: ${command}`);
            });
            return lines.join("\n");
        }

        async runScript(indices) {
            if (typeof navi.script !== "function") {
                throw new Error("navi.script unavailable");
            }
            let script = await this.getScript();
            if (!script.length) return "init_script is empty";
            if (indices?.length) {
                const picked = [];
                for (const raw of indices) {
                    const index = Number(raw);
                    if (!Number.isInteger(index) || index < 0 || index >= script.length) {
                        return `invalid index: ${raw}`;
                    }
                    picked.push(script[index]);
                }
                script = picked;
            }
            await navi.script(script);
            return say(`ran ${script.length} init_script line(s)`);
        }
    }

    class TipsManager {
        async listTips(prefix = "") {
            const ibs = filterParkTips(await tipApi().list());
            const p = String(prefix || "").trim().toLowerCase();
            const filtered = p
                ? ibs.filter((ib) => ib.toLowerCase().startsWith(p))
                : ibs;
            if (!filtered.length) {
                return p
                    ? `no tips matching prefix “${prefix}”`
                    : "no tips in navi.storage.tip";
            }
            const lines = [`tips (${filtered.length}${p ? ` · prefix ${prefix}` : ""}):`];
            for (const ib of filtered) {
                let extra = "";
                try {
                    const frame = await tipApi().get(ib);
                    const addr = tipAddr(frame);
                    const parts = Array.isArray(frame?.data?.parts)
                        ? frame.data.parts.slice(0, 3).join(",")
                        : "";
                    extra = [
                        addr && addr !== ib ? addr : "",
                        parts ? `parts: ${parts}` : "",
                    ]
                        .filter(Boolean)
                        .join(" · ");
                } catch {
                    /* ignore */
                }
                lines.push(extra ? `  ${ib}  (${extra})` : `  ${ib}`);
            }
            return lines.join("\n");
        }

        async getTip(ib) {
            const key = String(ib || "").trim();
            if (!key) return "usage: local_tools tips get <ib>";
            const frame = await tipApi().get(key);
            if (!frame) return `tip not found: ${key}`;
            const header = [
                tipAddr(frame),
                frame?.data?.about?.label
                    ? `label: ${frame.data.about.label}`
                    : "",
            ]
                .filter(Boolean)
                .join(" · ");
            return `${header}\n${formatValue(frame)}`;
        }

        async listFrames(ib) {
            const key = String(ib || "").trim();
            if (!key) return "usage: local_tools tips frames <ib>";
            const frameApi = tipApi().frame;
            if (!frameApi || typeof frameApi.list !== "function") {
                throw new Error("navi.storage.tip.frame.list unavailable");
            }
            const addrs = await frameApi.list(key);
            const list = Array.isArray(addrs) ? addrs.map(String) : [];
            if (!list.length) return `no frames for ${key}`;
            return [`frames for ${key} (${list.length}):`, ...list.map((a) => `  ${a}`)].join(
                "\n"
            );
        }

        async getFrame(addr) {
            const key = String(addr || "").trim();
            if (!key) return "usage: local_tools tips frame <ib^gib>";
            const frameApi = tipApi().frame;
            if (!frameApi || typeof frameApi.get !== "function") {
                throw new Error("navi.storage.tip.frame.get unavailable");
            }
            const frame = await frameApi.get(key);
            if (!frame) return `frame not found: ${key}`;
            return formatValue(frame);
        }

        async deleteTip(ib) {
            const key = String(ib || "").trim();
            if (!key) return "usage: local_tools tips del <ib>";
            if (key === INIT_SCRIPT_IB) {
                return `refusing to delete ${INIT_SCRIPT_IB}`;
            }
            if (typeof tipApi().del !== "function") {
                throw new Error("navi.storage.tip.del unavailable");
            }
            await tipApi().del(key);
            return say(`deleted tip ${key}`);
        }
    }

    class StorageManager {
        async listFiles(directory = "") {
            const files = await fileApi().list(directory);
            if (!files.length) {
                return directory
                    ? `no files in ${directory}`
                    : "no files in navi.storage.file";
            }
            return [
                `files${directory ? ` in ${directory}` : ""} (${files.length}):`,
                ...files.map((f) => `  ${f}`),
            ].join("\n");
        }

        async showFileContent(filePath) {
            const path = String(filePath || "").trim();
            if (!path) return "usage: local_tools files show <path>";
            const content = await fileApi().load(path);
            if (content == null) return `file not found: ${path}`;
            return `file ${path}:\n${formatValue(content, { max: 8000 })}`;
        }

        async saveFile(filePath, content) {
            const path = String(filePath || "").trim();
            if (!path) return "usage: local_tools files save <path> <content>";
            await fileApi().save(path, {
                media: String(content ?? ""),
                mime: "text/plain; charset=utf-8",
            });
            return say(`saved file ${path}`);
        }

        async deleteFile(filePath) {
            const path = String(filePath || "").trim();
            if (!path) return "usage: local_tools files delete <path>";
            await fileApi().del(path);
            return say(`deleted file ${path}`);
        }

        async listStorageItems(prefix = "") {
            const item = itemApi();
            if (typeof item.list !== "function") {
                return "navi.storage.item.list unavailable";
            }
            const keys = await item.list(prefix);
            const list = Array.isArray(keys) ? keys.map(String) : [];
            if (!list.length) {
                return prefix
                    ? `no item keys matching “${prefix}”`
                    : "no navi item keys (storage.item tips)";
            }
            return [
                `items${prefix ? ` · prefix ${prefix}` : ""} (${list.length}):`,
                ...list.map((k) => `  ${k}`),
            ].join("\n");
        }

        async getStorageItem(key) {
            const k = String(key || "").trim();
            if (!k) return "usage: local_tools items get <key>";
            const value = await itemApi().get(k);
            if (value == null) return `item not found: ${k}`;
            return `${k}:\n${formatValue(value)}`;
        }

        async setStorageItem(key, value) {
            const k = String(key || "").trim();
            if (!k) return "usage: local_tools items set <key> <value>";
            let parsed = value;
            const raw = String(value ?? "");
            if (raw.startsWith("{") || raw.startsWith("[") || raw === "true" || raw === "false" || raw === "null" || /^-?\d+(\.\d+)?$/.test(raw)) {
                try {
                    parsed = JSON.parse(raw);
                } catch {
                    parsed = raw;
                }
            }
            await itemApi().set(k, parsed);
            return say(`set item ${k}`);
        }

        async deleteStorageItem(key) {
            const k = String(key || "").trim();
            if (!k) return "usage: local_tools items delete <key>";
            await itemApi().del(k);
            return say(`deleted item ${k}`);
        }
    }

    const initScriptManager = new InitScriptManager();
    const tipsManager = new TipsManager();
    const storageManager = new StorageManager();

    const help = () =>
        [
            `local_tools v${VERSION}`,
            "Local navi storage + boot script helpers.",
            "",
            "Init script (tip navi:init_script · data.script):",
            "  local_tools script list",
            "  local_tools script add <line>",
            "  local_tools script remove <index>",
            "  local_tools script clear",
            "  local_tools script run [index …]   run all or selected lines now",
            "",
            "Tips (navi.storage.tip):",
            "  local_tools tips list [prefix]",
            "  local_tools tips get <ib>",
            "  local_tools tips frames <ib>",
            "  local_tools tips frame <ib^gib>",
            "  local_tools tips del <ib>",
            "",
            "Files (navi.storage.file):",
            "  local_tools files list [dir]",
            "  local_tools files show <path>",
            "  local_tools files save <path> <content>",
            "  local_tools files delete <path>",
            "",
            "Items (navi.storage.item sugar):",
            "  local_tools items list [prefix]",
            "  local_tools items get <key>",
            "  local_tools items set <key> <value>",
            "  local_tools items delete <key>",
        ].join("\n");

    async function handleScriptCommand(args) {
        if (!args.length) {
            return "script op required: list | add | remove | clear | run";
        }
        const [action, ...actionArgs] = args;
        switch (action) {
            case "list":
            case "show":
                return await initScriptManager.listScript();
            case "add":
                if (!actionArgs.length) return "usage: local_tools script add <line>";
                return await initScriptManager.addToScript(actionArgs.join(" "));
            case "remove":
            case "rm":
                if (!actionArgs.length) return "usage: local_tools script remove <index>";
                {
                    const index = parseInt(actionArgs[0], 10);
                    if (Number.isNaN(index)) return "index must be a number";
                    return await initScriptManager.removeFromScript(index);
                }
            case "clear":
                return await initScriptManager.clearScript();
            case "run":
            case "exec":
                return await initScriptManager.runScript(actionArgs);
            default:
                return `unknown script op: ${action}`;
        }
    }

    async function handleTipsCommand(args) {
        if (!args.length) {
            return "tips op required: list | get | frames | frame | del";
        }
        const [action, ...actionArgs] = args;
        switch (action) {
            case "list":
            case "ls":
                return await tipsManager.listTips(actionArgs[0] || "");
            case "get":
            case "show":
                return await tipsManager.getTip(actionArgs[0]);
            case "frames":
                return await tipsManager.listFrames(actionArgs[0]);
            case "frame":
                return await tipsManager.getFrame(actionArgs.join(" "));
            case "del":
            case "delete":
                return await tipsManager.deleteTip(actionArgs[0]);
            default:
                return `unknown tips op: ${action}`;
        }
    }

    async function handleFilesCommand(args) {
        if (!args.length) return "files op required: list | show | save | delete";
        const [action, ...actionArgs] = args;
        switch (action) {
            case "list":
            case "ls":
                return await storageManager.listFiles(actionArgs[0] || "");
            case "show":
            case "get":
                return await storageManager.showFileContent(actionArgs[0]);
            case "save":
            case "set":
                if (actionArgs.length < 2) {
                    return "usage: local_tools files save <path> <content>";
                }
                return await storageManager.saveFile(
                    actionArgs[0],
                    actionArgs.slice(1).join(" ")
                );
            case "delete":
            case "del":
                return await storageManager.deleteFile(actionArgs[0]);
            default:
                return `unknown files op: ${action}`;
        }
    }

    async function handleItemsCommand(args) {
        if (!args.length) return "items op required: list | get | set | delete";
        const [action, ...actionArgs] = args;
        switch (action) {
            case "list":
            case "ls":
                return await storageManager.listStorageItems(actionArgs[0] || "");
            case "get":
            case "show":
                return await storageManager.getStorageItem(actionArgs[0]);
            case "set":
                if (actionArgs.length < 2) {
                    return "usage: local_tools items set <key> <value>";
                }
                return await storageManager.setStorageItem(
                    actionArgs[0],
                    actionArgs.slice(1).join(" ")
                );
            case "delete":
            case "del":
                return await storageManager.deleteStorageItem(actionArgs[0]);
            default:
                return `unknown items op: ${action}`;
        }
    }

    const commands = {
        local_tools: {
            name: "local_tools",
            description: "Init script, tips, files, and item storage helpers",
            execute: async (operation, ...args) => {
                if (!operation || operation === "help") return help();
                try {
                    switch (operation) {
                        case "script":
                            return await handleScriptCommand(args);
                        case "tips":
                        case "tip":
                            return await handleTipsCommand(args);
                        case "files":
                        case "file":
                            return await handleFilesCommand(args);
                        case "items":
                        case "item":
                            return await handleItemsCommand(args);
                        default:
                            return `unknown op: ${operation}. Type 'local_tools help'.`;
                    }
                } catch (error) {
                    console.error("[local_tools] command failed", error);
                    return `error: ${error?.message || error}`;
                }
            },
        },
    };

    return {
        name: "local_tools",
        version: VERSION,
        description: "Init script, tips, files, and item storage helpers",
        moduleInfo: {
            name: "local_tools",
            version: VERSION,
            description: "Init script, tips, files, and item storage helpers",
        },
        commands,
        initScriptManager,
        tipsManager,
        storageManager,
        initScriptTools: {
            get: () => initScriptManager.getScript(),
            save: (script) => initScriptManager.saveScript(script),
            add: (command) => initScriptManager.addToScript(command),
            remove: (index) => initScriptManager.removeFromScript(index),
            clear: () => initScriptManager.clearScript(),
            list: () => initScriptManager.listScript(),
            run: (indices) => initScriptManager.runScript(indices),
        },
        tipsTools: {
            list: (prefix) => tipsManager.listTips(prefix),
            get: (ib) => tipsManager.getTip(ib),
            frames: (ib) => tipsManager.listFrames(ib),
            frame: (addr) => tipsManager.getFrame(addr),
            del: (ib) => tipsManager.deleteTip(ib),
        },
        storageTools: {
            files: {
                list: (directory) => storageManager.listFiles(directory),
                show: (filePath) => storageManager.showFileContent(filePath),
                save: (filePath, content) => storageManager.saveFile(filePath, content),
                delete: (filePath) => storageManager.deleteFile(filePath),
            },
            items: {
                list: (prefix) => storageManager.listStorageItems(prefix),
                get: (key) => storageManager.getStorageItem(key),
                set: (key, value) => storageManager.setStorageItem(key, value),
                delete: (key) => storageManager.deleteStorageItem(key),
            },
        },
        onMount: () => {
            console.log(`[local_tools] v${VERSION} mounted`);
        },
    };
};
