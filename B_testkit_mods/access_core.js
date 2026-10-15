// Module metadata (required)

export const moduleInfo = {
    name: "access_core",
    version: "1.0.0",
    description: "Access core system information and WebSocket connection details"
};

// Environment detection
const isBrowser = typeof window !== "undefined" && typeof window.document !== "undefined";

// Core access module functionality
class CoreAccess {
    constructor() {
        this.moduleName = moduleInfo.name;
    }

    // Get comprehensive core information
    getCoreInfo() {
        if (!globalThis.navi || !globalThis.navi.core) {
            return {
                error: "Navi core not available",
                available: false
            };
        }

        const core = globalThis.navi.core;
        const now = new Date();
        
        return {
            available: true,
            mode: core.mode || "unknown",
            connected: core.connected || false,
            wsState: core.wsState || "unknown",
            lastPongTime: core.lastPongTime ? new Date(core.lastPongTime).toISOString() : "never",
            timeSinceLastPong: core.lastPongTime ? 
                Math.round((now.getTime() - core.lastPongTime) / 1000) + " seconds ago" : "never",
            // Additional WebSocket info if available
            wsUrl: (globalThis.navi.ws && globalThis.navi.ws.url) || "not available",
            wsReadyState: (globalThis.navi.ws && globalThis.navi.ws.readyState) || "not available",
            wsReadyStateText: this.getWebSocketStateText(globalThis.navi.ws && globalThis.navi.ws.readyState),
            token: globalThis.navi.token ? "***" + globalThis.navi.token.slice(-4) : "not available",
            connectedStatus: globalThis.navi.connected || false
        };
    }

    // Convert WebSocket readyState to human readable text
    getWebSocketStateText(readyState) {
        if (readyState === undefined) return "not available";
        const states = {
            0: "CONNECTING",
            1: "OPEN", 
            2: "CLOSING",
            3: "CLOSED"
        };
        return states[readyState] || "UNKNOWN";
    }

    // Format core stats for display
    formatCoreStats(info) {
        if (!info.available) {
            return "ERROR: Core system not available";
        }

        const statusIcon = info.connected ? "[OK]" : "[FAIL]";
        const connectionStatus = info.connected ? "CONNECTED" : "DISCONNECTED";
        
        return [
            `Navi Core Access v${moduleInfo.version}`,
            "",
            "CONNECTION STATUS",
            `  ${statusIcon} Status: ${connectionStatus}`,
            `  Mode: ${info.mode}`,
            `  WebSocket State: ${info.wsReadyStateText} (${info.wsState})`,
            "",
            "TIMING INFORMATION", 
            `  Last Pong: ${info.lastPongTime}`,
            `  Time Since: ${info.timeSinceLastPong}`,
            "",
            "CONNECTION DETAILS",
            `  WebSocket URL: ${info.wsUrl}`,
            `  Token: ${info.token}`,
            `  Connected Flag: ${info.connectedStatus}`,
            "",
            "TIP: Use 'access_core help' for more commands"
        ].join('\n');
    }

    // Get detailed WebSocket information
    getWebSocketDetails() {
        if (!globalThis.navi || !globalThis.navi.ws) {
            return "ERROR: WebSocket connection not available";
        }

        const ws = globalThis.navi.ws;
        const now = new Date();
        
        return [
            "WEB SOCKET DETAILS",
            "",
            `  URL: ${ws.url || "not available"}`,
            `  Ready State: ${this.getWebSocketStateText(ws.readyState)} (${ws.readyState})`,
            `  Protocol: ${ws.protocol || "not specified"}`,
            `  Extensions: ${ws.extensions || "none"}`,
            `  Binary Type: ${ws.binaryType || "not set"}`,
            `  Buffered Amount: ${ws.bufferedAmount || 0} bytes`,
            "",
            "CONNECTION METRICS",
            `  Current Time: ${now.toISOString()}`,
            `  Last Pong: ${globalThis.navi.lastPongTime ? new Date(globalThis.navi.lastPongTime).toISOString() : "never"}`,
            `  Auto Reconnect: ${globalThis.navi.autoReconnect || "not configured"}`
        ].join('\n');
    }

    // Get system information
    getSystemInfo() {
        const info = this.getCoreInfo();
        if (!info.available) {
            return "ERROR: System information not available";
        }

        return [
            "SYSTEM INFORMATION",
            "",
            `  Environment: ${isBrowser ? "Browser" : "Node.js"}`,
            `  Navi Mode: ${info.mode}`,
            `  Module: ${this.moduleName} v${moduleInfo.version}`,
            `  Current Time: ${new Date().toISOString()}`,
            "",
            "CONNECTION STATUS",
            `  Connected: ${info.connected ? "Yes" : "No"}`,
            `  WebSocket: ${info.wsReadyStateText}`,
            `  Authenticated: ${info.token !== "not available" ? "Yes" : "No"}`
        ].join('\n');
    }
}

// Initialize core access instance
const coreAccess = new CoreAccess();

// Commands object for both stdin interface AND programmatic access
export const commands = {
    access_core: {
        name: "access_core",
        description: "Access core system information and WebSocket details: access_core [stats|ws|system|help]",
        execute: async (subcommand) => {
            if (!subcommand) {
                return [
                    "Navi Core Access v" + moduleInfo.version,
                    "",
                    "AVAILABLE COMMANDS:",
                    "  access_core stats     - Show core connection statistics",
                    "  access_core ws        - Show detailed WebSocket information", 
                    "  access_core system    - Show system information",
                    "  access_core help      - Show this help message",
                    "",
                    "TIP: Use 'access_core stats' to see connection status"
                ].join('\n');
            }

            try {
                switch (subcommand.toLowerCase()) {
                    case 'stats':
                        const coreInfo = coreAccess.getCoreInfo();
                        return coreAccess.formatCoreStats(coreInfo);
                        
                    case 'ws':
                    case 'websocket':
                        return coreAccess.getWebSocketDetails();
                        
                    case 'system':
                    case 'sys':
                        return coreAccess.getSystemInfo();
                        
                    case 'help':
                    case 'h':
                        return [
                            "Navi Core Access Help",
                            "",
                            "COMMANDS:",
                            "  stats     - Core connection statistics and status",
                            "  ws        - Detailed WebSocket connection info",
                            "  system    - System environment information", 
                            "  help      - Show this help",
                            "",
                            "EXAMPLES:",
                            "  access_core stats",
                            "  access_core ws",
                            "  access_core system"
                        ].join('\n');
                        
                    default:
                        return `ERROR: Unknown subcommand: ${subcommand}\nUse 'access_core help' for available commands`;
                }
            } catch (error) {
                console.error('[access_core] Command failed:', error);
                return `ERROR: ${error.message || 'Unknown error occurred'}`;
            }
        }
    }
};

// Stdin listener setup (for interactive commands)
function setupStdinListener() {
    if (typeof globalThis !== "undefined" && globalThis.navi && typeof globalThis.navi.on === "function") {
        globalThis.navi.on('stdin', async (input) => {
            const trimmed = input.trim();
            const [cmd, ...args] = trimmed.split(' ').filter(arg => arg.length > 0);
            
            const command = commands[cmd];
            if (command) {
                try {
                    const result = await command.execute(...args);
                    console.log(result);
                } catch (error) {
                    console.error("Error:", error.message || error);
                }
            }
        });
        
        console.log('[access_core] Stdin listener ready!');
    }
}

// Auto-setup when module loads
setupStdinListener();

// Default export (required)
export default {
    name: "access_core",
    moduleInfo,
    commands,
    coreAccess
};
