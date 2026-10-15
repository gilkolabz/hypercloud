/**
 * Addressing: callins omit the navi prefix (navi('surf') → park path `surf`).
 * Bare module callins map to bare tip ibs (flat parks; surf included).
 * Profile/surface callins (storage, relay, stamp, …) are bare tips.
 * Keep intentional navi ns: navi, navi:mod, navi:init_script.
 * Units: unit:NN (runtime-minted); optional path unit/01/surf/… or navi/unit/01/…
 * Bare storage keys presume navi: (file.save('horizon/enter') → navi:horizon/enter).
 * Park/surf paths do NOT presume: horizon/enter ≠ navi:horizon/enter.
 * `/` and `:` are NOT rewritten on write — names are preserved.
 * Lookup equates separators within the same space (navi: ↔ navi/, bare / ↔ :).
 * Design: A_document/navi_units.html
 */
import naviFrame from '../../C_devops/navi_redux/seed/navi.frame.json';
import naviModFrame from '../../C_devops/navi_redux/seed/navi_mod.frame.json';
import naviRelayFrame from '../../C_devops/navi_redux/seed/navi_relay.frame.json';
import naviInitScriptFrame from '../../C_devops/navi_redux/seed/navi_init_script.frame.json';
import naviSurfFrame from '../../C_devops/navi_redux/seed/navi_surf.frame.json';
import naviMountFrame from '../../C_devops/navi_redux/seed/navi_mount.frame.json';
import naviBrowseFrame from '../../C_devops/navi_redux/seed/navi_browse.frame.json';
import naviUnmountFrame from '../../C_devops/navi_redux/seed/navi_unmount.frame.json';
import naviSurfrefreshFrame from '../../C_devops/navi_redux/seed/navi_surfrefresh.frame.json';
import naviStorageFrame from '../../C_devops/navi_redux/seed/navi_storage.frame.json';
import naviRelayLogFrame from '../../C_devops/navi_redux/seed/navi_relay_log.frame.json';
import naviStampFrame from '../../C_devops/navi_redux/seed/navi_stamp.frame.json';
import naviOriginFrame from '../../C_devops/navi_redux/seed/navi_origin.frame.json';
import naviParkFrame from '../../C_devops/navi_redux/seed/navi_park.frame.json';
import naviPwaFrame from '../../C_devops/navi_redux/seed/navi_pwa.frame.json';
import naviSwFrame from '../../C_devops/navi_redux/seed/navi_sw.frame.json';
import naviFetchFrame from '../../C_devops/navi_redux/seed/navi_fetch.frame.json';
import naviUnitProfileFrame from '../../C_devops/navi_redux/seed/navi_unit_profile.frame.json';
import naviPlugFrame from '../../C_devops/navi_redux/seed/navi_plug.frame.json';
import naviNativeFrame from '../../C_devops/navi_redux/seed/navi_native.frame.json';
import naviReseedFrame from '../../C_devops/navi_redux/seed/navi_reseed.frame.json';
import naviFactoryresetFrame from '../../C_devops/navi_redux/seed/navi_factoryreset.frame.json';
import naviAliasFrame from '../../C_devops/navi_redux/seed/navi_alias.frame.json';
import naviPruneFrame from '../../C_devops/navi_redux/seed/navi_prune.frame.json';
import naviResolveFrame from '../../C_devops/navi_redux/seed/navi_resolve.frame.json';
import naviHeartbeatFrame from '../../C_devops/navi_redux/seed/navi_heartbeat.frame.json';
import naviReindexFrame from '../../C_devops/navi_redux/seed/navi_reindex.frame.json';
import naviTokensFrame from '../../C_devops/navi_redux/seed/navi_tokens.frame.json';

export type NaviTipFrame = {
    ib: string;
    gib: string;
    data: Record<string, any>;
    rel8ns?: Record<string, any>;
};

