const NAVI_CALL = 'navi:call';
/** Default navi:call timeout (storage.file.load, callout). */
const NAVI_CLIENT_TIMEOUT_MS = 10000;
/** Observe/handler path (snoopy tip+bin writes need headroom beyond meta-only). */
const NAVI_HANDLER_TIMEOUT_MS = 8000;
/** Park-before-network must not block shell boot (page answers park.check only after navi_shell.js). */
const NAVI_PARK_TIMEOUT_MS = 400;
/** /navi/* park.check may dispatch a mod command (surf/mount fetch), so it needs headroom beyond the boot guard. */
const NAVI_MODPARK_TIMEOUT_MS = 4000;
const LEGACY_CACHE_NAME = 'foobarch-01';
/** navi.pwa.set overlay — same-origin /manifest.json (never blob:). */
const PWA_MANIFEST_CACHE = 'foobarch-pwa-manifest';
const PWA_MANIFEST_PATH = '/manifest.json';
/** Durable plugin descriptors used to rebuild the in-memory registry after SW idle termination. */
const PLUGIN_CACHE = 'foobarch-sw-plugins-v1';
const PLUGIN_CACHE_PATH = '/__foobarch_sw_plugin__/';
/** Offline: /navi_shell.js in SHELL_CACHE; SSR documents in OFFLINE_DOC_CACHE (warm only, serve offline). */
const SHELL_CACHE = 'foobarch-shell-v2';
const OFFLINE_DOC_CACHE = 'foobarch-offline-docs-v1';
const SHELL_RUNTIME_URL = '/navi_shell.js';
const SHELL_DEFAULT_URLS = [SHELL_RUNTIME_URL];
/** @type {string|null} */
let pwaManifestOverrideJson = null;

/** Root shell assets — never park-check (would deadlock waiting for navi_shell.js). */
function isShellStaticPath(pathname) {
    return (
        pathname === '/navi_shell.js' ||
        pathname === '/sw.js' ||
        pathname === '/favicon.ico' ||
        pathname === '/manifest.json' ||
        pathname === '/manifest.json/icon-192.png' ||
        pathname === '/manifest.json/icon-512.png'
    );
}

function normalizeShellPath(urlPath) {
    let path = String(urlPath || '').trim();
    if (!path) return '/';
    try {
        if (/^[a-z][a-z0-9+.-]*:/i.test(path)) {
            path = new URL(path).pathname || '/';
        }
    } catch {
        /* keep */
    }
    if (!path.startsWith('/')) path = `/${path}`;
    const q = path.indexOf('?');
    if (q >= 0) path = path.slice(0, q);
    const h = path.indexOf('#');
    if (h >= 0) path = path.slice(0, h);
    return path || '/';
}

function isShellRuntimePath(pathname) {
    return pathname === SHELL_RUNTIME_URL;
}

async function pruneShellCacheToRuntimeOnly() {
    try {
        const cache = await caches.open(SHELL_CACHE);
        const keys = await cache.keys();
        await Promise.all(
            keys.map(async (req) => {
                try {
                    const p = new URL(req.url).pathname;
                    if (p !== SHELL_RUNTIME_URL) await cache.delete(req);
                } catch {
                    /* skip */
                }
            })
        );
    } catch {
        /* ignore */
    }
}

async function listOfflineDocCache() {
    try {
        const cache = await caches.open(OFFLINE_DOC_CACHE);
        const keys = await cache.keys();
        const urls = [];
        for (const req of keys) {
            try {
                urls.push(new URL(req.url).pathname);
            } catch {
                /* skip */
            }
        }
        urls.sort();
        return { cache: OFFLINE_DOC_CACHE, urls };
    } catch {
        return { cache: OFFLINE_DOC_CACHE, urls: [] };
    }
}

/** Fetch as a top-level document navigation so foobarch returns full SSR shell. */
function offlineDocWarmRequest(urlPath) {
    const path = normalizeShellPath(urlPath);
    return new Request(new URL(path, self.location.origin).href, {
        credentials: 'same-origin',
        mode: 'same-origin',
        cache: 'no-store',
        headers: {
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Site': 'same-origin',
        },
    });
}

async function warmOfflineDoc(urlPath) {
    const path = normalizeShellPath(urlPath);
    const req = offlineDocWarmRequest(path);
    const cache = await caches.open(OFFLINE_DOC_CACHE);
    try {
        const fresh = await fetch(req);
        if (!fresh.ok) {
            return { ok: false, url: path, status: fresh.status };
        }
        await cache.put(shellCacheRequest(path), fresh.clone());
        return { ok: true, url: path, status: fresh.status };
    } catch (err) {
        return {
            ok: false,
            url: path,
            error: String(err && err.message ? err.message : err),
        };
    }
}

