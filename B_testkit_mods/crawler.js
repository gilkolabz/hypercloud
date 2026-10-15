export const register = (navi) => {
    const log = (...args) => console.log("[crawler]", ...args);
    const logError = (...args) => console.error("[crawler]", ...args);

    const isBrowser =
        typeof window !== "undefined" && typeof window.document !== "undefined";

    const eventListeners = [];
    const createdElements = [];
    const addedStyles = [];
    const observers = [];
    const timers = [];

    const STORAGE_KEY = "crawler_navi_call_log";
    const ATTR_STATE_KEY = "crawler_attribute_state";

    const settings = {
        navi_calls: false,
        attr_state_rec: false,
        attr_state_interval: 0,
    };

    const naviCallLog = new Map();
    let stdinHandler = null;
    let crawlSession = null;
    let nextLogKey = 1;
    let latestAttributeState = null;
    let attrStateRecorder = null;

    const state = {
        running: false,
    };

    function elementAttributes(el) {
        const attrs = {};
        if (!el?.attributes) return attrs;
        for (const attr of el.attributes) {
            attrs[attr.name] = attr.value;
        }
        return attrs;
    }

    /** Walk parentElement chain up to and including document.body. */
    function describeParentChain(el) {
        const body = document.body;
        let node = el?.parentElement;
        if (!node || !body) return null;

        if (node === body) {
            return {
                tagName: body.tagName,
                attributes: elementAttributes(body),
            };
        }

        const root = {
            tagName: node.tagName,
            attributes: elementAttributes(node),
        };
        let current = root;
        node = node.parentElement;

        while (node) {
            current.parent = {
                tagName: node.tagName,
                attributes: elementAttributes(node),
            };
            current = current.parent;
            if (node === body) break;
            node = node.parentElement;
        }

        return root;
    }

    function buildAttributeSnapshot(sessionId) {
        const body = document.body;
        if (!body) {
            return {
                recordedAt: new Date().toISOString(),
                sessionId: sessionId ?? null,
                iframes: {},
            };
        }

        const iframeNodes = [...body.querySelectorAll("iframe")];
        const iframes = {};
        iframeNodes.forEach((iframe, index) => {
            iframes[String(index)] = {
                index,
                attributes: elementAttributes(iframe),
                parent: describeParentChain(iframe),
            };
        });

        return {
            recordedAt: new Date().toISOString(),
            sessionId: sessionId ?? null,
            iframeCount: iframeNodes.length,
            iframes,
        };
    }

    async function saveAttributeState(snapshot) {
        latestAttributeState = snapshot;
        try {
            await navi.storage.item.set(ATTR_STATE_KEY, snapshot);
        } catch (error) {
            logError("Failed to save attribute state:", error);
        }
    }

    async function loadAttributeStateFromStorage() {
        try {
            const raw = await navi.storage.item.get(ATTR_STATE_KEY);
            if (!raw) return;
            latestAttributeState =
                typeof raw === "string" ? JSON.parse(raw) : raw;
        } catch (error) {
            logError("Failed to load attribute state:", error);
        }
    }

    function stopAttributeStateRecorder() {
        if (!attrStateRecorder) return;

        if (attrStateRecorder.observer) {
            attrStateRecorder.observer.disconnect();
        }
        if (attrStateRecorder.intervalId != null) {
            clearInterval(attrStateRecorder.intervalId);
        }
        if (attrStateRecorder.debounceId != null) {
            clearTimeout(attrStateRecorder.debounceId);
        }

        attrStateRecorder = null;
    }

    function scheduleAttributeStateRecord() {
        if (!attrStateRecorder) return;

        if (attrStateRecorder.debounceId != null) {
            clearTimeout(attrStateRecorder.debounceId);
        }

        attrStateRecorder.debounceId = setTimeout(() => {
            attrStateRecorder.debounceId = null;
            recordAttributeState();
        }, 50);
    }

    function recordAttributeState() {
        if (!attrStateRecorder) return;
        const snapshot = buildAttributeSnapshot(attrStateRecorder.sessionId);
        saveAttributeState(snapshot);
    }

    function startAttributeStateRecorder(sessionId) {
        if (!isBrowser) {
            logError("Attribute state recording requires a browser DOM.");
            return;
        }
        if (!document.body) {
            logError("document.body not available for attribute state recording.");
            return;
        }

        stopAttributeStateRecorder();

        const intervalSec = Number(settings.attr_state_interval) || 0;
        attrStateRecorder = { sessionId, observer: null, intervalId: null, debounceId: null };

        recordAttributeState();

        if (intervalSec > 0) {
            attrStateRecorder.intervalId = setInterval(
                () => recordAttributeState(),
                intervalSec * 1000
            );
            timers.push({ type: "interval", id: attrStateRecorder.intervalId });
            return;
        }

        const observer = new MutationObserver(() => scheduleAttributeStateRecord());
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
        });
        attrStateRecorder.observer = observer;
        observers.push(observer);
    }

    function nextKey() {
        return String(nextLogKey++);
    }

    function syncNextLogKey() {
        for (const key of naviCallLog.keys()) {
            const n = Number(key);
            if (!Number.isNaN(n) && n >= nextLogKey) {
                nextLogKey = n + 1;
            }
        }
    }

    /** Map → plain object for navi.storage (structured value, not a JSON string). */
    function mapToStorageValue(map) {
        return Object.fromEntries(map);
    }

    /** Plain object / legacy shapes → Map. */
    function storageValueToMap(raw) {
        const map = new Map();
        if (!raw) return map;

        let data = raw;
        if (typeof raw === "string") {
            try {
                data = JSON.parse(raw);
            } catch {
                return map;
            }
        }

        if (Array.isArray(data.entries)) {
            for (const [key, entry] of data.entries) {
                map.set(String(key), entry);
            }
            return map;
        }

        if (data && typeof data === "object") {
            for (const [key, entry] of Object.entries(data)) {
                if (key === "settings") continue;
                map.set(String(key), entry);
            }
        }

        return map;
    }

    async function loadFromStorage() {
        try {
            const raw = await navi.storage.item.get(STORAGE_KEY);
            if (!raw) return;

            naviCallLog.clear();
            for (const [key, entry] of storageValueToMap(raw)) {
                naviCallLog.set(key, entry);
            }
            syncNextLogKey();
        } catch (error) {
            logError("Failed to load navi call log:", error);
        }
    }

    let saveChain = Promise.resolve();

    function saveToStorage() {
        saveChain = saveChain
            .then(async () => {
                await navi.storage.item.set(
                    STORAGE_KEY,
                    mapToStorageValue(naviCallLog)
                );
            })
            .catch((error) => {
                logError("Failed to save navi call log:", error);
            });
        return saveChain;
    }

    function onStdin(input) {
        if (!settings.navi_calls) return;

        const entry = {
            input,
            at: new Date().toISOString(),
            session: crawlSession?.id ?? null,
        };

        naviCallLog.set(nextKey(), entry);
        if (crawlSession) {
            crawlSession.callCount++;
        }
        saveToStorage();
    }

    function attachStdinHandler() {
        if (stdinHandler) return;
        stdinHandler = onStdin;
        navi.on("stdin", stdinHandler);
    }

    function detachStdinHandler() {
        if (!stdinHandler) return;
        navi.off("stdin", stdinHandler);
        stdinHandler = null;
    }

    function beginCrawlSession() {
        crawlSession = {
            id: String(Date.now()),
            startedAt: new Date().toISOString(),
            callCount: 0,
        };
        if (settings.navi_calls) {
            attachStdinHandler();
        }
        if (settings.attr_state_rec) {
            startAttributeStateRecorder(crawlSession.id);
        }
        return crawlSession;
    }

    async function endCrawlSession() {
        if (!crawlSession) return;

        await saveToStorage();
        if (attrStateRecorder) {
            recordAttributeState();
            stopAttributeStateRecorder();
        }

        crawlSession = null;
        detachStdinHandler();
    }

    function printHelp() {
        const lines = [
            "record navi(\"...\") calls in a session",
            "  crawler navi_call_log enable     allow recording (required before start)",
            "  crawler navi_call_log disable    revoke + detach listener",
            "  crawler navi_call_log show [n]   list recorded calls",
            "  crawler navi_call_log clear      clear the log",
            "  crawler attr_state enable        allow iframe attr recording",
            "  crawler attr_state disable       turn off attr recording",
            "  crawler attr_state interval <n>  0=realtime, else seconds",
            "  crawler attr_state show          latest snapshot",
            "  crawler start                    begin session",
            "  crawler stop                     end crawl session",
        ];
        if (crawlSession) {
            lines.push(
                `  active: ${crawlSession.id} (${crawlSession.callCount} calls)`
            );
        }
        lines.push(`  navi call logging: ${settings.navi_calls ? "on" : "off"}`);
        lines.push(
            `  attr state recording: ${settings.attr_state_rec ? "on" : "off"} (interval: ${settings.attr_state_interval}s)`
        );
        log(lines.join("\n"));
    }

    async function handleAttrState(action, ...rest) {
        if (!isBrowser) {
            return "[crawler] Attribute state requires a browser DOM.";
        }

        if (!action) {
            return [
                "[crawler] Iframe attribute state (latest snapshot only)",
                `Recording allowed: ${settings.attr_state_rec}`,
                `Interval: ${settings.attr_state_interval}s (0 = realtime)`,
                `Storage key: ${ATTR_STATE_KEY}`,
                latestAttributeState
                    ? `Last recorded: ${latestAttributeState.recordedAt} (${latestAttributeState.iframeCount ?? Object.keys(latestAttributeState.iframes || {}).length} iframes)`
                    : "Last recorded: (none)",
                "",
                "Usage:",
                "  crawler attr_state enable",
                "  crawler attr_state disable",
                "  crawler attr_state interval <seconds>",
                "  crawler attr_state show",
                "  crawler attr_state clear",
            ].join("\n");
        }

        switch (action) {
            case "enable": {
                settings.attr_state_rec = true;
                return "[crawler] Attribute state recording enabled. Run crawler start to capture.";
            }

            case "disable": {
                settings.attr_state_rec = false;
                stopAttributeStateRecorder();
                return "[crawler] Attribute state recording disabled.";
            }

            case "interval": {
                const sec = rest[0];
                if (sec === undefined || sec === "") {
                    return `[crawler] Current attr_state_interval: ${settings.attr_state_interval}s (0 = realtime)`;
                }
                const n = Number(sec);
                if (Number.isNaN(n) || n < 0) {
                    return "[crawler] Usage: crawler attr_state interval <seconds> (0 or greater)";
                }
                settings.attr_state_interval = n;
                if (attrStateRecorder) {
                    startAttributeStateRecorder(attrStateRecorder.sessionId);
                }
                return `[crawler] Attribute state interval set to ${n}s${n === 0 ? " (realtime)" : ""}.`;
            }

            case "show": {
                if (!latestAttributeState) {
                    await loadAttributeStateFromStorage();
                }
                if (!latestAttributeState) {
                    return "[crawler] No attribute state recorded.";
                }
                return `[crawler]\n${JSON.stringify(latestAttributeState, null, 2)}`;
            }

            case "clear": {
                latestAttributeState = null;
                await navi.storage.item.del(ATTR_STATE_KEY);
                return "[crawler] Attribute state cleared.";
            }

            default:
                return `[crawler] Unknown: crawler attr_state ${action}. Type crawler for help.`;
        }
    }

    async function handleNaviCallLog(action, ...rest) {
        if (!action) {
            return [
                "[crawler] Navi call log",
                `Enabled: ${settings.navi_calls}`,
                `Entries: ${naviCallLog.size}`,
                `Storage key: ${STORAGE_KEY}`,
                "",
                "Usage:",
                "  crawler navi_call_log enable",
                "  crawler navi_call_log disable",
                "  crawler navi_call_log show [limit]",
                "  crawler navi_call_log clear",
            ].join("\n");
        }

        switch (action) {
            case "enable": {
                settings.navi_calls = true;
                return "[crawler] Navi call logging enabled. Run crawler start to record.";
            }

            case "disable": {
                settings.navi_calls = false;
                detachStdinHandler();
                if (crawlSession && !settings.attr_state_rec) {
                    crawlSession = null;
                    state.running = false;
                    stopAttributeStateRecorder();
                }
                return "[crawler] Navi call logging disabled.";
            }

            case "show": {
                const limit = rest[0] ? parseInt(rest[0], 10) : null;
                if (naviCallLog.size === 0) {
                    return "[crawler] No navi calls recorded.";
                }
                const lines = ["[crawler] Navi call log:"];
                let count = 0;
                for (const [key, entry] of naviCallLog) {
                    if (limit && count >= limit) break;
                    lines.push(
                        `  ${key}: ${entry.input} @ ${entry.at}${
                            entry.session ? ` (crawl ${entry.session})` : ""
                        }`
                    );
                    count++;
                }
                if (limit && naviCallLog.size > limit) {
                    lines.push(`  ... and ${naviCallLog.size - limit} more`);
                }
                return lines.join("\n");
            }

            case "clear": {
                naviCallLog.clear();
                nextLogKey = 1;
                await saveToStorage();
                return "[crawler] Navi call log cleared.";
            }

            default:
                return `[crawler]Unknown: crawler navi_call_log ${action}. Type crawler for help.`;
        }
    }

    return {
        name: "crawler",
        version: "1.0.0",
        description: "Basic navi crawler module",

        moduleInfo: {
            name: "crawler",
            version: "1.0.0",
            description: "Basic navi crawler module",
        },

        settings,
        naviCallLog,
        latestAttributeState,
        state,

        commands: {
            crawler: {
                name: "crawler",
                description:
                    "Crawler: crawler | crawler navi_call_log | crawler start | crawler stop",
                execute: async (sub, ...rest) => {
                    if (!sub) {
                        printHelp();
                        return;
                    }

                    if (sub === "navi_call_log") {
                        return handleNaviCallLog(...rest);
                    }

                    if (sub === "attr_state") {
                        return handleAttrState(...rest);
                    }

                    if (sub === "start") {
                        if (crawlSession) {
                            return `[crawler] Crawl already active: ${crawlSession.id} (${crawlSession.callCount} calls recorded)`;
                        }
                        if (!settings.navi_calls && !settings.attr_state_rec) {
                            return "[crawler] Enable navi_call_log and/or attr_state before crawler start.";
                        }

                        beginCrawlSession();
                        state.running = true;
                        const parts = [`[crawler] Crawl started: ${crawlSession.id}.`];
                        if (settings.navi_calls) {
                            parts.push("Recording navi(...) calls.");
                        }
                        if (settings.attr_state_rec) {
                            parts.push(
                                `Recording iframe attrs (${settings.attr_state_interval === 0 ? "realtime" : settings.attr_state_interval + "s"}).`
                            );
                        }
                        parts.push("Then crawler stop.");
                        return parts.join(" ");
                    }

                    if (sub === "stop") {
                        if (!crawlSession) {
                            return "[crawler] No active crawl. Run crawler start.";
                        }

                        const sessionId = crawlSession.id;
                        const count = crawlSession.callCount;
                        state.running = false;
                        await endCrawlSession();
                        const iframeCount =
                            latestAttributeState?.iframeCount ??
                            Object.keys(latestAttributeState?.iframes || {}).length;
                        const parts = [
                            `[crawler] Crawl stopped: ${sessionId}.`,
                            `${count} navi call(s) in log.`,
                        ];
                        if (settings.attr_state_rec) {
                            parts.push(`${iframeCount} iframe(s) in latest attr snapshot.`);
                        }
                        return parts.join(" ");
                    }

                    return `[crawler] Unknown: crawler ${sub}. Type crawler for help.`;
                },
            },
        },

        onMount: async () => {
            log("WeLcome to Crawler heheh");
            await loadFromStorage();
            await loadAttributeStateFromStorage();
        },

        onUnmount: () => {
            detachStdinHandler();
            stopAttributeStateRecorder();
            crawlSession = null;

            eventListeners.forEach(({ element, event, handler }) => {
                element.removeEventListener(event, handler);
            });
            eventListeners.length = 0;

            createdElements.forEach((el) => el.remove());
            createdElements.length = 0;

            addedStyles.forEach((style) => style.remove());
            addedStyles.length = 0;

            observers.forEach((observer) => observer.disconnect());
            observers.length = 0;

            timers.forEach(({ type, id }) => {
                if (type === "interval") clearInterval(id);
                if (type === "timeout") clearTimeout(id);
            });
            timers.length = 0;

            state.running = false;
            log("Module unmounted");
        },
    };
};