export type NaviBinRecord = {
    media: string;
    mime: string;
    sha?: string;
};

/** Trim + strip leading slashes only — do not rewrite / vs :. */
export function normalizeTipIb(ib: string): string {
    return String(ib || '')
        .trim()
        .replace(/^\/+/, '');
}

/**
 * Identity normalize for storage keys (preserves space / : / as the author wrote them).
 * Kept as canonicalizeTipIb for call-site compatibility.
 */
export function canonicalizeTipIb(ib: string): string {
    return normalizeTipIb(ib);
}

function isAbsoluteUrl(s: string): boolean {
    return /^[a-z][a-z0-9+.-]*:\/\//i.test(s);
}

/** True when `s` is an absolute http(s)/ws(s)/… URL (`scheme://…`). */
export function isAbsoluteHttpUrl(s: string): boolean {
    return isAbsoluteUrl(s);
}

const LOOKUP_DELIMS = [' ', ':', '/'] as const;
const MAX_FREE_GAPS = 8;

/** Incoming `%20` is a space, not a name and not a 4th delimiter. */
function pct20ToSpace(s: string): string {
    return String(s || '').replace(/%20/gi, ' ');
}

function tokenizeIb(ib: string): { segments: string[]; gaps: string[] } {
    const s = normalizeTipIb(pct20ToSpace(ib));
    const segments: string[] = [];
    const gaps: string[] = [];
    let buf = '';
    let i = 0;
    const pushSeg = () => {
        if (!buf) return;
        segments.push(buf);
        buf = '';
    };
    while (i < s.length) {
        if (s.startsWith('//', i)) {
            pushSeg();
            if (segments.length) gaps.push('//');
            i += 2;
            continue;
        }
        const c = s[i];
        if (c === ':' || c === '/' || /\s/.test(c)) {
            pushSeg();
            if (!segments.length) {
                i += 1;
                continue;
            }
            if (/\s/.test(c)) {
                while (i < s.length && /\s/.test(s[i]) && !s.startsWith('//', i)) {
                    i += 1;
                }
                gaps.push(' ');
            } else {
                gaps.push(c);
                i += 1;
            }
            continue;
        }
        buf += c;
        i += 1;
    }
    pushSeg();
    while (gaps.length >= segments.length) gaps.pop();
    return { segments, gaps };
}

function joinIb(segments: string[], gaps: string[]): string {
    if (!segments.length) return '';
    let out = segments[0];
    const n = Math.min(gaps.length, segments.length - 1);
    for (let i = 0; i < n; i++) {
        out += gaps[i] + segments[i + 1];
    }
    for (let i = n + 1; i < segments.length; i++) {
        out += ' ' + segments[i];
    }
    return out;
}

/**
 * Lookup keys for park/tip race — same on localpark and hostpark.
 * `%20` becomes space before search. Exact ib first, then every mix of the
 * same segments. Rank left-to-right: space, then `:`, then `/`.
 * Frozen `//` gaps stay. Does NOT bridge bare ↔ navi:.
 */
export function tipIbLookupKeys(ib: string): string[] {
    const raw = normalizeTipIb(pct20ToSpace(ib));
    if (!raw) return [];
    if (isAbsoluteUrl(raw)) return [raw];
    if (raw === 'navi') return ['navi'];

    const { segments, gaps } = tokenizeIb(raw);
    if (segments.length <= 1) return [raw];

    const freeIdx: number[] = [];
    for (let i = 0; i < segments.length - 1; i++) {
        if ((gaps[i] || ' ') !== '//') freeIdx.push(i);
    }

    const keys: string[] = [];
    const seen = new Set<string>();
    const add = (k: string) => {
        if (!k || seen.has(k)) return;
        seen.add(k);
        keys.push(k);
    };
    add(raw);

    const n = freeIdx.length;
    if (!n) return keys;

    const emit = (pick: (k: number) => string) => {
        const next = gaps.slice();
        while (next.length < segments.length - 1) next.push(LOOKUP_DELIMS[0]);
        for (let k = 0; k < n; k++) {
            next[freeIdx[k]] = pick(k);
        }
        add(joinIb(segments, next.slice(0, segments.length - 1)));
    };

    if (n > MAX_FREE_GAPS) {
        for (const d of LOOKUP_DELIMS) emit(() => d);
        return keys;
    }

    const radix = LOOKUP_DELIMS.length;
    const total = radix ** n;
    for (let i = 0; i < total; i++) {
        emit((k) => {
            const digit = Math.floor(i / radix ** (n - 1 - k)) % radix;
            return LOOKUP_DELIMS[digit];
        });
    }
    return keys;
}

