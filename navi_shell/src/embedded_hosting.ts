import EventEmitter from 'eventemitter3';
import {
    NAVI_INIT_SCRIPT_IB,
    NAVI_MOD_INDEX_IB,
    NAVI_ROOT_IB,
    NAVI_SURF_IB,
    NAVI_STORAGE_IB,
    NAVI_RELAY_IB,
    NAVI_RELAY_LOG_IB,
    NAVI_CALLIN_IB,
    NAVI_UNIT_SYSTEM_IB,
    NAVI_REDUX_SEED_TIPS,
    canonicalizeTipIb,
    moduleParkIb,
    normalizeTipIb,
    presumeNaviIb,
    relativeNaviKey,
    storageFileTipIb,
    storageItemTipIb,
    unitParkIb,
    ibSegments,
    isAbsoluteHttpUrl,
    liveDelimiterHits,
    tipIbsMatch,
    slashJoinedIb,
    isTipGateTrue,
    parkMethodBlock,
    parkMethodCommands,
    parkMethodCtrl,
    selectParkBinRef,
    defaultModuleCommand,
    moduleCommandsForTransport,
    normalizeParkMethod,
    isStrictParkMethod,
    type ParkMethod,
    type NaviTipFrame,
} from './navi_redux_seeds';
import {
    walkTipLineage as walkTipLineageImpl,
    tipSpan as tipSpanImpl,
    tipSpanDiff as tipSpanDiffImpl,
    unitSystemInteriorDrop,
    type TipSpanDir,
    type TipSpanOpts,
    type TipSpanHit,
    type TipSpanDiffOpts,
    type TipSpanDiffResult,
    type TipSpanDelta,
} from './tip_span';
export type {
    TipSpanDir,
    TipSpanOpts,
    TipSpanHit,
    TipSpanDiffOpts,
    TipSpanDiffResult,
    TipSpanDelta,
};
export type ParkCheckOpts = {
    gatePassthru?: boolean;
};

export type GetTipOpts = {
    gatePassthru?: boolean;
};

/** How a park path entered the resolver (method + origin). */
export type ParkDispatchOpts = {
    method: ParkMethod;
    /** Host relay WS forwarded this path (URL navigation on the host → shell). */
    viaRelay?: boolean;
    /** Entered through dispatchCallin (URL GET, local POST, or relay). */
    callin?: boolean;
};

export interface Message {
    type: string;
    id: string;
    data?: any;
    error?: string;
}

/**
 * Hello World Welcome to Navi via (navi_shell)
 * A Hypermedia Client within a Progressive Web App + App Programming Interface.
 * This copy is brought to you in part by users like you
 * We will be connecting to Foobarch at https://foobarch.net
 */

const NAVI_ORIGIN = 'https://foobarch.net';
const DEFAULT_RELAY_EXPIRES_SEC = 86_400;
const RELAY_KEEPALIVE_MS = 45_000;
/** Hosts that charge for relay connect answer the hello with a welcome within this window. */
const RELAY_WELCOME_MS = 15_000;
const TOKEN_STASH_IB = 'tokens';
/** Host 3rd-case payment: rel8ns key the reserve tip is stored under. */
const TOKEN_RESERVE_REL = 'foobarch.token_reserve';

function noTokens(where: string): never {
    const err = new Error(
        `no usage tokens for ${where} — relay tokens add <token…> (or request some via hypertext/intro)`
    );
    (err as any).code = 'NO_TOKENS';
    throw err;
}

/** Park path as the relay whitelist compares it: no query, no leading/trailing or doubled slashes. */
function relayWhitelistNorm(raw: unknown): string {
    let s = String(raw ?? '').trim().split(/[?#]/)[0];
    try {
        s = decodeURIComponent(s);
    } catch {
        /* keep raw */
    }
    return s.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, '');
}
const RELAY_RECONNECT_BASE_MS = 2_000;
const RELAY_RECONNECT_MAX_MS = 60_000;

export type NaviStampInput = Date | number | string | undefined;
export type NaviStamp = {
    timestamp: string;
    uuid: string;
};

/** Public entry-plug view fields */
export type EntryPlugView = {
    kind: 'surface';
    target: 'plug';
    bound: boolean;
    unitIb: string | null;
    unitId?: string;
    hash?: string;
    stamp?: NaviStamp;
    last_seen?: string;
    created?: boolean;
    access?: Record<string, string>;
    publicKey: string;
    alg: 'Ed25519';
    signature: string;
    signed: string;
    proof: {
        scheme: 'Ed25519-detached';
        signed_by: 'entry-plug private key';
        verify_with: 'publicKey';
        note: string;
    };
};

type EntryPlugSecret = {
    privateKey: CryptoKey | { type: string; asymmetricKeyType?: string };
    publicKeyRaw: string;
    backend: 'subtle' | 'node';
    subtlePublic?: CryptoKey;
    nodePublic?: { type: string; asymmetricKeyType?: string };
};

const ENTRY_PLUG_PROOF_NOTE =
    'Detached Ed25519 signature made with the in-memory entry-plug private key (non-extractable). Verify with publicKey; publicKey cannot produce this signature.';

function bytesToBase64Url(bytes: Uint8Array): string {
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
    const b64 =
        typeof btoa === 'function'
            ? btoa(bin)
            : Buffer.from(bytes).toString('base64');
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function stableJson(value: unknown): string {
    const walk = (v: any): any => {
        if (v == null || typeof v !== 'object') return v;
        if (Array.isArray(v)) return v.map(walk);
        const out: Record<string, any> = {};
        for (const k of Object.keys(v).sort()) out[k] = walk(v[k]);
        return out;
    };
    return JSON.stringify(walk(value));
}

/** Offset-local ISO-8601, preserving the writer's wall time and UTC offset. */
export function naviStampTime(when?: NaviStampInput): string {
    const date =
        when instanceof Date
            ? new Date(when.getTime())
            : when === undefined
              ? new Date()
              : new Date(when);
    if (Number.isNaN(date.getTime())) {
        throw new Error('[navi-error] navi.stamp.time requires a valid date');
    }

    const offsetMinutes = -date.getTimezoneOffset();
    const localIso = new Date(
        date.getTime() + offsetMinutes * 60_000
    ).toISOString().slice(0, -1);
    const sign = offsetMinutes >= 0 ? '+' : '-';
    const absoluteOffset = Math.abs(offsetMinutes);
    const hours = String(Math.floor(absoluteOffset / 60)).padStart(2, '0');
    const minutes = String(absoluteOffset % 60).padStart(2, '0');
    return `${localIso}${sign}${hours}:${minutes}`;
}

/** RFC 4122 version-4 UUID for local identity markers (not content identity). */
export function naviStampUuid(): string {
    const cryptoApi = globalThis.crypto;
    if (typeof cryptoApi?.randomUUID === 'function') {
        return cryptoApi.randomUUID();
    }

    const bytes = new Uint8Array(16);
    if (typeof cryptoApi?.getRandomValues === 'function') {
        cryptoApi.getRandomValues(bytes);
    } else {
        for (let i = 0; i < bytes.length; i++) {
            bytes[i] = Math.floor(Math.random() * 256);
        }
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
    return [
        hex.slice(0, 4).join(''),
        hex.slice(4, 6).join(''),
        hex.slice(6, 8).join(''),
        hex.slice(8, 10).join(''),
        hex.slice(10, 16).join(''),
    ].join('-');
}

export function naviStamp(when?: NaviStampInput): NaviStamp {
    return {
        timestamp: naviStampTime(when),
        uuid: naviStampUuid(),
    };
}

naviStamp.time = naviStampTime;
naviStamp.uuid = naviStampUuid;

function isStampPlaceholder(value: unknown): boolean {
    const s = String(value ?? '').trim();
    return /^<navi\.stamp\.\w+\(\)>$/.test(s);
}

function resolveStampedUuid(raw: unknown): string {
    const s = String(raw ?? '').trim();
    return s && !isStampPlaceholder(s) ? s : '';
}

/**
 * PWA Capabilities
 */
export interface NaviPwaConfig {
    name?: string;
    short_name?: string;
    description?: string;
    start_url?: string;
    scope?: string;
    display?: 'fullscreen' | 'standalone' | 'minimal-ui' | 'browser';
    background_color?: string;
    theme_color?: string;
    lang?: string;
    icons?: NaviPwaIcon[];
    orientation?: string;
    id?: string;
    title?: string;
    apple_mobile_web_app_title?: string;
    apple_mobile_web_app_capable?: boolean;
    replace_url?: boolean | string;
}

export interface NaviPwaIcon {
    src: string;
    sizes?: string;
    type?: string;
    purpose?: string;
}

const FOOBARCH_PWA_DEFAULTS: NaviPwaConfig = {
    name: 'Foobarch',
    short_name: 'Foobarch',
    description: 'Foobarch Network Client',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#ffffff',
    lang: 'en',
    id: '/',
    icons: [
        {
            src: '/manifest.json/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
        },
        {
            src: '/manifest.json/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
        },
    ],
};

const PWA_MANAGED_ATTR = 'data-navi-pwa-managed';

function normalizePwaAssetUrl(src: string): string {
    const trimmed = String(src ?? '').trim();
    if (!trimmed) {
        return trimmed;
    }
    if (/^(https?:|data:|blob:)/i.test(trimmed)) {
        return trimmed;
    }
    if (typeof window !== 'undefined' && window.location && window.location.origin && window.location.origin !== 'null') {
        try {
            return new URL(trimmed, window.location.origin).href;
        } catch {
            // fall through to root-relative
        }
    }
    return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function buildWebManifest(config: NaviPwaConfig): Record<string, unknown> {
    const manifest: Record<string, unknown> = {};
    const fields: (keyof NaviPwaConfig)[] = [
        'name',
        'short_name',
        'description',
        'start_url',
        'scope',
        'display',
        'background_color',
        'theme_color',
        'lang',
        'orientation',
        'id',
    ];

    const urlFields = new Set<keyof NaviPwaConfig>(['start_url', 'scope', 'id']);
    for (const field of fields) {
        const value = config[field];
        if (value !== undefined && value !== null && value !== '') {
            manifest[field] = urlFields.has(field) && typeof value === 'string'
                ? normalizePwaAssetUrl(value)
                : value;
        }
    }

    if (Array.isArray(config.icons) && config.icons.length > 0) {
        manifest.icons = config.icons.map((icon) => ({
            ...icon,
            src: normalizePwaAssetUrl(icon.src),
        }));
    }

    return manifest;
}

function pickAppleTouchIcon(icons: NaviPwaIcon[] | undefined): NaviPwaIcon | null {
    if (!icons || icons.length === 0) {
        return null;
    }

    const pngIcons = icons.filter((icon) => {
        const type = String(icon.type ?? '').toLowerCase();
        const src = String(icon.src ?? '').toLowerCase();
        return type.includes('png') || src.endsWith('.png');
    });

    const candidates = pngIcons.length > 0 ? pngIcons : icons;
    const ranked = [...candidates].sort((a, b) => {
        const largest = (sizes?: string) => {
            const match = String(sizes ?? '').match(/(\d+)\s*x\s*(\d+)/i);
            return match ? Number(match[1]) : 0;
        };
        return largest(b.sizes) - largest(a.sizes);
    });

    return ranked[0] ?? null;
}

function isBrowserDocument(): boolean {
    return typeof window !== 'undefined' && typeof document !== 'undefined';
}

const NAVI_STANDALONE_MQ =
    '(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)';
const NAVI_DESKTOP_POINTER_MQ = '(hover: hover) and (pointer: fine)';
const NAVI_VIEWPORT_ORIG_ATTR = 'data-navi-viewport-orig';
let naviMobileViewportBound = false;

function isStandalonePwa(): boolean {
    if (!isBrowserDocument()) {
        return false;
    }
    if (typeof window.matchMedia === 'function') {
        if (window.matchMedia(NAVI_STANDALONE_MQ).matches) {
            return true;
        }
    }
    return (window.navigator as any).standalone === true;
}

function isDesktopPointer(): boolean {
    if (!isBrowserDocument() || typeof window.matchMedia !== 'function') {
        return false;
    }
    return window.matchMedia(NAVI_DESKTOP_POINTER_MQ).matches;
}

/** Installed mobile PWA only — not the in-tab browser, not desktop. */
function shouldFitPwaViewport(): boolean {
    return isStandalonePwa() && !isDesktopPointer();
}

function viewportMeta(): HTMLMetaElement | null {
    if (!isBrowserDocument() || !document.head) {
        return null;
    }
    return document.head.querySelector('meta[name="viewport"]');
}

function withoutCoverFit(content: string): string {
    const raw = String(content || '').trim();
    if (!raw) {
        return 'width=device-width, initial-scale=1, viewport-fit=auto';
    }
    if (/viewport-fit\s*=/i.test(raw)) {
        return raw.replace(/viewport-fit\s*=\s*cover/gi, 'viewport-fit=auto');
    }
    return `${raw}, viewport-fit=auto`;
}

/**
 * Homescreen PWA: drop viewport-fit=cover so 100vh / min-height:100vh
 * use the safe layout hole. Cover is what paints under the home/gesture bar;
 * any artifact using vh then inherits the same cutoff. No per-name clamps.
 * Does not bind visualViewport (keyboard must not shrink the document).
 */
function applyNaviMobileViewport(): void {
    if (!isBrowserDocument() || !document.head) {
        return;
    }

    const sync = () => {
        let meta = viewportMeta();
        if (!meta) {
            meta = document.createElement('meta');
            meta.setAttribute('name', 'viewport');
            document.head.appendChild(meta);
        }
        if (!meta.getAttribute(NAVI_VIEWPORT_ORIG_ATTR)) {
            meta.setAttribute(
                NAVI_VIEWPORT_ORIG_ATTR,
                meta.getAttribute('content') || ''
            );
        }
        const orig = meta.getAttribute(NAVI_VIEWPORT_ORIG_ATTR) || '';
        meta.setAttribute(
            'content',
            shouldFitPwaViewport() ? withoutCoverFit(orig) : orig
        );
    };

    if (!naviMobileViewportBound) {
        naviMobileViewportBound = true;
        for (const q of [NAVI_STANDALONE_MQ, NAVI_DESKTOP_POINTER_MQ]) {
            const mq = window.matchMedia(q);
            if (typeof mq.addEventListener === 'function') {
                mq.addEventListener('change', sync);
            } else if (typeof (mq as MediaQueryList).addListener === 'function') {
                (mq as MediaQueryList).addListener(sync);
            }
        }
    }
    sync();
}

function isNodeRuntime(): boolean {
    return typeof process !== 'undefined'
        && !!(process as any).versions?.node
        && (typeof window === 'undefined' || typeof document === 'undefined');
}

function isLocalnaviExe(): boolean {
    return isNodeRuntime() && (process.env.NAVI_LOCALNAVI === '1' || process.env.NAVI_NATIVE === '1');
}


/**
 * Options for navi.storage.tip.mut8(ib, dataPatch, opts)
 */
export type Mut8TipOpts = {
    /** Replace tip.data with dataPatch instead of shallow-merge */
    replaceData?: boolean;
    /**
     * Merge into tip.rel8ns. Auto `past←prior` unless `past` is explicitly set
     * to a value that differs from the tip's current past (so spreading
     * `...tip.rel8ns` does not suppress lineage). Pass a new `past` (including
     * `past: []`) only when intentionally retargeting or breaking the chain.
     */
    rel8ns?: Record<string, any>;
    /**
     * Create the tip when missing. `true` = empty seed; object seeds initial
     * data/rel8ns before applying dataPatch.
     */
    create?:
        | boolean
        | {
              data?: Record<string, any>;
              rel8ns?: Record<string, any>;
          };
};

    /** Localnavi stdin takeover layer (`navi.repl.push` / `pop`). */
export type NaviReplLayer = {
    prompt: string;
    onLine: (line: string) => void | Promise<void>;
};

/**
 * Uniform front door into the park pipe.
 * Path/text segments are the address; method/headers/body are the HTTP multiplex.
 * Default method is POST (local `navi('…')`). Direct URL / SW park inherit GET.
 * Host relay always enters here with viaRelay: true.
 */
export type NaviCallinRequest = {
    method: ParkMethod;
    headers: Record<string, string>;
    body: string;
    viaRelay: boolean;
    /**
     * When true (default for user callin / relay), local tip miss may pin
     * hostpark. park.check must set false — SW park-before-network is local only;
     * host tip fetch of the same path re-enters the SW and loops.
     */
    hostPin?: boolean;
    /**
     * Skip localpark tip/capture and force hostpark pin (refresh local tip+bin).
     * Set from callin header X-Navi-Park-Bypass: 1 (same name as SW fetch bypass).
     */
    parkBypass?: boolean;
    /** Relay alias the call arrived on (navi-{alias}); host already checked its token. */
    relayAlias?: string;
    /** Normalized park path */
    path: string;
};

/** Input to `navi.callin` / `dispatchCallin` */
/** POST bin content type that navi runs through navi.script(). */
const NAVI_SCRIPT_MIME = 'application/navi-script';
const NAVI_SCRIPT_MAX_DEPTH = 8;

/**
 * Turn a navi-script bin into navi.script() commands.
 * JS: the whole remaining text is one program (full-line `#` / `//` dropped).
 * Callin: one POST path per remaining line.
 */
function naviScriptFromBin(media: string, mode: 'js' | 'callin'): string[] {
    const raw = String(media ?? '')
        .replace(/^\uFEFF/, '')
        .replace(/\r\n/g, '\n');
    const kept: string[] = [];
    for (const line of raw.split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#') || t.startsWith('//')) continue;
        kept.push(mode === 'callin' ? t : line.replace(/\s+$/, ''));
    }
    if (mode === 'callin') return kept;
    const body = kept.join('\n').trim();
    return body ? [body] : [];
}

export type NaviScriptOpts = {
    /** 'js' (default): each array entry is a JS program (newlines ok). 'callin': each entry is a POST path. */
    mode?: 'js' | 'callin';
    /** callin mode substitutes $1..$n / $@; JS lines see `args`, `$1`..`$9`. */
    args?: string[];
    /** Default 'continue' (each line independent); 'stop' throws on first failure. */
    onError?: 'continue' | 'stop';
    viaRelay?: boolean;
    /** Shown in callouts / errors (e.g. the frame ib). */
    label?: string;
};

export type NaviScriptResult = {
    ran: number;
    results: { line: string; ok: boolean; result?: any; error?: string }[];
};

export type NaviCallinInput =
    | string
    | {
          input?: string;
          path?: string;
          method?: ParkMethod;
          headers?: Record<string, string>;
          body?: string | null;
          viaRelay?: boolean;
          hostPin?: boolean;
          parkBypass?: boolean;
          relayAlias?: string;
};

const SW_NAVI_CALL = 'navi:call';
/** Built-in SW→navi paths (always allowed). Named handlers use path ['handler', name]. */
const SW_ALLOWED_CALLS = new Set([
    'storage.file.load',
    'park.check',
    'callout',
]);

type SwHandlerFn = (...args: any[]) => any | Promise<any>;
type SwHandlerEntry = { handler: SwHandlerFn; owner?: string };

function formatCalloutMessage(data: any): string {
    if (data === undefined || data === null) return String(data);
    if (typeof data === 'string') return data;
    if (data instanceof Error) return data.message || String(data);
    try {
        return JSON.stringify(data);
    } catch {
        return String(data);
    }
}

// Storage backend: tips + tip_frames + bins. Public item/file APIs are tip/bin shims.
interface NaviStorage {
    // tips — key = ib; value is tip pointer { ib, addr, pointer:true }
    //        (legacy rows may still be full frames; Navi.getTip migrates)
    getTip(ib: string): Promise<any>;
    putTip(row: any): Promise<void>;
    deleteTip(ib: string): Promise<void>;
    listTips(): Promise<string[]>;
    // frames — the tip space itself, keyed by ib^gib (every generation)
    getTipFrame(addr: string): Promise<NaviTipFrame | null>;
    putTipFrame(frame: NaviTipFrame): Promise<void>;
    deleteTipFrame(addr: string): Promise<void>;
    /** Optional ib filter — returns addrs (ib^gib). */
    listTipFrames(ib?: string): Promise<string[]>;
    // bins — key = sha256 hex (lowercase)
    getBin(sha: string): Promise<{ media: string; mime: string; sha: string } | null>;
    putBin(
        sha: string,
        record: { media: string; mime: string }
    ): Promise<void>;
    deleteBin(sha: string): Promise<void>;
    listBins(): Promise<string[]>;
}

function toFileRecord(value: any): { media: string; mime: string } {
    if (!value || typeof value !== 'object' || typeof value.media !== 'string') {
        throw new Error('[navi-error] storage.file expects an object { media, mime }');
    }
    const mime = typeof value.mime === 'string' && value.mime ? value.mime : 'text/plain';
    return { media: value.media, mime };
}

function normalizeFileKey(filePath: string): string {
    // Bare paths stay bare; storage.item/file tip ibs are the key/path as given.
    return String(filePath ?? '')
        .trim()
        .replace(/^\/+/, '');
}

type NodeFsPathOs = {
    fs: typeof import('fs').promises;
    join: typeof import('path').join;
    homedir: typeof import('os').homedir;
    tmpdir: typeof import('os').tmpdir;
};

/**
 * Per-callin request context. One shared slot is overwritten when callins
 * overlap across awaits (a relay call could read another call's viaRelay),
 * so localnavi builds scope each callin with AsyncLocalStorage. Browsers have no
 * equivalent; there the slot is re-bound right before mod code runs.
 */
type CallinScope = {
    run<T>(store: NaviCallinRequest, fn: () => T): T;
    getStore(): NaviCallinRequest | undefined;
};

const callinScope: CallinScope | null = (() => {
    if (typeof process === 'undefined' || !process.versions?.node) return null;
    try {
        const { AsyncLocalStorage } = require('async_hooks') as typeof import('async_hooks');
        return new AsyncLocalStorage<NaviCallinRequest>();
    } catch {
        return null;
    }
})();

let nodeFsPathOsPromise: Promise<NodeFsPathOs> | null = null;

function getNodeFsPathOs(): Promise<NodeFsPathOs> {
    if (!nodeFsPathOsPromise) {
        nodeFsPathOsPromise = (async () => {
            const fsMod = require('fs') as typeof import('fs');
            const pathMod = require('path') as typeof import('path');
            const osMod = require('os') as typeof import('os');
            return {
                fs: fsMod.promises,
                join: pathMod.join,
                homedir: osMod.homedir,
                tmpdir: osMod.tmpdir,
            };
        })();
    }
    return nodeFsPathOsPromise;
}

function naviDataDir(join: typeof import('path').join, homedir: typeof import('os').homedir): string {
    // Same on Windows and Linux: ~/.navi_shell
    return join(homedir(), '.navi_shell');
}

/**
 * Localnavi tip maps (tips.json / tip_frames.json) are whole-file RMW.
 * Concurrent mut8 (e.g. meshyrelay state+log, relay advertise) used to
 * clobber each other and drop tip pointers — "no tip frame for park navi".
 * Serialize per path + write via tmp+rename so readers never see half JSON.
 */
const localnaviJsonMapChains = new Map<string, Promise<unknown>>();

function withLocalnaviJsonMapFile<T>(
    path: string,
    fn: () => Promise<T>
): Promise<T> {
    const prev = localnaviJsonMapChains.get(path) || Promise.resolve();
    const run = prev.then(fn, fn);
    localnaviJsonMapChains.set(
        path,
        run.then(
            () => undefined,
            () => undefined
        )
    );
    return run;
}

async function readLocalnaviJsonMap(
    fs: typeof import('fs').promises,
    path: string
): Promise<Record<string, any>> {
    try {
        const raw = await fs.readFile(path, 'utf8');
        if (!String(raw || '').trim()) return {};
        const data = JSON.parse(raw);
        return data && typeof data === 'object' && !Array.isArray(data)
            ? data
            : {};
    } catch {
        return {};
    }
}

async function writeLocalnaviJsonMapAtomic(
    fs: typeof import('fs').promises,
    path: string,
    data: Record<string, any>
): Promise<void> {
    /**
     * Never unlink the live file before the replacement is in place.
     * Old Windows path (unlink dest → rename tmp) could leave tips.json /
     * tip_frames.json missing if rename failed — next RMW then wrote a tiny
     * map over an empty read and permanently dropped tip.frame history while
     * tips.json pointers still pointed at the lost addrs.
     */
    const body = JSON.stringify(data, null, 2);
    const stamp = `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
    const tmp = `${path}.tmp.${stamp}`;
    const bak = `${path}.bak.${stamp}`;
    await fs.writeFile(tmp, body, 'utf8');
    try {
        // Fast path: dest missing (first write) or POSIX replace-on-rename.
        await fs.rename(tmp, path);
                return;
    } catch {
        /* dest exists on Windows, or rename-replace unsupported */
    }
    try {
        // Move live aside, then put new into place. Live is never deleted first.
        try {
            await fs.rename(path, bak);
        } catch {
            /* no live file */
        }
        await fs.rename(tmp, path);
        try {
            await fs.unlink(bak);
        } catch {
            /* keep bak if unlink fails — better than losing data */
        }
    } catch (err) {
        // Best-effort restore if we moved live → bak but failed to install tmp.
        try {
            await fs.access(path);
        } catch {
            try {
                await fs.rename(bak, path);
            } catch {
                /* give up restore */
            }
        }
        try {
            await fs.unlink(tmp);
        } catch {
            /* ignore */
        }
        throw err;
    }
}

async function startLocalnaviRepl(shell: Navi): Promise<void> {
    await shell.runLocalnaviRepl();
}

// Initialize Navi Shell !!!
async function main() {
    try {
        const shell = navi();
        shell.callout('[navi] Starting Navi Shell...');

        shell.on('error', (error: Error) => {
            shell.callout('[navi] Shell error: ' + (error?.message || error));
        });

        if (isLocalnaviExe()) {
            await shell.initialize();
            shell.callout('[navi] Shell ready!');
            await startLocalnaviRepl(shell);
            return;
        }

        shell.on('ready', () => {
            shell.callout('[navi] Shell ready!');
        });
    } catch (error) {
        console.error('[navi] Failed to start Shell:', error);
        if (isLocalnaviExe()) {
            process.exitCode = 1;
        }
    }
}

class Navi extends EventEmitter {
    private static serviceWorkerBridgeRegistered = false;
    private storageImpl: NaviStorage;
    /** One IndexedDB connection — open-per-call queues for minutes in Chromium. */
    private idb: IDBDatabase | null = null;
    private idbOpening: Promise<IDBDatabase> | null = null;
    private pwaBlobUrl: string | null = null;
    private pwaConfig: NaviPwaConfig | null = null;
    /** Bump query on /manifest.json so browsers re-read after navi.pwa.set. */
    private pwaManifestRev = 0;
    private hostManifestHref: string | null = null;
    private swHandlers = new Map<string, SwHandlerEntry>();
    private relayWs: WebSocket | null = null;
    private relayHost = '';
    private relayAlias = '';
    private relayToken = '';
    private relayConnecting = false;
    private relayAutoReconnect = false;
    private relayManualClose = false;
    private relayEverConnected = false;
    private relayReconnectAttempt = 0;
    /** Usage token sent in this socket's hello, until the host's welcome settles it. */
    private relayPay: { ws: WebSocket; host: string; token: string } | null = null;
    private relayWelcomeTimer: ReturnType<typeof setTimeout> | null = null;
    /** Serializes read-modify-write of the token stash tip. */
    private tokenStashChain: Promise<unknown> = Promise.resolve();
    private relayReconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private relayKeepaliveTimer: ReturnType<typeof setInterval> | null = null;
    private relayPageLifecycleBound = false;
    private relayPending = new Map<
        string,
        {
            resolve: (msg: any) => void;
            reject: (err: Error) => void;
            timer: ReturnType<typeof setTimeout>;
        }
    >();
    /**
     * Active callin request (set only while dispatchCallin runs).
     * Modules may read `navi.callinRequest` for method/headers/body/viaRelay.
     */
    private callinSlot: NaviCallinRequest | null = null;

    /** Modules get this instance from register(navi); reads must see their own callin. */
    public get callinRequest(): NaviCallinRequest | null {
        return this.getCallinRequest();
    }

    /** In-flight callin multiplex, or null outside a callin. */
    public getCallinRequest(): NaviCallinRequest | null {
        if (callinScope) return callinScope.getStore() ?? null;
        return this.callinSlot;
    }

    /** Browser fallback: point the shared slot at `req` just before mod code runs. */
    private bindCallinRequest(req: NaviCallinRequest | null | undefined): void {
        if (req && !callinScope) this.callinSlot = req;
    }

    /** Root navi tip uuid — copied onto every locally stamped frame. */
    private installUuid: string | null = null;
    /**
     * Live-only bind of this navi object instance to a unit tip (navi:unit:NN).
     * Not stored in ib space — see A_document/navi_units.html.
     * Never holds private key material (that lives in entryPlugSecret).
     */
    private entryPlug: {
        unitIb: string;
        unitId: string;
        hash: string;
        stamp: NaviStamp;
        last_seen: string;
    } | null = null;
    /**
     * Runtime-only Ed25519 secret for this navi instance. Generated at init.
     * Private key is non-extractable / never attached to plug views or tips.
     */
    private entryPlugSecret: EntryPlugSecret | null = null;
    private unitHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
    /** Request-scoped unit target (explicit path or default resolution). */
    private callUnitIb: string | null = null;
    
    // Canonical origin for resolveUrl / network I/O (default foobarch.net —
    // same for browser and localnavi so navi_shell.exe has a known fetch base).
    public origin: string = NAVI_ORIGIN;

    get stamp() {
        return naviStamp;
    }

    // Module registry system
    private moduleRegistry = new Map<string, any>();
    /** While true, unmount keeps navi:mod ledger rows (multi-pass remount deps). */
    private remountInProgress = false;
    /**
     * Serialize tip mut8 (relay log + mount + unit) so overlapping whole-file
     * RMW on tip_frames.json cannot clobber each other even if file locks slip.
     */
    private tipMut8Chain: Promise<unknown> = Promise.resolve();
    public mod: any = {}; 
    
    // Expose storage API — tip+bin are the space; item/file use bare tip ibs.
    public storage = {
        /** Tip sugar — tip ib = key (normalized), payload in data.value. */
        item: {
            get: (key: string) => this.shimItemGet(key),
            set: (key: string, value: any) => this.shimItemSet(key, value),
            del: (key: string) => this.shimItemDel(key),
            list: (prefix?: string) => this.shimItemList(prefix),
            getPath: (key: string, path: (string | number)[]) =>
                this.getItemByPath(key, path),
            setPath: (
                key: string,
                path: (string | number)[],
                value: any
            ) => this.setItemByPath(key, path, value),
        },
        /** Tip+bin sugar — tip ib = path (normalized) + bin. */
        file: {
            load: (filePath: string) =>
                this.shimFileLoad(normalizeFileKey(filePath)),
            save: (filePath: string, value: any) =>
                this.shimFileSave(normalizeFileKey(filePath), value),
            get: (filePath: string) =>
                this.shimFileGet(normalizeFileKey(filePath)),
            list: (directoryPath?: string) => {
                const raw =
                    directoryPath != null ? String(directoryPath).trim() : '';
                if (!raw) return this.shimFileList();
                return this.shimFileList(normalizeFileKey(raw));
            },
            del: (filePath: string) =>
                this.shimFileDel(normalizeFileKey(filePath)),
        },
        /**
         * Tip space: frames live at ib^gib; tip is only the latest-addr pointer.
         * tip.list() → ibs with a tip pointer. tip.frame → the shared frame space.
         */
        tip: {
            key: (ib: string) => canonicalizeTipIb(ib) || normalizeTipIb(ib),
            get: (ib: string) => this.getTip(ib),
            set: (frame: NaviTipFrame) => this.setTip(frame),
            del: (ib: string) => this.deleteTip(ib),
            list: () => this.listTipIbs(),
            /**
             * Stamp a new generation (same ib, new gib), write it into frame space,
             * point tip at it, past ← prior addr.
             */
            mut8: (
                ib: string,
                dataPatch: Record<string, any> = {},
                opts?: Mut8TipOpts
            ) => this.mut8TipByIb(ib, dataPatch, opts),
            /**
             * Shared frame space (ib^gib). Same records tip.get resolves through
             * the tip pointer — not a separate archive lane.
             */
            frame: {
                get: (addr: string) => this.getTipFrame(addr),
                put: (frame: NaviTipFrame) => this.putTipFrame(frame),
                del: (addr: string) => this.deleteTipFrame(addr),
                list: (ib?: string) => this.listTipFrames(ib),
            },
            /**
             * Walk past-linked generations. reverse = newest first (default).
             * Each hit.frame is one delta — comb/hostpark per addr as needed.
             */
            span: (ib: string, opts?: TipSpanOpts) => this.tipSpan(ib, opts),
            /** Fold deltas across a span (ops/events/parks ledger). */
            spanDiff: (ib: string, opts?: TipSpanDiffOpts) =>
                this.tipSpanDiff(ib, opts),
            /** Full past chain head→root (newest first). */
            lineage: (ib: string) => this.walkTipLineage(ib),
            /** Map bare / navi path → canonical tip ib. */
            presume: (key: string) => presumeNaviIb(key),
        },
        /** Opaque bytes addressed by sha; tip.rel8ns.bin → `bin <sha>`. */
        bin: {
            ref: (sha: string) =>
                `bin ${String(sha || '')
                    .trim()
                    .toLowerCase()}`,
            get: (sha: string) => this.getBin(sha),
            put: (sha: string, record: { media: string; mime: string }) =>
                this.putBin(sha, record),
            /** Hash media and store; returns sha. */
            putMedia: (record: { media: string; mime: string }) =>
                this.putBinMedia(record),
            del: (sha: string) => this.deleteBin(sha),
            list: () => this.listBinShas(),
            /** Load media string from tip.rel8ns.bin[0]. */
            mediaFromTip: (ib: string) => this.loadBinMediaFromTip(ib),
        },
        /**
         * Gated hard erase — confirms, then wipes tip + linked bins from space,
         * ignoring the victim tip's http controls.
         * Remainder segments are rejoined (`:`); delimiter race equates / : space.
         */
        kill: (...parts: Array<string | number | null | undefined>) => {
            const ib = parts
                .map((p) => String(p ?? '').trim())
                .filter((s) => s.length > 0)
                .join(':');
            return this.storageKill(ib);
        },
    };

    /**
     * Usage-token stash (tip `tokens`). Host-level list: data.hosts[origin].unused;
     * path list: data.hosts[origin].paths[path].unused (one token per line). A path
     * only ever reads its own list. Every call is serialized, so two spenders never
     * take the same token.
     *
     * Spend order for `pay`: path list, then host list, then a registered reserve
     * (`data.reserves[origin]` = `ib^gib`, also `rel8ns["foobarch.token_reserve"]`).
     * A reserve pays on the host with no header: `attach` the ref onto the frame.
     * `take` stays header-only (relay connect cannot use a reserve).
     */
    public tokens = {
        count: (host?: string, path?: string) =>
            this.withTokenStash(host, path, (list) => list.length),
        add: (host: string | undefined, tokens: string | string[], path?: string) =>
            this.withTokenStash(host, path, (list) => {
                const incoming = (Array.isArray(tokens) ? tokens : String(tokens || '').split(/\s+/))
                    .map((t) => String(t || '').trim())
                    .filter(Boolean);
                const have = new Set(list);
                let added = 0;
                for (const t of incoming) {
                    if (have.has(t)) continue;
                    have.add(t);
                    list.push(t);
                    added += 1;
                }
                return { added, count: list.length };
            }),
        /** First unused token, left in the stash. */
        look: (host?: string, path?: string) =>
            this.withTokenStash(host, path, (list, where) => list[0] ?? noTokens(where)),
        /** First unused token, removed from the stash (spent unless handed back). */
        take: (host?: string, path?: string) =>
            this.withTokenStash(host, path, (list, where) => list.shift() ?? noTokens(where)),
        /**
         * Header token, or the registered reserve when the lists are empty.
         * Reserve mode sends no X-Foobarch-Usage-Token; call attach(frame, pay).
         */
        pay: (host?: string, path?: string) =>
            this.withTokenStash(host, path, (list, where, reserve) => {
                const token = list.shift();
                if (token) return { mode: 'header' as const, token };
                if (reserve) {
                    const parsed = this.splitReserveAddr(reserve);
                    return {
                        mode: 'reserve' as const,
                        addr: parsed.addr,
                        ib: parsed.ib,
                    };
                }
                return noTokens(where);
            }),
        /** Live reserve addr (`ib^gib`) for this host, or null. */
        reserve: (host?: string) => this.readTokenReserve(host),
        /** True when this host's reserve ib is already `addr` (gib may differ). */
        hasReserve: (addr: string, host?: string) => this.tokenReserveMatches(addr, host),
        /**
         * Record `ib` or `ib^gib` on tip `tokens` for this host.
         * Same ib is a no-op (`already: true`) so a later reserve gib does not rewrite.
         */
        setReserve: (addr: string, host?: string) => this.writeTokenReserve(addr, host),
        /** Stamp a reserve ref onto a commit frame when that frame has none yet. */
        attach: (
            frame: { rel8ns?: Record<string, any> } | null | undefined,
            pay: { mode?: string; addr?: string; ib?: string } | null | undefined
        ) => {
            if (!pay || pay.mode !== 'reserve' || !frame || typeof frame !== 'object') {
                return frame;
            }
            const ref = String(pay.addr || pay.ib || '').trim();
            if (!ref) return frame;
            const rel =
                frame.rel8ns && typeof frame.rel8ns === 'object'
                    ? frame.rel8ns
                    : (frame.rel8ns = {});
            const curRaw = rel[TOKEN_RESERVE_REL];
            const cur = Array.isArray(curRaw)
                ? curRaw.map((x) => String(x || '').trim()).filter(Boolean)
                : curRaw
                  ? [String(curRaw).trim()].filter(Boolean)
                  : [];
            if (cur.length) return frame;
            rel[TOKEN_RESERVE_REL] = [ref];
            return frame;
        },
        giveBack: (host: string | undefined, token: string, path?: string) =>
            this.withTokenStash(host, path, (list) => {
                const t = String(token || '').trim();
                if (t && !list.includes(t)) list.unshift(t);
                return list.length;
            }),
    };

    private tokenStashOrigin(host?: string): string {
        const raw = String(host || '').trim() || this.relayHost || this.origin || '';
        const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
        try {
            const u = new URL(withScheme.replace(/^ws/i, 'http'));
            return u.origin;
        } catch {
            throw new Error(`token stash host not understood: ${raw || '(empty)'}`);
        }
    }

    /** '' = host-level list; otherwise '/seg/seg' (no trailing slash). */
    private tokenStashPath(path?: string): string {
        const segs = String(path || '')
            .split(/[\\/]+/)
            .map((s) => s.trim())
            .filter(Boolean);
        return segs.length ? '/' + segs.join('/') : '';
    }

    private splitReserveAddr(raw: string): { addr: string; ib: string } {
        const addr = String(raw || '').trim();
        const cut = addr.indexOf('^');
        const ib = (cut > 0 ? addr.slice(0, cut) : addr).trim();
        return { addr, ib };
    }

    private tokenReserveAddr(tip: { data?: Record<string, any> } | null, origin: string): string {
        const raw = tip?.data?.reserves?.[origin];
        return String(raw || '').trim();
    }

    private readTokenReserve(host?: string): Promise<string | null> {
        const run = async (): Promise<string | null> => {
            const origin = this.tokenStashOrigin(host);
            const tip = await this.getTip(TOKEN_STASH_IB);
            return this.tokenReserveAddr(tip, origin) || null;
        };
        const p = this.tokenStashChain.then(run, run);
        this.tokenStashChain = p.catch(() => undefined);
        return p;
    }

    private tokenReserveMatches(addr: string, host?: string): Promise<boolean> {
        const run = async (): Promise<boolean> => {
            const origin = this.tokenStashOrigin(host);
            const tip = await this.getTip(TOKEN_STASH_IB);
            const cur = this.tokenReserveAddr(tip, origin);
            if (!cur) return false;
            const want = this.splitReserveAddr(addr);
            return !!want.ib && this.splitReserveAddr(cur).ib === want.ib;
        };
        const p = this.tokenStashChain.then(run, run);
        this.tokenStashChain = p.catch(() => undefined);
        return p;
    }

    private writeTokenReserve(
        addr: string,
        host?: string
    ): Promise<{ addr: string; already: boolean; origin: string }> {
        const run = async () => {
            const origin = this.tokenStashOrigin(host);
            const parsed = this.splitReserveAddr(addr);
            if (!parsed.ib) throw new Error('reserve addr required (ib or ib^gib)');
            const tip = await this.getTip(TOKEN_STASH_IB);
            const data: Record<string, any> = { ...(tip?.data || {}) };
            const reserves: Record<string, string> =
                data.reserves && typeof data.reserves === 'object' ? { ...data.reserves } : {};
            const prev = String(reserves[origin] || '').trim();
            if (prev && this.splitReserveAddr(prev).ib === parsed.ib) {
                return { addr: prev, already: true, origin };
            }
            reserves[origin] = parsed.addr;
            const priorRel = tip?.rel8ns?.[TOKEN_RESERVE_REL];
            const kept = (Array.isArray(priorRel) ? priorRel : priorRel ? [priorRel] : [])
                .map((r) => String(r || '').trim())
                .filter((r) => r && this.splitReserveAddr(r).ib !== parsed.ib);
            await this.mut8TipByIb(
                TOKEN_STASH_IB,
                {
                    parts: data.parts || ['navi_park', 'ibgib_frame', 'manifest', 'json'],
                    hosts: data.hosts && typeof data.hosts === 'object' ? data.hosts : {},
                    reserves,
                    default_host: data.default_host || origin,
                },
                { create: true, rel8ns: { [TOKEN_RESERVE_REL]: [parsed.addr, ...kept] } }
            );
            return { addr: parsed.addr, already: false, origin };
        };
        const p = this.tokenStashChain.then(run, run);
        this.tokenStashChain = p.catch(() => undefined);
        return p;
    }

    private withTokenStash<T>(
        host: string | undefined,
        path: string | undefined,
        fn: (list: string[], where: string, reserve: string) => T
    ): Promise<T> {
        const run = async (): Promise<T> => {
            const origin = this.tokenStashOrigin(host);
            const sub = this.tokenStashPath(path);
            const tip = await this.getTip(TOKEN_STASH_IB);
            const data: Record<string, any> = { ...(tip?.data || {}) };
            const hosts: Record<string, any> =
                data.hosts && typeof data.hosts === 'object' ? { ...data.hosts } : {};
            const hostNest: Record<string, any> = { ...(hosts[origin] || {}) };
            const paths: Record<string, any> =
                hostNest.paths && typeof hostNest.paths === 'object' ? { ...hostNest.paths } : {};
            const nest: Record<string, any> = sub ? { ...(paths[sub] || {}) } : hostNest;
            const list = String(nest.unused || '')
                .split(/\r?\n/)
                .map((l) => l.trim())
                .filter(Boolean);
            const before = list.join('\n');
            const reserve = this.tokenReserveAddr({ data }, origin);
            const out = fn(list, origin + sub, reserve);
            if (list.join('\n') !== before) {
                nest.unused = list.length ? list.join('\n') + '\n' : '';
                if (sub) {
                    paths[sub] = nest;
                    hostNest.paths = paths;
                }
                hosts[origin] = hostNest;
                await this.mut8TipByIb(
                    TOKEN_STASH_IB,
                    {
                        parts: data.parts || ['navi_park', 'ibgib_frame', 'manifest', 'json'],
                        hosts,
                        default_host: data.default_host || origin,
                    },
                    { create: true }
                );
            }
            return out;
        };
        const p = this.tokenStashChain.then(run, run);
        this.tokenStashChain = p.catch(() => undefined);
        return p;
    }

    /** Mod-registered relay whitelist entries (owner = mod name); dropped on unmount. */
    private relayWhitelistMods = new Map<string, { paths: string[]; alias: string }>();

    /**
     * Relay whitelist. Off (default): every park path is callable through this navi's
     * relay aliases. On: only listed paths (exact or as a prefix) — mods add their own:
     *   navi.relayWhitelist.add('mymod', ['mymod/ping', 'mymod/inbox'])
     * An entry scoped to an alias is callable only through that alias:
     *   navi.relayWhitelist.add('cursor_sdk', 'cursor_sdk/edit', { alias: 'cursorhq' })
     */
    public relayWhitelist = {
        add: (owner: string, paths: string | string[], opts?: { alias?: string }) => {
            const key = String(owner || '').trim();
            if (!key) throw new Error('relayWhitelist.add(owner, paths) needs an owner (mod name)');
            const list = (Array.isArray(paths) ? paths : [paths])
                .map(relayWhitelistNorm)
                .filter(Boolean);
            const alias = opts?.alias ? this.sanitizeRelayAlias(opts.alias) : '';
            this.relayWhitelistMods.set(key, { paths: [...new Set(list)], alias });
            return this.relayWhitelistMods.get(key)!;
        },
        remove: (owner: string) => this.relayWhitelistMods.delete(String(owner || '').trim()),
        on: () => this.saveRelayWhitelist({ on: true }),
        off: () => this.saveRelayWhitelist({ on: false }),
        isOn: async () => (await this.loadRelayWhitelist()).on,
        allows: (path: string, alias?: string) => this.relayWhitelistAllows(path, alias),
        status: async () => {
            const w = await this.loadRelayWhitelist();
            return {
                on: w.on,
                paths: w.paths,
                via: w.via,
                trust: w.trust,
                mods: Object.fromEntries(this.relayWhitelistMods),
            };
        },
    };

    private async loadRelayWhitelist(): Promise<{
        on: boolean;
        paths: string[];
        via: Record<string, string[]>;
        trust: string[];
    }> {
        const raw = await this.shimItemGet('relay_whitelist');
        const o = raw && typeof raw === 'object' ? raw : {};
        const norm = (list: unknown) =>
            Array.isArray(list) ? list.map(relayWhitelistNorm).filter(Boolean) : [];
        const via: Record<string, string[]> = {};
        if (o.via && typeof o.via === 'object') {
            for (const [alias, list] of Object.entries(o.via)) {
                const a = this.sanitizeRelayAlias(alias);
                const paths = norm(list);
                if (a && paths.length) via[a] = paths;
            }
        }
        const trust = Array.isArray(o.trust)
            ? [...new Set(o.trust.map((a: unknown) => this.sanitizeRelayAlias(String(a || ''))).filter(Boolean))]
            : [];
        return { on: o.on === true, paths: norm(o.paths), via, trust: trust as string[] };
    }

    private async saveRelayWhitelist(patch: {
        on?: boolean;
        paths?: string[];
        via?: Record<string, string[]>;
        trust?: string[];
    }) {
        const cur = await this.loadRelayWhitelist();
        const next = {
            on: patch.on ?? cur.on,
            paths: patch.paths ?? cur.paths,
            via: patch.via ?? cur.via,
            trust: patch.trust ?? cur.trust,
        };
        await this.shimItemSet('relay_whitelist', next);
        return next;
    }

    /**
     * Unscoped entries pass through any alias; alias-scoped ones only through their own.
     * A trusted alias skips the list only while it has an alias token: the host rejects
     * callins whose X-Navi-Shell-Usage-Token does not match the advertised sha256.
     */
    private async relayWhitelistAllows(path: string, alias?: string): Promise<boolean> {
        const w = await this.loadRelayWhitelist();
        if (!w.on) return true;
        const p = relayWhitelistNorm(path);
        if (!p) return false;
        const via = alias ? this.sanitizeRelayAlias(alias) : '';
        if (via && w.trust.includes(via)) {
            const prefs = await this.loadRelayPrefs();
            if (prefs.aliasTokens[via]) return true;
        }
        const all = [...w.paths, ...(via ? w.via[via] || [] : [])];
        for (const m of this.relayWhitelistMods.values()) {
            if (!m.alias || m.alias === via) all.push(...m.paths);
        }
        return all.some((a) => p === a || p.startsWith(a + '/'));
    }

    private async relayWhitelistText(): Promise<string> {
        const w = await this.loadRelayWhitelist();
        const lines = [
            `relay whitelist ${w.on ? 'ON — only the paths below are callable through relay' : 'off — every path is callable through relay'}`,
            `  yours (any alias): ${w.paths.join(', ') || '(none)'}`,
        ];
        for (const [alias, list] of Object.entries(w.via)) {
            lines.push(`  yours via ${alias} only: ${list.join(', ')}`);
        }
        if (w.trust.length) {
            const prefs = await this.loadRelayPrefs();
            for (const alias of w.trust) {
                lines.push(
                    `  trusted via ${alias}: ${prefs.aliasTokens[alias] ? 'every path (alias token set)' : 'INACTIVE — no alias token (relay alias-token ' + alias + ' new)'}`
                );
            }
        }
        for (const [owner, m] of this.relayWhitelistMods) {
            lines.push(`  ${owner}${m.alias ? ` (via ${m.alias} only)` : ''}: ${m.paths.join(', ') || '(none)'}`);
        }
        if (!this.relayWhitelistMods.size) lines.push('  mods: (none registered)');
        lines.push('  (bare /navi-<alias>/ ping always answers)');
        return lines.join('\n');
    }

    /** Install-local secret that proves this navi owns its (public) uuid to relay hosts. */
    private async relayOwnerSecret(): Promise<string> {
        const cur = String((await this.shimItemGet('relay_owner')) || '').trim();
        if (cur.length >= 32) return cur;
        const bytes = new Uint8Array(32);
        globalThis.crypto.getRandomValues(bytes);
        const next = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
        await this.shimItemSet('relay_owner', next);
        return next;
    }

    /** Kernel reseed (also reachable via root POST action `reseed`). */
    public reseed = (force = false) => this.reseedTips(!!force);

    /**
     * Localnavi full wipe of tip+bin space, then reseed + ensureUnit + plant surf bin.
     * Also reachable via root POST action `factoryreset`.
     */
    public factoryreset = () => this.factoryResetSpace();

    /**
     * Park-check-before-network surface (also exposed as navi.park).
     * Local tip frame/bin wins over host network when a matching tip exists.
     */
    public park = {
        check: (input: string, opts?: ParkCheckOpts) =>
            this.parkCheck(input, opts),
        ib: (input: string) => this.pathToParkIb(input),
        /** Slash-joined ib (frozen `//` kept). */
        slash: (input: string) => slashJoinedIb(this.pathToParkIb(input)),
    };

    /** Live entry-plug bind for this navi object instance. */
    public plug = {
        /** Reveal full entry-plug (confirm in browser). Prefer callin `plug ping`. */
        ping: () => this.revealEntryPlug(),
        ensure: () => this.ensureUnit(),
        /** Memory-only presence refresh (stamp/last_seen). Does not mut8 navi:unit / heartbeat. */
        touch: () => this.touchEntryPlug(),
    };

    /** Unit system bookkeeping (navi:unit tip state) — not the entry-plug. */
    public unit = {
        get: () => this.loadUnitsState(),
    };

    /**
     * Localnavi stdin takeover (navi_shell.exe only). Modules push a layer to replace
     * `navi>`; pop restores the previous prompt. Base layer exit/quit closes the shell REPL.
     */
    private replRl: {
        prompt: () => void;
        setPrompt: (p: string) => void;
        close: () => void;
        on: (event: string, fn: (...args: any[]) => void) => void;
    } | null = null;
    private replStack: NaviReplLayer[] = [];
    private replLineBusy = false;
    private replResolveClose: (() => void) | null = null;

    public repl = {
        push: (layer: NaviReplLayer) => this.replPush(layer),
        pop: () => this.replPop(),
        depth: () => this.replStackLength(),
        prompt: () => this.replCurrentPrompt(),
    };

    private replStackLength(): number {
        return this.replStack.length;
    }

    private replCurrentPrompt(): string {
        const top = this.replStack[this.replStack.length - 1];
        return top?.prompt ?? 'navi> ';
    }

    private applyReplPrompt(): void {
        if (!this.replRl) return;
        this.replRl.setPrompt(this.replCurrentPrompt());
    }

    private replPush(layer: NaviReplLayer): void {
        if (!this.replRl) {
            throw new Error(
                '[navi] repl.push requires localnavi REPL (navi_shell.exe)'
            );
        }
        if (!layer || typeof layer.onLine !== 'function') {
            throw new Error('[navi] repl.push requires { prompt, onLine }');
        }
        const prompt = String(layer.prompt ?? '').trimEnd();
        this.replStack.push({
            prompt: prompt.endsWith(' ') ? prompt : `${prompt} `,
            onLine: layer.onLine,
        });
        this.applyReplPrompt();
        this.replRl.prompt();
    }

    private replPop(): NaviReplLayer | null {
        if (!this.replStack.length) return null;
        const removed = this.replStack.pop() || null;
        this.applyReplPrompt();
        if (this.replRl) this.replRl.prompt();
        return removed;
    }

    /** Own process stdin until close; supports repl.push / pop layers. */
    public async runLocalnaviRepl(): Promise<void> {
        if (!isLocalnaviExe()) {
            throw new Error('[navi] runLocalnaviRepl is localnavi-only');
        }
        if (this.replRl) {
            throw new Error('[navi] localnavi REPL already running');
        }
        const readline = require('readline') as typeof import('readline');
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            prompt: 'navi> ',
        });
        this.replRl = rl;
        this.replStack = [];
        this.callout(
            '[navi] Localnavi REPL ready. Enter callin commands (exit/quit to leave). Try: browse horizon/enter'
        );
        this.applyReplPrompt();
        rl.prompt();

        await new Promise<void>((resolve) => {
            this.replResolveClose = resolve;
            rl.on('line', async (line: string) => {
                if (this.replLineBusy) return;
                this.replLineBusy = true;
                try {
                    const top = this.replStack[this.replStack.length - 1];
                    if (top) {
                        await top.onLine(line);
                    } else {
                        const trimmed = String(line ?? '').trim();
                        if (trimmed === 'exit' || trimmed === 'quit') {
                            rl.close();
                            return;
                        }
                        if (trimmed) {
                            try {
                                await this.dispatchCallin(trimmed);
                            } catch (error) {
                                this.callout(
                                    'Error: ' + formatCalloutMessage(error)
                                );
                            }
                        }
                    }
                    if (this.replRl) {
                        this.applyReplPrompt();
                        this.replRl.prompt();
                    }
                } finally {
                    this.replLineBusy = false;
                }
            });
            rl.on('close', () => {
                this.replRl = null;
                this.replStack = [];
                const done = this.replResolveClose;
                this.replResolveClose = null;
                if (done) done();
            });
        });
    }

    /** Active unit for this request or entry-plug. */
    private currentUnitIb(): string | null {
        return this.callUnitIb || this.entryPlug?.unitIb || null;
    }

    /**
     * Service-worker bridge surface for modules.
     * SW invokes handlers via navi:call path ['handler', name].
     * Page→SW plugin control uses postMessage (REGISTER_PLUGIN / PLUGIN_MESSAGE / …).
     */
    public sw = {
        on: (name: string, handler: SwHandlerFn, owner?: string) => this.registerSwHandler(name, handler, owner),
        off: (name: string) => this.unregisterSwHandler(name),
        list: () => this.listSwHandlers(),
        registerPlugin: (id: string, url: string) =>
            this.postToServiceWorker({ type: 'REGISTER_PLUGIN', id, url }),
        registerPluginSource: (id: string, source: string) =>
            this.postToServiceWorker({ type: 'REGISTER_PLUGIN_SOURCE', id, source }),
        unregisterPlugin: (id: string) =>
            this.postToServiceWorker({ type: 'UNREGISTER_PLUGIN', id }),
        listPlugins: () => this.postToServiceWorker({ type: 'LIST_PLUGINS' }),
        send: (id: string, payload?: any) =>
            this.postToServiceWorker({ type: 'PLUGIN_MESSAGE', id, payload }),
    };

    /**
     * Same surface as the global navi.pwa facade — modules receive this instance
     * from register(navi), not the export object.
     */
    public pwa = {
        set: (config: NaviPwaConfig) => this.setPwa(config),
        apply: (config: NaviPwaConfig) => this.setPwa(config),
        clear: () => this.clearPwa(),
        get: () => this.getPwaConfig(),
        shell: {
            status: () => this.shellCacheStatus(),
            list: () => this.shellCacheStatus(),
            refresh: (urls?: string[]) => this.shellCacheRefresh(urls),
            warm: (urls?: string[]) => this.shellCacheWarm(urls),
            put: (entry: {
                url: string;
                body: string;
                contentType?: string;
            }) => this.shellCachePut(entry),
            delete: (url: string) => this.shellCacheDelete(url),
            clear: () => this.shellCacheClear(),
        },
    };
    
    private attachIdb(db: IDBDatabase): IDBDatabase {
        db.onclose = () => {
            if (this.idb === db) this.idb = null;
        };
        db.onversionchange = () => {
            db.close();
            if (this.idb === db) this.idb = null;
        };
        this.idb = db;
        return db;
    }

    private async openIndexedDB(): Promise<IDBDatabase> {
        if (this.idb) return this.idb;
        if (this.idbOpening) return this.idbOpening;
        this.idbOpening = new Promise<IDBDatabase>((resolve, reject) => {
            // v5: tip/frame/bin only — drop leftover items/files stores from the
            // pre-shim era (public item/file APIs now write tips+bins).
            const request = indexedDB.open('navi_shell', 5);

            request.onblocked = () => {
                this.callout(
                    '[navi] IndexedDB open blocked — another connection holds navi_shell'
                );
            };
            request.onerror = () => {
                this.idbOpening = null;
                reject(request.error);
            };
            request.onsuccess = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains('tip_frames')) {
                    db.close();
                    this.idbOpening = null;
                    reject(
                        new Error(
                            '[navi] IndexedDB missing tip_frames — clear site data / reopen'
                        )
                    );
                    return;
                }
                this.attachIdb(db);
                this.idbOpening = null;
                resolve(db);
            };

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;

                if (db.objectStoreNames.contains('items')) {
                    db.deleteObjectStore('items');
                }
                if (db.objectStoreNames.contains('files')) {
                    db.deleteObjectStore('files');
                }

                if (!db.objectStoreNames.contains('tips')) {
                    db.createObjectStore('tips', { keyPath: 'ib' });
                }

                if (!db.objectStoreNames.contains('tip_frames')) {
                    db.createObjectStore('tip_frames', { keyPath: 'addr' });
                }

                if (!db.objectStoreNames.contains('bins')) {
                    db.createObjectStore('bins', { keyPath: 'sha' });
                }
            };
        });
        try {
            return await this.idbOpening;
        } catch (err) {
            this.idbOpening = null;
            throw err;
        }
    }

    /** Run one request on a reused connection; wait for the transaction to finish. */
    private async idbStore<T>(
        storeName: string,
        mode: IDBTransactionMode,
        exec: (store: IDBObjectStore) => IDBRequest<T>
    ): Promise<T> {
        const run = async (): Promise<T> => {
            const db = await this.openIndexedDB();
            return await new Promise<T>((resolve, reject) => {
                let settled = false;
                const fail = (err: unknown) => {
                    if (settled) return;
                    settled = true;
                    reject(err);
                };
                try {
                    const tx = db.transaction(storeName, mode);
                    const req = exec(tx.objectStore(storeName));
                    let value: T;
                    req.onsuccess = () => {
                        value = req.result as T;
                    };
                    req.onerror = () => fail(req.error);
                    tx.oncomplete = () => {
                        if (settled) return;
                        settled = true;
                        resolve(value!);
                    };
                    tx.onerror = () => fail(tx.error);
                    tx.onabort = () =>
                        fail(
                            tx.error ||
                                new Error('[navi] IndexedDB transaction aborted')
                        );
                } catch (err) {
                    fail(err);
                }
            });
        };
        try {
            return await run();
        } catch (err) {
            const name = String((err as { name?: string })?.name || '');
            if (name === 'InvalidStateError' || name === 'InvalidAccessError') {
                this.idb = null;
                return await run();
            }
            throw err;
        }
    }

    private async getItemByPath(key: string, path: (string | number)[]): Promise<any> {
        const obj = await this.shimItemGet(key);
        if (!obj) {
            return null;
        }
        
        let current = obj;
        for (const part of path) {
            if (current === null || current === undefined || typeof current !== 'object') {
                return undefined;
            }
            current = current[part];
        }
        return current;
    }

    private async setItemByPath(key: string, path: (string | number)[], value: any): Promise<void> {
        let obj: any = {};
        const existingObj = await this.shimItemGet(key);
        if (existingObj && typeof existingObj === 'object') {
            obj = existingObj;
        }
        
        let current = obj;
        for (let i = 0; i < path.length - 1; i++) {
            const part = path[i];
            if (current[part] === null || current[part] === undefined || typeof current[part] !== 'object') {
                current[part] = {};
            }
            current = current[part];
        }
        
        const finalKey = path[path.length - 1];
        current[finalKey] = value;
        
        await this.shimItemSet(key, obj);
    }

    /** item → tip ib = key, data.value (preserves existing bin if any). */
    private async shimItemGet(key: string): Promise<any> {
        const tip = await this.getTip(storageItemTipIb(key));
        if (!tip?.data) return null;
        return tip.data.value !== undefined ? tip.data.value : null;
    }

    private async shimItemSet(key: string, value: any): Promise<void> {
        const ib = storageItemTipIb(key);
        const existing = await this.getTip(ib);
        const priorAddr = existing?.gib ? `${existing.ib}^${existing.gib}` : null;
        const frame = await this.stampTipFrame({
            ib,
            gib: '',
            data: {
                ...(existing?.data && typeof existing.data === 'object'
                    ? existing.data
                    : {}),
                parts: ['storage_item', 'ibgib_frame', 'manifest', 'json'],
                shim: 'item',
                value,
                n: undefined,
            },
            rel8ns: {
                ...(existing?.rel8ns || {}),
                past: priorAddr ? [priorAddr] : [],
                tjp: Array.isArray(existing?.rel8ns?.tjp)
                    ? existing!.rel8ns!.tjp
                    : [],
                dna: Array.isArray(existing?.rel8ns?.dna)
                    ? existing!.rel8ns!.dna
                    : [],
            },
        });
        await this.setTip(frame);
    }

    private async shimItemDel(key: string): Promise<void> {
        await this.deleteTip(storageItemTipIb(key));
    }

    private async shimItemList(prefix?: string): Promise<string[]> {
        const tips = await this.listTipIbs();
        const p = prefix != null ? String(prefix) : '';
        const pAlt = p.replace(/\//g, ':');
        const out: string[] = [];
        for (const ib of tips) {
            const tip = await this.getTipExact(ib);
            if (tip?.data?.shim !== 'item') continue;
            // Legacy navi:-prefixed item tips still list as relative key.
            const key =
                ib === 'navi' || /^navi[:/\s]/.test(ib)
                    ? relativeNaviKey(ib)
                    : ib;
            if (
                p &&
                !key.startsWith(p) &&
                !key.startsWith(pAlt) &&
                !ib.startsWith(p)
            ) {
                continue;
            }
            out.push(key);
        }
        return out;
    }

    /**
     * file → tip ib = path + bin (preserves existing data.value if any).
     * Overwrite mutates the tip (new frame + past) and plants a new bin address;
     * prior bins stay so past tip versions remain resolvable.
     */
    private async shimFileSave(filePath: string, value: any): Promise<void> {
        const record = toFileRecord(value);
        const sha = await this.putBinMedia(record);
        const ref = `bin ${sha}`;
        const ib = storageFileTipIb(filePath);
        const existing = await this.getTip(ib);
        const priorAddr = existing?.gib ? `${existing.ib}^${existing.gib}` : null;
        const frame = await this.stampTipFrame({
            ib,
            gib: '',
            data: {
                ...(existing?.data && typeof existing.data === 'object'
                    ? existing.data
                    : {}),
                parts: ['storage_file', 'ibgib_frame', 'manifest', 'json'],
                shim: 'file',
                content_type: record.mime,
                path: ib,
                n: undefined,
            },
            rel8ns: {
                ...(existing?.rel8ns || {}),
                bin: [ref],
                past: priorAddr ? [priorAddr] : [],
                tjp: Array.isArray(existing?.rel8ns?.tjp)
                    ? existing!.rel8ns!.tjp
                    : [],
                dna: Array.isArray(existing?.rel8ns?.dna)
                    ? existing!.rel8ns!.dna
                    : [],
            },
        });
        await this.setTip(frame);
    }

    private async shimFileGet(
        filePath: string
    ): Promise<{ media: string; mime: string } | null> {
        const tip = await this.getTip(storageFileTipIb(filePath));
        if (!tip?.data) return null;
        const sha = String(tip.rel8ns?.bin?.[0] || '')
            .match(/^bin\s+([0-9a-fA-F]+)$/)?.[1]
            ?.toLowerCase();
        if (!sha) return null;
        const bin = await this.getBin(sha);
        if (!bin) return null;
        return {
            media: bin.media,
            mime: tip.data.content_type || bin.mime || 'text/plain',
        };
    }

    private async shimFileLoad(filePath: string): Promise<string | null> {
        const entry = await this.shimFileGet(filePath);
        return entry?.media ?? null;
    }

    private async shimFileList(directoryPath?: string): Promise<string[]> {
        const tips = await this.listTipIbs();
        const withBin: string[] = [];
        for (const ib of tips) {
            const tip = await this.getTipExact(ib);
            if (tip?.data?.shim !== 'file') {
                // Legacy: navi: tips with bin but no shim tag
                if (
                    !(/^navi[:/\s]/.test(ib) || ib === 'navi') ||
                    !Array.isArray(tip?.rel8ns?.bin) ||
                    !tip!.rel8ns!.bin.length
                ) {
                continue;
            }
            withBin.push(relativeNaviKey(ib));
                continue;
            }
            if (!Array.isArray(tip?.rel8ns?.bin) || !tip!.rel8ns!.bin.length) {
                continue;
            }
            withBin.push(ib);
        }
        if (!directoryPath) return withBin;
        const prefix = normalizeTipIb(directoryPath);
        const prefixRel = relativeNaviKey(prefix);
        return withBin.filter(
            (rel) =>
                rel === prefix ||
                rel === prefixRel ||
                rel.startsWith(prefix + ':') ||
                rel.startsWith(prefix + '/') ||
                (prefixRel &&
                    (rel.startsWith(prefixRel + ':') ||
                        rel.startsWith(prefixRel + '/')))
        );
    }

    private async shimFileDel(filePath: string): Promise<void> {
        const ib = storageFileTipIb(filePath);
        const tip = await this.getTip(ib);
        if (tip?.rel8ns?.bin?.[0]) {
            const sha = String(tip.rel8ns.bin[0])
                .match(/^bin\s+([0-9a-fA-F]+)$/)?.[1]
                ?.toLowerCase();
            if (sha) await this.deleteBin(sha);
        }
        // If tip still has a value (item), drop bin only and keep tip; else delete tip.
        if (tip?.data && tip.data.value !== undefined) {
            const next = await this.stampTipFrame({
                ...tip,
                data: {
                    ...tip.data,
                    content_type: undefined,
                    shim: 'item',
                    n: undefined,
                },
                rel8ns: {
                    ...(tip.rel8ns || {}),
                    bin: [],
                    past: tip.gib ? [`${tip.ib}^${tip.gib}`] : [],
                },
            });
            await this.setTip(next);
            return;
        }
        await this.deleteTip(ib);
    }

    private createStorage(): NaviStorage {
        if (typeof window !== 'undefined') {
            // Browser environment - use IndexedDB
            return {
                getTip: async (ib: string) => {
                    try {
                        const row = await this.idbStore(
                            'tips',
                            'readonly',
                            (s) => s.get(ib)
                        );
                        return (row as NaviTipFrame) || null;
                    } catch (error) {
                        this.callout('Failed to read tip: ' + error);
                        return null;
                    }
                },
                putTip: async (frame: NaviTipFrame) => {
                    try {
                        await this.idbStore('tips', 'readwrite', (s) =>
                            s.put(frame)
                        );
                    } catch (error) {
                        this.callout('Failed to write tip: ' + error);
                        throw error;
                    }
                },
                deleteTip: async (ib: string) => {
                    try {
                        await this.idbStore('tips', 'readwrite', (s) =>
                            s.delete(ib)
                        );
                    } catch (error) {
                        this.callout('Failed to delete tip: ' + error);
                    }
                },
                listTips: async () => {
                    try {
                        const keys = await this.idbStore(
                            'tips',
                            'readonly',
                            (s) => s.getAllKeys()
                        );
                        return ((keys as IDBValidKey[]) || []).map(String);
                    } catch (error) {
                        this.callout('Failed to list tips: ' + error);
                        return [];
                    }
                },
                getTipFrame: async (addr: string) => {
                    try {
                        const key = String(addr || '').trim();
                        if (!key || !key.includes('^')) return null;
                        const row = (await this.idbStore(
                            'tip_frames',
                            'readonly',
                            (s) => s.get(key)
                        )) as (NaviTipFrame & { addr?: string }) | undefined;
                        if (!row) return null;
                        const { addr: _a, ...frame } = row;
                        return frame as NaviTipFrame;
                    } catch (error) {
                        this.callout('Failed to read tip frame: ' + error);
                        return null;
                    }
                },
                putTipFrame: async (frame: NaviTipFrame) => {
                    try {
                        const ib = String(frame?.ib || '').trim();
                        const gib = String(frame?.gib || '').trim();
                        if (!ib || !gib) {
                            throw new Error('[navi] tip frame requires ib and gib');
                        }
                        const addr = `${ib}^${gib}`;
                        await this.idbStore('tip_frames', 'readwrite', (s) =>
                            s.put({
                                addr,
                                ib,
                                gib,
                                data: frame.data,
                                rel8ns: frame.rel8ns,
                            })
                        );
                    } catch (error) {
                        this.callout('Failed to write tip frame: ' + error);
                        throw error;
                    }
                },
                deleteTipFrame: async (addr: string) => {
                    try {
                        const key = String(addr || '').trim();
                        if (!key || !key.includes('^')) return;
                        await this.idbStore('tip_frames', 'readwrite', (s) =>
                            s.delete(key)
                        );
                    } catch (error) {
                        this.callout('Failed to delete tip frame: ' + error);
                    }
                },
                listTipFrames: async (ib?: string) => {
                    try {
                        const want = String(ib || '').trim();
                        const keys = await this.idbStore(
                            'tip_frames',
                            'readonly',
                            (s) => s.getAllKeys()
                        );
                        const addrs = ((keys as IDBValidKey[]) || []).map(String);
                        if (!want) return addrs;
                        return addrs.filter(
                            (addr) =>
                                addr === want || addr.startsWith(want + '^')
                        );
                    } catch (error) {
                        this.callout('Failed to list tip frames: ' + error);
                        return [];
                    }
                },
                getBin: async (sha: string) => {
                    try {
                        const row = (await this.idbStore(
                            'bins',
                            'readonly',
                            (s) => s.get(sha)
                        )) as
                            | { sha: string; media: string; mime: string }
                            | undefined;
                        return row || null;
                    } catch (error) {
                        this.callout('Failed to read bin: ' + error);
                        return null;
                    }
                },
                putBin: async (
                    sha: string,
                    record: { media: string; mime: string }
                ) => {
                    try {
                        await this.idbStore('bins', 'readwrite', (s) =>
                            s.put({
                                sha,
                                media: record.media,
                                mime:
                                    record.mime || 'application/octet-stream',
                            })
                        );
                    } catch (error) {
                        this.callout('Failed to write bin: ' + error);
                        throw error;
                    }
                },
                deleteBin: async (sha: string) => {
                    try {
                        await this.idbStore('bins', 'readwrite', (s) =>
                            s.delete(sha)
                        );
                    } catch (error) {
                        this.callout('Failed to delete bin: ' + error);
                    }
                },
                listBins: async () => {
                    try {
                        const keys = await this.idbStore(
                            'bins',
                            'readonly',
                            (s) => s.getAllKeys()
                        );
                        return ((keys as IDBValidKey[]) || []).map(String);
                    } catch (error) {
                        this.callout('Failed to list bins: ' + error);
                        return [];
                    }
                },
            };
        } else {
            // Node environment - tip/bin JSON under ~/.navi_shell
            // (pkg-safe: load builtins via require-first helper)
            // tips.json / tip_frames.json: serialized RMW + atomic rename (see withLocalnaviJsonMapFile)
            return {
                getTip: async (ib: string) => {
                    try {
                        const { fs, join, homedir } = await getNodeFsPathOs();
                        const tipsFile = join(naviDataDir(join, homedir), 'tips.json');
                        return await withLocalnaviJsonMapFile(tipsFile, async () => {
                            const data = await readLocalnaviJsonMap(fs, tipsFile);
                            return (data[ib] as NaviTipFrame) || null;
                        });
                    } catch (error) {
                        this.callout('Failed to read tip: ' + error);
                        return null;
                    }
                },
                putTip: async (frame: NaviTipFrame) => {
                    try {
                        const { fs, join, homedir } = await getNodeFsPathOs();
                        const storageDir = naviDataDir(join, homedir);
                        const tipsFile = join(storageDir, 'tips.json');
                        await fs.mkdir(storageDir, { recursive: true });
                        await withLocalnaviJsonMapFile(tipsFile, async () => {
                            const data = await readLocalnaviJsonMap(fs, tipsFile);
                        data[frame.ib] = frame;
                            await writeLocalnaviJsonMapAtomic(fs, tipsFile, data);
                        });
                    } catch (error) {
                        this.callout('Failed to write tip: ' + error);
                        throw error;
                    }
                },
                deleteTip: async (ib: string) => {
                    try {
                        const { fs, join, homedir } = await getNodeFsPathOs();
                        const tipsFile = join(naviDataDir(join, homedir), 'tips.json');
                        await withLocalnaviJsonMapFile(tipsFile, async () => {
                            const data = await readLocalnaviJsonMap(fs, tipsFile);
                            if (!(ib in data)) return;
                            delete data[ib];
                            await writeLocalnaviJsonMapAtomic(fs, tipsFile, data);
                        });
                    } catch (error) {
                        this.callout('Failed to delete tip: ' + error);
                    }
                },
                listTips: async () => {
                    try {
                        const { fs, join, homedir } = await getNodeFsPathOs();
                        const tipsFile = join(naviDataDir(join, homedir), 'tips.json');
                        return await withLocalnaviJsonMapFile(tipsFile, async () => {
                            const data = await readLocalnaviJsonMap(fs, tipsFile);
                            return Object.keys(data || {});
                        });
                    } catch (error) {
                        this.callout('Failed to list tips: ' + error);
                        return [];
                    }
                },
                getTipFrame: async (addr: string) => {
                    try {
                        const key = String(addr || '').trim();
                        if (!key || !key.includes('^')) return null;
                        const { fs, join, homedir } = await getNodeFsPathOs();
                        const framesFile = join(
                            naviDataDir(join, homedir),
                            'tip_frames.json'
                        );
                        return await withLocalnaviJsonMapFile(framesFile, async () => {
                            const data = await readLocalnaviJsonMap(fs, framesFile);
                            const row = data[key];
                            if (!row || typeof row !== 'object') return null;
                            return {
                                ib: String(row.ib || ''),
                                gib: String(row.gib || ''),
                                data: row.data,
                                rel8ns: row.rel8ns,
                            } as NaviTipFrame;
                        });
                    } catch (error) {
                        this.callout('Failed to read tip frame: ' + error);
                        return null;
                    }
                },
                putTipFrame: async (frame: NaviTipFrame) => {
                    try {
                        const ib = String(frame?.ib || '').trim();
                        const gib = String(frame?.gib || '').trim();
                        if (!ib || !gib) {
                            throw new Error('[navi] tip frame requires ib and gib');
                        }
                        const addr = `${ib}^${gib}`;
                        const { fs, join, homedir } = await getNodeFsPathOs();
                        const storageDir = naviDataDir(join, homedir);
                        const framesFile = join(storageDir, 'tip_frames.json');
                        await fs.mkdir(storageDir, { recursive: true });
                        await withLocalnaviJsonMapFile(framesFile, async () => {
                            const data = await readLocalnaviJsonMap(fs, framesFile);
                        data[addr] = {
                            ib,
                            gib,
                            data: frame.data,
                            rel8ns: frame.rel8ns,
                        };
                            await writeLocalnaviJsonMapAtomic(fs, framesFile, data);
                        });
                    } catch (error) {
                        this.callout('Failed to write tip frame: ' + error);
                        throw error;
                    }
                },
                deleteTipFrame: async (addr: string) => {
                    try {
                        const key = String(addr || '').trim();
                        if (!key || !key.includes('^')) return;
                        const { fs, join, homedir } = await getNodeFsPathOs();
                        const framesFile = join(
                            naviDataDir(join, homedir),
                            'tip_frames.json'
                        );
                        await withLocalnaviJsonMapFile(framesFile, async () => {
                            const data = await readLocalnaviJsonMap(fs, framesFile);
                            if (!(key in data)) return;
                            delete data[key];
                            await writeLocalnaviJsonMapAtomic(fs, framesFile, data);
                        });
                    } catch (error) {
                        this.callout('Failed to delete tip frame: ' + error);
                    }
                },
                listTipFrames: async (ib?: string) => {
                    try {
                        const want = String(ib || '').trim();
                        const { fs, join, homedir } = await getNodeFsPathOs();
                        const framesFile = join(
                            naviDataDir(join, homedir),
                            'tip_frames.json'
                        );
                        return await withLocalnaviJsonMapFile(framesFile, async () => {
                            const data = await readLocalnaviJsonMap(fs, framesFile);
                            return Object.keys(data || {}).filter((addr) => {
                                if (!want) return true;
                                const row = data[addr];
                                return (
                                    String(row?.ib || '') === want ||
                                    addr.startsWith(want + '^')
                                );
                            });
                        });
                    } catch (error) {
                        this.callout('Failed to list tip frames: ' + error);
                        return [];
                    }
                },
                getBin: async (sha: string) => {
                    try {
                        const { fs, join, homedir } = await getNodeFsPathOs();
                        const binPath = join(naviDataDir(join, homedir), 'bins', sha + '.json');
                        try {
                            const row = JSON.parse(await fs.readFile(binPath, 'utf8'));
                            return {
                                sha,
                                media: String(row.media ?? ''),
                                mime: String(row.mime || 'application/octet-stream'),
                            };
                        } catch {
                            return null;
                        }
                    } catch (error) {
                        this.callout('Failed to read bin: ' + error);
                        return null;
                    }
                },
                putBin: async (sha: string, record: { media: string; mime: string }) => {
                    try {
                        const { fs, join, homedir } = await getNodeFsPathOs();
                        const binDir = join(naviDataDir(join, homedir), 'bins');
                        await fs.mkdir(binDir, { recursive: true });
                        await fs.writeFile(
                            join(binDir, sha + '.json'),
                            JSON.stringify({
                                sha,
                                media: record.media,
                                mime: record.mime || 'application/octet-stream',
                            }),
                            'utf8'
                        );
                    } catch (error) {
                        this.callout('Failed to write bin: ' + error);
                    }
                },
                deleteBin: async (sha: string) => {
                    try {
                        const { fs, join, homedir } = await getNodeFsPathOs();
                        await fs.unlink(
                            join(naviDataDir(join, homedir), 'bins', sha + '.json')
                        );
                    } catch (error) {
                        this.callout('Failed to delete bin: ' + error);
                    }
                },
                listBins: async () => {
                    try {
                        const { fs, join, homedir } = await getNodeFsPathOs();
                        const binDir = join(naviDataDir(join, homedir), 'bins');
                        await fs.mkdir(binDir, { recursive: true });
                        const names = await fs.readdir(binDir);
                        return names
                            .filter((n) => n.endsWith('.json'))
                            .map((n) => n.slice(0, -'.json'.length));
                    } catch (error) {
                        this.callout('Failed to list bins: ' + error);
                        return [];
                    }
                },
            };
        }
    }

    constructor() {
        super();
        this.storageImpl = this.createStorage();

        // Default callout sink
        this.on('callout', (data: any) => {
            console.log(data);
        });

        this.registerServiceWorkerBridge();
        applyNaviMobileViewport();
        this.applyFoobarchPwaDefaultsIfRoot();
    }

    private registerServiceWorkerBridge(): void {
        if (Navi.serviceWorkerBridgeRegistered) {
            return;
        }
        if (typeof navigator === 'undefined' || !navigator.serviceWorker) {
            return;
        }

        Navi.serviceWorkerBridgeRegistered = true;

        navigator.serviceWorker.addEventListener('message', async (event: MessageEvent) => {
            const data = event.data;
            if (!data || data.type !== SW_NAVI_CALL) {
                return;
            }

            const port = event.ports?.[0];
            if (!port) {
                return;
            }

            const path = Array.isArray(data.path) ? data.path.map(String) : null;
            const args = Array.isArray(data.args) ? data.args : [];

            if (!path || path.length === 0) {
                port.postMessage({ ok: false, error: 'navi:call requires a non-empty path' });
                return;
            }

            try {
                const result = await this.dispatchSwNaviCall(path, args);
                port.postMessage({ ok: true, result: result ?? null });
            } catch (error) {
                port.postMessage({ ok: false, error: formatCalloutMessage(error) });
            }
        });
    }

    /**
     * SW→page RPC: built-in allowlist, or named handlers under path ['handler', name].
     */
    private async dispatchSwNaviCall(path: string[], args: any[]): Promise<any> {
        if (path[0] === 'handler') {
            if (path.length !== 2 || !path[1]) {
                throw new Error('navi:call handler path must be ["handler", name]');
            }
            const entry = this.swHandlers.get(path[1]);
            if (!entry) {
                throw new Error(`No SW handler registered: ${path[1]}`);
            }
            return await entry.handler(...args);
        }

        const pathKey = path.join('.');
        if (!SW_ALLOWED_CALLS.has(pathKey)) {
            throw new Error(`Service worker navi:call not allowed: ${pathKey}`);
        }
        return await this.resolveNaviCall(path, args);
    }

    private registerSwHandler(name: string, handler: SwHandlerFn, owner?: string): void {
        const key = String(name || '').trim();
        if (!key) {
            throw new Error('[navi-error] navi.sw.on requires a non-empty handler name');
        }
        if (typeof handler !== 'function') {
            throw new Error(`[navi-error] navi.sw.on('${key}') requires a function`);
        }
        this.swHandlers.set(key, { handler, owner: owner ? String(owner) : undefined });
    }

    private unregisterSwHandler(name: string): boolean {
        return this.swHandlers.delete(String(name || '').trim());
    }

    private listSwHandlers(): Array<{ name: string; owner?: string }> {
        return [...this.swHandlers.entries()].map(([name, entry]) => ({
            name,
            owner: entry.owner,
        }));
    }

    private clearSwHandlersForOwner(owner: string): void {
        for (const [name, entry] of this.swHandlers) {
            if (entry.owner === owner) {
                this.swHandlers.delete(name);
            }
        }
    }

    private async postToServiceWorker(message: Record<string, any>): Promise<any> {
        if (typeof navigator === 'undefined' || !navigator.serviceWorker) {
            throw new Error('[navi-error] service worker unavailable');
        }
        const reg = await navigator.serviceWorker.ready;
        const worker = reg.active;
        if (!worker) {
            throw new Error('[navi-error] no active service worker');
        }

        return await new Promise((resolve, reject) => {
            const channel = new MessageChannel();
            const timeout = setTimeout(() => {
                reject(new Error('service worker message timed out'));
            }, 10000);

            channel.port1.onmessage = (event) => {
                clearTimeout(timeout);
                const data = event.data;
                if (!data || data.ok === false) {
                    reject(new Error(data?.error || 'service worker message failed'));
                    return;
                }
                resolve(data);
            };

            worker.postMessage({ ...message, expectResponse: true }, [channel.port2]);
        });
    }
    
    private async registerServiceWorker(): Promise<void> {
        if (typeof navigator === 'undefined' || !navigator.serviceWorker) {
            return;
        }
        try {
            await navigator.serviceWorker.register('/sw.js');
        } catch (error) {
            this.callout('[navi] Service worker registration failed: ' + formatCalloutMessage(error));
        }
    }

    private resolveShellEntryPath(): string {
        const raw = this.pwaConfig?.start_url;
        if (raw != null && String(raw).trim()) {
            try {
                const s = String(raw).trim();
                if (/^[a-z][a-z0-9+.-]*:/i.test(s)) {
                    return new URL(s).pathname || '/';
                }
                const path = s.startsWith('/') ? s : `/${s}`;
                return path.split('?')[0].split('#')[0] || '/';
            } catch {
                /* fall through */
            }
        }
        if (isBrowserDocument() && typeof window !== 'undefined') {
            return window.location.pathname || '/';
        }
        return '/';
    }

    private async shellCacheStatus(): Promise<any> {
        return await this.postToServiceWorker({
            type: 'NAVI_SHELL_CACHE',
            action: 'status',
        });
    }

    private async shellCacheRefresh(urls?: string[]): Promise<any> {
        const list =
            Array.isArray(urls) && urls.length
                ? urls
                : ['/navi_shell.js'];
        return await this.postToServiceWorker({
            type: 'NAVI_SHELL_CACHE',
            action: 'refresh',
            urls: list,
        });
    }

    private async shellCacheWarm(urls?: string[]): Promise<any> {
        const entry = this.resolveShellEntryPath();
        const list =
            Array.isArray(urls) && urls.length
                ? urls
                : [entry, entry === '/' ? null : '/'].filter(Boolean) as string[];
        return await this.postToServiceWorker({
            type: 'NAVI_SHELL_CACHE',
            action: 'warm',
            urls: list,
        });
    }

    private async shellCacheDelete(url: string): Promise<any> {
        if (!url) throw new Error('[navi.pwa.shell.delete] requires url');
        return await this.postToServiceWorker({
            type: 'NAVI_SHELL_CACHE',
            action: 'delete',
            url,
        });
    }

    private async shellCachePut(entry: {
        url: string;
        body: string;
        contentType?: string;
    }): Promise<any> {
        if (!entry || !entry.url) {
            throw new Error('[navi.pwa.shell.put] requires { url, body }');
        }
        return await this.postToServiceWorker({
            type: 'NAVI_SHELL_CACHE',
            action: 'put',
            url: entry.url,
            body: entry.body,
            contentType: entry.contentType,
        });
    }

    private async shellCacheClear(): Promise<any> {
        return await this.postToServiceWorker({
            type: 'NAVI_SHELL_CACHE',
            action: 'clear',
        });
    }

    private async ensureShellCache(): Promise<void> {
        if (!isBrowserDocument()) return;
        if (typeof navigator === 'undefined' || !navigator.serviceWorker) return;
        try {
            await navigator.serviceWorker.ready;
            const entry = this.resolveShellEntryPath();
            const runtime = await this.shellCacheRefresh(['/navi_shell.js']);
            const warm = await this.shellCacheWarm([entry, '/']);
            const runtimeOk = (Array.isArray(runtime?.results) ? runtime.results : []).filter(
                (r: any) => r && r.ok
            ).length;
            const warmOk = (Array.isArray(warm?.results) ? warm.results : []).filter(
                (r: any) => r && r.ok
            ).length;
            const warmTotal = Array.isArray(warm?.results) ? warm.results.length : 0;
            this.callout(
                `[navi.pwa.shell] runtime navi_shell.js ${runtimeOk}/1; offline warm ${warmOk}/${warmTotal}`
            );
        } catch (error) {
            this.callout(
                '[navi.pwa.shell] cache refresh skipped: ' +
                    formatCalloutMessage(error)
            );
        }
    }

    /**
     * Resolve a route/path against `navi.origin`.
     * Bare path → absolute URL on that origin (e.g. hypertext/welcome →
     * https://foobarch.net/hypertext/welcome). Absolute URLs left as-is.
     * Callers may set navi.origin; default is the hardcoded foobarch base
     * so localnavi and browser share the same fetch target.
     */
    public resolveUrl(path: string): string {
        const raw = String(path ?? '');
        // Already absolute — leave as-is.
        if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
            return raw;
        }
        const rel = raw.startsWith('/') ? raw : `/${raw}`;
        return this.origin ? `${this.origin}${rel}` : rel;
    }

    /**
     * Map a request path/URL to a tip ib — no storage presume.
     * /horizon/enter → horizon/enter (host tip space; file-save tip is navi:horizon/enter).
     * /navi/horizon/enter or navi:horizon/enter → that navi tip.
     */
    public pathToParkIb(input: string): string {
        let raw = String(input ?? '').trim();
        if (!raw) return '';
        try {
            if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
                raw = new URL(raw).pathname;
            }
        } catch {
            /* keep raw */
        }
        try {
            raw = decodeURIComponent(raw);
        } catch {
            /* keep raw */
        }
        return normalizeTipIb(raw);
    }

    /** Same prefix test as the SW `/navi/…` branch: localpark only, no hostpark. */
    private isNaviPrefixPath(input: string): boolean {
        const ib = this.pathToParkIb(input);
        return ib === 'navi' || /^navi[/:\s]/.test(ib);
    }

    private gatePassthruFromInit(init?: RequestInit): boolean {
        if (!init?.headers) return false;
        const h = new Headers(init.headers as HeadersInit);
        const v = String(
            h.get('X-Navi-Gate-Passthru') || h.get('x-navi-gate-passthru') || ''
        )
            .trim()
            .toLowerCase();
        return v === '1' || v === 'true' || v === 'yes';
    }

    /** X-Navi-Park-Bypass: skip localpark on callin (force hostpark pin/refresh). */
    private parkBypassFromHeaders(
        headers?: Record<string, string> | null
    ): boolean {
        if (!headers || typeof headers !== 'object') return false;
        const h = new Headers(headers as HeadersInit);
        const v = String(
            h.get('X-Navi-Park-Bypass') || h.get('x-navi-park-bypass') || ''
        )
            .trim()
            .toLowerCase();
        return v === '1' || v === 'true' || v === 'yes';
    }

    /**
     * Formal path GET: park.check (localpark), then hostpark on miss unless
     * the path is under navi/. Same stages as the SW; original input is
     * passed through (delimiter race stays in park.check / host).
     */
    /**
     * Alias for fetchPath — register(navi) receives this instance, while the
     * global callable also exposes navi.fetch via Object.defineProperty.
     */
    public fetch = (
        input: string,
        init?: RequestInit
    ): Promise<Response> => this.fetchPath(input, init);

    public async fetchPath(
        input: string,
        init?: RequestInit
    ): Promise<Response> {
        const path = String(input ?? '').trim();
        if (!path) {
            return new Response('navi.fetch: empty path', { status: 400 });
        }
        const local = await this.parkCheck(path, {
            gatePassthru: this.gatePassthruFromInit(init),
        });
        if (local.hit) {
            return new Response(local.body == null ? '' : String(local.body), {
                status: 200,
                headers: {
                    'Content-Type':
                        local.mime || 'application/octet-stream',
                    'X-Navi-Park-Ib': local.ib || '',
                    'X-Navi-Park-Kind': local.kind || '',
                    'X-Navi-Unit': local.unit || '',
                },
            });
        }
        // Local miss → hostpark for every path (no privileged navi/-only 404).
        if (typeof fetch !== 'function') {
            return new Response(
                `navi.fetch: localpark miss for ${local.ib || path} and fetch is unavailable`,
                { status: 502 }
            );
        }
        const url = encodeURI(this.resolveUrl(path));
        return await fetch(url, init);
    }

    /**
     * Park check before network.
     * 1) Capture parks: deepest `park: "capture"` prefix dispatches
     *    `method[method]` with remainder segments as args.
     * 2) Passive tip: delimiter race + optional data.gate on an exact-depth
     *    tip with GET kind frame|bin|surface (or rel8ns.bin). kind=mod without
     *    capture, and the root navi tip, are not passive GETs.
     *
     * data.gate=true in the race set always wins unless gatePassthru.
     * Race: `%20` → space, then exact first, then space, then `:`, then `/`.
     */
    public async parkCheck(
        input: string,
        opts?: ParkCheckOpts
    ): Promise<{
        hit: boolean;
        ib?: string;
        kind?: string;
        body?: string;
        mime?: string;
        reason?: string;
        unit?: string | null;
    }> {
        const unit = this.currentUnitIb();
        const withUnit = <T extends Record<string, any>>(row: T): T & { unit: string | null } => ({
            ...row,
            unit: this.currentUnitIb() ?? unit,
        });

        const ib = this.pathToParkIb(input);
        if (!ib) {
            return withUnit({ hit: false, reason: 'empty path' });
        }
        // Root park tip is not a passive path GET (callins use child parks).
        if (ib === 'navi') {
            return withUnit({
                hit: false,
                ib,
                reason: 'root navi tip excluded from park GET',
            });
        }

        const gatePassthru = !!opts?.gatePassthru;

        // Unit prefix → target that unit, then bare remainder (same as callin).
        const unitPeel = await this.peelUnitFromIb(ib);
        if (unitPeel) {
            const restSegs = unitPeel.restSegs;
            if (!restSegs.length) {
                const tip = await this.getTip(unitPeel.unitIb);
                if (!tip?.data) {
                    return withUnit({
                        hit: false,
                        ib: unitPeel.unitIb,
                        reason: 'no local unit tip',
                    });
                }
                return withUnit({
                    hit: true,
                    ib: tip.ib,
                    kind: 'frame',
                    body: JSON.stringify(tip, null, 2),
                    mime: 'application/json; charset=utf-8',
                });
            }
            // Flat parks: remainder stays bare (not re-prefixed with navi/).
            const restIb = restSegs.join('/');
            return await this.withCallUnit(unitPeel.unitIb, async () =>
                this.parkCheck(restIb, opts)
            );
        }

        // Direct URL inherits GET callin — same front door as POST / relay.
        // hostPin: false — park.check is localpark only (SW park-before-network).
        // Pinning host here would fetch the same path and re-enter the SW forever.
        const headers: Record<string, string> = {};
        if (gatePassthru) headers['X-Navi-Gate-Passthru'] = '1';
        try {
            const result = await this.dispatchCallin({
                path: ib,
                method: 'GET',
                headers,
                viaRelay: false,
                hostPin: false,
            });
                const { media, mime } = this.coerceParkBody(result);
            const cap = await this.resolveModParkCapture(ib, {
                method: 'GET',
                viaRelay: false,
                callin: true,
            });
            if (cap) {
                return withUnit({
                    hit: true,
                    ib: cap.tipIb,
                    kind: cap.kind || 'mod',
                    body: media,
                    mime,
                });
            }
            const tip = await this.getTip(ib, { gatePassthru });
            const ctrl = parkMethodCtrl(tip, 'GET');
            const kind =
                String(ctrl?.kind || (tip?.data?.shim === 'file' ? 'bin' : 'frame')).toLowerCase() ||
                'frame';
            return withUnit({
                hit: true,
                ib: tip?.ib || ib,
                kind,
                body: media,
                mime,
            });
            } catch (err) {
            const tip = await this.getTip(ib, { gatePassthru });
            const ctrl = parkMethodCtrl(tip, 'GET');
            const kind = String(ctrl?.kind || '').toLowerCase();
            return withUnit({
                    hit: false,
                ib: tip?.ib || ib,
                kind: kind || undefined,
                reason: tip?.data
                    ? formatCalloutMessage(err)
                    : 'no local tip',
            });
        }
    }

    private isParkCapture(tip: NaviTipFrame): boolean {
        return (
            typeof tip?.data?.park === 'string' &&
            tip.data.park.trim().toLowerCase() === 'capture'
        );
    }

        /**
     * Hostpark GET on the park path itself (same door as SW/network).
     * X-Navi-Park-Bypass keeps this fetch from re-entering SW park.check.
     * Accept selects tip JSON / mod multipart / module bytes.
     */
    private async fetchHostParkGet(
        ib: string,
        accept: string,
        extraHeaders?: Record<string, string>
    ): Promise<{ ct: string; text: string; buf: ArrayBuffer; headers: Headers } | null> {
        const want = canonicalizeTipIb(ib) || String(ib || '').trim();
        if (!want || typeof fetch !== 'function') return null;
        try {
            const res = await fetch(encodeURI(this.resolveUrl(want)), {
                method: 'GET',
                headers: {
                    ...(extraHeaders || {}),
                    Accept: accept,
                    'X-Navi-Park-Bypass': '1',
                },
                cache: 'no-store',
            });
            if (!res.ok) return null;
            const ct = String(res.headers.get('content-type') || '').toLowerCase();
            const buf = await res.arrayBuffer();
            if (!buf || buf.byteLength === 0) return null;
            let text = '';
            try {
                text = new TextDecoder('utf-8').decode(buf);
            } catch {
                text = '';
            }
            return { ct, text, buf, headers: res.headers };
        } catch {
            return null;
        }
    }

    /** Parse multipart/related eframe + bin from host navi-mod provision. */
    private parseNaviModMultipart(
        ct: string,
        buf: ArrayBuffer,
        headers?: Headers
    ): {
        frame: NaviTipFrame;
        sha: string;
        media: string;
        mime: string;
    } | null {
        const ctLower = String(ct || '').toLowerCase();
        const bm =
            ctLower.match(/boundary\s*=\s*"?([^";\s]+)"?/i) ||
            ctLower.match(/boundary\s*=\s*([^;\s]+)/i);
        if (!bm) return null;
        const boundary = bm[1];
        const decoder = new TextDecoder('utf-8');
        const asText = decoder.decode(new Uint8Array(buf));
        const delim = '--' + boundary;
        const chunks = asText.split(delim);
        let frame: NaviTipFrame | null = null;
        let media = '';
        let mime = 'application/navi-module';
        let sha = String(headers?.get('x-foobarch-bin') || '')
            .trim()
            .toLowerCase();

        for (const raw of chunks) {
            let part = raw;
            if (part.startsWith('--')) break;
            if (part.startsWith('\r\n')) part = part.slice(2);
            else if (part.startsWith('\n')) part = part.slice(1);
            if (!part.trim() || part.trim() === '--') continue;
            const sep = part.indexOf('\r\n\r\n');
            const sepN = part.indexOf('\n\n');
            const splitAt = sep >= 0 ? sep : sepN >= 0 ? sepN : -1;
            if (splitAt < 0) continue;
            const head = part.slice(0, splitAt);
            let body = part.slice(splitAt + (sep >= 0 ? 4 : 2));
            if (body.endsWith('\r\n')) body = body.slice(0, -2);
            else if (body.endsWith('\n')) body = body.slice(0, -1);
            const headL = head.toLowerCase();
            const partCt =
                (head.match(/content-type:\s*([^\r\n;]+)/i) || [])[1] || '';
            const partCtL = partCt.toLowerCase().trim();
            const binHdr =
                (head.match(/x-foobarch-bin:\s*([^\r\n]+)/i) || [])[1] || '';
            if (
                partCtL.includes('application/eframe') ||
                partCtL.includes('ibgib+json') ||
                headL.includes('name="eframe"') ||
                headL.includes('content-id: <eframe>')
            ) {
                try {
                    const json = JSON.parse(body);
                    const fr =
                        json && typeof json === 'object' && json.frame
                            ? json.frame
                            : json;
                    if (
                        fr &&
                        typeof fr === 'object' &&
                        fr.data &&
                        typeof fr.data === 'object'
                    ) {
                        frame = fr as NaviTipFrame;
                    }
                } catch {
                    /* skip */
                }
                continue;
            }
            if (
                headL.includes('name="bin"') ||
                headL.includes('content-id: <bin>') ||
                binHdr ||
                partCtL.includes('navi-module') ||
                partCtL.includes('javascript')
            ) {
                media = body;
                if (partCtL) mime = partCt.trim();
                if (binHdr) sha = String(binHdr).trim().toLowerCase();
                const fn =
                    (head.match(/filename="bin\s+([^"]+)"/i) || [])[1] || '';
                if (fn && !sha) sha = String(fn).trim().toLowerCase();
            }
        }

        if (!frame || !media.trim()) return null;
        if (!sha) {
            const rel = frame.rel8ns?.bin?.[0];
            if (rel) {
                sha = String(rel).replace(/^bin\s+/i, '').trim().toLowerCase();
            }
        }
        if (!sha) return null;
        return { frame, sha, media, mime };
    }

    /**
     * Host kind=mod provision: GET /{ib} Accept application/navi-mod
     * → multipart/related (eframe + addressed bin). Legacy JSON still parsed.
     */
    private async fetchHostModPackage(ib: string): Promise<{
        frame: NaviTipFrame;
        sha: string;
        media: string;
        mime: string;
    } | null> {
        const want = canonicalizeTipIb(ib) || String(ib || '').trim();
        if (!want) return null;
        const got = await this.fetchHostParkGet(
            want,
            'application/navi-mod, application/navi-mod+json;q=0.5'
        );
        if (!got) return null;

        const pkgHdr = String(
            got.headers.get('x-foobarch-package') || ''
        ).toLowerCase();
        const isMultipart =
            got.ct.includes('multipart/') ||
            (pkgHdr.includes('navi-mod') && got.ct.includes('boundary='));
        if (isMultipart) {
            return this.parseNaviModMultipart(got.ct, got.buf, got.headers);
        }

        if (
            !(got.ct.includes('navi-mod') || got.text.trim().startsWith('{'))
        ) {
            return null;
        }
        let json: any;
        try {
            json = JSON.parse(got.text);
        } catch {
            return null;
        }
        if (!(json && typeof json === 'object' && json.frame && json.bin)) {
            return null;
        }
        const frameRaw = json.frame;
        if (
            !(
                frameRaw &&
                typeof frameRaw === 'object' &&
                frameRaw.data &&
                typeof frameRaw.data === 'object'
            )
        ) {
            return null;
        }
        const bin =
            json.bin && typeof json.bin === 'object' ? json.bin : null;
        let media = '';
        if (bin && typeof bin.media === 'string' && bin.media.trim()) {
            media = bin.media;
        } else if (bin && typeof bin.body_b64 === 'string' && bin.body_b64) {
            try {
                if (typeof atob === 'function') {
                    media = atob(bin.body_b64);
                } else if (
                    typeof Buffer !== 'undefined' &&
                    typeof Buffer.from === 'function'
                ) {
                    media = Buffer.from(bin.body_b64, 'base64').toString('utf8');
                }
            } catch {
                media = '';
            }
        }
        if (!media.trim()) return null;
        let sha = String(bin?.sha256 || '')
            .trim()
            .toLowerCase();
        if (!sha) {
            const rel = frameRaw.rel8ns?.bin?.[0];
            if (rel) {
                sha = String(rel).replace(/^bin\s+/i, '').trim().toLowerCase();
            }
        }
        if (!sha) sha = await this.sha256Hex(media);
        const mime =
            String(
                bin?.content_type ||
                    frameRaw.data?.content_type ||
                    'application/navi-module'
            ) || 'application/navi-module';
        const fib = canonicalizeTipIb(String(frameRaw.ib || want)) || want;
                return {
            frame: { ...frameRaw, ib: fib } as NaviTipFrame,
            sha,
            media,
            mime,
        };
    }

    /**
     * Tip control plane from host: GET /{ib} Accept application/eframe
     * (legacy application/ibgib+json). Tip-only — do not co-list html/text.
     */
    private async fetchHostTipFrame(ib: string): Promise<NaviTipFrame | null> {
        const want = canonicalizeTipIb(ib) || String(ib || '').trim();
        if (!want) return null;
        const got = await this.fetchHostParkGet(
            want,
            'application/eframe, application/ibgib+json;q=0.9'
        );
        if (!got) return null;
        if (
            got.ct.includes('multipart/') ||
            (got.ct.includes('navi-mod') && !got.ct.includes('navi-module'))
        ) {
            return null;
        }
        let json: any;
        try {
            json = JSON.parse(got.text);
        } catch {
            return null;
        }
        const frame =
            json && typeof json === 'object' && json.frame ? json.frame : json;
        if (
            !(
                frame &&
                typeof frame === 'object' &&
                frame.data &&
                typeof frame.data === 'object'
            )
        ) {
            return null;
        }
        const fib = canonicalizeTipIb(String(frame.ib || want)) || want;
        return { ...frame, ib: fib } as NaviTipFrame;
    }

    /**
     * GET snapshot from host: Accept application/eframe + multipart/related.
     * Hosts whose frame sets data.snapshot_bins answer multipart (eframe + the
     * bins it chose, listed in X-Foobarch-Bins); otherwise plain eframe JSON.
     * `wantShas` narrows the bins requested — the frame decides what is allowed.
     * Bins whose bytes do not hash to their advertised sha are dropped.
     */
    private async fetchHostFrameSnapshot(
        ib: string,
        wantShas?: string[]
    ): Promise<{
        frame: NaviTipFrame;
        bins: { sha: string; media: string; mime: string }[];
    } | null> {
        const want = canonicalizeTipIb(ib) || String(ib || '').trim();
        if (!want) return null;
        const extra: Record<string, string> = {};
        if (wantShas?.length) extra['X-Foobarch-Snapshot-Bins'] = wantShas.join(',');
        const got = await this.fetchHostParkGet(
            want,
            'application/eframe, multipart/related, application/ibgib+json;q=0.9',
            extra
        );
        if (!got) return null;

        const asFrame = (json: any): NaviTipFrame | null => {
            const fr = json && typeof json === 'object' && json.frame ? json.frame : json;
            return fr && typeof fr === 'object' && fr.data && typeof fr.data === 'object'
                ? (fr as NaviTipFrame)
                : null;
        };

        if (!got.ct.includes('multipart/')) {
            if (!(got.ct.includes('eframe') || got.ct.includes('json'))) return null;
            try {
                const frame = asFrame(JSON.parse(got.text));
                return frame ? { frame, bins: [] } : null;
            } catch {
                return null;
            }
        }

        const bm =
            got.ct.match(/boundary\s*=\s*"?([^";\s]+)"?/i) ||
            got.ct.match(/boundary\s*=\s*([^;\s]+)/i);
        if (!bm) return null;
        const chunks = got.text.split('--' + bm[1]);
        let frame: NaviTipFrame | null = null;
        const bins: { sha: string; media: string; mime: string }[] = [];
        for (const raw of chunks) {
            let part = raw;
            if (part.startsWith('--')) break;
            if (part.startsWith('\r\n')) part = part.slice(2);
            else if (part.startsWith('\n')) part = part.slice(1);
            if (!part.trim()) continue;
            const sep = part.indexOf('\r\n\r\n');
            const sepN = part.indexOf('\n\n');
            const splitAt = sep >= 0 ? sep : sepN;
            if (splitAt < 0) continue;
            const head = part.slice(0, splitAt);
            let body = part.slice(splitAt + (sep >= 0 ? 4 : 2));
            if (body.endsWith('\r\n')) body = body.slice(0, -2);
            else if (body.endsWith('\n')) body = body.slice(0, -1);
            const partCt = ((head.match(/content-type:\s*([^\r\n;]+)/i) || [])[1] || '').trim();
            const binSha = ((head.match(/x-foobarch-bin:\s*([^\r\n]+)/i) || [])[1] || '')
                .trim()
                .toLowerCase();
            if (binSha) {
                if ((await this.sha256Hex(body)) !== binSha) continue;
                bins.push({
                    sha: binSha,
                    media: body,
                    mime: partCt || 'application/octet-stream',
                });
                continue;
            }
            if (/application\/eframe|ibgib\+json/i.test(partCt) || /content-id:\s*<eframe>/i.test(head)) {
                try {
                    frame = asFrame(JSON.parse(body)) || frame;
                } catch {
                    /* skip */
                }
            }
        }
        return frame ? { frame, bins } : null;
    }

    /** Module bytes from host: GET /{ib} Accept application/navi-module. */
    private async fetchHostModuleMedia(ib: string): Promise<string | null> {
        const want = canonicalizeTipIb(ib) || String(ib || '').trim();
        if (!want) return null;
        const got = await this.fetchHostParkGet(
            want,
            'application/navi-module, application/javascript, text/javascript'
        );
        if (!got) return null;
        if (
            got.ct.includes('eframe') ||
            got.ct.includes('ibgib+json') ||
            got.ct.includes('multipart/') ||
            (got.ct.includes('navi-mod') && !got.ct.includes('navi-module')) ||
            (got.ct.includes('application/json') &&
                !got.ct.includes('navi-module'))
        ) {
            return null;
        }
        if (got.ct.includes('text/html')) {
            return null;
        }
        return got.text;
    }

/**
     * Fallback module bytes via about.warez_subject on flowerpot when hostpark
     * GET /{ib} cannot serve kind:mod yet (pre-remount hosts).
     */
    private async fetchWarezSubjectMedia(
        tip: NaviTipFrame | null | undefined
    ): Promise<string | null> {
        if (!tip?.data || typeof fetch !== 'function') return null;
        const about =
            tip.data.about && typeof tip.data.about === 'object'
                ? tip.data.about
                : null;
        const raw = String(
            about?.warez_subject || about?.subject_ib || ''
        ).trim();
        if (!raw) return null;
        const subject = raw.replace(/^flowerpot\//i, '').replace(/^\/+/, '');
        if (!subject) return null;
        const tryUrls = [
            this.resolveUrl(`flowerpot/${subject}`),
            `https://foobarch.net/flowerpot/${subject}`,
        ];
        for (const url of tryUrls) {
            try {
                const res = await fetch(encodeURI(url), {
                    method: 'GET',
                    headers: {
                        Accept:
                            'application/navi-module, application/javascript, text/javascript',
                    },
                    cache: 'no-store',
                });
                if (!res.ok) continue;
                const ct = String(
                    res.headers.get('content-type') || ''
                ).toLowerCase();
                if (
                    ct.includes('ibgib+json') ||
                    ct.includes('application/json') ||
                    ct.includes('text/html')
                ) {
                    continue;
                }
                const text = await res.text();
                if (text && text.trim()) return text;
            } catch {
                /* try next */
            }
        }
        return null;
    }

    /** Kinds a host tip may plant as for `method` (POST also takes frame/bin controls). */
    private hostPlantKinds(method: ParkMethod): string[] {
        const base = ['mod', 'bin', 'surface', 'relay', 'navi_root'];
        return method === 'POST' ? [...base, 'frame'] : base;
    }

    /**
     * Host miss → plant the host tip into localpark.
     *   1) kind=mod: navi-mod multipart (eframe + addressed bin).
     *   2) POST: GET snapshot (eframe + bins the frame chose to send).
     *   3) Legacy: tip JSON + separate module GET.
     * Parks the eframe as-is and puts bins under their host sha.
     */
    private async plantHostTip(
        ib: string,
        opts?: { forceRefresh?: boolean; method?: ParkMethod; wantShas?: string[] }
    ): Promise<NaviTipFrame | null> {
        const want = canonicalizeTipIb(ib) || String(ib || '').trim();
        if (!want) return null;
        const forceRefresh = !!opts?.forceRefresh;
        const method = normalizeParkMethod(opts?.method, 'GET');
        const plantKinds = this.hostPlantKinds(method);
        if (!forceRefresh) {
            const existing = await this.getTip(want);
            if (existing?.data) {
                const ek = String(
                    parkMethodCtrl(existing, method)?.kind || ''
                ).toLowerCase();
                return plantKinds.includes(ek) ? existing : null;
            }
        }

        if (method === 'POST') {
            const snap = await this.fetchHostFrameSnapshot(want, opts?.wantShas);
            const snapIb = snap ? canonicalizeTipIb(String(snap.frame.ib || '')) : '';
            const snapKind = snap
                ? String(parkMethodCtrl(snap.frame, method)?.kind || '').toLowerCase()
                : '';
            // Capture parks answer deeper paths with their own frame; only plant
            // under the frame's real ib so the remainder becomes args.
            if (snap && snapIb === want && snapKind && snapKind !== 'mod' && plantKinds.includes(snapKind)) {
                for (const b of snap.bins) {
                    await this.putBin(b.sha, { media: b.media, mime: b.mime });
                }
                const next = {
                    ...snap.frame,
                    ib: want,
                    gib: '',
                    rel8ns: {
                        ...(snap.frame.rel8ns || {}),
                        past: Array.isArray(snap.frame.rel8ns?.past) ? snap.frame.rel8ns!.past : [],
                        tjp: Array.isArray(snap.frame.rel8ns?.tjp) ? snap.frame.rel8ns!.tjp : [],
                        dna: Array.isArray(snap.frame.rel8ns?.dna) ? snap.frame.rel8ns!.dna : [],
                        bin: Array.isArray(snap.frame.rel8ns?.bin) ? snap.frame.rel8ns!.bin.slice() : [],
                    },
                } as NaviTipFrame;
                await this.setTip(next);
                return (await this.getTip(want)) || next;
            }
            if (snap && snapIb && snapIb !== want) return null;
        }

        // Host resolves deeper paths to the capturing park's frame; only plant under
        // the frame's own ib so the caller's shorter-prefix pass keeps the remainder as args.
        const frameIbMismatch = (frame: any) => {
            const fib = canonicalizeTipIb(String(frame?.ib || ''));
            return !!fib && fib !== want;
        };

        const pkg = await this.fetchHostModPackage(want);
        if (pkg && frameIbMismatch(pkg.frame)) return null;
        if (pkg) {
            await this.putBin(pkg.sha, {
                media: pkg.media,
                mime: pkg.mime,
            });
            const hostBin = Array.isArray(pkg.frame.rel8ns?.bin)
                ? pkg.frame.rel8ns!.bin.slice()
                : [`bin ${pkg.sha}`];
            const next = {
                ...pkg.frame,
                ib: want,
                gib: '',
                data: {
                    ...pkg.frame.data,
                    content_type:
                        pkg.frame.data?.content_type || pkg.mime,
                },
                rel8ns: {
                    ...(pkg.frame.rel8ns || {}),
                    past: Array.isArray(pkg.frame.rel8ns?.past)
                        ? pkg.frame.rel8ns!.past
                        : [],
                    tjp: Array.isArray(pkg.frame.rel8ns?.tjp)
                        ? pkg.frame.rel8ns!.tjp
                        : [],
                    dna: Array.isArray(pkg.frame.rel8ns?.dna)
                        ? pkg.frame.rel8ns!.dna
                        : [],
                    bin: hostBin.length ? hostBin : [`bin ${pkg.sha}`],
                },
            } as NaviTipFrame;
            await this.setTip(next);
            return (await this.getTip(want)) || next;
        }

        // Legacy: separate tip JSON + module bytes (pre-multipart hosts).
        const frame = await this.fetchHostTipFrame(want);
        if (!frame?.data) return null;
        if (frameIbMismatch(frame)) return null;

        const ctrl = parkMethodCtrl(frame, 'GET');
        const kind = String(ctrl?.kind || '').toLowerCase();
        if (
            kind !== 'mod' &&
            kind !== 'bin' &&
            kind !== 'surface' &&
            kind !== 'relay' &&
            kind !== 'navi_root'
        ) {
            return null;
        }

        let next = { ...frame, ib: want } as NaviTipFrame;
        next.rel8ns = {
            ...(frame.rel8ns || {}),
            past: Array.isArray(frame.rel8ns?.past) ? frame.rel8ns!.past : [],
            tjp: Array.isArray(frame.rel8ns?.tjp) ? frame.rel8ns!.tjp : [],
            dna: Array.isArray(frame.rel8ns?.dna) ? frame.rel8ns!.dna : [],
            bin: Array.isArray(frame.rel8ns?.bin) ? frame.rel8ns!.bin.slice() : [],
        };

        if (kind === 'mod' || kind === 'bin') {
            let media = await this.fetchHostModuleMedia(want);
            if (!media) media = await this.fetchWarezSubjectMedia(next);
            if (media) {
                const mime =
                    String(
                        next.data?.content_type ||
                            next.data?.mime ||
                            'application/navi-module'
                    ) || 'application/navi-module';
                const hostSha = String(next.rel8ns.bin?.[0] || '')
                    .replace(/^bin\s+/i, '')
                    .trim()
                    .toLowerCase();
                const sha = hostSha || (await this.sha256Hex(media));
                await this.putBin(sha, { media, mime });
                next.rel8ns.bin = [`bin ${sha}`];
                next.data = {
                    ...next.data,
                    content_type:
                        next.data?.content_type || 'application/navi-module',
                };
            }
        }

        next.gib = '';
        await this.setTip(next);
        return (await this.getTip(want)) || next;
    }

    /**
     * Hostpark pin when local tip/capture miss: try exact ib then capture
     * prefixes (longest first). Plants tip+bins locally then returns the
     * dispatch triple for executeParkTip. POST also dispatches frame/bin
     * controls (bin-served callins); GET keeps mod-like kinds only.
     */
    private async tryHostParkPin(
        workIb: string,
        method: ParkMethod,
        opts?: { forceRefresh?: boolean }
    ): Promise<{
        tip: NaviTipFrame;
        tipIb: string;
        args: string[];
    } | null> {
        const rawSegs = ibSegments(workIb);
        if (!rawSegs.length) return null;
        const forceRefresh = !!opts?.forceRefresh;
        const dispatchKinds =
            method === 'POST'
                ? ['mod', 'surface', 'relay', 'navi_root', 'frame', 'bin']
                : ['mod', 'surface', 'relay', 'navi_root'];

        for (let len = rawSegs.length; len >= 1; len--) {
            const prefix = rawSegs.slice(0, len).join('/');
            const planted = await this.plantHostTip(prefix, {
                forceRefresh,
                method,
            });
            if (!planted?.data) continue;
            if (len < rawSegs.length && !this.isParkCapture(planted)) continue;
            const ctrl = parkMethodCtrl(planted, method);
            const kind = String(ctrl?.kind || '').toLowerCase();
            if (!dispatchKinds.includes(kind)) {
                continue;
            }
            const args = rawSegs.slice(len).map((s) => {
                try {
                    return decodeURIComponent(s);
                } catch {
                    return s;
                }
            });
        return {
                tip: planted,
                tipIb: planted.ib || prefix,
                args,
            };
        }
        return null;
    }

    /**
     * Deepest planted park with `park: "capture"` that prefixes `rawIb`.
     * Remainder segments (including none) become args; each is percent-decoded.
     */
    private async resolveModParkCapture(
        rawIb: string,
        dispatch: ParkDispatchOpts
    ): Promise<{
        tipIb: string;
        tip: NaviTipFrame;
        args: string[];
        kind: string;
    } | null> {
        const method = dispatch.method;
        const index = await this.getTip(NAVI_MOD_INDEX_IB);
        const parks = Array.isArray(index?.data?.parks)
            ? (index!.data.parks as any[])
            : [];
        const rawSegs = ibSegments(rawIb);
        if (!rawSegs.length) return null;

        type CapCand = { parkIb: string; remainder: string[]; len: number };
        const candidates: CapCand[] = [];
        const seen = new Set<string>();
        const consider = (parkIbRaw: string) => {
            const parkIb = normalizeTipIb(parkIbRaw);
            if (!parkIb || seen.has(parkIb)) return;
            const parkSegs = ibSegments(parkIb);
            if (
                !parkSegs.length ||
                parkSegs.length > rawSegs.length ||
                !parkSegs.every((s, i) => s === rawSegs[i])
            ) {
                return;
            }
            seen.add(parkIb);
            candidates.push({
                    parkIb,
                    remainder: rawSegs.slice(parkSegs.length),
                    len: parkSegs.length,
            });
        };

        for (const p of parks) {
            consider(String(p?.ib || ''));
        }

        // Flat parks / surfaces (bare or under navi/…) — not only ledger parks[].
        const minLen = rawSegs[0] === 'navi' ? 2 : 1;
        for (let len = rawSegs.length; len >= minLen; len--) {
            consider(rawSegs.slice(0, len).join(':'));
            consider(rawSegs.slice(0, len).join('/'));
            consider(rawSegs.slice(0, len).join(' '));
        }

        candidates.sort((a, b) => b.len - a.len);

        for (const best of candidates) {
            const tip = await this.getTip(best.parkIb);
            if (!tip?.data || !this.isParkCapture(tip)) continue;
            const ctrl = parkMethodCtrl(tip, method);
            const kind = String(ctrl?.kind || '').toLowerCase();
            if (!kind) continue;
            const args = best.remainder.map((s: string) => {
            try {
                return decodeURIComponent(s);
            } catch {
                return s;
            }
        });
            return {
                tipIb: tip.ib || best.parkIb,
                tip,
                args,
                kind,
            };
        }
        return null;
    }

    /** Turn a mod command's return value into an HTTP body + MIME. */
    private coerceParkBody(
        result: any,
        opts?: { compact?: boolean }
    ): { media: string; mime: string } {
        if (result == null) {
            return { media: '', mime: 'text/plain; charset=utf-8' };
        }
        if (typeof result === 'string') {
            return { media: result, mime: 'text/plain; charset=utf-8' };
        }
        if (typeof result === 'object' && typeof result.media === 'string') {
            return {
                media: result.media,
                mime: String(result.mime || 'application/octet-stream'),
            };
        }
        try {
            return {
                media: opts?.compact
                    ? JSON.stringify(result)
                    : JSON.stringify(result, null, 2),
                mime: 'application/json; charset=utf-8',
            };
        } catch {
            return { media: String(result), mime: 'text/plain; charset=utf-8' };
        }
    }

    /**
     * Normalize the independently persisted relay host. Empty/clear means
     * "fall back to navi.origin" at the point where the host is used.
     */
    private normalizeRelayHost(raw?: string): string {
        const h = String(raw ?? '').trim();
        if (!h || h === '-' || /^none$/i.test(h) || /^clear$/i.test(h)) {
            return '';
        }
        return h;
    }

    private async loadRelayPrefs(): Promise<{
        host: string;
        token: string;
        alias: string;
        expiresSec: number;
        parks: Record<string, string>;
        frames: Record<
            string,
            { ib: string; addr?: string; frame: Record<string, any> }
        >;
        aliasTokens: Record<string, string>;
    }> {
        const raw = await this.shimItemGet('relay');
        const o = raw && typeof raw === 'object' ? raw : {};
        const parksRaw =
            o.parks && typeof o.parks === 'object' ? o.parks : {};
        const parks: Record<string, string> = {};
        for (const [k, v] of Object.entries(parksRaw)) {
            const ib = String(v || '').trim();
            if (ib) parks[String(k).trim()] = ib;
        }
        const legacyIb = String(o.advertisedIb || '').trim();
        const alias = String(o.alias || o.nick || '').trim();
        if (legacyIb && alias && !parks[alias]) {
            parks[alias] = legacyIb;
        }
        const framesRaw =
            o.frames && typeof o.frames === 'object' ? o.frames : {};
        const frames: Record<
            string,
            { ib: string; addr?: string; frame: Record<string, any> }
        > = {};
        for (const [k, v] of Object.entries(framesRaw)) {
            if (!v || typeof v !== 'object') continue;
            const row = v as Record<string, any>;
            const ib = String(row.ib || '').trim();
            const frame = row.frame;
            if (ib && frame && typeof frame === 'object') {
                frames[String(k).trim()] = {
                    ib,
                    addr: String(row.addr || '').trim() || undefined,
                    frame,
                };
            }
        }
        const aliasTokens: Record<string, string> = {};
        if (o.aliasTokens && typeof o.aliasTokens === 'object') {
            for (const [k, v] of Object.entries(o.aliasTokens)) {
                const t = String(v || '').trim();
                if (t) aliasTokens[String(k).trim()] = t;
            }
        }
        const rawHost = String(o.host || '').trim();
        const host = this.normalizeRelayHost(rawHost);
        // Heal poisoned prefs in place (don't leave host:"-" on disk).
        if (rawHost && rawHost !== host) {
            void this.shimItemSet('relay', {
                ...o,
                host,
                token: String(o.token || '').trim(),
                alias,
                expiresSec:
                    Number(o.expiresSec) > 0
                        ? Math.floor(Number(o.expiresSec))
                        : DEFAULT_RELAY_EXPIRES_SEC,
                parks,
                frames,
                aliasTokens,
            });
        }
        return {
            host,
            token: String(o.token || '').trim(),
            alias,
            expiresSec:
                Number(o.expiresSec) > 0
                    ? Math.floor(Number(o.expiresSec))
                    : DEFAULT_RELAY_EXPIRES_SEC,
            parks,
            frames,
            aliasTokens,
        };
    }

    private async saveRelayPrefs(patch: {
        host?: string;
        token?: string;
        alias?: string;
        expiresSec?: number;
        parks?: Record<string, string>;
        frames?: Record<
            string,
            { ib: string; addr?: string; frame: Record<string, any> }
        >;
        /** Replaces the whole map (so clear can delete). */
        aliasTokens?: Record<string, string>;
    }): Promise<void> {
        const cur = await this.loadRelayPrefs();
        const host = this.normalizeRelayHost(patch.host ?? cur.host);
        await this.shimItemSet('relay', {
            host,
            token: patch.token ?? cur.token,
            alias: patch.alias ?? cur.alias,
            expiresSec: patch.expiresSec ?? cur.expiresSec,
            parks: patch.parks ? { ...cur.parks, ...patch.parks } : cur.parks,
            frames: patch.frames ? { ...cur.frames, ...patch.frames } : cur.frames,
            aliasTokens: patch.aliasTokens ?? cur.aliasTokens,
        });
        if (patch.host != null || host !== this.relayHost) {
            this.relayHost = host;
        }
        if (patch.token != null) this.relayToken = String(patch.token);
        if (patch.alias != null) this.relayAlias = String(patch.alias);
    }

    private relayExpiresAt(expiresSec: number): string {
        const sec = Math.max(
            60,
            Math.floor(expiresSec || DEFAULT_RELAY_EXPIRES_SEC)
        );
        return naviStampTime(new Date(Date.now() + sec * 1000));
    }

    private async ensureRelayLogTip(): Promise<NaviTipFrame> {
        let tip = await this.getTip(NAVI_RELAY_LOG_IB);
        if (!tip?.data) {
            tip = await this.stampTipFrame({
                ib: NAVI_RELAY_LOG_IB,
                gib: '',
                data: {
                    parts: ['ibgib_frame', 'manifest', 'json'],
                    about: {
                        label: NAVI_RELAY_LOG_IB,
                        description:
                            'relay event log — unbounded delta tip (one event per mut8; lineage via past)',
                    },
                },
                rel8ns: { past: [], tjp: [], dna: [] },
            });
            await this.setTip(tip);
        }
        return tip;
    }

    private formatRelayEventRow(row: Record<string, any>): string {
        return JSON.stringify({
            at: row.at,
            kind: row.kind,
            ...(row.alias != null ? { alias: row.alias } : {}),
            ...(row.ib != null ? { ib: row.ib } : {}),
            ...(row.remainder != null ? { remainder: row.remainder } : {}),
            ...(row.method != null ? { method: row.method } : {}),
            ...(row.path != null ? { path: row.path } : {}),
            ...(row.headers != null ? { headers: row.headers } : {}),
            ...(row.ok != null ? { ok: row.ok } : {}),
            ...(row.error != null ? { error: row.error } : {}),
        });
    }

    private extractRelayEvent(frame: NaviTipFrame): Record<string, any> | null {
        const ev = frame?.data?.event;
        return ev && typeof ev === 'object' ? ev : null;
    }

    private async logRelayUse(
        kind: string,
        detail: Record<string, any> = {}
    ): Promise<void> {
        try {
            const tip = await this.ensureRelayLogTip();
            const event = {
                at: naviStamp.time(),
                kind: String(kind || '').trim() || 'event',
                ...detail,
            };
            const patch: Record<string, any> = { event };
            if (tip.data?.parts) patch.parts = tip.data.parts;
            if (tip.data?.about) patch.about = tip.data.about;
            await this.mut8Tip(tip, patch, { replaceData: true });
        } catch (err) {
            this.callout(
                '[navi] relay log failed: ' + formatCalloutMessage(err)
            );
        }
    }

    private async ensureCallinLogTip(): Promise<NaviTipFrame> {
        let tip = await this.getTip(NAVI_CALLIN_IB);
        if (!tip?.data) {
            tip = await this.stampTipFrame({
                ib: NAVI_CALLIN_IB,
                gib: '',
                data: {
                    parts: ['ibgib_frame', 'manifest', 'json'],
                    about: {
                        label: NAVI_CALLIN_IB,
                        description:
                            'callin event log — unbounded delta tip (one callin per mut8; lineage via past)',
                    },
                },
                rel8ns: { past: [], tjp: [], dna: [] },
            });
            await this.setTip(tip);
        }
        return tip;
    }

    /** Append one callin as a delta tip frame on navi:callin:log. */
    private async logCallin(detail: Record<string, any> = {}): Promise<void> {
        try {
            const tip = await this.ensureCallinLogTip();
            const event = {
                at: naviStamp.time(),
                ...detail,
            };
            const patch: Record<string, any> = { event };
            if (tip.data?.parts) patch.parts = tip.data.parts;
            if (tip.data?.about) patch.about = tip.data.about;
            await this.mut8Tip(tip, patch, { replaceData: true });
        } catch (err) {
            this.callout(
                '[navi] callin log failed: ' + formatCalloutMessage(err)
            );
        }
    }

    private async relayLogTail(limit = 10): Promise<string> {
        const ib = NAVI_RELAY_LOG_IB;
        const want = Math.max(1, limit);
        const hits = (await this.tipSpan(ib, {
            dir: 'reverse',
            limit: want,
        })) as TipSpanHit[];
        const events = hits
            .map((h) => this.extractRelayEvent(h.frame))
            .filter((row): row is Record<string, any> => !!row);
        if (!events.length) {
            const tip = await this.getTip(ib);
            const legacy = Array.isArray(tip?.data?.events)
                ? tip!.data.events
                : [];
            if (!legacy.length) return 'relay log (empty)';
            const tail = legacy.slice(-want);
        return [
                `relay log (last ${tail.length}/${legacy.length}, legacy snapshot)`,
                ...tail.map((row) => this.formatRelayEventRow(row)),
            ].join('\n');
        }
        const total = (await this.listTipFrames(ib)).length || events.length;
        return [
            `relay log (last ${events.length}/${total})`,
            ...events.map((row) => this.formatRelayEventRow(row)),
        ].join('\n');
    }

    private relayHostBase(host?: string): string {
        const base =
            this.normalizeRelayHost(host) ||
            this.normalizeRelayHost(this.origin);
        if (!base) {
            throw new Error(
                'relay host empty — run relay host <url> or set navi.origin'
            );
        }
        const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(base)
            ? base
            : `https://${base}`;
        return withScheme.replace(/\/+$/, '');
    }

    private relayRequireOpen(): void {
        if (!this.relayWs || this.relayWs.readyState !== 1) {
            throw new Error(
                'relay not connected — run relay connect first'
            );
        }
    }

    private relayRequestId(): string {
        return naviStamp.uuid().replace(/-/g, '').slice(0, 16);
    }

    private relayRequest(
        msg: Record<string, unknown>,
        timeoutMs = 15_000
    ): Promise<any> {
        this.relayRequireOpen();
        const id = this.relayRequestId();
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.relayPending.delete(id);
                reject(new Error('relay request timeout'));
            }, timeoutMs);
            this.relayPending.set(id, { resolve, reject, timer });
            this.relaySend({ ...msg, id });
        });
    }

    private relayResolvePending(msg: any): void {
        const id = String(msg?.id || '');
        if (!id) return;
        const pending = this.relayPending.get(id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.relayPending.delete(id);
        if (msg.ok === false) {
            pending.reject(new Error(String(msg.error || 'relay failed')));
            return;
        }
        pending.resolve(msg);
    }

    private relayWsUrl(host: string, uuid: string, token: string): string {
        const u = new URL(`${this.relayHostBase(host)}/_foobarch/navi_shell`);
        u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
        u.searchParams.set('uuid', uuid);
        if (token) u.searchParams.set('token', token);
        return u.toString();
    }

    private relaySend(obj: Record<string, unknown>): void {
        if (!this.relayWs || this.relayWs.readyState !== 1) return;
        this.relayWs.send(JSON.stringify(obj));
    }

    private clearRelayReconnectTimer(): void {
        if (this.relayReconnectTimer) {
            clearTimeout(this.relayReconnectTimer);
            this.relayReconnectTimer = null;
        }
    }

    private stopRelayKeepalive(): void {
        if (this.relayKeepaliveTimer) {
            clearInterval(this.relayKeepaliveTimer);
            this.relayKeepaliveTimer = null;
        }
    }

    private startRelayKeepalive(): void {
        this.stopRelayKeepalive();
        this.relayKeepaliveTimer = setInterval(() => {
            if (!this.relayWs || this.relayWs.readyState !== 1) return;
            this.relaySend({ type: 'hello', uuid: this.installUuid || '' });
        }, RELAY_KEEPALIVE_MS);
    }

    private rejectRelayPending(reason: string): void {
        for (const pending of this.relayPending.values()) {
            clearTimeout(pending.timer);
            pending.reject(new Error(reason));
        }
        this.relayPending.clear();
    }

    private scheduleRelayReconnect(reason: string): void {
        if (!this.relayAutoReconnect || this.relayManualClose) return;
        if (this.relayReconnectTimer) return;
        const delay = Math.min(
            RELAY_RECONNECT_MAX_MS,
            RELAY_RECONNECT_BASE_MS * 2 ** this.relayReconnectAttempt
        );
        this.relayReconnectAttempt += 1;
        this.callout(
            `[navi] relay reconnect in ${Math.round(delay / 1000)}s (${reason})`
        );
        this.relayReconnectTimer = setTimeout(() => {
            this.relayReconnectTimer = null;
            void this.relayConnectAuto();
        }, delay);
    }

    private async relayConnectAuto(): Promise<void> {
        if (!this.relayAutoReconnect || this.relayManualClose) return;
        if (this.relayWs && this.relayWs.readyState === 1) return;
        try {
            await this.openRelaySocket();
        } catch (err) {
            if ((err as any)?.code === 'NO_TOKENS') {
                this.relayAutoReconnect = false;
                this.callout(
                    `[navi] relay stays down: ${formatCalloutMessage(err)}, then relay connect`
                );
                return;
            }
            this.callout(
                `[navi] relay reconnect failed: ${formatCalloutMessage(err)}`
            );
            this.scheduleRelayReconnect('retry');
        }
    }

    private clearRelayWelcomeTimer(): void {
        if (this.relayWelcomeTimer) {
            clearTimeout(this.relayWelcomeTimer);
            this.relayWelcomeTimer = null;
        }
    }

    /** Hand an unsettled hello token back to the stash (host never charged it). */
    private returnRelayPay(ws: WebSocket, why: string): void {
        const pay = this.relayPay;
        if (!pay || pay.ws !== ws) return;
        this.relayPay = null;
        this.clearRelayWelcomeTimer();
        void this.tokens.giveBack(pay.host, pay.token).then(
            (n) => {
                if (why) this.callout(`[navi] relay token returned to stash (${why}; ${n} unused)`);
            },
            () => undefined
        );
    }

    private onRelayWelcome(ws: WebSocket, msg: any): void {
        const pay = this.relayPay && this.relayPay.ws === ws ? this.relayPay : null;
        this.clearRelayWelcomeTimer();
        this.relayPay = null;
        if (msg.ok) {
            if (!pay) return;
            void this.tokens.count(pay.host).then(
                (n) => this.callout(`[navi] relay connect paid 1 token (${pay.token.slice(0, 16)}…; ${n} unused)`),
                () => undefined
            );
            return;
        }
        const error = String(msg.error || 'relay refused');
        const status = Number(msg.status) || 0;
        if (pay && !/consumed|invalid usage token/i.test(error)) {
            void this.tokens.giveBack(pay.host, pay.token);
        }
        if (status === 403 && /owner/i.test(error)) {
            this.relayAutoReconnect = false;
        }
        this.callout(`[navi] relay refused (${status || '?'}): ${error}`);
    }

    private async openRelaySocket(): Promise<void> {
        const uuid = await this.getInstallUuid();
        if (!uuid) throw new Error('no navi install uuid — reseed navi tip');
        const WS = (globalThis as any).WebSocket;
        if (typeof WS !== 'function') {
            throw new Error('WebSocket not available in this runtime');
        }
        if (this.relayWs) {
            this.relayManualClose = true;
            try {
                this.relayWs.close();
            } catch {
                /* ignore */
            }
            this.relayWs = null;
        }
        this.relayManualClose = false;
        this.relayConnecting = true;
      this.relayHost =
        this.normalizeRelayHost(this.relayHost) ||
        this.normalizeRelayHost(this.origin);
        const url = this.relayWsUrl(
            this.relayHost,
            uuid,
            this.relayToken
        );
        const owner = await this.relayOwnerSecret();
        const payHost = this.tokenStashOrigin(this.relayHost);
        let pay: string;
        try {
            pay = await this.tokens.take(payHost);
        } catch (err) {
            this.relayConnecting = false;
            throw err;
        }
        let ws: WebSocket;
        try {
            ws = new WS(url);
        } catch (err) {
            this.relayConnecting = false;
            await this.tokens.giveBack(payHost, pay);
            throw err;
        }
        this.relayPay = { ws, host: payHost, token: pay };
        this.attachRelaySocket(ws, owner);
    }

    private relayTeardown(manual: boolean): void {
        if (manual) {
            this.relayAutoReconnect = false;
            this.relayManualClose = true;
        }
        this.clearRelayReconnectTimer();
        this.stopRelayKeepalive();
        this.rejectRelayPending(
            manual ? 'relay disconnected' : 'relay socket closed'
        );
    }

    private relayUseCallout(msg: {
        remainder?: string;
        method?: string;
        path?: string;
        headers?: Record<string, string>;
        ok: boolean;
        error?: string;
    }): void {
        const method = String(msg.method || '').trim().toUpperCase() || 'GET';
        const path =
            String(msg.path || '').trim() ||
            `/${String(msg.remainder || '')}`;
        const lines = [
            `[navi] relay ${method} ${path}`,
            `at ${naviStamp.time()}`,
        ];
        if (!msg.ok && msg.error) {
            lines.push(`error: ${msg.error}`);
        }
        this.callout(lines.join('\n'));
    }

    private relayFailStatus(error: string): number {
        const low = String(error || '').toLowerCase();
        if (low.includes('empty remainder')) return 400;
        if (
            low.includes('blocked from relay') ||
            low.includes('privileged')
        ) {
            return 403;
        }
        if (low.includes('no navi park')) return 404;
        return 502;
    }

    private async handleRelayCallin(msg: {
        id?: string;
        alias?: string;
        remainder?: string;
        method?: string;
        path?: string;
        body?: string;
        headers?: Record<string, string>;
    }): Promise<void> {
        const id = String(msg.id || '');
        const remainder = String(msg.remainder || '')
            .replace(/^\/+/, '')
            .trim();
        const method = normalizeParkMethod(msg.method || 'GET', 'GET');
        const path = String(msg.path || '').trim();
        const body = msg.body == null ? '' : String(msg.body);
        const headers =
            msg.headers && typeof msg.headers === 'object'
                ? { ...msg.headers }
                : {};
        // Older hosts send no alias field; the request path still starts /navi-{alias}.
        const relayAlias =
            String(msg.alias || '').trim() ||
            (path.match(/^\/?navi-([a-zA-Z0-9._-]+)/)?.[1] ?? '');
        try {
            // Bare /navi-{alias}/ or /navi-{alias} — inherent ping (shell online).
            if (!remainder) {
                const uuid = await this.getInstallUuid();
                const prefs = await this.loadRelayPrefs();
                const payload = {
                    ok: true,
                    ping: true,
                    uuid: uuid || null,
                    alias: String(prefs.alias || this.relayAlias || '').trim() || null,
                    host: String(
                        this.relayHost || prefs.host || this.origin || ''
                    ).trim() || null,
                    at: new Date().toISOString(),
                };
                const media = JSON.stringify(payload);
                this.relayUseCallout({ ...msg, remainder: '', ok: true });
                void this.logRelayUse('callin', {
                    remainder: '',
                    method,
                    path: path || undefined,
                    ok: true,
                    ping: true,
                });
                this.relaySend({
                    type: 'result',
                    id,
                    ok: true,
                    media,
                    mime: 'application/json; charset=utf-8',
                });
                return;
            }
            // Remainder is a park path as-is (no navi/ auto-prefix).
            this.relayUseCallout({ ...msg, remainder, ok: true });
            // Relay always enters through callin — the park-pipe front door.
            const result = await this.dispatchCallin({
                path: remainder,
                method,
                headers,
                body,
                viaRelay: true,
                relayAlias,
            });
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
            const { media, mime } = this.coerceParkBody(result, { compact: true });
            void this.logRelayUse('callin', {
                remainder,
                method,
                path: path || undefined,
                headers: msg.headers,
                body_bytes: body.length || undefined,
                ok: true,
            });
            this.relaySend({ type: 'result', id, ok: true, media, mime });
        } catch (err) {
            const error = formatCalloutMessage(err);
            const status = this.relayFailStatus(error);
            const media = JSON.stringify(
                {
                    error,
                    via: 'navi_shell',
                    method,
                    path: path || undefined,
                    remainder,
                },
                null,
                2
            );
            void this.logRelayUse('callin', {
                remainder,
                method,
                path: path || undefined,
                headers: msg.headers,
                body_bytes: body.length || undefined,
                ok: false,
                error,
            });
            this.relayUseCallout({ ...msg, remainder, ok: false, error });
            this.relaySend({
                type: 'result',
                id,
                ok: false,
                error,
                status,
                media,
                mime: 'application/json; charset=utf-8',
            });
        }
    }

    /**
     * Browsers close open sockets when a page enters the back-forward cache.
     * Close it ourselves on pagehide (no console error), reconnect on restore.
     */
    private bindRelayPageLifecycle(): void {
        if (this.relayPageLifecycleBound || !isBrowserDocument()) return;
        this.relayPageLifecycleBound = true;
        window.addEventListener('pagehide', (ev: PageTransitionEvent) => {
            if (!ev.persisted || !this.relayAutoReconnect) return;
            this.clearRelayReconnectTimer();
            const ws = this.relayWs;
            if (!ws || ws.readyState > 1) return;
            this.relayManualClose = true;
            try {
                ws.close(1000, 'page hidden');
            } catch {
                /* ignore */
            }
        });
        window.addEventListener('pageshow', (ev: PageTransitionEvent) => {
            if (!ev.persisted || !this.relayAutoReconnect) return;
            this.relayManualClose = false;
            this.relayReconnectAttempt = 0;
            this.clearRelayReconnectTimer();
            void this.relayConnectAuto();
        });
    }

    private attachRelaySocket(ws: WebSocket, owner: string): void {
        this.bindRelayPageLifecycle();
        this.relayWs = ws;
        ws.addEventListener('open', () => {
            this.relayConnecting = false;
            this.relayReconnectAttempt = 0;
            this.clearRelayReconnectTimer();
            const pay = this.relayPay && this.relayPay.ws === ws ? this.relayPay.token : '';
            this.relaySend({ type: 'hello', uuid: this.installUuid || '', owner, pay });
            this.clearRelayWelcomeTimer();
            this.relayWelcomeTimer = setTimeout(() => {
                this.relayWelcomeTimer = null;
                this.returnRelayPay(ws, 'host did not charge for connect (older host)');
            }, RELAY_WELCOME_MS);
            this.startRelayKeepalive();
            const reconnect = this.relayEverConnected;
            this.relayEverConnected = true;
            void this.logRelayUse(reconnect ? 'reconnect' : 'connect', {
                host: this.relayHost,
                token: this.relayToken ? '(set)' : '(none)',
            });
            this.callout(
                reconnect
                    ? `[navi] relay reconnected ${this.relayHost}`
                    : `[navi] relay connected ${this.relayHost}`
            );
        });
        ws.addEventListener('message', (ev: MessageEvent) => {
            let msg: any;
            try {
                msg = JSON.parse(String(ev.data || ''));
            } catch {
                return;
            }
            if (msg && msg.type === 'welcome') {
                this.onRelayWelcome(ws, msg);
                return;
            }
            if (msg && msg.type === 'result' && msg.id) {
                this.relayResolvePending(msg);
                return;
            }
            if (msg && msg.type === 'callin') {
                // IndexedDB txs started inside the WS message callback often
                // never complete (list/get/put hang). Local callin is a click
                // handler, so the same export writes. Defer to a timer tick.
                setTimeout(() => {
                    void this.handleRelayCallin(msg);
                }, 0);
            }
        });
        ws.addEventListener('close', () => {
            this.returnRelayPay(ws, 'socket closed before the host answered');
            if (this.relayWs !== ws) return;
            this.relayWs = null;
            this.relayConnecting = false;
            this.stopRelayKeepalive();
            const manual = this.relayManualClose;
            this.rejectRelayPending(
                manual ? 'relay disconnected' : 'relay socket closed'
            );
            if (!manual) {
                void this.logRelayUse('disconnect', { host: this.relayHost });
                this.callout('[navi] relay disconnected');
                this.scheduleRelayReconnect('socket closed');
            }
            this.relayManualClose = false;
        });
        ws.addEventListener('error', () => {
            if (this.relayWs !== ws) return;
            this.callout('[navi] relay socket error');
            this.scheduleRelayReconnect('socket error');
        });
    }

    private async adminRelayStatus(): Promise<string> {
        const uuid = await this.getInstallUuid();
        const prefs = await this.loadRelayPrefs();
        const state =
            this.relayWs && this.relayWs.readyState === 1
                ? 'connected'
                : this.relayConnecting
                  ? 'connecting'
                  : 'disconnected';
        return [
            `relay ${state}`,
            `channel ${state === 'disconnected' ? 'none' : 'ws'}`,
            `uuid ${uuid || '(none)'}`,
            `host ${prefs.host || this.origin}`,
            `alias ${prefs.alias || '(none)'}`,
            `token ${prefs.token ? prefs.token.slice(0, 8) + '…' : '(none)'}`,
            `expires ${prefs.expiresSec}s`,
            `parks ${Object.keys(prefs.parks).length ? JSON.stringify(prefs.parks) : '(none)'}`,
            `alias tokens ${Object.keys(prefs.aliasTokens).join(', ') || '(none)'}`,
            `usage tokens ${await this.tokens.count(prefs.host || this.origin).catch(() => '?')} unused (1 spent per connect)`,
            `whitelist ${(await this.loadRelayWhitelist()).on ? 'ON (relay whitelist)' : 'off'}`,
        ].join('\n');
    }

    private sanitizeRelayAlias(raw: string): string {
        const alias = String(raw || '').trim();
        if (!alias || alias === '-' || alias === 'none') return '';
        if (/[\s/:]/.test(alias)) {
            throw new Error(
                'relay alias must not contain spaces, /, or : (e.g. phone, laptop)'
            );
        }
        return alias;
    }

    /**
     * connect args: [token|-] [alias] — host is set separately with `relay host`.
     * Single arg that is not a clear-marker / token-shaped value is treated as alias
     * so callers can `relay connect myalias` without the legacy `connect - alias`
     * form (which older shells persisted as host:"-").
     */
    private parseRelayConnectArgs(args: string[]): {
        token: string;
        alias: string;
    } {
        let token = String(args[1] ?? '').trim();
        let alias = String(args[2] || '').trim();
        // Legacy: ignore a leading host URL / hostname if someone still passes one.
        if (
            token &&
            (isAbsoluteHttpUrl(token) ||
                /^[a-z][a-z0-9+.-]*:\/\//i.test(token) ||
                (/^[a-z0-9.-]+\.[a-z]{2,}(?::\d+)?$/i.test(token) &&
                    !/^(new|clear|none|-)$/i.test(token)))
        ) {
            token = String(args[2] ?? '').trim();
            alias = String(args[3] || '').trim();
        }
        if (token === '-' || token === 'none') token = '';
        if (alias === '-' || alias === 'none') alias = '';
        // `relay connect edgey` → alias only (not a usage token).
        if (token && !alias) {
            const tokenShaped =
                token === 'new' ||
                token.length >= 32 ||
                /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
                    token
                );
            if (!tokenShaped) {
                alias = token;
                token = '';
            }
        }
        return { token, alias };
    }

    private relayAdvertiseFrame(
        alias: string,
        uuid: string,
        expiresSec: number,
        tokenSha = ''
    ): Record<string, any> {
        const leaf = `navi-${alias}`;
        const relay_expires_at = this.relayExpiresAt(expiresSec);
        return {
            ib: leaf,
            data: {
                parts: ['network_proposal', 'ibgib_frame', 'manifest', 'json'],
                park: 'capture',
                default_method: 'GET',
                navi_shell_uuid: uuid,
                relay_expires_at,
                ...(tokenSha ? { relay_token_sha256: tokenSha } : {}),
                method: {
                    GET: { kind: 'navi_shell', target: uuid, mode: 'async' },
                    POST: { kind: 'navi_shell', target: uuid, mode: 'async' },
                },
                about: {
                    label: `navi_shell relay ${alias}`,
                    description:
                        'GET or POST remainder is a navi park path under navi/ (e.g. surf/browse/horizon/enter → navi/surf/…). Bare /navi-{alias}/ returns an inherent ping JSON. Header X-Navi-Shell-Usage-Token: the alias token when relay_token_sha256 is set, else the shell token if the shell registered with one. Host rejects callins after relay_expires_at.',
                },
            },
            rel8ns: { past: [], tjp: [], dna: [] },
        };
    }

    public async relayCallin(args: string[]): Promise<string> {
        const sub = String(args[0] || 'help').trim().toLowerCase();
        if (sub === 'help' || sub === '-h') {
            return [
                'relay — foobarch host park callins (HTTP) + reverse websocket',
                '',
                '  relay status',
                '  relay host [url|origin]     show / set host (fallback navi.origin)',
                '  relay token [new|<token>|clear]',
                '  relay expire [seconds]     default park TTL for advertise (86400)',
                '  relay connect [token|-] [alias]   open websocket to saved relay host (spends 1 usage token)',
                '  relay tokens [add <token…> | file <path>]   usage tokens stashed for the relay host (tip tokens)',
                '  relay whitelist [on|off|allow <path> [via <alias>]|drop <path> [via <alias>]]   limit which park paths relay callers may reach (default off; mods add theirs; "via" = only through that alias)',
                '  relay whitelist trust|untrust <alias>   callers holding that alias token skip the whitelist (needs relay alias-token <alias>)',
                '  relay disconnect            close websocket (prefs kept)',
                '  relay advertise <alias> [expiresSec]   needs connect; re-advertise after host/shell update',
                '  relay alias-token [<alias> [new|<token>|clear]]   per-alias callin token (host checks its sha256)',
                '  relay retire [alias]        tombstone stored park on host (needs connect)',
                '  relay log [count]           tail relay:log (lineage, delta/event frames)',
            ].join('\n');
        }
        if (sub === 'status') return await this.adminRelayStatus();
        if (sub === 'whitelist') {
            const verb = String(args[1] || '').trim().toLowerCase();
            const usage =
                'usage: relay whitelist [on|off|allow <park/path> [via <alias>]|drop <park/path> [via <alias>]|trust <alias>|untrust <alias>]';
            if (verb === 'trust' || verb === 'untrust') {
                const alias = this.sanitizeRelayAlias(String(args[2] || ''));
                if (!alias) return usage;
                const w = await this.loadRelayWhitelist();
                const trust =
                    verb === 'trust' ? [...new Set([...w.trust, alias])] : w.trust.filter((a) => a !== alias);
                await this.saveRelayWhitelist({ trust });
                return await this.relayWhitelistText();
            }
            // Callin args split on / — rejoin the park path; optional trailing "via <alias>".
            const rest = args.slice(2).map((a) => String(a));
            const viaAt = rest.findIndex((a) => a.toLowerCase() === 'via');
            const path = relayWhitelistNorm((viaAt >= 0 ? rest.slice(0, viaAt) : rest).join('/'));
            const via = viaAt >= 0 ? this.sanitizeRelayAlias(rest[viaAt + 1] || '') : '';
            if (verb === 'on') await this.relayWhitelist.on();
            else if (verb === 'off') await this.relayWhitelist.off();
            else if (verb === 'allow' || verb === 'drop') {
                if (!path || (viaAt >= 0 && !via)) return usage;
                const w = await this.loadRelayWhitelist();
                const edit = (list: string[]) =>
                    verb === 'allow' ? [...new Set([...list, path])] : list.filter((p) => p !== path);
                if (via) {
                    const nextVia = { ...w.via, [via]: edit(w.via[via] || []) };
                    if (!nextVia[via].length) delete nextVia[via];
                    await this.saveRelayWhitelist({ via: nextVia });
                } else {
                    await this.saveRelayWhitelist({ paths: edit(w.paths) });
                }
            } else if (verb && verb !== 'status') {
                return usage;
            }
            return await this.relayWhitelistText();
        }
        if (sub === 'tokens') {
            const prefs = await this.loadRelayPrefs();
            const host = this.tokenStashOrigin(prefs.host || this.origin);
            const verb = String(args[1] || '').trim().toLowerCase();
            if (verb === 'add') {
                const r = await this.tokens.add(host, args.slice(2));
                return `relay tokens ${host}: +${r.added} (${r.count} unused)`;
            }
            if (verb === 'file') {
                // Callin args split on / and : — rebuild the path.
                const segs = args.slice(2).map((s) => String(s ?? '')).filter((s) => s !== '');
                if (!segs.length) return 'usage: relay tokens file <path>  (one token per line)';
                const file = /^[A-Za-z]$/.test(segs[0]) && segs.length > 1
                    ? `${segs[0]}:${segs.slice(1).join('/')}`
                    : /^(\.{1,2}|~)$/.test(segs[0])
                      ? segs.join('/')
                      : '/' + segs.join('/');
                const text = String(this.require('fs').readFileSync(file, 'utf8'));
                const r = await this.tokens.add(host, text);
                return `relay tokens ${host}: +${r.added} from ${file} (${r.count} unused) — delete the file now`;
            }
            if (verb) return 'usage: relay tokens [add <token…> | file <path>]';
            return `relay tokens ${host}: ${await this.tokens.count(host)} unused`;
        }
        if (sub === 'host') {
            const next = String(args[1] || '').trim();
            if (!next) {
                const prefs = await this.loadRelayPrefs();
                return prefs.host || this.normalizeRelayHost(this.origin) || '(none)';
            }
            if (
                next === '-' ||
                /^origin$/i.test(next) ||
                /^clear$/i.test(next) ||
                /^none$/i.test(next)
            ) {
                await this.saveRelayPrefs({ host: '' });
                this.relayHost = this.normalizeRelayHost(this.origin);
                return `relay host ${this.relayHost || '(none)'} (navi.origin)`;
            }
            const host = this.normalizeRelayHost(next);
            if (!/^(?:https?|wss?):\/\//i.test(host)) {
                throw new Error(
                    'relay host must start with http://, https://, ws://, or wss://'
                );
            }
            await this.saveRelayPrefs({ host });
            this.relayHost = host;
            return `relay host ${host}`;
        }
        if (sub === 'log') {
            const n = Math.max(1, Number(args[1]) || 10);
            return await this.relayLogTail(n);
        }
        if (sub === 'expire') {
            const raw = String(args[1] || '').trim();
            if (!raw) {
                const prefs = await this.loadRelayPrefs();
                return String(prefs.expiresSec);
            }
            const sec = Math.max(60, Math.floor(Number(raw) || 0));
            if (!Number.isFinite(sec) || sec < 60) {
                throw new Error(
                    'relay expire requires seconds >= 60 (e.g. relay expire 3600)'
                );
            }
            await this.saveRelayPrefs({ expiresSec: sec });
            return `relay expire ${sec}s`;
        }
        if (sub === 'token') {
            const next = String(args[1] || '').trim();
            if (!next) {
                const prefs = await this.loadRelayPrefs();
                return prefs.token || '(none)';
            }
            if (next === 'clear' || next === '-' || next === 'none') {
                await this.saveRelayPrefs({ token: '' });
                this.relayToken = '';
                return 'relay token cleared';
            }
            const token = next === 'new' ? naviStamp.uuid() : next;
            await this.saveRelayPrefs({ token });
            return `relay token set (${token.slice(0, 8)}…)`;
        }
        if (sub === 'disconnect') {
            this.relayTeardown(true);
            try {
                this.relayWs?.close();
            } catch {
                /* ignore */
            }
            this.relayWs = null;
            this.relayConnecting = false;
            void this.logRelayUse('disconnect', {
                host: this.relayHost,
                manual: true,
            });
            return 'relay disconnected';
        }
        if (sub === 'advertise') {
            const uuid = await this.getInstallUuid();
            if (!uuid) {
                throw new Error(
                    'no navi install uuid — run reseed force first'
                );
            }
            this.relayRequireOpen();
            const prefs = await this.loadRelayPrefs();
            const alias = this.sanitizeRelayAlias(args[1] || prefs.alias || '');
            if (!alias) {
                throw new Error(
                    'relay advertise requires an alias (e.g. relay advertise vip)'
                );
            }
            const expiresArg = String(args[2] || '').trim();
            const expiresSec = expiresArg
                ? Math.max(60, Math.floor(Number(expiresArg) || 0))
                : prefs.expiresSec;
            if (expiresArg && (!Number.isFinite(expiresSec) || expiresSec < 60)) {
                throw new Error(
                    'relay advertise expiresSec must be >= 60 seconds'
                );
            }
            const aliasToken = prefs.aliasTokens[alias] || '';
            const tokenSha = aliasToken ? await this.sha256Hex(aliasToken) : '';
            const stamped = await this.stampTipFrame(
                this.relayAdvertiseFrame(alias, uuid, expiresSec, tokenSha) as NaviTipFrame
            );
            let result;
            try {
                result = await this.relayRequest({
                    type: 'advertise',
                    frame: stamped,
                });
            } catch (err) {
                throw new Error(
                    `relay advertise ${alias} failed: ${formatCalloutMessage(err)}`
                );
            }
            const ib = String(stamped.ib || `navi-${alias}`);
            // Ping is by ib (navi-{alias}). Addr only proves the host tip advanced —
            // never save a local "renewed" expiry if the commit did not land.
            const addr = String(result.addr || '').trim();
            if (!addr) {
                throw new Error(
                    `relay advertise ${alias} failed: host returned no tip addr (commit did not land)`
                );
            }
            await this.saveRelayPrefs({
                alias,
                parks: { ...prefs.parks, [alias]: ib },
                frames: {
                    ...prefs.frames,
                    [alias]: { ib, addr, frame: stamped },
                },
            });
            void this.logRelayUse('advertise', {
                alias,
                ib,
                addr,
                relay_expires_at: stamped.data?.relay_expires_at,
            });
            return `advertised ${ib} → ${addr} (expires ${stamped.data?.relay_expires_at})${tokenSha ? ' [alias token required]' : ''}`;
        }
        if (sub === 'alias-token') {
            const prefs = await this.loadRelayPrefs();
            const alias = this.sanitizeRelayAlias(args[1] || '');
            if (!alias) {
                const rows = Object.keys(prefs.aliasTokens);
                return rows.length
                    ? rows.map((a) => `${a}: token set`).join('\n')
                    : 'no alias tokens (relay alias-token <alias> new)';
            }
            const next = String(args[2] || '').trim();
            if (!next) {
                const t = prefs.aliasTokens[alias];
                return t ? t : `${alias}: no alias token`;
            }
            const tokens = { ...prefs.aliasTokens };
            let msg: string;
            if (next === 'clear' || next === '-' || next === 'none') {
                delete tokens[alias];
                msg = `${alias}: alias token cleared`;
            } else {
                const token = next === 'new' ? naviStamp.uuid() : next;
                tokens[alias] = token;
                msg = `${alias}: alias token set → ${token}`;
            }
            await this.saveRelayPrefs({ aliasTokens: tokens });
            // Host enforces from the advertised hash — re-advertise so it applies now.
            if (prefs.parks[alias] && this.relayWs && this.relayWs.readyState === 1) {
                try {
                    return `${msg}\n${await this.relayCallin(['advertise', alias])}`;
                } catch (err) {
                    return `${msg}\nre-advertise failed (${formatCalloutMessage(err)}) — run relay advertise ${alias}`;
                }
            }
            return `${msg}\napply with: relay advertise ${alias}`;
        }
        if (sub === 'retire') {
            this.relayRequireOpen();
            const prefs = await this.loadRelayPrefs();
            const alias = this.sanitizeRelayAlias(
                args[1] || prefs.alias || ''
            );
            if (!alias) {
                throw new Error(
                    'relay retire [alias] — alias from arg or saved relay prefs'
                );
            }
            const stored = prefs.frames[alias];
            const ib =
                stored?.ib || prefs.parks[alias] || `navi-${alias}`;
            let result;
            try {
                result = await this.relayRequest({ type: 'retire', ib });
            } catch (err) {
                throw new Error(
                    `relay retire ${alias} failed: ${formatCalloutMessage(err)}`
                );
            }
            const addr = String(result.addr || '').trim();
            const parks = { ...prefs.parks };
            const frames = { ...prefs.frames };
            delete parks[alias];
            if (frames[alias]) {
                frames[alias] = {
                    ib,
                    addr: addr || frames[alias].addr,
                    frame: {
                        ...frames[alias].frame,
                        data: {
                            ...(frames[alias].frame?.data || {}),
                            tombstone: true,
                            retired: true,
                        },
                    },
                };
            }
            await this.saveRelayPrefs({
                parks,
                frames,
                alias: prefs.alias === alias ? '' : prefs.alias,
            });
            void this.logRelayUse('retire', { alias, ib, addr: addr || undefined });
            return addr ? `retired ${ib} → ${addr}` : `retired ${ib}`;
        }
        if (sub === 'connect') {
            // Host is mutable through `relay host`; connect takes no URL arg.
            const prefs = await this.loadRelayPrefs();
            const parsed = this.parseRelayConnectArgs(args);
            const host =
                this.normalizeRelayHost(prefs.host) ||
                this.normalizeRelayHost(this.origin);
            if (!host) {
                throw new Error(
                    'relay connect needs relay host <url> or navi.origin'
                );
            }
            const token =
                args[1] != null && String(args[1]).trim() !== ''
                    ? parsed.token
                    : prefs.token;
            const alias = parsed.alias || prefs.alias || '';
            const uuid = await this.getInstallUuid();
            if (!uuid) throw new Error('no navi install uuid — reseed navi tip');
            await this.saveRelayPrefs({ host, token, alias });
            this.relayHost = host;
            this.relayToken = token;
            this.relayAlias = alias;
            this.relayAutoReconnect = true;
            this.relayReconnectAttempt = 0;
            this.clearRelayReconnectTimer();
            await this.openRelaySocket();
            const url = this.relayWsUrl(host, uuid, token);
            const shown = token
                ? url.replace(/([?&])token=[^&]+/, '$1token=…')
                : url;
            return `relay connecting ${shown} (paying 1 usage token)`;
        }
        if (sub === 'connectws') {
            return [
                'relay connectws removed — use relay connect [token|-] [alias]',
                'set the host separately with relay host <url>',
            ].join('\n');
        }
        return `unknown relay subcommand: ${sub}\n\n${await this.relayCallin(['help'])}`;
    }
    
    private applyFoobarchPwaDefaultsIfRoot(): void {
        if (!isBrowserDocument()) {
            return;
        }

        const path = window.location.pathname;
        if (path !== '/' && path !== '') {
            return;
        }
        // Always apply shell defaults on / (theme_color #ffffff, etc.).
        // setPwa overlays same-origin /manifest.json via SW (installable; not blob:)
        // and upserts meta theme-color — even when the host already linked /manifest.json.
        this.setPwa(FOOBARCH_PWA_DEFAULTS);
    }


    private clearPwaManagedNodes(): void {
        if (!isBrowserDocument()) {
            return;
        }

        document.querySelectorAll(`[${PWA_MANAGED_ATTR}]`).forEach((node) => {
            node.remove();
        });
    }

    private revokePwaBlobUrl(): void {
        if (this.pwaBlobUrl) {
            URL.revokeObjectURL(this.pwaBlobUrl);
            this.pwaBlobUrl = null;
        }
    }

    /** Keep a fetchable same-origin manifest link (Chromium cannot install from blob:). */
    private ensureManifestLink(href: string): void {
        if (!isBrowserDocument()) {
            return;
        }
        let link = document.head.querySelector<HTMLLinkElement>('link[rel="manifest"]');
        if (!link) {
            link = document.createElement('link');
            link.setAttribute('rel', 'manifest');
            document.head.appendChild(link);
        }
        link.removeAttribute(PWA_MANAGED_ATTR);
        link.setAttribute('href', href);
    }

    private publishPwaManifestToSw(manifest: Record<string, unknown> | null): void {
        if (typeof navigator === 'undefined' || !navigator.serviceWorker) {
            return;
        }
        const manifestJson = manifest == null ? null : JSON.stringify(manifest);
        void this.postToServiceWorker({
            type: 'NAVI_PWA_MANIFEST',
            manifestJson,
        }).catch((error) => {
            this.callout(
                '[navi.pwa] SW manifest publish failed: ' + formatCalloutMessage(error)
            );
        });
    }

    private upsertManagedMeta(name: string, content: string): void {
        if (!isBrowserDocument()) {
            return;
        }

        let meta = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"][${PWA_MANAGED_ATTR}]`);
        if (!meta) {
            meta = document.createElement('meta');
            meta.setAttribute('name', name);
            meta.setAttribute(PWA_MANAGED_ATTR, '1');
            document.head.appendChild(meta);
        }
        meta.setAttribute('content', content);
    }

    private upsertManagedLink(rel: string, href: string, extra: Record<string, string> = {}): void {
        if (!isBrowserDocument()) {
            return;
        }

        let link = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"][${PWA_MANAGED_ATTR}]`);
        if (!link) {
            link = document.createElement('link');
            link.setAttribute('rel', rel);
            link.setAttribute(PWA_MANAGED_ATTR, '1');
            document.head.appendChild(link);
        }

        link.setAttribute('href', href);
        for (const [key, value] of Object.entries(extra)) {
            link.setAttribute(key, value);
        }
    }

    private updateURL(config: NaviPwaConfig): void {
        if (!isBrowserDocument() || config.replace_url === undefined || config.replace_url === false) {
            return;
        }

        const targetPath = typeof config.replace_url === 'string'
            ? config.replace_url
            : config.start_url;
        if (!targetPath) {
            return;
        }

        const normalized = targetPath.startsWith('/') ? targetPath : `/${targetPath}`;
        const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        if (current === normalized || window.location.pathname === normalized) {
            return;
        }

        window.history.replaceState(window.history.state, '', normalized);
    }

    public setPwa(config: NaviPwaConfig): void {
        if (!isBrowserDocument()) {
            this.callout('[navi.pwa] set ignored — browser document required');
            return;
        }

        const resolved: NaviPwaConfig = { ...config };
        if (
            (resolved.start_url == null || String(resolved.start_url).trim() === '') &&
            typeof window !== 'undefined'
        ) {
            resolved.start_url = window.location.pathname || '/';
        }

        this.revokePwaBlobUrl();
        this.clearPwaManagedNodes();
        this.pwaConfig = { ...resolved };

        const manifest = buildWebManifest(resolved);
        if (Object.keys(manifest).length === 0) {
            throw new Error('[navi-error] [navi-error]navi.pwa.set requires at least one manifest field');
        }

        const icons = resolved.icons ?? [];
        const badIcon = icons.find((icon) => /^(blob:|data:)/i.test(String(icon.src ?? '')));
        if (badIcon) {
            this.callout(
                '[navi.pwa] icon src must be same-origin http(s) path for installability (not blob:/data:)'
            );
        }

        this.pwaManifestRev += 1;
        this.ensureManifestLink(`/manifest.json?navi=${this.pwaManifestRev}`);
        this.publishPwaManifestToSw(manifest);

        const title = resolved.title ?? resolved.name;
        if (title) {
            document.title = title;
        }

        if (resolved.theme_color) {
            this.upsertManagedMeta('theme-color', resolved.theme_color);
            // Chrome uses the first matching theme-color; keep host metas in sync.
            document.head.querySelectorAll('meta[name="theme-color"]').forEach((el) => {
                el.setAttribute('content', resolved.theme_color as string);
            });
        }

        const appName = resolved.short_name ?? resolved.name;
        if (appName) {
            this.upsertManagedMeta('application-name', appName);
        }

        const appleTitle = resolved.apple_mobile_web_app_title ?? resolved.short_name ?? resolved.name;
        if (appleTitle) {
            this.upsertManagedMeta('apple-mobile-web-app-title', appleTitle);
        }

        const appleCapable = resolved.apple_mobile_web_app_capable ?? true;
        if (appleCapable) {
            this.upsertManagedMeta('apple-mobile-web-app-capable', 'yes');
            this.upsertManagedMeta("mobile-web-app-capable", "yes");
        }

        if (icons.length > 0) {
            const primaryIcon = icons[0];
            this.upsertManagedLink('icon', normalizePwaAssetUrl(primaryIcon.src), {
                type: primaryIcon.type ?? 'image/png',
            });
        }

        const appleTouchIcon = pickAppleTouchIcon(icons);
        if (appleTouchIcon) {
            this.upsertManagedLink('apple-touch-icon', normalizePwaAssetUrl(appleTouchIcon.src), {
                ...(appleTouchIcon.sizes ? { sizes: appleTouchIcon.sizes } : {}),
            });
        }

        this.updateURL(resolved);
        this.emit('pwa', { action: 'set', config: { ...resolved } });
        this.callout(
            `[navi.pwa] Applied PWA identity: ${resolved.name ?? resolved.short_name ?? 'unnamed'} (start_url ${resolved.start_url})`
        );
        void this.ensureShellCache();
    }

    public clearPwa(): void {
        this.revokePwaBlobUrl();
        this.clearPwaManagedNodes();
        this.pwaConfig = null;
        this.hostManifestHref = null;

        if (isBrowserDocument()) {
            this.ensureManifestLink('/manifest.json');
            this.publishPwaManifestToSw(null);
            this.emit('pwa', { action: 'clear' });
        }
    }

    public getPwaConfig(): NaviPwaConfig | null {
        return this.pwaConfig ? { ...this.pwaConfig } : null;
    }

    public callout(data: any): void {
        this.emit('callout', data);
    }

    /**
     * Host-side Node require for localnavi modules.
     */
    public require(id: string): any {
        if (!isNodeRuntime()) {
            throw new Error('[navi-error] navi.require is Node/localnavi-only');
        }
        if (typeof id !== 'string' || !id.trim()) {
            throw new Error('[navi-error] navi.require(id) needs a non-empty module id');
        }
        // Host CJS require (pkg-safe for Node builtins).
        return require(id);
    }

    private async resolveNaviCall(path: string[], args: any[]): Promise<any> {
        let current: any = this;
        for (let i = 0; i < path.length - 1; i++) {
            const key = path[i];
            if (current == null || current[key] === undefined) {
                throw new Error(`Unknown navi path segment: ${path.slice(0, i + 1).join('.')}`);
            }
            current = current[key];
        }

        const methodName = path[path.length - 1];
        const method = current?.[methodName];
        if (typeof method !== 'function') {
            throw new Error(`navi:${path.join('.')} is not callable`);
        }

        return await method.apply(current, args);
    }

    /**
     * Callin — front door of the park pipe.
     *
     *   callin → localpark (capture / tip) → hostpark (when applicable) → callout
     *
     * String form defaults to POST (local REPL / `navi('…')`).
     * Object form may set method (GET for direct URL), headers, body, viaRelay.
     * Host relay always enters here (`viaRelay: true`).
     *
     *   navi('surf horizon/enter')
     *   navi.callin({ input: 'fsdevopstracker/append', method: 'POST', body: '{…}' })
     *   /navi/… URL → callin({ path, method: 'GET' })
     */
    public async dispatchCallin(input: NaviCallinInput): Promise<any> {
        const req = this.normalizeCallinInput(input);
        this.emit('callin', req);
        const bodyBytes =
            req.body != null && String(req.body).length
                ? String(req.body).length
                : undefined;
        const baseLog = {
            method: req.method,
            path: req.path || '',
            viaRelay: !!req.viaRelay,
            ...(bodyBytes != null ? { body_bytes: bodyBytes } : {}),
        };
        if (!req.path) {
            void this.logCallin({ ...baseLog, ok: true, skipped: 'empty' });
            return undefined;
        }
        if (req.viaRelay && !(await this.relayWhitelistAllows(req.path, req.relayAlias))) {
            const error = `blocked from relay: ${relayWhitelistNorm(req.path) || '(empty)'} is not on the relay whitelist${req.relayAlias ? ` for alias ${req.relayAlias}` : ''}`;
            void this.logCallin({ ...baseLog, ok: false, error });
            throw new Error(error);
        }

        return callinScope
            ? await callinScope.run(req, () => this.runCallin(req, baseLog))
            : await this.runCallin(req, baseLog);
    }

    private async runCallin(
        req: NaviCallinRequest,
        baseLog: Record<string, unknown>
    ): Promise<any> {
        const prev = this.callinSlot;
        this.callinSlot = req;
        // Local POST callin owns the text callout stream. GET (URL / frame
        // method.GET snapshots) and viaRelay use their own response channels.
        const streamCallout = req.method === 'POST' && !req.viaRelay;
        try {
            const result = await this.dispatchParkPath(req.path, {
                method: req.method,
                viaRelay: req.viaRelay,
                callin: true,
                hostPin: req.hostPin !== false,
                parkBypass: !!req.parkBypass,
                headers: req.headers,
                body: req.body,
                request: req,
            });
            void this.logCallin({ ...baseLog, ok: true });
            if (result !== undefined && streamCallout) {
                this.emit('callout', result);
            }
            return result;
        } catch (error) {
            void this.logCallin({
                ...baseLog,
                ok: false,
                error: formatCalloutMessage(error),
            });
            if (streamCallout) {
            this.callout('Error: ' + formatCalloutMessage(error));
            }
            throw error;
        } finally {
            if (this.callinSlot === req) this.callinSlot = prev;
        }
    }

    /** Alias — same as dispatchCallin (front door). */
    public callin = (input: NaviCallinInput) => this.dispatchCallin(input);

    private normalizeCallinInput(input: NaviCallinInput): NaviCallinRequest {
        if (typeof input === 'string') {
            const trimmed = String(input ?? '').trim();
            return {
                method: 'POST',
                headers: {},
                body: '',
                viaRelay: false,
                hostPin: true,
                parkBypass: false,
                path: trimmed ? this.callinToParkPath(trimmed) : '',
            };
        }
        const method = normalizeParkMethod(input?.method, 'POST');
        const headers =
            input?.headers && typeof input.headers === 'object'
                ? { ...input.headers }
                : {};
        const body = input?.body == null ? '' : String(input.body);
        const viaRelay = !!input?.viaRelay;
        const hostPin = input?.hostPin !== false;
        const parkBypass =
            !!input?.parkBypass || this.parkBypassFromHeaders(headers);
        const relayAlias = viaRelay ? String(input?.relayAlias || '').trim() : '';
        const extra = relayAlias ? { relayAlias } : {};
        // Explicit path = literal park address (never presume navi:).
        if (input?.path != null && String(input.path).trim()) {
            let lit = String(input.path).trim().replace(/^\/+/, '');
            try {
                lit = decodeURIComponent(lit);
            } catch {
                /* keep */
            }
            return {
                method,
                headers,
                body,
                viaRelay,
                hostPin,
                parkBypass,
                ...extra,
                path: lit ? normalizeTipIb(lit) : '',
            };
        }
        const raw = String(input?.input ?? '').trim();
        return {
            method,
            headers,
            body,
            viaRelay,
            hostPin,
            parkBypass,
            ...extra,
            path: raw ? this.callinToParkPath(raw) : '',
        };
    }

    /**
     * Build a park path from callin text.
     * Never auto-prefixes navi/. Space / : / / are delimiter-race equivalents
     * (via ibSegments); write `navi relay` / `navi/relay` when you want the navi ns.
     */
    private callinToParkPath(trimmed: string): string {
        let raw = String(trimmed || '').trim().replace(/^\/+/, '');
        if (!raw) return '';
        try {
            raw = decodeURIComponent(raw);
        } catch {
            /* keep */
        }
        const tokens = raw.split(/\s+/).filter((t) => t.length > 0);
        const segs: string[] = [];
        for (const t of tokens) {
            // Absolute URLs must survive park-path round-trip (: and / are
            // ib delimiters). Args are decodeURIComponent'd on capture peel.
            if (isAbsoluteHttpUrl(t)) {
                segs.push(encodeURIComponent(t));
                continue;
            }
            const parts = ibSegments(t);
            if (parts.length) segs.push(...parts);
            else segs.push(t);
        }
        return segs.join('/');
    }

    /**
     * Shared park pipe after callin normalizes path + multiplex.
     * Callin is the front door; this is localpark resolution for a
     * normalized path + method (GET URL / POST callin / relay either).
     */
    private async dispatchParkPath(
        rawIb: string,
        opts?: {
            method?: ParkMethod;
            callin?: boolean;
            viaRelay?: boolean;
            /** Default true. park.check sets false (local only). */
            hostPin?: boolean;
            /** Skip localpark; force hostpark pin/refresh (X-Navi-Park-Bypass). */
            parkBypass?: boolean;
            headers?: Record<string, string>;
            body?: string;
            request?: NaviCallinRequest;
        }
    ): Promise<any> {
        const ib = normalizeTipIb(rawIb);
        if (!ib) throw new Error('empty park path');
        const method = normalizeParkMethod(opts?.method, 'GET');
        const viaRelay = !!opts?.viaRelay;
        const hostPin = opts?.hostPin !== false;
        const parkBypass =
            !!opts?.parkBypass || this.parkBypassFromHeaders(opts?.headers);
        const gatePassthru = this.gatePassthruFromInit({
            headers: opts?.headers,
        });
        const miss = (label: string) =>
            viaRelay
                ? new Error(`no navi park for ${label}`)
                : new Error(`no tip frame for park ${label}`);

        const unitPeel = await this.peelUnitFromIb(ib);
        const workIb = unitPeel
            ? unitPeel.restSegs.length
                ? unitPeel.restSegs.join('/')
                : unitPeel.unitIb
            : ib;
        const explicitUnit = unitPeel?.unitIb || null;
        const execOpts = {
            method,
            viaRelay,
            callin: !!opts?.callin,
            request: opts?.request,
        };

        return await this.withCallUnit(explicitUnit, async () => {
            if (unitPeel && !unitPeel.restSegs.length) {
                const tip = await this.getTip(unitPeel.unitIb);
                if (!tip?.data) throw miss(unitPeel.unitIb);
                return tip;
            }

            // Callin park bypass: skip local tip/capture; re-pin from hostpark.
            if (parkBypass) {
                if (!hostPin) {
                    throw miss(workIb);
                }
                const hostCap = await this.tryHostParkPin(workIb, method, {
                    forceRefresh: true,
                });
                if (hostCap) {
                    return await this.executeParkTip(
                        hostCap.tip,
                        hostCap.tipIb,
                        hostCap.args,
                        execOpts
                    );
                }
                throw miss(workIb);
            }

            const cap = await this.resolveModParkCapture(workIb, {
                method,
                viaRelay,
                callin: !!opts?.callin,
            });
            if (cap) {
                return await this.executeParkTip(
                    cap.tip,
                    cap.tipIb,
                    cap.args,
                    execOpts
                );
            }

            let tip = await this.getTip(workIb, { gatePassthru });
            if (!tip?.data) {
                if (hostPin) {
                    const hostCap = await this.tryHostParkPin(workIb, method);
                    if (hostCap) {
                        return await this.executeParkTip(
                            hostCap.tip,
                            hostCap.tipIb,
                            hostCap.args,
                            execOpts
                        );
                    }
                }
                throw miss(workIb);
            }
            const ctrl = parkMethodCtrl(tip, method);
            if (!ctrl && isStrictParkMethod(method)) {
                throw new Error(
                    `park ${tip.ib || workIb} has no method.${method}`
                );
            }
            return await this.executeParkTip(tip, tip.ib || workIb, [], execOpts);
        });
    }

    /**
     * Run a resolved park tip for `method`: mod-like kinds mount/dispatch,
     * frame (or no control) returns the frame, bin serves the selected bin.
     * A POST bin served as application/navi-script runs through navi.script()
     * (JS: the bin is one program; callin: each line is a POST).
     */
    private async executeParkTip(
        tip: NaviTipFrame,
        tipIb: string,
        args: string[],
        opts: {
            method: ParkMethod;
            viaRelay: boolean;
            callin: boolean;
            request?: NaviCallinRequest;
        }
    ): Promise<any> {
        const { method, viaRelay } = opts;
        const ctrl = parkMethodCtrl(tip, method);
        const kind = String(ctrl?.kind || '').toLowerCase();
        if (
            kind === 'mod' ||
            kind === 'surface' ||
            kind === 'relay' ||
            kind === 'navi_root'
        ) {
            return await this.executeModPark(tip, tipIb, args, null, {
                method,
                viaRelay,
                callin: opts.callin,
                denyKinds: viaRelay ? ['navi_root'] : undefined,
                request: opts.request,
            });
        }
        const hasBin =
            Array.isArray(tip.rel8ns?.bin) && tip.rel8ns!.bin.length > 0;
        // storage.file records declare no method; a GET serves the file itself.
        const fileGet = !kind && method === 'GET' && hasBin && tip.data?.shim === 'file';
        if (kind === 'frame' || (!kind && !fileGet)) {
            return tip;
        }
        if (kind !== 'bin' && !hasBin) {
            throw new Error(`park ${tipIb} kind '${kind}' is not dispatchable`);
        }

        const pick = selectParkBinRef(tip, kind === 'bin' ? ctrl : null, args);
        if ('error' in pick) {
            throw new Error(`park ${tipIb}: ${pick.error}`);
        }
        let media: string;
        let binMime = '';
        if (pick.selected) {
            let bin = await this.getBin(pick.sha);
            if (!bin?.media) {
                const snap = await this.fetchHostFrameSnapshot(tipIb, [pick.sha]);
                const got = snap?.bins.find((b) => b.sha === pick.sha);
                if (got) {
                    await this.putBin(got.sha, { media: got.media, mime: got.mime });
                    bin = { ...got };
                }
            }
            if (!bin?.media) {
                throw new Error(`[navi] missing bin ${pick.sha} for park ${tipIb}`);
            }
            media = bin.media;
            binMime = bin.mime;
        } else {
            media = await this.loadBinMediaFromTip(tip.ib || tipIb);
        }
        const mime =
            String(
                ctrl?.content_type ||
                    tip.data?.content_type ||
                    tip.data?.mime ||
                    binMime ||
                    'application/octet-stream'
            ) || 'application/octet-stream';

        if (
            method === 'POST' &&
            mime.split(';')[0].trim().toLowerCase() === NAVI_SCRIPT_MIME
        ) {
            const mode =
                String(ctrl?.script_mode || tip.data?.script_mode || 'js').toLowerCase() ===
                'callin'
                    ? 'callin'
                    : 'js';
            this.bindCallinRequest(opts.request);
            const run = await this.script(naviScriptFromBin(media, mode), {
                mode,
                args: ctrl?.select ? args.slice(1) : args,
                onError:
                    String(ctrl?.on_error || '').toLowerCase() === 'continue'
                        ? 'continue'
                        : 'stop',
                viaRelay,
                label: tipIb,
            });
            return { script: true, mode, ...run };
        }
        return { media, mime };
    }

    /**
     * Execute a resolved park using the tip's method[method] control.
     * URL park → GET; callin → POST. Most tips mirror GET/POST; surfaces
     * often snapshot on GET and execute on POST.
     */
    private async executeModPark(
        tipIn: NaviTipFrame,
        tipIb: string,
        args: string[],
        commandOverride: string | null,
        opts?: {
            method?: ParkMethod;
            denyKinds?: string[];
            viaRelay?: boolean;
            callin?: boolean;
            request?: NaviCallinRequest;
        }
    ): Promise<any> {
        const method = normalizeParkMethod(opts?.method, 'GET');
        const viaRelay = !!opts?.viaRelay;
        let tip = tipIn;

        const ctrl = parkMethodCtrl(tip, method);
        if (!ctrl) {
            throw new Error(`park ${tipIb} has no method.${method}`);
        }
        const kind = String(ctrl.kind || '').toLowerCase();
        if (opts?.denyKinds?.includes(kind)) {
            throw new Error(
                `kind=${kind} is blocked from this access path`
            );
        }

        if (kind === 'relay') {
            if (viaRelay) {
                return 'relay is local-only.';
            }
            return await this.relayCallin(args);
        }
        if (kind === 'navi_root') {
            throw new Error(
                `kind=navi_root retired — use flat tips (navi:reseed, navi:factoryreset, …)`
            );
        }

        if (kind === 'surface') {
            this.bindCallinRequest(opts?.request);
            return await this.executeSurfacePark(tip, tipIb, args, {
                method,
            });
        }

        if (kind === 'frame') {
            return tip;
        }

        if (kind !== 'mod') {
            throw new Error(
                `park ${tipIb} method.${method}.kind is '${ctrl.kind}', expected 'mod' or 'surface'`
            );
        }

        const index = await this.getTip(NAVI_MOD_INDEX_IB);
        if (!index?.data) {
            throw new Error(`navi:mod tip missing — cannot dispatch ${tipIb}`);
        }

        const target = String(ctrl.target || '').trim();
        if (!target) {
            throw new Error(`park ${tipIb} method.${method} must set target`);
        }

        if (!this.mod?.[target]) {
            let media: string | null = null;
            try {
                media = await this.loadBinMediaFromTip(tipIb);
            } catch {
                media = null;
            }
            if (!media) {
                try {
                    media = await this.loadBinMediaFromTip(moduleParkIb(target));
                } catch {
                    media = null;
                }
            }
            if (!media) {
                media = await this.fetchHostModuleMedia(tipIb);
            }
            if (!media) {
                throw new Error(
                    `navi.mod.${target} not mounted and no tip+bin to remount for ${tipIb}`
                );
            }
            await this.mount(media, {
                record: true,
                parkTipIb: tipIb,
            });
            const refreshed = await this.getTip(tipIb);
            if (refreshed?.data) tip = refreshed;
        }

        const liveCtrl = parkMethodCtrl(tip, method) || ctrl;
        const altCommands = parkMethodCommands(tip, method);

        let commandName =
            commandOverride || String(liveCtrl.command || '').trim();
        let cmdArgs = args.slice();

        if (
            !commandOverride &&
            cmdArgs.length &&
            altCommands.includes(cmdArgs[0])
        ) {
            commandName = cmdArgs[0];
            cmdArgs = cmdArgs.slice(1);
        }

        if (!commandName) {
            throw new Error(
                `park ${tipIb} method.${method} must set command`
            );
        }
        if (altCommands.length && !altCommands.includes(commandName)) {
            throw new Error(
                `command '${commandName}' not in ${tipIb} data.method.${method}.commands`
            );
        }

        const mod = this.mod?.[target];
        const command = mod?.commands?.[commandName];
        if (!mod || !command || typeof command.execute !== 'function') {
            throw new Error(
                `navi.mod.${target}.commands.${commandName} not available`
            );
        }

        this.bindCallinRequest(opts?.request);
        return await command.execute(...cmdArgs);
    }

    /**
     * kind=surface — GET → snapshot; POST → execute (verbs / methods).
     */
    private async executeSurfacePark(
        tip: NaviTipFrame,
        tipIb: string,
        args: string[],
        opts?: { method?: ParkMethod }
    ): Promise<any> {
        const method = normalizeParkMethod(opts?.method, 'GET');
        const ctrl = parkMethodCtrl(tip, method);
        const target = String(ctrl?.target || '').trim();
        if (!target) {
            throw new Error(`park ${tipIb} surface control must set target`);
        }

        const live = this.resolveSurfaceTarget(target);
        const about = tip.data.about || null;

        // GET = describe / access contract. POST = invoke.
        // Plug presence is async (Ed25519 sign) — handle before sync snapshot.
        if (method === 'GET') {
            if (target === 'plug') return await this.plugPresence();
            return this.surfaceSnapshot(target, live, about);
        }

        const snapshot =
            target === 'plug'
                ? await this.plugPresence()
                : this.surfaceSnapshot(target, live, about);

        const isVerb = this.surfaceTargetIsVerb(target);
        if (!args.length && !isVerb) {
            return snapshot;
        }

        if (target === 'reseed') {
            return await this.reseedTips(String(args[0] || '') === 'force');
        }
        if (target === 'factoryreset') {
            return await this.factoryResetSpace();
        }
        if (target === 'reindex') {
            return await this.reindexUnitMods();
        }
        if (target === 'alias') {
            return await this.aliasUnit(args[0], args[1]);
        }
        if (target === 'prune') {
            return await this.pruneUnits(String(args[0] || 'offline'));
        }
        if (target === 'resolve') {
            return await this.resolveUnitDefault(args[0]);
        }
        if (target === 'heartbeat') {
            return await this.heartbeatUnitControl(args[0]);
        }
        if (target === 'storage') {
            const verb = String(args[0] || '').trim();
            if (verb === 'kill') {
                // Remainder segs were split by delimiter race — rejoin tip ib.
                return await this.storage.kill(...args.slice(1));
            }
            return snapshot;
        }
        if (target === 'plug') {
            const verb = String(args[0] || '').trim() || 'ping';
            if (verb === 'ensure') return await this.ensureUnit();
            if (verb === 'touch') {
                return await this.touchEntryPlug();
            }
            if (verb === 'ping') {
                return await this.revealEntryPlug();
            }
            return await this.plugPresence();
        }
        if (target === 'unit') {
            const verb = String(args[0] || '').trim();
            if (verb === 'list' || !verb) {
                return { units: await this.loadUnitsState() };
            }
            return snapshot;
        }

        if (typeof live === 'function') {
            return await live(...args);
        }

        if (live && typeof live === 'object') {
            const methodName = String(args[0] || '').trim();
            const rest = args.slice(1);
            if (methodName && typeof (live as any)[methodName] === 'function') {
                return await (live as any)[methodName](...rest);
            }
            // Nested surface: navi('pwa shell refresh') → pwa.shell.refresh()
            const nested = methodName ? (live as any)[methodName] : null;
            if (nested && typeof nested === 'object') {
                const sub = String(rest[0] || '').trim();
                if (sub && typeof nested[sub] === 'function') {
                    return await nested[sub](...rest.slice(1));
                }
                if (!sub) {
                    return {
                        ...snapshot,
                        methods: Object.keys(nested).filter(
                            (k) => typeof nested[k] === 'function'
                        ),
                    };
                }
            }
            if (target === 'origin' && args[0] != null) {
                this.origin = String(args[0]);
                return this.origin;
            }
            if (target === 'stamp') {
                if (methodName === 'time') return naviStamp.time(rest[0]);
                if (methodName === 'uuid') return naviStamp.uuid();
                if (!methodName) return naviStamp();
            }
        }

        return snapshot;
    }

    private surfaceTargetIsVerb(target: string): boolean {
            return [
            'reseed',
            'factoryreset',
            'reindex',
            'alias',
            'prune',
            'resolve',
            'heartbeat',
            'plug',
            'unit',
        ].includes(target);
    }

    private surfaceTargetIsExecutable(target: string): boolean {
        return (
            this.surfaceTargetIsVerb(target) ||
            [
                'storage',
                'stamp',
                'origin',
                'park',
                'pwa',
                'sw',
                'fetch',
            ].includes(target)
        );
    }

    /**
     * Silent entry-plug bond check (presence + hash on navi:unit list).
     * For heartbeat / online — never confirm or reveal entry-plug data.
     */
    private async isEntryPlugBonded(): Promise<boolean> {
        if (!this.entryPlug?.unitIb || !this.entryPlug?.hash) return false;
        const sys = await this.loadUnitsState();
        return !!(sys.list || []).find(
            (r: any) =>
                r &&
                tipIbsMatch(String(r.ib || ''), this.entryPlug!.unitIb) &&
                String(r.hash || '') === String(this.entryPlug!.hash)
        );
    }

    /** Permission gate — bonded entry-plug + user confirm. Not for heartbeat. */
    private async requireEntryPlugGate(op: string): Promise<void> {
        if (!this.entryPlug?.unitIb || !this.entryPlug?.hash) {
            throw new Error(`[${op}] entry-plug required`);
        }
        if (!(await this.isEntryPlugBonded())) {
            throw new Error(
                `[${op}] entry-plug not bonded on ${NAVI_UNIT_SYSTEM_IB}`
            );
        }
        if (typeof globalThis.confirm === 'function') {
            if (
                !globalThis.confirm(
                    `[navi] allow ${op} via entry-plug of ${this.entryPlug!.unitIb}?`
                )
            ) {
                throw new Error(`[${op}] aborted — entry-plug access rejected`);
            }
        }
    }

    private resolveSurfaceTarget(target: string): any {
        switch (target) {
            case 'stamp':
                return this.stamp;
            case 'origin':
                return this.origin;
            case 'park':
                return this.park;
            case 'pwa':
                return this.pwa;
            case 'sw':
                return this.sw;
            case 'fetch':
                return this.fetchPath.bind(this);
            case 'unit':
                return { tip: NAVI_UNIT_SYSTEM_IB };
            case 'plug':
                return this.plug;
            case 'native':
            case 'localnavi':
                return {
                    node: isNodeRuntime(),
                    exe: isLocalnaviExe(),
                    browser: isBrowserDocument(),
                };
            case 'storage':
                return this.storage;
            case 'reseed':
                return this.reseed;
            case 'factoryreset':
                return this.factoryreset;
            case 'alias':
            case 'prune':
            case 'resolve':
            case 'heartbeat':
            case 'reindex':
                return { target };
            default:
                throw new Error(`unknown surface target '${target}'`);
        }
    }

    /** Redacted entry-plug presence — no hash. For GET / snapshot. Signed. */
    private async plugPresence(): Promise<EntryPlugView> {
        return this.signedEntryPlugView({ reveal: false });
    }

    /**
     * Reveal full entry-plug (hash + fresh stamp). Browser prompts confirm.
     * Private key never included — only publicKey + signature over the view.
     */
    private async revealEntryPlug(): Promise<EntryPlugView | null> {
        if (!this.entryPlug) return null;
        if (typeof globalThis.confirm === 'function') {
            if (
                !globalThis.confirm(
                    `[navi:plug] reveal entry-plug of ${this.entryPlug.unitIb}?`
                )
            ) {
                throw new Error('[plug ping] aborted — confirmation failed');
            }
        }
        const now = naviStamp();
        this.entryPlug = {
            ...this.entryPlug,
            stamp: now,
            last_seen: now.timestamp,
        };
        return this.signedEntryPlugView({ reveal: true });
    }

    private surfaceSnapshot(
        target: string,
        live: any,
        about: any
    ): Record<string, any> {
        const base: Record<string, any> = {
            kind: 'surface',
            target,
            about,
        };
        if (target === 'origin') {
            base.value = String(live ?? '');
            return base;
        }
        if (target === 'stamp') {
            base.api = ['time', 'uuid'];
            return base;
        }
        if (target === 'unit') {
            base.tip = NAVI_UNIT_SYSTEM_IB;
            base.access = { GET: 'snapshot', POST: 'list' };
            return base;
        }
        if (target === 'plug') {
            return {
                kind: 'surface',
                target: 'plug',
                about,
                note: 'use GET/POST plug for signed presence',
            };
        }
        if (target === 'native' || target === 'localnavi') {
            return {
                kind: 'surface',
                target: 'native',
                node: isNodeRuntime(),
                exe: isLocalnaviExe(),
                browser: isBrowserDocument(),
                access: {
                    GET: 'snapshot',
                    POST: 'snapshot',
                },
            };
        }
        if (target === 'pwa') {
            base.methods = ['set', 'apply', 'clear', 'get'];
            return base;
        }
        if (target === 'park') {
            base.methods = ['check', 'ib', 'slash'];
            return base;
        }
        if (target === 'sw') {
            base.methods = Object.keys(this.sw || {});
            return base;
        }
        if (target === 'fetch') {
            base.api = 'fetch';
            return base;
        }
        if (target === 'storage') {
            base.methods = ['tip', 'bin', 'item', 'file', 'kill'];
            base.access = {
                GET: 'snapshot',
                POST: 'kill <ib> — entry-plug',
            };
            return base;
        }
        if (
            [
                'reseed',
                'factoryreset',
                'alias',
                'prune',
                'resolve',
                'heartbeat',
                'reindex',
            ].includes(target)
        ) {
            base.access = { GET: 'snapshot', POST: 'execute' };
            return base;
        }
        if (live && typeof live === 'object') {
            base.keys = Object.keys(live);
        } else if (typeof live === 'function') {
            base.type = 'function';
        } else {
            base.value = live;
        }
        return base;
    }

    /**
     * Space-level hard erase (no confirm). Prefer navi.storage.kill for UX.
     */
    public async hardEraseTip(ibRaw: string): Promise<string> {
        const ib = canonicalizeTipIb(ibRaw);
        if (!ib) {
            throw new Error('Usage: storage.kill(<ib>)');
        }
        const tip = await this.getTip(ib);
        if (!tip) {
            throw new Error(`no tip ${ib}`);
        }
        const refs = Array.isArray(tip.rel8ns?.bin) ? tip.rel8ns!.bin : [];
        for (const ref of refs) {
            const sha = String(ref || '')
                .trim()
                .match(/^bin\s+([0-9a-fA-F]+)$/)?.[1]
                ?.toLowerCase();
            if (sha) await this.deleteBin(sha);
        }
        await this.deleteTip(ib);
        const index = await this.getTip(NAVI_MOD_INDEX_IB);
        if (index?.data && Array.isArray(index.data.parks)) {
            const next = index.data.parks.filter(
                (p: any) => p && !tipIbsMatch(this.parkEntryIb(p), ib)
            );
            if (next.length !== index.data.parks.length) {
                await this.mut8Tip(index, { parks: next });
            }
        }
        return `[kill] erased ${ib}`;
    }

    /**
     * Gated kill — entry-plug + confirm; not park-GET reachable.
     * Callin remainder segments (`kill navi mod` / `kill navi:mod`) are
     * rejoined before lookup; getTip uses delimiter race.
     */
    public async storageKill(ibRaw: string): Promise<string> {
        const want = canonicalizeTipIb(ibRaw);
        if (!want) {
            throw new Error('Usage: navi.storage.kill(<ib>)');
        }
        const tip = await this.getTip(want);
        if (!tip) {
            throw new Error(`no tip ${want}`);
        }
        const ib = canonicalizeTipIb(tip.ib || want) || want;
        await this.requireEntryPlugGate('storage.kill');
        const prompt = `HARD ERASE tip "${ib}" from local tip space. Type the ib to confirm.`;
        if (typeof globalThis.prompt === 'function') {
            const typed = globalThis.prompt(prompt, '');
            if (typed == null || !tipIbsMatch(typed, ib)) {
                throw new Error('[kill] aborted — confirmation failed');
            }
        } else if (typeof globalThis.confirm === 'function') {
            if (
                !globalThis.confirm(
                    `HARD ERASE tip "${ib}" from local tip space via entry-plug of ${this.entryPlug!.unitIb}?`
                )
            ) {
                throw new Error('[kill] aborted — confirmation failed');
            }
        }
        return await this.hardEraseTip(ib);
    }

    /**
     * Wipe all tips + tip_frames + bins, clear entry-plug/heartbeat/live mods,
     * then plant seeds + mint unit + plant surf bin.
     */
    public async factoryResetSpace(): Promise<string> {
        await this.requireEntryPlugGate('factoryreset');
        if (this.unitHeartbeatTimer) {
            clearInterval(this.unitHeartbeatTimer);
            this.unitHeartbeatTimer = null;
        }
        this.entryPlug = null;
        this.entryPlugSecret = null;
        this.callUnitIb = null;
        this.installUuid = null;

        for (const name of this.listModules()) {
            delete this.mod[name];
            this.moduleRegistry.delete(name);
        }

        const tipIbs = await this.storageImpl.listTips();
        for (const ib of tipIbs) {
            await this.storageImpl.deleteTip(ib);
        }
        const frames = await this.storageImpl.listTipFrames();
        for (const addr of frames) {
            await this.storageImpl.deleteTipFrame(addr);
        }
        const bins = await this.storageImpl.listBins();
        for (const sha of bins) {
            await this.storageImpl.deleteBin(sha);
        }

        await this.ensureNaviReduxSeeds();
        await this.ensureUnit();
        await this.createDefaultModule();
        return '[navi] factoryreset complete';
    }

    public async reseedTips(force = false): Promise<string> {
        const planted: string[] = [];
        for (const seed of NAVI_REDUX_SEED_TIPS) {
            const ib = canonicalizeTipIb(seed.ib);
            if (!ib) continue;
            const existing = await this.getTip(ib);
            if (existing?.ib && !force) {
                continue;
            }
            const priorAddr =
                existing?.gib && force ? `${existing.ib}^${existing.gib}` : null;
            let frame = await this.stampTipFrame(seed);
            if (priorAddr) {
                frame = {
                    ...frame,
                    rel8ns: {
                        ...(frame.rel8ns || {}),
                        past: [priorAddr],
                    },
                };
                frame = await this.stampTipFrame(frame);
            }
            await this.setTip(frame);
            planted.push(ib);
        }
        await this.createDefaultModule();
        return planted.length
            ? `[navi] reseeded: ${planted.join(', ')}`
            : '[navi] reseed: nothing to plant (use force to overwrite)';
    }

    /** Rebuild this unit's mods{} from live navi.mod.* (refresh ledger addrs). */
    public async reindexUnitMods(): Promise<string> {
        const unitIb = await this.requireCallUnitIb();
        const unitTip = await this.getTip(unitIb);
        if (!unitTip?.data) throw new Error(`unit tip missing ${unitIb}`);

        const mods: Record<string, any> = {};
        const parks: any[] = [];
        for (const name of this.listModules()) {
            const parkIb = moduleParkIb(name);
            const tip = await this.getTip(parkIb);
            if (!tip?.data) {
                throw new Error(
                    `mounted module '${name}' has no park tip ${parkIb}`
                );
            }
            const mod = this.mod[name];
            const commands = mod?.commands
                ? Object.keys(mod.commands)
                : parkMethodCommands(tip);
            const entry = await this.parkRegistrationEntry(
                tip,
                name,
                commands
            );
            mods[name] = entry;
            parks.push(entry);
        }
        await this.mut8Tip(unitTip, {
            unit: {
                ...(unitTip.data.unit || {}),
                mods,
            },
        });
        const index = await this.getTip(NAVI_MOD_INDEX_IB);
        if (index?.data) {
            const prior = Array.isArray(index.data.parks)
                ? index.data.parks.slice()
                : [];
            for (const entry of parks) {
                const i = prior.findIndex(
                    (p: any) =>
                        p &&
                        (p.name === entry.name ||
                            tipIbsMatch(this.parkEntryIb(p), this.parkEntryIb(entry)))
                );
                if (i >= 0) prior[i] = entry;
                else prior.push(entry);
            }
            await this.mut8Tip(index, { parks: prior });
        }
        return `[navi] reindexed unit ${unitIb} mods (${Object.keys(mods).length})`;
    }

    public async mut8TipByIb(
        ib: string,
        dataPatch: Record<string, any> = {},
        opts?: Mut8TipOpts
    ): Promise<NaviTipFrame> {
        let tip = await this.getTip(ib);
        if (!tip?.data) {
            if (!opts?.create) {
                throw new Error(`no tip ${canonicalizeTipIb(ib)}`);
            }
            const seed =
                opts.create === true
                    ? ({} as { data?: Record<string, any>; rel8ns?: Record<string, any> })
                    : opts.create || {};
            tip = {
                ib: canonicalizeTipIb(ib),
                gib: '',
                data: {
                    ...(seed.data && typeof seed.data === 'object'
                        ? seed.data
                        : {}),
                },
                rel8ns: {
                    past: [],
                    tjp: [],
                    dna: [],
                    ...(seed.rel8ns && typeof seed.rel8ns === 'object'
                        ? seed.rel8ns
                        : {}),
                },
            };
        }
        return await this.mut8Tip(tip, dataPatch || {}, opts);
    }

    public async putBinMedia(record: {
        media: string;
        mime: string;
    }): Promise<string> {
        if (!record || typeof record.media !== 'string') {
            throw new Error('[navi] putBinMedia requires { media, mime }');
        }
        const sha = await this.sha256Hex(record.media);
        await this.putBin(sha, {
            media: record.media,
            mime: record.mime || 'application/octet-stream',
        });
        return sha;
    }

    /**
     * Plant module source as bin + navi:<name> park tip (kind=mod).
     * Does not mount — caller mounts the media string.
     * Includes surf (bare). Non-module shell tips stay at storage/relay/etc.
     */
    public async plantModulePark(opts: {
        name: string;
        media: string;
        mime?: string;
        commands?: string[];
    }): Promise<{ ib: string; sha: string; ref: string }> {
        const name = String(opts?.name || '')
            .trim()
            .replace(/^navi[/:]/, '')
            .replace(/^mod[/:]/, '');
        if (!name || /[/:]/.test(name)) {
            throw new Error(
                '[navi] plantModulePark name must be a single segment (e.g. potter)'
            );
        }
        const sha = await this.putBinMedia({
            media: opts.media,
            mime: opts.mime || 'application/navi-module',
        });
        const ref = `bin ${sha}`;
        const ib = moduleParkIb(name);
        const existing = await this.getTip(ib);
        const priorAddr = existing?.gib ? `${existing.ib}^${existing.gib}` : null;
        const defaultCmd = name;
        const methodBlock: Record<string, any> = {
                    GET: {
                        kind: 'mod',
                        target: name,
                        command: defaultCmd,
                        mode: 'async',
                    },
                    POST: {
                        kind: 'mod',
                        target: name,
                        command: defaultCmd,
                        mode: 'async',
                    },
                    PUT: { kind: 'commit', mode: 'async' },
                    PATCH: { kind: 'commit', mode: 'async' },
                    DELETE: { kind: 'tombstone', mode: 'async' },
        };
        const altCommands =
            Array.isArray(opts.commands) && opts.commands.length > 1
                ? opts.commands.map(String)
                : [];
        if (altCommands.length) {
            methodBlock.GET.commands = altCommands;
            methodBlock.POST.commands = altCommands;
        }
        const frame = await this.stampTipFrame({
            ib,
            gib: '',
            data: {
                parts: ['navi_park', 'ibgib_frame', 'manifest', 'json'],
                park: 'capture',
                default_method: 'GET',
                content_type: opts.mime || 'application/navi-module',
                method: methodBlock,
                module: { name, subject_seed: ref },
                about: {
                    label: `navi mod ${name} park`,
                    description: `Planted module park for ${name} at ${ib} (provision + verbs).`,
                    navi_name: name,
                    name,
                },
            },
            rel8ns: {
                bin: [ref],
                past: priorAddr ? [priorAddr] : [],
                tjp: [],
                dna: [],
            },
        });
        await this.setTip(frame);
        return { ib, sha, ref };
    }

    /**
     * Peel unit (or unit-alias) prefix from a tip ib path.
     * navi/unit/01/surf/x or unit/01/surf/x → unit + restSegs [surf,x]
     * navi/<alias>/… or bare <alias>/… when tip has data.unit.hash or aliases map
     */
    private async peelUnitFromIb(
        ib: string
    ): Promise<{ unitIb: string; restSegs: string[] } | null> {
        const segs = ibSegments(ib);
        if (!segs.length) return null;

        if (segs[0] === 'navi' && segs[1] === 'unit' && segs[2]) {
            return {
                unitIb: unitParkIb(segs[2]),
                restSegs: segs.slice(3),
            };
        }
        if (segs[0] === 'unit' && segs[1]) {
            return {
                unitIb: unitParkIb(segs[1]),
                restSegs: segs.slice(2),
            };
        }

        const aliasIdx = segs[0] === 'navi' ? 1 : 0;
        if (segs.length <= aliasIdx) return null;
        const aliasName = segs[aliasIdx];

        let tip = await this.getTip(aliasName);
        if (!tip?.data?.unit?.hash) {
            const presumed = await this.getTip(presumeNaviIb(aliasName));
            if (presumed?.data?.unit?.hash) tip = presumed;
        }
        if (tip?.data?.unit?.hash) {
            return {
                unitIb: String(tip.ib || aliasName),
                restSegs: segs.slice(aliasIdx + 1),
            };
        }

        const units = await this.loadUnitsState();
        const aliases =
            units.aliases && typeof units.aliases === 'object'
                ? units.aliases
                : {};
        const mapped = aliases[aliasName];
        if (mapped) {
            return {
                unitIb: canonicalizeTipIb(String(mapped)),
                restSegs: segs.slice(aliasIdx + 1),
            };
        }

        return null;
    }

    private async withCallUnit<T>(
        explicitUnitIb: string | null,
        fn: () => Promise<T>
    ): Promise<T> {
        const prev = this.callUnitIb;
        try {
            if (explicitUnitIb) {
                this.callUnitIb = canonicalizeTipIb(explicitUnitIb);
            } else if (!this.callUnitIb) {
                this.callUnitIb = await this.resolveDefaultUnitIb();
            }
            // Do not mut8 navi:unit here — heartbeat timer owns the tip online record.
            // Callin/relay bind callUnitIb from live entry-plug memory (realtime).
            return await fn();
        } finally {
            this.callUnitIb = prev;
        }
    }

    private async resolveDefaultUnitIb(): Promise<string | null> {
        if (this.entryPlug?.unitIb) return this.entryPlug.unitIb;
        const units = await this.loadUnitsState();
        const def = units.resolution?.default;
        if (def) return canonicalizeTipIb(String(def));
        const list = Array.isArray(units.list) ? units.list : [];
        const online = list.find((r: any) => r?.online !== false && r?.ib);
        if (online?.ib) return canonicalizeTipIb(String(online.ib));
        if (list[0]?.ib) return canonicalizeTipIb(String(list[0].ib));
        return null;
    }

    private async requireCallUnitIb(): Promise<string> {
        const ib =
            this.callUnitIb ||
            this.entryPlug?.unitIb ||
            (await this.resolveDefaultUnitIb());
        if (!ib) throw new Error('no unit context — ensureUnit first');
        return ib;
    }

    private async getUnitMountEntry(
        name: string
    ): Promise<{ 'ib^gib'?: string; commands?: string[] } | null> {
        const unitIb = this.callUnitIb || this.entryPlug?.unitIb;
        if (!unitIb) return null;
        const tip = await this.getTip(unitIb);
        const mods = this.readUnitMods(tip);
        if (!mods) return null;
        const entry = mods[name];
        return entry && typeof entry === 'object' ? entry : null;
    }

    /** unit.mods — live module claims on this unit tip. */
    private readUnitMods(
        tip: NaviTipFrame | null | undefined
    ): Record<string, any> | null {
        const u = tip?.data?.unit;
        if (!u || typeof u !== 'object') return null;
        if (u.mods && typeof u.mods === 'object') return u.mods;
        return null;
    }

    /**
     * Mut8 a tip: content-address gib; past ← prior addr (unless opts.rel8ns.past set).
     * dataPatch shallow-merges into tip.data unless opts.replaceData.
     * No version counter: order is the past chain (inherited data.n is dropped).
     * Prior frame stays in shared tip.frame space; tip pointer moves to the new gib.
     */
    private async mut8Tip(
        tip: NaviTipFrame,
        dataPatch: Record<string, any>,
        opts?: Mut8TipOpts
    ): Promise<NaviTipFrame> {
        const run = this.tipMut8Chain.then(() =>
            this.mut8TipUnlocked(tip, dataPatch, opts)
        );
        this.tipMut8Chain = run.then(
            () => undefined,
            () => undefined
        );
        return run;
    }

    private async mut8TipUnlocked(
        tip: NaviTipFrame,
        dataPatch: Record<string, any>,
        opts?: Mut8TipOpts
    ): Promise<NaviTipFrame> {
        const tipIb =
            canonicalizeTipIb(tip.ib || '') || String(tip.ib || '').trim();
        const priorGib = String(tip.gib || '').trim();
        const priorAddr = priorGib ? `${tipIb}^${priorGib}` : null;
        // Prior must be in frame space before the tip pointer moves.
        if (priorGib) {
            await this.putTipFrame({ ...tip, ib: tipIb, gib: priorGib });
            await this.liftNestedFramesIntoSpace(tip);
        }
        const patch =
            dataPatch && typeof dataPatch === 'object' ? dataPatch : {};
        // Do not keep nested data.frames payloads (legacy); lineage is past + frame space.
        const { frames: _dropFrames, ...restPatch } = patch as Record<string, any>;
        const baseData =
            tip.data && typeof tip.data === 'object' ? { ...tip.data } : {};
        delete (baseData as any).frames;
        delete (baseData as any).n;
        const nextData = opts?.replaceData
            ? { ...restPatch }
            : {
                  ...baseData,
                  ...restPatch,
              };
        delete (nextData as any).frames;

        const relPatch =
            opts?.rel8ns && typeof opts.rel8ns === 'object' ? opts.rel8ns : {};
        const nextRel8ns = {
            ...(tip.rel8ns || {}),
            ...relPatch,
            past: this.resolveMut8Past(tip, priorAddr, relPatch),
        };

        const next = await this.stampTipFrame({
            ...tip,
            ib: tipIb,
            data: nextData,
            rel8ns: nextRel8ns,
        });
        await this.setTip(next);
        // Integrity: prior must resolve from frame space after pointer moves.
        if (priorAddr) {
            const check = await this.storageImpl.getTipFrame(priorAddr);
            if (!check) {
                await this.putTipFrame({ ...tip, ib: tipIb, gib: priorGib });
                const again = await this.storageImpl.getTipFrame(priorAddr);
                if (!again) {
                    this.callout(
                        `[navi] tip.frame missing after mut8: ${priorAddr}`
                    );
                }
            }
        }
        return next;
    }

    /**
     * past←prior unless opts.rel8ns.past is an intentional override.
     * Spreading `...tip.rel8ns` re-asserts the tip's own past (often []) and
     * must not suppress auto lineage — that left navi root gens as firstgens.
     */
    private resolveMut8Past(
        tip: NaviTipFrame,
        priorAddr: string | null,
        relPatch: Record<string, any>
    ): any {
        const pastExplicit = Object.prototype.hasOwnProperty.call(
            relPatch,
            'past'
        );
        if (!pastExplicit) {
            return priorAddr ? [priorAddr] : [];
        }
        const override = relPatch.past;
        if (!priorAddr) return override;
        const tipPast = Array.isArray(tip.rel8ns?.past)
            ? tip.rel8ns!.past.map(String)
            : [];
        const overList = Array.isArray(override)
            ? override.map(String)
            : null;
        if (
            overList &&
            overList.length === tipPast.length &&
            overList.every((v, i) => v === tipPast[i])
        ) {
            return [priorAddr];
        }
        return override;
    }

    /**
     * Mut8 navi:mod parks[] for a mounted module. Requires planted tip navi:<name>
     * with kind=mod (flat parks).
     * (seed) — no auto-create fallback.
     * Index parks[] commands follow the live register() return (commands{}).
     * Tip frame stores alternates on data.method.GET/POST.commands (not module.commands).
     */
    /**
     * Ledger / unit.mods entry for a planted module park.
     * Single identity field: "ib^gib" → "surf^…".
     */
    private async parkRegistrationEntry(
        tip: NaviTipFrame,
        name: string,
        commands: string[]
    ): Promise<{
        'ib^gib': string;
        name: string;
        commands: string[];
        registered_at: string;
    }> {
        const parkIb =
            canonicalizeTipIb(String(tip.ib || '')) || moduleParkIb(name);
        let gib = String(tip.gib || '').trim();
        if (!gib) {
            const row = await this.storageImpl.getTip(
                canonicalizeTipIb(tip.ib || parkIb) || parkIb
            );
            if (this.isTipPointer(row)) {
                const pointerAddr = String((row as any).addr || '').trim();
                const caret = pointerAddr.indexOf('^');
                if (caret > 0) gib = pointerAddr.slice(caret + 1).trim();
            }
        }
        if (!gib) {
            throw new Error(
                `park ${parkIb} has no gib — cannot register on navi:mod`
            );
        }
        return {
            'ib^gib': `${parkIb}^${gib}`,
            name,
            commands,
            registered_at: naviStamp.time(),
        };
    }

    /** ib from a parks[] / mods entry (`ib^gib` or legacy ib/addr). */
    private parkEntryIb(entry: any): string {
        const full = String(
            entry?.['ib^gib'] || entry?.addr || ''
        ).trim();
        const caret = full.indexOf('^');
        if (caret > 0) {
            return canonicalizeTipIb(full.slice(0, caret)) || '';
        }
        return canonicalizeTipIb(String(entry?.ib || '')) || '';
    }

    private parkEntryAddr(entry: any): string {
        return String(entry?.['ib^gib'] || entry?.addr || '').trim();
    }

    private async syncModIndexOnMount(
        moduleObject: any,
        opts?: { parkTipIb?: string }
    ): Promise<void> {
        const name = String(moduleObject?.name || '').trim();
        if (!name) return;

        const liveCommands = moduleObject.commands
            ? Object.keys(moduleObject.commands)
            : [];
        const parkIb = moduleParkIb(name);
        const altIb = (() => {
            const raw = String(opts?.parkTipIb || '').trim();
            if (!raw) return '';
            const c = canonicalizeTipIb(raw) || raw;
            return c && c !== parkIb ? c : '';
        })();

        const getAllowed = moduleCommandsForTransport(moduleObject, 'GET');
        const postAllowed = moduleCommandsForTransport(moduleObject, 'POST');
        const singleCommand = liveCommands.length <= 1;
        const getDefault = singleCommand
            ? liveCommands.includes(name)
                ? name
                : liveCommands[0] || ''
            : defaultModuleCommand(name, getAllowed, 'list');
        const postDefault = singleCommand
            ? getDefault
            : defaultModuleCommand(name, postAllowed, 'list');
        const getCommands = singleCommand ? [] : getAllowed;
        const postCommands = singleCommand ? [] : postAllowed;

        const patchTipMethods = async (
            syncIb: string
        ): Promise<NaviTipFrame | null> => {
            let tip = await this.getTip(syncIb);
            if (!tip?.data) return null;

            const tipGetCommands = parkMethodCommands(tip, 'GET');
            const tipPostCommands = parkMethodCommands(tip, 'POST');
            const tipGetDefault = String(
                parkMethodCtrl(tip, 'GET')?.command || ''
            );
            const tipPostDefault = String(
                parkMethodCtrl(tip, 'POST')?.command || ''
            );
            const needsMethodMigrate = !!(
                tip.data?.http &&
                typeof tip.data.http === 'object' &&
                !Array.isArray(tip.data.http) &&
                !tip.data?.method
            );

        const commandsChanged =
                needsMethodMigrate ||
                tipGetCommands.length !== getCommands.length ||
                tipPostCommands.length !== postCommands.length ||
                tipGetCommands.some((c, i) => c !== getCommands[i]) ||
                tipPostCommands.some((c, i) => c !== postCommands[i]) ||
                tipGetDefault !== getDefault ||
                tipPostDefault !== postDefault;

        if (commandsChanged) {
                const method = { ...parkMethodBlock(tip) };
                delete method.commands;
                for (const verb of ['GET', 'POST'] as const) {
                    let ctrl = method[verb];
                    if (!ctrl || typeof ctrl !== 'object') {
                        ctrl = { kind: 'mod', target: name, mode: 'async' };
                    }
                    const allowed = verb === 'GET' ? getAllowed : postAllowed;
                    const defaultCmd =
                        verb === 'GET' ? getDefault : postDefault;
                    const next = { ...ctrl, kind: 'mod', target: name };
                    if (liveCommands.length) next.command = defaultCmd;
                    if (!singleCommand && allowed.length > 1) {
                        next.commands = allowed;
                    } else {
                        delete next.commands;
                    }
                    method[verb] = next;
                }
            const patch: Record<string, any> = {
                    method,
                    content_type:
                        tip.data.content_type || 'application/navi-module',
                module: {
                        ...(tip.data.module &&
                        typeof tip.data.module === 'object'
                        ? tip.data.module
                        : {}),
                    name,
                    },
                    about: {
                        ...(tip.data.about &&
                        typeof tip.data.about === 'object'
                            ? tip.data.about
                            : {}),
                        navi_name: name,
                    },
                };
                delete patch.module.commands;
                if (tip.data?.http) patch.http = null;
            tip = await this.mut8Tip(tip, patch);
            }
            return tip;
        };

        let tip = await patchTipMethods(parkIb);
        if (altIb) await patchTipMethods(altIb);
        if (!tip?.data && altIb) tip = await this.getTip(altIb);
        if (!tip?.data) {
            throw new Error(
                `park tip ${parkIb} missing — plant failed for ${name}`
            );
        }

        const index = await this.getTip(NAVI_MOD_INDEX_IB);
        if (!index?.data) {
            throw new Error('navi:mod tip missing — cannot record mount');
        }

        const parks = Array.isArray(index.data.parks)
            ? index.data.parks.slice()
            : [];
        const canonical = await this.getTip(parkIb);
        const ledgerTip = canonical?.data ? canonical : tip;
        const entry = await this.parkRegistrationEntry(
            ledgerTip,
            name,
            liveCommands
        );
        const i = parks.findIndex(
            (p: any) =>
                p &&
                (p.name === name ||
                    tipIbsMatch(this.parkEntryIb(p), parkIb) ||
                    (altIb && tipIbsMatch(this.parkEntryIb(p), altIb)))
        );
        if (i >= 0) parks[i] = entry;
        else parks.push(entry);

        await this.mut8Tip(index, { parks });

        const unitIb =
            this.callUnitIb ||
            this.entryPlug?.unitIb ||
            (await this.resolveDefaultUnitIb());
        if (unitIb) {
            const unitTip = await this.getTip(unitIb);
            if (unitTip?.data) {
                const prior = this.readUnitMods(unitTip) || {};
                const mods = {
                    ...prior,
                    [name]: entry,
                };
                const unitData = { ...(unitTip.data.unit || {}), mods };
                await this.mut8Tip(unitTip, { unit: unitData });
            }
        }

        this.callout(
            `[navi] mounted ${name} (${this.parkEntryAddr(entry)})` +
                (unitIb ? ` on ${unitIb}` : '')
        );
    }

    private async syncModIndexOnUnmount(name: string): Promise<void> {
        const modName = String(name || '').trim();
        if (!modName) return;

        // Drop from remount ledger (navi:mod parks) — unmount means stay unmounted
        // until an explicit mount. Park tip+bin is left planted.
        // During remount(), deps may self-unmount temporarily — keep ledger rows.
        if (!this.remountInProgress) {
        const index = await this.getTip(NAVI_MOD_INDEX_IB);
            if (index?.data && Array.isArray(index.data.parks)) {
                const parks = index.data.parks.filter(
            (p: any) =>
                        !(
                            p &&
                            (String(p.name || '').trim() === modName ||
                                tipIbsMatch(
                                    this.parkEntryIb(p),
                                    moduleParkIb(modName)
                                ))
                        )
                );
                if (parks.length !== index.data.parks.length) {
                    await this.mut8Tip(index, { parks });
                }
            }
        }

        // Drop live claim from this unit.
        const unitIb =
            this.callUnitIb ||
            this.entryPlug?.unitIb ||
            (await this.resolveDefaultUnitIb());
        if (unitIb) {
            const unitTip = await this.getTip(unitIb);
            const prior = this.readUnitMods(unitTip);
            if (unitTip?.data && prior) {
                const mods = { ...prior };
                delete mods[modName];
                const unitData = { ...(unitTip.data.unit || {}), mods };
                await this.mut8Tip(unitTip, { unit: unitData });
            }
        }
        this.callout(
            `[navi] unmounted ${modName}` + (unitIb ? ` from ${unitIb}` : '')
        );
    }

    //call comes in via index.ts -> init navi shell
    public async initialize(): Promise<void> {
        await this.registerServiceWorker();
        // Populate `/` + navi_shell.js in SW cache while online (offline PWA boot).
        void this.ensureShellCache();

        await this.ensureNaviReduxSeeds();
        await this.ensureEntryPlugSecret();
        await this.ensureUnit();
        const commands = await this.ensureInitScript();
        await this.script(commands);

        // Emit ready event - shell is initialized
        this.emit('ready');
    }

    /** SHA-256 hex (browser SubtleCrypto or node crypto). */
    private async sha256Hex(text: string): Promise<string> {
        const data = new TextEncoder().encode(text);
        if (typeof globalThis.crypto?.subtle?.digest === 'function') {
            const buf = await globalThis.crypto.subtle.digest('SHA-256', data);
            return Array.from(new Uint8Array(buf))
                .map((b) => b.toString(16).padStart(2, '0'))
                .join('');
        }
        try {
            const nodeCrypto = await import('crypto');
            return nodeCrypto.createHash('sha256').update(text, 'utf8').digest('hex');
        } catch {
            // Weak fallback — still stable for a given string within a session.
            let h = 0;
            for (let i = 0; i < text.length; i++) {
                h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
            }
            return `fallback${(h >>> 0).toString(16).padStart(8, '0')}`;
        }
    }

    private async getInstallUuid(): Promise<string | null> {
        if (this.installUuid && !isStampPlaceholder(this.installUuid)) {
            return this.installUuid;
        }
        const root = await this.getTip('navi');
        const u = resolveStampedUuid(root?.data?.uuid);
        if (u) {
            this.installUuid = u;
            return u;
        }
        this.installUuid = null;
        return null;
    }

    private async stampTipFrame(
        raw: NaviTipFrame,
        timestamp = naviStamp.time()
    ): Promise<NaviTipFrame> {
        const isNaviRoot = canonicalizeTipIb(raw.ib || '') === 'navi';
        const incoming = resolveStampedUuid(raw.data?.uuid);
        const uuid = isNaviRoot
            ? incoming || (await this.getInstallUuid()) || naviStamp.uuid()
            : (await this.getInstallUuid()) || incoming || '';
        if (uuid) this.installUuid = uuid;
        const data: Record<string, any> = {
            ...(raw.data && typeof raw.data === 'object' ? raw.data : {}),
            timestamp,
            ...(uuid ? { uuid } : {}),
        };
        if (data.n == null) delete data.n;
        const gib = (await this.sha256Hex(JSON.stringify(data))).toUpperCase();
        const priorPast = Array.isArray(raw.rel8ns?.past) ? raw.rel8ns.past : [];
        return {
            ib: canonicalizeTipIb(raw.ib || ''),
            gib,
            data,
            rel8ns: {
                tjp: Array.isArray(raw.rel8ns?.tjp) ? raw.rel8ns.tjp : [],
                dna: Array.isArray(raw.rel8ns?.dna) ? raw.rel8ns.dna : [],
                ...(raw.rel8ns && typeof raw.rel8ns === 'object' ? raw.rel8ns : {}),
                past: priorPast,
            },
        };
    }

    /**
     * Exact-ib tip load (no delimiter race, no gate). Used by writes and
     * as the inner step of getTip.
     */
    public async getTipExact(ib: string): Promise<NaviTipFrame | null> {
        const key = canonicalizeTipIb(ib) || String(ib || '').trim();
        if (!key) return null;
        const row = await this.storageImpl.getTip(key);
        if (!row || typeof row !== 'object') return null;

        if (this.isTipPointer(row)) {
            const addr = String(row.addr || '').trim();
            const frame = addr
                ? await this.storageImpl.getTipFrame(addr)
                : null;
            if (frame) return this.stripNestedFrames(frame);
            return null;
        }

        const legacy = row as NaviTipFrame;
        const gib = String(legacy.gib || '').trim();
        if (!gib) return null;
        const tipIb = canonicalizeTipIb(legacy.ib || key) || key;
        const cleaned = this.stripNestedFrames({ ...legacy, ib: tipIb });
        try {
            await this.putTipFrame(cleaned);
            await this.liftNestedFramesIntoSpace(legacy);
            await this.storageImpl.putTip({
                ib: tipIb,
                addr: `${tipIb}^${gib}`,
                pointer: true,
            });
        } catch (error) {
            this.callout('Failed to migrate tip pointer: ' + error);
        }
        return cleaned;
    }

    /**
     * Live delimiter-race set: list tips, keep those with the same segments
     * (`:` `/` space interchangeable, `//` frozen). Load only that set, in
     * parallel. One hit → one get; no speculative keys.
     */
    private async loadDelimiterRaceSet(want: string): Promise<{
        keys: string[];
        frames: (NaviTipFrame | null)[];
    }> {
        const live = await this.listTipIbs();
        let keys = liveDelimiterHits(want, live);
        if (!keys.length && want) keys = [want];
        const frames = await Promise.all(keys.map((k) => this.getTipExact(k)));
        return { keys, frames };
    }

    public async getTip(
        ib: string,
        opts?: GetTipOpts
    ): Promise<NaviTipFrame | null> {
        const want = canonicalizeTipIb(ib) || String(ib || '').trim();
        if (!want) return null;
        const { keys, frames } = await this.loadDelimiterRaceSet(want);
        const present: NaviTipFrame[] = [];
        for (let i = 0; i < keys.length; i++) {
            const t = frames[i];
            if (t) present.push(t);
        }
        if (!present.length) return null;
        if (!opts?.gatePassthru) {
            const gated = present.find((t) => isTipGateTrue(t.data));
            if (gated) return gated;
        }
        return present[0];
    }

    /**
     * At most one data.gate=true frame per delimiter race set.
     * Mut8 of the same ib may keep its own gate.
     */
    private async assertDelimiterGate(
        ib: string,
        data: Record<string, any> | undefined
    ): Promise<void> {
        if (!isTipGateTrue(data)) return;
        const want = canonicalizeTipIb(ib) || String(ib || '').trim();
        const { keys, frames } = await this.loadDelimiterRaceSet(want);
        for (let i = 0; i < keys.length; i++) {
            if (keys[i] === want) continue;
            const other = frames[i];
            if (other && isTipGateTrue(other.data)) {
                const otherIb = canonicalizeTipIb(other.ib || keys[i]) || keys[i];
                throw new Error(
                    `[navi] cannot gate '${want}': race set already has gate frame '${otherIb}'. Mut8 that park to gate=false (or omit gate) first.`
                );
            }
        }
    }

    /**
     * Write frame into tip.frame space and point tip at ib^gib.
     * Stamps gib if missing. Strips nested data.frames (lifted into space).
     */
    public async setTip(frame: NaviTipFrame): Promise<void> {
        const ib = canonicalizeTipIb(frame?.ib);
        if (!ib) throw new Error('[navi] tip.ib required');
        let next = { ...frame, ib } as NaviTipFrame;
        await this.assertDelimiterGate(ib, next.data);
        if (!String(next.gib || '').trim()) {
            next = await this.stampTipFrame(next);
        }
        const gib = String(next.gib || '').trim();
        if (!gib) throw new Error('[navi] tip.gib required after stamp');
        await this.liftNestedFramesIntoSpace(next);
        const cleaned = this.stripNestedFrames(next);
        await this.putTipFrame(cleaned);
        await this.storageImpl.putTip({
            ib,
            addr: `${ib}^${gib}`,
            pointer: true,
        });
    }

    public async deleteTip(ib: string): Promise<void> {
        const want = canonicalizeTipIb(ib) || String(ib || '').trim();
        if (!want) return;
        const addrs = await this.storageImpl.listTipFrames(want);
        for (const addr of addrs) {
            await this.storageImpl.deleteTipFrame(addr);
        }
        await this.storageImpl.deleteTip(want);
    }

    public async listTipIbs(): Promise<string[]> {
        return await this.storageImpl.listTips();
    }

    /** Load a generation from shared tip.frame space (ib^gib). */
    public async getTipFrame(addr: string): Promise<NaviTipFrame | null> {
        const a = String(addr || '').trim();
        if (!a || !a.includes('^')) return null;
        const hit = await this.storageImpl.getTipFrame(a);
        if (hit) return this.stripNestedFrames(hit);
        // Legacy: tips row may still be the full frame for this gib — migrate.
        const caret = a.indexOf('^');
        const ib = a.slice(0, caret);
        const gib = a.slice(caret + 1);
        const live = await this.listTipIbs();
        const keys = liveDelimiterHits(ib, live);
        if (!keys.includes(ib)) keys.unshift(ib);
        for (const key of keys) {
            const row = await this.storageImpl.getTip(key);
            if (!row || typeof row !== 'object' || this.isTipPointer(row)) {
                continue;
            }
            const tip = row as NaviTipFrame;
            if (
                String(tip.gib || '').toUpperCase() ===
                String(gib).toUpperCase()
            ) {
                const tipIb = canonicalizeTipIb(tip.ib || key) || key;
                const cleaned = this.stripNestedFrames({ ...tip, ib: tipIb });
                try {
                    await this.putTipFrame(cleaned);
                    await this.liftNestedFramesIntoSpace(tip);
                    await this.storageImpl.putTip({
                        ib: tipIb,
                        addr: `${tipIb}^${String(tip.gib).trim()}`,
                        pointer: true,
                    });
                } catch {
                    /* best-effort migrate */
                }
                return cleaned;
            }
        }
        return null;
    }

    /** Store a generation in tip.frame space (does not move the tip pointer). */
    public async putTipFrame(frame: NaviTipFrame): Promise<void> {
        const ib = canonicalizeTipIb(frame?.ib);
        const gib = String(frame?.gib || '').trim();
        if (!ib || !gib) {
            throw new Error('[navi] tip.frame.put requires ib and gib');
        }
        const cleaned = this.stripNestedFrames({ ...frame, ib, gib });
        await this.storageImpl.putTipFrame(cleaned);
    }

    public async deleteTipFrame(addr: string): Promise<void> {
        const a = String(addr || '').trim();
        if (!a || !a.includes('^')) return;
        await this.storageImpl.deleteTipFrame(a);
    }

    /** List tip.frame space addrs (ib^gib), optionally filtered by tip ib. */
    public async listTipFrames(ib?: string): Promise<string[]> {
        const want = canonicalizeTipIb(String(ib || '').trim());
        return await this.storageImpl.listTipFrames(want || undefined);
    }

    private tipSpanDeps() {
        return {
            getTip: (ib: string) => this.getTip(ib),
            getTipFrame: (addr: string) => this.getTipFrame(addr),
        };
    }

    /**
     * Walk a tip's past chain from head (newest) toward root.
     * Each generation is one frame — delta/event tips store payload on data.event, data.op, etc.
     */
    public async walkTipLineage(ib: string): Promise<TipSpanHit[]> {
        return walkTipLineageImpl(ib, this.tipSpanDeps());
    }

    /**
     * Slice a tip lineage — comb/hostpark each hit.frame or hit.addr.
     * reverse (default): newest first; forward/all: oldest first; all = full chain.
     */
    public async tipSpan(
        ib: string,
        opts: TipSpanOpts = {}
    ): Promise<TipSpanHit[] | string[]> {
        return tipSpanImpl(ib, this.tipSpanDeps(), opts);
    }

    /** Extract add/remove/event deltas across a span (mod parks, ops stack, relay log). */
    public async tipSpanDiff(
        ib: string,
        opts: TipSpanDiffOpts = {}
    ): Promise<TipSpanDiffResult> {
        return tipSpanDiffImpl(ib, this.tipSpanDeps(), opts);
    }

    private isTipPointer(row: any): boolean {
        return !!(
            row &&
            typeof row === 'object' &&
            row.pointer === true &&
            typeof row.addr === 'string' &&
            String(row.addr).includes('^')
        );
    }

    private stripNestedFrames(frame: NaviTipFrame): NaviTipFrame {
        if (!frame?.data || typeof frame.data !== 'object') return frame;
        if (!Object.prototype.hasOwnProperty.call(frame.data, 'frames')) {
            return frame;
        }
        const data = { ...frame.data };
        delete (data as any).frames;
        return { ...frame, data };
    }

    private async liftNestedFramesIntoSpace(frame: NaviTipFrame): Promise<void> {
        const nested = frame?.data?.frames;
        if (!nested || typeof nested !== 'object') return;
        for (const fr of Object.values(nested)) {
            if (
                fr &&
                typeof fr === 'object' &&
                (fr as NaviTipFrame).ib &&
                (fr as NaviTipFrame).gib
            ) {
                try {
                    await this.putTipFrame(fr as NaviTipFrame);
                } catch {
                    /* ignore bad nested */
                }
            }
        }
    }

    public async getBin(
        sha: string
    ): Promise<{ media: string; mime: string; sha: string } | null> {
        const key = String(sha || '')
            .trim()
            .toLowerCase();
        if (!key) return null;
        return await this.storageImpl.getBin(key);
    }

    public async putBin(
        sha: string,
        record: { media: string; mime: string }
    ): Promise<void> {
        const key = String(sha || '')
            .trim()
            .toLowerCase();
        if (!key) throw new Error('[navi] bin sha required');
        if (!record || typeof record.media !== 'string') {
            throw new Error('[navi] bin requires { media, mime }');
        }
        await this.storageImpl.putBin(key, {
            media: record.media,
            mime: record.mime || 'application/octet-stream',
        });
    }

    public async deleteBin(sha: string): Promise<void> {
        const key = String(sha || '')
            .trim()
            .toLowerCase();
        if (!key) return;
        await this.storageImpl.deleteBin(key);
    }

    public async listBinShas(): Promise<string[]> {
        return await this.storageImpl.listBins();
    }

    /** Resolve tip.rel8ns.bin[0] → media string (module source, etc.). Host fallback. */
    public async loadBinMediaFromTip(ib: string): Promise<string> {
        const tip = await this.getTip(ib);
        if (!tip?.data) {
            const hostMedia = await this.fetchHostModuleMedia(ib);
            if (hostMedia) return hostMedia;
            throw new Error(`[navi] no tip for ${normalizeTipIb(ib)}`);
        }
        const refs = Array.isArray(tip.rel8ns?.bin) ? tip.rel8ns!.bin : [];
        const ref = refs[0];
        const sha = String(ref || '')
            .trim()
            .match(/^bin\s+([0-9a-fA-F]+)$/)?.[1]
            ?.toLowerCase();
        if (!sha) {
            const hostMedia =
                (await this.fetchHostModuleMedia(ib)) ||
                (await this.fetchWarezSubjectMedia(tip));
            if (hostMedia) return hostMedia;
            throw new Error(
                `[navi] tip ${normalizeTipIb(ib)} has no rel8ns.bin (plant module bin first)`
            );
        }
        const bin = await this.getBin(sha);
        if (!bin?.media) {
            const hostMedia =
                (await this.fetchHostModuleMedia(ib)) ||
                (await this.fetchWarezSubjectMedia(tip));
            if (hostMedia) return hostMedia;
            throw new Error(`[navi] missing bin ${sha} for tip ${normalizeTipIb(ib)}`);
        }
        return bin.media;
    }

    /**
     * Bind this live navi instance to a unit tip. If entry-plug is absent,
     * mint the next navi:unit:NN, mut8 navi:unit.units, plant unit tip.
     */
    public async ensureUnit(): Promise<EntryPlugView & { created: boolean }> {
        await this.ensureEntryPlugSecret();
        if (this.entryPlug) {
            const view = await this.touchEntryPlug();
            return { ...view, created: false };
        }

        const root = await this.getTip(NAVI_ROOT_IB);
        if (!root?.data) {
            throw new Error('navi root tip missing — cannot mint unit');
        }

        const units = await this.loadUnitsState();
        if (!Array.isArray(units.list)) units.list = [];
        if (!units.aliases || typeof units.aliases !== 'object') {
            units.aliases = {};
        }

        const nextNum = Math.max(
            1,
            Number(units.next) || units.list.length + 1
        );
        const unitId = String(nextNum).padStart(2, '0');
        const unitIb = unitParkIb(unitId);
        const mintMaterial = `${await this.getInstallUuid() || ''}|${unitIb}|${naviStamp.time()}|${Math.random()}`;
        const hash = (await this.sha256Hex(mintMaterial)).toLowerCase();

        const now = naviStamp.time();
        const unitFrame: NaviTipFrame = {
            ib: unitIb,
            gib: '<seed-gib>',
            data: {
                parts: ['navi_unit', 'navi_park', 'ibgib_frame', 'manifest', 'json'],
                park: 'capture',
                default_method: 'GET',
                method: {
                    GET: { kind: 'frame', mode: 'sync' },
                    PUT: { kind: 'commit', mode: 'async' },
                    PATCH: { kind: 'commit', mode: 'async' },
                    DELETE: { kind: 'tombstone', mode: 'async' },
                },
                about: {
                    label: unitIb,
                    description: 'runtime unit tip — hash, online, mods claim',
                },
                unit: {
                    id: unitId,
                    hash,
                    alias: null,
                    online: true,
                    last_entry_plug_at: now,
                    mods: {},
                },
                timestamp: now,
            },
            rel8ns: {
                past: [],
                tjp: [],
                dna: [],
                root: [NAVI_ROOT_IB],
            },
        };
        const stamped = await this.stampTipFrame(unitFrame, now);
        await this.setTip(stamped);

        const listRow = {
            id: unitId,
            ib: unitIb,
            hash,
            online: true,
            heartbeat_at: now,
            created_at: now,
        };
        units.list = [...units.list, listRow];
        units.next = nextNum + 1;
        if (!units.resolution) {
            units.resolution = { mode: 'default_unit', default: null };
        }
        if (!units.resolution.default) {
            units.resolution.default = unitIb;
        }

        const priorUnitRel = Array.isArray(root.rel8ns?.unit)
            ? root.rel8ns!.unit.slice()
            : [];
        if (!priorUnitRel.includes(unitIb)) priorUnitRel.push(unitIb);

        await this.saveUnitsState(units);
        await this.mut8Tip(root, {}, { rel8ns: { unit: priorUnitRel } });

        this.entryPlug = {
            unitIb,
            unitId,
            hash,
            stamp: naviStamp(),
            last_seen: now,
        };
        this.callout(`[navi] unit bound ${unitIb} (hash ${hash.slice(0, 8)}…)`);
        this.armUnitHeartbeat();
        const view = await this.signedEntryPlugView({ reveal: true });
        return { ...view, created: true };
    }

    /** Unit system state on navi:unit (migrate once from root.units if present). */
    private async loadUnitsState(): Promise<{
        next: number;
        list: any[];
        aliases: Record<string, string>;
        resolution: { mode: string; default: string | null; note?: string };
        heartbeat: {
            interval_sec: number;
            stale_sec: number;
            n_max: number;
            note?: string;
        };
        [k: string]: any;
    }> {
        const empty = this.emptyUnitsState();
        const sys = await this.getTip(NAVI_UNIT_SYSTEM_IB);
        let units =
            sys?.data?.units && typeof sys.data.units === 'object'
                ? { ...empty, ...sys.data.units }
                : { ...empty };

        // One-shot migrate from root.navi.units (pre-split tips).
        const root = await this.getTip(NAVI_ROOT_IB);
        if (
            root?.data?.units &&
            typeof root.data.units === 'object' &&
            (!Array.isArray(units.list) || units.list.length === 0) &&
            Array.isArray(root.data.units.list) &&
            root.data.units.list.length
        ) {
            units = { ...empty, ...root.data.units };
            await this.saveUnitsState(units);
            return this.normalizeUnitsState(units) as any;
        }

        return this.normalizeUnitsState(units) as any;
    }

    private emptyUnitsState(): Record<string, any> {
        return {
            next: 1,
            list: [] as any[],
            aliases: {} as Record<string, string>,
            resolution: {
                mode: 'default_unit',
                default: null as string | null,
            },
            heartbeat: {
                interval_sec: 180,
                stale_sec: 240,
                n_max: 20,
            },
        };
    }

    private normalizeUnitsState(raw: Record<string, any>): Record<string, any> {
        const empty = this.emptyUnitsState();
        const units = { ...empty, ...raw };
        if (!Array.isArray(units.list)) units.list = [];
        if (!units.aliases || typeof units.aliases !== 'object') {
            units.aliases = {};
        }
        units.heartbeat = this.normalizeHeartbeat(units.heartbeat);
        return units;
    }

    private normalizeHeartbeat(raw: any): {
        interval_sec: number;
        stale_sec: number;
        n_max: number;
        note?: string;
    } {
        const h = raw && typeof raw === 'object' ? raw : {};
        // Legacy mutate_interval_sec / tiny sweep intervals → pulse 180.
        let interval = Number(h.interval_sec);
        const legacyMutate = Number(h.mutate_interval_sec);
        if (Number.isFinite(legacyMutate) && legacyMutate >= 60) {
            interval = legacyMutate;
        } else if (!Number.isFinite(interval) || interval < 60) {
            interval = 180;
        }
        let stale = Number(h.stale_sec);
        if (!Number.isFinite(stale) || stale < interval) {
            stale = Math.max(interval + 60, 240);
        }
        const nMax = Number(h.n_max);
        return {
            interval_sec: Math.max(60, Math.floor(interval)),
            stale_sec: Math.max(60, Math.floor(stale)),
            n_max: Number.isFinite(nMax) && nMax >= 1 ? Math.floor(nMax) : 20,
            ...(h.note != null ? { note: String(h.note) } : {}),
        };
    }

    private async saveUnitsState(units: Record<string, any>): Promise<void> {
        const normalized = this.normalizeUnitsState(units);
        let sys = await this.getTip(NAVI_UNIT_SYSTEM_IB);
        if (!sys?.data) {
            throw new Error(`${NAVI_UNIT_SYSTEM_IB} tip missing`);
        }
        sys = await this.mut8Tip(sys, { units: normalized });
        const hb = this.normalizeHeartbeat(normalized.heartbeat);
        // n_max = frame-index size cap (default 20). Prune is a separate
        // getTip + past walk: keep origin and live tip, drop interior.
        if (hb.n_max >= 1) {
            const count = (await this.listTipFrames(NAVI_UNIT_SYSTEM_IB)).length;
            if (count >= hb.n_max) await this.rolloverUnitSystem();
        }
    }

    /**
     * navi:unit frame index reached n_max — prune interior of the past chain.
     * Own getTip; keep origin + live pointer; skip if the span is short.
     */
    private async rolloverUnitSystem(): Promise<void> {
        const sys = await this.getTip(NAVI_UNIT_SYSTEM_IB);
        const hb = this.normalizeHeartbeat(
            sys?.data?.units?.heartbeat || (await this.loadUnitsState()).heartbeat
        );
        await this.pruneUnitSystemInterior(hb.n_max);
    }

    /**
     * Keep generation 0 and the live tip; delete the interior of that chain.
     * Does not write a new generation. Aborts if lineage is shorter than n_max
     * or interior is shorter than n_max-2 (18 when n_max is 20).
     */
    private async pruneUnitSystemInterior(nMax: number): Promise<void> {
        const tipIb = NAVI_UNIT_SYSTEM_IB;
        const tip = await this.getTip(tipIb);
        const gib = String(tip?.gib || "").trim();
        if (!tip?.data || !gib) return;
        const liveAddr = `${tipIb}^${gib}`;
        const hits = await this.walkTipLineage(tipIb);
        const { drop, skip } = unitSystemInteriorDrop(
            hits.map((h) => h.addr),
            liveAddr,
            nMax
        );
        if (skip || !drop.length) return;
        for (const addr of drop) {
            await this.deleteTipFrame(addr);
        }
    }

    private async resolveUnitDefault(arg?: string): Promise<any> {
        const units = await this.loadUnitsState();
        const next = String(arg || '').trim();
        if (!next) {
            return units.resolution || null;
        }
        const ib = canonicalizeTipIb(
            next.startsWith('navi') ? next : unitParkIb(next)
        );
        units.resolution = {
            ...(units.resolution || {}),
            mode: 'default_unit',
            default: ib,
        };
        await this.saveUnitsState(units);
        return units.resolution;
    }

    private async heartbeatUnitControl(arg?: string): Promise<any> {
        const units = await this.loadUnitsState();
        const sec = Number(arg);
        if (!Number.isFinite(sec)) {
            return units.heartbeat || this.emptyUnitsState().heartbeat;
        }
        const next = Math.max(60, Math.floor(sec));
        units.heartbeat = {
            ...this.normalizeHeartbeat(units.heartbeat),
            interval_sec: next,
            stale_sec: Math.max(next + 60, 240),
        };
        await this.saveUnitsState(units);
        this.armUnitHeartbeat();
        return units.heartbeat;
    }

    /**
     * Memory-only entry-plug presence refresh.
     * Updates stamp/last_seen in RAM. Does NOT mut8 navi:unit or run heartbeat.
     */
    public async touchEntryPlug(): Promise<EntryPlugView> {
        await this.ensureEntryPlugSecret();
        if (!this.entryPlug) {
            throw new Error('[plug touch] entry-plug not bound — plug ensure first');
        }
        const stamp = naviStamp();
        this.entryPlug = {
            ...this.entryPlug,
            stamp,
            last_seen: stamp.timestamp,
        };
        return this.signedEntryPlugView({ reveal: false });
    }

    private armUnitHeartbeat(): void {
        if (this.unitHeartbeatTimer) {
            clearInterval(this.unitHeartbeatTimer);
            this.unitHeartbeatTimer = null;
        }
        const tick = async () => {
            try {
                await this.unitHeartbeatSweep();
            } catch (e) {
                this.callout(
                    `[navi] unit heartbeat: ${formatCalloutMessage(e)}`
                );
            }
        };
        void (async () => {
            const units = await this.loadUnitsState();
            const sec = this.normalizeHeartbeat(units.heartbeat).interval_sec;
            await tick();
            this.unitHeartbeatTimer = setInterval(tick, sec * 1000);
        })();
    }

    /**
     * Timer-only (interval_sec, default 180) mut8 of navi:unit —
     *   • bonded entry-plug → set that list row heartbeat_at + online
     *   • other rows with heartbeat_at older than stale_sec (default 240) → offline
     * Callin/relay do not call this — they bind callUnitIb from live entry-plug memory.
     * Explicit plug.touch is memory-only and does not call this.
     */
    private async unitHeartbeatSweep(): Promise<void> {
        const units = await this.loadUnitsState();
        const hb = this.normalizeHeartbeat(units.heartbeat);
        const now = naviStamp.time();
        const cutoff = Date.now() - hb.stale_sec * 1000;

        const bonded = await this.isEntryPlugBonded();
        const selfIb = bonded ? this.entryPlug!.unitIb : null;
        if (selfIb && this.entryPlug) {
            // Keep live plug stamp fresh in memory only — tip write is the list row below.
            this.entryPlug = {
                ...this.entryPlug,
                stamp: naviStamp(),
                last_seen: now,
            };
        }

        const list = (units.list || []).map((row: any) => {
            if (!row?.ib) return row;
            if (selfIb && tipIbsMatch(String(row.ib), selfIb)) {
                return {
                    ...row,
                    online: true,
                    heartbeat_at: now,
                };
            }
            const last = row.heartbeat_at;
            const t = last ? Date.parse(String(last)) : NaN;
            if (!Number.isFinite(t) || t < cutoff) {
                return { ...row, online: false };
            }
            return row;
        });

        units.list = list;
        units.heartbeat = hb;
        await this.saveUnitsState(units);
    }

    /** Mint non-extractable Ed25519 keypair once per runtime (or after factoryreset). */
    private async ensureEntryPlugSecret(): Promise<void> {
        if (this.entryPlugSecret) return;

        const subtle = globalThis.crypto?.subtle;
        if (subtle && typeof subtle.generateKey === 'function') {
            try {
                const pair = (await subtle.generateKey(
                    { name: 'Ed25519' } as AlgorithmIdentifier,
                    false,
                    ['sign', 'verify']
                )) as CryptoKeyPair;
                const raw = new Uint8Array(
                    await subtle.exportKey('raw', pair.publicKey)
                );
                this.entryPlugSecret = {
                    privateKey: pair.privateKey,
                    subtlePublic: pair.publicKey,
                    publicKeyRaw: bytesToBase64Url(raw),
                    backend: 'subtle',
                };
                return;
            } catch {
                /* fall through to node */
            }
        }

        try {
            const nodeCrypto = await import('crypto');
            const { publicKey, privateKey } = nodeCrypto.generateKeyPairSync(
                'ed25519'
            );
            const spki = publicKey.export({ type: 'spki', format: 'der' });
            // SPKI for Ed25519 is 12-byte header + 32-byte raw key.
            const raw =
                spki.length >= 32
                    ? Uint8Array.from(spki).subarray(spki.length - 32)
                    : Uint8Array.from(spki);
            this.entryPlugSecret = {
                privateKey,
                nodePublic: publicKey,
                publicKeyRaw: bytesToBase64Url(raw),
                backend: 'node',
            };
        } catch (err) {
            throw new Error(
                `[navi] entry-plug Ed25519 keygen failed: ${formatCalloutMessage(err)}`
            );
        }
    }

    private async signEntryPlugBytes(data: Uint8Array): Promise<Uint8Array> {
        await this.ensureEntryPlugSecret();
        const secret = this.entryPlugSecret!;
        if (secret.backend === 'subtle') {
            const sig = await globalThis.crypto.subtle.sign(
                { name: 'Ed25519' } as AlgorithmIdentifier,
                secret.privateKey as CryptoKey,
                data as BufferSource
            );
            return new Uint8Array(sig);
        }
        const nodeCrypto = await import('crypto');
        const sig = nodeCrypto.sign(
            null,
            Buffer.from(data),
            secret.privateKey as any
        );
        return new Uint8Array(sig);
    }

    /**
     * Build a signed public view of entry-plug state.
     * Private key never appears; signature is Ed25519-detached over `signed`.
     */
    private async signedEntryPlugView(opts: {
        reveal: boolean;
        created?: boolean;
    }): Promise<EntryPlugView> {
        await this.ensureEntryPlugSecret();
        const secret = this.entryPlugSecret!;
        const bound = !!(this.entryPlug?.unitIb && this.entryPlug?.hash);
        const body: Record<string, any> = {
            alg: 'Ed25519',
            bound,
            kind: 'surface',
            publicKey: secret.publicKeyRaw,
            target: 'plug',
            unitIb: bound ? this.entryPlug!.unitIb : null,
        };
        if (bound && this.entryPlug) {
            body.last_seen = this.entryPlug.last_seen;
            body.stamp = this.entryPlug.stamp;
            body.unitId = this.entryPlug.unitId;
            if (opts.reveal) body.hash = this.entryPlug.hash;
        }
        if (opts.created != null) body.created = opts.created;
        if (!opts.reveal) {
            body.access = {
                GET: 'presence (signed)',
                POST: 'ping|touch|ensure — ping confirms before hash reveal',
            };
        }

        const signed = stableJson(body);
        const signature = bytesToBase64Url(
            await this.signEntryPlugBytes(new TextEncoder().encode(signed))
        );
        return {
            ...(body as Omit<
                EntryPlugView,
                'signature' | 'signed' | 'proof'
            >),
            signed,
            signature,
            proof: {
                scheme: 'Ed25519-detached',
                signed_by: 'entry-plug private key',
                verify_with: 'publicKey',
                note: ENTRY_PLUG_PROOF_NOTE,
            },
        };
    }

    /**
     * Alias a unit tip: kill navi:unit:NN, plant navi:<alias> bonded to root.
     */
    private async aliasUnit(
        unitRef: string,
        aliasRaw: string
    ): Promise<string> {
        const alias = String(aliasRaw || '')
            .trim()
            .replace(/^navi[/:]/, '');
        if (!alias || /[/:]/.test(alias)) {
            throw new Error(
                'Usage: alias <unitIb|01> <name>  (single segment, no / or :)'
            );
        }
        const reserved = new Set([
            'mod',
            'relay',
            'storage',
            'init_script',
            'unit',
            'plug',
            'admin',
            'shell',
            'surf',
            'mount',
            'browse',
            'unmount',
            'surfrefresh',
            'stamp',
            'origin',
            'park',
            'pwa',
            'sw',
            'fetch',
            'reseed',
            'factoryreset',
            'alias',
            'prune',
            'resolve',
            'heartbeat',
            'reindex',
        ]);
        if (reserved.has(alias)) {
            throw new Error(`alias '${alias}' is reserved`);
        }
        const fromIb = canonicalizeTipIb(
            String(unitRef || '').startsWith('navi')
                ? String(unitRef)
                : unitParkIb(unitRef)
        );
        const from = await this.getTip(fromIb);
        if (!from?.data?.unit?.hash) {
            throw new Error(`not a unit tip: ${fromIb}`);
        }
        const toIb = presumeNaviIb(alias);
        if (await this.getTip(toIb)) {
            throw new Error(`tip already exists: ${toIb}`);
        }

        const now = naviStamp.time();
        const stamped = await this.stampTipFrame(
            {
                ib: toIb,
                gib: '<seed-gib>',
                data: {
                    ...from.data,
                    unit: {
                        ...from.data.unit,
                        alias,
                        id: from.data.unit.id,
                        hash: from.data.unit.hash,
                    },
                    timestamp: now,
                    n: undefined,
                },
                rel8ns: {
                    past: [],
                    tjp: [],
                    dna: [],
                    root: [NAVI_ROOT_IB],
                    was: [fromIb],
                },
            },
            now
        );
        await this.setTip(stamped);
        await this.hardEraseTip(fromIb);

        const root = await this.getTip(NAVI_ROOT_IB);
        if (!root?.data) throw new Error('navi root missing');
        const units = await this.loadUnitsState();
        units.aliases = { ...(units.aliases || {}), [alias]: toIb };
        units.list = Array.isArray(units.list)
            ? units.list.map((row: any) =>
                  row && tipIbsMatch(String(row.ib || ''), fromIb)
                      ? { ...row, ib: toIb, alias }
                      : row
              )
            : [];
        if (
            units.resolution?.default &&
            tipIbsMatch(String(units.resolution.default), fromIb)
        ) {
            units.resolution = { ...units.resolution, default: toIb };
        }
        const priorUnitRel = Array.isArray(root.rel8ns?.unit)
            ? root.rel8ns!.unit.filter(
                  (u: string) => !tipIbsMatch(String(u), fromIb)
              )
            : [];
        priorUnitRel.push(toIb);
        await this.saveUnitsState(units);
        await this.mut8Tip(root, {}, { rel8ns: { unit: priorUnitRel } });

        if (this.entryPlug && tipIbsMatch(this.entryPlug.unitIb, fromIb)) {
            this.entryPlug = {
                ...this.entryPlug,
                unitIb: toIb,
            };
        }
        return `[navi] aliased ${fromIb} → ${toIb}`;
    }

    /** Prune offline (default) or all listed unit tips from space + unit bookkeeping. */
    private async pruneUnits(mode: string): Promise<string> {
        await this.requireEntryPlugGate('prune');
        const root = await this.getTip(NAVI_ROOT_IB);
        if (!root?.data) throw new Error('navi root missing');
        const units = await this.loadUnitsState();
        const list = Array.isArray(units.list) ? units.list.slice() : [];
        const wantAll = mode === 'all';
        const victims = list.filter((row: any) => {
            if (!row?.ib) return false;
            if (wantAll) return true;
            return row.online === false;
        });
        if (!victims.length) {
            return `[navi] prune: nothing to remove (${mode})`;
        }
        const removed: string[] = [];
        for (const row of victims) {
            const ib = canonicalizeTipIb(String(row.ib));
            if (this.entryPlug && tipIbsMatch(this.entryPlug.unitIb, ib)) {
                throw new Error(
                    `cannot prune live entry-plug unit ${ib} — close that instance first`
                );
            }
            try {
                await this.hardEraseTip(ib);
            } catch (e) {
                // tip may already be gone
            }
            removed.push(ib);
            if (row.alias && units.aliases) {
                delete units.aliases[row.alias];
            }
        }
        units.list = list.filter(
            (row: any) =>
                !victims.some((v: any) =>
                    tipIbsMatch(String(v.ib || ''), String(row.ib || ''))
                )
        );
        if (
            units.resolution?.default &&
            removed.some((ib) =>
                tipIbsMatch(ib, String(units.resolution.default))
            )
        ) {
            units.resolution = {
                ...units.resolution,
                default: units.list[0]?.ib || null,
            };
        }
        const priorUnitRel = Array.isArray(root.rel8ns?.unit)
            ? root.rel8ns!.unit.filter(
                  (u: string) =>
                      !removed.some((ib) => tipIbsMatch(ib, String(u)))
              )
            : [];
        await this.saveUnitsState(units);
        await this.mut8Tip(root, {}, { rel8ns: { unit: priorUnitRel } });
        return `[navi] pruned ${removed.join(', ')}`;
    }

    /**
     * Plant C_devops/navi_redux seed tips if missing.
     */
    public async ensureNaviReduxSeeds(): Promise<{ planted: string[]; skipped: string[] }> {
        const planted: string[] = [];
        const skipped: string[] = [];
        for (const seed of NAVI_REDUX_SEED_TIPS) {
            const ib = String(seed.ib || '').trim();
            if (!ib) continue;
            const existing = await this.getTip(ib);
            if (existing?.ib) {
                skipped.push(ib);
                continue;
            }
            const isNaviRoot = canonicalizeTipIb(ib) === 'navi';
            const rootStamp = isNaviRoot ? naviStamp() : null;
            const seedWithIdentity = rootStamp
                ? {
                      ...seed,
                      data: {
                          ...(seed.data || {}),
                          ...rootStamp,
                      },
                  }
                : seed;
            const frame = await this.stampTipFrame(
                seedWithIdentity,
                rootStamp?.timestamp
            );
            await this.setTip(frame);
            planted.push(ib);
        }
        if (planted.length) {
            this.callout(`[navi] Planted tip seeds: ${planted.join(', ')}`);
        }
        return { planted, skipped };
    }

    private filterInitScriptLines(lines: string[]): string[] {
        const isDom =
            typeof window !== 'undefined' && typeof document !== 'undefined';
        if (isDom) return lines.map(String);
        return lines
            .map(String)
            .filter((line) => !/\bwindow\b/.test(line) && !/\bdocument\b/.test(line));
    }

    /** Boot script from tip navi/init_script. */
    private async ensureInitScript(): Promise<string[]> {
        try {
            await this.createDefaultModule();

            const tip = await this.getTip(NAVI_INIT_SCRIPT_IB);
            if (!tip?.data || !Array.isArray(tip.data.script) || !tip.data.script.length) {
                throw new Error(
                    `${NAVI_INIT_SCRIPT_IB} tip missing or empty data.script — plant seeds first`
                );
            }
            const lines = this.filterInitScriptLines(tip.data.script);
            this.callout(
                `[navi] Loaded init_script from tip ${NAVI_INIT_SCRIPT_IB} (${lines.length} commands)`
            );
            return lines;
        } catch (error) {
            this.callout('[navi] Failed to load init_script: ' + error);
            throw error;
        }
    }

    private async saveInitScript(commands: string[]): Promise<void> {
        const tip = await this.getTip(NAVI_INIT_SCRIPT_IB);
        if (!tip) {
            throw new Error('navi:init_script tip missing');
        }
        const next = await this.stampTipFrame({
            ...tip,
            data: {
                ...tip.data,
                script: commands,
                n: undefined,
            },
            rel8ns: {
                ...(tip.rel8ns || {}),
                past: tip.gib ? [tip.ib + '^' + tip.gib] : [],
            },
        });
        await this.setTip(next);
    }

    /** Current navi.script() nesting (guards self-referencing script frames). */
    private scriptDepth = 0;

    /**
     * Run script commands in order. JS mode (default) evaluates each array
     * entry as a program (newlines allowed); callin mode POSTs each entry.
     * Entries that are blank or start with `#` / `//` are skipped.
     */
    public async script(
        commands: string[],
        opts: NaviScriptOpts = {}
    ): Promise<NaviScriptResult> {
        const mode = opts.mode === 'callin' ? 'callin' : 'js';
        const args = (opts.args || []).map(String);
        const onError = opts.onError === 'stop' ? 'stop' : 'continue';
        const label = opts.label ? ` ${opts.label}` : '';

        let d = new Date();
        let hh = String(d.getHours()).padStart(2, '0');
        let mm = String(d.getMinutes()).padStart(2, '0');
        let ss = String(d.getSeconds()).padStart(2, '0');
        let tag = `${hh}${mm}${ss}`;

        const scriptCallout = (data: any) => {
            this.emit('callout', `[SCRIPT:${tag}${label}] ${formatCalloutMessage(data)}`);
        };

        const lines = (commands || [])
            .map((c) => String(c ?? '').replace(/^\uFEFF/, '').trim())
            .filter((c) => c && !c.startsWith('#') && !c.startsWith('//'))
            .map((c) =>
                mode === 'callin'
                    ? c
                          .replace(/\$@/g, args.join(' '))
                          .replace(/\$(\d+)/g, (_m, n) => args[Number(n) - 1] ?? '')
                          .trim()
                    : c
            )
            .filter(Boolean);

        const out: NaviScriptResult = { ran: 0, results: [] };
        if (lines.length === 0) {
            scriptCallout('[navi] No commands in script to execute');
            return out;
        }
        if (this.scriptDepth >= NAVI_SCRIPT_MAX_DEPTH) {
            throw new Error(`navi.script${label}: nesting exceeds ${NAVI_SCRIPT_MAX_DEPTH}`);
        }

        scriptCallout(`[navi] Executing ${lines.length} ${mode} commands from script...`);
        this.scriptDepth++;
        try {
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                try {
                    scriptCallout(`[navi] Executing command ${i + 1}/${lines.length}`);
                    const result =
                        mode === 'callin'
                            ? await this.dispatchCallin({
                                  input: line,
                                  method: 'POST',
                                  viaRelay: !!opts.viaRelay,
                              })
                            : await this.executeCommand(line, args);
                    out.results.push({ line, ok: true, result });
                    out.ran++;
                scriptCallout(`[navi] Command ${i + 1} executed successfully`);
            } catch (error) {
                    const msg = formatCalloutMessage(error);
                    out.results.push({ line, ok: false, error: msg });
                    scriptCallout(`[navi] Command ${i + 1} failed: ${line} — ${msg}`);
                    if (onError === 'stop') {
                        throw new Error(`navi.script${label}: '${line}' failed: ${msg}`);
                    }
                }
            }
        } finally {
            this.scriptDepth--;
        }

        scriptCallout('[navi] Script execution completed');
        return out;
    }

    public async addToInitScript(command: string): Promise<void> {
        const commands = await this.getInitScript();
        commands.push(command);
        await this.saveInitScript(commands);
        this.callout(`[navi] Added command to init_script: ${command}`);
    }

    public async clearInitScript(): Promise<void> {
        await this.saveInitScript([]);
        this.callout('[navi] init_script cleared');
    }

    public async getInitScript(): Promise<string[]> {
        const tip = await this.getTip(NAVI_INIT_SCRIPT_IB);
        const script = tip?.data?.script;
        return Array.isArray(script) ? script.map(String) : [];
    }

    private async executeCommand(command: string, args?: string[]): Promise<void> {
        const prevArgs = (globalThis as any).__naviScriptArgs;
        try {
            // Sanitize and analyze the incoming command text
            let trimmed = String(command ?? '').replace(/^\uFEFF/, '').trim();
            if (!trimmed) {
                this.callout('[navi] Empty command provided; skipping');
                return;
            }
            // data:/Function snippets cannot close over locals, so script args
            // travel through a global slot read back into `args` / `$1`..`$9`.
            if (args?.length && !/(^|\s)(import\s|export\s)/.test(trimmed)) {
                (globalThis as any).__naviScriptArgs = args.slice();
                trimmed =
                    'const args = (globalThis.__naviScriptArgs || []).slice(); ' +
                    'const [$1, $2, $3, $4, $5, $6, $7, $8, $9] = args;\n' +
                    trimmed;
            }

            const isBrowser = typeof window !== 'undefined' && typeof window.document !== 'undefined';
            if (!isBrowser && /\b(?:window|document|htmx)\b/.test(trimmed)) {
                this.callout('[navi] Skipping browser-only init command in Node');
                return;
            }

            // Heuristic: treat presence of top-level import/export keywords as module code
            const hasTopLevelModuleSyntax = /(^|\s)(import\s|export\s)/.test(trimmed);

            // Fast-path for Node: avoid data: URLs which can be finicky across Node builds
            if (!isBrowser) {
                if (!hasTopLevelModuleSyntax) {
                    const runner = new Function(`\"use strict\"; return (async () => {\n${trimmed}\n})();`);
                    await (runner as any)();
                    return;
                } else {
                    // Write to a temporary .mjs file and import it
                    try {
                        const { fs, join, tmpdir } = await getNodeFsPathOs();
                        const filePath = join(tmpdir(), `navi-cmd-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`);
                        const moduleSource = `${trimmed}\n\nexport default undefined;`;
                        await fs.writeFile(filePath, moduleSource, 'utf8');
                        const fileUrl = `file:///${filePath.replace(/\\/g, '/')}`;
                        await import(fileUrl);
                        return;
                    } catch (nodeExecErr) {
                        this.callout('[navi] Node file-based execution failed: ' + nodeExecErr);
                        throw nodeExecErr;
                    }
                }
            }

            // import() keeps a module by its data: URL. The same program text would
            // otherwise resolve the module that already ran and not run again.
            const once = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
            const moduleCode = hasTopLevelModuleSyntax
                ? `${trimmed}\n\nexport default undefined;\n// ${once}\n`
                : `export default (async () => {\n${trimmed}\n})();\n// ${once}\n`;

            let moduleUrl: string;
            try {
                const base64 = typeof Buffer !== 'undefined'
                    ? Buffer.from(moduleCode, 'utf8').toString('base64')
                    : btoa(moduleCode);
                moduleUrl = `data:text/javascript;charset=utf-8;base64,${base64}`;
            } catch {
                moduleUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(moduleCode)}`;
            }

            const mod: any = await import(moduleUrl);
            if (mod && 'default' in mod) {
                await mod.default;
            }
        } catch (error) {
            this.callout('[navi] Error executing command: ' + error);
            throw error;
        } finally {
            (globalThis as any).__naviScriptArgs = prevArgs;
        }
    }
    
    // SURF : default module, permits Navi Shell to use Foobarch Hypermedia and GUI

    private async createDefaultModule(): Promise<void> {
        try {
            const surfModuleCode = `export const register = (navi) => {
                const SURF_TIP = "surf";
                const NAVI_MODULE_MIME = "application/navi-module";
                const IB_GIB_HEADER = "x-ib^gib";
                const DEFAULT_SETTINGS = { savesurfs: false, proscene: false };
                const SHELTER_PART = "surf-shelter";
                /** @type {Set<Element>} insertion-ordered immune nodes (strong refs). */
                const persisted = new Set();
                let shelterEl = null;

                function getBaseMime(contentType) {
                    return String(contentType || "").split(";")[0].trim().toLowerCase();
                }

                function isNaviModuleMime(contentType) {
                    return getBaseMime(contentType) === NAVI_MODULE_MIME;
                }

                function isJavaScriptMime(contentType) {
                    const base = getBaseMime(contentType);
                    return base === "text/javascript" || base === "application/javascript" || base === "application/x-javascript";
                }

                function isNaviModuleSource(content) {
                    const hasRegister = /export\\s+(?:const|function)\\s+register\\s*[=({]/.test(content);
                    const hasModuleInfo = /export\\s+const\\s+moduleInfo\\s*=\\s*\\{[^}]*\\bname\\s*:\\s*["'][^"']+["']/.test(content);
                    const hasDefaultExport = /export\\s+default\\s+\\{[^}]*\\bname\\s*:\\s*["'][^"']+["']/.test(content);
                    return hasRegister || (hasModuleInfo && hasDefaultExport);
                }

                function isNaviModule(content, contentType) {
                    if (isNaviModuleMime(contentType)) return true;
                    return isJavaScriptMime(contentType) && isNaviModuleSource(content);
                }

                /**
                 * slashfold — typed whitespace → / (like surf/browse arg join).
                 * Does NOT fold :, so navi:hypertext welcome → navi:hypertext/welcome.
                 * Preserves // stage delimiters. Absolute URLs unchanged.
                 * String → string; Uint8Array/ArrayBufferView → same type (utf-8).
                 * @see A_document/slashfold.md
                 */
                function slashfoldString(raw) {
                    let s = String(raw == null ? "" : raw).trim();
                    if (!s) return "";
                    if (/^[a-z][a-z0-9+.-]*:\\/\\//i.test(s)) return s;
                    return s
                        .replace(/\\s+/g, "/")
                        .replace(/^\\/+/, "")
                        .replace(/\\/{3,}/g, "//");
                }

                async function storageKeyExists(s) {
                    try {
                        if (navi.storage && navi.storage.tip && typeof navi.storage.tip.get === "function") {
                            const tip = await navi.storage.tip.get(s);
                            if (tip) return true;
                        }
                    } catch (e) { /* ignore */ }
                    return false;
                }

                /**
                 * slashfold — typed whitespace → / unless the exact storage key exists.
                 * If the string has whitespace and that tip/file key is present, keep it.
                 * Else whitespace → / (keeps navi: and //). Absolute URLs unchanged.
                 * Async. @see A_document/slashfold.md
                 */
                async function slashfold(input) {
                    if (input == null) return input;
                    const foldText = async (text) => {
                        const s = String(text == null ? "" : text).trim();
                        if (!s) return "";
                        if (/^[a-z][a-z0-9+.-]*:\\/\\//i.test(s)) return s;
                        if (/\\s/.test(s) && await storageKeyExists(s)) return s;
                        return slashfoldString(s);
                    };
                    if (typeof input === "string") return await foldText(input);
                    if (typeof Uint8Array !== "undefined" && input instanceof Uint8Array) {
                        const text = new TextDecoder().decode(input);
                        return new TextEncoder().encode(await foldText(text));
                    }
                    if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView && ArrayBuffer.isView(input)) {
                        const u8 = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
                        const text = new TextDecoder().decode(u8);
                        const out = new TextEncoder().encode(await foldText(text));
                        if (input instanceof Uint8Array) return out;
                        return out;
                    }
                    return await foldText(String(input));
                }

                async function ensureSettings() {
                    const tip = await navi.storage.tip.get(SURF_TIP);
                    if (!tip || !tip.data) {
                        throw new Error("[surf] " + SURF_TIP + " tip missing");
                    }
                    if (!tip.data.settings || typeof tip.data.settings !== "object") {
                        await navi.storage.tip.mut8(SURF_TIP, {
                            settings: Object.assign({}, DEFAULT_SETTINGS)
                        });
                        navi.callout("[surf] Initialized settings on " + SURF_TIP);
                        const again = await navi.storage.tip.get(SURF_TIP);
                        return again.data.settings;
                    }
                    return tip.data.settings;
                }

                async function saveSettings(settings) {
                    await navi.storage.tip.mut8(SURF_TIP, { settings: settings });
                }

                async function saveResourceBin(media, mime) {
                    return await navi.storage.bin.putMedia({ media: media, mime: mime });
                }

                /** Sync install id for data-hash (same scheme as horizon_stagedir). */
                function hashContentSync(text) {
                    const s = String(text == null ? "" : text);
                    let h = 0x811c9dc5;
                    for (let i = 0; i < s.length; i++) {
                        h ^= s.charCodeAt(i);
                        h = Math.imul(h, 0x01000193);
                    }
                    const stamp =
                        Date.now().toString(16) +
                        (Math.floor(Math.random() * 0x10000) >>> 0)
                            .toString(16)
                            .padStart(4, "0");
                    return (
                        (h >>> 0).toString(16).padStart(8, "0") +
                        s.length.toString(16).padStart(6, "0") +
                        stamp
                    );
                }

                function stampDataHash(el, contentHash) {
                    if (!el || el.nodeType !== 1 || !contentHash) return;
                    if (el.hasAttribute("data-hash")) return;
                    el.setAttribute("data-hash", String(contentHash));
                }

                async function loadResourceFromTip(ib) {
                    const media = await navi.storage.bin.mediaFromTip(ib);
                    return { mime: NAVI_MODULE_MIME, media: media };
                }

                async function makeRequest(path, options = {}) {
                    const raw = String(path == null ? "" : path).trim();
                    const local = await navi.park.check(raw, {
                        gatePassthru: (function (h) {
                            if (!h) return false;
                            const v = String(h["X-Navi-Gate-Passthru"] || h["x-navi-gate-passthru"] || "").trim().toLowerCase();
                            return v === "1" || v === "true" || v === "yes";
                        })(options && options.headers)
                    });
                    if (local && local.hit) {
                        return {
                            content: local.body,
                            contentType: local.mime || "application/octet-stream",
                            ibGib: local.ib || null
                        };
                    }

                    const url = encodeURI(navi.resolveUrl(path));
                    const headers = Object.assign({
                        "Accept": "text/plain, text/javascript, application/javascript, application/navi-module",
                        "Content-Type": "text/plain"
                    }, options && options.headers ? options.headers : {});

                    const response = await globalThis.fetch(url, {
                        method: options.method || "GET",
                        headers
                    });
                    if (!response.ok) {
                        throw new Error("HTTP " + response.status + ": " + response.statusText);
                    }

                    const content = await response.text();
                    const contentType = response.headers.get("content-type") || "";
                    const ibGib = response.headers.get(IB_GIB_HEADER);
                    return { content, contentType, ibGib };
                }

                function ensureShelter() {
                    if (typeof document === "undefined" || !document.documentElement) {
                        throw new Error("[surf] persist shelter requires a document");
                    }
                    if (shelterEl && shelterEl.isConnected) return shelterEl;
                    shelterEl = document.createElement("div");
                    shelterEl.setAttribute("data-part", SHELTER_PART);
                    shelterEl.setAttribute("hidden", "");
                    shelterEl.style.display = "none";
                    document.documentElement.appendChild(shelterEl);
                    return shelterEl;
                }

                /** Move a live node via moveBefore() when both ends are connected, so iframes/video keep state. */
                function placeLive(parent, el, ref) {
                    const before = ref || null;
                    if (typeof parent.moveBefore === "function" && el.isConnected && parent.isConnected) {
                        try {
                            parent.moveBefore(el, before);
                            return;
                        } catch { /* fall through */ }
                    }
                    parent.insertBefore(el, before);
                }

                function persist(el) {
                    if (!el || el.nodeType !== 1) {
                        throw new Error("[surf] persist requires an Element");
                    }
                    persisted.add(el);
                    return el;
                }

                function unpersist(el) {
                    return persisted.delete(el);
                }

                function isPersisted(el) {
                    return persisted.has(el);
                }

                function listPersisted() {
                    return Array.from(persisted);
                }

                function parkPersisted() {
                    if (!document.body || persisted.size === 0) return;
                    const shelter = ensureShelter();
                    for (const el of Array.from(persisted)) {
                        if (document.body.contains(el)) {
                            shelter.appendChild(el);
                        }
                    }
                }

                function restorePersisted() {
                    if (!document.body) return;
                    for (const el of Array.from(persisted)) {
                        if (el.isConnected) {
                            document.body.appendChild(el);
                        } else {
                            persisted.delete(el);
                        }
                    }
                }

                /** stagejockey's prosceneBody(nodes) → CS element, or null when not mounted. */
                function findProsceneBody() {
                    const mods = navi.mod || {};
                    const direct = mods.supermouse_plugin_stagejockey;
                    if (direct && typeof direct.prosceneBody === "function") return direct.prosceneBody;
                    for (const key of Object.keys(mods)) {
                        if (typeof mods[key]?.prosceneBody === "function") return mods[key].prosceneBody;
                    }
                    return null;
                }

                async function surf(path, opts = {}) {
                    if (typeof document === "undefined" || !document.body) {
                        navi.callout("[surf] surf requires a browser document");
                        throw new Error("[surf] surf requires a browser document");
                    }
                    // HTTP fetch: spaces become %20 on the wire; park lookup turns them back.
                    // Do not park-check in-page — SW observers (snoopy) must see the GET.
                    // opts.host: X-Navi-Park-Bypass → SW skips localpark, answer comes from the host.
                    const url = encodeURI(navi.resolveUrl(path));
                    const headers = { Accept: "text/html, text/plain, image/*" };
                    if (opts.host) headers["X-Navi-Park-Bypass"] = "1";
                    const response = await globalThis.fetch(url, { headers });
                    if (!response.ok) {
                        throw new Error("HTTP " + response.status + ": " + response.statusText);
                    }
                    const parkIb = response.headers.get("X-Navi-Park-Ib");
                    const parkKind = response.headers.get("X-Navi-Park-Kind");
                    if (parkIb) {
                        navi.callout(
                            "[surf] park hit " + parkIb + " (" + (parkKind || "?") + ")"
                        );
                    }
                    const responseMime = String(response.headers.get("content-type") || "")
                        .split(";")[0].trim().toLowerCase();
                    let html;
                    if (responseMime.startsWith("image/")) {
                        // A picture on its own. Localpark file bins may hold a data: URL string.
                        const blob = await response.blob();
                        const head = await blob.slice(0, 5).text();
                        const src = head === "data:" ? await blob.text() : URL.createObjectURL(blob);
                        const img = document.createElement("img");
                        img.src = src;
                        img.alt = String(path || "").split("/").pop() || "image";
                        img.setAttribute("data-path", String(path || "").replace(/^\\/+/, ""));
                        html = img.outerHTML;
                    } else {
                        html = await response.text();
                    }
                    const contentHash = hashContentSync(html);
                    parkPersisted();
                    const template = document.createElement("template");
                    template.innerHTML = html;
                    const nodes = Array.from(template.content.childNodes);
                    let wantStage = opts.proscene;
                    if (wantStage === undefined) {
                        try {
                            wantStage = !!(await ensureSettings()).proscene;
                        } catch {
                            wantStage = false;
                        }
                    }
                    // Content that brings its own stage (horizon/v1, jockeystage) lands as-is.
                    const ownStage = nodes.some((n) => n.nodeType === 1 && (
                        n.matches('[data-part~="stage"]') || n.querySelector('[data-part~="stage"]')
                    ));
                    const prosceneBody = wantStage && !ownStage ? findProsceneBody() : null;
                    if (wantStage && !ownStage && !prosceneBody) {
                        navi.callout("[surf] proscene needs supermouse_plugin_stagejockey mounted; surfing into body");
                    }
                    let holder = document.body;
                    if (prosceneBody) {
                        holder = prosceneBody(nodes);
                    } else {
                        document.body.replaceChildren(...nodes);
                    }
                    for (const node of Array.from(holder.children)) {
                        if (node.nodeType === 1) {
                            stampDataHash(node, contentHash);
                            // Nested data-part roots (e.g. enter htmf inside horizon/v1)
                            // get their own install hash from their outerHTML.
                            try {
                                for (const part of Array.from(
                                    node.querySelectorAll("[data-part]")
                                )) {
                                    if (
                                        part instanceof HTMLElement &&
                                        !part.hasAttribute("data-hash")
                                    ) {
                                        stampDataHash(
                                            part,
                                            hashContentSync(part.outerHTML)
                                        );
                                    }
                                }
                            } catch {
                                /* ignore */
                            }
                        }
                    }
                    holder.querySelectorAll("script").forEach((oldScript) => {
                        const script = document.createElement("script");
                        for (const attr of oldScript.attributes) {
                            script.setAttribute(attr.name, attr.value);
                        }
                        script.textContent = oldScript.textContent;
                        oldScript.replaceWith(script);
                    });
                    const htmxApi = globalThis.htmx;
                    if (htmxApi && typeof htmxApi.process === "function") {
                        for (const node of Array.from(holder.children)) {
                            if (node.nodeType === 1) {
                                htmxApi.process(node);
                            }
                        }
                    }
                    restorePersisted();
                    // Page landed. Settings and other surf commands never reach here.
                    try { navi.emit?.("surf", String(path || "").replace(/^\\/+/, "")); } catch { /* ignore */ }
                    return "[surf] Surfing " + (parkIb || url);
                }

                /**
                 * Full document load of origin / — PWA stand-in for a hard
                 * browser navigate/reload of the shell (re-run navi_shell + init).
                 */
                function surfrefresh() {
                    if (typeof window === "undefined" || !window.location) {
                        throw new Error("[surf] surfrefresh requires a browser window");
                    }
                    const root = window.location.origin + "/";
                    const atRoot =
                        (window.location.pathname === "/" || window.location.pathname === "")
                        && !window.location.search
                        && !window.location.hash;
                    if (atRoot) {
                        window.location.reload();
                    } else {
                        window.location.replace(root);
                    }
                    return "[surf] surfrefresh " + root;
                }

                async function browse(route, options = {}) {
                    try {
                        const { content, contentType, ibGib } = await makeRequest(route, options);
                        const settings = await ensureSettings();
                        const baseMime = getBaseMime(contentType);
                        const naviModule = isNaviModule(content, contentType);
                        const saveMime = naviModule ? NAVI_MODULE_MIME : baseMime || "text/plain";

                        // browse is text-only: modules reveal their source, never auto-mount.
                        if (settings.savesurfs) {
                            const sha = await saveResourceBin(content, saveMime);
                            navi.callout("[surf] saved bin " + sha + (naviModule ? " (module)" : ""));
                        }

                        return content;
                    } catch (error) {
                        const msg = error && error.message ? error.message : String(error);
                        return "Error fetching " + route + ": " + msg;
                    }
                }

                function calloutMountError(summary, explain) {
                    const line = explain ? summary + " — " + explain : summary;
                    navi.callout(line);
                    return line;
                }

                async function mountFromTip(ib) {
                    const tipIb = String(ib || "").replace(/^\\/+/, "");
                    try {
                        navi.callout("[surf] Loading tip: " + tipIb);
                        const entry = await loadResourceFromTip(tipIb);
                        if (!entry || !entry.media) {
                            return calloutMountError(
                                "Error: no bin on tip: " + tipIb,
                                "remount needs a planted park (tip navi:<name> with a bin); install via mount <route> first"
                            );
                        }
                        if (!isNaviModuleSource(entry.media)) {
                            return calloutMountError(
                                "Error: " + tipIb + " bin is not a Navi module",
                                "bin must export register (or moduleInfo + default export with name); browse the tip media to inspect"
                            );
                        }
                        await navi.mount(entry.media);
                        return "[surf] Mounted " + tipIb;
                    } catch (error) {
                        const msg = error && error.message ? error.message : String(error);
                        return calloutMountError(
                            "Error mounting tip " + tipIb + ": " + msg,
                            "loads tip bin, runs register(), syncs navi:mod; check syntax, register() return { name }, and park tips"
                        );
                    }
                }

                async function mount(target, options = {}) {
                    const raw = String(target || "").trim();
                    if (/^navi(?:[/:\\s]|$)/.test(raw)) {
                        return await mountFromTip(raw);
                    }
                    // Route install: mount runs register() first, then plants tip+bin
                    // under the live moduleObject.name (no source-scrape name).
                    try {
                        const { content, contentType } = await makeRequest(target, options);
                        if (!isNaviModule(content, contentType)) {
                            return calloutMountError(
                                "Error: " + target + " is not a Navi module",
                                "expected MIME application/navi-module or JS with export register; use browse to read the text (mount does not install HTML/JSON)"
                            );
                        }
                        const mod = await navi.mount(content);
                        const name = mod && mod.name ? String(mod.name) : "";
                        return name
                            ? "[surf] Installed & mounted navi:" + name
                            : "[surf] Installed & mounted " + target;
                    } catch (error) {
                        const msg = error && error.message ? error.message : String(error);
                        return calloutMountError(
                            "Error mounting " + target + ": " + msg,
                            "install fetches the route, runs register(), then plants tip+bin as navi:<name> from the live name"
                        );
                    }
                }

                async function unmount(modName, opts) {
                    const name = String(modName || "").trim();
                    const kill = !!(opts && opts.kill);
                    if (!name) {
                        return "Usage: unmount [-k] <modname>  (e.g. unmount pecklogger; -k also storage kills its park tip)";
                    }
                    const mod = navi.mod && navi.mod[name];
                    if (!mod) {
                        const known = typeof navi.listModules === "function"
                            ? navi.listModules().join(", ")
                            : Object.keys(navi.mod || {}).join(", ");
                        return calloutMountError(
                            "Error: navi.mod." + name + " is not mounted"
                                + (known ? " (mounted: " + known + ")" : ""),
                            "unmount drops a live register() module and removes it from the remount ledger (navi:mod); remount with mount navi:" +
                                name +
                                " if the park tip still exists"
                        );
                    }
                    try {
                        await navi.unmount(mod);
                    } catch (error) {
                        const msg = error && error.message ? error.message : String(error);
                        return calloutMountError(
                            "Error unmounting " + name + ": " + msg,
                            "onUnmount runs then the module is removed from navi.mod / navi:mod index"
                        );
                    }
                    if (!kill) return "[surf] Unmounted " + name;
                    try {
                        const killed = await navi.storage.kill(name);
                        return "[surf] Unmounted " + name + "\\n" + killed;
                    } catch (error) {
                        const msg = error && error.message ? error.message : String(error);
                        return "[surf] Unmounted " + name + "\\n[kill] not done: " + msg;
                    }
                }

                return {
                    name: "surf",
                    version: "1.8.15",
                    description: "Interactive CLI to interact with foobarch routing system",

                    moduleInfo: {
                        name: "surf",
                        version: "1.8.15",
                        description: "surf + tip/bin settings + plantModulePark; data-hash FNV+ts+entropy"
                    },

                    commands: {
                        surf: {
                            name: "surf",
                            description: "Navigate to a foobarch route (fetch HTML, then swap)",
                            execute: async (segment, ...args) => {
                                if (!segment) {
                                    return [
                                        "surf v1.8.15",
                                        "",
                                        "Usage:",
                                        "  surf <route>              Navigate to route, render HTML (images shown on their own)",
                                        "  surf -h <route>           Same, but skip localpark: render what the host serves",
                                        "  surf -p <route>           Surf onto an empty proscene stage: content lands in Center Stage",
                                        "  surf --no-p <route>       Plain body surf even when surf_settings proscene is on",
                                        "  surfrefresh               Hard reload origin / (PWA page reload)",
                                        "  browse <route>            Fetch text; modules show source (no mount)",
                                        "  mount <route|navi:name> Plant tip+bin & mount, or remount from tip",
                                        "  unmount [-k] <modname>    Unmount navi.mod.<modname> (-k: then storage kill its tip)",
                                        "  surf/surf_settings        Show settings (on tip surf)",
                                        "  surf/surf_settings savesurfs <true|false>",
                                        "  surf/surf_settings proscene <true|false>   every surf acts like -p (default false)",
                                        "",
                                        "DOM (programmatic on navi.mod.surf):",
                                        "  persist(el) / unpersist(el) / isPersisted(el) / listPersisted()",
                                        "  slashfold(str|bytes)      optional fold; surf/browse passthru is not folded",
                                        "  X-Navi-Gate-Passthru      skip data.gate winner in delimiter race",
                                        "",
                                        "Modules live as tip+bin (navi:<name>), including surf."
                                    ].join("\\n");
                                }
                                const words = [segment, ...args].filter(Boolean);
                                const flags = new Set(["-h", "--host", "-p", "--proscene", "--no-p"]);
                                const host = words.some((w) => w === "-h" || w === "--host");
                                const proscene = words.includes("--no-p")
                                    ? false
                                    : words.some((w) => w === "-p" || w === "--proscene") || undefined;
                                const joined = words.filter((w) => !flags.has(w)).join("/");
                                if (!joined) return "Usage: surf [-h] [-p|--no-p] <route>";
                                const path = "/" + String(joined || "").replace(/^\\/+/, "");
                                return await surf(path, { host, proscene });
                            }
                        },
                        browse: {
                            name: "browse",
                            description: "Fetch a foobarch route and return its text (modules show source, no mount)",
                            execute: async (route, ...args) => {
                                if (!route) {
                                    return "Usage: browse <route>  (e.g. browse manifest)";
                                }
                                const joined = [route, ...args].join(" ").trim();
                                return await browse(joined, {});
                            }
                        },
                        surfrefresh: {
                            name: "surfrefresh",
                            description: "Hard reload origin / (PWA stand-in for a browser reload of the shell)",
                            execute: async () => {
                                return surfrefresh();
                            }
                        },
                        mount: {
                            name: "mount",
                            description: "Install & mount a Navi module (route → tip+bin, or remount navi:name)",
                            execute: async (target, ...args) => {
                                if (!target) {
                                    return "Usage: mount <route|navi:name>  (e.g. mount potter/x, or mount navi:potter)";
                                }
                                const joined = [target, ...args].join(" ").trim();
                                return await mount(joined);
                            }
                        },
                        unmount: {
                            name: "unmount",
                            description: "Unmount a registered module by name (navi.mod.<modname>); -k also storage kills its park tip",
                            execute: async (...args) => {
                                const words = args.map((a) => String(a ?? "").trim()).filter(Boolean);
                                const kill = words.some((w) => w === "-k" || w === "--kill");
                                const rest = words.filter((w) => w !== "-k" && w !== "--kill");
                                return await unmount(rest[0], { kill });
                            }
                        },
                        surf_settings: {
                            name: "surf_settings",
                            description: "View or update surf settings",
                            execute: async (key, value) => {
                                const settings = await ensureSettings();
                                if (!key) {
                                    return "surf_settings:\\n" + JSON.stringify(settings, null, 2);
                                }
                                if (key === "savesurfs") {
                                    if (value === undefined) {
                                        return "savesurfs: " + settings.savesurfs;
                                    }
                                    const enabled = value === "true" || value === "1" || value === "on";
                                    settings.savesurfs = enabled;
                                    await saveSettings(settings);
                                    return "savesurfs set to " + enabled;
                                }
                                if (key === "proscene") {
                                    if (value === undefined) {
                                        return "proscene: " + !!settings.proscene;
                                    }
                                    const enabled = value === "true" || value === "1" || value === "on";
                                    settings.proscene = enabled;
                                    await saveSettings(settings);
                                    return "proscene set to " + enabled + (enabled ? " (surf lands in Center Stage; surf --no-p for body)" : "");
                                }
                                return "Unknown setting: " + key;
                            }
                        }
                    },

                    surf,
                    surfrefresh,
                    browse,
                    mount,
                    unmount,
                    ensureSettings,
                    persist,
                    unpersist,
                    isPersisted,
                    listPersisted,
                    slashfold,

                    onMount: async () => {
                        await ensureSettings();
                        navi.callout("[surf] Ready (v1.8.15)");
                    },

                    onUnmount: () => {
                        navi.callout("[surf] Module unmounted");
                    }
                };
            };`;

            await this.plantSurfModuleBin(surfModuleCode);
            this.callout('[navi] Surf module planted as tip+bin (surf)');
            const hostparkinatorModuleCode = "/**\n * hostparkinator_5000 — ibgib-native Foobarch alternative (localnavi module).\n *\n * Proposals → route tips (park + http controls). Commit-frame PUT only.\n * SQLite beside navi_shell.exe. Default bind localhost:5353.\n *\n * Callin:\n *   hostparkinator_5000 start [port] | stop | status | status size | help\n *   hostparkinator_5000 host [localhost|0.0.0.0|127.0.0.1]\n *   hostparkinator_5000 db [path]              SQLite file (default: <exeDir>/hostparkinator_5000.sqlite)\n *   hostparkinator_5000 static [dir]\n *   hostparkinator_5000 password | password set <pwd>\n *   hostparkinator_5000 mint [count]           mint set: shared 16-hex lead + 48 unique (64 each)\n *   hostparkinator_5000 list | tip <ib> | reindex\n *   hostparkinator_5000 seed [staticDir]       seed navi_shell.js / sw.js from static dir\n *   hostparkinator_5000 seed schemas           seed foobarch.schema.keys.v1 Lua write gate\n *   hostparkinator_5000 admin delete <ib>\n *   hostparkinator_5000 remount_host [route] | remount_host path [route]\n *\n * HTTP:\n *   GET  WS /_foobarch/navi_shell?uuid=[&token=]   reverse-channel register (shell: relay connect → navi.origin; token optional)\n *        first frame: hello { owner, pay } — owner secret pinned per uuid on first connect; pay = one usage\n *        token spent per connection (tokens.used_addr = relay-connect:<uuid>); reply welcome { ok }\n *   GET|POST /{navi_shell park}/{remainder}      HTTP callin relay → 202 {job_id} (poll job); X-Navi-Shell-Wait:1 holds until result\n *   GET  /_foobarch/navi_shell/job/{uuid}/{id}   peek running or claim done body (then dump)\n *   GET  /{navi_shell park}/_job/{id}            same claim under the park\n *   *    /{ib}[…]                  park tip data.method[METHOD] → bin|proxy|redirect|commit|tombstone\n *   PUT|PATCH /{ib} (miss)         firstGen commit envelope + usage payment; if an ancestor tip has\n *                                  rel8ns.genesis_policy, its schema's authorize_genesis() must allow\n *   POST /foobarch/tokens          mint { tokens } (password)\n *   GET  /foobarch/list | tip | frame | span\n *   *    /foobarch/admin/*         usage-password gated\n *\n * Mutation payment (commit/tombstone kinds, any HTTP verb): X-Foobarch-Usage-Token\n * else data.foobarch.tokens (self, drop head) else foobarch.token_reserve (2 tokens).\n */\n\nexport const register = (navi) => {\n    const isBrowser =\n        typeof window !== \"undefined\" && typeof window.document !== \"undefined\";\n    const isNode =\n        typeof process !== \"undefined\" &&\n        !!(process.versions && process.versions.node);\n\n    const eventListeners = [];\n    const createdElements = [];\n    const addedStyles = [];\n    const observers = [];\n    const timers = [];\n\n    const DEFAULT_PORT = 5353;\n    const DEFAULT_HOST = \"localhost\";\n    const DEFAULT_STATIC = \"static\";\n    const DEFAULT_USAGE_PASSWORD =\n        (typeof process !== \"undefined\" && process.env && process.env.FOOBARCH_USAGE_PASSWORD) || \"\";\n    const USAGE_TOKEN_HEADER = \"X-Foobarch-Usage-Token\";\n    const USAGE_PASSWORD_HEADER = \"X-Foobarch-Usage-Password\";\n    const WRITE_SIGN_PREFIX = \"proposal-write-v1\";\n\n    const DEFAULT_REMOUNT_PATH = \"torus/native/hostparkinator_5000\";\n\n    const STORAGE = {\n        port: \"hostparkinator_5000.port\",\n        host: \"hostparkinator_5000.host\",\n        staticDir: \"hostparkinator_5000.static_dir\",\n        dbPath: \"hostparkinator_5000.db_path\",\n        remountPath: \"hostparkinator_5000.remount_host\",\n    };\n    /** Pre-rename keys (module was foobarch_host ≤0.3.22); read-only fallback. */\n    const LEGACY_STORAGE = {\n        port: \"foobarch_host.port\",\n        host: \"foobarch_host.host\",\n        staticDir: \"foobarch_host.static_dir\",\n        dbPath: \"foobarch_host.db_path\",\n    };\n    const DB_FILE = \"hostparkinator_5000.sqlite\";\n    const LEGACY_DB_FILE = \"foobarch_host.sqlite\";\n\n    const WS_GUID = \"258EAFA5-E914-47DA-95CA-C5AB0DC85B11\";\n    const NAVI_SHELL_TOKEN_HEADER = \"X-Navi-Shell-Usage-Token\";\n    const NAVI_SHELL_WAIT_HEADER = \"X-Navi-Shell-Wait\";\n    const NAVI_SHELL_MAX_INFLIGHT = 16;\n    /** A relay socket must send its paid hello within this window or it is closed. */\n    const NAVI_SHELL_HELLO_MS = 15000;\n    /** Max time a sync-wait (X-Navi-Shell-Wait) callin may run before 504. */\n    const NAVI_SHELL_JOB_MS = (() => {\n        const v = Number(process.env.FOOBARCH_NAVI_SHELL_JOB_MS);\n        return Number.isFinite(v) && v > 0 ? v : 600000;\n    })();\n    /** After result is ready, drop unclaimed jobs (avoid ballooning). */\n    const NAVI_SHELL_JOB_DONE_TTL_MS = (() => {\n        const v = Number(process.env.FOOBARCH_NAVI_SHELL_JOB_DONE_TTL_MS);\n        return Number.isFinite(v) && v > 0 ? v : 60000;\n    })();\n    /** Skip (do not close the socket) navi_shell WS payloads above this. */\n    const NAVI_SHELL_WS_MAX_PAYLOAD = (() => {\n        const v = Number(process.env.FOOBARCH_NAVI_SHELL_WS_MAX_MB);\n        return (Number.isFinite(v) && v > 0 ? v : 128) * 1024 * 1024;\n    })();\n\n    function naviShellWantWait(headers) {\n        const raw = (() => {\n            if (!headers || typeof headers !== \"object\") return \"\";\n            for (const [k, v] of Object.entries(headers)) {\n                if (String(k).toLowerCase() === NAVI_SHELL_WAIT_HEADER.toLowerCase()) {\n                    return Array.isArray(v) ? String(v[0] || \"\") : String(v || \"\");\n                }\n            }\n            return \"\";\n        })();\n        const s = raw.trim().toLowerCase();\n        return s === \"1\" || s === \"true\" || s === \"yes\" || s === \"wait\";\n    }\n\n    function formatNaviShellResult(result, extra) {\n        if (!result || result.ok === false) {\n            const status = Number(result?.status) || 502;\n            if (result?.media != null && String(result.media).length) {\n                return {\n                    status,\n                    body: String(result.media),\n                    type:\n                        result.mime ||\n                        \"application/json; charset=utf-8\",\n                };\n            }\n            return {\n                status,\n                body: JSON.stringify({\n                    error: result?.error || \"navi_shell callin failed\",\n                    ...extra,\n                    via: \"navi_shell\",\n                }),\n                type: \"application/json; charset=utf-8\",\n            };\n        }\n        const media = result.media != null ? String(result.media) : \"\";\n        const mime = result.mime || \"text/plain; charset=utf-8\";\n        return { status: 200, body: media, type: mime };\n    }\n\n    // Keep in sync with navi_shell/src/navi_redux_seeds.ts (delimiter race + gate).\n\n    const normalizeParkIb = (ib) =>\n        String(ib || \"\")\n            .trim()\n            .replace(/^\\/+/, \"\");\n\n    const pct20ToSpace = (s) => String(s || \"\").replace(/%20/gi, \" \");\n\n    const tokenizeParkIb = (ib) => {\n        const s = normalizeParkIb(pct20ToSpace(ib));\n        const segments = [];\n        const gaps = [];\n        let buf = \"\";\n        let i = 0;\n        const pushSeg = () => {\n            if (!buf) return;\n            segments.push(buf);\n            buf = \"\";\n        };\n        while (i < s.length) {\n            if (s.startsWith(\"//\", i)) {\n                pushSeg();\n                if (segments.length) gaps.push(\"//\");\n                i += 2;\n                continue;\n            }\n            const c = s[i];\n            if (c === \":\" || c === \"/\" || /\\s/.test(c)) {\n                pushSeg();\n                if (!segments.length) {\n                    i += 1;\n                    continue;\n                }\n                if (/\\s/.test(c)) {\n                    while (i < s.length && /\\s/.test(s[i]) && !s.startsWith(\"//\", i)) {\n                        i += 1;\n                    }\n                    gaps.push(\" \");\n                } else {\n                    gaps.push(c);\n                    i += 1;\n                }\n                continue;\n            }\n            buf += c;\n            i += 1;\n        }\n        pushSeg();\n        while (gaps.length >= segments.length) gaps.pop();\n        return { segments, gaps };\n    };\n\n    const joinParkIb = (segments, gaps) => {\n        if (!segments.length) return \"\";\n        let out = segments[0];\n        const n = Math.min(gaps.length, segments.length - 1);\n        for (let i = 0; i < n; i++) out += gaps[i] + segments[i + 1];\n        for (let i = n + 1; i < segments.length; i++) out += \" \" + segments[i];\n        return out;\n    };\n\n    /**\n     * Resolve-set claim: only `park: \"capture\" | \"defer\"`.\n     * Boolean / precedence / capture flags are not read — migrate tips first.\n     */\n    const isParkClaimed = (data) => {\n        if (typeof data?.park !== \"string\") return false;\n        const s = data.park.trim().toLowerCase();\n        return s === \"capture\" || s === \"defer\";\n    };\n\n    /** Capture vs defer — string claim only. */\n    const isParkCaptureData = (data) => {\n        if (typeof data?.park !== \"string\") return false;\n        return data.park.trim().toLowerCase() === \"capture\";\n    };\n\n    const CAPTURE_PATH_HOPS = 8;\n\n    const slashSegs = (s) =>\n        String(s || \"\")\n            .replace(/^\\/+|\\/+$/g, \"\")\n            .split(\"/\")\n            .filter(Boolean);\n\n    /**\n     * Longest `data.paths` prefix of remainder.\n     * keys are slash paths (e.g. scranton/plugin); values are target ibs.\n     */\n    const matchKnownPath = (paths, remainder) => {\n        if (!paths || typeof paths !== \"object\") return null;\n        const rem = slashSegs(remainder);\n        if (!rem.length) return null;\n        let best = null;\n        for (const [key, target] of Object.entries(paths)) {\n            if (typeof target !== \"string\" || !String(target).trim()) continue;\n            const ks = slashSegs(key);\n            if (!ks.length || ks.length > rem.length) continue;\n            if (!ks.every((seg, i) => seg === rem[i])) continue;\n            if (!best || ks.length > best.len) {\n                best = {\n                    key,\n                    target: slashSegs(target).join(\"/\"),\n                    leftover: rem.slice(ks.length).join(\"/\"),\n                    len: ks.length,\n                };\n            }\n        }\n        return best;\n    };\n\n    /** Index depth from ib segments. */\n    const parkDepthForIndex = (ib) => {\n        const segs = tokenizeParkIb(ib).segments.length;\n        return segs > 0 ? segs : 1;\n    };\n\n    const delimiterRaceSignature = (ib) => {\n        const raw = normalizeParkIb(pct20ToSpace(ib));\n        if (!raw) return \"\";\n        if (/^[a-z][a-z0-9+.-]*:\\/\\//i.test(raw)) return \"abs:\" + raw;\n        const { segments, gaps } = tokenizeParkIb(raw);\n        const marks = [];\n        for (let i = 0; i < segments.length - 1; i++) {\n            marks.push((gaps[i] || \" \") === \"//\" ? \"//\" : \"*\");\n        }\n        return segments.join(\"\\0\") + \"\\n\" + marks.join(\"\\0\");\n    };\n\n    const liveDelimiterHits = (want, live) => {\n        const sig = delimiterRaceSignature(want);\n        if (!sig) return [];\n        const raw = normalizeParkIb(pct20ToSpace(want));\n        const hits = (live || []).filter(\n            (ib) => delimiterRaceSignature(ib) === sig\n        );\n        if (raw && hits.includes(raw)) {\n            return [raw, ...hits.filter((h) => h !== raw)];\n        }\n        return hits;\n    };\n\n    const isTipGateTrue = (data) =>\n        !!(data && typeof data === \"object\" && data.gate === true);\n\n    const isGatePassthruHeader = (value) => {\n        const s = String(value ?? \"\")\n            .trim()\n            .toLowerCase();\n        return s === \"1\" || s === \"true\" || s === \"yes\";\n    };\n\n    const wsAccept = (key) => {\n        const crypto = nodeRequire(\"crypto\");\n        return crypto\n            .createHash(\"sha1\")\n            .update(String(key || \"\") + WS_GUID)\n            .digest(\"base64\");\n    };\n\n    const wsEncodeText = (text) => {\n        const payload = Buffer.from(String(text ?? \"\"), \"utf8\");\n        const len = payload.length;\n        let header;\n        if (len < 126) {\n            header = Buffer.alloc(2);\n            header[0] = 0x81;\n            header[1] = len;\n        } else if (len < 65536) {\n            header = Buffer.alloc(4);\n            header[0] = 0x81;\n            header[1] = 126;\n            header.writeUInt16BE(len, 2);\n        } else {\n            header = Buffer.alloc(10);\n            header[0] = 0x81;\n            header[1] = 127;\n            header.writeUInt32BE(0, 2);\n            header.writeUInt32BE(len, 6);\n        }\n        return Buffer.concat([header, payload]);\n    };\n\n    const wsEncodePong = (payload) => {\n        const p = Buffer.isBuffer(payload) ? payload : Buffer.alloc(0);\n        const header = Buffer.alloc(2);\n        header[0] = 0x8a;\n        header[1] = p.length < 126 ? p.length : 0;\n        if (p.length >= 126) return Buffer.concat([Buffer.from([0x8a, 0]), p.slice(0, 0)]);\n        return Buffer.concat([header, p]);\n    };\n\n    const wsEncodeClose = () => Buffer.from([0x88, 0x00]);\n\n    /** Parse one or more complete WS frames from buf. Returns { msgs, rest, ping, closed }. */\n    // Browsers split messages over ~64KB into continuation frames (FIN=0, then\n    // opcode 0); `frag` carries the partial message across socket chunks.\n    const wsDecode = (buf, frag = { parts: null, size: 0 }) => {\n        const msgs = [];\n        const pings = [];\n        let closed = false;\n        let offset = 0;\n        while (buf.length - offset >= 2) {\n            const b0 = buf[offset];\n            const b1 = buf[offset + 1];\n            const fin = (b0 & 0x80) !== 0;\n            const opcode = b0 & 0x0f;\n            const masked = (b1 & 0x80) !== 0;\n            let len = b1 & 0x7f;\n            let hdr = 2;\n            if (len === 126) {\n                if (buf.length - offset < 4) break;\n                len = buf.readUInt16BE(offset + 2);\n                hdr = 4;\n            } else if (len === 127) {\n                if (buf.length - offset < 10) break;\n                const hi = buf.readUInt32BE(offset + 2);\n                const lo = buf.readUInt32BE(offset + 6);\n                hdr = 10;\n                // Oversize closes the socket so held callins fail fast instead of hanging.\n                if (hi !== 0 || lo > NAVI_SHELL_WS_MAX_PAYLOAD) {\n                    closed = true;\n                    break;\n                }\n                len = lo;\n            }\n            const maskLen = masked ? 4 : 0;\n            if (buf.length - offset < hdr + maskLen + len) break;\n            let payload = buf.slice(offset + hdr + maskLen, offset + hdr + maskLen + len);\n            if (masked) {\n                const mask = buf.slice(offset + hdr, offset + hdr + 4);\n                const out = Buffer.alloc(payload.length);\n                for (let i = 0; i < payload.length; i++) out[i] = payload[i] ^ mask[i % 4];\n                payload = out;\n            }\n            offset += hdr + maskLen + len;\n            if (opcode === 0x8) {\n                closed = true;\n                break;\n            }\n            if (opcode === 0x9) {\n                pings.push(payload);\n                continue;\n            }\n            if (opcode === 0xa) continue;\n            if (opcode === 0x1 || opcode === 0x2) {\n                if (fin) {\n                    frag.parts = null;\n                    frag.size = 0;\n                    msgs.push(payload.toString(\"utf8\"));\n                } else {\n                    frag.parts = [payload];\n                    frag.size = payload.length;\n                }\n                continue;\n            }\n            if (opcode === 0x0 && frag.parts) {\n                frag.size += payload.length;\n                if (frag.size > NAVI_SHELL_WS_MAX_PAYLOAD) {\n                    closed = true;\n                    break;\n                }\n                frag.parts.push(payload);\n                if (fin) {\n                    msgs.push(Buffer.concat(frag.parts).toString(\"utf8\"));\n                    frag.parts = null;\n                    frag.size = 0;\n                }\n            }\n        }\n        return { msgs, pings, closed, rest: buf.slice(offset) };\n    };\n\n    const nodeRequire = (id) => navi.require(id);\n\n    function log(...args) {\n        console.log(\"[hostparkinator_5000]\", ...args);\n    }\n    function warn(...args) {\n        console.warn(\"[hostparkinator_5000]\", ...args);\n    }\n\n    const ensureNative = () => {\n        if (isBrowser || !isNode) {\n            throw new Error(\"[hostparkinator_5000] native (Node / navi_shell.exe) only\");\n        }\n    };\n\n    const randomHex = (n) => {\n        const crypto = nodeRequire(\"crypto\");\n        return crypto.randomBytes(n).toString(\"hex\");\n    };\n\n    const sha256Hex = (buf) => {\n        const crypto = nodeRequire(\"crypto\");\n        return crypto.createHash(\"sha256\").update(buf).digest(\"hex\");\n    };\n    const sha256HexSync = (s) => sha256Hex(Buffer.from(String(s), \"utf8\"));\n    const relaySecretEqual = (a, b) => {\n        const x = Buffer.from(String(a), \"utf8\");\n        const y = Buffer.from(String(b), \"utf8\");\n        return x.length === y.length && nodeRequire(\"crypto\").timingSafeEqual(x, y);\n    };\n\n    const formatBytes = (n) => {\n        const b = Math.max(0, Number(n) || 0);\n        if (b < 1024) return `${b} B`;\n        if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;\n        if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;\n        return `${(b / 1024 ** 3).toFixed(2)} GB`;\n    };\n\n    const sqliteFileSizes = (dbPath) => {\n        const fs = nodeRequire(\"fs\");\n        const files = [];\n        let total = 0;\n        const kinds = [\n            { kind: \"sqlite\", path: dbPath },\n            { kind: \"wal\", path: `${dbPath}-wal` },\n            { kind: \"shm\", path: `${dbPath}-shm` },\n            { kind: \"journal\", path: `${dbPath}-journal` },\n        ];\n        for (const k of kinds) {\n            let bytes = 0;\n            let exists = false;\n            try {\n                const st = fs.statSync(k.path);\n                if (st.isFile()) {\n                    exists = true;\n                    bytes = Number(st.size) || 0;\n                    total += bytes;\n                }\n            } catch {\n                /* missing sidecar */\n            }\n            files.push({\n                kind: k.kind,\n                path: k.path,\n                exists,\n                bytes,\n                size: formatBytes(bytes),\n            });\n        }\n        return { files, total, size: formatBytes(total) };\n    };\n\n    const defaultDbPath = () => {\n        const path = nodeRequire(\"path\");\n        const exe = process.execPath || process.argv?.[0] || \".\";\n        const dir = path.dirname(exe);\n        const next = path.join(dir, DB_FILE);\n        const legacy = path.join(dir, LEGACY_DB_FILE);\n        const fs = nodeRequire(\"fs\");\n        if (!fs.existsSync(next) && fs.existsSync(legacy)) return legacy;\n        return next;\n    };\n\n    // ─── SQLite store (inlined for single-file mount) ───────────────────────\n\n    const SCHEMA = `\nCREATE TABLE IF NOT EXISTS frames (\n  addr TEXT PRIMARY KEY NOT NULL,\n  ib TEXT NOT NULL,\n  gib TEXT NOT NULL,\n  json TEXT NOT NULL\n);\nCREATE TABLE IF NOT EXISTS tips (\n  ib TEXT PRIMARY KEY NOT NULL,\n  addr TEXT NOT NULL,\n  tombstone INTEGER NOT NULL DEFAULT 0,\n  park INTEGER NOT NULL DEFAULT 0,\n  park_depth INTEGER NOT NULL DEFAULT 0\n);\nCREATE TABLE IF NOT EXISTS versions (\n  ib TEXT NOT NULL,\n  addr TEXT NOT NULL,\n  n INTEGER,\n  PRIMARY KEY (ib, addr)\n);\nCREATE TABLE IF NOT EXISTS bin (\n  sha256 TEXT PRIMARY KEY NOT NULL,\n  bytes BLOB NOT NULL,\n  content_type TEXT\n);\nCREATE TABLE IF NOT EXISTS park_index (\n  root TEXT NOT NULL,\n  ib TEXT NOT NULL,\n  park_depth INTEGER NOT NULL DEFAULT 1,\n  addr TEXT NOT NULL,\n  PRIMARY KEY (root, ib)\n);\nCREATE TABLE IF NOT EXISTS tokens (\n  token TEXT PRIMARY KEY NOT NULL,\n  used_addr TEXT\n);\nCREATE TABLE IF NOT EXISTS meta (\n  key TEXT PRIMARY KEY NOT NULL,\n  value TEXT NOT NULL\n);\nCREATE INDEX IF NOT EXISTS idx_park_root ON park_index(root);\nCREATE INDEX IF NOT EXISTS idx_frames_ib ON frames(ib);\n`;\n\n    function wrapDb(raw) {\n        return {\n            exec(sql) {\n                raw.exec(sql);\n            },\n            prepare(sql) {\n                const stmt = raw.prepare(sql);\n                return {\n                    get(...params) {\n                        return stmt.get(...params);\n                    },\n                    all(...params) {\n                        return stmt.all(...params);\n                    },\n                    run(...params) {\n                        const info = stmt.run(...params);\n                        return { changes: Number(info?.changes ?? 0) };\n                    },\n                };\n            },\n        };\n    }\n\n    function openStore(dbPath) {\n        const { DatabaseSync } = nodeRequire(\"node:sqlite\");\n        const fs = nodeRequire(\"fs\");\n        const path = nodeRequire(\"path\");\n        fs.mkdirSync(path.dirname(dbPath), { recursive: true });\n        const raw = new DatabaseSync(dbPath);\n        const db = wrapDb(raw);\n        db.exec(SCHEMA);\n\n        const stmts = {\n            putFrame: db.prepare(\n                `INSERT OR REPLACE INTO frames(addr, ib, gib, json) VALUES(?, ?, ?, ?)`\n            ),\n            getFrame: db.prepare(`SELECT json FROM frames WHERE addr = ?`),\n            putTip: db.prepare(\n                `INSERT OR REPLACE INTO tips(ib, addr, tombstone, park, park_depth) VALUES(?, ?, ?, ?, ?)`\n            ),\n            getTip: db.prepare(\n                `SELECT ib, addr, tombstone, park, park_depth FROM tips WHERE ib = ?`\n            ),\n            delTip: db.prepare(`DELETE FROM tips WHERE ib = ?`),\n            listTips: db.prepare(\n                `SELECT ib, addr, tombstone, park, park_depth FROM tips ORDER BY ib LIMIT ? OFFSET ?`\n            ),\n            listTipIbs: db.prepare(\n                `SELECT ib FROM tips WHERE tombstone = 0 ORDER BY ib`\n            ),\n            putVersion: db.prepare(\n                `INSERT OR IGNORE INTO versions(ib, addr, n) VALUES(?, ?, ?)`\n            ),\n            delVersions: db.prepare(`DELETE FROM versions WHERE ib = ?`),\n            versionsNewest: db.prepare(\n                `SELECT addr FROM versions WHERE ib = ? ORDER BY rowid DESC LIMIT ?`\n            ),\n            putBin: db.prepare(\n                `INSERT OR REPLACE INTO bin(sha256, bytes, content_type) VALUES(?, ?, ?)`\n            ),\n            getBin: db.prepare(\n                `SELECT bytes, content_type FROM bin WHERE sha256 = ?`\n            ),\n            putPark: db.prepare(\n                `INSERT OR REPLACE INTO park_index(root, ib, park_depth, addr) VALUES(?, ?, ?, ?)`\n            ),\n            delParkIb: db.prepare(`DELETE FROM park_index WHERE ib = ?`),\n            parksForRoot: db.prepare(\n                `SELECT root, ib, park_depth, addr FROM park_index WHERE root = ?`\n            ),\n            reindexClear: db.prepare(`DELETE FROM park_index`),\n            putToken: db.prepare(\n                `INSERT OR IGNORE INTO tokens(token, used_addr) VALUES(?, NULL)`\n            ),\n            getToken: db.prepare(\n                `SELECT token, used_addr FROM tokens WHERE token = ?`\n            ),\n            useToken: db.prepare(\n                `UPDATE tokens SET used_addr = ? WHERE token = ? AND used_addr IS NULL`\n            ),\n            getMeta: db.prepare(`SELECT value FROM meta WHERE key = ?`),\n            setMeta: db.prepare(\n                `INSERT OR REPLACE INTO meta(key, value) VALUES(?, ?)`\n            ),\n            delFramesForIb: db.prepare(`DELETE FROM frames WHERE ib = ?`),\n            frameAddrsForIb: db.prepare(`SELECT addr FROM frames WHERE ib = ?`),\n            delFrame: db.prepare(`DELETE FROM frames WHERE addr = ?`),\n            delVersionAddr: db.prepare(`DELETE FROM versions WHERE addr = ?`),\n            delTokensUsedBy: db.prepare(`DELETE FROM tokens WHERE used_addr = ?`),\n            delBin: db.prepare(`DELETE FROM bin WHERE lower(sha256) = lower(?)`),\n            sumFrames: db.prepare(\n                `SELECT IFNULL(SUM(LENGTH(json)), 0) AS bytes FROM frames`\n            ),\n            sumBin: db.prepare(\n                `SELECT IFNULL(SUM(LENGTH(bytes)), 0) AS bytes FROM bin`\n            ),\n        };\n\n        const getMeta = (key, fallback = null) => {\n            const row = stmts.getMeta.get(key);\n            return row ? String(row.value) : fallback;\n        };\n        const setMeta = (key, value) => stmts.setMeta.run(key, String(value));\n\n        const putFrame = (ibGib) => {\n            if (!ibGib || ibGib.ib == null || ibGib.gib == null) {\n                throw new Error(\"putFrame requires ibGib with ib+gib\");\n            }\n            const addr = `${ibGib.ib}^${ibGib.gib}`;\n            stmts.putFrame.run(\n                addr,\n                String(ibGib.ib),\n                String(ibGib.gib),\n                JSON.stringify(ibGib)\n            );\n            return addr;\n        };\n\n        const getFrame = (addr) => {\n            const row = stmts.getFrame.get(String(addr || \"\").trim());\n            if (!row?.json) return null;\n            try {\n                return JSON.parse(row.json);\n            } catch {\n                return null;\n            }\n        };\n\n        const putBin = (sha256, bytes, contentType) => {\n            const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);\n            stmts.putBin.run(\n                String(sha256),\n                buf,\n                contentType || \"application/octet-stream\"\n            );\n            return sha256;\n        };\n\n        const getBin = (sha256) => {\n            const row = stmts.getBin.get(String(sha256 || \"\").trim());\n            if (!row) return null;\n            return {\n                bytes: Buffer.from(row.bytes),\n                content_type: row.content_type || \"application/octet-stream\",\n            };\n        };\n\n        const rootOf = (ib) => {\n            const segs = tokenizeParkIb(ib).segments;\n            return segs[0] || \"\";\n        };\n\n        const assertParkGate = (ib, frame) => {\n            if (!isTipGateTrue(frame?.data)) return;\n            const want = String(ib || \"\").trim();\n            const live = stmts.listTipIbs.all().map((r) => r.ib);\n            for (const key of liveDelimiterHits(want, live)) {\n                if (key === want) continue;\n                const other = getTip(key);\n                if (\n                    other &&\n                    !other.tombstone &&\n                    isTipGateTrue(other.frame?.data)\n                ) {\n                    throw new Error(\n                        `cannot gate '${want}': race set already has gate frame '${other.ib}'. Mut8 that park to gate=false (or omit gate) first.`\n                    );\n                }\n            }\n        };\n\n        const setTip = (ib, addr, { tombstone = false } = {}) => {\n            const frame = getFrame(addr);\n            const park = isParkClaimed(frame?.data);\n            const parkDepth = park ? parkDepthForIndex(ib) : 0;\n            const n = Number(frame?.data?.n);\n            stmts.putTip.run(\n                ib,\n                addr,\n                tombstone ? 1 : 0,\n                park ? 1 : 0,\n                park ? parkDepth : 0\n            );\n            stmts.putVersion.run(ib, addr, Number.isFinite(n) ? n : null);\n            stmts.delParkIb.run(ib);\n            if (park && !tombstone) {\n                const root = rootOf(ib);\n                if (root) stmts.putPark.run(root, ib, parkDepth, addr);\n            }\n            return { ib, addr, park, parkDepth };\n        };\n\n        const getTip = (ib) => {\n            const row = stmts.getTip.get(String(ib || \"\").trim());\n            if (!row) return null;\n            return {\n                ib: row.ib,\n                addr: row.addr,\n                tombstone: !!row.tombstone,\n                park: !!row.park,\n                park_depth: Number(row.park_depth) || 0,\n                frame: getFrame(row.addr),\n            };\n        };\n\n        /** Past chain newest-first; `max` stops after that many hits. */\n        const walkLineage = (ib, max) => {\n            const want = String(ib || \"\").trim();\n            if (!want) return [];\n            const cap =\n                max != null && Number.isFinite(Number(max))\n                    ? Math.max(0, Math.floor(Number(max)))\n                    : Infinity;\n            if (cap === 0) return [];\n            const tip = getTip(want);\n            if (!tip?.frame) return [];\n            const hits = [];\n            const seen = new Set();\n            let frame = tip.frame;\n            let tipIb = String(frame.ib || want).trim();\n            while (frame && hits.length < cap) {\n                const gib = String(frame.gib || \"\").trim();\n                if (!gib) break;\n                const addr = `${tipIb}^${gib}`;\n                if (seen.has(addr)) break;\n                seen.add(addr);\n                hits.push({\n                    addr,\n                    ib: tipIb,\n                    gib,\n                    n: Number(frame.data?.n) || hits.length,\n                    frame,\n                });\n                if (hits.length >= cap) break;\n                const past0 = Array.isArray(frame.rel8ns?.past)\n                    ? String(frame.rel8ns.past[0] || \"\").trim()\n                    : \"\";\n                if (!past0) break;\n                frame = getFrame(past0);\n                tipIb = String(frame?.ib || tipIb).trim();\n            }\n            return hits;\n        };\n\n        /**\n         * Newest frame ever committed to `ib` (any chain, by commit order) whose data has every\n         * `where` path equal to its value, e.g. { \"about.branch\": \"stage\" }.\n         */\n        const latestVersionWhere = (ib, where, scanCap = 2000) => {\n            const want = String(ib || \"\").trim();\n            const conds = Object.entries(where || {});\n            if (!want || !conds.length) return null;\n            const valueAt = (obj, path) => {\n                let cur = obj;\n                for (const seg of String(path).split(\".\")) {\n                    if (cur == null || typeof cur !== \"object\") return undefined;\n                    cur = cur[seg];\n                }\n                return cur;\n            };\n            const rows = stmts.versionsNewest.all(want, scanCap);\n            for (const row of rows) {\n                const frame = getFrame(row.addr);\n                if (!frame) continue;\n                const ok = conds.every(([path, value]) => {\n                    const v = valueAt(frame.data, path);\n                    return v != null && typeof v !== \"object\" && String(v) === String(value);\n                });\n                if (ok) return { ib: want, addr: row.addr, frame };\n            }\n            return null;\n        };\n\n        const parksForRoot = (root) =>\n            stmts.parksForRoot.all(String(root || \"\").trim()).map((r) => ({\n                root: r.root,\n                ib: r.ib,\n                park_depth: Number(r.park_depth) || 1,\n                addr: r.addr,\n            }));\n\n        const reindexParks = () => {\n            stmts.reindexClear.run();\n            let n = 0;\n            for (const t of stmts.listTips.all(100000, 0)) {\n                if (t.tombstone) continue;\n                const frame = getFrame(t.addr);\n                if (!isParkClaimed(frame?.data)) continue;\n                const root = rootOf(t.ib);\n                if (!root) continue;\n                const parkDepth = parkDepthForIndex(t.ib);\n                stmts.putPark.run(root, t.ib, parkDepth, t.addr);\n                n++;\n            }\n            return n;\n        };\n\n        const hardDeleteIb = (ib) => {\n            const tip = getTip(ib);\n            for (const row of stmts.frameAddrsForIb.all(ib)) {\n                stmts.delTokensUsedBy.run(row.addr);\n            }\n            stmts.delParkIb.run(ib);\n            stmts.delVersions.run(ib);\n            stmts.delTip.run(ib);\n            stmts.delFramesForIb.run(ib);\n            return { ib, hadTip: !!tip };\n        };\n\n        /**\n         * Admin purge of one frame: row, version entry, and the usage token that paid for it.\n         * If it is its ib's tip, the tip rewinds to rel8ns.past[0] (or the ib is dropped).\n         */\n        const purgeFrame = (addr) => {\n            const a = String(addr || \"\").trim();\n            const frame = getFrame(a);\n            const ib = String(frame?.ib ?? a.split(\"^\")[0]).trim();\n            const tip = getTip(ib);\n            let rewoundTo = null;\n            let tipDeleted = false;\n            if (tip && tip.addr === a) {\n                const past = Array.isArray(frame?.rel8ns?.past)\n                    ? String(frame.rel8ns.past[0] || \"\").trim()\n                    : \"\";\n                if (past && getFrame(past)) {\n                    setTip(ib, past, { tombstone: !!getFrame(past)?.data?.tombstone });\n                    rewoundTo = past;\n                } else {\n                    stmts.delParkIb.run(ib);\n                    stmts.delVersions.run(ib);\n                    stmts.delTip.run(ib);\n                    tipDeleted = true;\n                }\n            }\n            stmts.delFrame.run(a);\n            stmts.delVersionAddr.run(a);\n            stmts.delTokensUsedBy.run(a);\n            return { addr: a, hadFrame: !!frame, rewoundTo, tipDeleted };\n        };\n\n        const purgeBin = (sha256) => ({\n            sha256: String(sha256 || \"\").trim().toLowerCase(),\n            deleted: stmts.delBin.run(String(sha256 || \"\").trim()).changes,\n        });\n\n        /**\n         * Mint a set: shared 16-hex lead once, then 48-hex unique suffix each\n         * → 64-char tokens. Same lead ⇒ same mint batch (read it off tokens[0].slice(0,16)).\n         * @returns {string[]}\n         */\n        const mintTokens = (count) => {\n            const n = Math.max(1, Math.floor(Number(count)) || 1);\n            const lead = randomHex(8); // 8 bytes → 16 hex\n            const out = [];\n            for (let i = 0; i < n; i++) {\n                const t = lead + randomHex(24); // 24 bytes → 48 hex\n                stmts.putToken.run(t);\n                out.push(t);\n            }\n            return out;\n        };\n\n        const probeToken = (token) => {\n            const row = stmts.getToken.get(String(token || \"\").trim());\n            if (!row) return { ok: false, status: 401, error: \"invalid usage token\" };\n            if (row.used_addr) {\n                return {\n                    ok: false,\n                    status: 403,\n                    error: \"usage token already consumed\",\n                };\n            }\n            return { ok: true, token: row.token };\n        };\n\n        const consumeToken = (token, addr) => {\n            const probe = probeToken(token);\n            if (!probe.ok) return probe;\n            const r = stmts.useToken.run(String(addr || \"ok\"), probe.token);\n            if (!r.changes) {\n                return {\n                    ok: false,\n                    status: 403,\n                    error: \"usage token already consumed\",\n                };\n            }\n            return { ok: true };\n        };\n\n        const persistTransform = (envelope) => {\n            const head = envelope?.newIbGib;\n            if (!head) throw new Error(\"commit envelope missing newIbGib\");\n            assertParkGate(String(head.ib), head);\n            const all = [];\n            if (Array.isArray(envelope.intermediateIbGibs)) {\n                all.push(...envelope.intermediateIbGibs);\n            }\n            if (Array.isArray(envelope.dnas)) all.push(...envelope.dnas);\n            all.push(head);\n            const addrs = [];\n            for (const frame of all) {\n                if (frame?.ib != null && frame?.gib != null) {\n                    addrs.push(putFrame(frame));\n                }\n            }\n            if (envelope.bin?.sha256 && envelope.bin?.bytes_b64) {\n                putBin(\n                    envelope.bin.sha256,\n                    Buffer.from(envelope.bin.bytes_b64, \"base64\"),\n                    envelope.bin.content_type || \"application/octet-stream\"\n                );\n            }\n            // Optional multi-bin: array or { sha → bin } map (ua_get secondary slots).\n            const extraBins = Array.isArray(envelope.bins)\n                ? envelope.bins\n                : envelope.bins && typeof envelope.bins === \"object\"\n                  ? Object.values(envelope.bins)\n                  : [];\n            for (const b of extraBins) {\n                if (!b?.sha256 || !b?.bytes_b64) continue;\n                if (\n                    envelope.bin?.sha256 &&\n                    String(b.sha256) === String(envelope.bin.sha256)\n                ) {\n                    continue;\n                }\n                putBin(\n                    b.sha256,\n                    Buffer.from(b.bytes_b64, \"base64\"),\n                    b.content_type || \"application/octet-stream\"\n                );\n            }\n            const addr = `${head.ib}^${head.gib}`;\n            setTip(String(head.ib), addr, {\n                tombstone: !!head?.data?.tombstone,\n            });\n            return { addr, addrs, head };\n        };\n\n        if (!getMeta(\"usage_password\")) {\n            setMeta(\"usage_password\", DEFAULT_USAGE_PASSWORD);\n        }\n        if (getMeta(\"park_index_root\") !== \"token\") {\n            reindexParks();\n            setMeta(\"park_index_root\", \"token\");\n        }\n\n        return {\n            dbPath,\n            putFrame,\n            getFrame,\n            putBin,\n            getBin,\n            setTip,\n            getTip,\n            walkLineage,\n            latestVersionWhere,\n            parksForRoot,\n            reindexParks,\n            hardDeleteIb,\n            purgeFrame,\n            purgeBin,\n            mintTokens,\n            probeToken,\n            consumeToken,\n            persistTransform,\n            getMeta,\n            setMeta,\n            listTips: (limit = 200, offset = 0) =>\n                stmts.listTips.all(limit, offset).map((r) => ({\n                    ib: r.ib,\n                    addr: r.addr,\n                    tombstone: !!r.tombstone,\n                    park: !!r.park,\n                    park_depth: Number(r.park_depth) || 0,\n                })),\n            listTipIbs: () => stmts.listTipIbs.all().map((r) => String(r.ib || \"\")),\n            payloadSizes: () => {\n                const frames = Number(stmts.sumFrames.get()?.bytes ?? 0);\n                const bin = Number(stmts.sumBin.get()?.bytes ?? 0);\n                return {\n                    frames: { bytes: frames, size: formatBytes(frames) },\n                    bin: { bytes: bin, size: formatBytes(bin) },\n                };\n            },\n            close: () => {\n                try {\n                    raw.close();\n                } catch {\n                    /* ignore */\n                }\n            },\n        };\n    }\n\n    function normalizeSpanDir(raw) {\n        const d = String(raw || \"\").trim().toLowerCase();\n        if (d === \"forward\" || d === \"all\") return d;\n        return \"reverse\";\n    }\n\n    function orderSpanHits(chain, opts = {}) {\n        const dir = normalizeSpanDir(opts.dir);\n        const offset = Math.max(0, Math.floor(Number(opts.offset) || 0));\n        const ordered = dir === \"reverse\" ? chain : chain.slice().reverse();\n        const limitRaw = opts.limit;\n        if (limitRaw != null && Number.isFinite(Number(limitRaw))) {\n            return ordered.slice(\n                offset,\n                offset + Math.max(0, Math.floor(Number(limitRaw)))\n            );\n        }\n        if (offset > 0) return ordered.slice(offset);\n        return ordered;\n    }\n\n    // ─── Write gates: schema tip (Lua) → policy tip → content tip ───────────\n    // tip.rel8ns.policy → policy frame → rel8ns.schema | data.schema_ib → Lua\n    // authorize(). Stock schema ib: foobarch.schema.keys.v1 (fengari VM).\n    // Fail closed if policy has no resolvable Lua schema (no embedded JS keys gate).\n\n    const SCHEMA_KEYS_IB = \"foobarch.schema.keys.v1\";\n    const SCHEMA_CONTENT_TYPE = \"text/x-lua\";\n    const SCHEMA_FETCH_BUDGET = 64;\n    const SCHEMA_TIMEOUT_MS = (() => {\n        const v = Number(process.env.FOOBARCH_SCHEMA_TIMEOUT_MS);\n        return Number.isFinite(v) && v > 0 ? v : 2000;\n    })();\n    const LUA_TIMEOUT_MS = (() => {\n        const v = Number(process.env.FOOBARCH_LUA_TIMEOUT_MS);\n        return Number.isFinite(v) && v > 0 ? v : 5000;\n    })();\n    const PARK_REQUEST_TIMEOUT_MS = (() => {\n        const v = Number(process.env.FOOBARCH_PARK_REQUEST_TIMEOUT_MS);\n        return Number.isFinite(v) && v > 0 ? v : 8000;\n    })();\n    const LUA_PARK_HOPS = 8;\n    const READ_SIGN_PREFIX = \"proposal-read-v1\";\n\n    /** Pure-Lua JSON (Flowerpot-compatible). Lua has no native JSON. */\n    const JSON_DECODE_LUA = `\ndo\n  local function skip_ws(s, i)\n    return (s:find(\"[^ \\\\t\\\\r\\\\n]\", i)) or (#s + 1)\n  end\n  local function fail(msg, i)\n    error(\"json_decode: \" .. msg .. \" at \" .. i, 0)\n  end\n  local escapes = { ['\"']='\"', [\"\\\\\\\\\"]=\"\\\\\\\\\", [\"/\"]=\"/\", b=\"\\\\b\", f=\"\\\\f\", n=\"\\\\n\", r=\"\\\\r\", t=\"\\\\t\" }\n  local function decode_string(s, i)\n    i = i + 1\n    local out = {}\n    while true do\n      local c = s:sub(i, i)\n      if c == \"\" then fail(\"unterminated string\", i) end\n      if c == '\"' then return table.concat(out), i + 1 end\n      if c == \"\\\\\\\\\" then\n        local e = s:sub(i + 1, i + 1)\n        if e == \"u\" then\n          local code = tonumber(s:sub(i + 2, i + 5), 16)\n          if not code then fail(\"bad unicode escape\", i) end\n          out[#out + 1] = utf8.char(code)\n          i = i + 6\n        elseif escapes[e] then\n          out[#out + 1] = escapes[e]\n          i = i + 2\n        else\n          fail(\"bad escape\", i)\n        end\n      else\n        out[#out + 1] = c\n        i = i + 1\n      end\n    end\n  end\n  local function decode_number(s, i)\n    local j = s:find(\"[^-+0-9eE.]\", i) or (#s + 1)\n    local n = tonumber(s:sub(i, j - 1))\n    if n == nil then fail(\"bad number\", i) end\n    return n, j\n  end\n  local decode_value\n  decode_value = function(s, i)\n    i = skip_ws(s, i)\n    local c = s:sub(i, i)\n    if c == \"\" then fail(\"unexpected end\", i) end\n    if c == '\"' then return decode_string(s, i) end\n    if c == \"{\" then\n      local obj = {}\n      i = skip_ws(s, i + 1)\n      if s:sub(i, i) == \"}\" then return obj, i + 1 end\n      while true do\n        i = skip_ws(s, i)\n        if s:sub(i, i) ~= '\"' then fail(\"expected key\", i) end\n        local k\n        k, i = decode_string(s, i)\n        i = skip_ws(s, i)\n        if s:sub(i, i) ~= \":\" then fail(\"expected ':'\", i) end\n        local v\n        v, i = decode_value(s, i + 1)\n        obj[k] = v\n        i = skip_ws(s, i)\n        local d = s:sub(i, i)\n        if d == \",\" then i = i + 1\n        elseif d == \"}\" then return obj, i + 1\n        else fail(\"expected ',' or '}'\", i) end\n      end\n    end\n    if c == \"[\" then\n      local arr = {}\n      i = skip_ws(s, i + 1)\n      if s:sub(i, i) == \"]\" then return arr, i + 1 end\n      local n = 0\n      while true do\n        local v\n        v, i = decode_value(s, i)\n        n = n + 1\n        arr[n] = v\n        i = skip_ws(s, i)\n        local d = s:sub(i, i)\n        if d == \",\" then i = i + 1\n        elseif d == \"]\" then return arr, i + 1\n        else fail(\"expected ',' or ']'\", i) end\n      end\n    end\n    if s:sub(i, i + 3) == \"true\" then return true, i + 4 end\n    if s:sub(i, i + 4) == \"false\" then return false, i + 5 end\n    if s:sub(i, i + 3) == \"null\" then return nil, i + 4 end\n    return decode_number(s, i)\n  end\n  json_decode = function(s)\n    if type(s) ~= \"string\" then return nil, \"json_decode: expected string\" end\n    local ok, value = pcall(decode_value, s, 1)\n    if not ok then return nil, value end\n    return value\n  end\n  pcall(function()\n    if flowerpot then flowerpot.json_decode = json_decode end\n    if foobarch then foobarch.json_decode = json_decode end\n  end)\nend\n`;\n\n    const readMessage = ({ ib, timestamp = \"\" }) =>\n        [READ_SIGN_PREFIX, ib || \"\", timestamp === undefined || timestamp === null ? \"\" : String(timestamp)].join(\n            \"\\n\"\n        );\n\n    /** Sync HTTP via child Node (Lua host cannot await on the same thread). */\n    const syncHttpFetch = (url, { method = \"GET\", headers = {}, body = null, timeoutMs }) => {\n        const fs = nodeRequire(\"fs\");\n        const path = nodeRequire(\"path\");\n        const os = nodeRequire(\"os\");\n        const { spawnSync } = nodeRequire(\"child_process\");\n        const tmp = path.join(os.tmpdir(), `foobarch_park_${randomHex(8)}.mjs`);\n        const payload = {\n            url: String(url),\n            method: String(method || \"GET\").toUpperCase(),\n            headers: headers && typeof headers === \"object\" ? headers : {},\n            body_b64: body ? Buffer.from(body).toString(\"base64\") : \"\",\n        };\n        const script =\n            `const p = ${JSON.stringify(payload)};\\n` +\n            \"const body = p.body_b64 ? Buffer.from(p.body_b64, 'base64') : undefined;\\n\" +\n            \"const res = await fetch(p.url, { method: p.method, headers: p.headers, body });\\n\" +\n            \"const buf = Buffer.from(await res.arrayBuffer());\\n\" +\n            \"const hdrs = {};\\n\" +\n            \"res.headers.forEach((v, k) => { hdrs[k] = v; });\\n\" +\n            \"process.stdout.write(JSON.stringify({\\n\" +\n            \"  status: res.status,\\n\" +\n            \"  type: res.headers.get('content-type') || 'application/octet-stream',\\n\" +\n            \"  headers: hdrs,\\n\" +\n            \"  body_b64: buf.toString('base64'),\\n\" +\n            \"}));\\n\";\n        fs.writeFileSync(tmp, script, \"utf8\");\n        try {\n            const r = spawnSync(process.execPath, [tmp], {\n                encoding: \"buffer\",\n                timeout: timeoutMs || PARK_REQUEST_TIMEOUT_MS,\n                maxBuffer: 12 * 1024 * 1024,\n                windowsHide: true,\n            });\n            if (r.error) throw r.error;\n            if (r.status !== 0) {\n                const err =\n                    (r.stderr && r.stderr.toString(\"utf8\")) || `status ${r.status}`;\n                throw new Error(`park_request http failed: ${err.slice(0, 300)}`);\n            }\n            return JSON.parse(r.stdout.toString(\"utf8\"));\n        } finally {\n            try {\n                fs.unlinkSync(tmp);\n            } catch {\n                /* ignore */\n            }\n        }\n    };\n    /** Stock keys gate — keep in sync with hostparkinator_5000/schemas/keys_v1.lua */\n    const KEYS_V1_LUA = `-- foobarch.schema.keys.v1\n-- m-of-n ed25519 write authorization (client-generated keys).\n-- Policy instance data: { threshold = n, keys = { \"x1\", \"x2\", ... } }\n-- ctx is provided by foobarch_host; flowerpot.* / foobarch.* are host builtins.\n\nfunction authorize()\n  local keys = ctx.policy.keys\n  local threshold = ctx.policy.threshold\n  if type(keys) ~= \"table\" or #keys < 1 then\n    return { allow = false, aside_ok = true, error = \"policy.keys required\" }\n  end\n  if type(threshold) ~= \"number\" or threshold < 1 then\n    threshold = #keys\n  end\n  if threshold > #keys then\n    return { allow = false, aside_ok = false, error = \"invalid threshold\" }\n  end\n\n  local sign_keys = ctx.sign_keys or {}\n  local signatures = ctx.signatures or {}\n  local used = {}\n  local valid = 0\n  local n = math.min(#sign_keys, #signatures)\n  local verify = (foobarch and foobarch.verify_ed25519)\n    or (flowerpot and flowerpot.verify_ed25519)\n\n  for i = 1, n do\n    local pub = sign_keys[i]\n    local sig = signatures[i]\n    if pub and sig and not used[pub] then\n      local listed = false\n      for _, k in ipairs(keys) do\n        if k == pub then\n          listed = true\n          break\n        end\n      end\n      if listed and verify(pub, ctx.message, sig) then\n        used[pub] = true\n        valid = valid + 1\n      end\n    end\n  end\n\n  if valid >= threshold then\n    return { allow = true }\n  end\n  return {\n    allow = false,\n    aside_ok = true,\n    error = \"keys threshold not met\",\n    valid = valid,\n    threshold = threshold,\n  }\nend\n`;\n\n    const writeMessage = ({ ib, parentAddr = \"\", body, contentType }) => {\n        const buf = Buffer.isBuffer(body) ? body : Buffer.from(body ?? []);\n        const contentSha256 = sha256Hex(buf);\n        return [\n            WRITE_SIGN_PREFIX,\n            ib,\n            parentAddr || \"\",\n            contentSha256,\n            contentType || \"application/octet-stream\",\n        ].join(\"\\n\");\n    };\n\n    const verifyEd25519 = (publicKeyX, message, signatureB64url) => {\n        const crypto = nodeRequire(\"crypto\");\n        try {\n            const key = crypto.createPublicKey({\n                key: { kty: \"OKP\", crv: \"Ed25519\", x: publicKeyX },\n                format: \"jwk\",\n            });\n            return crypto.verify(\n                null,\n                Buffer.from(message, \"utf8\"),\n                key,\n                Buffer.from(signatureB64url, \"base64url\")\n            );\n        } catch {\n            return false;\n        }\n    };\n\n    const parseHeaderList = (raw) => {\n        if (!raw) return [];\n        const s = String(raw).trim();\n        if (!s) return [];\n        if (s.startsWith(\"[\")) {\n            try {\n                const arr = JSON.parse(s);\n                return Array.isArray(arr) ? arr.map(String) : [];\n            } catch {\n                /* fall through */\n            }\n        }\n        return s.split(/[,\\s]+/).filter(Boolean);\n    };\n\n    const policyAddrOf = (frame) => {\n        const pol = frame?.rel8ns?.policy;\n        return Array.isArray(pol) && pol.length ? String(pol[pol.length - 1]) : \"\";\n    };\n\n    /**\n     * firstGen gate: nearest live ancestor tip (by \"/\" segments) whose\n     * rel8ns.genesis_policy names a policy. Its schema's authorize_genesis()\n     * decides every first write (and tombstone reclaim) under that prefix.\n     */\n    const genesisGateFor = (store, ib) => {\n        const segs = String(ib || \"\").split(\"/\");\n        for (let i = segs.length - 1; i >= 1; i--) {\n            const prefix = segs.slice(0, i).join(\"/\");\n            const tip = store.getTip(prefix);\n            if (!tip || tip.tombstone) continue;\n            const pol = tip.frame?.rel8ns?.genesis_policy;\n            if (Array.isArray(pol) && pol.length) {\n                return { governor: prefix, policyAddr: String(pol[pol.length - 1]) };\n            }\n        }\n        return null;\n    };\n\n    const readPayloadJson = (store, addr) => {\n        const frame = store.getFrame(addr);\n        if (!frame) return null;\n        const binAddr = frame.rel8ns?.bin?.[0];\n        if (binAddr) {\n            const sha = String(binAddr).replace(/^bin\\s+/i, \"\");\n            const blob = store.getBin(sha);\n            if (blob) {\n                try {\n                    return JSON.parse(blob.bytes.toString(\"utf8\"));\n                } catch {\n                    /* fall through */\n                }\n            }\n        }\n        return frame.data && typeof frame.data === \"object\" ? { ...frame.data } : {};\n    };\n\n    const readPayloadText = (store, addr) => {\n        const frame = store.getFrame(addr);\n        if (!frame) return \"\";\n        const binAddr = frame.rel8ns?.bin?.[0];\n        if (binAddr) {\n            const sha = String(binAddr).replace(/^bin\\s+/i, \"\");\n            const blob = store.getBin(sha);\n            if (blob) return blob.bytes.toString(\"utf8\");\n        }\n        if (typeof frame.data?.source === \"string\") return frame.data.source;\n        if (typeof frame.data?.lua === \"string\") return frame.data.lua;\n        return \"\";\n    };\n\n    /**\n     * Which rel8ns.bin entry a method control serves.\n     *   ctrl.select { \"<first remainder segment>\": index | \"bin <sha>\" } + ctrl.default\n     *   ctrl.bin    index | \"bin <sha>\" (fixed)\n     *   else        rel8ns.bin[0]\n     * Only refs already listed in rel8ns.bin are servable.\n     */\n    const selectBinRef = (frame, ctrl, remainder) => {\n        const bins = Array.isArray(frame?.rel8ns?.bin) ? frame.rel8ns.bin.map(String) : [];\n        if (!bins.length) return { ref: \"\", status: 404, error: \"bin control requires rel8ns.bin\" };\n        const shaOf = (s) => String(s || \"\").replace(/^bin\\s+/i, \"\").trim().toLowerCase();\n        const pick = (v) => {\n            if (v == null || v === \"\") return \"\";\n            if (typeof v === \"number\" || /^\\d+$/.test(String(v).trim())) {\n                return bins[Number(v)] || \"\";\n            }\n            const want = shaOf(v);\n            return bins.find((b) => shaOf(b) === want) || \"\";\n        };\n        const seg = String(remainder || \"\").replace(/^\\/+/, \"\").split(\"/\")[0] || \"\";\n        let key = seg;\n        try {\n            key = decodeURIComponent(seg);\n        } catch {\n            /* keep */\n        }\n        let chosen;\n        if (ctrl?.select && typeof ctrl.select === \"object\") {\n            if (key && Object.prototype.hasOwnProperty.call(ctrl.select, key)) {\n                chosen = ctrl.select[key];\n            } else if (ctrl.default != null) {\n                chosen = ctrl.default;\n            } else {\n                return {\n                    ref: \"\",\n                    status: 404,\n                    error: key ? `no bin case '${key}'` : \"bin case required\",\n                };\n            }\n        } else if (ctrl?.bin != null) {\n            chosen = ctrl.bin;\n        } else {\n            return { ref: bins[0], sha: shaOf(bins[0]) };\n        }\n        const ref = pick(chosen);\n        if (!ref) {\n            return {\n                ref: \"\",\n                status: 404,\n                error: `bin selection '${chosen}' is not in rel8ns.bin`,\n            };\n        }\n        return { ref, sha: shaOf(ref), key };\n    };\n\n    const resolveRefToAddr = (store, ref) => {\n        const s = String(ref || \"\").trim();\n        if (!s) return \"\";\n        if (s.includes(\"^\")) {\n            return store.getFrame(s) ? s : \"\";\n        }\n        const tip = store.getTip(s);\n        if (!tip || tip.tombstone) return \"\";\n        return tip.addr || \"\";\n    };\n\n    const loadPolicyBundle = (store, policyAddr) => {\n        const addr = resolveRefToAddr(store, policyAddr) || String(policyAddr || \"\");\n        const frame = store.getFrame(addr);\n        if (!frame) {\n            return {\n                policyAddr: addr,\n                policy: null,\n                schemaRef: \"\",\n                schemaAddr: \"\",\n                luaSource: \"\",\n            };\n        }\n        const policy = readPayloadJson(store, addr) || frame.data || {};\n        const schRel = frame.rel8ns?.schema;\n        let schemaRef =\n            (Array.isArray(schRel) && schRel.length\n                ? String(schRel[schRel.length - 1])\n                : \"\") ||\n            (typeof policy.schema === \"string\" ? policy.schema : \"\") ||\n            (typeof frame.data?.schema_ib === \"string\" ? frame.data.schema_ib : \"\") ||\n            (typeof frame.data?.schema === \"string\" ? frame.data.schema : \"\");\n        if (!schemaRef) {\n            return {\n                policyAddr: addr,\n                policy,\n                schemaRef: \"\",\n                schemaAddr: \"\",\n                luaSource: \"\",\n            };\n        }\n        const schemaAddr = resolveRefToAddr(store, schemaRef);\n        const luaSource = schemaAddr ? readPayloadText(store, schemaAddr) : \"\";\n        return { policyAddr: addr, policy, schemaRef, schemaAddr, luaSource };\n    };\n\n    /** True when tip has a write policy linked (gated), regardless of schema/keys. */\n    const isWriteGated = (frame) => !!policyAddrOf(frame);\n\n    // ─── Fengari Lua schema VM ───────────────────────────────────────────────\n\n    let _fengari = null;\n    let _fengariTried = false;\n    let _fengariPath = \"\";\n\n    /** Same root as navi_shell Node storage: %APPDATA%\\.navi_shell on Windows. */\n    const naviShellDir = () => {\n        const path = nodeRequire(\"path\");\n        const os = nodeRequire(\"os\");\n        if (process.platform === \"win32\") {\n            const roaming =\n                process.env.APPDATA ||\n                path.join(os.homedir(), \"AppData\", \"Roaming\");\n            return path.join(roaming, \".navi_shell\");\n        }\n        return path.join(os.homedir(), \".navi_shell\");\n    };\n\n    const fengariAppDataPath = () => {\n        const path = nodeRequire(\"path\");\n        return path.join(naviShellDir(), \"hostparkinator_5000\", \"vendor\", \"fengari\");\n    };\n\n    const fengariCandidates = () => {\n        const path = nodeRequire(\"path\");\n        const fs = nodeRequire(\"fs\");\n        const exe = process.execPath || process.argv?.[0] || \".\";\n        const exeDir = path.dirname(exe);\n        const envPath = String(process.env.FOOBARCH_FENGARI || \"\").trim();\n        const out = [];\n        const add = (p) => {\n            if (p && !out.includes(p)) out.push(p);\n        };\n        if (envPath) add(envPath);\n        add(fengariAppDataPath());\n        add(path.join(naviShellDir(), \"foobarch_host\", \"vendor\", \"fengari\"));\n        // Reuse fusion's vendored copy if already installed.\n        add(path.join(naviShellDir(), \"spacebarz_fusion\", \"vendor\", \"fengari\"));\n        add(path.join(exeDir, \"vendor\", \"fengari\"));\n        add(path.join(exeDir, \"B_native_mods\", \"vendor\", \"fengari\"));\n        add(path.join(process.cwd(), \"B_native_mods\", \"vendor\", \"fengari\"));\n        add(path.join(process.cwd(), \"vendor\", \"fengari\"));\n        // Walk up from cwd / exeDir looking for the repo mirror.\n        for (const start of [process.cwd(), exeDir]) {\n            let dir = start;\n            for (let i = 0; i < 8; i++) {\n                add(path.join(dir, \"B_native_mods\", \"vendor\", \"fengari\"));\n                add(path.join(dir, \"vendor\", \"fengari\"));\n                const parent = path.dirname(dir);\n                if (parent === dir) break;\n                dir = parent;\n            }\n        }\n        return out.filter((dest) => {\n            try {\n                return fs.existsSync(path.join(dest, \"src\", \"fengari.js\"));\n            } catch {\n                return false;\n            }\n        });\n    };\n\n    const tryLoadFengariAt = (dest) => {\n        const path = nodeRequire(\"path\");\n        const Module = nodeRequire(\"module\");\n        const entry = path.join(dest, \"src\", \"fengari.js\");\n        const req = Module.createRequire(path.join(dest, \"package.json\"));\n        return req(entry);\n    };\n\n    /**\n     * Ensure fengari is loadable — prefer AppData copy (works after remount_host\n     * when cwd is not the repo). Seeds from repo mirror / FOOBARCH_FENGARI when needed.\n     */\n    const ensureFengariVendor = () => {\n        const fs = nodeRequire(\"fs\");\n        const path = nodeRequire(\"path\");\n        const dest = fengariAppDataPath();\n        const entry = path.join(dest, \"src\", \"fengari.js\");\n        const hasMods = fs.existsSync(path.join(dest, \"node_modules\"));\n        if (fs.existsSync(entry) && hasMods) {\n            return { ok: true, path: dest, installed: false };\n        }\n\n        // Prefer an already-complete candidate (repo or fusion appdata).\n        let src = null;\n        for (const c of fengariCandidates()) {\n            if (\n                c !== dest &&\n                fs.existsSync(path.join(c, \"src\", \"fengari.js\")) &&\n                fs.existsSync(path.join(c, \"node_modules\"))\n            ) {\n                src = c;\n                break;\n            }\n        }\n        if (!src) {\n            for (const c of fengariCandidates()) {\n                if (c !== dest && fs.existsSync(path.join(c, \"src\", \"fengari.js\"))) {\n                    src = c;\n                    break;\n                }\n            }\n        }\n        if (!src) {\n            return {\n                ok: false,\n                path: dest,\n                error:\n                    \"fengari not found — set FOOBARCH_FENGARI, copy B_native_mods/vendor/fengari into AppData, or run hostparkinator_5000 from the hypercloud repo once\",\n            };\n        }\n        fs.mkdirSync(path.dirname(dest), { recursive: true });\n        fs.cpSync(src, dest, { recursive: true });\n        if (!fs.existsSync(path.join(dest, \"node_modules\"))) {\n            const { spawnSync } = nodeRequire(\"child_process\");\n            const r = spawnSync(\n                process.platform === \"win32\" ? \"npm.cmd\" : \"npm\",\n                [\"install\", \"--omit=dev\", \"--no-package-lock\"],\n                { cwd: dest, encoding: \"utf8\" }\n            );\n            if (r.status !== 0) {\n                return {\n                    ok: false,\n                    path: dest,\n                    error: `npm install in ${dest} failed: ${(r.stderr || r.stdout || \"\").slice(0, 300)}`,\n                };\n            }\n        }\n        return { ok: true, path: dest, installed: true, from: src };\n    };\n\n    const loadFengari = () => {\n        if (_fengari) return _fengari;\n        if (_fengariTried) return null;\n        _fengariTried = true;\n\n        const tryList = () => {\n            const list = fengariCandidates();\n            // Always try AppData dest last after ensure.\n            const dest = fengariAppDataPath();\n            if (!list.includes(dest)) list.push(dest);\n            for (const candidate of list) {\n                try {\n                    _fengari = tryLoadFengariAt(candidate);\n                    _fengariPath = candidate;\n                    log(\"fengari\", candidate);\n                    return _fengari;\n                } catch (err) {\n                    warn(\"fengari load failed\", candidate, err?.message || err);\n                }\n            }\n            return null;\n        };\n\n        if (tryList()) return _fengari;\n\n        // Seed AppData from repo / fusion copy, then retry once.\n        const ensured = ensureFengariVendor();\n        if (!ensured.ok) {\n            warn(\n                \"fengari not found — schema Lua gates unavailable:\",\n                ensured.error ||\n                    \"copy B_native_mods/vendor/fengari beside navi_shell or run hostparkinator_5000 vendor\"\n            );\n            return null;\n        }\n        if (ensured.installed) log(\"fengari vendor installed\", ensured.path, \"from\", ensured.from);\n        try {\n            _fengari = tryLoadFengariAt(ensured.path);\n            _fengariPath = ensured.path;\n            log(\"fengari\", ensured.path);\n            return _fengari;\n        } catch (err) {\n            warn(\"fengari load failed after vendor\", ensured.path, err?.message || err);\n            return null;\n        }\n    };\n\n    /** Force re-resolve (e.g. after hostparkinator_5000 vendor). */\n    const resetFengari = () => {\n        _fengari = null;\n        _fengariTried = false;\n        _fengariPath = \"\";\n    };\n\n    const goToLua = (fengari, L, v) => {\n        const { lua, to_luastring } = fengari;\n        if (v === null || v === undefined) {\n            lua.lua_pushnil(L);\n            return;\n        }\n        if (typeof v === \"boolean\") {\n            lua.lua_pushboolean(L, v);\n            return;\n        }\n        if (typeof v === \"number\") {\n            lua.lua_pushnumber(L, v);\n            return;\n        }\n        if (typeof v === \"string\") {\n            lua.lua_pushstring(L, to_luastring(v));\n            return;\n        }\n        if (Array.isArray(v)) {\n            lua.lua_createtable(L, v.length, 0);\n            for (let i = 0; i < v.length; i++) {\n                goToLua(fengari, L, v[i]);\n                lua.lua_rawseti(L, -2, i + 1);\n            }\n            return;\n        }\n        if (typeof v === \"object\") {\n            const keys = Object.keys(v);\n            lua.lua_createtable(L, 0, keys.length);\n            for (const k of keys) {\n                goToLua(fengari, L, v[k]);\n                lua.lua_setfield(L, -2, to_luastring(String(k)));\n            }\n            return;\n        }\n        lua.lua_pushnil(L);\n    };\n\n    const luaToGo = (fengari, L, idx) => {\n        const { lua, to_jsstring } = fengari;\n        const t = lua.lua_type(L, idx);\n        if (t === lua.LUA_TNIL) return null;\n        if (t === lua.LUA_TBOOLEAN) return !!lua.lua_toboolean(L, idx);\n        if (t === lua.LUA_TNUMBER) return lua.lua_tonumber(L, idx);\n        if (t === lua.LUA_TSTRING) return to_jsstring(lua.lua_tostring(L, idx));\n        if (t === lua.LUA_TTABLE) {\n            const abs = lua.lua_absindex(L, idx);\n            const len = lua.lua_rawlen(L, abs);\n            if (len > 0) {\n                const arr = [];\n                let sequential = true;\n                for (let i = 1; i <= len; i++) {\n                    lua.lua_rawgeti(L, abs, i);\n                    if (lua.lua_type(L, -1) === lua.LUA_TNIL) {\n                        lua.lua_pop(L, 1);\n                        sequential = false;\n                        break;\n                    }\n                    arr.push(luaToGo(fengari, L, -1));\n                    lua.lua_pop(L, 1);\n                }\n                if (sequential && arr.length === len) return arr;\n            }\n            const obj = {};\n            lua.lua_pushnil(L);\n            while (lua.lua_next(L, abs) !== 0) {\n                const kt = lua.lua_type(L, -2);\n                let k;\n                if (kt === lua.LUA_TSTRING) k = to_jsstring(lua.lua_tostring(L, -2));\n                else if (kt === lua.LUA_TNUMBER) k = String(lua.lua_tonumber(L, -2));\n                else {\n                    lua.lua_pop(L, 1);\n                    continue;\n                }\n                obj[k] = luaToGo(fengari, L, -1);\n                lua.lua_pop(L, 1);\n            }\n            return obj;\n        }\n        return null;\n    };\n\n    const pushHostApi = (fengari, L, store, bodyBuf, extras = {}) => {\n        const { lua, lauxlib, to_luastring, to_jsstring } = fengari;\n        let spent = 0;\n        const spend = () => {\n            spent += 1;\n            if (spent > SCHEMA_FETCH_BUDGET) {\n                throw new Error(`schema fetch budget exceeded (${SCHEMA_FETCH_BUDGET})`);\n            }\n        };\n        const clean = (v) => String(v || \"\").trim();\n        const checkDeadline = () => {\n            if (extras.deadline && Date.now() > extras.deadline) {\n                throw new Error(\"lua deadline exceeded\");\n            }\n        };\n\n        const pushFn = (name, arity, impl) => {\n            lua.lua_pushjsfunction(L, (LL) => {\n                try {\n                    checkDeadline();\n                    const args = [];\n                    for (let i = 1; i <= arity; i++) {\n                        const t = lua.lua_type(LL, i);\n                        if (t === lua.LUA_TNIL || t === lua.LUA_TNONE) args.push(undefined);\n                        else if (t === lua.LUA_TBOOLEAN) args.push(!!lua.lua_toboolean(LL, i));\n                        else if (t === lua.LUA_TNUMBER) args.push(lua.lua_tonumber(LL, i));\n                        else if (t === lua.LUA_TSTRING)\n                            args.push(to_jsstring(lua.lua_tostring(LL, i)));\n                        else args.push(undefined);\n                    }\n                    const out = impl(...args);\n                    if (typeof out === \"boolean\") {\n                        lua.lua_pushboolean(LL, out);\n                        return 1;\n                    }\n                    if (typeof out === \"number\") {\n                        lua.lua_pushnumber(LL, out);\n                        return 1;\n                    }\n                    if (typeof out === \"string\") {\n                        lua.lua_pushstring(LL, to_luastring(out));\n                        return 1;\n                    }\n                    if (out == null) {\n                        lua.lua_pushnil(LL);\n                        return 1;\n                    }\n                    goToLua(fengari, LL, out);\n                    return 1;\n                } catch (err) {\n                    return lauxlib.luaL_error(\n                        LL,\n                        to_luastring(String(err?.message || err))\n                    );\n                }\n            });\n            lua.lua_setfield(L, -2, to_luastring(name));\n        };\n\n        const api = {\n            api: 2,\n            write_sign_prefix: WRITE_SIGN_PREFIX,\n            read_sign_prefix: READ_SIGN_PREFIX,\n        };\n\n        lua.lua_createtable(L, 0, 24);\n        for (const [k, v] of Object.entries(api)) {\n            goToLua(fengari, L, v);\n            lua.lua_setfield(L, -2, to_luastring(k));\n        }\n        pushFn(\"now\", 0, () => Math.floor(Date.now() / 1000));\n        pushFn(\"now_ms\", 0, () => Date.now());\n        pushFn(\"sha256_hex\", 1, (value) =>\n            sha256Hex(Buffer.from(value == null ? \"\" : String(value), \"utf8\"))\n        );\n        pushFn(\"write_message\", 4, (ib, parentAddr, bodyShaHex, contentType) =>\n            [\n                WRITE_SIGN_PREFIX,\n                ib || \"\",\n                parentAddr || \"\",\n                bodyShaHex || \"\",\n                contentType || \"application/octet-stream\",\n            ].join(\"\\n\")\n        );\n        pushFn(\"read_message\", 2, (ib, timestamp) =>\n            readMessage({ ib, timestamp })\n        );\n        pushFn(\"verify_ed25519\", 3, (pub, message, sig) =>\n            verifyEd25519(String(pub || \"\"), String(message || \"\"), String(sig || \"\"))\n        );\n        pushFn(\"body\", 0, () => {\n            spend();\n            if (bodyBuf == null) return \"\";\n            return Buffer.isBuffer(bodyBuf)\n                ? bodyBuf.toString(\"utf8\")\n                : String(bodyBuf);\n        });\n        pushFn(\"latest_addr\", 1, (ib) => {\n            spend();\n            const tip = store.getTip(clean(ib));\n            return tip && !tip.tombstone ? tip.addr : undefined;\n        });\n        pushFn(\"fetch_latest\", 1, (ib) => {\n            spend();\n            const tip = store.getTip(clean(ib));\n            if (!tip || tip.tombstone) return undefined;\n            return readPayloadText(store, tip.addr) || undefined;\n        });\n        pushFn(\"fetch_addr\", 1, (addr) => {\n            spend();\n            const t = readPayloadText(store, clean(addr));\n            return t || undefined;\n        });\n        pushFn(\"fetch_frame\", 1, (addr) => {\n            spend();\n            const frame = store.getFrame(clean(addr));\n            return frame ? JSON.stringify(frame) : undefined;\n        });\n        pushFn(\"get_bin\", 1, (shaOrBin) => {\n            spend();\n            const sha = String(shaOrBin || \"\")\n                .replace(/^bin\\s+/i, \"\")\n                .trim();\n            if (!sha) return undefined;\n            const blob = store.getBin(sha);\n            if (!blob) return undefined;\n            return {\n                sha256: sha,\n                content_type: blob.content_type,\n                body_b64: blob.bytes.toString(\"base64\"),\n                byte_length: blob.bytes.length,\n            };\n        });\n        pushFn(\"park_request\", 3, (path, method, body) => {\n            spend();\n            checkDeadline();\n            if (typeof extras.parkRequest !== \"function\") {\n                throw new Error(\"park_request not available in this context\");\n            }\n            return extras.parkRequest(\n                clean(path),\n                method ? String(method).toUpperCase() : \"GET\",\n                body == null || body === undefined ? null : String(body)\n            );\n        });\n        // leave table on stack\n    };\n\n    const runSchemaAuthorize = (store, luaSource, ctx, bodyBuf, opts = {}) => {\n        const fengari = loadFengari();\n        if (!fengari) {\n            return {\n                allow: false,\n                aside_ok: false,\n                error: \"schema Lua engine unavailable (fengari missing)\",\n            };\n        }\n        const fnName = opts.fn || \"authorize\";\n        const timeoutMs =\n            Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : SCHEMA_TIMEOUT_MS;\n        const { lua, lauxlib, lualib, to_luastring, to_jsstring } = fengari;\n        const L = lauxlib.luaL_newstate();\n        const started = Date.now();\n        try {\n            lualib.luaL_openlibs(L);\n\n            pushHostApi(fengari, L, store, bodyBuf, {\n                deadline: started + timeoutMs,\n                parkRequest: opts.parkRequest,\n            });\n            lua.lua_pushvalue(L, -1);\n            lua.lua_setglobal(L, to_luastring(\"flowerpot\"));\n            lua.lua_setglobal(L, to_luastring(\"foobarch\"));\n\n            goToLua(fengari, L, ctx);\n            lua.lua_setglobal(L, to_luastring(\"ctx\"));\n\n            if (lauxlib.luaL_dostring(L, to_luastring(JSON_DECODE_LUA)) !== lua.LUA_OK) {\n                const err = to_jsstring(lua.lua_tostring(L, -1));\n                return {\n                    allow: false,\n                    aside_ok: false,\n                    error: `json_decode prelude: ${err}`,\n                };\n            }\n\n            const chunk =\n                `${String(luaSource)}\\n` +\n                `if type(${fnName}) ~= \"function\" then return { __fb_missing_fn = true } end\\n` +\n                `return ${fnName}()`;\n            if (lauxlib.luaL_dostring(L, to_luastring(chunk)) !== lua.LUA_OK) {\n                const err = to_jsstring(lua.lua_tostring(L, -1));\n                return {\n                    allow: false,\n                    aside_ok: false,\n                    error: `schema error: ${err}`,\n                };\n            }\n            if (Date.now() - started > timeoutMs) {\n                return {\n                    allow: false,\n                    aside_ok: false,\n                    error: `schema timeout (${timeoutMs}ms)`,\n                };\n            }\n            const raw = luaToGo(fengari, L, -1);\n            if (raw && typeof raw === \"object\" && raw.__fb_missing_fn) {\n                return {\n                    allow: false,\n                    aside_ok: false,\n                    error: `schema missing ${fnName}()`,\n                };\n            }\n            if (raw == null) {\n                return { allow: false, aside_ok: false, error: `${fnName} returned nil` };\n            }\n            if (typeof raw === \"boolean\") {\n                return { allow: raw, aside_ok: !raw, via: \"lua\" };\n            }\n            if (typeof raw !== \"object\") {\n                return {\n                    allow: false,\n                    aside_ok: false,\n                    error: `${fnName} must return table`,\n                };\n            }\n            return {\n                ...raw,\n                allow: Boolean(raw.allow),\n                aside_ok:\n                    raw.aside_ok === undefined ? !raw.allow : Boolean(raw.aside_ok),\n                error: raw.error != null ? String(raw.error) : undefined,\n                via: \"lua\",\n            };\n        } catch (err) {\n            return {\n                allow: false,\n                aside_ok: false,\n                error: `schema error: ${err?.message || err}`,\n            };\n        } finally {\n            lua.lua_close(L);\n        }\n    };\n\n    /**\n     * Run park http.kind=lua script. Expects global handle() (or process()) returning\n     * { status?, content_type?, body?, body_b64?, bin?, headers? }.\n     */\n    const runLuaHandle = (store, luaSource, req, extras = {}) => {\n        const fengari = loadFengari();\n        if (!fengari) {\n            return {\n                ok: false,\n                status: 503,\n                error: \"lua engine unavailable (fengari missing)\",\n            };\n        }\n        const timeoutMs =\n            Number(extras.timeoutMs) > 0 ? Number(extras.timeoutMs) : LUA_TIMEOUT_MS;\n        const { lua, lauxlib, lualib, to_luastring, to_jsstring } = fengari;\n        const L = lauxlib.luaL_newstate();\n        const started = Date.now();\n        const bodyBuf = extras.bodyBuf || Buffer.alloc(0);\n        try {\n            lualib.luaL_openlibs(L);\n            pushHostApi(fengari, L, store, bodyBuf, {\n                deadline: started + timeoutMs,\n                parkRequest: extras.parkRequest,\n            });\n            lua.lua_pushvalue(L, -1);\n            lua.lua_setglobal(L, to_luastring(\"flowerpot\"));\n            lua.lua_setglobal(L, to_luastring(\"foobarch\"));\n\n            goToLua(fengari, L, req);\n            lua.lua_setglobal(L, to_luastring(\"req\"));\n            lua.lua_pushvalue(L, -1);\n            lua.lua_setglobal(L, to_luastring(\"ctx\"));\n\n            if (lauxlib.luaL_dostring(L, to_luastring(JSON_DECODE_LUA)) !== lua.LUA_OK) {\n                const err = to_jsstring(lua.lua_tostring(L, -1));\n                return { ok: false, status: 500, error: `json_decode prelude: ${err}` };\n            }\n\n            const chunk =\n                `${String(luaSource)}\\n` +\n                `local __fn = handle or process\\n` +\n                `if type(__fn) ~= \"function\" then return { __fb_missing_fn = true } end\\n` +\n                `return __fn(req)`;\n            if (lauxlib.luaL_dostring(L, to_luastring(chunk)) !== lua.LUA_OK) {\n                const err = to_jsstring(lua.lua_tostring(L, -1));\n                return { ok: false, status: 500, error: `lua error: ${err}` };\n            }\n            if (Date.now() - started > timeoutMs) {\n                return {\n                    ok: false,\n                    status: 504,\n                    error: `lua timeout (${timeoutMs}ms)`,\n                };\n            }\n            const raw = luaToGo(fengari, L, -1);\n            if (raw && typeof raw === \"object\" && raw.__fb_missing_fn) {\n                return {\n                    ok: false,\n                    status: 500,\n                    error: \"script missing handle() or process()\",\n                };\n            }\n            if (raw == null || typeof raw !== \"object\") {\n                return {\n                    ok: false,\n                    status: 500,\n                    error: \"handle() must return a table\",\n                };\n            }\n            return { ok: true, result: raw };\n        } catch (err) {\n            return {\n                ok: false,\n                status: 500,\n                error: `lua error: ${err?.message || err}`,\n            };\n        } finally {\n            lua.lua_close(L);\n        }\n    };\n\n    const authorizeWrite = (\n        store,\n        tipFrame,\n        { ib, parentAddr, body, headers, parkRequest, policyAddr, fn, transform } = {}\n    ) => {\n        const pAddr = policyAddr || policyAddrOf(tipFrame);\n        if (!pAddr) return { allow: true, reason: \"open tip\" };\n\n        const bundle = loadPolicyBundle(store, pAddr);\n        if (!bundle.policy) {\n            return {\n                allow: false,\n                error: `policy frame missing: ${pAddr}`,\n                policyAddr: pAddr,\n            };\n        }\n\n        const signKeys = parseHeaderList(\n            headers[\"x-flowerpot-sign-keys\"] || headers[\"x-foobarch-sign-keys\"]\n        );\n        const signatures = parseHeaderList(\n            headers[\"x-flowerpot-signatures\"] || headers[\"x-foobarch-signatures\"]\n        );\n        const bodyBuf = Buffer.isBuffer(body) ? body : Buffer.from(body ?? []);\n        const message = writeMessage({\n            ib,\n            parentAddr,\n            body: bodyBuf,\n            contentType: \"application/json\",\n        });\n\n        if (!bundle.schemaRef) {\n            return {\n                allow: false,\n                aside_ok: false,\n                error:\n                    \"policy has no schema (rel8ns.schema or data.schema_ib) — host no longer embeds keys gates\",\n                policyAddr: bundle.policyAddr,\n            };\n        }\n        if (!bundle.luaSource) {\n            return {\n                allow: false,\n                aside_ok: false,\n                error: bundle.schemaAddr\n                    ? \"schema tip has no Lua payload\"\n                    : `schema tip not found: ${bundle.schemaRef}`,\n                policyAddr: bundle.policyAddr,\n                schemaRef: bundle.schemaRef,\n                schemaAddr: bundle.schemaAddr,\n            };\n        }\n        const result = runSchemaAuthorize(\n            store,\n            bundle.luaSource,\n            {\n                ib,\n                parent_addr: parentAddr || \"\",\n                body_sha256: sha256Hex(bodyBuf),\n                body_size: bodyBuf.length,\n                content_type: \"application/json\",\n                message,\n                sign_keys: signKeys,\n                signatures,\n                policy: bundle.policy,\n                policy_addr: bundle.policyAddr,\n                schema_addr: bundle.schemaAddr,\n                schema_ref: bundle.schemaRef,\n                operation: \"put\",\n                transform: transform || (parentAddr ? \"mut8\" : \"firstGen\"),\n            },\n            bodyBuf,\n            { parkRequest, timeoutMs: SCHEMA_TIMEOUT_MS, fn }\n        );\n        return {\n            ...result,\n            policyAddr: bundle.policyAddr,\n            schemaAddr: bundle.schemaAddr,\n        };\n    };\n\n    /** HEAD authorizes as GET; method names are reduced to [a-z0-9_]. */\n    const accessMethodKey = (method) => {\n        const m = String(method || \"GET\").trim().toUpperCase();\n        return (m === \"HEAD\" ? \"GET\" : m).toLowerCase().replace(/[^a-z0-9_]/g, \"_\");\n    };\n\n    /**\n     * Policy for a non-commit method: rel8ns.<method>_policy (e.g. post_policy)\n     * overrides rel8ns.read_policy, which gates every method by default.\n     */\n    const accessPolicyAddrOf = (frame, method) => {\n        const last = (pol) =>\n            Array.isArray(pol) && pol.length ? String(pol[pol.length - 1]) : \"\";\n        const key = accessMethodKey(method);\n        return last(frame?.rel8ns?.[`${key}_policy`]) || last(frame?.rel8ns?.read_policy);\n    };\n\n    /**\n     * GET/HEAD keep the proposal-read-v1 message (ib, timestamp) so existing\n     * signed GET clients still verify. Other methods also sign METHOD and the\n     * body sha so a GET signature cannot be replayed as a POST.\n     */\n    const accessMessage = ({ ib, timestamp = \"\", method, bodySha256 = \"\" }) => {\n        const key = accessMethodKey(method);\n        if (key === \"get\") return readMessage({ ib, timestamp });\n        return [\n            READ_SIGN_PREFIX,\n            ib || \"\",\n            timestamp == null ? \"\" : String(timestamp),\n            key.toUpperCase(),\n            bodySha256,\n        ].join(\"\\n\");\n    };\n\n    /**\n     * Non-commit access gate for every method (GET/HEAD/POST/QUERY/…).\n     * Schema fn chain: authorize_<method>() → authorize_read() → authorize().\n     * Commit/tombstone writes use authorizeWrite on rel8ns.policy instead.\n     */\n    const authorizeAccess = (\n        store,\n        tipFrame,\n        { ib, method = \"GET\", headers = {}, body, timestamp, parkRequest } = {}\n    ) => {\n        const key = accessMethodKey(method);\n        const pAddr = accessPolicyAddrOf(tipFrame, method);\n        if (!pAddr) return { allow: true, reason: \"open access\" };\n\n        const bundle = loadPolicyBundle(store, pAddr);\n        if (!bundle.policy || !bundle.luaSource) {\n            return {\n                allow: false,\n                aside_ok: false,\n                error: bundle.policy\n                    ? `${key} policy schema missing Lua`\n                    : `${key} policy missing: ${pAddr}`,\n                policyAddr: pAddr,\n            };\n        }\n        const signKeys = parseHeaderList(\n            headers[\"x-flowerpot-sign-keys\"] || headers[\"x-foobarch-sign-keys\"]\n        );\n        const signatures = parseHeaderList(\n            headers[\"x-flowerpot-signatures\"] || headers[\"x-foobarch-signatures\"]\n        );\n        const ts =\n            timestamp != null && timestamp !== \"\"\n                ? String(timestamp)\n                : headers[\"x-foobarch-read-timestamp\"] ||\n                  headers[\"x-flowerpot-read-timestamp\"] ||\n                  \"\";\n        const bodyBuf =\n            key === \"get\"\n                ? Buffer.alloc(0)\n                : Buffer.isBuffer(body)\n                  ? body\n                  : Buffer.from(body ?? []);\n        const bodySha256 = sha256Hex(bodyBuf);\n        const ctx = {\n            ib,\n            method: key.toUpperCase(),\n            timestamp: ts,\n            message: accessMessage({ ib, timestamp: ts, method, bodySha256 }),\n            body_sha256: bodySha256,\n            body_size: bodyBuf.length,\n            sign_keys: signKeys,\n            signatures,\n            policy: bundle.policy,\n            policy_addr: bundle.policyAddr,\n            schema_addr: bundle.schemaAddr,\n            schema_ref: bundle.schemaRef,\n            operation: key === \"get\" ? \"read\" : key,\n        };\n        const authOpts = { parkRequest, timeoutMs: SCHEMA_TIMEOUT_MS };\n        const chain = [`authorize_${key}`, \"authorize_read\", \"authorize\"].filter(\n            (fn, i, arr) => arr.indexOf(fn) === i\n        );\n        let result = null;\n        for (const fn of chain) {\n            result = runSchemaAuthorize(store, bundle.luaSource, ctx, bodyBuf, {\n                ...authOpts,\n                fn,\n            });\n            if (!(result.error && String(result.error).includes(`schema missing ${fn}()`))) {\n                break;\n            }\n        }\n        return {\n            ...result,\n            policyAddr: bundle.policyAddr,\n            schemaAddr: bundle.schemaAddr,\n        };\n    };\n\n    /** Resolve http.kind=lua script tip → source text. */\n    const resolveLuaScriptSource = (store, ctrl, tipAddr) => {\n        const ref = String(ctrl?.script || ctrl?.target || ctrl?.ib || \"\").trim();\n        if (ref) {\n            let addr = resolveRefToAddr(store, ref);\n            if (!addr && !ref.includes(\"^\")) {\n                const tip = store.getTip(ref.replace(/^\\/+/, \"\"));\n                if (tip && !tip.tombstone) addr = tip.addr;\n            }\n            if (addr) {\n                const source = readPayloadText(store, addr);\n                if (source) return { source, scriptAddr: addr };\n                return { source: \"\", scriptAddr: addr, error: \"script tip has no Lua payload\" };\n            }\n            return { source: \"\", scriptAddr: \"\", error: `script tip not found: ${ref}` };\n        }\n        if (tipAddr) {\n            const source = readPayloadText(store, tipAddr);\n            if (source) return { source, scriptAddr: tipAddr };\n        }\n        return {\n            source: \"\",\n            scriptAddr: \"\",\n            error: \"lua control missing script (or tip Lua bin)\",\n        };\n    };\n\n    /** Map handle()/process() table → HTTP result. */\n    const mapLuaHttpResult = (store, raw, method) => {\n        const status = Number(raw.status);\n        const outStatus = Number.isFinite(status) && status > 0 ? status : 200;\n        /** @type {Record<string, string>} */\n        const headers = { \"X-Foobarch-Lua\": \"1\" };\n        if (raw.headers && typeof raw.headers === \"object\") {\n            for (const [k, v] of Object.entries(raw.headers)) {\n                if (v == null) continue;\n                headers[String(k)] = String(v);\n            }\n        }\n        let type =\n            raw.content_type || raw.type || \"application/octet-stream\";\n        /** @type {Buffer|string} */\n        let body = \"\";\n\n        if (raw.bin != null && raw.bin !== \"\") {\n            const sha = String(raw.bin).replace(/^bin\\s+/i, \"\").trim();\n            const blob = store.getBin(sha);\n            if (!blob) {\n                return {\n                    status: 404,\n                    body: \"bin missing\\n\",\n                    type: \"text/plain\",\n                    headers,\n                };\n            }\n            body = blob.bytes;\n            type = raw.content_type || blob.content_type || type;\n        } else if (raw.body_b64 != null && raw.body_b64 !== \"\") {\n            body = Buffer.from(String(raw.body_b64), \"base64\");\n        } else if (raw.body != null) {\n            body = Buffer.from(String(raw.body), \"utf8\");\n        }\n\n        return {\n            status: outStatus,\n            body: method === \"HEAD\" ? \"\" : body,\n            type,\n            headers,\n        };\n    };\n\n    /** @deprecated alias — tombstone / callers that only need policy payload */\n    const loadPolicyData = (store, frame) => {\n        const pAddr = policyAddrOf(frame);\n        if (!pAddr) return null;\n        const bundle = loadPolicyBundle(store, pAddr);\n        return bundle.policy;\n    };\n\n    // ─── Server ─────────────────────────────────────────────────────────────\n\n    class FoobarchHost {\n        constructor() {\n            this.listening = false;\n            this.port = DEFAULT_PORT;\n            this.host = DEFAULT_HOST;\n            this.staticDir = DEFAULT_STATIC;\n            this.dbPath = null;\n            this.store = null;\n            this._server = null;\n            /** uuid → { token, socket, inflight: Map, jobs: Map } — not ibgib; dies with the socket. */\n            this._naviShells = new Map();\n            this._naviShellJobSweeper = null;\n        }\n\n        ensureNaviShellJobSweeper() {\n            if (this._naviShellJobSweeper) return;\n            this._naviShellJobSweeper = setInterval(() => {\n                this.sweepNaviShellJobs();\n            }, 15000);\n            if (typeof this._naviShellJobSweeper.unref === \"function\") {\n                this._naviShellJobSweeper.unref();\n            }\n        }\n\n        sweepNaviShellJobs() {\n            const now = Date.now();\n            for (const row of this._naviShells.values()) {\n                if (!row?.jobs) continue;\n                for (const [id, job] of [...row.jobs.entries()]) {\n                    if (!job) {\n                        row.jobs.delete(id);\n                        continue;\n                    }\n                    if (\n                        job.state === \"done\" &&\n                        job.doneAt &&\n                        now - job.doneAt > NAVI_SHELL_JOB_DONE_TTL_MS\n                    ) {\n                        row.jobs.delete(id);\n                        continue;\n                    }\n                    if (\n                        job.state === \"running\" &&\n                        job.createdAt &&\n                        now - job.createdAt > NAVI_SHELL_JOB_MS\n                    ) {\n                        row.jobs.delete(id);\n                    }\n                }\n            }\n        }\n\n        naviShellJobLoad(row) {\n            let n = row.inflight?.size || 0;\n            if (row.jobs) {\n                for (const job of row.jobs.values()) {\n                    if (job?.state === \"running\") n += 1;\n                }\n            }\n            return n;\n        }\n\n        async loadState() {\n            const pick = async (key) => {\n                const v = await navi.storage.item.get(STORAGE[key]);\n                if (v != null && v !== \"\") return v;\n                return navi.storage.item.get(LEGACY_STORAGE[key]);\n            };\n            try {\n                const p = await pick(\"port\");\n                if (p != null) this.port = Number(p) || DEFAULT_PORT;\n            } catch {\n                /* ignore */\n            }\n            try {\n                const h = await pick(\"host\");\n                if (h) this.host = String(h);\n            } catch {\n                /* ignore */\n            }\n            try {\n                const s = await pick(\"staticDir\");\n                if (s) this.staticDir = String(s);\n            } catch {\n                /* ignore */\n            }\n            try {\n                const d = await pick(\"dbPath\");\n                if (d) this.dbPath = String(d);\n            } catch {\n                /* ignore */\n            }\n            if (!this.dbPath) this.dbPath = defaultDbPath();\n        }\n\n        async persistPort() {\n            await navi.storage.item.set(STORAGE.port, this.port);\n            await navi.storage.item.set(STORAGE.host, this.host);\n        }\n\n        ensureStore() {\n            if (!this.store) {\n                if (!this.dbPath) this.dbPath = defaultDbPath();\n                this.store = openStore(this.dbPath);\n                log(\"sqlite\", this.dbPath);\n            }\n            return this.store;\n        }\n\n        usagePassword() {\n            return this.ensureStore().getMeta(\"usage_password\", DEFAULT_USAGE_PASSWORD);\n        }\n\n        dropNaviShell(uuid, socket) {\n            const id = String(uuid || \"\").trim();\n            const row = this._naviShells.get(id);\n            if (!row) return;\n            if (socket && row.socket !== socket) return;\n            for (const pending of row.inflight.values()) {\n                try {\n                    clearTimeout(pending.timer);\n                    pending.reject(new Error(\"navi_shell disconnected\"));\n                } catch {\n                    /* ignore */\n                }\n            }\n            row.inflight.clear();\n            if (row.jobs) {\n                for (const job of row.jobs.values()) {\n                    job.state = \"error\";\n                    job.error = \"navi_shell disconnected\";\n                    job.doneAt = Date.now();\n                }\n                row.jobs.clear();\n            }\n            try {\n                row.socket.write(wsEncodeClose());\n            } catch {\n                /* ignore */\n            }\n            try {\n                row.socket.destroy();\n            } catch {\n                /* ignore */\n            }\n            this._naviShells.delete(id);\n            log(`navi_shell dropped ${id}`);\n        }\n\n        sendNaviShell(uuid, obj) {\n            const row = this._naviShells.get(String(uuid || \"\").trim());\n            if (!row || !row.socket || row.socket.destroyed) return false;\n            try {\n                row.socket.write(wsEncodeText(JSON.stringify(obj)));\n                return true;\n            } catch {\n                return false;\n            }\n        }\n\n        handleNaviShellUpgrade(req, socket, _head) {\n            const url = new URL(req.url || \"/\", \"http://local\");\n            if (url.pathname !== \"/_foobarch/navi_shell\") {\n                socket.write(\"HTTP/1.1 404 Not Found\\r\\nConnection: close\\r\\n\\r\\n\");\n                socket.destroy();\n                return;\n            }\n            const key = req.headers[\"sec-websocket-key\"];\n            if (!key || String(req.headers.upgrade || \"\").toLowerCase() !== \"websocket\") {\n                socket.write(\"HTTP/1.1 400 Bad Request\\r\\nConnection: close\\r\\n\\r\\n\");\n                socket.destroy();\n                return;\n            }\n            const uuid = String(url.searchParams.get(\"uuid\") || \"\").trim();\n            const token = String(url.searchParams.get(\"token\") || \"\").trim();\n            if (!uuid) {\n                socket.write(\n                    \"HTTP/1.1 401 Unauthorized\\r\\nConnection: close\\r\\n\\r\\nmissing uuid\\n\"\n                );\n                socket.destroy();\n                return;\n            }\n            const accept = wsAccept(key);\n            socket.write(\n                \"HTTP/1.1 101 Switching Protocols\\r\\n\" +\n                    \"Upgrade: websocket\\r\\n\" +\n                    \"Connection: Upgrade\\r\\n\" +\n                    `Sec-WebSocket-Accept: ${accept}\\r\\n` +\n                    \"\\r\\n\"\n            );\n            const row = {\n                uuid,\n                token,\n                socket,\n                authed: false,\n                inflight: new Map(),\n                jobs: new Map(),\n                buf: Buffer.alloc(0),\n                frag: { parts: null, size: 0 },\n            };\n            const helloTimer = setTimeout(() => {\n                if (!row.authed) this.rejectNaviShellHello(row, 401, \"no paid hello within 15s\");\n            }, NAVI_SHELL_HELLO_MS);\n            if (typeof helloTimer.unref === \"function\") helloTimer.unref();\n            const drop = () => {\n                clearTimeout(helloTimer);\n                if (row.authed) this.dropNaviShell(uuid, socket);\n                else {\n                    try {\n                        socket.destroy();\n                    } catch {\n                        /* ignore */\n                    }\n                }\n            };\n            socket.on(\"data\", (chunk) => {\n                row.buf = Buffer.concat([row.buf, chunk]);\n                const decoded = wsDecode(row.buf, row.frag);\n                row.buf = decoded.rest;\n                for (const ping of decoded.pings) {\n                    try {\n                        socket.write(wsEncodePong(ping));\n                    } catch {\n                        /* ignore */\n                    }\n                }\n                for (const msg of decoded.msgs) {\n                    if (row.authed) this.onNaviShellMessage(uuid, msg);\n                    else if (this.acceptNaviShellHello(row, msg)) clearTimeout(helloTimer);\n                    if (socket.destroyed) break;\n                }\n                if (decoded.closed) drop();\n            });\n            socket.on(\"error\", drop);\n            socket.on(\"close\", drop);\n            socket.on(\"end\", drop);\n        }\n\n        rejectNaviShellHello(row, status, error) {\n            log(`navi_shell refused ${row.uuid}: ${error}`);\n            try {\n                row.socket.write(\n                    wsEncodeText(JSON.stringify({ type: \"welcome\", ok: false, status, error }))\n                );\n                row.socket.write(wsEncodeClose());\n            } catch {\n                /* ignore */\n            }\n            try {\n                row.socket.end();\n            } catch {\n                /* ignore */\n            }\n            setTimeout(() => {\n                try {\n                    row.socket.destroy();\n                } catch {\n                    /* ignore */\n                }\n            }, 1000).unref?.();\n        }\n\n        /**\n         * First frame on a relay socket must be `hello` with `owner` (install secret) and\n         * `pay` (one usage token). The uuid is public (advertise frames), so the first\n         * owner secret seen for a uuid is pinned and later connects must present it.\n         * Synchronous so frames that follow in the same chunk see the authed row.\n         * @returns {boolean} true when the socket is now registered\n         */\n        acceptNaviShellHello(row, raw) {\n            let msg;\n            try {\n                msg = JSON.parse(raw);\n            } catch {\n                msg = null;\n            }\n            if (!msg || msg.type !== \"hello\") {\n                this.rejectNaviShellHello(row, 401, \"first relay frame must be hello\");\n                return false;\n            }\n            const owner = String(msg.owner || \"\").trim();\n            const pay = String(msg.pay || \"\").trim();\n            if (owner.length < 32) {\n                this.rejectNaviShellHello(row, 401, \"hello needs owner (install relay secret) — update navi\");\n                return false;\n            }\n            if (!pay) {\n                this.rejectNaviShellHello(row, 402, \"relay connect costs one usage token (hello.pay)\");\n                return false;\n            }\n            const store = this.ensureStore();\n            const ownerKey = `relay_owner:${row.uuid}`;\n            const ownerSha = sha256HexSync(owner);\n            const pinned = store.getMeta(ownerKey);\n            if (pinned && !relaySecretEqual(pinned, ownerSha)) {\n                this.rejectNaviShellHello(row, 403, \"uuid belongs to another navi (owner secret mismatch)\");\n                return false;\n            }\n            const paid = store.consumeToken(pay, `relay-connect:${row.uuid}`);\n            if (!paid.ok) {\n                this.rejectNaviShellHello(row, paid.status || 402, paid.error || \"usage token refused\");\n                return false;\n            }\n            if (!pinned) store.setMeta(ownerKey, ownerSha);\n            const prev = this._naviShells.get(row.uuid);\n            if (prev && prev.socket !== row.socket) {\n                this.dropNaviShell(row.uuid, prev.socket);\n            }\n            row.authed = true;\n            this._naviShells.set(row.uuid, row);\n            this.ensureNaviShellJobSweeper();\n            log(`navi_shell connected ${row.uuid} (paid ${pay.slice(0, 16)})`);\n            this.sendNaviShell(row.uuid, { type: \"welcome\", ok: true, lead: pay.slice(0, 16) });\n            return true;\n        }\n\n        onNaviShellMessage(uuid, raw) {\n            let msg;\n            try {\n                msg = JSON.parse(raw);\n            } catch {\n                return;\n            }\n            if (!msg || typeof msg !== \"object\") return;\n            if (msg.type === \"hello\") return;\n            if (msg.type === \"advertise\" || msg.type === \"retire\") {\n                void this.handleNaviShellRelayOp(uuid, msg);\n                return;\n            }\n            if (msg.type !== \"result\") return;\n            const row = this._naviShells.get(uuid);\n            if (!row) return;\n            const callId = String(msg.id || \"\");\n            const pending = row.inflight.get(callId);\n            if (pending) {\n                clearTimeout(pending.timer);\n                row.inflight.delete(callId);\n                if (row.jobs) row.jobs.delete(callId);\n                pending.resolve(msg);\n                return;\n            }\n            const job = row.jobs?.get(callId);\n            if (!job) return;\n            job.state = msg.ok === false ? \"error\" : \"done\";\n            job.result = msg;\n            job.doneAt = Date.now();\n        }\n\n        /**\n         * Peek / claim a callin job. Claiming a done job returns the result body\n         * and deletes the record (no mailbox balloon).\n         */\n        naviShellJobResponse(uuid, token, jobId) {\n            const id = String(uuid || \"\").trim();\n            const jid = String(jobId || \"\").trim();\n            const row = this._naviShells.get(id);\n            if (!row) {\n                return this.relayErrorResponse(404, \"navi_shell unknown or offline\", {\n                    via: \"hostparkinator_5000\",\n                    job_id: jid || null,\n                });\n            }\n            const job = row.jobs?.get(jid);\n            if (job?.aliasSha) {\n                if (!this.relayAliasTokenOk(job.aliasSha, token)) {\n                    return this.relayErrorResponse(401, \"bad relay alias token\", {\n                        via: \"hostparkinator_5000\",\n                        job_id: jid || null,\n                    });\n                }\n            } else if (row.token && token !== row.token) {\n                return this.relayErrorResponse(401, \"bad navi_shell usage token\", {\n                    via: \"hostparkinator_5000\",\n                    job_id: jid || null,\n                });\n            }\n            if (!job) {\n                return this.relayErrorResponse(404, \"unknown or expired job\", {\n                    via: \"hostparkinator_5000\",\n                    job_id: jid || null,\n                });\n            }\n            if (job.state === \"running\") {\n                return {\n                    status: 200,\n                    body: JSON.stringify({\n                        job_id: jid,\n                        state: \"running\",\n                        remainder: job.remainder || \"\",\n                        created_at: job.createdAt || null,\n                    }),\n                    type: \"application/json; charset=utf-8\",\n                };\n            }\n            // done / error — deliver once then dump\n            const result = job.result;\n            row.jobs.delete(jid);\n            return formatNaviShellResult(result, {\n                via: \"hostparkinator_5000\",\n                job_id: jid,\n            });\n        }\n\n        /** Per-alias callin token: advertise frames carry sha256(token) only. */\n        relayAliasTokenSha(frame) {\n            const s = String(frame?.data?.relay_token_sha256 || \"\").trim().toLowerCase();\n            return /^[0-9a-f]{64}$/.test(s) ? s : \"\";\n        }\n\n        relayAliasTokenOk(sha, token) {\n            if (!token) return false;\n            const got = Buffer.from(sha256Hex(Buffer.from(String(token), \"utf8\")), \"utf8\");\n            const want = Buffer.from(sha, \"utf8\");\n            return got.length === want.length && nodeRequire(\"crypto\").timingSafeEqual(got, want);\n        }\n\n        /** navi-* parks carry no policy; only the owning shell (relay advertise/retire) may write them. */\n        relayParkWriteForbidden(ib) {\n            return {\n                status: 403,\n                body: JSON.stringify({\n                    error: `relay park ${ib} is written only by its shell over the relay (relay advertise / retire)`,\n                }),\n                type: \"application/json\",\n            };\n        }\n\n        isRelayParkIb(ib) {\n            const s = String(ib || \"\").trim();\n            return /^navi-[a-zA-Z0-9._-]+$/.test(s);\n        }\n\n        parseRelayExpiresAt(raw) {\n            const t = Date.parse(String(raw || \"\").trim());\n            return Number.isFinite(t) ? t : null;\n        }\n\n        isRelayFrameExpired(frame) {\n            const exp = frame?.data?.relay_expires_at;\n            if (!exp) return false;\n            const t = this.parseRelayExpiresAt(exp);\n            if (t == null) return false;\n            return Date.now() > t;\n        }\n\n        relayFrameUnavailable(resolved) {\n            const frame = resolved?.frame;\n            const tip = resolved?.tip;\n            if (tip?.tombstone || frame?.data?.tombstone) {\n                return { kind: \"tombstone\" };\n            }\n            if (this.isRelayFrameExpired(frame)) {\n                return {\n                    kind: \"expired\",\n                    expires_at: frame?.data?.relay_expires_at || null,\n                };\n            }\n            return null;\n        }\n\n        expiredParkResponse(expiresAt) {\n            return this.relayErrorResponse(410, \"relay park expired\", {\n                via: \"hostparkinator_5000\",\n                relay_expires_at: expiresAt || null,\n            });\n        }\n\n        /**\n         * Always-bodied JSON error for the remote relay caller.\n         * `plain` adds content_type/body_b64 for lua park_request.\n         */\n        relayErrorResponse(status, error, extra = {}) {\n            const payload = {\n                error: String(error || \"relay failed\"),\n                via: extra.via || \"hostparkinator_5000\",\n            };\n            if (extra.method) payload.method = extra.method;\n            if (extra.path) payload.path = extra.path;\n            if (extra.remainder != null && extra.remainder !== undefined) {\n                payload.remainder = extra.remainder;\n            }\n            if (extra.timeout_ms != null) payload.timeout_ms = extra.timeout_ms;\n            if (extra.relay_expires_at != null) {\n                payload.relay_expires_at = extra.relay_expires_at;\n            }\n            if (extra.max != null) payload.max = extra.max;\n            const body = JSON.stringify(payload, null, 2);\n            if (extra.plain) {\n                return {\n                    status,\n                    content_type: \"application/json; charset=utf-8\",\n                    body,\n                    body_b64: Buffer.from(body, \"utf8\").toString(\"base64\"),\n                };\n            }\n            return {\n                status,\n                body,\n                type: \"application/json; charset=utf-8\",\n            };\n        }\n\n        relayParkGoneResponse(unavailable, plain = false) {\n            if (unavailable?.kind === \"expired\") {\n                return this.relayErrorResponse(410, \"relay park expired\", {\n                    via: \"hostparkinator_5000\",\n                    relay_expires_at: unavailable.expires_at || null,\n                    plain,\n                });\n            }\n            return this.relayErrorResponse(410, \"relay park gone\", {\n                via: \"hostparkinator_5000\",\n                plain,\n            });\n        }\n\n        relayParkOwnerUuid(frame) {\n            const data = frame?.data;\n            if (!data || typeof data !== \"object\") return \"\";\n            return String(\n                data.navi_shell_uuid || data.method?.POST?.target || \"\"\n            ).trim();\n        }\n\n        buildRelayParkHead(frame, existing) {\n            const ib = String(frame?.ib || \"\").trim();\n            if (!this.isRelayParkIb(ib)) {\n                throw new Error(\"relay park ib must be navi-<alias>\");\n            }\n            const data = {\n                ...(frame?.data && typeof frame.data === \"object\"\n                    ? frame.data\n                    : {}),\n            };\n            delete data.tombstone;\n            delete data.retired;\n            const n =\n                existing && !existing.tombstone\n                    ? (Number(existing.frame?.data?.n) || 0) + 1\n                    : 0;\n            data.n = n;\n            data.timestamp = navi.stamp.time();\n            const gib = sha256Hex(\n                Buffer.from(JSON.stringify(data), \"utf8\")\n            ).toUpperCase();\n            const rel8ns = {\n                ...(frame?.rel8ns && typeof frame.rel8ns === \"object\"\n                    ? frame.rel8ns\n                    : {}),\n                past:\n                    existing && !existing.tombstone && existing.addr\n                        ? [existing.addr]\n                        : [],\n                tjp: Array.isArray(frame?.rel8ns?.tjp)\n                    ? frame.rel8ns.tjp\n                    : [],\n                dna: Array.isArray(frame?.rel8ns?.dna)\n                    ? frame.rel8ns.dna\n                    : [],\n            };\n            return { ib, gib, data, rel8ns };\n        }\n\n        async relayAdvertiseCommit(uuid, frame) {\n            const id = String(uuid || \"\").trim();\n            const owner = this.relayParkOwnerUuid(frame);\n            if (owner !== id) {\n                throw new Error(\"relay frame target uuid must match connected shell\");\n            }\n            const store = this.ensureStore();\n            const existing = store.getTip(String(frame?.ib || \"\"));\n            const head = this.buildRelayParkHead(frame, existing);\n            // Soft-expire is only a callin gate — tip stays live, so renew is mut8.\n            // Tombstone (or missing) → firstGen reclaim.\n            const transform =\n                existing && !existing.tombstone ? \"mut8\" : \"firstGen\";\n            const envelope = {\n                transform,\n                newIbGib: head,\n                dnas: [],\n                intermediateIbGibs: [],\n            };\n            const body = Buffer.from(JSON.stringify(envelope), \"utf8\");\n            const res = await this.applyCommitEnvelope(\n                head.ib,\n                envelope,\n                body,\n                {},\n                null,\n                { relay: true, relayUuid: id }\n            );\n            return this.assertRelayCommitOk(\n                res,\n                `relay advertise ${head.ib}`,\n                head.ib\n            );\n        }\n\n        async relayRetireCommit(uuid, ibRaw) {\n            const id = String(uuid || \"\").trim();\n            const ib = String(ibRaw || \"\").trim();\n            if (!this.isRelayParkIb(ib)) {\n                throw new Error(\"relay retire ib must be navi-<alias>\");\n            }\n            const store = this.ensureStore();\n            const existing = store.getTip(ib);\n            if (!existing || existing.tombstone || !existing.frame) {\n                throw new Error(`no live relay park: ${ib}`);\n            }\n            if (this.relayParkOwnerUuid(existing.frame) !== id) {\n                throw new Error(\"relay retire: connected uuid does not own this park\");\n            }\n            const parent = existing.frame;\n            const n = (Number(parent.data?.n) || 0) + 1;\n            const data = {\n                ...(parent.data && typeof parent.data === \"object\"\n                    ? parent.data\n                    : {}),\n                tombstone: true,\n                retired: true,\n                n,\n                timestamp: navi.stamp.time(),\n            };\n            const gib = sha256Hex(\n                Buffer.from(JSON.stringify(data), \"utf8\")\n            ).toUpperCase();\n            const envelope = {\n                transform: \"mut8\",\n                newIbGib: {\n                    ib,\n                    gib,\n                    data,\n                    rel8ns: {\n                        ...(parent.rel8ns && typeof parent.rel8ns === \"object\"\n                            ? parent.rel8ns\n                            : {}),\n                        past: [existing.addr],\n                        tjp: Array.isArray(parent.rel8ns?.tjp)\n                            ? parent.rel8ns.tjp\n                            : [],\n                        dna: Array.isArray(parent.rel8ns?.dna)\n                            ? parent.rel8ns.dna\n                            : [],\n                    },\n                },\n                dnas: [],\n                intermediateIbGibs: [],\n            };\n            const body = Buffer.from(JSON.stringify(envelope), \"utf8\");\n            const res = await this.applyCommitEnvelope(\n                ib,\n                envelope,\n                body,\n                {},\n                null,\n                { relay: true, relayUuid: id }\n            );\n            return this.assertRelayCommitOk(res, `relay retire ${ib}`, ib);\n        }\n\n        /**\n         * Relay WS advertise/retire must never report success unless the tip advanced.\n         * Ping uses ib (navi-{alias}); addr proves the commit landed.\n         */\n        assertRelayCommitOk(res, label, ibFallback) {\n            const status = Number(res?.status) || 0;\n            let json = {};\n            try {\n                json = JSON.parse(String(res?.body || \"\"));\n            } catch {\n                json = {};\n            }\n            if (status < 200 || status >= 300) {\n                const err =\n                    json.error ||\n                    String(res?.body || \"\")\n                        .trim()\n                        .slice(0, 240) ||\n                    `HTTP ${status}`;\n                throw new Error(`${label}: ${err}`);\n            }\n            const addr =\n                String(json.addr || \"\").trim() ||\n                String(res?.headers?.[\"X-Foobarch-ib^gib\"] || \"\").trim();\n            if (!addr) {\n                throw new Error(`${label}: commit returned no tip addr`);\n            }\n            return {\n                ib:\n                    String(json.ib || \"\").trim() ||\n                    String(ibFallback || \"\").trim() ||\n                    undefined,\n                addr,\n            };\n        }\n\n        async handleNaviShellRelayOp(uuid, msg) {\n            const id = String(msg.id || \"\");\n            const reply = (payload) =>\n                this.sendNaviShell(uuid, {\n                    type: \"result\",\n                    id,\n                    ...payload,\n                });\n            if (!this._naviShells.get(String(uuid || \"\").trim())) {\n                reply({ ok: false, error: \"navi_shell not registered\" });\n                return;\n            }\n            try {\n                if (msg.type === \"advertise\") {\n                    const r = await this.relayAdvertiseCommit(uuid, msg.frame);\n                    reply({ ok: true, ib: r.ib, addr: r.addr });\n                    return;\n                }\n                if (msg.type === \"retire\") {\n                    const r = await this.relayRetireCommit(\n                        uuid,\n                        String(msg.ib || \"\").trim()\n                    );\n                    reply({ ok: true, ib: r.ib, addr: r.addr });\n                    return;\n                }\n                reply({ ok: false, error: `unknown relay op: ${msg.type}` });\n            } catch (err) {\n                reply({\n                    ok: false,\n                    error: err && err.message ? err.message : String(err),\n                });\n            }\n        }\n\n        async relayNaviShellCallin(uuid, token, remainder, body, meta = {}) {\n            const id = String(uuid || \"\").trim();\n            const rem = remainder == null ? \"\" : String(remainder);\n            const extra = {\n                via: \"hostparkinator_5000\",\n                method: String(meta.method || \"\").toUpperCase() || null,\n                path: meta.path || \"\",\n                remainder: rem,\n            };\n            const row = this._naviShells.get(id);\n            if (!row || !row.socket || row.socket.destroyed) {\n                return this.relayErrorResponse(503, \"navi_shell offline\", extra);\n            }\n            // A per-alias token (checked at the park) replaces the shell-wide token.\n            if (!meta.aliasSha && row.token && token !== row.token) {\n                return this.relayErrorResponse(\n                    401,\n                    \"bad navi_shell usage token\",\n                    extra\n                );\n            }\n            if (!row.jobs) row.jobs = new Map();\n            if (this.naviShellJobLoad(row) >= NAVI_SHELL_MAX_INFLIGHT) {\n                return this.relayErrorResponse(429, \"too many in-flight callins\", {\n                    ...extra,\n                    max: NAVI_SHELL_MAX_INFLIGHT,\n                });\n            }\n\n            // Park-relative job claim: GET /navi-{alias}/_job/{id}\n            const jobClaim = rem.match(/^_job\\/([^/]+)$/i);\n            if (jobClaim) {\n                return this.naviShellJobResponse(id, token, jobClaim[1]);\n            }\n\n            const callId = randomHex(8);\n            const wait = naviShellWantWait(meta.headers || {});\n            const job = {\n                id: callId,\n                state: \"running\",\n                createdAt: Date.now(),\n                remainder: rem,\n                aliasSha: meta.aliasSha || null,\n            };\n            row.jobs.set(callId, job);\n\n            const payload = {\n                type: \"callin\",\n                id: callId,\n                alias: meta.alias || \"\",\n                remainder: rem,\n                body: body == null ? \"\" : String(body),\n                method: String(meta.method || \"POST\").toUpperCase(),\n                path: String(meta.path || \"\"),\n                headers: this.relayCallinHeaders(meta.headers || {}),\n            };\n\n            if (!wait) {\n                const ok = this.sendNaviShell(id, payload);\n                if (!ok) {\n                    row.jobs.delete(callId);\n                    return this.relayErrorResponse(503, \"navi_shell send failed\", extra);\n                }\n                const statusPath = `/_foobarch/navi_shell/job/${encodeURIComponent(id)}/${encodeURIComponent(callId)}`;\n                return {\n                    status: 202,\n                    body: JSON.stringify({\n                        job_id: callId,\n                        state: \"running\",\n                        status_path: statusPath,\n                        park_job_path: `_job/${callId}`,\n                        hint:\n                            \"Poll status_path (or park_job_path under this navi park). Done response delivers body once then dumps the job.\",\n                    }),\n                    type: \"application/json; charset=utf-8\",\n                    headers: {\n                        Location: statusPath,\n                    },\n                };\n            }\n\n            // Escape hatch: X-Navi-Shell-Wait — hold HTTP until result (long job budget).\n            try {\n                const result = await new Promise((resolve, reject) => {\n                    const timer = setTimeout(() => {\n                        row.inflight.delete(callId);\n                        row.jobs.delete(callId);\n                        reject(new Error(\"navi_shell callin timeout\"));\n                    }, NAVI_SHELL_JOB_MS);\n                    row.inflight.set(callId, { resolve, reject, timer });\n                    const ok = this.sendNaviShell(id, payload);\n                    if (!ok) {\n                        clearTimeout(timer);\n                        row.inflight.delete(callId);\n                        row.jobs.delete(callId);\n                        reject(new Error(\"navi_shell send failed\"));\n                    }\n                });\n                row.jobs.delete(callId);\n                if (!result || result.ok === false) {\n                    const status = Number(result?.status) || 502;\n                    if (result?.media != null && String(result.media).length) {\n                        return {\n                            status,\n                            body: String(result.media),\n                            type:\n                                result.mime ||\n                                \"application/json; charset=utf-8\",\n                        };\n                    }\n                    return this.relayErrorResponse(\n                        status,\n                        result?.error || \"navi_shell callin failed\",\n                        { ...extra, via: \"navi_shell\" }\n                    );\n                }\n                const media = result.media != null ? String(result.media) : \"\";\n                const mime = result.mime || \"text/plain; charset=utf-8\";\n                return { status: 200, body: media, type: mime };\n            } catch (err) {\n                row.jobs.delete(callId);\n                const msg = err && err.message ? err.message : String(err);\n                const status = /timeout/i.test(msg) ? 504 : 503;\n                return this.relayErrorResponse(status, msg, {\n                    ...extra,\n                    timeout_ms: /timeout/i.test(msg)\n                        ? NAVI_SHELL_JOB_MS\n                        : undefined,\n                });\n            }\n        }\n\n        setUsagePassword(pwd) {\n            this.ensureStore().setMeta(\"usage_password\", String(pwd || \"\"));\n        }\n\n        shellHtml(hxPath) {\n            const hostName =\n                typeof this?._lastReqHost === \"string\"\n                    ? this._lastReqHost\n                    : \"\";\n            const pageTitle = /punchbox/i.test(hostName) ? \"Punchbox\" : \"Foobarch\";\n            let pathTitle = String(hxPath || \"\")\n                .split(\"?\")[0]\n                .replace(/^\\/+/, \"\");\n            try {\n                pathTitle = decodeURIComponent(pathTitle);\n            } catch {\n                /* keep encoded */\n            }\n            const tabTitle = (pathTitle || pageTitle)\n                .replace(/&/g, \"&amp;\")\n                .replace(/</g, \"&lt;\")\n                .replace(/>/g, \"&gt;\");\n            const body = hxPath\n                ? `<body style=\"margin:0;padding:0;overflow:hidden;\"><span hx-get=\"${hxPath}\" hx-trigger=\"load\" hx-swap=\"outerHTML\">Surfing...</span></body>`\n                : `<body style=\"margin:0;padding:0;overflow:hidden;\"></body>`;\n            return `<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n    <meta charset=\"UTF-8\">\n    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover\">\n    <meta name=\"apple-mobile-web-app-capable\" content=\"yes\">\n    <meta name=\"mobile-web-app-capable\" content=\"yes\">\n    <meta name=\"apple-mobile-web-app-title\" content=\"${pageTitle}\">\n    <meta name=\"apple-mobile-web-app-status-bar-style\" content=\"default\">\n    <meta name=\"theme-color\" content=\"#ffffff\">\n    <title>${tabTitle}</title>\n    <link rel=\"icon\" href=\"/favicon.ico\" type=\"image/x-icon\" sizes=\"16x16 32x32 48x48\">\n    <link rel=\"icon\" href=\"/manifest.json/icon-192.png\" type=\"image/png\" sizes=\"192x192\">\n    <link rel=\"apple-touch-icon\" href=\"/apple-touch-icon.png\" sizes=\"180x180\">\n    <link rel=\"manifest\" href=\"/manifest.json\">\n    <style>\n      html, body {\n        margin: 0;\n        padding: 0;\n        overflow: hidden;\n        overflow-x: hidden;\n        -webkit-text-size-adjust: none;\n        text-size-adjust: none;\n        touch-action: pan-x pan-y;\n      }\n      /* iOS Safari zooms focused controls when computed font-size is under 16px */\n      input, select, textarea, button { font-size: 16px; }\n    </style>\n    <script>\n      (function () {\n        var block = function (e) { e.preventDefault(); };\n        document.addEventListener(\"gesturestart\", block, { passive: false });\n        document.addEventListener(\"gesturechange\", block, { passive: false });\n        document.addEventListener(\"gestureend\", block, { passive: false });\n        document.addEventListener(\"touchmove\", function (e) {\n          if (e.touches && e.touches.length > 1) e.preventDefault();\n        }, { passive: false });\n      })();\n    </script>\n    <script src=\"/navi_shell.js\"></script>\n</head>\n${body}\n</html>`;\n        }\n\n        isBrowserRequest(req) {\n            const ua = req.headers[\"user-agent\"] || \"\";\n            if (!ua) return false;\n            return [\n                \"Mozilla\",\n                \"Chrome\",\n                \"Safari\",\n                \"Firefox\",\n                \"Edge\",\n                \"Opera\",\n                \"Gecko\",\n                \"WebKit\",\n                \"Trident\",\n            ].some((x) => ua.includes(x));\n        }\n\n        isDirectNavigation(req) {\n            const dest = req.headers[\"sec-fetch-dest\"];\n            const mode = req.headers[\"sec-fetch-mode\"];\n            if (dest === \"document\") return true;\n            if (mode === \"navigate\") return true;\n            return false;\n        }\n\n        normalizePath(pathname) {\n            let p = String(pathname || \"/\").split(\"?\")[0];\n            try {\n                p = decodeURIComponent(p);\n            } catch {\n                /* ignore */\n            }\n            p = p.replace(/\\\\/g, \"/\");\n            if (!p.startsWith(\"/\")) p = \"/\" + p;\n            if (p.length > 1 && p.endsWith(\"/\")) p = p.slice(0, -1);\n            return p;\n        }\n\n        pathToIb(pathname) {\n            return this.normalizePath(pathname).replace(/^\\/+/, \"\");\n        }\n\n        pickTipRace(store, ib, gatePassthru, allowIbs) {\n            const live =\n                allowIbs instanceof Set && allowIbs.size\n                    ? [...allowIbs]\n                    : store.listTipIbs();\n            let keys = liveDelimiterHits(ib, live);\n            if (!keys.length) {\n                const raw = normalizeParkIb(pct20ToSpace(ib));\n                if (raw) keys = [raw];\n            }\n            const loaded = keys.map((key) => {\n                const t = store.getTip(key);\n                if (!t || t.tombstone) return null;\n                return t;\n            });\n            if (!gatePassthru) {\n                const gated = loaded.find((t) => t && isTipGateTrue(t.frame?.data));\n                if (gated) return gated;\n            }\n            return loaded.find((t) => t) || null;\n        }\n\n        joinIbPrefix(ib, nSegs) {\n            const { segments, gaps } = tokenizeParkIb(ib);\n            if (!segments.length || nSegs <= 0) return \"\";\n            const n = Math.min(nSegs, segments.length);\n            return joinParkIb(segments.slice(0, n), gaps.slice(0, Math.max(0, n - 1)));\n        }\n\n        isParkCapture(frame) {\n            return isParkCaptureData(frame?.data);\n        }\n\n        /**\n         * After a capture wins: known `data.paths` go to that target ib\n         * (exact tip, so a shorter nested spoof cannot keep the remainder).\n         * `data.passthru` re-resolves the original path with this park skipped.\n         */\n        applyCapturePaths(resolved, ibPath, opts = {}) {\n            const rem = String(resolved?.remainder || \"\");\n            if (!rem || !resolved?.frame) return null;\n            if (!this.isParkCapture(resolved.frame)) return null;\n            const data = resolved.frame.data || {};\n            const match = matchKnownPath(data.paths, rem);\n            if (match) {\n                const store = this.ensureStore();\n                const tip = store.getTip(match.target);\n                if (!tip || tip.tombstone || !tip.frame) {\n                    return { kind: \"miss\", ib: match.target };\n                }\n                const inner = {\n                    kind: tip.park ? \"park\" : \"tip\",\n                    ib: match.target,\n                    remainder: match.leftover,\n                    tip,\n                    addr: tip.addr,\n                    frame: tip.frame || store.getFrame(tip.addr),\n                };\n                if (match.leftover && this.isParkCapture(inner.frame)) {\n                    const nextPath = match.leftover\n                        ? `${match.target}/${match.leftover}`\n                        : match.target;\n                    const deeper = this.applyCapturePaths(inner, nextPath, opts);\n                    if (deeper) return deeper;\n                }\n                return inner;\n            }\n            if (data.passthru !== true) return null;\n            const hops = Number(opts.parkHops) || 0;\n            if (hops >= CAPTURE_PATH_HOPS) {\n                return { kind: \"miss\", ib: ibPath, reason: \"passthru_hop_limit\" };\n            }\n            const skip = new Set(opts.skipParkIbs || []);\n            skip.add(String(resolved.ib || \"\"));\n            return this.resolveRoute(\"/\" + ibPath, {\n                ...opts,\n                skipParkIbs: skip,\n                parkHops: hops + 1,\n            });\n        }\n\n        /**\n         * Parks under first token (space / : / /). Longest matching prefix\n         * wins unless a capturing park claims the request (remainder\n         * delimiters then do not matter). `%20` becomes space before search.\n         * Same-depth twins race: exact first, then space, then `:`, then `/`.\n         * data.gate=true in the race set always wins unless X-Navi-Gate-Passthru.\n         *\n         * Claim shape: `park: \"capture\"|\"defer\"` only (migrate legacy tips first).\n         *\n         * Capture + `data.paths` + `data.passthru`: longest known remainder\n         * prefix is served from that target ib (intermediate spoof captures\n         * lose). Unmatched remainder re-resolves with this park skipped.\n         */\n        resolveRoute(pathname, opts = {}) {\n            const store = this.ensureStore();\n            const ibPath = this.pathToIb(pathname);\n            if (!ibPath) return { kind: \"root\" };\n\n            const headers = opts.headers || {};\n            const gatePassthru = isGatePassthruHeader(\n                this.headerGet(headers, \"X-Navi-Gate-Passthru\")\n            );\n            const skipParkIbs =\n                opts.skipParkIbs instanceof Set\n                    ? opts.skipParkIbs\n                    : new Set(opts.skipParkIbs || []);\n\n            const reqSegs = tokenizeParkIb(ibPath).segments;\n            if (!reqSegs.length) return { kind: \"root\" };\n\n            const seen = new Set();\n            const parks = [];\n            const rootSlash = ibPath.split(\"/\")[0];\n            for (const root of [reqSegs[0], rootSlash]) {\n                if (!root) continue;\n                for (const p of store.parksForRoot(root)) {\n                    const pib = String(p.ib || \"\");\n                    if (!pib || seen.has(pib) || skipParkIbs.has(pib)) continue;\n                    seen.add(pib);\n                    parks.push(p);\n                }\n            }\n\n            const matching = [];\n            for (const park of parks) {\n                const pib = String(park.ib || \"\");\n                const parkSegs = tokenizeParkIb(pib).segments;\n                if (\n                    !parkSegs.length ||\n                    parkSegs.length > reqSegs.length ||\n                    !parkSegs.every((s, i) => s === reqSegs[i])\n                ) {\n                    continue;\n                }\n                const tip = store.getTip(park.ib);\n                if (!tip || tip.tombstone) continue;\n                const frame = tip.frame || store.getFrame(park.addr);\n                matching.push({\n                    park,\n                    tip,\n                    frame,\n                    ib: pib,\n                    segs: parkSegs,\n                });\n            }\n\n            const finish = (picked, depth, kindHint) => {\n                if (!picked) return null;\n                const remainder = reqSegs.slice(depth).join(\"/\");\n                const park = !!picked.park;\n                return {\n                    kind: kindHint || (park ? \"park\" : \"tip\"),\n                    ib: picked.ib,\n                    remainder,\n                    tip: picked,\n                    addr: picked.addr,\n                    frame: picked.frame,\n                };\n            };\n\n            if (matching.length) {\n                matching.sort((a, b) => a.segs.length - b.segs.length);\n                const captures = matching.filter((m) =>\n                    this.isParkCapture(m.frame)\n                );\n                const chosenDepth = captures.length\n                    ? captures[0].segs.length\n                    : matching[matching.length - 1].segs.length;\n                const pool = (captures.length ? captures : matching).filter(\n                    (m) => m.segs.length === chosenDepth\n                );\n                const allowIbs = new Set(pool.map((m) => m.ib));\n                const raceIb = this.joinIbPrefix(ibPath, chosenDepth);\n                const picked = this.pickTipRace(\n                    store,\n                    raceIb || ibPath,\n                    gatePassthru,\n                    allowIbs\n                );\n                const resolved = finish(\n                    picked,\n                    chosenDepth,\n                    captures.length ? \"park\" : picked?.park ? \"park\" : \"tip\"\n                );\n                if (resolved) {\n                    const routed = this.applyCapturePaths(resolved, ibPath, opts);\n                    if (routed) return routed;\n                    return resolved;\n                }\n            }\n\n            const exact = this.pickTipRace(store, ibPath, gatePassthru);\n            if (exact) {\n                const depth = tokenizeParkIb(exact.ib).segments.length;\n                return (\n                    finish(exact, depth, exact.park ? \"park\" : \"tip\") || {\n                        kind: \"miss\",\n                        ib: ibPath,\n                    }\n                );\n            }\n\n            // /{ib}^{gib}[/{remainder}]: tip-ib must exist, then pin that gib\n            // (do not use tip.addr). Method controls come from the pinned frame.\n            const caret = ibPath.lastIndexOf(\"^\");\n            if (caret > 0) {\n                const tipIb = ibPath.slice(0, caret);\n                const after = ibPath.slice(caret + 1);\n                const gm = /^([^/:\\s]+)(.*)$/.exec(after);\n                if (tipIb && gm) {\n                    const gib = gm[1];\n                    const remRaw = String(gm[2] || \"\").replace(/^[/:\\s]+/, \"\");\n                    const tipRow = store.getTip(tipIb);\n                    if (tipRow && !tipRow.tombstone) {\n                        const addr = `${tipIb}^${gib}`;\n                        const frame = store.getFrame(addr);\n                        if (\n                            frame &&\n                            String(frame.ib || tipIb) === tipIb &&\n                            String(frame.gib || gib) === gib\n                        ) {\n                            return {\n                                kind: tipRow.park ? \"park\" : \"tip\",\n                                ib: tipIb,\n                                remainder: remRaw,\n                                tip: tipRow,\n                                addr,\n                                frame,\n                                pinnedGib: true,\n                            };\n                        }\n                        return {\n                            kind: \"miss\",\n                            ib: tipIb,\n                            addr,\n                            reason: \"gib_not_found\",\n                        };\n                    }\n                }\n            }\n\n            return { kind: \"miss\", ib: ibPath };\n        }\n\n        httpControl(frame, method) {\n            const m = String(method || \"GET\").toUpperCase();\n            const block = frame?.data?.method;\n            if (block && typeof block === \"object\" && block[m]) return block[m];\n            // Write verbs only — GET/HEAD must be explicit in data.method (no implicit bin).\n            if (m === \"PUT\" || m === \"PATCH\") return { kind: \"commit\" };\n            if (m === \"DELETE\") return { kind: \"tombstone\" };\n            return null;\n        }\n\n        /**\n         * Accept lists media type with q!=0 (exact type match).\n         * `application/navi-mod` does not match `application/navi-module`.\n         */\n        acceptHasType(acceptHeader, typeName) {\n            const a = String(acceptHeader || \"\").toLowerCase();\n            const want = String(typeName || \"\")\n                .toLowerCase()\n                .trim();\n            if (!a || !want) return false;\n            for (const part of a.split(\",\")) {\n                const media = part.trim().split(\";\")[0].trim();\n                if (media !== want) continue;\n                const qm = part.match(/;\\s*q\\s*=\\s*([0-9.]+)/i);\n                if (qm && Number(qm[1]) === 0) continue;\n                return true;\n            }\n            return false;\n        }\n\n        /**\n         * Tip/frame JSON: application/eframe (legacy: application/ibgib+json).\n         */\n        wantsEframe(acceptHeader) {\n            return (\n                this.acceptHasType(acceptHeader, \"application/eframe\") ||\n                this.acceptHasType(acceptHeader, \"application/ibgib+json\")\n            );\n        }\n\n        /**\n         * Mod provision (multipart eframe + bin): Accept application/navi-mod\n         * (legacy: application/navi-mod+json).\n         */\n        wantsNaviMod(acceptHeader) {\n            return (\n                this.acceptHasType(acceptHeader, \"application/navi-mod\") ||\n                this.acceptHasType(acceptHeader, \"application/navi-mod+json\")\n            );\n        }\n\n        /** Raw module source bytes (not the navi-mod multipart). */\n        wantsNaviModuleBytes(acceptHeader) {\n            if (this.acceptHasType(acceptHeader, \"application/navi-module\"))\n                return true;\n            const a = String(acceptHeader || \"\").toLowerCase();\n            return (\n                a.includes(\"application/javascript\") ||\n                a.includes(\"text/javascript\")\n            );\n        }\n\n        /**\n         * Accept priority among tip/content classes: html > text > eframe.\n         * Tip JSON only when eframe wins (no html/text, and no other primary\n         * payload type). Never \"attach\" eframe beside another body.\n         */\n        wantsIbGibFrame(acceptHeader) {\n            if (!this.wantsEframe(acceptHeader)) return false;\n            if (this.acceptHasType(acceptHeader, \"text/html\")) return false;\n            if (this.acceptHasType(acceptHeader, \"text/plain\")) return false;\n            if (this.wantsNaviMod(acceptHeader)) return false;\n            const a = String(acceptHeader || \"\").toLowerCase();\n            for (const part of a.split(\",\")) {\n                const media = part.trim().split(\";\")[0].trim();\n                if (!media) continue;\n                const qm = part.match(/;\\s*q\\s*=\\s*([0-9.]+)/i);\n                if (qm && Number(qm[1]) === 0) continue;\n                if (\n                    media === \"application/eframe\" ||\n                    media === \"application/ibgib+json\" ||\n                    media === \"application/json\" ||\n                    media === \"*/*\"\n                ) {\n                    continue;\n                }\n                return false;\n            }\n            return true;\n        }\n\n        wantsNaviModPackage(acceptHeader) {\n            return this.wantsNaviMod(acceptHeader);\n        }\n\n        /** Eframe snapshot with bins: Accept application/eframe + multipart/related. */\n        wantsFrameSnapshot(acceptHeader) {\n            return (\n                this.wantsEframe(acceptHeader) &&\n                this.acceptHasType(acceptHeader, \"multipart/related\")\n            );\n        }\n\n        /**\n         * Bins a GET snapshot may carry. data.snapshot_bins: true (all rel8ns.bin)\n         * or a list of indices / \"bin <sha>\" refs. X-Foobarch-Snapshot-Bins\n         * (indices or shas) narrows that set; it can never widen it.\n         */\n        snapshotBinShas(frame, headers) {\n            const bins = Array.isArray(frame?.rel8ns?.bin) ? frame.rel8ns.bin.map(String) : [];\n            const spec = frame?.data?.snapshot_bins;\n            if (!bins.length || spec == null || spec === false) return [];\n            const shaOf = (s) => String(s || \"\").replace(/^bin\\s+/i, \"\").trim().toLowerCase();\n            const resolveEntry = (v) => {\n                if (typeof v === \"number\" || /^\\d+$/.test(String(v).trim())) {\n                    return bins[Number(v)] ? shaOf(bins[Number(v)]) : \"\";\n                }\n                const want = shaOf(v);\n                return bins.some((b) => shaOf(b) === want) ? want : \"\";\n            };\n            let allowed =\n                spec === true\n                    ? bins.map(shaOf)\n                    : Array.isArray(spec)\n                      ? spec.map(resolveEntry)\n                      : [];\n            allowed = allowed.filter((s, i, arr) => s && arr.indexOf(s) === i);\n            const narrowRaw = String(\n                this.headerGet(headers, \"x-foobarch-snapshot-bins\") || \"\"\n            ).trim();\n            if (!narrowRaw) return allowed;\n            const narrow = new Set(\n                narrowRaw\n                    .split(/[,\\s]+/)\n                    .filter(Boolean)\n                    .map(resolveEntry)\n                    .filter(Boolean)\n            );\n            return allowed.filter((s) => narrow.has(s));\n        }\n\n        /**\n         * multipart/related: eframe + selected bins. Each bin part carries\n         * X-Foobarch-Bin; the response lists delivered shas in X-Foobarch-Bins.\n         */\n        buildFrameSnapshot(resolved, store, shas, method) {\n            const frame = resolved.frame;\n            const boundary =\n                \"foobarch-\" +\n                Date.now().toString(36) +\n                \"-\" +\n                Math.random().toString(36).slice(2, 10);\n            const parts = [\n                Buffer.from(\n                    `--${boundary}\\r\\n` +\n                        `Content-Type: application/eframe; charset=utf-8\\r\\n` +\n                        `Content-ID: <eframe>\\r\\n` +\n                        `Content-Disposition: inline; name=\"eframe\"\\r\\n` +\n                        `\\r\\n`,\n                    \"utf8\"\n                ),\n                Buffer.from(JSON.stringify(frame), \"utf8\"),\n                Buffer.from(\"\\r\\n\", \"utf8\"),\n            ];\n            const delivered = [];\n            for (const sha of shas) {\n                const blob = store.getBin(sha);\n                if (!blob) continue;\n                const bytes = Buffer.isBuffer(blob.bytes)\n                    ? blob.bytes\n                    : Buffer.from(blob.bytes || \"\");\n                const ct = blob.content_type || \"application/octet-stream\";\n                parts.push(\n                    Buffer.from(\n                        `--${boundary}\\r\\n` +\n                            `Content-Type: ${ct}\\r\\n` +\n                            `Content-ID: <bin ${sha}>\\r\\n` +\n                            `Content-Disposition: attachment; name=\"bin\"; filename=\"bin ${sha}\"\\r\\n` +\n                            `X-Foobarch-Bin: ${sha}\\r\\n` +\n                            `Content-Transfer-Encoding: binary\\r\\n` +\n                            `\\r\\n`,\n                        \"utf8\"\n                    ),\n                    bytes,\n                    Buffer.from(\"\\r\\n\", \"utf8\")\n                );\n                delivered.push(sha);\n            }\n            parts.push(Buffer.from(`--${boundary}--\\r\\n`, \"utf8\"));\n            return {\n                status: 200,\n                body: method === \"HEAD\" ? \"\" : Buffer.concat(parts),\n                type: `multipart/related; boundary=\"${boundary}\"; type=\"application/eframe\"; start=\"<eframe>\"`,\n                headers: {\n                    \"X-Foobarch-ib^gib\": resolved.addr,\n                    \"X-Foobarch-Package\": \"application/eframe+bins\",\n                    \"X-Foobarch-Bins\": delivered.join(\",\"),\n                },\n            };\n        }\n\n        /**\n         * kind=mod provision: multipart/related with eframe + addressed bin.\n         * Same organization as host store — navi parks the eframe and puts the\n         * bin under its sha without rewriting rel8ns.\n         */\n        buildNaviModPackage(resolved, store) {\n            const frame = resolved.frame;\n            const binRel = frame?.rel8ns?.bin?.[0];\n            if (!binRel) {\n                return {\n                    status: 404,\n                    body: JSON.stringify({\n                        error: \"mod package requires rel8ns.bin\",\n                        via: \"hostparkinator_5000\",\n                        ib: frame?.ib || resolved.ib,\n                    }),\n                    type: \"application/json\",\n                    headers: { \"X-Foobarch-ib^gib\": resolved.addr },\n                };\n            }\n            const sha = String(binRel).replace(/^bin\\s+/i, \"\").trim().toLowerCase();\n            const blob = store.getBin(sha);\n            if (!blob) {\n                return {\n                    status: 404,\n                    body: \"bin missing\\n\",\n                    type: \"text/plain\",\n                };\n            }\n            const binCt =\n                blob.content_type ||\n                frame.data?.content_type ||\n                \"application/navi-module\";\n            const bytes = Buffer.isBuffer(blob.bytes)\n                ? blob.bytes\n                : Buffer.from(blob.bytes || \"\");\n            const boundary =\n                \"foobarch-\" +\n                Date.now().toString(36) +\n                \"-\" +\n                Math.random().toString(36).slice(2, 10);\n            const frameJson = Buffer.from(JSON.stringify(frame), \"utf8\");\n            const parts = [];\n            parts.push(\n                Buffer.from(\n                    `--${boundary}\\r\\n` +\n                        `Content-Type: application/eframe; charset=utf-8\\r\\n` +\n                        `Content-ID: <eframe>\\r\\n` +\n                        `Content-Disposition: inline; name=\"eframe\"\\r\\n` +\n                        `\\r\\n`,\n                    \"utf8\"\n                )\n            );\n            parts.push(frameJson);\n            parts.push(Buffer.from(\"\\r\\n\", \"utf8\"));\n            parts.push(\n                Buffer.from(\n                    `--${boundary}\\r\\n` +\n                        `Content-Type: ${binCt}\\r\\n` +\n                        `Content-ID: <bin>\\r\\n` +\n                        `Content-Disposition: attachment; name=\"bin\"; filename=\"bin ${sha}\"\\r\\n` +\n                        `X-Foobarch-Bin: ${sha}\\r\\n` +\n                        `Content-Transfer-Encoding: binary\\r\\n` +\n                        `\\r\\n`,\n                    \"utf8\"\n                )\n            );\n            parts.push(bytes);\n            parts.push(Buffer.from(`\\r\\n--${boundary}--\\r\\n`, \"utf8\"));\n            return {\n                status: 200,\n                body: Buffer.concat(parts),\n                type: `multipart/related; boundary=\"${boundary}\"; type=\"application/eframe\"; start=\"<eframe>\"`,\n                headers: {\n                    \"X-Foobarch-ib^gib\": resolved.addr,\n                    \"X-Foobarch-Package\": \"application/navi-mod\",\n                    \"X-Foobarch-Bin\": sha,\n                },\n            };\n        }\n\n        /**\n         * Sync park/path controller for Lua (park_request). Avoids HTTP self-fetch\n         * deadlock; external URLs use child-process fetch with a hard timeout.\n         */\n        makeParkRequestController(opts = {}) {\n            const self = this;\n            let hops = Number(opts.hops) || 0;\n            const deadline =\n                opts.deadline || Date.now() + Math.max(LUA_TIMEOUT_MS, PARK_REQUEST_TIMEOUT_MS);\n            const headers = opts.headers || {};\n            const fn = (path, method, body) => {\n                const useHops = hops;\n                hops += 1;\n                return self.parkRequestFromLua(path, method, body, {\n                    hops: useHops,\n                    deadline,\n                    headers,\n                    parkRequest: fn,\n                });\n            };\n            return fn;\n        }\n\n        /**\n         * @returns {{ status: number, content_type?: string, headers?: object, body?: string, body_b64?: string, error?: string }}\n         */\n        parkRequestFromLua(pathOrUrl, method, body, opts = {}) {\n            const hops = Number(opts.hops) || 0;\n            if (hops >= LUA_PARK_HOPS) {\n                throw new Error(`park_request hop limit exceeded (${LUA_PARK_HOPS})`);\n            }\n            if (opts.deadline && Date.now() > opts.deadline) {\n                throw new Error(\"lua deadline exceeded\");\n            }\n            const methodU = String(method || \"GET\").toUpperCase();\n            const raw = String(pathOrUrl || \"\").trim();\n            if (!raw) throw new Error(\"park_request: empty path\");\n\n            const remainingMs = opts.deadline\n                ? Math.max(1, opts.deadline - Date.now())\n                : PARK_REQUEST_TIMEOUT_MS;\n            const timeoutMs = Math.min(PARK_REQUEST_TIMEOUT_MS, remainingMs);\n\n            if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) {\n                const r = syncHttpFetch(raw, {\n                    method: methodU,\n                    headers: opts.headers || {},\n                    body: body != null ? Buffer.from(String(body), \"utf8\") : null,\n                    timeoutMs,\n                });\n                const buf = Buffer.from(r.body_b64 || \"\", \"base64\");\n                return {\n                    status: r.status,\n                    content_type: r.type,\n                    headers: r.headers || {},\n                    body: buf.toString(\"utf8\"),\n                    body_b64: r.body_b64 || \"\",\n                    byte_length: buf.length,\n                };\n            }\n\n            let path = raw.startsWith(\"/\") ? raw : `/${raw}`;\n            let search = \"\";\n            const q = path.indexOf(\"?\");\n            if (q >= 0) {\n                search = path.slice(q);\n                path = path.slice(0, q);\n            }\n            path = this.normalizePath(path);\n\n            const store = this.ensureStore();\n            const resolved = this.resolveRoute(path, {\n                headers: opts.headers || {},\n            });\n            if (resolved.kind === \"miss\" || resolved.kind === \"root\" || !resolved.frame) {\n                return {\n                    status: 404,\n                    content_type: \"text/plain\",\n                    body: `no tip for ${this.pathToIb(path)}\\n`,\n                    body_b64: \"\",\n                };\n            }\n            const unavailable = this.relayFrameUnavailable(resolved);\n            if (unavailable) {\n                return this.relayParkGoneResponse(unavailable, true);\n            }\n\n            const ctrl = this.httpControl(\n                resolved.frame,\n                methodU === \"HEAD\" ? \"GET\" : methodU\n            );\n            if (!ctrl) {\n                return {\n                    status: 405,\n                    content_type: \"application/json\",\n                    body: JSON.stringify({ error: `no http control for ${methodU}` }),\n                    body_b64: \"\",\n                };\n            }\n            const kind = String(ctrl.kind || \"bin\").toLowerCase();\n\n            if (kind !== \"commit\" && kind !== \"tombstone\") {\n                const accessAuth = authorizeAccess(store, resolved.frame, {\n                    ib: resolved.frame?.ib || this.pathToIb(path),\n                    method: methodU,\n                    headers: opts.headers || {},\n                    body: body != null ? Buffer.from(String(body), \"utf8\") : Buffer.alloc(0),\n                    parkRequest: opts.parkRequest,\n                });\n                if (!accessAuth.allow) {\n                    const json = JSON.stringify({\n                        error: accessAuth.error || `${methodU} unauthorized`,\n                        via: accessAuth.via,\n                        policyAddr: accessAuth.policyAddr,\n                    });\n                    return {\n                        status: accessAuth.aside_ok === false ? 403 : 401,\n                        content_type: \"application/json\",\n                        body: json,\n                        body_b64: Buffer.from(json, \"utf8\").toString(\"base64\"),\n                    };\n                }\n            }\n\n            if (kind === \"navi_shell\" || kind === \"relay\") {\n                const json = JSON.stringify(\n                    {\n                        error:\n                            \"navi_shell relay is async; not available from lua park_request\",\n                        via: \"hostparkinator_5000\",\n                        method: methodU,\n                        path,\n                        remainder: resolved.remainder || \"\",\n                    },\n                    null,\n                    2\n                );\n                return {\n                    status: 503,\n                    content_type: \"application/json; charset=utf-8\",\n                    body: json,\n                    body_b64: Buffer.from(json, \"utf8\").toString(\"base64\"),\n                };\n            }\n\n            if (kind === \"frame\" || kind === \"manifest\") {\n                const json = JSON.stringify(resolved.frame, null, 2);\n                return {\n                    status: 200,\n                    content_type: \"application/json\",\n                    headers: { \"X-Foobarch-ib^gib\": resolved.addr },\n                    body: json,\n                    body_b64: Buffer.from(json, \"utf8\").toString(\"base64\"),\n                };\n            }\n\n            if (kind === \"proxy\") {\n                const target = String(ctrl.target || resolved.frame.data?.proxy_target || \"\");\n                if (!target) {\n                    return {\n                        status: 500,\n                        content_type: \"application/json\",\n                        body: JSON.stringify({ error: \"proxy control missing target\" }),\n                        body_b64: \"\",\n                    };\n                }\n                let url = target;\n                if (resolved.remainder) {\n                    const rem = String(resolved.remainder).replace(/^\\/+/, \"\");\n                    url = target.replace(/\\/+$/, \"\") + \"/\" + rem;\n                }\n                if (search) url += search;\n                const r = syncHttpFetch(url, {\n                    method: methodU === \"HEAD\" ? \"GET\" : methodU,\n                    headers: this.proxyForwardHeaders(opts.headers || {}),\n                    body:\n                        methodU !== \"GET\" &&\n                        methodU !== \"HEAD\" &&\n                        body != null\n                            ? Buffer.from(String(body), \"utf8\")\n                            : null,\n                    timeoutMs,\n                });\n                const buf = Buffer.from(r.body_b64 || \"\", \"base64\");\n                return {\n                    status: r.status,\n                    content_type: r.type,\n                    headers: { ...(r.headers || {}), \"X-Foobarch-Proxy\": url },\n                    body: buf.toString(\"utf8\"),\n                    body_b64: r.body_b64 || \"\",\n                    byte_length: buf.length,\n                };\n            }\n\n            if (kind === \"redirect\") {\n                const target = String(\n                    ctrl.target || resolved.frame.data?.redirect_target || \"\"\n                ).trim();\n                if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) {\n                    return {\n                        status: 500,\n                        content_type: \"application/json\",\n                        body: JSON.stringify({\n                            error:\n                                \"redirect target must be a route ib/path (not an absolute URL)\",\n                        }),\n                        body_b64: \"\",\n                    };\n                }\n                let ibPath = this.pathToIb(target);\n                if (resolved.remainder) {\n                    const rem = String(resolved.remainder).replace(/^\\/+/, \"\");\n                    ibPath = ibPath\n                        ? ibPath.replace(/\\/+$/, \"\") + \"/\" + rem\n                        : rem;\n                }\n                const next = \"/\" + ibPath + search;\n                const nested =\n                    typeof opts.parkRequest === \"function\"\n                        ? opts.parkRequest(next, methodU, body)\n                        : this.parkRequestFromLua(next, methodU, body, {\n                              ...opts,\n                              hops: hops + 1,\n                          });\n                return {\n                    ...nested,\n                    headers: {\n                        ...(nested.headers || {}),\n                        \"X-Foobarch-Redirect\": \"/\" + ibPath,\n                    },\n                };\n            }\n\n            if (kind === \"lua\") {\n                const script = resolveLuaScriptSource(store, ctrl, resolved.addr);\n                if (!script.source) {\n                    return {\n                        status: 500,\n                        content_type: \"application/json\",\n                        body: JSON.stringify({\n                            error: script.error || \"lua script missing\",\n                        }),\n                        body_b64: \"\",\n                    };\n                }\n                const parkRequest =\n                    typeof opts.parkRequest === \"function\"\n                        ? opts.parkRequest\n                        : this.makeParkRequestController({\n                              hops: hops + 1,\n                              deadline: opts.deadline,\n                              headers: opts.headers || {},\n                          });\n                const reqCtx = {\n                    method: methodU,\n                    path,\n                    remainder: resolved.remainder || \"\",\n                    search: search || \"\",\n                    headers: opts.headers || {},\n                    tip: {\n                        ib: resolved.frame.ib,\n                        addr: resolved.addr,\n                        data: resolved.frame.data || {},\n                        rel8ns: resolved.frame.rel8ns || {},\n                    },\n                    script_addr: script.scriptAddr,\n                };\n                const run = runLuaHandle(store, script.source, reqCtx, {\n                    bodyBuf:\n                        body != null\n                            ? Buffer.from(String(body), \"utf8\")\n                            : Buffer.alloc(0),\n                    parkRequest,\n                    timeoutMs: Math.min(LUA_TIMEOUT_MS, remainingMs),\n                });\n                if (!run.ok) {\n                    return {\n                        status: run.status || 500,\n                        content_type: \"application/json\",\n                        body: JSON.stringify({ error: run.error }),\n                        body_b64: \"\",\n                    };\n                }\n                const mapped = mapLuaHttpResult(store, run.result, methodU);\n                const buf = Buffer.isBuffer(mapped.body)\n                    ? mapped.body\n                    : Buffer.from(String(mapped.body || \"\"), \"utf8\");\n                return {\n                    status: mapped.status,\n                    content_type: mapped.type,\n                    headers: mapped.headers || {},\n                    body: buf.toString(\"utf8\"),\n                    body_b64: buf.toString(\"base64\"),\n                    byte_length: buf.length,\n                };\n            }\n\n            const picked = selectBinRef(resolved.frame, ctrl, resolved.remainder);\n            if (!picked.ref) {\n                const json = JSON.stringify({\n                    error: picked.error,\n                    via: \"hostparkinator_5000\",\n                    ib: resolved.frame?.ib || resolved.ib,\n                });\n                return {\n                    status: picked.status || 404,\n                    content_type: \"application/json\",\n                    headers: { \"X-Foobarch-ib^gib\": resolved.addr },\n                    body: json,\n                    body_b64: Buffer.from(json, \"utf8\").toString(\"base64\"),\n                };\n            }\n            const sha = picked.sha;\n            const blob = store.getBin(sha);\n            if (!blob) {\n                return {\n                    status: 404,\n                    content_type: \"text/plain\",\n                    body: \"bin missing\\n\",\n                    body_b64: \"\",\n                };\n            }\n            const ct =\n                ctrl.content_type ||\n                resolved.frame.data?.content_type ||\n                blob.content_type ||\n                \"application/octet-stream\";\n            return {\n                status: 200,\n                content_type: ct,\n                headers: { \"X-Foobarch-ib^gib\": resolved.addr, \"X-Foobarch-Bin\": sha },\n                body: blob.bytes.toString(\"utf8\"),\n                body_b64: blob.bytes.toString(\"base64\"),\n                byte_length: blob.bytes.length,\n            };\n        }\n\n        async readBody(req) {\n            const chunks = [];\n            for await (const c of req) chunks.push(c);\n            return Buffer.concat(chunks);\n        }\n\n        headerGet(headers, name) {\n            const lower = name.toLowerCase();\n            for (const [k, v] of Object.entries(headers || {})) {\n                if (String(k).toLowerCase() === lower) return v;\n            }\n            return undefined;\n        }\n\n        /**\n         * Headers to forward on proxy (classic foobarch: most headers except\n         * hop-by-hop / Accept-Encoding). Keeps X-Flowerpot-* for upstream PUT.\n         */\n        proxyForwardHeaders(headers) {\n            const skip = new Set([\n                \"host\",\n                \"connection\",\n                \"keep-alive\",\n                \"proxy-authenticate\",\n                \"proxy-authorization\",\n                \"te\",\n                \"trailers\",\n                \"transfer-encoding\",\n                \"upgrade\",\n                \"content-length\",\n                \"accept-encoding\",\n            ]);\n            /** @type {Record<string, string>} */\n            const out = {};\n            for (const [k, v] of Object.entries(headers || {})) {\n                const lk = String(k).toLowerCase();\n                if (skip.has(lk)) continue;\n                if (v == null) continue;\n                out[k] = Array.isArray(v) ? String(v[0]) : String(v);\n            }\n            return out;\n        }\n\n        /**\n         * Request headers the shell may callout on a relay use.\n         * Drops hop-by-hop, cookies, and usage tokens.\n         */\n        relayCallinHeaders(headers) {\n            const skip = new Set([\n                \"connection\",\n                \"keep-alive\",\n                \"proxy-authenticate\",\n                \"proxy-authorization\",\n                \"te\",\n                \"trailers\",\n                \"transfer-encoding\",\n                \"upgrade\",\n                \"content-length\",\n                \"cookie\",\n                \"authorization\",\n                USAGE_TOKEN_HEADER.toLowerCase(),\n                NAVI_SHELL_TOKEN_HEADER.toLowerCase(),\n            ]);\n            /** @type {Record<string, string>} */\n            const out = {};\n            for (const [k, v] of Object.entries(headers || {})) {\n                const lk = String(k).toLowerCase();\n                if (skip.has(lk)) continue;\n                if (v == null) continue;\n                out[lk] = Array.isArray(v) ? String(v[0]) : String(v);\n            }\n            return out;\n        }\n\n        /**\n         * Ordered unused usage tokens on a tip (`data.foobarch.tokens`).\n         * @param {any} frame\n         * @returns {string[]}\n         */\n        readFoobarchTokens(frame) {\n            const raw = frame?.data?.foobarch?.tokens;\n            if (!Array.isArray(raw)) return [];\n            return raw\n                .map((x) => String(x || \"\").trim())\n                .filter(Boolean);\n        }\n\n        /**\n         * Reserve tip ibs: rel8ns[\"foobarch.token_reserve\"] then data.foobarch.token_reserve.\n         * @param {any} frame\n         * @returns {string[]}\n         */\n        readTokenReserveRefs(frame) {\n            if (!frame || typeof frame !== \"object\") return [];\n            const out = [];\n            const seen = new Set();\n            const push = (raw) => {\n                const s = String(raw || \"\").trim();\n                if (!s) return;\n                const ib = s.includes(\"^\") ? s.slice(0, s.indexOf(\"^\")) : s;\n                if (!ib || seen.has(ib)) return;\n                seen.add(ib);\n                out.push(ib);\n            };\n            const rel = frame.rel8ns?.[\"foobarch.token_reserve\"];\n            if (Array.isArray(rel)) {\n                for (const r of rel) push(r);\n            } else if (rel != null) {\n                push(rel);\n            }\n            push(frame.data?.foobarch?.token_reserve);\n            return out;\n        }\n\n        /**\n         * Self-index pay: new tip must equal old tokens with head removed.\n         * @returns {{ ok: true, token: string } | { ok: false, status: number, error: string }}\n         */\n        assertSelfTokenDrop(oldFrame, newFrame) {\n            const oldToks = this.readFoobarchTokens(oldFrame);\n            if (!oldToks.length) {\n                return {\n                    ok: false,\n                    status: 402,\n                    error: \"self foobarch.tokens empty\",\n                };\n            }\n            const spent = oldToks[0];\n            const expected = oldToks.slice(1);\n            const newToks = this.readFoobarchTokens(newFrame);\n            if (newToks.length !== expected.length) {\n                return {\n                    ok: false,\n                    status: 400,\n                    error:\n                        \"self-index: new data.foobarch.tokens must drop head only\",\n                    spent,\n                    expected_len: expected.length,\n                    got_len: newToks.length,\n                };\n            }\n            for (let i = 0; i < expected.length; i++) {\n                if (newToks[i] !== expected[i]) {\n                    return {\n                        ok: false,\n                        status: 400,\n                        error:\n                            \"self-index: new data.foobarch.tokens mismatch after drop\",\n                        spent,\n                    };\n                }\n            }\n            return { ok: true, token: spent };\n        }\n\n        /**\n         * Payment for tip-advancing ops. Precedence:\n         * header → self data.foobarch.tokens → foobarch.token_reserve (2 tokens).\n         * @returns {object} payment descriptor or { ok:false, status, error }\n         */\n        resolveMutationPayment({ store, headers, existingFrame, newFrame }) {\n            const headerTok = String(\n                this.headerGet(headers, USAGE_TOKEN_HEADER) || \"\"\n            ).trim();\n            if (headerTok) {\n                const probe = store.probeToken(headerTok);\n                if (!probe.ok) {\n                    return {\n                        ok: false,\n                        status: probe.status,\n                        error: probe.error,\n                    };\n                }\n                return {\n                    ok: true,\n                    mode: \"header\",\n                    tokens: [probe.token],\n                };\n            }\n\n            if (existingFrame) {\n                const selfToks = this.readFoobarchTokens(existingFrame);\n                if (selfToks.length) {\n                    const drop = this.assertSelfTokenDrop(\n                        existingFrame,\n                        newFrame\n                    );\n                    if (!drop.ok) return drop;\n                    const probe = store.probeToken(drop.token);\n                    if (!probe.ok) {\n                        return {\n                            ok: false,\n                            status: probe.status,\n                            error: probe.error,\n                        };\n                    }\n                    return {\n                        ok: true,\n                        mode: \"self\",\n                        tokens: [probe.token],\n                    };\n                }\n            }\n\n            // Prefer newFrame reserve refs (client can retarget after remint),\n            // then existingFrame — prior tips often still point at an exhausted stash.\n            const refs = [];\n            const seen = new Set();\n            for (const ib of [\n                ...this.readTokenReserveRefs(newFrame),\n                ...this.readTokenReserveRefs(existingFrame),\n            ]) {\n                if (!ib || seen.has(ib)) continue;\n                seen.add(ib);\n                refs.push(ib);\n            }\n            for (const reserveIb of refs) {\n                const tip = store.getTip(reserveIb);\n                if (!tip || tip.tombstone || !tip.frame) continue;\n                const toks = this.readFoobarchTokens(tip.frame);\n                if (toks.length < 2) continue;\n                const p0 = store.probeToken(toks[0]);\n                const p1 = store.probeToken(toks[1]);\n                if (!p0.ok || !p1.ok) continue;\n                return {\n                    ok: true,\n                    mode: \"reserve\",\n                    tokens: [p0.token, p1.token],\n                    reserveIb,\n                    reserveAddr: tip.addr,\n                };\n            }\n\n            return {\n                ok: false,\n                status: 402,\n                error:\n                    \"no usage payment: need X-Foobarch-Usage-Token, data.foobarch.tokens, or foobarch.token_reserve (≥2)\",\n            };\n        }\n\n        /**\n         * Host-authored mut8: drop first `n` entries from reserve tip's foobarch.tokens.\n         * Does not consume global tokens (caller does).\n         */\n        hostMut8ReserveDrop(store, reserveIb, n) {\n            const tip = store.getTip(reserveIb);\n            if (!tip || tip.tombstone || !tip.frame) {\n                return {\n                    ok: false,\n                    status: 402,\n                    error: `token_reserve tip missing: ${reserveIb}`,\n                };\n            }\n            const parent = tip.frame;\n            const oldToks = this.readFoobarchTokens(parent);\n            const dropN = Math.max(0, Number(n) || 0);\n            if (oldToks.length < dropN) {\n                return {\n                    ok: false,\n                    status: 402,\n                    error: `token_reserve ${reserveIb} has ${oldToks.length} tokens; need ${dropN}`,\n                };\n            }\n            const remaining = oldToks.slice(dropN);\n            const prevFoobarch =\n                parent.data?.foobarch && typeof parent.data.foobarch === \"object\"\n                    ? { ...parent.data.foobarch }\n                    : {};\n            prevFoobarch.tokens = remaining;\n            const data = {\n                ...(parent.data && typeof parent.data === \"object\"\n                    ? parent.data\n                    : {}),\n                foobarch: prevFoobarch,\n                n: (Number(parent.data?.n) || 0) + 1,\n                timestamp: navi.stamp.time(),\n            };\n            const gib = sha256Hex(\n                Buffer.from(JSON.stringify(data), \"utf8\")\n            ).toUpperCase();\n            const head = {\n                ib: String(reserveIb),\n                gib,\n                data,\n                rel8ns: {\n                    ...(parent.rel8ns && typeof parent.rel8ns === \"object\"\n                        ? parent.rel8ns\n                        : {}),\n                    past: [tip.addr],\n                    dna: Array.isArray(parent.rel8ns?.dna)\n                        ? parent.rel8ns.dna\n                        : [],\n                    tjp: Array.isArray(parent.rel8ns?.tjp)\n                        ? parent.rel8ns.tjp\n                        : [],\n                },\n            };\n            try {\n                const result = store.persistTransform({\n                    transform: \"mut8\",\n                    newIbGib: head,\n                    dnas: [],\n                    intermediateIbGibs: [],\n                });\n                return { ok: true, addr: result.addr, head, dropped: oldToks.slice(0, dropN) };\n            } catch (err) {\n                return {\n                    ok: false,\n                    status: 500,\n                    error: err?.message || String(err),\n                };\n            }\n        }\n\n        async handleCommitPut(ib, bodyBuf, headers) {\n            let envelope;\n            try {\n                envelope = JSON.parse(bodyBuf.toString(\"utf8\"));\n            } catch {\n                return {\n                    status: 400,\n                    body: JSON.stringify({\n                        error: \"commit body must be JSON commit envelope\",\n                    }),\n                    type: \"application/json\",\n                };\n            }\n\n            const store = this.ensureStore();\n            const existing = store.getTip(ib);\n            const existingFrame =\n                existing && !existing.tombstone ? existing.frame : null;\n            const payment = this.resolveMutationPayment({\n                store,\n                headers,\n                existingFrame,\n                newFrame: envelope?.newIbGib,\n            });\n            if (!payment.ok) {\n                return {\n                    status: payment.status || 401,\n                    body: JSON.stringify({\n                        error: payment.error || \"usage payment required\",\n                        spent: payment.spent,\n                        expected_len: payment.expected_len,\n                        got_len: payment.got_len,\n                    }),\n                    type: \"application/json\",\n                };\n            }\n\n            return await this.applyCommitEnvelope(\n                ib,\n                envelope,\n                bodyBuf,\n                headers,\n                payment\n            );\n        }\n\n        /**\n         * Soft-delete tip: empty body → auto mut8 tombstone (open tips only);\n         * non-empty body → treat as commit envelope (keys tips send signed tombstone).\n         */\n        async handleTombstone(ib, bodyBuf, headers) {\n            if (bodyBuf && bodyBuf.length) {\n                return await this.handleCommitPut(ib, bodyBuf, headers);\n            }\n\n            if (this.isRelayParkIb(ib)) return this.relayParkWriteForbidden(ib);\n            const store = this.ensureStore();\n            const existing = store.getTip(ib);\n            if (!existing || existing.tombstone || !existing.frame) {\n                return {\n                    status: 404,\n                    body: JSON.stringify({ error: `no tip to tombstone: ${ib}` }),\n                    type: \"application/json\",\n                };\n            }\n\n            if (isWriteGated(existing.frame)) {\n                return {\n                    status: 405,\n                    body: JSON.stringify({\n                        error:\n                            \"gated tip: DELETE with empty body not allowed; send signed tombstone commit envelope as body, tip http.DELETE proxy, or /foobarch/admin/delete/{ib}\",\n                    }),\n                    type: \"application/json\",\n                };\n            }\n\n            const parent = existing.frame;\n            const n = Number(parent.data?.n) || 0;\n            const selfToks = this.readFoobarchTokens(parent);\n            const headerTok = String(\n                this.headerGet(headers, USAGE_TOKEN_HEADER) || \"\"\n            ).trim();\n            // Host-authored tombstone: if paying via self-index, drop head token here.\n            let foobarch = parent.data?.foobarch;\n            if (\n                !headerTok &&\n                selfToks.length &&\n                foobarch &&\n                typeof foobarch === \"object\"\n            ) {\n                foobarch = { ...foobarch, tokens: selfToks.slice(1) };\n            }\n            const data = {\n                ...(parent.data && typeof parent.data === \"object\" ? parent.data : {}),\n                ...(foobarch ? { foobarch } : {}),\n                tombstone: true,\n                n: n + 1,\n                timestamp: navi.stamp.time(),\n            };\n            const gib = sha256Hex(\n                Buffer.from(JSON.stringify(data), \"utf8\")\n            ).toUpperCase();\n            const head = {\n                ib: String(ib),\n                gib,\n                data,\n                rel8ns: {\n                    ...(parent.rel8ns && typeof parent.rel8ns === \"object\"\n                        ? parent.rel8ns\n                        : {}),\n                    past: [existing.addr],\n                    dna: Array.isArray(parent.rel8ns?.dna) ? parent.rel8ns.dna : [],\n                    tjp: Array.isArray(parent.rel8ns?.tjp) ? parent.rel8ns.tjp : [],\n                },\n            };\n            const envelope = {\n                transform: \"mut8\",\n                newIbGib: head,\n                dnas: [],\n                intermediateIbGibs: [],\n            };\n            const body = Buffer.from(JSON.stringify(envelope), \"utf8\");\n            const payment = this.resolveMutationPayment({\n                store,\n                headers,\n                existingFrame: parent,\n                newFrame: head,\n            });\n            if (!payment.ok) {\n                return {\n                    status: payment.status || 401,\n                    body: JSON.stringify({\n                        error: payment.error || \"usage payment required\",\n                    }),\n                    type: \"application/json\",\n                };\n            }\n            return await this.applyCommitEnvelope(\n                ib,\n                envelope,\n                body,\n                headers,\n                payment\n            );\n        }\n\n        /**\n         * @param {object|null} payment — from resolveMutationPayment; null when opts.relay\n         */\n        async applyCommitEnvelope(ib, envelope, bodyBuf, headers, payment, opts = {}) {\n            const store = this.ensureStore();\n            const relay = !!opts.relay;\n            const relayUuid = String(opts.relayUuid || \"\").trim();\n            const transform = String(envelope.transform || \"\").trim();\n            const head = envelope.newIbGib;\n            if (!head || head.ib == null || head.gib == null) {\n                return {\n                    status: 400,\n                    body: JSON.stringify({ error: \"newIbGib.ib/gib required\" }),\n                    type: \"application/json\",\n                };\n            }\n            if (String(head.ib) !== String(ib)) {\n                return {\n                    status: 400,\n                    body: JSON.stringify({\n                        error: `newIbGib.ib (${head.ib}) must match route (${ib})`,\n                    }),\n                    type: \"application/json\",\n                };\n            }\n            if (!relay && this.isRelayParkIb(ib)) {\n                return this.relayParkWriteForbidden(ib);\n            }\n\n            if (!relay) {\n                if (!payment || !payment.ok || !Array.isArray(payment.tokens)) {\n                    return {\n                        status: 401,\n                        body: JSON.stringify({\n                            error: \"usage payment required for mutation\",\n                        }),\n                        type: \"application/json\",\n                    };\n                }\n            }\n\n            const existing = store.getTip(ib);\n            if (existing?.tombstone) {\n                // treat as open first write after tombstone\n            }\n\n            if (!existing || existing.tombstone) {\n                if (transform && transform !== \"firstGen\") {\n                    return {\n                        status: 400,\n                        body: JSON.stringify({\n                            error: \"first write requires transform firstGen\",\n                        }),\n                        type: \"application/json\",\n                    };\n                }\n                const gate = relay ? null : genesisGateFor(store, ib);\n                if (gate) {\n                    const auth = authorizeWrite(store, null, {\n                        ib,\n                        parentAddr: \"\",\n                        body: bodyBuf,\n                        headers,\n                        policyAddr: gate.policyAddr,\n                        fn: \"authorize_genesis\",\n                        transform: \"firstGen\",\n                        parkRequest: this.makeParkRequestController({\n                            deadline: Date.now() + SCHEMA_TIMEOUT_MS,\n                            headers,\n                        }),\n                    });\n                    if (!auth.allow) {\n                        return {\n                            status: 401,\n                            body: JSON.stringify({\n                                error: auth.error || \"unauthorized\",\n                                hint: `firstGen under '${gate.governor}' is gated by its genesis_policy`,\n                                governor: gate.governor,\n                                via: auth.via,\n                                policyAddr: auth.policyAddr,\n                                schemaAddr: auth.schemaAddr,\n                            }),\n                            type: \"application/json\",\n                        };\n                    }\n                }\n            } else {\n                if (transform && transform !== \"mut8\" && transform !== \"rel8\") {\n                    // allow omit; still require past link\n                }\n                const past = head.rel8ns?.past;\n                const parentAddr = existing.addr;\n                const linked =\n                    Array.isArray(past) && past.map(String).includes(parentAddr);\n                if (!linked) {\n                    return {\n                        status: 400,\n                        body: JSON.stringify({\n                            error: \"mut8 commit must rel8ns.past include parent tip addr\",\n                            parentAddr,\n                        }),\n                        type: \"application/json\",\n                    };\n                }\n                const auth = authorizeWrite(store, existing.frame, {\n                    ib,\n                    parentAddr,\n                    body: bodyBuf,\n                    headers,\n                    parkRequest: this.makeParkRequestController({\n                        deadline: Date.now() + SCHEMA_TIMEOUT_MS,\n                        headers,\n                    }),\n                });\n                if (!relay && !auth.allow) {\n                    return {\n                        status: 401,\n                        body: JSON.stringify({\n                            error: auth.error || \"unauthorized\",\n                            hint:\n                                \"Satisfy schema/policy signatures (proposal-write-v1) or use /foobarch/admin\",\n                            valid: auth.valid,\n                            threshold: auth.threshold,\n                            via: auth.via,\n                            policyAddr: auth.policyAddr,\n                            schemaAddr: auth.schemaAddr,\n                        }),\n                        type: \"application/json\",\n                    };\n                }\n                if (relay) {\n                    const owner = this.relayParkOwnerUuid(existing.frame);\n                    const expired = this.isRelayFrameExpired(existing.frame);\n                    // Soft-expire is only a callin gate. Same uuid may always\n                    // renew; any connected shell may reclaim an expired park.\n                    if (owner && owner !== relayUuid && !expired) {\n                        return {\n                            status: 403,\n                            body: JSON.stringify({\n                                error: \"relay commit: uuid does not own this park\",\n                            }),\n                            type: \"application/json\",\n                        };\n                    }\n                }\n            }\n\n            let result;\n            try {\n                result = store.persistTransform(envelope);\n            } catch (err) {\n                const msg = err.message || String(err);\n                const conflict = String(msg).includes(\"cannot gate\");\n                return {\n                    status: conflict ? 409 : 500,\n                    body: JSON.stringify({ error: msg }),\n                    type: \"application/json\",\n                };\n            }\n\n            let reserveAddr = null;\n            if (!relay && payment) {\n                if (payment.mode === \"reserve\") {\n                    const dropped = this.hostMut8ReserveDrop(\n                        store,\n                        payment.reserveIb,\n                        2\n                    );\n                    if (!dropped.ok) {\n                        return {\n                            status: dropped.status || 500,\n                            body: JSON.stringify({\n                                error: dropped.error || \"token_reserve mut8 failed\",\n                                content_addr: result.addr,\n                                hint:\n                                    \"content tip advanced but reserve index was not updated\",\n                            }),\n                            type: \"application/json\",\n                        };\n                    }\n                    reserveAddr = dropped.addr;\n                    const c0 = store.consumeToken(\n                        payment.tokens[0],\n                        dropped.addr\n                    );\n                    const c1 = store.consumeToken(\n                        payment.tokens[1],\n                        result.addr\n                    );\n                    if (!c0.ok || !c1.ok) {\n                        return {\n                            status: (!c0.ok ? c0.status : c1.status) || 403,\n                            body: JSON.stringify({\n                                error:\n                                    (!c0.ok ? c0.error : c1.error) ||\n                                    \"usage token consume failed\",\n                                content_addr: result.addr,\n                                reserve_addr: reserveAddr,\n                            }),\n                            type: \"application/json\",\n                        };\n                    }\n                } else {\n                    for (const tok of payment.tokens) {\n                        const consumed = store.consumeToken(tok, result.addr);\n                        if (!consumed.ok) {\n                            return {\n                                status: consumed.status,\n                                body: JSON.stringify({ error: consumed.error }),\n                                type: \"application/json\",\n                            };\n                        }\n                    }\n                }\n            }\n\n            const bodyObj = {\n                status: \"ok\",\n                transform: transform || (existing ? \"mut8\" : \"firstGen\"),\n                ib,\n                addr: result.addr,\n                park: !!head?.data?.park,\n                addrs: result.addrs,\n            };\n            if (payment?.mode) bodyObj.payment = payment.mode;\n            if (reserveAddr) {\n                bodyObj.reserve_ib = payment.reserveIb;\n                bodyObj.reserve_addr = reserveAddr;\n            }\n\n            return {\n                status: existing && !existing.tombstone ? 200 : 201,\n                body: JSON.stringify(bodyObj),\n                type: \"application/json\",\n                headers: { \"X-Foobarch-ib^gib\": result.addr },\n            };\n        }\n\n        async handleGetPayload(resolved, method, opts = {}) {\n            const store = this.ensureStore();\n            const frame = resolved.frame;\n            if (!frame) {\n                return { status: 404, body: \"not found\\n\", type: \"text/plain\" };\n            }\n            const unavailable = this.relayFrameUnavailable(resolved);\n            if (unavailable) {\n                return this.relayParkGoneResponse(unavailable, false);\n            }\n\n            const methodU = String(method || \"GET\").toUpperCase();\n            const accept = this.headerGet(opts.headers, \"accept\");\n            if (\n                (methodU === \"GET\" || methodU === \"HEAD\") &&\n                this.wantsFrameSnapshot(accept)\n            ) {\n                const shas = this.snapshotBinShas(frame, opts.headers);\n                if (shas.length) {\n                    return this.buildFrameSnapshot(resolved, store, shas, methodU);\n                }\n                const json = JSON.stringify(frame, null, 2);\n                return {\n                    status: 200,\n                    body: methodU === \"HEAD\" ? \"\" : json,\n                    type: \"application/eframe; charset=utf-8\",\n                    headers: { \"X-Foobarch-ib^gib\": resolved.addr, \"X-Foobarch-Bins\": \"\" },\n                };\n            }\n            if (\n                (methodU === \"GET\" || methodU === \"HEAD\") &&\n                this.wantsIbGibFrame(accept)\n            ) {\n                const json = JSON.stringify(frame, null, 2);\n                return {\n                    status: 200,\n                    body: methodU === \"HEAD\" ? \"\" : json,\n                    type: \"application/eframe; charset=utf-8\",\n                    headers: { \"X-Foobarch-ib^gib\": resolved.addr },\n                };\n            }\n\n            const ctrl = this.httpControl(frame, methodU === \"HEAD\" ? \"GET\" : methodU);\n            if (!ctrl) {\n                return {\n                    status: 405,\n                    body: JSON.stringify({ error: `no http control for ${method}` }),\n                    type: \"application/json\",\n                };\n            }\n\n            const kind = String(ctrl.kind || \"bin\").toLowerCase();\n\n            if (kind === \"navi_shell\") {\n                if (\n                    methodU !== \"POST\" &&\n                    methodU !== \"GET\" &&\n                    methodU !== \"HEAD\"\n                ) {\n                    return {\n                        status: 405,\n                        body: JSON.stringify({\n                            error: \"navi_shell parks are GET or POST only\",\n                        }),\n                        type: \"application/json\",\n                    };\n                }\n                const token =\n                    this.headerGet(opts.headers, NAVI_SHELL_TOKEN_HEADER) ||\n                    this.headerGet(opts.headers, USAGE_TOKEN_HEADER);\n                const relayAlias = String(frame.ib || \"\").replace(/^navi-/i, \"\");\n                const aliasSha = this.relayAliasTokenSha(frame);\n                if (aliasSha && !this.relayAliasTokenOk(aliasSha, token)) {\n                    return this.relayErrorResponse(401, \"bad relay alias token\", {\n                        via: \"hostparkinator_5000\",\n                        alias: relayAlias,\n                        header: NAVI_SHELL_TOKEN_HEADER,\n                    });\n                }\n                const uuid = String(\n                    ctrl.target || frame.data?.navi_shell_uuid || \"\"\n                ).trim();\n                if (!uuid) {\n                    return {\n                        status: 500,\n                        body: JSON.stringify({\n                            error: \"navi_shell control missing target uuid\",\n                        }),\n                        type: \"application/json\",\n                    };\n                }\n                const bodyStr =\n                    methodU === \"GET\" || methodU === \"HEAD\"\n                        ? \"\"\n                        : opts.bodyBuf && opts.bodyBuf.length\n                          ? Buffer.from(opts.bodyBuf).toString(\"utf8\")\n                          : \"\";\n                const relay = await this.relayNaviShellCallin(\n                    uuid,\n                    token,\n                    resolved.remainder || \"\",\n                    bodyStr,\n                    {\n                        method: methodU,\n                        path: opts.path || \"\",\n                        headers: opts.headers || {},\n                        alias: relayAlias,\n                        aliasSha,\n                    }\n                );\n                if (methodU === \"HEAD\" && relay.status >= 200 && relay.status < 300) {\n                    return { ...relay, body: \"\" };\n                }\n                return relay;\n            }\n\n            if (kind === \"frame\" || kind === \"manifest\") {\n                const json = JSON.stringify(frame, null, 2);\n                return {\n                    status: 200,\n                    body: methodU === \"HEAD\" ? \"\" : json,\n                    type: \"application/eframe; charset=utf-8\",\n                    headers: { \"X-Foobarch-ib^gib\": resolved.addr },\n                };\n            }\n\n            if (kind === \"relay\") {\n                // Front door to a navi relayed by this host: target = alias, path = park\n                // path inside that navi. Internal dispatch keeps the caller's headers\n                // (X-Forwarded-For etc.) that an HTTP hop through the front proxy would drop.\n                const alias = String(ctrl.target || frame.data?.relay_alias || \"\")\n                    .trim()\n                    .replace(/^navi-/i, \"\");\n                if (!/^[a-zA-Z0-9._-]+$/.test(alias)) {\n                    return {\n                        status: 500,\n                        body: JSON.stringify({ error: \"relay control needs target alias ([a-zA-Z0-9._-]+)\" }),\n                        type: \"application/json\",\n                    };\n                }\n                const hops = Number(opts.redirectHops) || 0;\n                if (hops >= 8) {\n                    return {\n                        status: 508,\n                        body: JSON.stringify({ error: \"relay hop limit exceeded\", hops }),\n                        type: \"application/json\",\n                    };\n                }\n                const sub = String(ctrl.path || frame.data?.relay_path || \"\").replace(/^\\/+|\\/+$/g, \"\");\n                const rem = String(resolved.remainder || \"\").replace(/^\\/+/, \"\");\n                const relayPath = [`/navi-${alias}`, sub, rem].filter(Boolean).join(\"/\");\n                const result = await this.dispatch({\n                    method,\n                    url: relayPath + (opts.search || \"\"),\n                    headers: opts.headers || {},\n                    bodyBuf: opts.bodyBuf || Buffer.alloc(0),\n                    internal: true,\n                    redirectHops: hops + 1,\n                });\n                return {\n                    ...result,\n                    headers: { ...(result.headers || {}), \"X-Foobarch-Relay\": relayPath },\n                };\n            }\n\n            if (kind === \"proxy\") {\n                const target = String(ctrl.target || frame.data?.proxy_target || \"\");\n                if (!target) {\n                    return {\n                        status: 500,\n                        body: JSON.stringify({ error: \"proxy control missing target\" }),\n                        type: \"application/json\",\n                    };\n                }\n                let url = target;\n                if (resolved.remainder) {\n                    const rem = resolved.remainder.replace(/^\\/+/, \"\");\n                    url = target.replace(/\\/+$/, \"\") + \"/\" + rem;\n                }\n                if (opts.search) url += opts.search;\n                try {\n                    /** @type {RequestInit} */\n                    const init = {\n                        method: method === \"HEAD\" ? \"GET\" : method,\n                        headers: this.proxyForwardHeaders(opts.headers || {}),\n                    };\n                    if (\n                        method !== \"GET\" &&\n                        method !== \"HEAD\" &&\n                        opts.bodyBuf &&\n                        opts.bodyBuf.length\n                    ) {\n                        init.body = opts.bodyBuf;\n                    }\n                    const res = await fetch(url, init);\n                    const buf = Buffer.from(await res.arrayBuffer());\n                    const ct =\n                        res.headers.get(\"content-type\") || \"application/octet-stream\";\n                    /** @type {Record<string, string>} */\n                    const outHdrs = { \"X-Foobarch-Proxy\": url };\n                    // Surface useful upstream X-* (e.g. x-flowerpot-ib^gib).\n                    res.headers.forEach((v, k) => {\n                        const lk = String(k).toLowerCase();\n                        if (lk.startsWith(\"x-\") && lk !== \"x-foobarch-proxy\") {\n                            outHdrs[k] = v;\n                        }\n                    });\n                    return {\n                        status: res.status,\n                        body: method === \"HEAD\" ? \"\" : buf,\n                        type: ct,\n                        headers: outHdrs,\n                    };\n                } catch (err) {\n                    return {\n                        status: 502,\n                        body: JSON.stringify({ error: err.message || String(err) }),\n                        type: \"application/json\",\n                    };\n                }\n            }\n\n            if (kind === \"redirect\") {\n                // Internal redispatch: target is a route ib (same as URL path after\n                // host). Leading \"/\" optional — both \"flowerpot\" and \"/flowerpot\"\n                // go through pathToIb / resolveRoute like any other request.\n                const hops = Number(opts.redirectHops) || 0;\n                const maxHops = 8;\n                if (hops >= maxHops) {\n                    return {\n                        status: 508,\n                        body: JSON.stringify({\n                            error: \"redirect hop limit exceeded\",\n                            hops,\n                        }),\n                        type: \"application/json\",\n                    };\n                }\n                const target = String(\n                    ctrl.target || frame.data?.redirect_target || \"\"\n                ).trim();\n                if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) {\n                    return {\n                        status: 500,\n                        body: JSON.stringify({\n                            error:\n                                \"redirect target must be a route ib/path (not an absolute URL)\",\n                        }),\n                        type: \"application/json\",\n                    };\n                }\n                // Same join as proxy keep: target ib + \"/\" + remainder (if any).\n                let ibPath = this.pathToIb(target);\n                if (resolved.remainder) {\n                    const rem = String(resolved.remainder).replace(/^\\/+/, \"\");\n                    ibPath = ibPath\n                        ? ibPath.replace(/\\/+$/, \"\") + \"/\" + rem\n                        : rem;\n                }\n                const path = \"/\" + ibPath;\n                const nextUrl = path + (opts.search || \"\");\n                const result = await this.dispatch({\n                    method,\n                    url: nextUrl,\n                    headers: opts.headers || {},\n                    bodyBuf: opts.bodyBuf || Buffer.alloc(0),\n                    internal: true,\n                    redirectHops: hops + 1,\n                });\n                return {\n                    ...result,\n                    headers: {\n                        ...(result.headers || {}),\n                        \"X-Foobarch-Redirect\": path,\n                    },\n                };\n            }\n\n            if (kind === \"lua\") {\n                const store = this.ensureStore();\n                const script = resolveLuaScriptSource(store, ctrl, resolved.addr);\n                if (!script.source) {\n                    return {\n                        status: 500,\n                        body: JSON.stringify({\n                            error: script.error || \"lua script missing\",\n                        }),\n                        type: \"application/json\",\n                    };\n                }\n                const deadline = Date.now() + LUA_TIMEOUT_MS;\n                const parkRequest = this.makeParkRequestController({\n                    deadline,\n                    headers: opts.headers || {},\n                    hops: Number(opts.luaHops) || 0,\n                });\n                /** @type {Record<string, string>} */\n                const hdrs = {};\n                for (const [k, v] of Object.entries(opts.headers || {})) {\n                    hdrs[String(k).toLowerCase()] = Array.isArray(v)\n                        ? String(v[0])\n                        : String(v);\n                }\n                const reqCtx = {\n                    method: method === \"HEAD\" ? \"GET\" : method,\n                    path: \"/\" + (resolved.ib || resolved.frame?.ib || \"\"),\n                    remainder: resolved.remainder || \"\",\n                    search: opts.search || \"\",\n                    headers: hdrs,\n                    tip: {\n                        ib: frame.ib,\n                        addr: resolved.addr,\n                        data: frame.data || {},\n                        rel8ns: frame.rel8ns || {},\n                    },\n                    script_addr: script.scriptAddr,\n                };\n                const run = runLuaHandle(store, script.source, reqCtx, {\n                    bodyBuf: opts.bodyBuf || Buffer.alloc(0),\n                    parkRequest,\n                    timeoutMs: LUA_TIMEOUT_MS,\n                });\n                if (!run.ok) {\n                    return {\n                        status: run.status || 500,\n                        body: JSON.stringify({ error: run.error }),\n                        type: \"application/json\",\n                    };\n                }\n                return mapLuaHttpResult(store, run.result, method);\n            }\n\n            // kind=mod + Accept application/navi-mod → multipart eframe + bin\n            if (kind === \"mod\" && this.wantsNaviModPackage(accept)) {\n                return this.buildNaviModPackage(resolved, store);\n            }\n\n            const picked = selectBinRef(frame, ctrl, resolved.remainder);\n            if (!picked.ref) {\n                return {\n                    status: picked.status || 404,\n                    body: JSON.stringify({\n                        error: picked.error,\n                        via: \"hostparkinator_5000\",\n                        ib: frame?.ib || resolved.ib,\n                    }),\n                    type: \"application/json\",\n                    headers: { \"X-Foobarch-ib^gib\": resolved.addr },\n                };\n            }\n            const sha = picked.sha;\n            const blob = store.getBin(sha);\n            if (!blob) {\n                return { status: 404, body: \"bin missing\\n\", type: \"text/plain\" };\n            }\n            const ct =\n                ctrl.content_type ||\n                frame.data?.content_type ||\n                blob.content_type ||\n                \"application/octet-stream\";\n            return {\n                status: 200,\n                body: method === \"HEAD\" ? \"\" : blob.bytes,\n                type: ct,\n                headers: { \"X-Foobarch-ib^gib\": resolved.addr, \"X-Foobarch-Bin\": sha },\n            };\n        }\n\n        async handleFoobarchApi(method, pathname, headers, bodyBuf, requestUrl) {\n            const store = this.ensureStore();\n            const parts = pathname.replace(/^\\/+/, \"\").split(\"/\").filter(Boolean);\n            // parts[0] === foobarch\n            const op = parts[1] || \"\";\n            let searchIb = \"\";\n            let searchAddr = \"\";\n            try {\n                const u = new URL(requestUrl || \"/\", \"http://local\");\n                searchIb = u.searchParams.get(\"ib\") || \"\";\n                searchAddr = u.searchParams.get(\"addr\") || \"\";\n            } catch {\n                /* ignore */\n            }\n\n            // tip/frame/span serve the same frames as their parks; same read gate.\n            const readDenied = (tipOrFrame) => {\n                const tipFrame = tipOrFrame?.frame || tipOrFrame;\n                if (!tipFrame) return null;\n                const auth = authorizeAccess(store, tipFrame, {\n                    ib: tipFrame.ib,\n                    method: \"GET\",\n                    headers,\n                    body: Buffer.alloc(0),\n                });\n                if (auth.allow) return null;\n                return {\n                    status: auth.aside_ok === false ? 403 : 401,\n                    body: JSON.stringify({\n                        error: auth.error || \"read unauthorized\",\n                        via: auth.via,\n                        policyAddr: auth.policyAddr,\n                    }),\n                    type: \"application/json\",\n                };\n            };\n\n            if (op === \"tokens\") {\n                if (method !== \"POST\") {\n                    return { status: 405, body: \"POST only\\n\", type: \"text/plain\" };\n                }\n                const pwd = this.headerGet(headers, USAGE_PASSWORD_HEADER);\n                if (pwd !== this.usagePassword()) {\n                    return { status: 401, body: \"bad password\\n\", type: \"text/plain\" };\n                }\n                let count = 1;\n                try {\n                    const j = JSON.parse(bodyBuf.toString(\"utf8\") || \"{}\");\n                    count = Math.min(100, Math.max(1, Number(j.count) || 1));\n                } catch {\n                    count = 1;\n                }\n                const tokens = store.mintTokens(count);\n                return {\n                    status: 200,\n                    body: JSON.stringify({ tokens }),\n                    type: \"application/json\",\n                };\n            }\n\n            if (op === \"list\") {\n                if (method !== \"GET\") {\n                    return { status: 405, body: \"GET only\\n\", type: \"text/plain\" };\n                }\n                const pwd = this.headerGet(headers, USAGE_PASSWORD_HEADER);\n                if (pwd !== this.usagePassword()) {\n                    return {\n                        status: 401,\n                        body: \"list requires usage password\\n\",\n                        type: \"text/plain\",\n                    };\n                }\n                return {\n                    status: 200,\n                    body: JSON.stringify({ tips: store.listTips(500, 0) }, null, 2),\n                    type: \"application/json\",\n                };\n            }\n\n            if (op === \"tip\") {\n                if (method !== \"GET\") {\n                    return { status: 405, body: \"GET only\\n\", type: \"text/plain\" };\n                }\n                let ib = parts.slice(2).join(\"/\");\n                if (!ib) ib = searchIb;\n                const tip = store.getTip(ib);\n                if (!tip) {\n                    return { status: 404, body: \"no tip\\n\", type: \"text/plain\" };\n                }\n                const denied = readDenied(tip);\n                if (denied) return denied;\n                // ?data.<path>=<value> → newest frame on this ib whose data matches (any chain).\n                const where = {};\n                try {\n                    const u = new URL(requestUrl || \"/\", \"http://local\");\n                    for (const [k, v] of u.searchParams) {\n                        if (k.startsWith(\"data.\") && k.length > 5) where[k.slice(5)] = v;\n                    }\n                } catch {\n                    /* ignore */\n                }\n                if (Object.keys(where).length) {\n                    const hit = store.latestVersionWhere(tip.ib, where);\n                    if (!hit) {\n                        return { status: 404, body: \"no frame on this ib matches\\n\", type: \"text/plain\" };\n                    }\n                    return {\n                        status: 200,\n                        body: JSON.stringify(\n                            { ...hit, tombstone: tip.tombstone, latest: hit.addr === tip.addr, where },\n                            null,\n                            2\n                        ),\n                        type: \"application/eframe; charset=utf-8\",\n                    };\n                }\n                return {\n                    status: 200,\n                    body: JSON.stringify(tip, null, 2),\n                    type: \"application/eframe; charset=utf-8\",\n                };\n            }\n\n            if (op === \"frame\") {\n                if (method !== \"GET\") {\n                    return { status: 405, body: \"GET only\\n\", type: \"text/plain\" };\n                }\n                const addr = parts.slice(2).join(\"/\") || searchAddr;\n                const frame = store.getFrame(addr);\n                if (!frame) {\n                    return { status: 404, body: \"no frame\\n\", type: \"text/plain\" };\n                }\n                const denied = readDenied((frame.ib && store.getTip(frame.ib)) || frame);\n                if (denied) return denied;\n                return {\n                    status: 200,\n                    body: JSON.stringify(frame, null, 2),\n                    type: \"application/eframe; charset=utf-8\",\n                };\n            }\n\n            if (op === \"span\") {\n                if (method !== \"GET\") {\n                    return { status: 405, body: \"GET only\\n\", type: \"text/plain\" };\n                }\n                let ib = parts.slice(2).join(\"/\");\n                if (!ib) ib = searchIb;\n                const tip = store.getTip(ib);\n                if (!tip) {\n                    return { status: 404, body: \"no tip\\n\", type: \"text/plain\" };\n                }\n                const denied = readDenied(tip);\n                if (denied) return denied;\n                let dir = \"reverse\";\n                let limit;\n                let offset = 0;\n                let addrsOnly = false;\n                try {\n                    const u = new URL(requestUrl || \"/\", \"http://local\");\n                    dir = u.searchParams.get(\"dir\") || dir;\n                    if (u.searchParams.has(\"limit\")) {\n                        limit = Number(u.searchParams.get(\"limit\"));\n                    }\n                    if (u.searchParams.has(\"offset\")) {\n                        offset = Number(u.searchParams.get(\"offset\"));\n                    }\n                    const ao = u.searchParams.get(\"addrsOnly\");\n                    addrsOnly = ao === \"1\" || ao === \"true\";\n                } catch {\n                    /* ignore */\n                }\n                // Only a bounded reverse span can stop early (forward starts at the root).\n                const walkMax =\n                    normalizeSpanDir(dir) === \"reverse\" && Number.isFinite(limit)\n                        ? Math.max(0, Math.floor(Number(offset) || 0)) +\n                          Math.max(0, Math.floor(limit))\n                        : undefined;\n                const chain = store.walkLineage(ib, walkMax);\n                const hits = orderSpanHits(chain, { dir, limit, offset });\n                const payload = {\n                    ib,\n                    dir: normalizeSpanDir(dir),\n                    hits: addrsOnly ? hits.map((h) => h.addr) : hits,\n                };\n                return {\n                    status: 200,\n                    body: JSON.stringify(payload, null, 2),\n                    type: \"application/json\",\n                };\n            }\n\n            if (op === \"admin\") {\n                const pwd = this.headerGet(headers, USAGE_PASSWORD_HEADER);\n                if (pwd !== this.usagePassword()) {\n                    return { status: 401, body: \"admin requires usage password\\n\", type: \"text/plain\" };\n                }\n                const action = parts[2] || \"\";\n                if (action === \"delete\" && method === \"DELETE\") {\n                    const ib = parts.slice(3).join(\"/\");\n                    const r = store.hardDeleteIb(ib);\n                    return {\n                        status: 200,\n                        body: JSON.stringify(r),\n                        type: \"application/json\",\n                    };\n                }\n                if ((action === \"frame\" || action === \"bin\") && method === \"DELETE\") {\n                    const key = parts\n                        .slice(3)\n                        .map((s) => {\n                            try {\n                                return decodeURIComponent(s);\n                            } catch {\n                                return s;\n                            }\n                        })\n                        .join(\"/\");\n                    const r = action === \"frame\" ? store.purgeFrame(key) : store.purgeBin(key);\n                    return {\n                        status: 200,\n                        body: JSON.stringify(r),\n                        type: \"application/json\",\n                    };\n                }\n                if (action === \"reindex\" && method === \"POST\") {\n                    const n = store.reindexParks();\n                    return {\n                        status: 200,\n                        body: JSON.stringify({ reindexed: n }),\n                        type: \"application/json\",\n                    };\n                }\n                if (action === \"password\" && method === \"PUT\") {\n                    let pwdNew = \"\";\n                    try {\n                        pwdNew = String(JSON.parse(bodyBuf.toString(\"utf8\")).password || \"\");\n                    } catch {\n                        pwdNew = bodyBuf.toString(\"utf8\").trim();\n                    }\n                    this.setUsagePassword(pwdNew);\n                    return {\n                        status: 200,\n                        body: JSON.stringify({ ok: true }),\n                        type: \"application/json\",\n                    };\n                }\n                return {\n                    status: 400,\n                    body: JSON.stringify({\n                        error: \"admin actions: DELETE /foobarch/admin/delete/{ib}, DELETE /foobarch/admin/frame/{addr}, DELETE /foobarch/admin/bin/{sha256}, POST /foobarch/admin/reindex, PUT /foobarch/admin/password\",\n                    }),\n                    type: \"application/json\",\n                };\n            }\n\n            return {\n                status: 404,\n                body: JSON.stringify({\n                    error: \"foobarch api\",\n                    routes: [\n                        \"POST /foobarch/tokens\",\n                        \"GET /foobarch/list (usage password)\",\n                        \"GET /foobarch/tip/{ib}\",\n                        \"GET /foobarch/tip/{ib}?data.{path}={value} (newest frame on ib whose data matches, any chain)\",\n                        \"GET /foobarch/frame/{addr}\",\n                        \"GET /foobarch/span/{ib}?dir=reverse|forward|all&limit=&offset=&addrsOnly=\",\n                        \"DELETE /foobarch/admin/delete/{ib}\",\n                        \"DELETE /foobarch/admin/frame/{addr}\",\n                        \"DELETE /foobarch/admin/bin/{sha256}\",\n                        \"POST /foobarch/admin/reindex\",\n                        \"PUT /foobarch/admin/password\",\n                    ],\n                }),\n                type: \"application/json\",\n            };\n        }\n\n        async dispatch(reqLike) {\n            const method = String(reqLike.method || \"GET\").toUpperCase();\n            const url = new URL(reqLike.url || \"/\", \"http://local\");\n            const pathname = this.normalizePath(url.pathname);\n            const headers = reqLike.headers || {};\n            const outHeaders = {};\n            this._lastReqHost = String(\n                this.headerGet(headers, \"x-forwarded-host\") ||\n                    this.headerGet(headers, \"host\") ||\n                    \"\"\n            )\n                .split(\",\")[0]\n                .trim()\n                .toLowerCase();\n\n            if (method === \"OPTIONS\") {\n                return {\n                    status: 204,\n                    body: \"\",\n                    type: \"text/plain\",\n                    headers: {\n                        \"Access-Control-Allow-Origin\": \"*\",\n                        \"Access-Control-Allow-Headers\":\n                            \"Content-Type, X-Foobarch-Usage-Token, X-Foobarch-Usage-Password, X-Foobarch-Sign-Keys, X-Foobarch-Signatures, X-Foobarch-Read-Timestamp, X-Flowerpot-Sign-Keys, X-Flowerpot-Signatures, X-Flowerpot-Read-Timestamp, X-Flowerpot-Usage-Password, X-Flowerpot-Usage-Token, X-Navi-Shell-Usage-Token, X-Navi-Shell-Wait, X-Navi-Gate-Passthru\",\n                        \"Access-Control-Allow-Methods\":\n                            \"GET, HEAD, POST, PUT, PATCH, DELETE, QUERY, OPTIONS\",\n                    },\n                };\n            }\n\n            if (pathname === \"/\" || pathname === \"\") {\n                if (!reqLike.internal && this.isBrowserRequest(reqLike)) {\n                    return {\n                        status: 200,\n                        body: this.shellHtml(\"\"),\n                        type: \"text/html; charset=utf-8\",\n                    };\n                }\n                return {\n                    status: 200,\n                    body: \"Foobarch Host (ibgib-native) — GET /foobarch/list (password)\\n\",\n                    type: \"text/plain\",\n                };\n            }\n\n            if (pathname === \"/_foobarch/frame\" || pathname.startsWith(\"/_foobarch/frame\")) {\n                const addr = url.searchParams.get(\"addr\") || \"\";\n                const store = this.ensureStore();\n                const frame = store.getFrame(addr);\n                if (!frame) {\n                    return { status: 404, body: \"no frame\\n\", type: \"text/plain\" };\n                }\n                const gate = (frame.ib && store.getTip(frame.ib)?.frame) || frame;\n                const auth = authorizeAccess(store, gate, {\n                    ib: gate.ib,\n                    method: \"GET\",\n                    headers,\n                    body: Buffer.alloc(0),\n                });\n                if (!auth.allow) {\n                    return {\n                        status: auth.aside_ok === false ? 403 : 401,\n                        body: JSON.stringify({ error: auth.error || \"read unauthorized\", via: auth.via }),\n                        type: \"application/json\",\n                    };\n                }\n                return {\n                    status: 200,\n                    body: JSON.stringify(frame, null, 2),\n                    type: \"application/eframe; charset=utf-8\",\n                };\n            }\n\n            // Async callin job peek/claim: GET /_foobarch/navi_shell/job/{uuid}/{jobId}\n            {\n                const jobMatch = pathname.match(\n                    /^\\/_foobarch\\/navi_shell\\/job\\/([^/]+)\\/([^/]+)\\/?$/i\n                );\n                if (jobMatch && (method === \"GET\" || method === \"HEAD\")) {\n                    const shellUuid = decodeURIComponent(jobMatch[1]);\n                    const jobId = decodeURIComponent(jobMatch[2]);\n                    const token =\n                        this.headerGet(headers, NAVI_SHELL_TOKEN_HEADER) ||\n                        this.headerGet(headers, USAGE_TOKEN_HEADER) ||\n                        url.searchParams.get(\"token\") ||\n                        \"\";\n                    const relay = this.naviShellJobResponse(\n                        shellUuid,\n                        token,\n                        jobId\n                    );\n                    if (method === \"HEAD\" && relay.status >= 200 && relay.status < 300) {\n                        return { ...relay, body: \"\" };\n                    }\n                    return relay;\n                }\n            }\n\n            const first = pathname.replace(/^\\/+/, \"\").split(\"/\")[0];\n            if (first === \"foobarch\") {\n                const bodyBuf = reqLike.bodyBuf || Buffer.alloc(0);\n                return await this.handleFoobarchApi(\n                    method,\n                    pathname,\n                    headers,\n                    bodyBuf,\n                    reqLike.url\n                );\n            }\n\n            // Browser document navigate → shell wrap (skip on internal redirect\n            // and skip navi_shell parks so the remote caller sees callin result\n            // or the JSON error body).\n            const wrapResolved = this.resolveRoute(pathname, { headers });\n            const wrapCtrl = wrapResolved?.frame\n                ? this.httpControl(\n                      wrapResolved.frame,\n                      method === \"HEAD\" ? \"GET\" : method\n                  )\n                : null;\n            const wrapKind = String(wrapCtrl?.kind || \"\").toLowerCase();\n            if (\n                !reqLike.internal &&\n                method === \"GET\" &&\n                this.isBrowserRequest(reqLike) &&\n                this.isDirectNavigation(reqLike) &&\n                wrapKind !== \"navi_shell\"\n            ) {\n                return {\n                    status: 200,\n                    body: this.shellHtml(pathname + (url.search || \"\")),\n                    type: \"text/html; charset=utf-8\",\n                };\n            }\n\n            const ib = this.pathToIb(pathname);\n            const bodyBuf = reqLike.bodyBuf || Buffer.alloc(0);\n            const payloadOpts = {\n                bodyBuf,\n                headers,\n                search: url.search || \"\",\n                path: pathname + (url.search || \"\"),\n                redirectHops: Number(reqLike.redirectHops) || 0,\n            };\n\n            // Tip data.method[METHOD] drives every verb (GET/POST/PUT/PATCH/DELETE/QUERY/…).\n            // Miss: PUT|PATCH → local firstGen; else 404.\n            const resolved = this.resolveRoute(pathname, { headers });\n            if (resolved.kind === \"miss\" || resolved.kind === \"root\") {\n                if (method === \"PUT\" || method === \"PATCH\") {\n                    return await this.handleCommitPut(ib, bodyBuf, headers);\n                }\n                if (method === \"DELETE\") {\n                    return await this.handleTombstone(ib, bodyBuf, headers);\n                }\n                return {\n                    status: 404,\n                    body:\n                        resolved.reason === \"gib_not_found\"\n                            ? `no frame ${resolved.addr || ib}\\n`\n                            : `no tip for ${ib}\\n`,\n                    type: \"text/plain\",\n                };\n            }\n\n            if (resolved.kind === \"park\" || resolved.kind === \"tip\") {\n                const ctrl = this.httpControl(resolved.frame, method);\n                if (!ctrl) {\n                    return {\n                        status: 405,\n                        body: JSON.stringify({\n                            error: `no method control for ${method}`,\n                        }),\n                        type: \"application/json\",\n                    };\n                }\n                const kind = String(ctrl.kind || \"bin\").toLowerCase();\n                if (kind === \"commit\") {\n                    // Exact request path ib (not park tip alone).\n                    return await this.handleCommitPut(ib, bodyBuf, headers);\n                }\n                if (kind === \"tombstone\") {\n                    return await this.handleTombstone(ib, bodyBuf, headers);\n                }\n                if (\n                    kind === \"proxy\" ||\n                    kind === \"relay\" ||\n                    kind === \"redirect\" ||\n                    kind === \"bin\" ||\n                    kind === \"mod\" ||\n                    kind === \"frame\" ||\n                    kind === \"manifest\" ||\n                    kind === \"lua\" ||\n                    kind === \"navi_shell\"\n                ) {\n                    const accessAuth = authorizeAccess(this.ensureStore(), resolved.frame, {\n                        ib: resolved.frame?.ib || ib,\n                        method,\n                        headers,\n                        body: bodyBuf,\n                        parkRequest: this.makeParkRequestController({\n                            deadline: Date.now() + SCHEMA_TIMEOUT_MS,\n                            headers,\n                        }),\n                    });\n                    if (!accessAuth.allow) {\n                        return {\n                            status: accessAuth.aside_ok === false ? 403 : 401,\n                            body: JSON.stringify({\n                                error: accessAuth.error || `${method} unauthorized`,\n                                via: accessAuth.via,\n                                policyAddr: accessAuth.policyAddr,\n                                schemaAddr: accessAuth.schemaAddr,\n                            }),\n                            type: \"application/json\",\n                        };\n                    }\n                    return await this.handleGetPayload(resolved, method, payloadOpts);\n                }\n                return {\n                    status: 405,\n                    body: JSON.stringify({\n                        error: `${method} kind '${kind}' not supported`,\n                    }),\n                    type: \"application/json\",\n                };\n            }\n\n            return { status: 404, body: \"not found\\n\", type: \"text/plain\", headers: outHeaders };\n        }\n\n        async handleRequest(req, res) {\n            try {\n                const bodyBuf = await this.readBody(req);\n                const reqHeaders = { ...req.headers };\n                if (!reqHeaders[\"x-forwarded-for\"] && req.socket?.remoteAddress) {\n                    reqHeaders[\"x-forwarded-for\"] = String(req.socket.remoteAddress).replace(/^::ffff:/, \"\");\n                }\n                const result = await this.dispatch({\n                    method: req.method,\n                    url: req.url,\n                    headers: reqHeaders,\n                    bodyBuf,\n                });\n                const headers = {\n                    \"Content-Type\": result.type || \"text/plain\",\n                    \"Access-Control-Allow-Origin\": \"*\",\n                    ...(result.headers || {}),\n                };\n                // Relay parks are live presence — never let Safari/PWA cache a\n                // prior 410/503 over a renewed tip (memory cache sits above SW).\n                try {\n                    const leaf = String(req.url || \"\")\n                        .split(\"?\")[0]\n                        .replace(/^\\/+/, \"\")\n                        .split(\"/\")[0];\n                    if (this.isRelayParkIb(leaf)) {\n                        headers[\"Cache-Control\"] = \"no-store\";\n                    }\n                } catch {\n                    /* ignore */\n                }\n                const body = result.body ?? \"\";\n                if (Buffer.isBuffer(body)) {\n                    headers[\"Content-Length\"] = String(body.length);\n                    res.writeHead(result.status || 200, headers);\n                    res.end(body);\n                } else {\n                    const buf = Buffer.from(String(body), \"utf8\");\n                    headers[\"Content-Length\"] = String(buf.length);\n                    res.writeHead(result.status || 200, headers);\n                    res.end(buf);\n                }\n            } catch (err) {\n                warn(\"request failed\", err);\n                res.writeHead(500, { \"Content-Type\": \"text/plain\" });\n                res.end(String(err.message || err));\n            }\n        }\n\n        async start(port) {\n            ensureNative();\n            await this.loadState();\n            if (port != null && port !== \"\") {\n                this.port = Number(port) || DEFAULT_PORT;\n            }\n            this.ensureStore();\n            // Schema gates need fengari; seed AppData vendor if missing.\n            const eng = loadFengari();\n            if (!eng) {\n                warn(\n                    \"fengari unavailable at start — gated mut8 will fail until: hostparkinator_5000 vendor\"\n                );\n            }\n            if (this.listening) {\n                return `hostparkinator_5000 already listening on ${this.host}:${this.port}`;\n            }\n            const http = nodeRequire(\"http\");\n            this._server = http.createServer((req, res) => {\n                void this.handleRequest(req, res);\n            });\n            this._server.on(\"upgrade\", (req, socket, head) => {\n                this.handleNaviShellUpgrade(req, socket, head);\n            });\n            await new Promise((resolve, reject) => {\n                this._server.once(\"error\", reject);\n                this._server.listen(this.port, this.host, () => resolve());\n            });\n            this.listening = true;\n            await this.persistPort();\n            const msg = `hostparkinator_5000 listening on http://${this.host}:${this.port} db=${this.dbPath}${\n                _fengariPath ? ` fengari=${_fengariPath}` : \" fengari=missing\"\n            }`;\n            log(msg);\n            return msg;\n        }\n\n        async stop() {\n            if (!this.listening || !this._server) {\n                return \"hostparkinator_5000 not listening\";\n            }\n            for (const uuid of [...this._naviShells.keys()]) {\n                this.dropNaviShell(uuid);\n            }\n            await new Promise((resolve) => {\n                this._server.close(() => resolve());\n            });\n            this._server = null;\n            this.listening = false;\n            if (this.store) {\n                this.store.close();\n                this.store = null;\n            }\n            return \"hostparkinator_5000 stopped\";\n        }\n\n        status() {\n            return {\n                id: \"hostparkinator_5000\",\n                listening: this.listening,\n                port: this.port,\n                host: this.host,\n                dbPath: this.dbPath || defaultDbPath(),\n                staticDir: this.staticDir,\n                fengari: _fengariPath || (loadFengari() ? _fengariPath : null),\n            };\n        }\n\n        statusSize() {\n            const dbPath = this.dbPath || defaultDbPath();\n            const disk = sqliteFileSizes(dbPath);\n            let tables = null;\n            try {\n                tables = this.ensureStore().payloadSizes();\n            } catch (err) {\n                tables = {\n                    error: String(err && err.message ? err.message : err),\n                };\n            }\n            return {\n                dbPath,\n                on_disk: { bytes: disk.total, size: disk.size },\n                files: disk.files.filter((f) => f.exists || f.kind === \"sqlite\"),\n                tables,\n            };\n        }\n\n        /**\n         * Seed navi_shell.js / sw.js as firstGen-style tips with bin + park + http controls.\n         * Uses synthetic frames (gib = content hash) without full ts-gib — fine for bootstrap.\n         */\n        async seedFromStatic(staticDir) {\n            const fs = nodeRequire(\"fs\");\n            const path = nodeRequire(\"path\");\n            const store = this.ensureStore();\n            const dir = staticDir || this.staticDir;\n            const files = [\n                {\n                    name: \"navi_shell.js\",\n                    content_type: \"application/javascript; charset=utf-8\",\n                },\n                {\n                    name: \"sw.js\",\n                    content_type: \"application/javascript; charset=utf-8\",\n                },\n            ];\n            const seeded = [];\n            for (const f of files) {\n                const fp = path.resolve(dir, f.name);\n                if (!fs.existsSync(fp)) {\n                    warn(\"seed skip missing\", fp);\n                    continue;\n                }\n                const bytes = fs.readFileSync(fp);\n                const sha = sha256Hex(bytes);\n                store.putBin(sha, bytes, f.content_type);\n                const gib = sha.slice(0, 64).toUpperCase();\n                const ibGib = {\n                    ib: f.name,\n                    gib,\n                    data: {\n                        parts: [\"network_proposal\", \"ibgib_frame\", \"manifest\", \"json\"],\n                        park: \"defer\",\n                        content_type: f.content_type,\n                        default_method: \"GET\",\n                        method: {\n                            GET: { kind: \"bin\" },\n                            PUT: { kind: \"commit\" },\n                        },\n                        n: 0,\n                        timestamp: navi.stamp.time(),\n                        seed: true,\n                    },\n                    rel8ns: {\n                        bin: [`bin ${sha}`],\n                        past: [],\n                        tjp: [],\n                        dna: [],\n                    },\n                };\n                const token = store.mintTokens(1)[0];\n                const envelope = {\n                    transform: \"firstGen\",\n                    newIbGib: ibGib,\n                    dnas: [],\n                    intermediateIbGibs: [],\n                };\n                // Bypass commit path token race: persist then consume\n                const existing = store.getTip(f.name);\n                if (existing && !existing.tombstone) {\n                    seeded.push({ ib: f.name, skipped: true, addr: existing.addr });\n                    continue;\n                }\n                const result = store.persistTransform(envelope);\n                store.consumeToken(token, result.addr);\n                seeded.push({ ib: f.name, addr: result.addr, sha });\n            }\n            return seeded;\n        }\n\n        /**\n         * Seed stock write-gate schema tip(s) as open Lua tips (chicken-egg).\n         * Lock later by mut8 + rel8ns.policy → a keys policy instance.\n         */\n        async seedSchemas() {\n            const store = this.ensureStore();\n            const seeded = [];\n            const schemas = [\n                {\n                    ib: SCHEMA_KEYS_IB,\n                    lua: KEYS_V1_LUA,\n                    label: \"keys_v1\",\n                },\n            ];\n            for (const s of schemas) {\n                const existing = store.getTip(s.ib);\n                if (existing && !existing.tombstone) {\n                    seeded.push({\n                        ib: s.ib,\n                        skipped: true,\n                        addr: existing.addr,\n                    });\n                    continue;\n                }\n                const bytes = Buffer.from(s.lua, \"utf8\");\n                const sha = sha256Hex(bytes);\n                store.putBin(sha, bytes, SCHEMA_CONTENT_TYPE);\n                const gib = sha.slice(0, 64).toUpperCase();\n                const ibGib = {\n                    ib: s.ib,\n                    gib,\n                    data: {\n                        parts: [\"write_schema\", \"ibgib_frame\", \"manifest\", \"json\"],\n                        content_type: SCHEMA_CONTENT_TYPE,\n                        schema_kind: s.label,\n                        default_method: \"GET\",\n                        method: {\n                            GET: { kind: \"bin\" },\n                            PUT: { kind: \"commit\" },\n                            PATCH: { kind: \"commit\" },\n                        },\n                        n: 0,\n                        timestamp: navi.stamp.time(),\n                        seed: true,\n                    },\n                    rel8ns: {\n                        bin: [`bin ${sha}`],\n                        past: [],\n                        tjp: [],\n                        dna: [],\n                    },\n                };\n                const token = store.mintTokens(1)[0];\n                const result = store.persistTransform({\n                    transform: \"firstGen\",\n                    newIbGib: ibGib,\n                    dnas: [],\n                    intermediateIbGibs: [],\n                    bin: {\n                        sha256: sha,\n                        bytes_b64: bytes.toString(\"base64\"),\n                        content_type: SCHEMA_CONTENT_TYPE,\n                    },\n                });\n                store.consumeToken(token, result.addr);\n                seeded.push({ ib: s.ib, addr: result.addr, sha });\n            }\n            return seeded;\n        }\n    }\n\n    const svc = new FoobarchHost();\n\n    const run = async (...args) => {\n        ensureNative();\n        const [cmd, ...rest] = args;\n        const c = String(cmd || \"help\").toLowerCase();\n\n        if (c === \"help\" || c === \"--help\" || c === \"-h\") {\n            return [\n                \"hostparkinator_5000 — ibgib-native Foobarch (default localhost:5353)\",\n                \"  start [port] | stop | status | status size\",\n                \"  host [addr] | db [path] | static [dir]\",\n                \"  password | password set <pwd>\",\n                \"  mint [count] | list | tip <ib> | reindex\",\n                \"  seed [staticDir] | seed schemas\",\n                \"  admin delete <ib>\",\n                \"  vendor | fengari                 ensure/load Lua VM (AppData vendor)\",\n                \"  remount_host [route] | remount_host path [route]\",\n                \"\",\n                \"  Write gates: schema tip (Lua) → policy tip (keys) → content rel8ns.policy\",\n                `  Stock schema ib: ${SCHEMA_KEYS_IB} (hostparkinator_5000 seed schemas)`,\n                \"  Fengari: %APPDATA%\\\\.navi_shell\\\\hostparkinator_5000\\\\vendor\\\\fengari (or FOOBARCH_FENGARI)\",\n            ].join(\"\\n\");\n        }\n\n        await svc.loadState();\n\n        if (c === \"vendor\" || c === \"fengari\") {\n            resetFengari();\n            const ensured = ensureFengariVendor();\n            if (!ensured.ok) {\n                throw new Error(ensured.error || \"fengari vendor failed\");\n            }\n            const eng = loadFengari();\n            if (!eng) {\n                throw new Error(`fengari still unloadable at ${ensured.path}`);\n            }\n            return [\n                `fengari ok path=${_fengariPath || ensured.path}`,\n                ensured.installed\n                    ? `vendor installed from ${ensured.from}`\n                    : \"vendor already present\",\n            ].join(\"\\n\");\n        }\n\n        if (c === \"start\") return await svc.start(rest[0]);\n        if (c === \"stop\") return await svc.stop();\n        if (c === \"status\") {\n            const sub = String(rest[0] || \"\").toLowerCase();\n            if (sub === \"size\") {\n                return JSON.stringify(svc.statusSize(), null, 2);\n            }\n            if (sub) {\n                return `unknown status subcommand ${sub} — hostparkinator_5000 status | status size`;\n            }\n            return JSON.stringify(svc.status(), null, 2);\n        }\n\n        if (c === \"remount_host\" || c === \"remount\") {\n            return await remountHost(rest);\n        }\n\n        if (c === \"host\") {\n            if (rest[0]) {\n                svc.host = String(rest[0]);\n                await navi.storage.item.set(STORAGE.host, svc.host);\n            }\n            return `host=${svc.host}`;\n        }\n        if (c === \"db\") {\n            if (rest[0]) {\n                svc.dbPath = String(rest[0]);\n                await navi.storage.item.set(STORAGE.dbPath, svc.dbPath);\n                if (svc.store) {\n                    svc.store.close();\n                    svc.store = null;\n                }\n            }\n            return `db=${svc.dbPath || defaultDbPath()}`;\n        }\n        if (c === \"static\") {\n            if (rest[0]) {\n                svc.staticDir = String(rest[0]);\n                await navi.storage.item.set(STORAGE.staticDir, svc.staticDir);\n            }\n            return `static=${svc.staticDir}`;\n        }\n        if (c === \"password\") {\n            svc.ensureStore();\n            if (rest[0] === \"set\" && rest[1]) {\n                svc.setUsagePassword(rest.slice(1).join(\" \"));\n                return \"password updated\";\n            }\n            return `usage_password=${svc.usagePassword()}`;\n        }\n        if (c === \"mint\") {\n            const n = Math.min(100, Math.max(1, Number(rest[0]) || 1));\n            const tokens = svc.ensureStore().mintTokens(n);\n            return JSON.stringify({ tokens }, null, 2);\n        }\n        if (c === \"list\") {\n            return JSON.stringify({ tips: svc.ensureStore().listTips(500, 0) }, null, 2);\n        }\n        if (c === \"tip\") {\n            const ib = rest.join(\"/\");\n            const tip = svc.ensureStore().getTip(ib);\n            return tip ? JSON.stringify(tip, null, 2) : \"no tip\";\n        }\n        if (c === \"reindex\") {\n            const n = svc.ensureStore().reindexParks();\n            return `reindexed ${n} parks`;\n        }\n        if (c === \"seed\") {\n            if (String(rest[0] || \"\").toLowerCase() === \"schemas\") {\n                return JSON.stringify(await svc.seedSchemas(), null, 2);\n            }\n            const seeded = await svc.seedFromStatic(rest[0]);\n            return JSON.stringify(seeded, null, 2);\n        }\n        if (c === \"admin\" && rest[0] === \"delete\") {\n            const ib = rest.slice(1).join(\"/\");\n            return JSON.stringify(svc.ensureStore().hardDeleteIb(ib), null, 2);\n        }\n\n        return `unknown command ${c} — hostparkinator_5000 help`;\n    };\n\n    async function remountPathGet() {\n        const v = await navi.storage.item.get(STORAGE.remountPath);\n        const s = v == null ? \"\" : String(v).trim();\n        return s || DEFAULT_REMOUNT_PATH;\n    }\n\n    async function remountPathSet(route) {\n        let next = normalizeRemountRoute(route);\n        if (!next) throw new Error(\"remount_host path requires a route\");\n        await navi.storage.item.set(STORAGE.remountPath, next);\n        return next;\n    }\n\n    /**\n     * Remount source is an arbitrary route (usually flowerpot/…), never a\n     * callin URL. Heal shredded https/host → https://host if someone pasted one.\n     */\n    function normalizeRemountRoute(route) {\n        let rel = String(route || \"\")\n            .trim()\n            .replace(/^\\/+/, \"\");\n        if (/^https?\\/[^/]/i.test(rel) && !/^https?:\\/\\//i.test(rel)) {\n            rel = rel.replace(/^(https?)\\/+/i, \"$1://\");\n        }\n        return rel;\n    }\n\n    async function fetchRemountSource(route) {\n        const rel = normalizeRemountRoute(route);\n        if (!rel) throw new Error(\"empty remount route\");\n\n        const candidates = [];\n        if (/^[a-z][a-z0-9+.-]*:\\/\\//i.test(rel)) {\n            candidates.push(rel);\n        } else {\n            if (typeof navi.resolveUrl === \"function\") {\n                candidates.push(navi.resolveUrl(rel));\n            } else {\n                const origin = String(navi.origin || \"\")\n                    .trim()\n                    .replace(/\\/+$/, \"\");\n                candidates.push(origin ? `${origin}/${rel}` : `/${rel}`);\n            }\n            // foobarch flowerpot capture park sometimes returns the tip JSON\n            // instead of proxying; same content lives on flowerpotv2 upstream.\n            const m = rel.match(/^flowerpot\\/+(.+)$/i);\n            if (m) {\n                candidates.push(\n                    `https://xomud.quest/flowerpotv2/${m[1].replace(/^\\/+/, \"\")}`\n                );\n            }\n        }\n\n        let lastErr = null;\n        for (const url of candidates) {\n            try {\n                const res = await fetch(url, {\n                    method: \"GET\",\n                    headers: {\n                        Accept:\n                            \"application/navi-module, text/javascript, application/javascript, text/plain, */*\",\n                    },\n                });\n                const text = await res.text();\n                if (!res.ok) {\n                    lastErr = new Error(\n                        `GET ${url} → ${res.status}: ${text.slice(0, 200)}`\n                    );\n                    continue;\n                }\n                if (\n                    !/export\\s+(?:const|function|async\\s+function)\\s+register\\b/.test(\n                        text\n                    ) &&\n                    !/export\\s*\\{[^}]*\\bregister\\b/.test(text)\n                ) {\n                    lastErr = new Error(\n                        `not a Navi module from ${url} (${text.length} bytes)`\n                    );\n                    continue;\n                }\n                return { url, code: text };\n            } catch (err) {\n                lastErr =\n                    err instanceof Error\n                        ? err\n                        : new Error(String(err || \"fetch failed\"));\n            }\n        }\n        throw lastErr || new Error(`remount fetch failed for ${rel}`);\n    }\n\n    /**\n     * Download host bin → stop → unmount self → mount new source.\n     * setTimeout(0) lets the current callin return before commands are torn down.\n     */\n    async function remountHost(args) {\n        ensureNative();\n        const a0 = args[0] != null ? String(args[0]).trim() : \"\";\n\n        if (a0.toLowerCase() === \"path\") {\n            if (args[1] != null && String(args[1]).trim()) {\n                // Remainder segments → route (callin folds / into args).\n                const next = await remountPathSet(args.slice(1).join(\"/\"));\n                return `remount_host path=${next}`;\n            }\n            return `remount_host path=${await remountPathGet()}`;\n        }\n\n        let route = await remountPathGet();\n        if (a0) {\n            route = await remountPathSet(args.join(\"/\"));\n        }\n\n        const { url, code } = await fetchRemountSource(route);\n        const wasListening = !!svc.listening;\n        const port = svc.port;\n        const host = svc.host;\n\n        // Stop HTTP before unmount so listeners are gone; onUnmount also stops.\n        try {\n            await svc.stop();\n        } catch {\n            /* ignore */\n        }\n\n        const bytes = Buffer.byteLength(code, \"utf8\");\n        log(`remount_host downloaded ${bytes} bytes from ${url}`);\n\n        return await new Promise((resolve, reject) => {\n            // Not tracked in `timers` — onUnmount clears that list.\n            setTimeout(async () => {\n                try {\n                    const self = navi.mod && navi.mod.hostparkinator_5000;\n                    if (self && typeof navi.unmount === \"function\") {\n                        navi.unmount(self);\n                    }\n                    await navi.mount(code);\n                    const next = navi.mod && navi.mod.hostparkinator_5000;\n                    if (!next) {\n                        throw new Error(\"mount succeeded but navi.mod.hostparkinator_5000 missing\");\n                    }\n                    let startMsg = \"not started\";\n                    if (wasListening && typeof next.start === \"function\") {\n                        startMsg = await next.start(port);\n                    }\n                    const msg = `remount_host ok route=${route} bytes=${bytes} host=${host} ${startMsg}`;\n                    log(msg);\n                    if (typeof navi.callout === \"function\") navi.callout(`[hostparkinator_5000] ${msg}`);\n                    resolve(msg);\n                } catch (err) {\n                    const msg = `remount_host failed: ${err && err.message ? err.message : err}`;\n                    warn(msg);\n                    if (typeof navi.callout === \"function\") navi.callout(`[hostparkinator_5000] ${msg}`);\n                    reject(new Error(msg));\n                }\n            }, 0);\n        });\n    }\n\n    let unregServer = null;\n\n    return {\n        name: \"hostparkinator_5000\",\n        version: \"0.7.3\",\n        description:\n            \"ibgib-native Foobarch host — park routing; eframe tip-only; navi-mod multipart; /ib^gib pin\",\n\n        moduleInfo: {\n            name: \"hostparkinator_5000\",\n            version: \"0.7.3\",\n            description:\n                \"Every park method passes its access policy; method controls select bins; GET snapshots can carry chosen bins\",\n        },\n\n        server: svc,\n        start: (port) => svc.start(port),\n        stop: () => svc.stop(),\n        status: () => svc.status(),\n\n        commands: {\n            hostparkinator_5000: {\n                name: \"hostparkinator_5000\",\n                description: \"ibgib-native Foobarch host (:5353)\",\n                execute: async (...args) => run(...args),\n            },\n        },\n\n        onMount: async () => {\n            ensureNative();\n            await svc.loadState();\n            const sm = navi.mod?.server_manager;\n            if (sm && typeof sm.register === \"function\") {\n                sm.register({\n                    id: \"hostparkinator_5000\",\n                    name: \"hostparkinator_5000\",\n                    description: \"ibgib-native Foobarch host\",\n                    defaultPort: DEFAULT_PORT,\n                    start: (port) => svc.start(port),\n                    stop: () => svc.stop(),\n                    status: () => svc.status(),\n                    module: \"hostparkinator_5000\",\n                });\n                unregServer = () => {\n                    try {\n                        sm.unregister(\"hostparkinator_5000\");\n                    } catch {\n                        /* ignore */\n                    }\n                };\n            }\n            if (typeof navi.callout === \"function\") {\n                navi.callout(\n                    `[hostparkinator_5000] mounted — hostparkinator_5000 start  (default :${DEFAULT_PORT})`\n                );\n            }\n        },\n\n        onUnmount: async () => {\n            if (typeof unregServer === \"function\") unregServer();\n            unregServer = null;\n            try {\n                await svc.stop();\n            } catch {\n                /* ignore */\n            }\n            for (const t of timers) clearTimeout(t);\n            timers.length = 0;\n        },\n    };\n};\n";
            await this.plantHostparkinatorModuleBin(hostparkinatorModuleCode);
            this.callout('[navi] hostparkinator_5000 planted as tip+bin (navi:hostparkinator_5000)');
        } catch (error: unknown) {
            this.callout('[navi] Failed to create default module: ' + error);
        }
    }

    /** Plant hostparkinator_5000.js as navi:hostparkinator_5000 tip+bin (embedded at build time). */
    private async plantHostparkinatorModuleBin(moduleCode: string): Promise<void> {
        const trimmed = String(moduleCode ?? '').trim();
        if (!trimmed) {
            throw new Error('[navi] hostparkinator_5000 module string is empty');
        }
        const ib = moduleParkIb('hostparkinator_5000');
        const sha = await this.sha256Hex(trimmed);
        const ref = `bin ${sha}`;
        const tip = await this.getTip(ib);
        const current = Array.isArray(tip?.rel8ns?.bin) ? tip.rel8ns!.bin[0] : null;
        const subject = tip?.data?.module?.subject_seed;
        if (current === ref && subject === ref) {
            return;
        }
        await this.plantModulePark({
            name: 'hostparkinator_5000',
            media: trimmed,
            mime: 'application/navi-module',
        });
    }

    /** Put surf source in bins store and link navi/surf.rel8ns.bin (no file copy). */
    private async plantSurfModuleBin(surfModuleCode: string): Promise<void> {
        const sha = await this.sha256Hex(surfModuleCode);
        await this.putBin(sha, {
            media: surfModuleCode,
            mime: 'application/navi-module',
        });
        const ref = `bin ${sha}`;
        const tip = await this.getTip(NAVI_SURF_IB);
        if (!tip) {
            throw new Error(
                `park tip ${NAVI_SURF_IB} missing — plant navi_redux seeds before surf bin`
            );
        }
        const current = Array.isArray(tip.rel8ns?.bin) ? tip.rel8ns!.bin : [];
        if (current[0]) {
            const shaKey = String(current[0]).replace(/^bin\s+/i, "").trim();
            const bin = shaKey ? await this.getBin(shaKey) : null;
            const media = String(bin?.media || "");
            // Same embedded source, or a stage-branch surf the user mounted: leave it.
            // An older or broken embedded plant is replaced below.
            if (!media || media === surfModuleCode) return;
            if (/keepstage|branch:\s*"stage"/.test(media)) return;
        }
        const priorAddr = tip.gib ? `${tip.ib}^${tip.gib}` : null;
        const next = await this.stampTipFrame({
            ...tip,
            data: {
                ...tip.data,
                module: {
                    ...(tip.data.module || {}),
                    subject_seed: ref,
                },
                n: undefined,
            },
            rel8ns: {
                ...(tip.rel8ns || {}),
                bin: [ref],
                past: priorAddr ? [priorAddr] : [],
            },
        });
        await this.setTip(next);
    }

    // Module registry methods
    public registerModule(name: string, moduleObject: any): void {
        // Fail if module already exists
        if (this.moduleRegistry.has(name)) {
            throw new Error(`Module '${name}' is already registered`);
        }
        
        this.moduleRegistry.set(name, moduleObject);
        
        // Create dynamic property on navi.mod
        this.mod[name] = moduleObject;
    }

    /** onMount threw: drop the half-mounted module without touching the ledger. */
    private rollbackFailedMount(name: string, moduleObject: any): void {
        try {
            moduleObject?.onUnmount?.();
        } catch {
            /* best-effort cleanup */
        }
        try {
            moduleObject?.cleanup?.();
        } catch {
            /* best-effort cleanup */
        }
        this.clearSwHandlersForOwner(name);
        if (this.moduleRegistry.get(name) === moduleObject) {
            this.moduleRegistry.delete(name);
            delete this.mod[name];
        }
    }

    public listModules(): string[] {
        return Array.from(this.moduleRegistry.keys());
    }

    public async unmount(moduleObject: any): Promise<void> {
        const name = moduleObject.name;
        if (!name || !this.moduleRegistry.has(name)) {
            throw new Error(`Module '${name}' is not registered`);
        }
        
        // Call onUnmount if it exists
        if (moduleObject.onUnmount) {
            moduleObject.onUnmount();
        }
        
        // Call custom cleanup if it exists
        if (moduleObject.cleanup) {
            moduleObject.cleanup();
        }

        // Drop SW handlers owned by this module (navi.sw.on(name, fn, owner))
        this.clearSwHandlersForOwner(name);
        this.relayWhitelistMods.delete(name);
        
        // Remove from registry
        this.moduleRegistry.delete(name);
        delete this.mod[name];

        await this.syncModIndexOnUnmount(name);
        
        this.callout(`[navi] Unmounted module: ${name}`);
    }

    /**
     * Mount every park still listed on navi:mod (ledger).
     * Already-live names are left as they are, except surf: init_script mounts
     * the surf tip before remount, and that must not hide a newer surf park.
     * Unmounted mods are dropped from the ledger, so they stay off until remounted
     * via explicit `mount`. Claims land on this unit's mods{}.
     */
    public async remount(): Promise<string> {
        const index = await this.getTip(NAVI_MOD_INDEX_IB);
        if (!index?.data) {
            throw new Error('navi:mod tip missing — cannot remount');
        }
        const parks = Array.isArray(index.data.parks) ? index.data.parks : [];
        const mounted: string[] = [];
        const skipped: string[] = [];
        /** name → last mount error (ledger row kept; dep may land in a later pass). */
        const failed = new Map<string, string>();

        this.remountInProgress = true;
        try {
            let pending = parks.filter((entry: any) => {
                if (!entry || typeof entry !== 'object') return false;
                const name = String(entry.name || '').trim();
                if (!this.parkEntryIb(entry) || !name) return false;
                if (this.moduleRegistry.has(name) && name !== 'surf') {
                    skipped.push(name);
                    return false;
                }
                return true;
            });
            // Fail-fast mods (missing dep) retry after the others mount.
            while (pending.length) {
                const next: any[] = [];
                for (const entry of pending) {
                    const name = String(entry.name || '').trim();
                    try {
                        await this.remountLedgerEntry(entry);
                        failed.delete(name);
                        mounted.push(name);
                    } catch (err) {
                        failed.set(name, String((err as any)?.message || err));
                        next.push(entry);
                    }
                }
                if (next.length === pending.length) break;
                pending = next;
            }
        } finally {
            this.remountInProgress = false;
        }

        const msg =
            `[navi] remount ledger: +${mounted.length}` +
            (mounted.length ? ` (${mounted.join(', ')})` : '') +
            (skipped.length ? `; skip live ${skipped.join(', ')}` : '') +
            (failed.size
                ? `; failed ${[...failed]
                      .map(([n, e]) => `${n} (${e.replace(/^\[navi\] mount failed: [^ ]+ — /, '')})`)
                      .join(', ')}`
                : '');
        this.callout(msg);
        return msg;
    }

    /** Mount one navi:mod ledger park and claim it on the current unit. */
    private async remountLedgerEntry(entry: any): Promise<void> {
        const ib = this.parkEntryIb(entry);
        const name = String(entry.name || '').trim();
                await this.mount(await this.loadBinMediaFromTip(ib), {
                    record: false,
                });
                // Session claim on this unit (ledger already has the registration).
                const unitIb =
                    this.callUnitIb ||
                    this.entryPlug?.unitIb ||
                    (await this.resolveDefaultUnitIb());
                if (unitIb) {
                    const unitTip = await this.getTip(unitIb);
                    if (unitTip?.data) {
                        const prior = this.readUnitMods(unitTip) || {};
                        const clean = {
                            'ib^gib': this.parkEntryAddr(entry),
                            name,
                            commands: Array.isArray(entry.commands)
                                ? entry.commands.map(String)
                                : [],
                            registered_at:
                                String(entry.registered_at || '') ||
                                naviStamp.time(),
                        };
                        if (!clean['ib^gib']) {
                            const tip = await this.getTip(ib);
                            if (tip?.gib) {
                                clean['ib^gib'] = `${ib}^${tip.gib}`;
                            }
                        }
                        await this.mut8Tip(unitTip, {
                            unit: {
                                ...(unitTip.data.unit || {}),
                                mods: { ...prior, [name]: clean },
                            },
                        });
                    }
        }
    }

    private async finalizeMountedModule(
        mod: any,
        opts?: { record?: boolean; media?: string; parkTipIb?: string }
    ): Promise<any> {
        if (mod && typeof mod.register === 'function') {
            const moduleObject = mod.register(this);
            if (moduleObject && moduleObject.name) {
                const name = String(moduleObject.name).trim();
                if (!name || /[/:]/.test(name)) {
                    throw new Error(
                        `[navi] register() returned invalid name '${name}' (single segment required)`
                    );
                }
                // Remount / warez reinstall: replace live module instead of failing
                // with "already registered" while navi.mod.<name> still looks mounted.
                if (this.moduleRegistry.has(name)) {
                    await this.unmount(this.moduleRegistry.get(name));
                }
                this.registerModule(name, moduleObject);

                if (moduleObject.onMount) {
                    try {
                    await moduleObject.onMount();
                    } catch (err) {
                        this.rollbackFailedMount(name, moduleObject);
                        throw new Error(
                            `[navi] mount failed: ${name} — ${(err as any)?.message || err}`
                        );
                }
                }
                this.emit('mounted', { name });

                if (opts?.record !== false) {
                    // Plant/refresh park under the live register name (not a source scrape).
                    const media = String(opts?.media ?? '').trim();
                    if (!media) {
                        throw new Error(
                            `[navi] cannot plant park for '${name}' — mount media missing`
                        );
                    }
                    await this.plantModulePark({
                        name,
                        media,
                        mime: 'application/navi-module',
                    });
                }
                await this.syncModIndexOnMount(moduleObject, {
                    parkTipIb: opts?.parkTipIb,
                });

                this.callout(`[navi] Registered module: ${name}`);
                return moduleObject;
            }
            throw new Error(
                '[navi] register() must return an object with a string name'
            );
        }

        if (mod && 'default' in mod) {
            return await mod.default;
        }
        return mod;
    }

    public async mount(
        code: string,
        opts?: { record?: boolean; parkTipIb?: string }
    ): Promise<any> {
        try {
            const trimmed = String(code ?? '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim();
            if (!trimmed) {
                throw new Error('[navi-error] Empty code provided to mount');
            }
            const mountOpts = { ...opts, media: trimmed };

            const isBrowser = typeof window !== 'undefined' && typeof window.document !== 'undefined';

            // Heuristic: treat presence of top-level import/export keywords as module code
            const hasTopLevelModuleSyntax = /(^|\s)(import\s|export\s)/.test(trimmed);

            // Fast-path for Node: avoid data: URLs which can be finicky across Node builds
            if (!isBrowser) {
                if (!hasTopLevelModuleSyntax) {
                    const runner = new Function(`"use strict"; return (async () => {\n${trimmed}\n})();`);
                    return await (runner as any)();
                }

                // Prefer Function rewrite for register() modules — works under pkg (no dynamic import)
                const isRegisterModule = /export\s+(?:const|function|async\s+function)\s+register\b/.test(trimmed)
                    || /export\s+\{[^}]*\bregister\b/.test(trimmed);
                if (isRegisterModule) {
                    const body = trimmed
                        .replace(/export\s+async\s+function\s+register\b/, 'async function register')
                        .replace(/export\s+function\s+register\b/, 'function register')
                        .replace(/export\s+const\s+register\s*=/, 'const register =')
                        .replace(/export\s*\{[^}]*\bregister\b[^}]*\}\s*;?/, '');
                    const mod = new Function(`"use strict";\n${body}\n; return { register };`)();
                    return await this.finalizeMountedModule(mod, mountOpts);
                }

                // Generic ESM: temp .mjs + import (real Node; may fail inside pkg)
                try {
                    const { fs, join, tmpdir } = await getNodeFsPathOs();
                    const filePath = join(tmpdir(), `navi-mount-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`);
                    await fs.writeFile(filePath, trimmed, 'utf8');
                    const fileUrl = `file:///${filePath.split('\\').join('/')}`;
                    const mod = await import(fileUrl);
                    try { await fs.unlink(filePath); } catch {}
                    return await this.finalizeMountedModule(mod, mountOpts);
                } catch (nodeExecErr) {
                    throw new Error(
                        'Node file-based mounting failed: ' + formatCalloutMessage(nodeExecErr)
                        + ' (prefer export register so the Function rewrite path is used)'
                    );
                }
            }

            const moduleCode = hasTopLevelModuleSyntax
                ? trimmed
                : `export default (async () => {\n${trimmed}\n})();`;

            let moduleUrl: string;
            try {
                const base64 = typeof Buffer !== 'undefined'
                    ? Buffer.from(moduleCode, 'utf8').toString('base64')
                    : btoa(moduleCode);
                moduleUrl = `data:text/javascript;charset=utf-8;base64,${base64}`;
            } catch {
                moduleUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(moduleCode)}`;
            }

            const mod: any = await import(moduleUrl);
            return await this.finalizeMountedModule(mod, mountOpts);
        } catch (error) {
            this.callout(
                '[navi] Module mount failed: ' + formatCalloutMessage(error)
                + ' — expect export register returning { name }; with record, plants tip+bin and syncs navi:mod'
            );
            throw error;
        }
    }
}

// Shell built - enter navi

let naviInstance: Navi | null = null;

navi.callout = function callout(data?: any): any {
    if (arguments.length === 0) {
        throw new Error('[navi-error] navi.callout requires data. Usage: navi.callout(data)');
    }

    const instance = ensureNaviInstance();
    instance.emit('callout', data);
    return Promise.resolve(data);
};

function ensureNaviInstance(): Navi {
    if (!naviInstance) {
        naviInstance = new Navi();

        // Localnavi exe initializes explicitly in main(); browser / gocore auto-init.
        if (!isLocalnaviExe()) {
            naviInstance.initialize().catch(err => {
                naviInstance?.callout('[navi] Auto-initialize failed: ' + err);
            });
        }

        // Expose globally immediately after creation
        if (typeof globalThis !== 'undefined') {
            (globalThis as any).navi = navi;
        }
    }
    return naviInstance;
}

function navi(input?: NaviCallinInput): any {
    // If called with no args, initialize if needed
    if (arguments.length === 0) {
        return ensureNaviInstance();
    }

    // String or full callin request → front door
    if (typeof input === 'string' || (input && typeof input === 'object')) {
        const instance = ensureNaviInstance();
        return instance.dispatchCallin(input);
    }

    return naviInstance;
}

// accessible navi object properties

Object.defineProperty(navi, 'origin', {
    get() { return ensureNaviInstance().origin; },
    set(value: string) { ensureNaviInstance().origin = value; }
});

Object.defineProperty(navi, 'resolveUrl', {
    get() { return naviInstance?.resolveUrl.bind(naviInstance); }
});

Object.defineProperty(navi, 'fetch', {
    get() {
        const instance = ensureNaviInstance();
        return instance.fetchPath.bind(instance);
    }
});

Object.defineProperty(navi, 'storage', {
    get() { return naviInstance?.storage; }
});

Object.defineProperty(navi, 'park', {
    get() { return ensureNaviInstance().park; }
});

Object.defineProperty(navi, 'tokens', {
    get() { return ensureNaviInstance().tokens; }
});

Object.defineProperty(navi, 'mount', {
    get() { return naviInstance?.mount.bind(naviInstance); }
});

Object.defineProperty(navi, 'native', {
    get() {
        return {
            node: isNodeRuntime(),
            exe: isLocalnaviExe(),
            browser: isBrowserDocument(),
        };
    },
});

Object.defineProperty(navi, 'remount', {
    get() { return naviInstance?.remount.bind(naviInstance); }
});

Object.defineProperty(navi, 'initialize', {
    get() { return naviInstance?.initialize.bind(naviInstance); }
});

Object.defineProperty(navi, 'on', {
    get() { return naviInstance?.on.bind(naviInstance); }
});

Object.defineProperty(navi, 'repl', {
    get() { return ensureNaviInstance().repl; }
});

Object.defineProperty(navi, 'callinRequest', {
    get() {
        return naviInstance?.getCallinRequest?.() ?? null;
    }
});

Object.defineProperty(navi, 'callin', {
    get() {
        return ensureNaviInstance().callin.bind(ensureNaviInstance());
    }
});

Object.defineProperty(navi, 'unmount', {
    get() { return naviInstance?.unmount.bind(naviInstance); }
});

Object.defineProperty(navi, 'listModules', {
    get() { return naviInstance?.listModules.bind(naviInstance); }
});

Object.defineProperty(navi, 'mod', {
    get() { return naviInstance?.mod; }
});

Object.defineProperty(navi, 'stamp', {
    get() { return ensureNaviInstance().stamp; }
});

Object.defineProperty(navi, 'script', {
    get() { return naviInstance?.script.bind(naviInstance); }
});

Object.defineProperty(navi, 'addToInitScript', {
    get() { return naviInstance?.addToInitScript.bind(naviInstance); }
});

Object.defineProperty(navi, 'clearInitScript', {
    get() { return naviInstance?.clearInitScript.bind(naviInstance); }
});

Object.defineProperty(navi, 'getInitScript', {
    get() { return naviInstance?.getInitScript.bind(naviInstance); }
});

Object.defineProperty(navi, 'reseed', {
    get() {
        return ensureNaviInstance().reseed;
    },
});

Object.defineProperty(navi, 'factoryreset', {
    get() {
        return ensureNaviInstance().factoryreset;
    },
});

Object.defineProperty(navi, 'plug', {
    get() {
        return ensureNaviInstance().plug;
    },
});

Object.defineProperty(navi, 'unit', {
    get() {
        return ensureNaviInstance().unit;
    },
});

Object.defineProperty(navi, 'pwa', {
    get() {
        const instance = ensureNaviInstance();
        return instance.pwa;
    },
});

Object.defineProperty(navi, 'sw', {
    get() { return ensureNaviInstance().sw; },
});

navi.require = function requireModule(id: string): any {
    return ensureNaviInstance().require(id);
};

// start initialization

main().catch(error => {
    console.error('[shell] UNHANDLED ERROR:', error);
}); 