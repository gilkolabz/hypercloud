export const register = (navi) => {
   
    // IMPORTANT: Track all resources for cleanup
    const eventListeners = [];
    const createdElements = [];
    const addedStyles = [];
    const observers = [];
    const timers = [];

    class SpacebarzAdmin {
        constructor() {
            // Use current origin instead of hardcoded URL to avoid CORS issues
            const isBrowser = typeof window !== "undefined" && typeof window.location !== "undefined";
            this.serverUrl = isBrowser ? window.location.origin + "/spacebarz_admin": "https://spacebarz.site";
            this.token = null;
            this.initialPassword = null;
            this.configKey = "spacebarz_admin_config";
        }

        async loadConfig() {
            try {
                const config = await navi.storage.item.get(this.configKey);
                if (config) {
                    this.serverUrl = config.serverUrl || this.serverUrl;
                    this.initialPassword = config.initialPassword;
                    this.token = config.token;
                }
            } catch (error) {
                // Failed to load config, continue with defaults
            }
        }

        async saveConfig() {
            try {
                const config = {
                    serverUrl: this.serverUrl,
                    initialPassword: this.initialPassword,
                    token: this.token
                };
                await navi.storage.item.set(this.configKey, config);
            } catch (error) {
                // Failed to save config
            }
        }

        async makeRequest(endpoint, method = "GET", body = null, headers = {}) {
            try {
                // Ensure serverUrl has a protocol
                let serverUrl = this.serverUrl;
                if (!serverUrl.startsWith('http://') && !serverUrl.startsWith('https://')) {
                    serverUrl = 'http://' + serverUrl;
                }
                
                const url = `${serverUrl}${endpoint}`;
                
                // Only include essential headers to avoid CORS issues
                const requestHeaders = {
                    "Content-Type": "application/json"
                };

                // Add custom headers only if provided
                Object.keys(headers).forEach(key => {
                    if (key.toLowerCase() !== 'cache-control') { // Skip problematic headers
                        requestHeaders[key] = headers[key];
                    }
                });

                if (this.token) {
                    requestHeaders["Authorization"] = `Bearer ${this.token}`;
                }
                
                const response = await globalThis.fetch(url, {
                    method,
                    headers: requestHeaders,
                    body: body == null
                        ? null
                        : ((typeof body === 'string')
                            || ((typeof Blob !== 'undefined') && (body instanceof Blob))
                            || ((typeof FormData !== 'undefined') && (body instanceof FormData))
                                ? body
                                : JSON.stringify(body)),
                    mode: 'cors', // Explicitly set CORS mode
                    credentials: 'omit' // Don't send credentials to avoid CORS issues
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
                }

                const responseData = await response.json();
                return responseData;
            } catch (error) {
                throw error;
            }
        }

        async authenticate(password = null) {
            try {
                const authPassword = password || this.initialPassword;
                if (!authPassword) {
                    throw new Error("No password provided. Use 'admin config password <password>' first.");
                }

                const response = await this.makeRequest("/admin/auth", "POST", {
                    password: authPassword
                });

                if (response.success) {
                    this.token = response.data.token;
                    if (!this.initialPassword) {
                        this.initialPassword = authPassword;
                    }
                    await this.saveConfig();
                    return `Authentication successful! Token: ${this.token.substring(0, 20)}...`;
                } else {
                    throw new Error(response.message || "Authentication failed");
                }
            } catch (error) {
                throw new Error(`Authentication failed: ${error.message}`);
            }
        }

        async getInfo() {
            try {
                const response = await this.makeRequest("/admin/info");
                if (response.success) {
                    return {
                        token: response.data.token_uuid,
                        created: response.data.created_at,
                        expires: response.data.expires_at,
                        manifestsOwned: response.data.manifests_owned
                    };
                } else {
                    throw new Error(response.message || "Failed to get info");
                }
            } catch (error) {
                throw new Error(`Failed to get info: ${error.message}`);
            }
        }

        async listManifests() {
            try {
                const response = await this.makeRequest("/admin/manifests");
                if (response.success) {
                    return response.data.manifests;
                } else {
                    throw new Error(response.message || "Failed to list manifests");
                }
            } catch (error) {
                throw new Error(`Failed to list manifests: ${error.message}`);
            }
        }

        async getManifestDetails(route) {
            try {
                const response = await this.makeRequest(`/admin/manifest/details?route=${encodeURIComponent(route)}`);
                if (response.success) {
                    return response.data;
                } else {
                    throw new Error(response.message || "Failed to get manifest details");
                }
            } catch (error) {
                throw new Error(`Failed to get manifest details: ${error.message}`);
            }
        }

        async getFileContent(route, filename, saveToStorage = true) {
            try {
                // Ensure serverUrl has a protocol
                let serverUrl = this.serverUrl;
                if (!serverUrl.startsWith('http://') && !serverUrl.startsWith('https://')) {
                    serverUrl = 'http://' + serverUrl;
                }
                
                const url = `${serverUrl}/admin/file/content?route=${encodeURIComponent(route)}&filename=${encodeURIComponent(filename)}`;
                
                const response = await globalThis.fetch(url, {
                    method: "GET",
                    headers: {
                        "Authorization": `Bearer ${this.token}`
                    },
                    mode: 'cors', // Explicitly set CORS mode
                    credentials: 'omit' // Don't send credentials to avoid CORS issues
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
                }

                const contentType = response.headers.get('content-type') || 'text/plain';
                const content = await response.text();
                
                const result = {
                    content,
                    contentType,
                    filename,
                    route
                };

                // Save to Navi storage if requested
                if (saveToStorage) {
                    const storagePath = `spacebarz_temp/${route}/${filename}`;
                    await navi.storage.file.save(storagePath, { media: content, mime: contentType });
                    result.storagePath = storagePath;
                }
                
                return result;
            } catch (error) {
                throw new Error(`Failed to get file content: ${error.message}`);
            }
        }

        async getRelatedFiles(route) {
            try {
                const response = await this.makeRequest(`/admin/manifest/related-files?route=${encodeURIComponent(route)}`);
                if (response.success) {
                    return response.data.referenced_files;
                } else {
                    throw new Error(response.message || "Failed to get related files");
                }
            } catch (error) {
                throw new Error(`Failed to get related files: ${error.message}`);
            }
        }

        async downloadAllRelatedFiles(route) {
            try {
                const relatedFiles = await this.getRelatedFiles(route);
                const downloadedFiles = [];
                
                for (const file of relatedFiles) {
                    try {
                        // Use the full path from the file reference, not just the filename
                        const fileContent = await this.getFileContent(route, file.path, true);
                        downloadedFiles.push({
                            ...file,
                            storagePath: fileContent.storagePath,
                            downloaded: true
                        });
                    } catch (error) {
                        downloadedFiles.push({
                            ...file,
                            downloaded: false,
                            error: error.message
                        });
                    }
                }
                
                return downloadedFiles;
            } catch (error) {
                throw new Error(`Failed to download related files: ${error.message}`);
            }
        }

        async listStoredFiles() {
            try {
                // Try multiple approaches to find stored files
                let allFiles = [];
                
                // Method 1: List the root directory
                try {
                    const rootFiles = await navi.storage.file.list('');
                    allFiles = allFiles.concat(rootFiles.filter(f => f.includes('spacebarz_temp')));
                } catch (e) {
                    // Root listing failed, continue with other methods
                }
                
                // Method 2: List spacebarz_temp directory
                try {
                    const tempFiles = await navi.storage.file.list('spacebarz_temp');
                    allFiles = allFiles.concat(tempFiles.map(f => f.startsWith('spacebarz_temp/') ? f : `spacebarz_temp/${f}`));
                } catch (e) {
                    // Temp listing failed, continue with other methods
                }
                
                // Method 3: List spacebarz_temp/ directory
                try {
                    const tempFilesSlash = await navi.storage.file.list('spacebarz_temp/');
                    allFiles = allFiles.concat(tempFilesSlash.map(f => f.startsWith('spacebarz_temp/') ? f : `spacebarz_temp/${f}`));
                } catch (e) {
                    // Temp listing failed, continue with other methods
                }
                
                // Remove duplicates and filter for actual files
                const uniqueFiles = [...new Set(allFiles)].filter(f => f.includes('spacebarz_temp') && !f.endsWith('/'));
                
                return uniqueFiles;
            } catch (error) {
                return [];
            }
        }

        async getStoredFile(storagePath) {
            try {
                const content = await navi.storage.file.load(storagePath);
                return {
                    content,
                    storagePath,
                    filename: storagePath.split('/').pop()
                };
            } catch (error) {
                throw new Error(`Failed to get stored file: ${error.message}`);
            }
        }

        async clearStoredFiles() {
            try {
                const files = await this.listStoredFiles();
                let deletedCount = 0;
                
                for (const file of files) {
                    try {
                        await navi.storage.file.del(file);
                        deletedCount++;
                    } catch (deleteError) {
                        // File deletion failed, continue with others
                    }
                }
                
                return `Cleared ${deletedCount} stored files`;
            } catch (error) {
                throw new Error(`Failed to clear stored files: ${error.message}`);
            }
        }

        async createManifest(route, description, manifestData) {
            try {
                const response = await this.makeRequest("/admin/manifest", "POST", {
                    route,
                    description,
                    manifest: manifestData
                });

                if (response.success) {
                    return {
                        route: response.data.route,
                        path: response.data.path
                    };
                } else {
                    throw new Error(response.message || "Failed to create manifest");
                }
            } catch (error) {
                throw new Error(`Failed to create manifest: ${error.message}`);
            }
        }

        async updateManifest(route, description, manifestData) {
            try {
                const response = await this.makeRequest("/admin/manifest/update", "PUT", {
                    route,
                    description,
                    manifest: manifestData
                });

                if (response.success) {
                    return {
                        route: response.data.route,
                        path: response.data.path
                    };
                } else {
                    throw new Error(response.message || "Failed to update manifest");
                }
            } catch (error) {
                throw new Error(`Failed to update manifest: ${error.message}`);
            }
        }

        async deleteManifest(route) {
            try {
                const response = await this.makeRequest(`/admin/manifest/delete?route=${encodeURIComponent(route)}`, "DELETE");

                if (response.success) {
                    return response.data.route;
                } else {
                    throw new Error(response.message || "Failed to delete manifest");
                }
            } catch (error) {
                throw new Error(`Failed to delete manifest: ${error.message}`);
            }
        }

        async uploadFile(route, filename, content, contentType = "text/plain") {
            try {
                // Strip route prefix from filename if it's already included
                let cleanFilename = filename;
                if (filename.startsWith(`${route}/`)) {
                    cleanFilename = filename.substring(route.length + 1);
                }
                
                const response = await this.makeRequest(
                    `/admin/file/upload?route=${encodeURIComponent(route)}&filename=${encodeURIComponent(cleanFilename)}`,
                    "POST",
                    content,
                    {
                        "Content-Type": contentType
                    }
                );

                if (response.success) {
                    return {
                        filename: response.data.filename,
                        path: response.data.path
                    };
                } else {
                    throw new Error(response.message || "Failed to upload file");
                }
            } catch (error) {
                throw new Error(`Failed to upload file: ${error.message}`);
            }
        }

        async updateFile(route, filename, content, contentType = "text/plain") {
            try {
                // Strip route prefix from filename if it's already included
                let cleanFilename = filename;
                if (filename.startsWith(`${route}/`)) {
                    cleanFilename = filename.substring(route.length + 1);
                }
                console.log('[admin_mod] raw content:', content)
                const response = await this.makeRequest(
                    `/admin/file/update?route=${encodeURIComponent(route)}&filename=${encodeURIComponent(cleanFilename)}`,
                    "PUT",
                    content,
                    {
                        "Content-Type": contentType
                    }
                );

                if (response.success) {
                    return {
                        filename: response.data.filename,
                        path: response.data.path
                    };
                } else {
                    throw new Error(response.message || "Failed to update file");
                }
            } catch (error) {
                throw new Error(`Failed to update file: ${error.message}`);
            }
        }

        async deleteFile(route, filename) {
            try {
                const response = await this.makeRequest(
                    `/admin/file/delete?route=${encodeURIComponent(route)}&filename=${encodeURIComponent(filename)}`,
                    "DELETE"
                );

                if (response.success) {
                    return response.data.filename;
                } else {
                    throw new Error(response.message || "Failed to delete file");
                }
            } catch (error) {
                throw new Error(`Failed to delete file: ${error.message}`);
            }
        }

        async listFiles(route, recursive = false) {
            try {
                const recursiveParam = recursive ? "&recursive=true" : "";
                const response = await this.makeRequest(`/admin/files?route=${encodeURIComponent(route)}${recursiveParam}`);
                if (response.success) {
                    return response.data.files;
                } else {
                    throw new Error(response.message || "Failed to list files");
                }
            } catch (error) {
                throw new Error(`Failed to list files: ${error.message}`);
            }
        }

        async getManifest(route) {
            try {
                const response = await globalThis.fetch(`${this.serverUrl}/manifest/${route}`);
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                return await response.text();
            } catch (error) {
                throw new Error(`Failed to get manifest: ${error.message}`);
            }
        }

        async setToken(token) {
            try {
                this.token = token;
                await this.saveConfig();
                return `Token set successfully: ${token.substring(0, 20)}...`;
            } catch (error) {
                throw new Error(`Failed to set token: ${error.message}`);
            }
        }

        async hasConfiguration() {
            try {
                const config = await navi.storage.item.get(this.configKey);
                // Only consider it configured if there's actually saved data (not just defaults)
                return !!(config && (config.initialPassword || config.token));
            } catch (error) {
                // Failed to check configuration
                return false;
            }
        }

        async checkAuthStatus() {
            // Always ensure we have the latest token from storage
            await this.loadConfig();
            
            if (!this.token) {
                return { authenticated: false, message: "No token found" };
            }
            
            try {
                const info = await this.getInfo();
                return { 
                    authenticated: true, 
                    token: this.token.substring(0, 20) + '...',
                    expires: info.expires,
                    created: info.created
                };
            } catch (error) {
                // Only clear token if it's specifically an authentication error (401/403)
                if (error.message.includes('401') || error.message.includes('403') || 
                    error.message.includes('Unauthorized') || error.message.includes('Forbidden')) {
                    this.token = null;
                    await this.saveConfig();
                    return { authenticated: false, message: "Token expired or invalid" };
                } else {
                    // Network or other error - keep token but report connection issue
                    return { 
                        authenticated: true, 
                        token: this.token.substring(0, 20) + '...',
                        message: `Token present but server unreachable: ${error.message}` 
                    };
                }
            }
        }

        async createFile(route, filePath, content, contentType = "text/plain", description = "") {
            try {
                const response = await this.makeRequest("/admin/file/create", "POST", {
                    route,
                    filePath,
                    content,
                    contentType,
                    description
                });

                if (response.success) {
                    return {
                        filename: response.data.filename,
                        path: response.data.path,
                        full_path: response.data.full_path,
                        description: response.data.description
                    };
                } else {
                    throw new Error(response.message || "Failed to create file");
                }
            } catch (error) {
                throw new Error(`Failed to create file: ${error.message}`);
            }
        }
    }

    const admin = new SpacebarzAdmin();

    return {
        name: "spacebarz_admin",
        version: "1.4.0",
        description: "Programmatic interface to Spacebarz admin API with local file storage",
        
        moduleInfo: {
            name: "spacebarz_admin",
            version: "1.4.0",
            description: "Programmatic interface to Spacebarz admin API with local file storage"
        },
        
        commands: {
            admin: {
                name: "admin",
                description: "Spacebarz admin API commands: admin <command> [args...]",
                execute: async (action, ...args) => {
                    if (!action) {
                        return [
                            "Spacebarz Admin API v1.4.0",
                            "",
                            "Usage:",
                            "  admin config <server|password> <value>  Configure server URL or password",
                            "  admin set-token <token>                 Set authentication token directly",
                            "  admin auth [password]                  Authenticate with admin API",
                            "  admin info                             Get admin session info",
                            "  admin list                             List owned manifests",
                            "  admin details <route>                  Get full manifest details with metadata",
                            "  admin files <route>                    List files in manifest",
                            "  admin related <route>                  Get all files referenced by manifest",
                            "  admin content <route> <filename>       Get raw file content (Lua, templates, etc.)",
                            "  admin download <route>                 Download all related files to storage",
                            "  admin stored                           List files stored in local storage",
                            "  admin stored <path>                    Get content of stored file",
                            "  admin clear-stored                     Clear all stored files",
                            "  admin create <route> <description> [json] Create new manifest",
                            "  admin update <route> <description> [json] Update existing manifest",
                            "  admin delete <route>                   Delete manifest",
                            "  admin upload <route> <filename> <content> Upload file to manifest",
                            "  admin get <route>                      Get manifest content",
                            "  admin status                           Check authentication status",
                            "",
                           ].join('\n');
                    }

                    try {
                        switch (action) {
                            case 'config':
                                if (args.length < 2) {
                                    return "Usage: admin config <server|password> <value>";
                                }
                                const [configType, configValue] = args;
                                if (configType === 'server') {
                                    admin.serverUrl = configValue;
                                    await admin.saveConfig();
                                    return `Server URL set to: ${configValue}`;
                                } else if (configType === 'password') {
                                    admin.initialPassword = configValue;
                                    await admin.saveConfig();
                                    return "Password saved (use 'admin auth' to authenticate)";
                                } else {
                                    return "Unknown config type. Use 'server' or 'password'";
                                }

                            case 'set-token':
                                if (args.length === 0) {
                                    return "Usage: admin set-token <token>";
                                }
                                const token = args[0];
                                const setTokenResult = await admin.setToken(token);
                                return setTokenResult;

                            case 'auth':
                                const password = args.length > 0 ? args[0] : null;
                                const authResult = await admin.authenticate(password);
                                return authResult;

                            case 'info':
                                const info = await admin.getInfo();
                                return [
                                    `Token: ${info.token.substring(0, 20)}...`,
                                    `Created: ${info.created}`,
                                    `Expires: ${info.expires}`,
                                    `Manifests Owned: ${info.manifestsOwned}`
                                ].join('\n');

                            case 'list':
                                const manifests = await admin.listManifests();
                                if (manifests.length === 0) {
                                    return "No manifests found";
                                }
                                let output = "Manifests:\n";
                                manifests.forEach(manifest => {
                                    output += `  - ${manifest.route} (${manifest.path})\n`;
                                });
                                return output.trim();

                            case 'details':
                                if (args.length === 0) {
                                    return "Usage: admin details <route>";
                                }
                                const detailsRoute = args[0];
                                const details = await admin.getManifestDetails(detailsRoute);
                                return [
                                    `Manifest Details for: ${detailsRoute}`,
                                    `Type: ${details.manifest_type}`,
                                    `Path: ${details.path}`,
                                    `Size: ${details.file_size} bytes`,
                                    `Modified: ${details.file_modtime}`,
                                    "",
                                    "Manifest JSON:",
                                    JSON.stringify(details.manifest, null, 2)
                                ].join('\n');

                            case 'related':
                                if (args.length === 0) {
                                    return "Usage: admin related <route>";
                                }
                                const relatedRoute = args[0];
                                const relatedFiles = await admin.getRelatedFiles(relatedRoute);
                                if (relatedFiles.length === 0) {
                                    return `No related files found for manifest: ${relatedRoute}`;
                                }
                                let relatedOutput = `Related files for ${relatedRoute}:\n`;
                                relatedFiles.forEach(file => {
                                    relatedOutput += `  - ${file.path} (${file.type}, ${file.context})\n`;
                                    relatedOutput += `    Size: ${file.size} bytes, Modified: ${file.modtime}\n`;
                                    relatedOutput += `    Content-Type: ${file.content_type}\n\n`;
                                });
                                return relatedOutput.trim();

                            case 'content':
                                if (args.length < 2) {
                                    return "Usage: admin content <route> <filename>";
                                }
                                const [contentRoute, contentFilename] = args;
                                const fileContent = await admin.getFileContent(contentRoute, contentFilename);
                                const storageInfo = fileContent.storagePath ? `\nStored at: ${fileContent.storagePath}` : '';
                                return [
                                    `File Content: ${contentFilename}`,
                                    `Route: ${contentRoute}`,
                                    `Content-Type: ${fileContent.contentType}${storageInfo}`,
                                    "",
                                    "Content:",
                                    "---",
                                    fileContent.content,
                                    "---"
                                ].join('\n');

                            case 'download':
                                if (args.length === 0) {
                                    return "Usage: admin download <route>";
                                }
                                const downloadRoute = args[0];
                                const downloadedFiles = await admin.downloadAllRelatedFiles(downloadRoute);
                                let downloadOutput = `Downloaded files for ${downloadRoute}:\n`;
                                downloadedFiles.forEach(file => {
                                    if (file.downloaded) {
                                        downloadOutput += `  ✓ ${file.path} → ${file.storagePath}\n`;
                                    } else {
                                        downloadOutput += `  ✗ ${file.path} (${file.error})\n`;
                                    }
                                });
                                return downloadOutput.trim();

                            case 'stored':
                                if (args.length === 0) {
                                    // List stored files
                                    const storedFiles = await admin.listStoredFiles();
                                    if (storedFiles.length === 0) {
                                        return "No files stored in local storage";
                                    }
                                    let storedOutput = "Stored files:\n";
                                    storedFiles.forEach(file => {
                                        storedOutput += `  - ${file}\n`;
                                    });
                                    return storedOutput.trim();
                                } else {
                                    // Get specific stored file content
                                    const storagePath = args[0];
                                    const storedFile = await admin.getStoredFile(storagePath);
                                    return [
                                        `Stored File: ${storedFile.filename}`,
                                        `Path: ${storedFile.storagePath}`,
                                        "",
                                        "Content:",
                                        "---",
                                        storedFile.content,
                                        "---"
                                    ].join('\n');
                                }

                            case 'clear-stored':
                                const clearResult = await admin.clearStoredFiles();
                                return clearResult;

                            case 'create':
                                if (args.length < 2) {
                                    return "Usage: admin create <route> <description> [manifest_json]";
                                }
                                
                                // Handle the case where description might be split across multiple args
                                let route = args[0];
                                let description = '';
                                let jsonStartIndex = 1;
                                
                                // Find where JSON starts by looking for { or [ or '{
                                for (let i = 1; i < args.length; i++) {
                                    if (args[i].startsWith('{') || args[i].startsWith('[') || args[i].startsWith("'{") || args[i].startsWith("'[")) {
                                        jsonStartIndex = i;
                                        break;
                                    }
                                    description += (description ? ' ' : '') + args[i];
                                }
                                
                                // Clean up description (remove quotes if present)
                                description = description.replace(/^["']|["']$/g, '');
                                
                                const jsonParts = args.slice(jsonStartIndex);
                                
                                // Debug: log what we received
                                console.log('[spacebarz_admin] Create args:', args);
                                console.log('[spacebarz_admin] Route:', route);
                                console.log('[spacebarz_admin] Description:', description);
                                console.log('[spacebarz_admin] JSON parts:', jsonParts);
                                
                                // Check if manifest data was provided as argument
                                let manifestData;
                                if (jsonParts.length > 0) {
                                    try {
                                        // Join all JSON parts without spaces to preserve JSON structure
                                        const jsonString = jsonParts.join('');
                                        console.log('[spacebarz_admin] JSON string:', jsonString);
                                        manifestData = JSON.parse(jsonString);
                                    } catch (error) {
                                        return `Error parsing manifest JSON: ${error.message}\nJSON string was: ${jsonParts.join('')}`;
                                    }
                                } else {
                                    // Create minimal default structure
                                    manifestData = {
                                        default_response: {
                                            name: route.replace(/\//g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
                                            version: "1.0",
                                            description: description
                                        }
                                    };
                                }

                                const createResult = await admin.createManifest(route, description, manifestData);
                                return `Created manifest: ${createResult.route} at ${createResult.path}`;

                            case 'update':
                                if (args.length < 2) {
                                    return "Usage: admin update <route> <description> [manifest_json]";
                                }
                                
                                // Handle the case where description might be split across multiple args
                                let updateRoute = args[0];
                                let updateDescription = '';
                                let updateJsonStartIndex = 1;
                                
                                // Find where JSON starts by looking for { or [ or '{
                                for (let i = 1; i < args.length; i++) {
                                    if (args[i].startsWith('{') || args[i].startsWith('[') || args[i].startsWith("'{") || args[i].startsWith("'[")) {
                                        updateJsonStartIndex = i;
                                        break;
                                    }
                                    updateDescription += (updateDescription ? ' ' : '') + args[i];
                                }
                                
                                // Clean up description (remove quotes if present)
                                updateDescription = updateDescription.replace(/^["']|["']$/g, '');
                                
                                const updateJsonParts = args.slice(updateJsonStartIndex);
                                
                                // Check if manifest data was provided as argument
                                let updateManifestData;
                                if (updateJsonParts.length > 0) {
                                    try {
                                        // Join all JSON parts without spaces to preserve JSON structure
                                        const jsonString = updateJsonParts.join('');
                                        updateManifestData = JSON.parse(jsonString);
                                    } catch (error) {
                                        return `Error parsing manifest JSON: ${error.message}`;
                                    }
                                } else {
                                    // Create minimal default structure
                                    updateManifestData = {
                                        default_response: {
                                            name: updateRoute.replace(/\//g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
                                            version: "1.0",
                                            description: updateDescription
                                        }
                                    };
                                }

                                const updateResult = await admin.updateManifest(updateRoute, updateDescription, updateManifestData);
                                return `Updated manifest: ${updateResult.route} at ${updateResult.path}`;

                            case 'delete':
                                if (args.length === 0) {
                                    return "Usage: admin delete <route>";
                                }
                                const deleteRoute = args[0];
                                const deleteResult = await admin.deleteManifest(deleteRoute);
                                return `Deleted manifest: ${deleteResult}`;

                            case 'upload':
                                if (args.length < 2) {
                                    return "Usage: admin upload <route> <filename> [content]";
                                }
                                const [uploadRoute, filename, ...contentParts] = args;
                                const content = contentParts.join(' ');
                                
                                if (!content) {
                                    return "Error: Content is required for upload";
                                }
                                
                                // Determine content type based on filename
                                let contentType = "text/plain";
                                if (filename.endsWith('.html')) contentType = "text/html";
                                else if (filename.endsWith('.js')) contentType = "application/javascript";
                                else if (filename.endsWith('.json')) contentType = "application/json";
                                else if (filename.endsWith('.lua')) contentType = "text/plain";

                                const uploadResult = await admin.uploadFile(uploadRoute, filename, content, contentType);
                                return `Uploaded file: ${uploadResult.filename} to ${uploadResult.path}`;

                            case 'files':
                                if (args.length === 0) {
                                    return "Usage: admin files <route>";
                                }
                                const filesRoute = args[0];
                                const files = await admin.listFiles(filesRoute);
                                if (files.length === 0) {
                                    return `No files found in manifest: ${filesRoute}`;
                                }
                                let filesOutput = `Files in ${filesRoute}:\n`;
                                files.forEach(file => {
                                    filesOutput += `  - ${file.name} (${file.size} bytes, modified: ${file.modtime})\n`;
                                });
                                return filesOutput.trim();

                            case 'get':
                                if (args.length === 0) {
                                    return "Usage: admin get <route>";
                                }
                                const getRoute = args[0];
                                const manifestContent = await admin.getManifest(getRoute);
                                return `Manifest content for ${getRoute}:\n${manifestContent}`;

                            case 'status':
                                const authStatus = await admin.checkAuthStatus();
                                if (authStatus.authenticated) {
                                    return `Authentication Status: AUTHENTICATED\nToken: ${authStatus.token}\nCreated: ${authStatus.created}\nExpires: ${authStatus.expires}`;
                                } else {
                                    return `Authentication Status: NOT AUTHENTICATED\nReason: ${authStatus.message}\nUse 'admin auth' to authenticate.`;
                                }

                            default:
                                return `Unknown command: ${action}. Type 'admin' for help.`;
                        }
                    } catch (error) {
                        return `Error: ${error.message || 'Unknown error'}`;
                    }
                }
            }
        },
        
        // Expose the admin instance for external access
        admin,
        
        onMount: async () => {
            await admin.loadConfig();
            
            // Just show if we have a token, don't validate it
            if (admin.token) {
                // Token loaded
            } else {
                // No token found - use 'admin auth' to authenticate
            }
        },
        
        onUnmount: () => {
            // CRITICAL: Clean up ALL resources
            
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
            
            // Module unmounted
        }
    };
};