export function delimiterRaceSignature(ib: string): string {
    const raw = normalizeTipIb(pct20ToSpace(ib));
    if (!raw) return '';
    if (isAbsoluteUrl(raw)) return 'abs:' + raw;
    const { segments, gaps } = tokenizeIb(raw);
    const marks: string[] = [];
    for (let i = 0; i < segments.length - 1; i++) {
        marks.push((gaps[i] || ' ') === '//' ? '//' : '*');
    }
    return segments.join('\0') + '\n' + marks.join('\0');
}

/** Live tip ibs in the same delimiter race as `want` (`:` `/` space interchangeable; `//` frozen). */
export function liveDelimiterHits(want: string, live: string[]): string[] {
    const sig = delimiterRaceSignature(want);
    if (!sig) return [];
    const raw = normalizeTipIb(pct20ToSpace(want));
    const hits = live.filter((ib) => delimiterRaceSignature(ib) === sig);
    if (raw && hits.includes(raw)) {
        return [raw, ...hits.filter((h) => h !== raw)];
    }
    return hits;
}

export function tipIbsMatch(a: string, b: string): boolean {
    const sa = delimiterRaceSignature(a);
    return !!sa && sa === delimiterRaceSignature(b);
}

/** Join segments with `/` (frozen `//` gaps kept). */
export function slashJoinedIb(ib: string): string {
    const raw = normalizeTipIb(ib);
    if (!raw || isAbsoluteUrl(raw)) return raw;
    const { segments, gaps } = tokenizeIb(raw);
    if (segments.length <= 1) return raw;
    const next = gaps.slice();
    while (next.length < segments.length - 1) next.push('/');
    for (let i = 0; i < segments.length - 1; i++) {
        if (next[i] !== '//') next[i] = '/';
    }
    return joinIb(segments, next.slice(0, segments.length - 1));
}

/** Manifest `data.gate === true` — delimiter-race winner (strict boolean). */
export function isTipGateTrue(data: unknown): boolean {
    return !!(
        data &&
        typeof data === 'object' &&
        (data as { gate?: unknown }).gate === true
    );
}

/** Header X-Navi-Gate-Passthru: skip gated winner, use rank / exact. */
export function isGatePassthruHeader(value: unknown): boolean {
    const s = String(value ?? '')
        .trim()
        .toLowerCase();
    return s === '1' || s === 'true' || s === 'yes';
}

/** Path segments — space, `/`, and `:` are separators. `//` is kept as a gap, not a segment. `%20` is space. */
export function ibSegments(ib: string): string[] {
    if (isAbsoluteUrl(ib)) return [];
    return tokenizeIb(ib).segments;
}

/** Parse `bin <sha>` → lowercase sha hex. */
export function parseBinRef(ref: string): string | null {
    const m = String(ref || '')
        .trim()
        .match(/^bin\s+([0-9a-fA-F]+)$/);
    return m ? m[1].toLowerCase() : null;
}

export function binRef(sha: string): string {
    return `bin ${String(sha || '')
        .trim()
        .toLowerCase()}`;
}

