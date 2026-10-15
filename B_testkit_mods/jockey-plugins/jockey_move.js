/**
 * jockey-move — two independent stagedir movers in one module:
 *   1) scrollbuffer claim `move` — 3×3 grid only (middle-click arm/execute)
 *   2) redselectDrag — left-press+drag while a red-select is already active
 * They share applySlot / stagedir, not the same gesture.
 */

const SLOT_GRID_DEFAULT = [
    ["USL", "USC", "USR"],
    ["SL", "CS", "SR"],
    ["DSL", "DSC", "DSR"],
];

const STAGE_SLOTS = [
    "USL",
    "USC",
    "USR",
    "SL",
    "CS",
    "SR",
    "DSL",
    "DSC",
    "DSR",
];

/** Match stagedir flip: bands become columns, L/C/R become rows (visual transpose). */
function slotGridForStage(stage) {
    const flipped =
        stage &&
        typeof stage.isFlipped === "function" &&
        stage.isFlipped();
    if (!flipped) return SLOT_GRID_DEFAULT;
    return SLOT_GRID_DEFAULT[0].map((_, col) =>
        SLOT_GRID_DEFAULT.map((row) => row[col])
    );
}

function hasType(context, name) {
    const types = Array.isArray(context?.types) ? context.types : [];
    return types.includes(name) || context?.kind === name;
}

function dismissGrid(ui) {
    if (!ui) return;
    try {
        ui.root?.remove();
    } catch {
        /* ignore */
    }
    for (const [type, el, fn, opts] of ui.listeners || []) {
        try {
            el.removeEventListener(type, fn, opts);
        } catch {
            /* ignore */
        }
    }
}

function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
}

/** Shortest connector between two axis-aligned rects (points on each boundary). */
function rectConnector(a, b) {
    const cx1 = (a.left + a.right) / 2;
    const cy1 = (a.top + a.bottom) / 2;
    const cx2 = (b.left + b.right) / 2;
    const cy2 = (b.top + b.bottom) / 2;
    return {
        x1: clamp(cx2, a.left, a.right),
        y1: clamp(cy2, a.top, a.bottom),
        x2: clamp(cx1, b.left, b.right),
        y2: clamp(cy1, b.top, b.bottom),
    };
}


function ghostRectForZone(srcRect, srcZoneRect, destZoneRect) {
    const w = srcRect.width;
    const h = srcRect.height;
    const zoneW = Math.max(1, srcZoneRect.width);
    const zoneH = Math.max(1, srcZoneRect.height);
    const relX =
        zoneW > w
            ? (srcRect.left - srcZoneRect.left) / (zoneW - w)
            : 0.5;
    const relY =
        zoneH > h
            ? (srcRect.top - srcZoneRect.top) / (zoneH - h)
            : 0.5;
    const destW = Math.max(1, destZoneRect.width);
    const destH = Math.max(1, destZoneRect.height);
    const left =
        destZoneRect.left +
        clamp(relX, 0, 1) * Math.max(0, destW - w);
    const top =
        destZoneRect.top +
        clamp(relY, 0, 1) * Math.max(0, destH - h);
    return { left, top, width: w, height: h };
}

const SLOT_LABELS = {
    USL: "Upstage Left",
    USC: "Upstage Center",
    USR: "Upstage Right",
    SL: "Stage Left",
    CS: "Center Stage",
    SR: "Stage Right",
    DSL: "Downstage Left",
    DSC: "Downstage Center",
    DSR: "Downstage Right",
};

function slotMoveLabel(slot, zoneEl) {
    const name =
        zoneEl?.getAttribute?.("name") || SLOT_LABELS[slot] || slot;
    return `move ${String(name).toLowerCase()}`;
}


/** Stage zones scoped to the same stage as the red-select column (not document-wide). */
function collectStageZones(anchorZoneEl) {
    const zones = {};
    if (!(anchorZoneEl instanceof Element)) return zones;
    let root = anchorZoneEl;
    while (root && root !== document.documentElement) {
        const found = {};
        for (const id of STAGE_SLOTS) {
            const els = root.querySelectorAll(`[id="${id}"]`);
            for (const el of els) {
                if (el.id === id) {
                    found[id] = el;
                    break;
                }
            }
        }
        if (Object.keys(found).length >= 5) return found;
        root = root.parentElement;
    }
    if (anchorZoneEl.id && STAGE_SLOTS.includes(anchorZoneEl.id)) {
        zones[anchorZoneEl.id] = anchorZoneEl;
    }
    return zones;
}

