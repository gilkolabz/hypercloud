import type { NaviTipFrame } from './navi_redux_seeds';
import { canonicalizeTipIb, normalizeTipIb } from './navi_redux_seeds';

/** Lineage walk order for `navi.storage.tip.span`. */
export type TipSpanDir = 'forward' | 'reverse' | 'all';

/** Options for `navi.storage.tip.span` / `tipSpan`. */
export type TipSpanOpts = {
    /** Max frames (omit or `all` dir = entire chain after offset). */
    limit?: number;
    /** Skip from the chosen end (default 0). */
    offset?: number;
    /** reverse = newest first; forward = oldest first; all = full chain oldest→newest. */
    dir?: TipSpanDir;
    /** Return ib^gib addrs only. */
    addrsOnly?: boolean;
};

/** One generation along a tip's past chain (head = newest). */
export type TipSpanHit = {
    addr: string;
    ib: string;
    gib: string;
    frame: NaviTipFrame;
};

export type TipSpanDeltaKind =
    | 'event'
    | 'op'
    | 'op_add'
    | 'op_remove'
    | 'park_add'
    | 'park_remove'
    | 'patch';

export type TipSpanDelta = {
    addr: string;
    ib: string;
    /** Steps back from the tip (tip = 0). */
    depth: number;
    kind: TipSpanDeltaKind;
    key?: string;
    path?: string;
    payload?: Record<string, any>;
};

export type TipSpanDiffOpts = TipSpanOpts & {
    /** Fold ledger keys (mod parks by name, etc.) across the span. */
    fold?: boolean;
};

export type TipSpanDiffResult = {
    ib: string;
    hits: TipSpanHit[];
    deltas: TipSpanDelta[];
    folded?: Record<string, any>;
};

export type TipSpanDeps = {
    getTip: (ib: string) => Promise<NaviTipFrame | null>;
    getTipFrame: (addr: string) => Promise<NaviTipFrame | null>;
};

export function normalizeTipSpanDir(raw?: string): TipSpanDir {
    const d = String(raw || '').trim().toLowerCase();
    if (d === 'forward' || d === 'all') return d;
    return 'reverse';
}

/** Walk past from the tip, newest first. `max` stops after that many hits. */
export async function walkTipLineage(
    ib: string,
    deps: TipSpanDeps,
    max?: number
): Promise<TipSpanHit[]> {
    const want = canonicalizeTipIb(ib) || normalizeTipIb(ib);
    if (!want) return [];
    const cap =
        max != null && Number.isFinite(Number(max))
            ? Math.max(0, Math.floor(Number(max)))
            : Infinity;
    if (cap === 0) return [];
    const head = await deps.getTip(want);
    if (!head) return [];
    const hits: TipSpanHit[] = [];
    const seen = new Set<string>();
    let frame: NaviTipFrame | null = head;
    while (frame && hits.length < cap) {
        const tipIb = canonicalizeTipIb(frame.ib || want) || want;
        const gib = String(frame.gib || '').trim();
        if (!gib) break;
        const addr = `${tipIb}^${gib}`;
        if (seen.has(addr)) break;
        seen.add(addr);
        hits.push({
            addr,
            ib: tipIb,
            gib,
            frame,
        });
        if (hits.length >= cap) break;
        const past0 = Array.isArray(frame.rel8ns?.past)
            ? String(frame.rel8ns.past[0] || '').trim()
            : '';
        if (!past0) break;
        frame = await deps.getTipFrame(past0);
    }
    return hits;
}

/**
 * Hits needed from the tip to satisfy opts. Only a bounded reverse span can
 * stop early; forward/all start at the oldest end, which needs the full walk.
 */
export function tipSpanWalkMax(opts: TipSpanOpts = {}): number | undefined {
    if (normalizeTipSpanDir(opts.dir) !== 'reverse') return undefined;
    const limit = Number(opts.limit);
    if (opts.limit == null || !Number.isFinite(limit)) return undefined;
    const offset = Math.max(0, Math.floor(Number(opts.offset) || 0));
    return offset + Math.max(0, Math.floor(limit));
}