/**
 * Map a storage key into navi space without renaming separators.
 * 'foo' → navi:foo
 * 'horizon/enter' → navi:horizon/enter
 * 'navi/horizon/enter' → navi/horizon/enter (unchanged)
 *
 * Kept for alias / explicit navi-ns helpers — NOT used by storage.item/file.
 */
export function presumeNaviIb(key: string): string {
    const k = normalizeTipIb(key);
    if (!k) return 'navi';
    if (k === 'navi' || /^navi[/:\s]/.test(k)) {
        return k;
    }
    return `navi:${k}`;
}

/** Tip ib for storage.item — bare key (localpark can overlay hostpark). */
export function storageItemTipIb(key: string): string {
    return normalizeTipIb(key);
}

/** Tip ib for storage.file — bare path (localpark can overlay hostpark). */
export function storageFileTipIb(filePath: string): string {
    return normalizeTipIb(filePath);
}

/** Relative key for call-site UX (strip leading navi: or navi/). */
export function relativeNaviKey(ib: string): string {
    const c = normalizeTipIb(ib);
    if (c === 'navi') return '';
    if (c.startsWith('navi:')) return c.slice('navi:'.length);
    if (c.startsWith('navi/')) return c.slice('navi/'.length);
    if (c.startsWith('navi ')) return c.slice('navi '.length);
    return c;
}

export const NAVI_REDUX_SEED_TIPS: NaviTipFrame[] = [
    naviFrame as NaviTipFrame,
    naviModFrame as NaviTipFrame,
    naviRelayFrame as NaviTipFrame,
    naviInitScriptFrame as NaviTipFrame,
    naviSurfFrame as NaviTipFrame,
    naviMountFrame as NaviTipFrame,
    naviBrowseFrame as NaviTipFrame,
    naviUnmountFrame as NaviTipFrame,
    naviSurfrefreshFrame as NaviTipFrame,
    naviStorageFrame as NaviTipFrame,
    naviRelayLogFrame as NaviTipFrame,
    naviStampFrame as NaviTipFrame,
    naviOriginFrame as NaviTipFrame,
    naviParkFrame as NaviTipFrame,
    naviPwaFrame as NaviTipFrame,
    naviSwFrame as NaviTipFrame,
    naviFetchFrame as NaviTipFrame,
    naviUnitProfileFrame as NaviTipFrame,
    naviPlugFrame as NaviTipFrame,
    naviNativeFrame as NaviTipFrame,
    naviReseedFrame as NaviTipFrame,
    naviFactoryresetFrame as NaviTipFrame,
    naviAliasFrame as NaviTipFrame,
    naviPruneFrame as NaviTipFrame,
    naviResolveFrame as NaviTipFrame,
    naviHeartbeatFrame as NaviTipFrame,
    naviReindexFrame as NaviTipFrame,
    naviTokensFrame as NaviTipFrame,
];

export const NAVI_ROOT_IB = 'navi';
/** Boot script tip — stays under navi: (not a user callin target). */
export const NAVI_INIT_SCRIPT_IB = 'navi:init_script';
/** Planted-module ledger — intentional navi: namespace. */
export const NAVI_MOD_INDEX_IB = 'navi:mod';
/** Surf is a flat module park (same as user mods) — bare ib. */
export const NAVI_SURF_IB = 'surf';
export const NAVI_STORAGE_IB = 'storage';
export const NAVI_RELAY_IB = 'relay';
export const NAVI_RELAY_LOG_IB = 'relay:log';
/** Callin event log — one callin per mut8 (lineage via past). */
export const NAVI_CALLIN_IB = 'callin:log';
/** Unit system bookkeeping tip (not unit:NN instances). */
export const NAVI_UNIT_SYSTEM_IB = 'unit';
export const NAVI_PLUG_IB = 'plug';
export const NAVI_NATIVE_IB = 'native';
/** @deprecated leftover parks; same surface as NAVI_NATIVE_IB */
export const NAVI_LOCALNAVI_IB = NAVI_NATIVE_IB;
/** @deprecated retired — use navi.storage.kill + reseed / factoryreset + relay */
export const NAVI_ADMIN_IB = 'admin';
/** @deprecated retired — tip-per-navi.* instead */
export const NAVI_SHELL_IB = 'shell';