/**
 * Target slot = zone in the pointed direction whose center is nearest the pointer.
 * Allows multi-row jumps (e.g. DSC → USC) when the pointer is past nearer zones.
 */
function targetSlotFromPointer(srcSlot, px, py, zoneMap) {
    const srcZone = zoneMap[srcSlot];
    if (!srcZone) return null;

    const zr = srcZone.getBoundingClientRect();
    const zx = (zr.left + zr.right) / 2;
    const zy = (zr.top + zr.bottom) / 2;
    const dx = px - zx;
    const dy = py - zy;
    const dist = Math.hypot(dx, dy);
    if (dist < 16) return null;

    let best = null;
    let bestPick = Infinity;
    for (const slot of STAGE_SLOTS) {
        if (slot === srcSlot) continue;
        const destZone = zoneMap[slot];
        if (!destZone) continue;
        const tr = destZone.getBoundingClientRect();
        const tx = (tr.left + tr.right) / 2;
        const ty = (tr.top + tr.bottom) / 2;
        const vx = tx - zx;
        const vy = ty - zy;
        const vlen = Math.hypot(vx, vy);
        if (vlen < 1) continue;
        const dot = (dx * vx + dy * vy) / (dist * vlen);
        if (dot < 0.42) continue;
        const pick = Math.hypot(px - tx, py - ty);
        if (pick < bestPick) {
            bestPick = pick;
            best = slot;
        }
    }
    return best;
}

function resolveSourceElement(context, api) {
    const pick = api.jockey?.select;
    if (pick?.itemEl instanceof HTMLElement) return pick.itemEl;
    const stage = api.stage;
    if (
        stage &&
        context?.slot &&
        context.index != null &&
        typeof stage.itemAt === "function"
    ) {
        return stage.itemAt(context.slot, context.index);
    }
    return null;
}

function partNames(raw) {
    return String(raw || "")
        .toLowerCase()
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
}

/** True when parent is a stage column (USL…DSR or a marched CS/R path). */
function stageColumnOf(el) {
    const parent = el?.parentElement;
    if (!(parent instanceof HTMLElement)) return null;
    const stamped = String(parent.getAttribute("data-stage-slot") || "").trim();
    if (stamped) return stamped;
    const id = parent.id;
    return id && STAGE_SLOTS.includes(id) ? id : null;
}

function isOnStage(el) {
    return !!stageColumnOf(el);
}

/**
 * Nearest stageable host under/at `el`: an htmf/html fragment (data-part) or any
 * element marked `data-stageable` — whichever is closer. Not a nested control.
 */
function findHtmfHost(el) {
    let node = el;
    if (node && node.nodeType !== 1) node = node.parentElement;
    while (node && node !== document.documentElement) {
        if (node instanceof HTMLElement) {
            if (node.hasAttribute("data-stageable")) return node;
            const parts = partNames(node.getAttribute("data-part"));
            if (parts.includes("htmf") || parts.includes("html")) return node;
        }
        node = node.parentElement;
    }
    return null;
}

const STAGEABLE_WRAPS = ["span", "div", "section", "figure"];

/**
 * What actually goes on stage for `el`.
 * - no `data-stageable`, or `data-stageable` / `="self"`: `el` itself.
 * - `data-stageable="span"` (or div/section/figure): a new `<span data-part="htmf">`
 *   styled by `data-stageable-style`, holding:
 *   - a clone of `<template data-stageable-content>` — `el` is a launcher and stays;
 *   - else the children of `[data-stageable-content]` (or of `el`) — `el` is a vessel
 *     and is removed.
 */
function materializeStageable(el) {
    if (!el.hasAttribute("data-stageable")) return el;
    const mode = String(el.getAttribute("data-stageable") || "")
        .trim()
        .toLowerCase();
    if (!mode || mode === "self") return el;
    if (!STAGEABLE_WRAPS.includes(mode)) {
        throw new Error(
            `data-stageable="${mode}" — use self or ${STAGEABLE_WRAPS.join("/")}`
        );
    }
    const wrap = document.createElement(mode);
    wrap.setAttribute("data-part", "htmf");
    const style = el.getAttribute("data-stageable-style");
    if (style) wrap.setAttribute("style", style);
    const content = el.querySelector("[data-stageable-content]") || el;
    if (content instanceof HTMLTemplateElement) {
        wrap.appendChild(content.content.cloneNode(true));
        return wrap;
    }
    while (content.firstChild) wrap.appendChild(content.firstChild);
    el.remove();
    return wrap;
}

