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
        } catch (error: unknown) {
            this.callout('[navi] Failed to create default module: ' + error);
        }
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