export function unitParkIb(id: string | number): string {
    const raw = String(id || '').trim();
    const n = /^\d+$/.test(raw) ? raw.padStart(2, '0') : raw;
    return `unit:${n}`;
}

/**
 * Park tip ib for a mounted module (surf + user mods).
 * Bare single-segment name — not navi:<name>, not navi:mod:<name>.
 * navi:mod remains the planted-module ledger index only.
 */
export function moduleParkIb(name: string): string {
    const n = String(name || '')
        .trim()
        .replace(/^navi[/:]/, '')
        .replace(/^mod[/:]/, '');
    if (!n || /[/:]/.test(n)) {
        throw new Error(
            `[navi] module park name must be a single segment (got '${name}')`
        );
    }
    return canonicalizeTipIb(n);
}

/** Park tip `data.method` block (GET/POST/PUT/… controls). */
export function parkMethodBlock(
    tip: { data?: Record<string, any> } | null | undefined
): Record<string, any> {
    const block = tip?.data?.method;
    if (block && typeof block === 'object' && !Array.isArray(block)) {
        return block;
    }
    const http = tip?.data?.http;
    if (!http || typeof http !== 'object' || Array.isArray(http)) {
        return {};
    }
    const out: Record<string, any> = {};
    for (const [verb, ctrl] of Object.entries(http)) {
        if (!ctrl || typeof ctrl !== 'object' || Array.isArray(ctrl)) continue;
        const next: Record<string, any> = { ...(ctrl as Record<string, any>) };
        if (Array.isArray(next.actions) && !next.commands) {
            next.commands = next.actions.map(String);
            delete next.actions;
        }
        out[verb] = next;
    }
    return out;
}

export type ParkMethod =
    | 'GET'
    | 'POST'
    | 'PUT'
    | 'PATCH'
    | 'DELETE';

const PARK_METHODS: ParkMethod[] = [
    'GET',
    'POST',
    'PUT',
    'PATCH',
    'DELETE',
];

/** Normalize callin / park dispatch verb (unknown → fallback). */
export function normalizeParkMethod(
    raw: string | undefined | null,
    fallback: ParkMethod = 'POST'
): ParkMethod {
    const m = String(raw || fallback)
        .trim()
        .toUpperCase();
    if (PARK_METHODS.includes(m as ParkMethod)) {
        return m as ParkMethod;
    }
    return fallback;
}

/** PUT/PATCH/DELETE must match `data.method` exactly — no GET/POST fallback. */
export function isStrictParkMethod(method: string): boolean {
    const m = String(method || '').toUpperCase();
    return m === 'PUT' || m === 'PATCH' || m === 'DELETE';
}

/** Resolved control for a park dispatch method (GET/POST fallback only for GET/POST). */
export function parkMethodCtrl(
    tip: { data?: Record<string, any> } | null | undefined,
    method: string
): Record<string, any> | undefined {
    const block = parkMethodBlock(tip);
    const m = String(method || 'GET').toUpperCase();
    const exact = block[m];
    if (exact && typeof exact === 'object') return exact;
    if (isStrictParkMethod(m)) return undefined;
    const fb = block.GET || block.POST;
    return fb && typeof fb === 'object' ? fb : undefined;
}

/**
 * Which tip.rel8ns.bin entry a method control serves (same rules as hostpark).
 *   ctrl.select { "<args[0]>": index | "bin <sha>" } + ctrl.default
 *   ctrl.bin    index | "bin <sha>" (fixed)
 *   else        rel8ns.bin[0]
 * Only refs already listed in rel8ns.bin are servable.
 */