/** Stage-column child that should leave the stage (prefer occupant, else htmf). */
function stageMemberForOffstage(el) {
    if (!(el instanceof HTMLElement)) return null;
    if (stageColumnOf(el)) return el;
    let node = el.parentElement;
    while (node && node !== document.documentElement) {
        if (stageColumnOf(node)) return node;
        node = node.parentElement;
    }
    return null;
}

function presentationForLive(stage, el) {
    let known = null;
    try {
        if (typeof stage?.presentationFor === "function") {
            known = stage.presentationFor(el);
        }
    } catch {
        /* ignore */
    }
    if (known) return known;
    const parts = partNames(el.getAttribute?.("data-part"));
    const type =
        parts.find((p) => p === "htmf" || p === "html") ||
        parts[0] ||
        "htmf";
    const path = String(el.getAttribute?.("data-path") || "")
        .trim()
        .replace(/^\/+/, "");
    const presentation = { type, value: el.outerHTML };
    if (path) presentation.path = path;
    return presentation;
}

/**
 * Append `el` to `parent`, via moveBefore() when both are live so iframes/video
 * keep playing (appendChild would reload them).
 */
function placeLive(parent, el) {
    if (
        typeof parent.moveBefore === "function" &&
        el.isConnected &&
        parent.isConnected
    ) {
        try {
            parent.moveBefore(el, null);
            return;
        } catch {
            /* fall through */
        }
    }
    parent.appendChild(el);
}

/** Column for slot, preferring the live stage root (avoid foreign #CS ids). */
function columnForSlot(stage, slot) {
    if (!STAGE_SLOTS.includes(slot)) return null;
    try {
        const root =
            typeof stage?.findRoot === "function" ? stage.findRoot() : null;
        if (root instanceof HTMLElement) {
            const hit = root.querySelector(`[id="${slot}"]`);
            if (hit instanceof HTMLElement) return hit;
        }
    } catch {
        /* ignore */
    }
    if (typeof stage?.ensureColumn === "function") {
        return stage.ensureColumn(slot);
    }
    return document.getElementById(slot);
}

/** Move a live DOM node into a stage slot (no HTML rehydrate / clone). */
async function adoptLive(stage, slot, el) {
    if (!stage) throw new Error("stage unavailable");
    if (!(el instanceof HTMLElement)) throw new Error("need live element");
    if (!STAGE_SLOTS.includes(slot)) throw new Error(`bad slot ${slot}`);
    const col = columnForSlot(stage, slot);
    if (!(col instanceof HTMLElement)) {
        throw new Error(`stage column ${slot} missing`);
    }
    // Must be a direct child of the slot for stagejockey locate()/redselect.
    if (el.parentElement === col) {
        /* already there */
    } else {
        stage.insertLogical(col, el, slot, null);
    }
    if (el.parentElement !== col) {
        // Fallback if insertLogical no-oped oddly.
        placeLive(col, el);
    }
    const presentation = presentationForLive(stage, el);
    if (typeof stage.rememberPresentation === "function") {
        stage.rememberPresentation(el, presentation);
    } else if (typeof stage.stampOccupantMeta === "function") {
        stage.stampOccupantMeta(
            el,
            presentation.type || null,
            presentation.path || null
        );
    }
    if (typeof stage.activate === "function") {
        try {
            stage.activate(el);
        } catch {
            /* ignore */
        }
    }
    if (typeof stage.applyBandDepth === "function") {
        try {
            stage.applyBandDepth();
        } catch {
            /* ignore */
        }
    }
    await stage.persist();
    if (el.parentElement !== col) {
        throw new Error(
            `adopt failed: ${slot} parent is ${el.parentElement?.id || el.parentElement?.tagName || "?"}`
        );
    }
    return el;
}