export function orderTipSpanHits(
    chain: TipSpanHit[],
    opts: TipSpanOpts = {}
): TipSpanHit[] {
    const dir = normalizeTipSpanDir(opts.dir);
    const offset = Math.max(0, Math.floor(Number(opts.offset) || 0));
    const ordered =
        dir === 'reverse'
            ? chain
            : chain.slice().reverse();
    const limitRaw = opts.limit;
    if (limitRaw != null && Number.isFinite(Number(limitRaw))) {
        return ordered.slice(
            offset,
            offset + Math.max(0, Math.floor(Number(limitRaw)))
        );
    }
    return ordered.slice(offset);
}

export async function tipSpan(
    ib: string,
    deps: TipSpanDeps,
    opts: TipSpanOpts = {}
): Promise<TipSpanHit[] | string[]> {
    const chain = await walkTipLineage(ib, deps, tipSpanWalkMax(opts));
    const slice = orderTipSpanHits(chain, opts);
    if (opts.addrsOnly) return slice.map((h) => h.addr);
    return slice;
}

function opAction(entry: Record<string, any>): 'add' | 'remove' {
    const action = String(entry?.action || entry?.op || '').toLowerCase();
    if (action === 'remove' || action === 'del' || action === 'delete') {
        return 'remove';
    }
    return 'add';
}

function parkKey(entry: Record<string, any>): string {
    return (
        String(entry?.name || '').trim() ||
        String(entry?.['ib^gib'] || entry?.ib_gib || '').trim() ||
        JSON.stringify(entry)
    );
}

function extractHitDeltas(
    hit: TipSpanHit,
    depth: number,
    prev?: NaviTipFrame | null
): TipSpanDelta[] {
    const data = hit.frame?.data || {};
    const out: TipSpanDelta[] = [];
    const base = {
        addr: hit.addr,
        ib: hit.ib,
        depth,
    };

    if (data.event && typeof data.event === 'object') {
        const ev = data.event as Record<string, any>;
        out.push({
            ...base,
            kind: 'event',
            key: String(ev.kind || depth),
            payload: ev,
        });
        if (ev.kind === 'ops-batch' && Array.isArray(ev.ops)) {
            const act = String(ev.action || 'add').toLowerCase();
            for (const entry of ev.ops) {
                if (!entry || typeof entry !== 'object') continue;
                out.push({
                    ...base,
                    kind: act === 'remove' ? 'op_remove' : 'op_add',
                    key: String(entry.id || entry.path || entry.target_ib || depth),
                    path: entry.path ? String(entry.path) : undefined,
                    payload: entry,
                });
            }
        }
    }

    const pushOp = (entry: Record<string, any>) => {
        if (!entry || typeof entry !== 'object') return;
        const act = opAction(entry);
        out.push({
            ...base,
            kind: act === 'remove' ? 'op_remove' : 'op_add',
            key: String(entry.id || entry.path || entry.target_ib || depth),
            path: entry.path ? String(entry.path) : undefined,
            payload: entry,
        });
    };

    if (data.op && typeof data.op === 'object') pushOp(data.op);
    if (Array.isArray(data.ops)) {
        for (const entry of data.ops) pushOp(entry);
    }
    if (Array.isArray(data.op_deltas)) {
        for (const entry of data.op_deltas) pushOp(entry);
    }
    if (Array.isArray(data.op_remove)) {
        for (const entry of data.op_remove) {
            pushOp({ ...(entry || {}), action: 'remove' });
        }
    }

    const parks = Array.isArray(data.parks) ? data.parks : null;
    const prevParks = Array.isArray(prev?.data?.parks) ? prev!.data!.parks : null;
    if (parks && prevParks) {
        const prevMap = new Map(
            prevParks.map((p: any) => [parkKey(p), p])
        );
        const nextMap = new Map(parks.map((p: any) => [parkKey(p), p]));
        for (const [key, entry] of nextMap) {
            if (!prevMap.has(key)) {
                out.push({
                    ...base,
                    kind: 'park_add',
                    key,
                    payload: entry,
                });
            }
        }
        for (const [key, entry] of prevMap) {
            if (!nextMap.has(key)) {
                out.push({
                    ...base,
                    kind: 'park_remove',
                    key,
                    payload: entry,
                });
            }
        }
    } else if (parks && !prevParks && parks.length) {
        for (const entry of parks) {
            out.push({
                ...base,
                kind: 'park_add',
                key: parkKey(entry),
                payload: entry,
            });
        }
    }

    if (!out.length && data && Object.keys(data).length) {
        out.push({
            ...base,
            kind: 'patch',
            key: String(depth),
            payload: data,
        });
    }

    return out;
}