export function selectParkBinRef(
    tip: { rel8ns?: Record<string, any> } | null | undefined,
    ctrl: Record<string, any> | null | undefined,
    args: string[] = []
): { sha: string; key?: string; selected: boolean } | { error: string } {
    const bins = Array.isArray(tip?.rel8ns?.bin)
        ? (tip!.rel8ns!.bin as any[]).map(String)
        : [];
    if (!bins.length) return { error: 'bin control requires rel8ns.bin' };
    const shaOf = (s: any) =>
        String(s ?? '')
            .replace(/^bin\s+/i, '')
            .trim()
            .toLowerCase();
    const pick = (v: any): string => {
        if (v == null || v === '') return '';
        if (typeof v === 'number' || /^\d+$/.test(String(v).trim())) {
            const ref = bins[Number(v)];
            return ref ? shaOf(ref) : '';
        }
        const want = shaOf(v);
        return bins.some((b) => shaOf(b) === want) ? want : '';
    };
    const key = String(args[0] ?? '');
    let chosen: any;
    if (ctrl?.select && typeof ctrl.select === 'object') {
        if (key && Object.prototype.hasOwnProperty.call(ctrl.select, key)) {
            chosen = ctrl.select[key];
        } else if (ctrl.default != null) {
            chosen = ctrl.default;
        } else {
            return { error: key ? `no bin case '${key}'` : 'bin case required' };
        }
    } else if (ctrl?.bin != null) {
        chosen = ctrl.bin;
    } else {
        return { sha: shaOf(bins[0]), selected: false };
    }
    const sha = pick(chosen);
    if (!sha) return { error: `bin selection '${chosen}' is not in rel8ns.bin` };
    return { sha, key, selected: true };
}

export function defaultModuleCommand(
    name: string,
    allowed: string[],
    prefer = 'list'
): string {
    if (!allowed.length) return '';
    const pick = String(prefer || '').trim();
    if (pick && allowed.includes(pick)) return pick;
    if (allowed.includes(name)) return name;
    return allowed[0];
}

/** Optional `methods` / `transport` on a mod command → GET and/or POST. */
export function commandTransports(
    cmd: any
): ('GET' | 'POST')[] | null {
    const raw = cmd?.methods ?? cmd?.transport;
    if (raw == null) return null;
    const arr = Array.isArray(raw) ? raw : [raw];
    const out = arr
        .map((s) => String(s).toUpperCase())
        .filter((s) => s === 'GET' || s === 'POST') as ('GET' | 'POST')[];
    return out.length ? out : null;
}

/** Commands allowed on a transport; all keys when no command declares transport. */
export function moduleCommandsForTransport(
    moduleObject: any,
    transport: 'GET' | 'POST'
): string[] {
    const commands = moduleObject?.commands;
    if (!commands || typeof commands !== 'object') return [];
    const keys = Object.keys(commands);
    if (keys.length <= 1) return keys;
    const anyHint = keys.some((k) => commandTransports(commands[k]) != null);
    if (!anyHint) return keys;
    return keys.filter((k) => {
        const t = commandTransports(commands[k]);
        return t ? t.includes(transport) : false;
    });
}

/** Peelable callin verbs on the active transport control (`method.GET.commands`, etc.). */
export function parkMethodCommands(
    tip: { data?: Record<string, any> } | null | undefined,
    method?: string
): string[] {
    if (method) {
        const ctrl = parkMethodCtrl(tip, method);
        return Array.isArray(ctrl?.commands)
            ? ctrl!.commands.map(String)
            : [];
    }
    const block = parkMethodBlock(tip);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const verb of ['GET', 'POST'] as const) {
        const ctrl = block[verb];
        if (!ctrl || !Array.isArray(ctrl.commands)) continue;
        for (const c of ctrl.commands.map(String)) {
            if (seen.has(c)) continue;
            seen.add(c);
            out.push(c);
        }
    }
    return out;
}