/** Lift a stage-column child out to document.body (same live node). */
async function detachLive(stage, el) {
    if (!(el instanceof HTMLElement)) throw new Error("need live element");
    const member = stageMemberForOffstage(el) || el;
    if (!stageColumnOf(member)) {
        // Already off stage.
        if (member.parentElement !== document.body && document.body) {
            placeLive(document.body, member);
        }
        return member;
    }
    if (document.body) placeLive(document.body, member);
    else member.remove();
    if (stage && typeof stage.persist === "function") {
        await stage.persist();
    }
    return member;
}

/**
 * Shared 3×3 picker used by the scrollbuffer claim and dropdown "move onstage".
 * `commitSlot(slot)` may be async; returns a Promise that resolves when dismissed.
 */
function openMoveGrid(api, commitSlot) {
    if (typeof document === "undefined") {
        return Promise.resolve(undefined);
    }
    return new Promise((resolve) => {
        const ui = { listeners: [] };
        const stage = api.stage;
        const grid = slotGridForStage(stage);
        const root = document.createElement("div");
        root.id = "jockey-move-grid";
        root.setAttribute("data-jockey-ui", "jockey-move");
        if (grid !== SLOT_GRID_DEFAULT) {
            root.setAttribute("data-stagedir-flipped", "1");
        }
        root.style.cssText = [
            "position:fixed",
            "z-index:2147483646",
            "display:grid",
            "grid-template-columns:repeat(3,minmax(2.4em,auto))",
            "gap:2px",
            "padding:4px",
            "background:rgba(0,0,0,.72)",
            "font:600 12px/1.2 monospace",
            "color:white",
            "pointer-events:auto",
        ].join(";");
        const vv = window.visualViewport;
        const ox = vv?.offsetLeft ?? 0;
        const oy = vv?.offsetTop ?? 0;
        const vw = vv?.width ?? window.innerWidth;
        const vh = vv?.height ?? window.innerHeight;
        // clientX/Y from supermouse / dropdown — not page coords.
        const px = Number(api.jockey?._pointer?.x ?? api.pointer?.x ?? 0) || 0;
        const py = Number(api.jockey?._pointer?.y ?? api.pointer?.y ?? 0) || 0;

        let settled = false;
        const finish = (next) => {
            if (settled) return;
            settled = true;
            dismissGrid(ui);
            resolve(next);
        };

        const cancel = () => {
            finish(undefined);
        };

        const runCommit = async (slot) => {
            let ok = false;
            try {
                await commitSlot(slot);
                ok = true;
            } catch (err) {
                console.error("[jockey-move]", err);
                if (typeof globalThis.navi?.callout === "function") {
                    globalThis.navi.callout(
                        `[jockey-move] ${err.message || err}`
                    );
                }
            }
            if (ok && typeof api.terminate === "function") {
                api.terminate();
            }
            finish(undefined);
        };

        for (const row of grid) {
            for (const slot of row) {
                const cell = document.createElement("button");
                cell.type = "button";
                cell.textContent = slot;
                cell.style.cssText =
                    "margin:0;padding:6px 8px;border:1px solid #666;background:#222;color:#eee;cursor:pointer;font:inherit";
                cell.addEventListener("mouseenter", () => {
                    cell.style.background = "#046";
                });
                cell.addEventListener("mouseleave", () => {
                    cell.style.background = "#222";
                });
                cell.addEventListener("click", async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    await runCommit(slot);
                });
                root.appendChild(cell);
            }
        }

        // Mount on <html> so body scroll/transform cannot offset fixed UI.
        const mount = document.documentElement || document.body;
        mount.appendChild(root);
        ui.root = root;
        const rect = root.getBoundingClientRect();
        const left = Math.max(
            ox + 8,
            Math.min(ox + px + 16, ox + vw - rect.width - 8)
        );
        const top = Math.max(
            oy + 8,
            Math.min(oy + py - 8, oy + vh - rect.height - 8)
        );
        root.style.left = `${left}px`;
        root.style.top = `${top}px`;

        const onDocDown = (e) => {
            if (!root.isConnected) {
                cancel();
                return;
            }
            if (root.contains(e.target)) return;
            e.preventDefault();
            e.stopPropagation();
            cancel();
        };
        const onKey = (e) => {
            if (e.key !== "Escape") return;
            e.preventDefault();
            e.stopPropagation();
            cancel();
        };
        document.addEventListener("mousedown", onDocDown, true);
        document.addEventListener("keydown", onKey, true);
        ui.listeners.push(["mousedown", document, onDocDown, true]);
        ui.listeners.push(["keydown", document, onKey, true]);
    });
}