export function foldTipSpanDeltas(deltas: TipSpanDelta[]): Record<string, any> {
    const folded: Record<string, any> = {
        events: [] as any[],
        ops: [] as any[],
        parks: {} as Record<string, any>,
    };
    for (const d of deltas) {
        if (d.kind === 'event' && d.payload) {
            folded.events.push(d.payload);
            continue;
        }
        if (d.kind === 'op_add' || d.kind === 'op') {
            const key = d.key || d.path || String(folded.ops.length);
            const idx = folded.ops.findIndex(
                (o: any) => String(o?.id || o?.path || '') === key
            );
            if (idx >= 0) folded.ops[idx] = d.payload;
            else folded.ops.push(d.payload);
            continue;
        }
        if (d.kind === 'op_remove') {
            const key = d.key || d.path || '';
            folded.ops = folded.ops.filter(
                (o: any) => String(o?.id || o?.path || '') !== key
            );
            continue;
        }
        if (d.kind === 'park_add' && d.key) {
            folded.parks[d.key] = d.payload;
            continue;
        }
        if (d.kind === 'park_remove' && d.key) {
            delete folded.parks[d.key];
        }
    }
    return folded;
}

export async function tipSpanDiff(
    ib: string,
    deps: TipSpanDeps,
    opts: TipSpanDiffOpts = {}
): Promise<TipSpanDiffResult> {
    const spanOpts: TipSpanOpts = {
        ...opts,
        dir:
            opts.dir === 'reverse'
                ? 'reverse'
                : opts.dir === 'all'
                  ? 'all'
                  : 'forward',
    };
    const chain = await walkTipLineage(ib, deps, tipSpanWalkMax(spanOpts));
    const hits = orderTipSpanHits(chain, spanOpts);
    const chronological =
        opts.dir === 'reverse' ? hits.slice().reverse() : hits;
    const depthOf = new Map(chain.map((h, i) => [h.addr, i] as const));
    const deltas: TipSpanDelta[] = [];
    let prev: NaviTipFrame | null = null;
    for (const hit of chronological) {
        deltas.push(...extractHitDeltas(hit, depthOf.get(hit.addr) ?? 0, prev));
        prev = hit.frame;
    }
    const result: TipSpanDiffResult = {
        ib: canonicalizeTipIb(ib) || normalizeTipIb(ib),
        hits,
        deltas,
    };
    if (opts.fold !== false) {
        result.folded = foldTipSpanDeltas(deltas);
    }
    return result;
}

/** Parse mirror/span path: `ib @span [reverse|forward|all] [limit]`. */
export function parseTipSpanPathSpec(raw: string): {
    ib: string;
    span: TipSpanOpts | null;
} {
    const s = String(raw || '').trim();
    const m = s.match(
        /^(.+?)\s+@span(?:\s+(reverse|forward|all))?(?:\s+(\d+))?\s*$/i
    );
    if (!m) return { ib: s, span: null };
    const dir = normalizeTipSpanDir(m[2] || 'reverse');
    const limit = m[3] != null ? Number(m[3]) : undefined;
    return {
        ib: String(m[1] || '').trim(),
        span: { dir, ...(limit != null ? { limit } : {}) },
    };
}
