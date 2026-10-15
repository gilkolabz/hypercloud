export const register = (navi) => {
    const isBrowser = typeof window !== "undefined" && typeof window.document !== "undefined";

    // IMPORTANT: Track all resources for cleanup
    const eventListeners = [];
    const createdElements = [];
    const addedStyles = [];
    const observers = [];
    const timers = [];

    const LOG_TYPES = ['container', 'log', 'error', 'warn', 'info', 'callout'];

    const DEFAULT_COLORS = {
        container: { text: 'black', bg: 'white' },
        log: { text: '#555555', bg: 'transparent' },
        error: { text: '#ff5555', bg: '#550000' },
        warn: { text: '#ffff55', bg: '#555500' },
        info: { text: '#55ffff', bg: '#005555' },
        callout: { text: 'black', bg: 'transparent' }
    };

    class OnScreenLogger {
        constructor() {
            this.logs = [];
            this.maxLogs = 50;
            this.isEnabled = true;
            this.isMinimized = false;
            this.logContainer = null;
            this.minimizeButton = null;
            this.restoreButton = null;
            this.originalConsoleLog = null;
            this.calloutHandler = null;
            this._lastConsoleLogMessage = null;
            this._lastConsoleLogTime = 0;
            this.storageKey = 'onscreen_log_settings';
            this.colors = structuredClone(DEFAULT_COLORS);
        }

        async initialize() {
            if (!isBrowser) {
                console.log('[onscreen_log] Browser environment required for viewport display');
                return;
            }

            await this.loadSettings();
            await this.saveSettings();
            this.createLogContainer();
            this.setupCalloutListener();
            this.overrideConsoleLog();
            this.setupStyles();
            
            navi.callout('[onscreen_log] On-screen logger initialized');
        }

        async loadSettings() {
            try {
                this.colors = structuredClone(DEFAULT_COLORS);
                const settings = await navi.storage.item.get(this.storageKey);
                if (settings) {
                    const parsed = JSON.parse(settings);
                    this.maxLogs = parsed.maxLogs || 50;
                    this.isEnabled = parsed.isEnabled !== false;

                    if (parsed.colors) {
                        for (const type of LOG_TYPES) {
                            if (parsed.colors[type]) {
                                this.colors[type] = {
                                    ...this.colors[type],
                                    ...parsed.colors[type]
                                };
                            }
                        }
                    }

                    // Legacy keys from older versions
                    if (parsed.textColor) {
                        this.colors.container.text = parsed.textColor;
                    }
                    if (parsed.bgColor) {
                        this.colors.container.bg = parsed.bgColor;
                    }
                }
            } catch (error) {
                console.error('[onscreen_log] Failed to load settings:', error);
            }
        }

        async saveSettings() {
            try {
                const settings = {
                    maxLogs: this.maxLogs,
                    isEnabled: this.isEnabled,
                    colors: this.colors,
                    textColor: this.colors.container.text,
                    bgColor: this.colors.container.bg
                };
                await navi.storage.item.set(this.storageKey, JSON.stringify(settings));
            } catch (error) {
                console.error('[onscreen_log] Failed to save settings:', error);
            }
        }

        createLogContainer() {
            // Remove existing container if it exists
            const existing = document.getElementById('onscreen-log-container');
            if (existing) {
                existing.remove();
            }

            this.logContainer = document.createElement('div');
            this.logContainer.id = 'onscreen-log-container';
            this.logContainer.style.cssText = `
                position: fixed;
                bottom: 0;
                left: 0;
                right: 0;
                max-height: 50vh;
                overflow-y: auto;
                background: ${this.colors.container.bg};
                color: ${this.colors.container.text};
                font-family: 'MS Sans Serif', 'Fixedsys', 'Terminal', monospace;
                font-size: 11px;
                line-height: 1.1;
                padding: 4px;
                padding-top: 20px;
                z-index: 10000;
                pointer-events: auto;
                border-top: 2px inset #c0c0c0;
                border-left: 2px inset #c0c0c0;
                border-right: 2px outset #808080;
                border-bottom: 2px outset #808080;
            `;

            // Create minimize button
            this.minimizeButton = document.createElement('div');
            this.minimizeButton.textContent = 'minimize';
            this.minimizeButton.style.cssText = `
                position: absolute;
                top: 2px;
                right: 4px;
                background: #c0c0c0;
                color: #000000;
                padding: 1px 4px;
                font-size: 9px;
                cursor: pointer;
                border: 1px outset #c0c0c0;
                font-family: 'MS Sans Serif', sans-serif;
                user-select: none;
            `;
            const minimizeHandler = () => this.minimize();
            this.minimizeButton.addEventListener('click', minimizeHandler);
            this.logContainer.appendChild(this.minimizeButton);
            
            // Track event listener for cleanup
            eventListeners.push({ element: this.minimizeButton, event: 'click', handler: minimizeHandler });

            // Create restore button (initially hidden)
            this.restoreButton = document.createElement('div');
            this.restoreButton.textContent = 'logs';
            this.restoreButton.style.cssText = `
                position: fixed;
                bottom: 10px;
                right: 10px;
                background: #c0c0c0;
                color: #000000;
                padding: 4px 8px;
                font-size: 10px;
                cursor: pointer;
                border: 2px outset #c0c0c0;
                font-family: 'MS Sans Serif', sans-serif;
                user-select: none;
                z-index: 10001;
                display: none;
            `;
            const restoreHandler = () => this.restore();
            this.restoreButton.addEventListener('click', restoreHandler);
            document.body.appendChild(this.restoreButton);
            
            // Track event listener for cleanup
            eventListeners.push({ element: this.restoreButton, event: 'click', handler: restoreHandler });

            document.body.appendChild(this.logContainer);
            
            // Track created elements for cleanup
            createdElements.push(this.logContainer, this.restoreButton);
        }

        setupStyles() {
            const style = document.createElement('style');
            style.setAttribute('data-onscreen-log', 'true');
            style.textContent = `
                .onscreen-log-entry {
                    margin: 0;
                    padding: 1px 2px;
                    word-wrap: break-word;
                    white-space: pre-wrap;
                    font-family: inherit;
                    border: none;
                    font-size: 11px;
                }
                
                .onscreen-log-entry.log {
                    color: ${this.colors.log.text};
                    background: ${this.colors.log.bg};
                }
                
                .onscreen-log-entry.error {
                    color: ${this.colors.error.text};
                    background: ${this.colors.error.bg};
                }
                
                .onscreen-log-entry.warn {
                    color: ${this.colors.warn.text};
                    background: ${this.colors.warn.bg};
                }
                
                .onscreen-log-entry.info {
                    color: ${this.colors.info.text};
                    background: ${this.colors.info.bg};
                }
                
                .onscreen-log-entry.callout {
                    color: ${this.colors.callout.text};
                    background: ${this.colors.callout.bg};
                }
                
                .onscreen-log-timestamp {
                    color: #aaaaaa;
                    font-size: 10px;
                    margin-right: 4px;
                    font-weight: bold;
                }
                
                .onscreen-log-message {
                    white-space: pre-wrap;
                    word-break: break-word;
                    font-family: 'Fixedsys', 'Terminal', 'Courier New', monospace;
                }
                
                #onscreen-log-container::-webkit-scrollbar {
                    width: 16px;
                    background: #c0c0c0;
                }
                
                #onscreen-log-container::-webkit-scrollbar-thumb {
                    background: #808080;
                    border: 1px outset #c0c0c0;
                }
                
                #onscreen-log-container::-webkit-scrollbar-track {
                    background: #c0c0c0;
                    border: 1px inset #c0c0c0;
                }
                
                .minimize-button:hover {
                    background: #e0e0e0;
                    border: 1px inset #c0c0c0;
                }
                
                .restore-button:hover {
                    background: #e0e0e0;
                    border: 2px inset #c0c0c0;
                }
            `;
            document.head.appendChild(style);
            
            // Track style element for cleanup
            addedStyles.push(style);
        }

        formatCalloutMessage(data) {
            if (data === undefined || data === null) {
                return String(data);
            }
            if (typeof data === 'string') {
                return data;
            }
            if (data instanceof Error) {
                return data.message || String(data);
            }
            try {
                return JSON.stringify(data, null, 2);
            } catch {
                return String(data);
            }
        }

        formatConsoleArgs(args) {
            return args.map(arg => {
                if (arg instanceof Error) {
                    return arg.message || String(arg);
                }
                if (typeof arg === 'object') {
                    try {
                        return JSON.stringify(arg, null, 2);
                    } catch {
                        return String(arg);
                    }
                }
                return String(arg);
            }).join(' ');
        }

        setupCalloutListener() {
            if (typeof navi.on !== 'function') {
                return;
            }

            this.calloutHandler = (data) => {
                if (!this.isEnabled) {
                    return;
                }

                const message = this.formatCalloutMessage(data);
                const now = Date.now();

                // Navi echoes callouts to console.log before other listeners run;
                // replace that secondary console entry with a callout-styled one.
                if (
                    this._lastConsoleLogMessage === message &&
                    now - this._lastConsoleLogTime < 50
                ) {
                    const duplicate = this.logContainer?.querySelector('.onscreen-log-entry');
                    if (duplicate) {
                        duplicate.remove();
                    }
                }

                this.addMessage('callout', message);
            };

            navi.on('callout', this.calloutHandler);
        }

        overrideConsoleLog() {
            if (!isBrowser) return;

            // Store original console methods
            this.originalConsoleLog = console.log.bind(console);
            this.originalConsoleError = console.error.bind(console);
            this.originalConsoleWarn = console.warn.bind(console);
            this.originalConsoleInfo = console.info.bind(console);
            
            // Secondary: capture direct console.log usage (callouts are handled via navi.on)
            console.log = (...args) => {
                this.originalConsoleLog(...args);
                
                if (this.isEnabled) {
                    const message = this.formatConsoleArgs(args);
                    this._lastConsoleLogMessage = message;
                    this._lastConsoleLogTime = Date.now();
                    this.addMessage('log', message);
                }
            };

            console.error = (...args) => {
                this.originalConsoleError(...args);
                if (this.isEnabled) {
                    this.addMessage('error', this.formatConsoleArgs(args));
                }
            };

            console.warn = (...args) => {
                this.originalConsoleWarn(...args);
                if (this.isEnabled) {
                    this.addMessage('warn', this.formatConsoleArgs(args));
                }
            };

            console.info = (...args) => {
                this.originalConsoleInfo(...args);
                if (this.isEnabled) {
                    this.addMessage('info', this.formatConsoleArgs(args));
                }
            };
        }

        addLog(type, args) {
            this.addMessage(type, this.formatConsoleArgs(args));
        }

        addMessage(type, message) {
            if (!this.logContainer) return;

            const timestamp = new Date().toLocaleTimeString();

            const logEntry = document.createElement('div');
            logEntry.className = `onscreen-log-entry ${type}`;
            
            // Create timestamp element
            const timestampSpan = document.createElement('span');
            timestampSpan.className = 'onscreen-log-timestamp';
            timestampSpan.textContent = `[${timestamp}]`;
            
            // Create message element that preserves whitespace and newlines
            const messageSpan = document.createElement('span');
            messageSpan.className = 'onscreen-log-message';
            messageSpan.textContent = message; // Use textContent to preserve newlines
            
            logEntry.appendChild(timestampSpan);
            logEntry.appendChild(messageSpan);

            // Add to top of container (bottom-up display)
            this.logContainer.insertBefore(logEntry, this.logContainer.firstChild);

            // Limit number of logs
            const entries = this.logContainer.querySelectorAll('.onscreen-log-entry');
            
            if (entries.length > this.maxLogs) {
                // Convert NodeList to Array and remove excess entries
                const excessCount = entries.length - this.maxLogs;
                const entriesToRemove = Array.from(entries).slice(-excessCount);
                
                entriesToRemove.forEach(entry => entry.remove());
            }

            // Auto-scroll to show new log
            this.logContainer.scrollTop = 0;
        }

        escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        clear() {
            if (this.logContainer) {
                this.logContainer.innerHTML = '';
            }
            this.logs = [];
        }

        toggle() {
            this.isEnabled = !this.isEnabled;
            this.saveSettings();
            return `On-screen logging ${this.isEnabled ? 'enabled' : 'disabled'}`;
        }

        setMaxLogs(count) {
            const num = parseInt(count);
            if (isNaN(num) || num < 1) {
                return 'Invalid number. Must be a positive integer.';
            }
            this.maxLogs = num;
            this.saveSettings();
            
            // Remove excess logs if needed
            if (this.logContainer) {
                const entries = this.logContainer.querySelectorAll('.onscreen-log-entry');
                
                if (entries.length > this.maxLogs) {
                    // Convert NodeList to Array and remove excess entries
                    const excessCount = entries.length - this.maxLogs;
                    const entriesToRemove = Array.from(entries).slice(-excessCount);
                    
                    entriesToRemove.forEach(entry => entry.remove());
                }
            }
            
            return `[onscreen_log] maximum logs set to ${this.maxLogs}`;
        }

        setTextColor(color, type = 'container') {
            return this.setTypeColor(type, 'text', color);
        }

        setBgColor(color, type = 'container') {
            return this.setTypeColor(type, 'bg', color);
        }

        setTypeColor(type, field, color) {
            if (!LOG_TYPES.includes(type)) {
                return `Unknown type: ${type}. Valid types: ${LOG_TYPES.join(', ')}`;
            }
            if (!color || typeof color !== 'string') {
                return 'Invalid color. Please provide a valid CSS color (e.g., "red", "#ff0000", "rgb(255,0,0)")';
            }
            this.colors[type][field] = color;
            this.saveSettings();
            this.applyColors();
            const label = field === 'text' ? 'Text' : 'Background';
            return `${type} ${label.toLowerCase()} color set to ${color}`;
        }

        applyColors() {
            if (!this.logContainer) {
                return;
            }

            this.logContainer.style.background = this.colors.container.bg;
            this.logContainer.style.color = this.colors.container.text;

            const existingStyle = document.querySelector('style[data-onscreen-log]');
            if (existingStyle) {
                const idx = addedStyles.indexOf(existingStyle);
                if (idx !== -1) {
                    addedStyles.splice(idx, 1);
                }
                existingStyle.remove();
            }
            this.setupStyles();
        }

        minimize() {
            if (this.logContainer && !this.isMinimized) {
                this.logContainer.style.display = 'none';
                this.restoreButton.style.display = 'block';
                this.isMinimized = true;
            }
        }

        restore() {
            if (this.logContainer && this.isMinimized) {
                this.logContainer.style.display = 'block';
                this.restoreButton.style.display = 'none';
                this.isMinimized = false;
            }
        }

        getStatus() {
            return {
                enabled: this.isEnabled,
                minimized: this.isMinimized,
                maxLogs: this.maxLogs,
                currentLogs: this.logContainer ? this.logContainer.querySelectorAll('.onscreen-log-entry').length : 0,
                environment: isBrowser ? 'browser' : 'node',
                colors: this.colors
            };
        }
    }

    const logger = new OnScreenLogger();

    return {
        name: "onscreen_log_a",
        version: "2.2.0",
        description: "Displays navi callouts on viewport; console output is captured secondarily",
        
        moduleInfo: {
            name: "onscreen_log_b",
            version: "2.2.0",
            description: "Displays navi callouts on viewport; console output is captured secondarily"
        },
        
        commands: {
            log: {
                name: "log",
                description: "On-screen log management: log <clear|toggle|max|status> [args...]",
                execute: async (action, ...args) => {
                    if (!action) {
                        return [
                            "On-Screen Logger v2.2.0",
                            "",
                            "Usage:",
                            "  log clear                        Clear all displayed logs",
                            "  log toggle                       Toggle logging on/off",
                            "  log max <number>                 Set maximum number of logs to display",
                            "  log textcolor [type] <color>     Set text color for a log type",
                            "  log bgcolor [type] <color>       Set background color for a log type",
                            "  log minimize                     Minimize the log window",
                            "  log restore                      Restore the log window",
                            "  log status                       Show current status",
                            "",
                            "Types: container, log, error, warn, info, callout",
                            "  container = panel chrome; omit type to target container",
                            "",
                            "Examples:",
                            "  log max 100",
                            "  log toggle",
                            "  log textcolor red",
                            "  log bgcolor #333333",
                            "  log textcolor error #ff5555",
                            "  log bgcolor callout #003300",
                            "  log minimize"
                        ].join('\n');
                    }

                    try {
                        switch (action) {
                            case 'clear':
                                logger.clear();
                                return "Logs cleared";

                            case 'toggle':
                                return logger.toggle();

                            case 'max':
                                if (args.length === 0) {
                                    return "Usage: log max <number>";
                                }
                                return logger.setMaxLogs(args[0]);

                            case 'textcolor':
                                if (args.length === 0) {
                                    return "Usage: log textcolor [type] <color>";
                                }
                                if (args.length === 1) {
                                    return logger.setTextColor(args[0], 'container');
                                }
                                return logger.setTextColor(args[1], args[0]);

                            case 'bgcolor':
                                if (args.length === 0) {
                                    return "Usage: log bgcolor [type] <color>";
                                }
                                if (args.length === 1) {
                                    return logger.setBgColor(args[0], 'container');
                                }
                                return logger.setBgColor(args[1], args[0]);

                            case 'minimize':
                                logger.minimize();
                                return "Log window minimized";

                            case 'restore':
                                logger.restore();
                                return "Log window restored";

                            case 'status':
                                const status = logger.getStatus();
                                const colorLines = LOG_TYPES.map((type) => {
                                    const c = status.colors[type];
                                    return `  ${type}: text=${c.text}, bg=${c.bg}`;
                                });
                                return [
                                    "On-Screen Logger Status:",
                                    `  Enabled: ${status.enabled}`,
                                    `  Minimized: ${status.minimized}`,
                                    `  Max Logs: ${status.maxLogs}`,
                                    `  Current Logs: ${status.currentLogs}`,
                                    `  Environment: ${status.environment}`,
                                    "  Colors:",
                                    ...colorLines
                                ].join('\n');

                            default:
                                return `Unknown action: ${action}. Type 'log' for help.`;
                        }
                    } catch (error) {
                        console.error('[onscreen_log] Command failed:', error);
                        return `Error: ${error.message || 'Unknown error'}`;
                    }
                }
            }
        },
        
        // Expose the logger for external access
        logger,
        
        onMount: async () => {
            await logger.initialize();
            navi.callout('[onscreen_log] On-screen log module loaded');
        },
        
        onUnmount: () => {
            // ⚠️ CRITICAL: Clean up ALL resources

            if (logger.calloutHandler && typeof navi.off === 'function') {
                navi.off('callout', logger.calloutHandler);
                logger.calloutHandler = null;
            }
            
            // Restore original console methods if they were overridden
            if (logger.originalConsoleLog) {
                console.log = logger.originalConsoleLog;
            }
            if (logger.originalConsoleError) {
                console.error = logger.originalConsoleError;
            }
            if (logger.originalConsoleWarn) {
                console.warn = logger.originalConsoleWarn;
            }
            if (logger.originalConsoleInfo) {
                console.info = logger.originalConsoleInfo;
            }
            
            // Remove all event listeners
            eventListeners.forEach(({ element, event, handler }) => {
                element.removeEventListener(event, handler);
            });
            eventListeners.length = 0;
            
            // Remove all DOM elements
            createdElements.forEach(el => el.remove());
            createdElements.length = 0;
            
            // Remove all styles
            addedStyles.forEach(style => style.remove());
            addedStyles.length = 0;
            
            // Disconnect all observers
            observers.forEach(observer => observer.disconnect());
            observers.length = 0;
            
            // Clear all timers
            timers.forEach(({ type, id }) => {
                if (type === 'interval') clearInterval(id);
                if (type === 'timeout') clearTimeout(id);
            });
            timers.length = 0;
            
            // Fallback cleanup for any remaining elements
            if (logger.logContainer) {
                logger.logContainer.remove();
            }
            if (logger.restoreButton) {
                logger.restoreButton.remove();
            }
            
            // Fallback cleanup for any remaining styles
            const existingStyle = document.querySelector('style[data-onscreen-log]');
            if (existingStyle) {
                existingStyle.remove();
            }
            
            if (typeof navi.callout === 'function') {
                navi.callout('[onscreen_log] Module unmounted');
            }
        }
    };
};