async function applySlot(context, api, slot) {
    const stage = api.stage;
    if (!stage) throw new Error("stage unavailable");
    // Live DOM adopt (dropdown move onstage) — same node, no clone.
    if (
        context?.liveElement instanceof HTMLElement ||
        (hasType(context, "htmf") &&
            context?.element instanceof HTMLElement &&
            !hasType(context, "stage-member") &&
            !hasType(context, "offstage-member"))
    ) {
        const el = context.liveElement || context.element;
        await adoptLive(stage, slot, el);
    } else if (hasType(context, "stage-member")) {
        stage.move(context.slot, context.index, slot, null);
        await stage.persist();
    } else if (hasType(context, "offstage-member")) {
        const occ = context.occupant || context;
        const type = String(
            occ.type || context.part || context.presentation?.type || ""
        )
            .trim()
            .toLowerCase();
        const value =
            occ.value ?? context.presentation?.value ?? occ.html ?? "";
        if (type === "href") {
            await stage.addHref(slot, String(value));
        } else {
            const presentation = {
                value: String(value),
                ...(occ.ibgib ? { ibgib: occ.ibgib } : {}),
            };
            if (type) presentation.type = type;
            const path = String(
                occ.path || context.path || context.mediaPath || ""
            )
                .trim()
                .replace(/^\/+/, "");
            if (path) presentation.path = path;
            stage.addData(slot, String(value), null, presentation);
        }
        await stage.persist();
    } else {
        throw new Error("unsupported context for jockey-move");
    }
    if (typeof globalThis.navi?.callout === "function") {
        globalThis.navi.callout(`[jockey-move] → ${slot}`);
    }
}

function createRedselectPreview() {
    let root = null;
    let ghost = null;
    let ghostLabel = null;
    let line = null;
    let pendingSlot = null;

    const ensure = () => {
        if (root?.isConnected) return;
        root = document.createElement("div");
        root.id = "jockey-move-redselect";
        root.setAttribute("data-jockey-ui", "jockey-move-redselect");
        root.style.cssText = [
            "position:fixed",
            "inset:0",
            "z-index:2147483645",
            "pointer-events:none",
            "overflow:hidden",
        ].join(";");
        ghost = document.createElement("div");
        ghost.style.cssText = [
            "position:fixed",
            "box-sizing:border-box",
            "border:2px solid red",
            "background:rgba(255,0,0,.18)",
            "display:none",
            "z-index:2147483646",
            "pointer-events:none",
            "align-items:center",
            "justify-content:center",
            "text-align:center",
            "padding:4px",
        ].join(";");
        ghostLabel = document.createElement("span");
        ghostLabel.style.cssText = [
            "font:600 11px/1.25 monospace",
            "color:#ff2222",
            "text-shadow:0 0 3px #fff,0 1px 2px #000",
            "pointer-events:none",
            "user-select:none",
        ].join(";");
        ghost.appendChild(ghostLabel);
        line = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        line.style.cssText = [
            "position:fixed",
            "inset:0",
            "width:100%",
            "height:100%",
            "overflow:visible",
            "pointer-events:none",
        ].join(";");
        line.setAttribute("aria-hidden", "true");
        root.appendChild(line);
        root.appendChild(ghost);
        document.body.appendChild(root);
    };

    const hideVisual = () => {
        if (!ghost || !line) return;
        ghost.style.display = "none";
        line.replaceChildren();
    };

    const clearVisual = () => {
        pendingSlot = null;
        hideVisual();
    };

    const clear = () => {
        pendingSlot = null;
        hideVisual();
        try {
            root?.remove();
        } catch {
            /* ignore */
        }
        root = null;
        ghost = null;
        ghostLabel = null;
        line = null;
    };

    const update = (context, api) => {
        if (typeof document === "undefined") return;
        const itemEl = resolveSourceElement(context, api);
        const pick = api.jockey?.select;
        const px = api.jockey?._pointer?.x;
        const py = api.jockey?._pointer?.y;
        if (
            !(itemEl instanceof Element) ||
            !Number.isFinite(px) ||
            !Number.isFinite(py)
        ) {
            clearVisual();
            return;
        }

        const srcSlot = context?.slot || pick?.slot;
        const zoneMap = collectStageZones(pick?.zoneEl || itemEl.parentElement);
        const destSlot = targetSlotFromPointer(srcSlot, px, py, zoneMap);
        if (!destSlot) {
            clearVisual();
            return;
        }

        const srcRect = itemEl.getBoundingClientRect();
        const srcZoneEl = zoneMap[srcSlot] || pick?.zoneEl;
        const destZoneEl = zoneMap[destSlot];
        const srcZoneRect = srcZoneEl?.getBoundingClientRect?.() || null;
        const destZoneRect = destZoneEl?.getBoundingClientRect?.() || null;
        if (!srcZoneRect || !destZoneRect) {
            clearVisual();
            return;
        }

        ensure();
        pendingSlot = destSlot;
        const ghostBox = ghostRectForZone(srcRect, srcZoneRect, destZoneRect);
        ghost.style.display = "flex";
        ghost.style.left = `${ghostBox.left}px`;
        ghost.style.top = `${ghostBox.top}px`;
        ghost.style.width = `${ghostBox.width}px`;
        ghost.style.height = `${ghostBox.height}px`;
        if (ghostLabel) {
            ghostLabel.textContent = slotMoveLabel(destSlot, destZoneEl);
        }

        const ghostDomRect = {
            left: ghostBox.left,
            top: ghostBox.top,
            right: ghostBox.left + ghostBox.width,
            bottom: ghostBox.top + ghostBox.height,
        };
        const conn = rectConnector(srcRect, ghostDomRect);
        const seg = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "line"
        );
        seg.setAttribute("x1", String(conn.x1));
        seg.setAttribute("y1", String(conn.y1));
        seg.setAttribute("x2", String(conn.x2));
        seg.setAttribute("y2", String(conn.y2));
        seg.setAttribute("stroke", "red");
        seg.setAttribute("stroke-width", "2");
        seg.setAttribute("stroke-linecap", "round");
        line.replaceChildren(seg);
    };

    const takePendingSlot = () => {
        const slot = pendingSlot;
        pendingSlot = null;
        return slot;
    };

    return { update, hideVisual, clearVisual, clear, takePendingSlot };
}