async function matchOfflineDoc(pathname) {
    const cache = await caches.open(OFFLINE_DOC_CACHE);
    const cacheReq = shellCacheRequest(pathname);
    return (
        (await cache.match(cacheReq)) ||
        (await cache.match(new Request(new URL(pathname, self.location.origin).href)))
    );
}

async function deleteOfflineDoc(urlPath) {
    const path = normalizeShellPath(urlPath);
    const cache = await caches.open(OFFLINE_DOC_CACHE);
    const deleted = await cache.delete(shellCacheRequest(path));
    return { cache: OFFLINE_DOC_CACHE, url: path, deleted };
}

async function clearOfflineDocCache() {
    const deleted = await caches.delete(OFFLINE_DOC_CACHE);
    return { cache: OFFLINE_DOC_CACHE, deleted: !!deleted };
}

async function offlineDocumentResponse(request, pathname) {
    try {
        const fresh = await fetch(request);
        if (fresh && fresh.ok) {
            try {
                const cache = await caches.open(OFFLINE_DOC_CACHE);
                await cache.put(shellCacheRequest(pathname), fresh.clone());
            } catch {
                /* ignore quota */
            }
            return fresh;
        }
    } catch {
        /* network failed — try offline cache */
    }
    const hit = await matchOfflineDoc(pathname);
    if (hit) {
        const headers = new Headers(hit.headers);
        headers.set('X-Navi-Offline-Cache', 'hit');
        return new Response(hit.body, {
            status: hit.status,
            statusText: hit.statusText,
            headers,
        });
    }
    return new Response(`Offline — no cached document for ${pathname}\n`, {
        status: 503,
        statusText: 'Service Unavailable',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
}

function shellCacheRequest(urlPath) {
    const path = normalizeShellPath(urlPath);
    return new Request(new URL(path, self.location.origin).href, {
        credentials: 'same-origin',
    });
}

async function listShellCache() {
    const urls = [SHELL_RUNTIME_URL];
    try {
        const cache = await caches.open(SHELL_CACHE);
        const keys = await cache.keys();
        for (const req of keys) {
            try {
                const p = new URL(req.url).pathname;
                if (p && !urls.includes(p)) urls.push(p);
            } catch {
                /* skip */
            }
        }
    } catch {
        /* ignore */
    }
    urls.sort();
    const offline = await listOfflineDocCache();
    return {
        cache: SHELL_CACHE,
        urls,
        defaults: [...SHELL_DEFAULT_URLS],
        runtime: SHELL_RUNTIME_URL,
        offline_docs: offline,
    };
}

async function putShellCacheEntry(urlPath, body, contentType) {
    const path = normalizeShellPath(urlPath);
    if (body == null) throw new Error('put requires body');
    const cache = await caches.open(SHELL_CACHE);
    const req = shellCacheRequest(path);
    const type =
        contentType ||
        (path === SHELL_RUNTIME_URL
            ? 'application/javascript; charset=utf-8'
            : 'text/html; charset=utf-8');
    const res = new Response(String(body), {
        status: 200,
        headers: {
            'Content-Type': type,
            'Cache-Control': 'no-cache',
            'X-Navi-Shell-Cache': 'put',
        },
    });
    await cache.put(req, res);
    return { ok: true, url: path, bytes: String(body).length, contentType: type };
}

async function refreshShellCache(urls) {
    const list =
        Array.isArray(urls) && urls.length
            ? urls.map(normalizeShellPath)
            : [...SHELL_DEFAULT_URLS];
    const cache = await caches.open(SHELL_CACHE);
    const results = [];
    for (const path of list) {
        if (path !== SHELL_RUNTIME_URL) {
            results.push({
                url: path,
                ok: false,
                error: 'runtime cache is navi_shell.js only — use warm for documents',
            });
            continue;
        }
        const req = shellCacheRequest(path);
        try {
            const fresh = await fetch(req, {
                cache: 'reload',
                credentials: 'same-origin',
            });
            if (!fresh.ok) {
                results.push({ url: path, ok: false, status: fresh.status });
                continue;
            }
            await cache.put(req, fresh.clone());
            results.push({ url: path, ok: true, status: fresh.status });
        } catch (err) {
            results.push({
                url: path,
                ok: false,
                error: String(err && err.message ? err.message : err),
            });
        }
    }
    return { cache: SHELL_CACHE, results, ...(await listShellCache()) };
}

async function warmOfflineDocs(urls) {
    const list = (Array.isArray(urls) ? urls : []).map(normalizeShellPath);
    const results = [];
    for (const path of list) {
        results.push(await warmOfflineDoc(path));
    }
    return { cache: OFFLINE_DOC_CACHE, results, ...(await listShellCache()) };
}

async function clearShellCache() {
    const deleted = await caches.delete(SHELL_CACHE);
    await clearOfflineDocCache();
    return {
        cache: SHELL_CACHE,
        deleted: !!deleted,
        offline_docs: await listOfflineDocCache(),
    };
}

async function networkFirstRuntime(request, pathname) {
    const cache = await caches.open(SHELL_CACHE);
    const cacheReq = shellCacheRequest(pathname);
    try {
        const fresh = await fetch(request, {
            credentials: 'same-origin',
            cache: 'no-store',
        });
        if (fresh && fresh.ok) {
            try {
                await cache.put(cacheReq, fresh.clone());
            } catch {
                /* ignore quota / opaque */
            }
            return fresh;
        }
    } catch {
        /* offline or aborted — try cache */
    }
    const hit =
        (await cache.match(cacheReq)) ||
        (await cache.match(request, { ignoreSearch: true }));
    if (hit) {
        const headers = new Headers(hit.headers);
        headers.set('X-Navi-Shell-Cache', 'hit');
        return new Response(hit.body, {
            status: hit.status,
            statusText: hit.statusText,
            headers,
        });
    }
    return new Response(`Foobarch shell offline — no cache for ${pathname}\n`, {
        status: 503,
        statusText: 'Service Unavailable',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
}

function pwaManifestResponse(json) {
    return new Response(json, {
        status: 200,
        headers: {
            'Content-Type': 'application/manifest+json; charset=utf-8',
            'Cache-Control': 'no-store',
        },
    });
}

async function loadPwaManifestOverride() {
    try {
        const cache = await caches.open(PWA_MANIFEST_CACHE);
        const hit = await cache.match(PWA_MANIFEST_PATH);
        if (!hit) {
            pwaManifestOverrideJson = null;
            return;
        }
        pwaManifestOverrideJson = await hit.text();
    } catch {
        pwaManifestOverrideJson = null;
    }
}

async function setPwaManifestOverride(json) {
    const next =
        json == null || json === ''
            ? null
            : typeof json === 'string'
              ? json
              : JSON.stringify(json);
    pwaManifestOverrideJson = next;
    const cache = await caches.open(PWA_MANIFEST_CACHE);
    if (next == null) {
        await cache.delete(PWA_MANIFEST_PATH);
        return;
    }
    await cache.put(PWA_MANIFEST_PATH, pwaManifestResponse(next));
}

/** @type {Map<string, {
 *   handleFetch?: (event: FetchEvent) => boolean,
 *   observeFetch?: (event: FetchEvent, response: Response) => void | Promise<void>,
 *   observeFetchError?: (event: FetchEvent, error: Error) => void | Promise<void>,
 *   install?: (ctx: object) => void
 * }>} */
const plugins = new Map();

// --- Plugin registry ---

/**
 * Called by plugin scripts loaded from a URL or sent directly by a Navi module.
 * @param {string} id
 * @param {{ handleFetch?: (event: FetchEvent) => boolean, install?: (ctx: object) => void }} plugin
 */
self.registerFoobarchPlugin = function registerFoobarchPlugin(id, plugin) {
    if (!id || typeof id !== 'string') {
        throw new Error('registerFoobarchPlugin requires a string id');
    }
    if (self.__foobarchRegisterAs && id !== self.__foobarchRegisterAs) {
        throw new Error(`plugin source must register as "${self.__foobarchRegisterAs}", not "${id}"`);
    }
    plugins.set(id, plugin || {});
    if (typeof plugin?.install === 'function') {
        plugin.install({
            self,
            naviCall: requestNaviCall,
            /** Invoke a page-side handler registered via navi.sw.on(name, fn). */
            naviHandler: (name, ...args) => requestNaviCall(['handler', String(name)], args),
            swCallout,
            registerFoobarchPlugin,
        });
    }
};

function unregisterFoobarchPlugin(id) {
    plugins.delete(id);
}

function listFoobarchPlugins() {
    return [...plugins.keys()];
}

function pluginCacheRequest(id) {
    return new Request(
        new URL(`${PLUGIN_CACHE_PATH}${encodeURIComponent(id)}`, self.location.origin).href
    );
}

function evaluatePluginSource(id, source) {
    unregisterFoobarchPlugin(id);
    self.__foobarchRegisterAs = id;
    try {
        // Service workers do not implement URL.createObjectURL / Blob URLs.
        // Run trusted Navi-supplied source in the SW global (same as importScripts).
        (0, eval)(`${source}\n//# sourceURL=foobarch-plugin-${id}`);
        if (!plugins.has(id)) {
            throw new Error(`plugin source did not call registerFoobarchPlugin("${id}", ...)`);
        }
    } catch (err) {
        unregisterFoobarchPlugin(id);
        throw err;
    } finally {
        delete self.__foobarchRegisterAs;
    }
}

function importPluginUrl(id, url) {
    unregisterFoobarchPlugin(id);
    self.__foobarchRegisterAs = id;
    try {
        importScripts(url);
        if (!plugins.has(id)) {
            throw new Error(`plugin script did not call registerFoobarchPlugin("${id}", ...)`);
        }
    } catch (err) {
        unregisterFoobarchPlugin(id);
        throw err;
    } finally {
        delete self.__foobarchRegisterAs;
    }
}

async function persistPluginDescriptor(id, descriptor) {
    const cache = await caches.open(PLUGIN_CACHE);
    await cache.put(
        pluginCacheRequest(id),
        new Response(JSON.stringify({ id, ...descriptor }), {
            headers: { 'Content-Type': 'application/json' },
        })
    );
}

async function deletePluginDescriptor(id) {
    const cache = await caches.open(PLUGIN_CACHE);
    await cache.delete(pluginCacheRequest(id));
}

async function hydratePlugins() {
    try {
        const cache = await caches.open(PLUGIN_CACHE);
        const requests = await cache.keys();
        for (const request of requests) {
            try {
                const response = await cache.match(request);
                const descriptor = response && await response.json();
                if (!descriptor?.id) continue;
                if (descriptor.kind === 'source' && typeof descriptor.source === 'string') {
                    evaluatePluginSource(descriptor.id, descriptor.source);
                } else if (descriptor.kind === 'url' && descriptor.url) {
                    importPluginUrl(descriptor.id, descriptor.url);
                }
            } catch (err) {
                console.warn(
                    '[sw] persisted plugin restore failed:',
                    err && err.message ? err.message : err
                );
            }
        }
    } catch (err) {
        console.warn(
            '[sw] plugin registry hydration failed:',
            err && err.message ? err.message : err
        );
    }
}

let pluginsHydrated = false;
const pluginsReady = hydratePlugins().finally(() => {
    pluginsHydrated = true;
});

// --- Navi park path helpers (SW cannot access window.navi) ---
// naviStoragePathFromUrl: optional key peel for /navi/* URLs (headers / tooling).
// Fetch handler no longer uses it for an exclusive local-404 branch.

function naviStoragePathFromUrl(pathname) {
    let trimmed = String(pathname || '').replace(/^\/+/, '');
    try {
        trimmed = decodeURIComponent(trimmed);
    } catch {
        /* keep */
    }
    if (trimmed === 'navi' || trimmed === 'navi:' || trimmed === 'navi/') {
        return null;
    }
    // /navi/… /navi:… /navi …  — rest is the file key (navi prefix presumed).
    if (/^navi[/:\s]/.test(trimmed)) {
        const rest = trimmed.slice(4).replace(/^[/:\s]+/, '');
        return rest || null;
    }
    return null;
}

function orderClients(clients) {
    return [...clients].sort((a, b) => {
        if (a.focused !== b.focused) return a.focused ? -1 : 1;
        if (a.visibilityState === 'visible' && b.visibilityState !== 'visible') return -1;
        if (b.visibilityState === 'visible' && a.visibilityState !== 'visible') return 1;
        return 0;
    });
}

/**
 * Ask a window client to run a navi path. Prefer SW-controlled clients so we do
 * not burn the full timeout on stray uncontrolled tabs.
 * Handler paths (observeFetch → navi.sw.on) use a short timeout.
 */
function requestNaviCall(path, args) {
    const isHandler = Array.isArray(path) && path[0] === 'handler';
    const isPark = Array.isArray(path) && path[0] === 'park';
    // /navi/* park.check can dispatch a mod (may fetch) → longer budget.
    // General park-before-network on host routes keeps the short boot guard.
    const isNaviParkPath =
        isPark &&
        typeof args?.[0] === 'string' &&
        /^\/?navi(?:[/:]|$)/.test(args[0]);
    const timeoutMs = isHandler
        ? NAVI_HANDLER_TIMEOUT_MS
        : isNaviParkPath
          ? NAVI_MODPARK_TIMEOUT_MS
          : isPark
            ? NAVI_PARK_TIMEOUT_MS
            : NAVI_CLIENT_TIMEOUT_MS;

    const tryClient = (client) => new Promise((resolve, reject) => {
        const channel = new MessageChannel();
        const timeout = setTimeout(() => {
            reject(new Error('navi:call request timed out'));
        }, timeoutMs);

        channel.port1.onmessage = (event) => {
            clearTimeout(timeout);
            const data = event.data;
            if (!data || !data.ok) {
                reject(new Error(data?.error || 'navi:call failed'));
                return;
            }
            resolve(data.result);
        };

        client.postMessage({
            type: NAVI_CALL,
            path,
            args,
        }, [channel.port2]);
    });

    const attemptList = (clients) => {
        const ordered = orderClients(clients);
        if (!ordered.length) {
            return Promise.reject(new Error('No window client available for navi:call'));
        }
        let lastError;
        const attempt = (index) => {
            if (index >= ordered.length) {
                return Promise.reject(
                    lastError || new Error('No client could handle navi:call')
                );
            }
            // Handlers: only try the best client — cascading timeouts × tabs was
            // the 10s×N spam when snoopy observed bursts of hx-get.
            if (isHandler && index > 0) {
                return Promise.reject(
                    lastError || new Error('No client could handle navi:call')
                );
            }
            return tryClient(ordered[index]).catch((err) => {
                lastError = err;
                return attempt(index + 1);
            });
        };
        return attempt(0);
    };

    return self.clients
        .matchAll({ type: 'window', includeUncontrolled: false })
        .then((controlled) => {
            if (controlled.length) return attemptList(controlled);
            return self.clients
                .matchAll({ type: 'window', includeUncontrolled: true })
                .then(attemptList);
        });
}

function swCallout(message) {
    return requestNaviCall(['callout'], [`[sw] ${message}`]).catch(() => {});
}

function htmlEscape(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function isTextyMime(mime) {
    const t = String(mime || '')
        .split(';')[0]
        .trim()
        .toLowerCase();
    return (
        !t ||
        t === 'text/plain' ||
        t === 'text/json' ||
        t === 'application/json' ||
        t === 'application/javascript' ||
        t === 'text/javascript'
    );
}

/**
 * Document navigations to /navi/* would otherwise be Chrome/Edge's dark
 * word-wrapped <pre> around text/plain. We own the HTML for that case.
 * fetch/XHR keeps the raw body + mime.
 */
function naviParkHtmlDocument(ib, kind, body) {
    const title = htmlEscape(ib || 'navi');
    const k = kind ? htmlEscape(kind) : '';
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0;
    font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  header {
    padding: 0.55rem 1rem;
    border-bottom: 1px solid CanvasText;
    font-size: 12px;
    opacity: 0.65;
  }
  pre {
    margin: 0;
    padding: 1rem;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
</style>
</head>
<body>
<header>${title}${k ? ' · ' + k : ''}</header>
<pre>${htmlEscape(body)}</pre>
<script src="/navi_shell.js"></script>
</body>
</html>`;
}

function naviParkResponse(event, opts) {
    const status = opts.status || 200;
    const ib = opts.ib || '';
    const kind = opts.kind || '';
    const unit = opts.unit || '';
    const body = opts.body == null ? '' : String(opts.body);
    const mime = opts.mime || 'text/plain; charset=utf-8';
    const headers = {
        'X-Navi-Park-Ib': ib,
        'X-Navi-Park-Kind': kind,
        'X-Navi-Unit': unit,
    };
    if (isDocumentNavigation(event.request) && isTextyMime(mime)) {
        headers['Content-Type'] = 'text/html; charset=utf-8';
        return new Response(naviParkHtmlDocument(ib, kind, body), {
            status,
            headers,
        });
    }
    headers['Content-Type'] = mime;
    return new Response(body, { status, headers });
}

function isGatePassthruHeader(value) {
    const s = String(value || '')
        .trim()
        .toLowerCase();
    return s === '1' || s === 'true' || s === 'yes';
}

/** Host-pin / tip-API fetches must not re-enter park-before-network. */
function wantsParkBypass(request) {
    return isGatePassthruHeader(
        request.headers.get('X-Navi-Park-Bypass') ||
            request.headers.get('x-navi-park-bypass')
    );
}

function parkCheckCallArgs(event, pathOrKey) {
    const gatePassthru = isGatePassthruHeader(
        event.request.headers.get('X-Navi-Gate-Passthru')
    );
    if (gatePassthru) {
        return [pathOrKey, { gatePassthru: true }];
    }
    return [pathOrKey];
}

function responseFromNaviPark(event, pathOrKey) {
    const urlPath = new URL(event.request.url).pathname;
    return requestNaviCall(['park', 'check'], parkCheckCallArgs(event, pathOrKey))
        .then((result) => {
            if (result && result.hit) {
                swCallout(
                    `park ${urlPath} → ${result.ib} kind=${result.kind} ok`
                );
                return naviParkResponse(event, {
                    status: 200,
                    ib: result.ib,
                    kind: result.kind,
                    unit: result.unit || '',
                    body: result.body,
                    mime: result.mime || 'application/octet-stream',
                });
            }
            // Contract-bearing miss: the tip declares an http.kind (mod/admin/
            // frame/bin) but won't serve as a passive GET (e.g. mod dispatch
            // failed, admin park). Do NOT fall through to the file shim — that
            // would serve the module source out from under the kind contract.
            if (result && result.kind) {
                const reason = result.reason || `kind=${result.kind} not servable`;
                swCallout(
                    `park ${urlPath} → ${result.ib || ''} ${reason}`
                );
                return naviParkResponse(event, {
                    status: 404,
                    ib: result.ib || urlPath,
                    kind: result.kind,
                    unit: result.unit || '',
                    body: `navi park ${result.ib || urlPath}: ${reason}`,
                });
            }
            return null;
        })
        .catch((err) => {
            const msg = err && err.message ? err.message : String(err);
            swCallout(`park ${urlPath} error: ${msg}`);
            return naviParkResponse(event, {
                status: 502,
                ib: urlPath,
                unit: '',
                body: `navi park check failed: ${msg}`,
            });
        });
}

/**
 * Park-check before network for same-origin GET.
 * Miss / no client → null (caller continues to plugins / network).
 */
function tryParkBeforeNetwork(event) {
    const pathname = new URL(event.request.url).pathname;
    return requestNaviCall(['park', 'check'], parkCheckCallArgs(event, pathname))
        .then((result) => {
            if (!result || !result.hit) return null;
            swCallout(
                `park-before-network ${pathname} → ${result.ib} (${result.kind})`
            );
            return new Response(result.body, {
                status: 200,
                headers: {
                    'Content-Type': result.mime || 'application/octet-stream',
                    'X-Navi-Park-Ib': result.ib || '',
                    'X-Navi-Park-Kind': result.kind || '',
                    'X-Navi-Unit': result.unit || '',
                },
            });
        })
        .catch(() => null);
}

function responseFromNaviStorage(event, storagePath) {
    return responseFromNaviPark(event, storagePath);
}

function tryPluginFetch(event) {
    for (const plugin of plugins.values()) {
        if (typeof plugin.handleFetch === 'function' && plugin.handleFetch(event)) {
            return true;
        }
    }
    return false;
}

/** True for top-level document navigations (foobarch shell Sec-Fetch gate). */
function isDocumentNavigation(request) {
    if (request.mode === 'navigate' || request.destination === 'document') {
        return true;
    }
    try {
        const mode = request.headers.get('Sec-Fetch-Mode');
        const dest = request.headers.get('Sec-Fetch-Dest');
        if (mode === 'navigate' || dest === 'document') return true;
    } catch (_) {
        /* ignore */
    }
    return false;
}

function hasFetchObservers() {
    // Until hydration settles, route the fetch through respondWithObserved so
    // the first request after an idle SW restart cannot outrun plugin restore.
    if (!pluginsHydrated) return true;
    for (const plugin of plugins.values()) {
        if (typeof plugin.observeFetch === 'function' || typeof plugin.observeFetchError === 'function') {
            return true;
        }
    }
    return false;
}

/**
 * respondWith + observeFetch without racing the body stream.
 * Clone for each observer in the same turn the Response arrives, then return
 * the original to the client. Parallel observePluginFetch(responsePromise) races
 * respondWith and hits "Response body is already used" on clone().
 */
function respondWithObserved(event, responsePromise) {
    event.respondWith(
        Promise.all([pluginsReady, Promise.resolve(responsePromise)]).then(
            ([, response]) => {
                const jobs = [];
                for (const plugin of plugins.values()) {
                    if (typeof plugin.observeFetch !== 'function') continue;
                    let cloned;
                    try {
                        cloned = response.clone();
                    } catch (err) {
                        console.warn(
                            '[sw] fetch observer clone failed:',
                            err && err.message ? err.message : err
                        );
                        continue;
                    }
                    jobs.push(
                        Promise.resolve(plugin.observeFetch(event, cloned)).catch((err) => {
                            // Do not swCallout here — that is another navi:call and
                            // amplifies timeouts when the page bridge is busy/missing.
                            console.warn(
                                '[sw] fetch observer failed:',
                                err && err.message ? err.message : err
                            );
                        })
                    );
                }
                if (jobs.length) event.waitUntil(Promise.all(jobs));
                return response;
            },
            (error) => {
                const jobs = [...plugins.values()].map((plugin) => {
                    if (typeof plugin.observeFetchError !== 'function') return undefined;
                    return Promise.resolve(plugin.observeFetchError(event, error)).catch(
                        (err) => {
                            console.warn(
                                '[sw] fetch observer error-hook failed:',
                                err && err.message ? err.message : err
                            );
                        }
                    );
                });
                event.waitUntil(Promise.all(jobs));
                // Avoid uncaught "FetchEvent … promise was rejected" / Failed to fetch
                // when observe-only re-fetch fails (offline, aborted, etc.).
                const msg = error && error.message ? error.message : String(error || 'fetch failed');
                return new Response(`Service worker fetch failed: ${msg}`, {
                    status: 502,
                    statusText: 'Bad Gateway',
                    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
                });
            }
        )
    );
}

// --- Messages from page / navi_shell ---

self.addEventListener('message', event => {
    const data = event.data;
    if (!data || typeof data.type !== 'string') {
        return;
    }

    const reply = (payload) => {
        if (data.expectResponse && event.ports && event.ports[0]) {
            event.ports[0].postMessage(payload);
        }
    };

    switch (data.type) {
        case 'REGISTER_PLUGIN': {
            const id = data.id;
            const url = data.url;
            if (!id || !url) {
                reply({ ok: false, error: 'REGISTER_PLUGIN requires id and url' });
                return;
            }
            const job = pluginsReady.then(async () => {
                try {
                    importPluginUrl(id, url);
                    await persistPluginDescriptor(id, { kind: 'url', url });
                    reply({ ok: true, id, plugins: listFoobarchPlugins() });
                    swCallout(`plugin registered: ${id} from ${url}`);
                } catch (err) {
                    reply({ ok: false, error: String(err.message || err) });
                    swCallout(`plugin register failed (${id}): ${err.message || err}`);
                }
            });
            event.waitUntil(job);
            break;
        }
        case 'REGISTER_PLUGIN_SOURCE': {
            const id = data.id;
            const source = data.source;
            if (!id || typeof source !== 'string' || !source.trim()) {
                reply({ ok: false, error: 'REGISTER_PLUGIN_SOURCE requires id and source' });
                return;
            }
            const job = pluginsReady.then(async () => {
                try {
                    evaluatePluginSource(id, source);
                    await persistPluginDescriptor(id, { kind: 'source', source });
                    reply({ ok: true, id, plugins: listFoobarchPlugins() });
                    swCallout(`plugin registered from Navi source: ${id}`);
                } catch (err) {
                    unregisterFoobarchPlugin(id);
                    reply({ ok: false, error: String(err.message || err) });
                    swCallout(`plugin source register failed (${id}): ${err.message || err}`);
                }
            });
            event.waitUntil(job);
            break;
        }
        case 'UNREGISTER_PLUGIN': {
            if (!data.id) {
                reply({ ok: false, error: 'UNREGISTER_PLUGIN requires id' });
                return;
            }
            const job = pluginsReady.then(async () => {
                unregisterFoobarchPlugin(data.id);
                await deletePluginDescriptor(data.id);
                reply({ ok: true, id: data.id, plugins: listFoobarchPlugins() });
                swCallout(`plugin unregistered: ${data.id}`);
            }).catch((err) => {
                reply({ ok: false, error: String(err.message || err) });
            });
            event.waitUntil(job);
            break;
        }
        case 'LIST_PLUGINS': {
            const job = pluginsReady.then(() => {
                reply({ ok: true, plugins: listFoobarchPlugins() });
            });
            event.waitUntil(job);
            break;
        }
        case 'PLUGIN_MESSAGE': {
            const job = pluginsReady.then(() => {
                const plugin = plugins.get(data.id);
                if (!plugin || typeof plugin.onMessage !== 'function') {
                    throw new Error(`no plugin or onMessage for id: ${data.id}`);
                }
                return plugin.onMessage(data.payload, event);
            })
                .then((result) => reply({ ok: true, result }))
                .catch((err) => reply({ ok: false, error: String(err.message || err) }));
            event.waitUntil(job);
            break;
        }
        case 'NAVI_PWA_MANIFEST': {
            Promise.resolve(setPwaManifestOverride(data.manifestJson ?? data.manifest ?? null))
                .then(() =>
                    reply({
                        ok: true,
                        active: pwaManifestOverrideJson != null,
                    })
                )
                .catch((err) => reply({ ok: false, error: String(err.message || err) }));
            break;
        }
        case 'NAVI_SHELL_CACHE': {
            const action = String(data.action || 'status').trim().toLowerCase();
            const job = (async () => {
                if (action === 'status' || action === 'list') {
                    return { ok: true, ...(await listShellCache()) };
                }
                if (action === 'refresh' || action === 'update') {
                    return { ok: true, ...(await refreshShellCache(data.urls)) };
                }
                if (action === 'warm') {
                    const urls =
                        Array.isArray(data.urls) && data.urls.length
                            ? data.urls
                            : data.url
                              ? [data.url]
                              : [];
                    return { ok: true, ...(await warmOfflineDocs(urls)) };
                }
                if (action === 'put' || action === 'set') {
                    return {
                        ok: true,
                        ...(await putShellCacheEntry(
                            data.url,
                            data.body,
                            data.contentType || data.mime
                        )),
                    };
                }
                if (action === 'delete' || action === 'remove') {
                    if (!data.url) throw new Error('delete requires url');
                    return { ok: true, ...(await deleteOfflineDoc(data.url)) };
                }
                if (action === 'clear' || action === 'delete_all') {
                    return { ok: true, ...(await clearShellCache()) };
                }
                throw new Error(
                    `NAVI_SHELL_CACHE unknown action '${action}' (status|refresh|warm|put|delete|clear)`
                );
            })()
                .then((payload) => reply(payload))
                .catch((err) =>
                    reply({ ok: false, error: String(err.message || err) })
                );
            event.waitUntil(job);
            break;
        }
        default:
            break;
    }
});

self.addEventListener('install', (event) => {
    swCallout('installing');
    // Best-effort precache while installing (needs network).
    event.waitUntil(
        refreshShellCache(SHELL_DEFAULT_URLS)
            .then((r) => {
                const ok = (r.results || []).filter((x) => x.ok).length;
                swCallout(`shell cache install: ${ok}/${(r.results || []).length}`);
            })
            .catch((err) => {
                swCallout(`shell cache install skipped: ${err.message || err}`);
            })
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        (async () => {
            try {
                const names = await caches.keys();
                await Promise.all(
                    names
                        .filter(
                            (name) =>
                                name !== PWA_MANIFEST_CACHE &&
                                name !== PLUGIN_CACHE &&
                                name !== SHELL_CACHE &&
                                name !== OFFLINE_DOC_CACHE
                        )
                        .concat(['foobarch-shell-v1'])
                        .map((name) => caches.delete(name))
                );
                await pruneShellCacheToRuntimeOnly();
                await pluginsReady;
                await loadPwaManifestOverride();
                swCallout('activated — legacy caches cleared (shell + offline doc caches kept)');
            } catch (err) {
                swCallout(`activate failed: ${err.message || err}`);
            }
        })()
    );
    self.clients.claim();
});

// Document navigations: network-first, then offline-doc cache (never trust navigator.onLine).
// Successful navigations warm OFFLINE_DOC_CACHE; unreachable host still boots from cache.
// /navi_shell.js → network-first runtime cache (offline fallback).
// Never park-check shell statics — navi_shell.js must load before park.check works.
self.addEventListener('fetch', event => {
    // Keep startup alive through registry hydration, including when the wake-up
    // event is a document navigation that this SW intentionally does not claim.
    event.waitUntil(pluginsReady);
    const requestUrl = new URL(event.request.url);
    if (event.request.method === 'GET' && requestUrl.hostname === self.location.hostname) {
        const pathname = requestUrl.pathname;
        const isDoc = isDocumentNavigation(event.request);

        // navi.pwa.set overlay — must stay same-origin (blob: breaks Chromium install).
        if (pathname === PWA_MANIFEST_PATH && pwaManifestOverrideJson != null) {
            const res = Promise.resolve(pwaManifestResponse(pwaManifestOverrideJson));
            if (hasFetchObservers() && !isDoc) {
                respondWithObserved(event, res);
            } else {
                event.respondWith(res);
            }
            return;
        }

        if (isShellRuntimePath(pathname)) {
            const res = networkFirstRuntime(event.request, pathname);
            if (hasFetchObservers() && !isDoc) {
                respondWithObserved(event, res);
            } else {
                event.respondWith(res);
            }
            return;
        }

        if (isShellStaticPath(pathname)) {
            if (hasFetchObservers() && !isDoc) {
                respondWithObserved(event, fetch(event.request));
            }
            return;
        }

        const respond = (responsePromise) => {
            if (!isDoc && hasFetchObservers()) {
                respondWithObserved(event, responsePromise);
            } else {
                event.respondWith(responsePromise);
            }
        };

        if (isDoc) {
            // Always intercept: network-first + cache fallback. "Online" ≠ reachable.
            event.respondWith(offlineDocumentResponse(event.request, pathname));
            return;
        }

        // Non-document same-origin GET: park tip wins, else network.
        // Former exclusive /navi/* local-404 branch removed — miss falls through.
        // X-Navi-Park-Bypass: host pin / tip API must not re-enter park.check.
        respond(
            wantsParkBypass(event.request)
                ? fetch(event.request)
                : tryParkBeforeNetwork(event).then((local) => {
                      if (local) return local;
                      return fetch(event.request);
                  })
        );
        return;
    }

    if (hasFetchObservers() && !isDocumentNavigation(event.request)) {
        respondWithObserved(event, fetch(event.request));
    }
});
