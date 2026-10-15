// Service Worker Manager Module for Navi Shell
// Provides user interface to manage service worker cache settings and global configuration

export const register = (navi) => {
    // Environment detection
    const isBrowser = typeof window !== "undefined" && typeof window.document !== "undefined";
    
    // ⚠️ IMPORTANT: Track all resources for cleanup
    const eventListeners = [];
    const createdElements = [];
    const addedStyles = [];
    const observers = [];
    const timers = [];

    class CacheManagerModule {
        constructor(timers) {
            this.storageKey = 'service';
            this.syncInterval = null;
            this.timers = timers; // Reference to timers array for cleanup tracking
        }

        // Get default service worker data structure
        getDefaultData() {
            return {
                global: {
                    enabled: true,
                    defaultMaxUses: 3,
                    defaultExpiryMinutes: null,
                    syncIntervalMs: 300000,
                    lastModified: Date.now()
                },
                urls: {}
            };
        }

        // Get current service worker data from navi storage
        async getServiceWorkerData() {
            try {
                // Get the entire service worker data object
                const fullData = await navi.storage.item.get(this.storageKey);
                
                if (fullData) {
                    try {
                        const parsed = JSON.parse(fullData);
                        // Merge with defaults to ensure all required fields exist
                        const defaultData = this.getDefaultData();
                        return {
                            global: { ...defaultData.global, ...parsed.global },
                            urls: parsed.urls || {}
                        };
                    } catch (parseError) {
                        console.warn('[cache_manager] Failed to parse service worker data, using defaults');
                        return this.getDefaultData();
                    }
                }
                
                // No data exists, return defaults
                return this.getDefaultData();
            } catch (error) {
                console.error('[cache_manager] Failed to get service worker data:', error);
                return this.getDefaultData();
            }
        }

        // Save service worker data to navi storage
        async saveServiceWorkerData(data) {
            try {
                // Save the entire data object as JSON
                await navi.storage.item.set(this.storageKey, JSON.stringify(data));
                
                // Note: Service worker manages its own cache settings internally
                // We only sync FROM service worker TO navi storage, not the other way around
                
                return true;
            } catch (error) {
                console.error('[cache_manager] Failed to save service worker data:', error);
                return false;
            }
        }

        // Send command to service worker
        async sendCommandToServiceWorker(command) {
            if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
                return new Promise((resolve, reject) => {
                    const messageChannel = new MessageChannel();
                    
                    messageChannel.port1.onmessage = (event) => {
                        if (event.data.type === 'COMMAND_RESPONSE') {
                            resolve(event.data.data);
                        }
                    };
                    
                    navigator.serviceWorker.controller.postMessage({
                        ...command,
                        expectResponse: true
                    }, [messageChannel.port2]);
                    
                    // Timeout after 5 seconds
                    setTimeout(() => {
                        reject(new Error('Service worker command timeout'));
                    }, 5000);
                });
            } else {
                throw new Error('Service worker not available');
            }
        }

        // Sync service worker cache data to navi storage
        async syncServiceWorkerDataToNavi() {
            try {
                console.log('[cache_manager] syncing service worker data to navi storage...');
                
                // Get current service worker cache status
                const swCacheData = await this.sendCommandToServiceWorker({ type: 'GET_CACHE_STATUS' });
                
                // Get current navi storage data
                const naviData = await this.getServiceWorkerData();
                
                // Check for new URLs in service worker that aren't in navi storage
                let hasChanges = false;
                for (const [url, swEntry] of Object.entries(swCacheData)) {
                    if (!naviData.urls[url]) {
                        naviData.urls[url] = {
                            ...swEntry,
                            // Preserve navi-specific metadata
                            lastModified: Date.now()
                        };
                        hasChanges = true;
                    } else {
                        // Update existing entry with service worker data (but preserve navi settings)
                        const existingEntry = naviData.urls[url];
                        const preservedSettings = {
                            enabled: existingEntry.enabled,
                            maxUses: existingEntry.maxUses,
                            expiresAt: existingEntry.expiresAt
                        };
                        Object.assign(naviData.urls[url], swEntry, preservedSettings);
                        naviData.urls[url].lastModified = Date.now();
                        hasChanges = true; // Always update to sync latest usage stats
                    }
                }
                
                if (hasChanges) {
                    await this.saveServiceWorkerData(naviData);
                    console.log('[cache_manager] sync completed');
                } else {
                    console.log('[cache_manager] all good');
                }
                
            } catch (error) {
                console.log('[cache_manager] failed to sync service worker data:', error);
            }
        }

        // Update global settings
        async updateGlobalSettings(updates) {
            const data = await this.getServiceWorkerData();
            Object.assign(data.global, updates);
            data.global.lastModified = Date.now();
            await this.saveServiceWorkerData(data);
            
            // Send individual commands to service worker
            for (const [key, value] of Object.entries(updates)) {
                try {
                    await this.sendCommandToServiceWorker({
                        type: 'SET_GLOBAL_SETTING',
                        key: key,
                        value: value
                    });
                    console.log(`[cache_manager] sent global setting ${key} = ${value} to service worker`);
                } catch (error) {
                    console.log(`[cache_manager] failed to send global setting to service worker:`, error);
                }
            }
            
            return true;
        }

        // Update a specific cache entry
        async updateCacheEntry(url, updates) {
            const data = await this.getServiceWorkerData();
            if (data.urls[url]) {
                Object.assign(data.urls[url], updates);
                data.urls[url].lastModified = Date.now();
                await this.saveServiceWorkerData(data);
                
                // Send individual commands to service worker
                for (const [key, value] of Object.entries(updates)) {
                    try {
                        await this.sendCommandToServiceWorker({
                            type: 'SET_URL_SETTING',
                            url: url,
                            key: key,
                            value: value
                        });
                        console.log(`[cache_manager] sent URL setting ${url}.${key} = ${value} to service worker`);
                    } catch (error) {
                        console.log(`[cache_manager] failed to send URL setting to service worker:`, error);
                    }
                }
                
                return true;
            }
            return false;
        }

        // List all cached URLs with their settings - returns structured data
        async listCaches(format = 'object') {
            // First sync service worker data to navi storage
            await this.syncServiceWorkerDataToNavi();
            
            const data = await this.getServiceWorkerData();
            const entries = Object.entries(data.urls);
            
            if (entries.length === 0) {
                if (format === 'object') {
                    return {
                        global: {
                            enabled: data.global.enabled,
                            defaultMaxUses: data.global.defaultMaxUses,
                            defaultExpiryMinutes: data.global.defaultExpiryMinutes,
                            lastModified: data.global.lastModified
                        },
                        urls: {},
                        summary: {
                            totalUrls: 0,
                            enabledUrls: 0,
                            disabledUrls: 0
                        }
                    };
                }
                return "No cached URLs found.";
            }

            // Process entries into structured format
            const processedUrls = {};
            let enabledCount = 0;
            let disabledCount = 0;

            entries.forEach(([url, entry]) => {
                const isEnabled = entry.enabled;
                if (isEnabled) enabledCount++;
                else disabledCount++;

                processedUrls[url] = {
                    id: entry.id,
                    enabled: isEnabled,
                    useCount: entry.useCount,
                    maxUses: entry.maxUses,
                    usesRemaining: entry.maxUses > 0 ? entry.maxUses - entry.useCount : '∞',
                    createdAt: entry.createdAt,
                    lastUsed: entry.lastUsed,
                    lastModified: entry.lastModified,
                    expiresAt: entry.expiresAt,
                    isExpired: entry.expiresAt ? Date.now() > entry.expiresAt : false,
                    // Human-readable timestamps
                    createdAtFormatted: new Date(entry.createdAt).toLocaleString(),
                    lastUsedFormatted: new Date(entry.lastUsed).toLocaleString(),
                    expiresAtFormatted: entry.expiresAt ? new Date(entry.expiresAt).toLocaleString() : null
                };
            });

            const result = {
                global: {
                    enabled: data.global.enabled,
                    defaultMaxUses: data.global.defaultMaxUses,
                    defaultExpiryMinutes: data.global.defaultExpiryMinutes,
                    lastModified: data.global.lastModified
                },
                urls: processedUrls,
                summary: {
                    totalUrls: entries.length,
                    enabledUrls: enabledCount,
                    disabledUrls: disabledCount,
                    expiredUrls: Object.values(processedUrls).filter(url => url.isExpired).length
                }
            };

            if (format === 'object') {
                return result;
            }

            // Format as string for console output
            let output = "Service Worker Cache Status:\n";
            output += "=".repeat(80) + "\n";
            output += `Global caching: ${data.global.enabled ? "✓ Enabled" : "✗ Disabled"}\n`;
            output += `Default max uses: ${data.global.defaultMaxUses}\n`;
            output += `Default expiry: ${data.global.defaultExpiryMinutes ? data.global.defaultExpiryMinutes + " minutes" : "None"}\n`;
            output += "=".repeat(80) + "\n\n";
            output += `Summary: ${result.summary.totalUrls} URLs (${result.summary.enabledUrls} enabled, ${result.summary.disabledUrls} disabled, ${result.summary.expiredUrls} expired)\n\n`;
            output += "Cached URLs:\n";
            
            entries.forEach(([url, entry]) => {
                const status = entry.enabled ? "✓" : "✗";
                const usesLeft = entry.maxUses > 0 ? `${entry.useCount}/${entry.maxUses}` : `${entry.useCount}/∞`;
                const lastUsed = new Date(entry.lastUsed).toLocaleString();
                const expired = entry.expiresAt && Date.now() > entry.expiresAt ? " (EXPIRED)" : "";
                
                output += `${status} ${url}${expired}\n`;
                output += `    Uses: ${usesLeft} | Last used: ${lastUsed}\n`;
                output += `    ID: ${entry.id} | Created: ${new Date(entry.createdAt).toLocaleString()}\n`;
                if (entry.expiresAt) {
                    output += `    Expires: ${new Date(entry.expiresAt).toLocaleString()}\n`;
                }
                output += "\n";
            });
            
            return output.trim();
        }

        // Enable/disable caching for a URL
        async toggleCache(url, enabled) {
            const success = await this.updateCacheEntry(url, { enabled });
            if (success) {
                return `Cache ${enabled ? 'enabled' : 'disabled'} for "${url}"`;
            }
            return `URL "${url}" not found in cache data`;
        }

        // Set max uses for a URL
        async setMaxUses(url, maxUses) {
            const success = await this.updateCacheEntry(url, { maxUses: parseInt(maxUses) });
            if (success) {
                return `Max uses set to ${maxUses} for "${url}"`;
            }
            return `URL "${url}" not found in cache data`;
        }

        // Set expiry time for a URL (in minutes)
        async setExpiry(url, minutes) {
            const expiresAt = minutes > 0 ? Date.now() + (minutes * 60 * 1000) : null;
            const success = await this.updateCacheEntry(url, { expiresAt });
            if (success) {
                return `Expiry set to ${minutes} minutes for "${url}"`;
            }
            return `URL "${url}" not found in cache data`;
        }

        // Reset usage count for a URL
        async resetUsage(url) {
            // Send command directly to service worker
            try {
                await this.sendCommandToServiceWorker({
                    type: 'RESET_URL_USAGE',
                    url: url
                });
                console.log(`[cache_manager] sent reset usage command for ${url} to service worker`);
                
                // Also update local storage
                const success = await this.updateCacheEntry(url, { useCount: 0 });
                if (success) {
                    return `Usage count reset for "${url}"`;
                }
                return `URL "${url}" not found in cache data`;
            } catch (error) {
                console.log(`[cache_manager] failed to reset usage for ${url}:`, error);
                return `Failed to reset usage for "${url}": ${error.message}`;
            }
        }

        // Clear all cache data
        async clearAllCacheData() {
            // Send command to service worker
            try {
                await this.sendCommandToServiceWorker({
                    type: 'CLEAR_ALL_CACHE_DATA'
                });
                console.log(`[cache_manager] sent clear all cache data command to service worker`);
            } catch (error) {
                console.log(`[cache_manager] failed to clear cache data in service worker:`, error);
            }
            
            // Also clear local storage
            const data = await this.getServiceWorkerData();
            data.urls = {};
            await this.saveServiceWorkerData(data);
            return "All cache data cleared";
        }

        // Global settings management
        async toggleGlobalCaching(enabled) {
            await this.updateGlobalSettings({ enabled });
            return `Global caching ${enabled ? 'enabled' : 'disabled'}`;
        }

        async setDefaultMaxUses(maxUses) {
            await this.updateGlobalSettings({ defaultMaxUses: parseInt(maxUses) });
            return `Default max uses set to ${maxUses}`;
        }

        async setDefaultExpiry(minutes) {
            await this.updateGlobalSettings({ defaultExpiryMinutes: minutes > 0 ? parseInt(minutes) : null });
            return `Default expiry set to ${minutes > 0 ? minutes + ' minutes' : 'none'}`;
        }

        async setSyncInterval(seconds) {
            // Stop current sync
            await this.stopSync();
            
            // Update global settings
            await this.updateGlobalSettings({ syncIntervalMs: parseInt(seconds) * 1000 });
            
            // Restart sync with new interval
            await this.startSync();
            
            return `Sync interval set to ${seconds} seconds`;
        }

        // Show global settings
        async showGlobalSettings() {
            const data = await this.getServiceWorkerData();
            return [
                "Service Worker Global Settings:",
                "=".repeat(40),
                `Caching enabled: ${data.global.enabled ? "Yes" : "No"}`,
                `Default max uses: ${data.global.defaultMaxUses}`,
                `Default expiry: ${data.global.defaultExpiryMinutes ? data.global.defaultExpiryMinutes + " minutes" : "None"}`,
                `Sync interval: ${data.global.syncIntervalMs / 1000} seconds`,
                `Last modified: ${new Date(data.global.lastModified).toLocaleString()}`
            ].join('\n');
        }

        // Get cache statistics
        async getCacheStats() {
            const cacheData = await this.listCaches('object');
            return {
                global: cacheData.global,
                summary: cacheData.summary,
                urls: Object.keys(cacheData.urls).length > 0 ? Object.keys(cacheData.urls) : []
            };
        }

        // Find URLs by pattern
        async findUrls(pattern) {
            const cacheData = await this.listCaches('object');
            const matchingUrls = Object.keys(cacheData.urls).filter(url => 
                url.toLowerCase().includes(pattern.toLowerCase())
            );
            
            if (matchingUrls.length === 0) {
                return {
                    pattern,
                    matches: [],
                    count: 0
                };
            }

            const matches = matchingUrls.map(url => ({
                url,
                ...cacheData.urls[url]
            }));

            return {
                pattern,
                matches,
                count: matches.length
            };
        }

        // Start periodic sync
        async startSync() {
            if (this.syncInterval) {
                console.log('[cache_manager] Sync already running');
                return;
            }
            
            // Get sync interval from storage, default to 5 minutes
            const data = await this.getServiceWorkerData();
            const syncIntervalMs = data.global.syncIntervalMs || 300000;
            
            console.log(`[cache_manager] starting periodic cache sync every ${syncIntervalMs}ms`);
            this.syncInterval = setInterval(() => {
                this.syncServiceWorkerDataToNavi();
            }, syncIntervalMs);
            
            // Track timer for cleanup
            this.timers.push({ type: 'interval', id: this.syncInterval });
        }

        // Stop periodic sync
        async stopSync() {
            if (this.syncInterval) {
                clearInterval(this.syncInterval);
                
                // Remove from timers tracking
                const index = this.timers.findIndex(t => t.id === this.syncInterval);
                if (index !== -1) {
                    this.timers.splice(index, 1);
                }
                
                this.syncInterval = null;
                console.log('[cache_manager] Stopped periodic sync');
            }
        }
    }

    const cacheManager = new CacheManagerModule(timers);

    return {
        name: "cache_manager",
        version: "1.0.1", //reveals cacheManager object in this version :)
        description: "Manage service worker cache settings, global configuration, and view cache statistics",
        cacheManager,
        // Module metadata (for compatibility and discoverability)
        moduleInfo: {
            name: "cache_manager",
            version: "1.0.1",
            description: "Manage service worker cache settings, global configuration, and view cache statistics"
        },
        
        // Commands object - automatically gets stdin listeners
        commands: {
            cache: {
                name: "cache",
                description: "Manage service worker cache: cache <global|list|stats|find|enable|disable|maxuses|expiry|reset|clear> [args...]",
                execute: async (action, ...args) => {
                    if (!action) {
                        return [
                            "Cache Manager v1.0.0",
                            "",
                            "Usage:",
                            "  cache global <show|enable|disable|maxuses|expiry|sync> [args...]",
                            "  cache list                    List all cached URLs (formatted)",
                            "  cache stats                   Get cache statistics (structured data)",
                            "  cache find <pattern>          Find URLs matching pattern",
                            "  cache enable <url>            Enable caching for a URL",
                            "  cache disable <url>           Disable caching for a URL", 
                            "  cache maxuses <url> <count>   Set max uses for a URL",
                            "  cache expiry <url> <minutes> Set expiry for a URL",
                            "  cache reset <url>            Reset usage count for a URL",
                            "  cache clear                   Clear all cache data",
                            "  cache sync                    Sync service worker data to navi storage",
                            "",
                            "Global Commands:",
                            "  cache global show                    Show global settings",
                            "  cache global enable                  Enable global caching",
                            "  cache global disable                 Disable global caching",
                            "  cache global maxuses <count>          Set default max uses",
                            "  cache global expiry <minutes>       Set default expiry (0 = none)",
                            "  cache global sync <seconds>         Set sync interval",
                            "",
                            "Examples:",
                            "  cache global show",
                            "  cache global disable",
                            "  cache list",
                            "  cache stats",
                            "  cache find /api",
                            "  cache disable /api/data"
                        ].join('\n');
                    }

                    try {
                        if (action === 'global') {
                            const [globalAction, ...globalArgs] = args;
                            if (!globalAction) {
                                return await cacheManager.showGlobalSettings();
                            }

                            switch (globalAction) {
                                case 'show':
                                    return await cacheManager.showGlobalSettings();
                                case 'enable':
                                    return await cacheManager.toggleGlobalCaching(true);
                                case 'disable':
                                    return await cacheManager.toggleGlobalCaching(false);
                                case 'maxuses':
                                    if (globalArgs.length === 0) {
                                        return "Usage: cache global maxuses <count>";
                                    }
                                    return await cacheManager.setDefaultMaxUses(globalArgs[0]);
                                case 'expiry':
                                    if (globalArgs.length === 0) {
                                        return "Usage: cache global expiry <minutes>";
                                    }
                                    return await cacheManager.setDefaultExpiry(globalArgs[0]);
                                case 'sync':
                                    if (globalArgs.length === 0) {
                                        return "Usage: cache global sync <seconds>";
                                    }
                                    return await cacheManager.setSyncInterval(globalArgs[0]);
                                default:
                                    return `Unknown global action: ${globalAction}. Type 'cache' for help.`;
                            }

                        } else {
                            // Direct cache commands
                            switch (action) {
                                case 'list':
                                    return await cacheManager.listCaches();
                                case 'stats':
                                    const stats = await cacheManager.getCacheStats();
                                    return JSON.stringify(stats, null, 2);
                                case 'find':
                                    if (args.length === 0) {
                                        return "Usage: cache find <pattern>";
                                    }
                                    const findResult = await cacheManager.findUrls(args[0]);
                                    return JSON.stringify(findResult, null, 2);
                                case 'enable':
                                    if (args.length === 0) {
                                        return "Usage: cache enable <url>";
                                    }
                                    return await cacheManager.toggleCache(args[0], true);
                                case 'disable':
                                    if (args.length === 0) {
                                        return "Usage: cache disable <url>";
                                    }
                                    return await cacheManager.toggleCache(args[0], false);
                                case 'maxuses':
                                    if (args.length < 2) {
                                        return "Usage: cache maxuses <url> <count>";
                                    }
                                    return await cacheManager.setMaxUses(args[0], args[1]);
                                case 'expiry':
                                    if (args.length < 2) {
                                        return "Usage: cache expiry <url> <minutes>";
                                    }
                                    return await cacheManager.setExpiry(args[0], args[1]);
                                case 'reset':
                                    if (args.length === 0) {
                                        return "Usage: cache reset <url>";
                                    }
                                    return await cacheManager.resetUsage(args[0]);
                                case 'clear':
                                    return await cacheManager.clearAllCacheData();
                                case 'sync':
                                    await cacheManager.syncServiceWorkerDataToNavi();
                                    return "Sync completed";
                                default:
                                    return `Unknown action: ${action}. Type 'cache' for help.`;
                            }
                        }
                    } catch (error) {
                        console.error('[cache_manager] Command failed:', error);
                        return `Error: ${error.message || 'Unknown error'}`;
                    }
                }
            },
            
            // Additional command for programmatic access to structured data
            cache_data: {
                name: "cache_data",
                description: "Get structured cache data for programmatic use",
                execute: async (format = 'object') => {
                    try {
                        const data = await cacheManager.listCaches(format);
                        return data;
                    } catch (error) {
                        console.error('[cache_manager] Failed to get cache data:', error);
                        return { error: error.message };
                    }
                }
            }
        },
        
        // Lifecycle hooks
        onMount: async () => {
            // Initialize your module
            console.log('[cache_manager] Module loaded');
            
            // Start periodic sync automatically after a delay
            const startupTimer = setTimeout(async () => {
                try {
                    await cacheManager.startSync();
                    console.log('[cache_manager] Started automatic sync');
                } catch (error) {
                    console.error('[cache_manager] Failed to start sync:', error);
                }
            }, 2000); // Wait 2 seconds for service worker to be ready
            
            // Track startup timer for cleanup
            timers.push({ type: 'timeout', id: startupTimer });
        },
        
        onUnmount: () => {
            // ⚠️ CRITICAL: Clean up ALL resources
            // Remove event listeners
            eventListeners.forEach(({ element, event, handler }) => {
                element.removeEventListener(event, handler);
            });
            eventListeners.length = 0;
            
            // Remove DOM elements
            createdElements.forEach(el => el.remove());
            createdElements.length = 0;
            
            // Remove styles
            addedStyles.forEach(style => style.remove());
            addedStyles.length = 0;
            
            // Disconnect observers
            observers.forEach(observer => observer.disconnect());
            observers.length = 0;
            
            // Clear timers
            timers.forEach(({ type, id }) => {
                if (type === 'interval') clearInterval(id);
                if (type === 'timeout') clearTimeout(id);
            });
            timers.length = 0;
            
            // Module-specific cleanup
            cacheManager.stopSync();
            console.log('[cache_manager] Module unmounted');
        }
    };
};