export const register = (navi) => {
    const HELP = [
        "jockey_move — move things around the stage.",
        "use: select a stage-member (or an offstage-member) with stagejockey → −1 \"jockey-move\",",
        "     then middle-click a cell of the 3×3 grid to place it.",
        "     Or, while something is red-selected, left-press and drag it to a new spot.",
        "     Or right-click an offstage htmf → stagejockey \"move onstage\".",
        "stageable: left-click (or right-click → move onstage) any offstage [data-stageable] element",
        "     to open the 3×3 grid. data-stageable (or =\"self\") stages the element itself;",
        "     data-stageable=\"span\" stages a <span data-part=\"htmf\"> (styled by data-stageable-style)",
        "     holding a clone of <template data-stageable-content> (launcher stays), else the",
        "     [data-stageable-content] children (vessel is removed).",
    ].join("\n");
    const redselect = createRedselectPreview();

    const scrollbufferPlugin = {
        id: "jockey-move",
        name: "jockey-move",
        claims: [
            {
                id: "move",
                direction: -1,
                types: ["stage-member", "offstage-member"],
                color: "#00ffe0",
                describe: () => ({
                    text: "jockey-move",
                    color: "#00ffe0",
                    textShadow:
                        "0 1px 2px #003333, 0 0 2px #000, 0 0 1px #000",
                }),
                matches: (context) =>
                    hasType(context, "stage-member") ||
                    hasType(context, "offstage-member"),
                async execute(context, api) {
                    if (typeof document === "undefined") return undefined;

                    // Grid is claim-world; don't leave the hold stealing left-drag.
                    if (typeof api?.terminate === "function") api.terminate();

                    return openMoveGrid(api, (slot) =>
                        applySlot(context, api, slot)
                    );
                },
            },
        ],
    };

    function jockeyApi(jockey) {
        const mod = navi?.mod || globalThis?.navi?.mod;
        return {
            navi,
            jockey,
            stage: mod?.stagedir?.stage || null,
            terminate: () => {
                if (typeof jockey?.endHold === "function") jockey.endHold();
            },
        };
    }

    function contextFromJockey(jockey) {
        const ctx = jockey?.scrollbuffer?.context;
        if (
            ctx &&
            (hasType(ctx, "stage-member") || hasType(ctx, "offstage-member"))
        ) {
            return ctx;
        }
        const pick = jockey?.select;
        if (!(pick?.itemEl instanceof HTMLElement)) return null;
        return {
            types: ["stage-member"],
            kind: "stage-member",
            slot: pick.slot,
            index: pick.index,
            element: pick.itemEl,
        };
    }

    const redselectDrag = {
        move(jockey) {
            const context = contextFromJockey(jockey);
            if (!context) {
                redselect.clearVisual();
                return;
            }
            redselect.update(context, jockeyApi(jockey));
        },
        async end(jockey) {
            const slot = redselect.takePendingSlot();
            redselect.clear();
            if (!slot) return false;
            const context = contextFromJockey(jockey);
            if (!context) return false;
            const api = jockeyApi(jockey);
            try {
                await applySlot(context, api, slot);
                if (typeof api.terminate === "function") api.terminate();
                return true;
            } catch (err) {
                console.error("[jockey-move]", err);
                if (typeof navi.callout === "function") {
                    navi.callout(`[jockey-move] ${err.message || err}`);
                }
                return false;
            }
        },
        cancel() {
            redselect.clear();
        },
    };

    /** Dropdown: pick zone, move live htmf onto stage (same node). */
    async function moveOnstage(el, api) {
        if (!(el instanceof HTMLElement)) {
            throw new Error("move onstage needs a live element");
        }
        if (isOnStage(el)) {
            throw new Error("already on stage");
        }
        const stage = api?.stage;
        if (!stage) throw new Error("stage unavailable");
        if (typeof api?.terminate === "function") api.terminate();
        return openMoveGrid(api, async (slot) => {
            await adoptLive(stage, slot, el);
            if (typeof globalThis.navi?.callout === "function") {
                globalThis.navi.callout(`[jockey-move] → ${slot}`);
            }
        });
    }

    /** Left-click on an offstage [data-stageable] opens the grid (no dropdown). */
    function onStageableClick(e) {
        if (e.button !== 0 || e.defaultPrevented) return;
        const el =
            e.target instanceof Element
                ? e.target.closest("[data-stageable]")
                : null;
        if (!(el instanceof HTMLElement) || isOnStage(el)) return;
        if (document.getElementById("jockey-move-grid")) return;
        e.preventDefault();
        e.stopPropagation();
        const mod = navi?.mod || globalThis?.navi?.mod;
        const stage = mod?.stagedir?.stage || null;
        if (!stage) {
            globalThis.navi?.callout?.("[jockey-move] no stage — proscene first");
            return;
        }
        moveOnstage(el, {
            navi,
            stage,
            pointer: { x: e.clientX, y: e.clientY },
        }).catch((err) => {
            console.error("[jockey-move]", err);
            globalThis.navi?.callout?.(`[jockey-move] ${err.message || err}`);
        });
    }
    if (typeof document !== "undefined") {
        document.addEventListener("click", onStageableClick, true);
    }

    /** Dropdown: lift live stage-member (htmf) to document.body. */
    async function moveOffstage(el, api) {
        const member = stageMemberForOffstage(el);
        if (!member) throw new Error("not on stage");
        const stage = api?.stage;
        await detachLive(stage, member);
        if (typeof globalThis.navi?.callout === "function") {
            globalThis.navi.callout("[jockey-move] offstage");
        }
        if (typeof api?.terminate === "function") api.terminate();
        return member;
    }

    return {
        name: "jockey_move",
        commands: {
            jockey_move: { name: "jockey_move", description: "help", execute: async () => HELP },
        },
        version: "0.3.3",
        description:
            "3×3 scrollbuffer claim; redselect drag; dropdown move on/off stage",
        moduleInfo: {
            name: "jockey_move",
            version: "0.3.3",
            description:
                "3×3 scrollbuffer claim; redselect drag; dropdown move on/off stage",
        },
        scrollbufferPlugin,
        redselectDrag,
        openMoveGrid,
        adoptLive,
        detachLive,
        moveOnstage,
        moveOffstage,
        findHtmfHost,
        isOnStage,
        stageColumnOf,
        onUnmount: () => {
            redselect.clear();
            if (typeof document !== "undefined") {
                document.removeEventListener("click", onStageableClick, true);
            }
        },
    };
};