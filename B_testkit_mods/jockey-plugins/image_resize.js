/**
 * image_resize — jockey +1 on image parts (png / jpeg / …).
 *
 * Opens a fixed aspect-locked frame near the pointer with corner handles.
 * Dragging a corner resizes the live <img> proportionally; clicking inside
 * the frame commits (attrs + stage presentation persist). Escape / outside
 * click restores the prior size.
 *
 * Requires: supermouse_plugin_stagejockey (+ horizon_stagedir for persist)
 */

const IMAGE_PARTS = ["png", "jpeg", "jpg", "gif", "webp", "svg", "image"];
const UI_MAX = 200;
const HANDLE = 12;

function hasType(context, name) {
    const types = Array.isArray(context?.types) ? context.types : [];
    return types.includes(name) || context?.kind === name;
}

function partNames(raw) {
    return String(raw || "")
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);
}

function dismissUi(ui) {
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
    ui.listeners = [];
}

function readSize(img) {
    const attrW = Number.parseFloat(img.getAttribute("width"));
    const attrH = Number.parseFloat(img.getAttribute("height"));
    if (Number.isFinite(attrW) && attrW > 0 && Number.isFinite(attrH) && attrH > 0) {
        return { w: attrW, h: attrH };
    }
    const nw = img.naturalWidth || 0;
    const nh = img.naturalHeight || 0;
    if (nw > 0 && nh > 0) return { w: nw, h: nh };
    const rect = img.getBoundingClientRect();
    const w = rect.width || 160;
    const h = rect.height || 120;
    return { w, h };
}

function applySize(img, w, h) {
    const rw = Math.max(1, Math.round(w));
    const rh = Math.max(1, Math.round(h));
    img.setAttribute("width", String(rw));
    img.setAttribute("height", String(rh));
    img.style.width = `${rw}px`;
    img.style.height = `${rh}px`;
    return { w: rw, h: rh };
}

function previewBox(w, h) {
    const aspect = w / Math.max(h, 1);
    let pw = w;
    let ph = h;
    if (pw > UI_MAX || ph > UI_MAX) {
        if (aspect >= 1) {
            pw = UI_MAX;
            ph = UI_MAX / aspect;
        } else {
            ph = UI_MAX;
            pw = UI_MAX * aspect;
        }
    }
    pw = Math.max(48, Math.round(pw));
    ph = Math.max(48, Math.round(ph));
    return { pw, ph, aspect: pw / ph };
}

const HELP = [
    "image_resize — resize a picture on the page by dragging.",
    "use: select an image with stagejockey → +1 \"image-resize\".",
    "     Drag a corner (proportions stay locked); click inside the frame to keep the size,",
    "     Escape or click outside to put it back.",
    "Only the displayed width/height change; the image data itself is untouched.",
    "needs: stagejockey (horizon_stagedir to keep the size on the stage)",
].join("\n");

export const register = (navi) => {
    const resolveStage = () => navi?.mod?.stagedir?.stage || navi?.mod?.horizon_stagedir?.stage || null;
    const resolveJockey = () =>
        navi?.mod?.supermouse_plugin_stagejockey?.jockey || null;

    const liveImg = (context) => {
        const el = context?.element;
        if (!(el instanceof HTMLElement)) return null;
        if (el.tagName === "IMG") return el;
        const nested = el.querySelector?.("img");
        return nested instanceof HTMLImageElement ? nested : null;
    };

    const isImageContext = (context) => {
        if (hasType(context, "htm-img")) return true;
        if (IMAGE_PARTS.some((p) => hasType(context, p))) return true;
        const parts = partNames(context?.part || context?.presentation?.type);
        if (parts.some((p) => IMAGE_PARTS.includes(p))) return true;
        if (
            hasType(context, "htm-element") &&
            liveImg(context)
        ) {
            return true;
        }
        return !!liveImg(context);
    };

    const stageMemberEl = (context, img) => {
        if (context?.hostElement instanceof HTMLElement) return context.hostElement;
        const jockey = resolveJockey();
        const loc =
            typeof jockey?.locate === "function" ? jockey.locate(img) : null;
        if (loc?.itemEl instanceof HTMLElement) return loc.itemEl;
        return img;
    };

    const syncPresentation = async (memberEl) => {
        const stage = resolveStage();
        if (!stage || !(memberEl instanceof HTMLElement)) return;
        const prev =
            typeof stage.presentationFor === "function"
                ? stage.presentationFor(memberEl)
                : null;
        const next = {
            ...(prev && typeof prev === "object" ? prev : {}),
            value: memberEl.outerHTML,
        };
        if (!next.type) {
            const stamped = memberEl.getAttribute("data-part");
            if (stamped) next.type = String(stamped).toLowerCase();
        }
        const path = memberEl.getAttribute("data-path");
        if (path && !next.path) next.path = path;
        if (typeof stage.rememberPresentation === "function") {
            stage.rememberPresentation(memberEl, next);
        }
        if (typeof stage.persist === "function") {
            await stage.persist();
        }
    };

    const scrollbufferPlugin = {
        id: "image_resize",
        name: "image_resize",
        claims: [
            {
                id: "image-resize",
                direction: 1,
                types: [...IMAGE_PARTS, "htm-img", "htm-element"],
                color: "orchid",
                describe: () => ({
                    text: "image-resize",
                    color: "orchid",
                    textShadow: "0 1px 2px #1a0022, 0 0 2px #000, 0 0 1px #000",
                }),
                matches: (context) => {
                    if (!isImageContext(context)) return false;
                    return !!liveImg(context);
                },
                async execute(context, api) {
                    if (typeof document === "undefined") return undefined;
                    const img = liveImg(context);
                    if (!img) throw new Error("no <img> element");

                    // Free left-drag from stage pick for the duration of the UI.
                    if (typeof api?.terminate === "function") api.terminate();

                    const original = {
                        width: img.getAttribute("width"),
                        height: img.getAttribute("height"),
                        styleWidth: img.style.width,
                        styleHeight: img.style.height,
                    };
                    const start = readSize(img);
                    // Ensure attrs exist even before the user resizes.
                    applySize(img, start.w, start.h);

                    return new Promise((resolve) => {
                        const ui = { listeners: [] };
                        const on = (type, el, fn, opts) => {
                            el.addEventListener(type, fn, opts);
                            ui.listeners.push([type, el, fn, opts]);
                        };

                        let settled = false;
                        let liveW = start.w;
                        let liveH = start.h;
                        const { pw: initPw, ph: initPh, aspect } = previewBox(
                            start.w,
                            start.h
                        );
                        let boxW = initPw;
                        let boxH = initPh;
                        const scale = start.w / boxW;

                        const restore = () => {
                            if (original.width == null) img.removeAttribute("width");
                            else img.setAttribute("width", original.width);
                            if (original.height == null) {
                                img.removeAttribute("height");
                            } else {
                                img.setAttribute("height", original.height);
                            }
                            img.style.width = original.styleWidth || "";
                            img.style.height = original.styleHeight || "";
                        };

                        const finish = async (commit) => {
                            if (settled) return;
                            settled = true;
                            dismissUi(ui);
                            if (!commit) {
                                restore();
                                resolve(undefined);
                                return;
                            }
                            applySize(img, liveW, liveH);
                            try {
                                await syncPresentation(
                                    stageMemberEl(context, img)
                                );
                            } catch (err) {
                                console.error("[image_resize] persist failed", err);
                            }
                            if (typeof navi.callout === "function") {
                                navi.callout(
                                    `[image_resize] ${Math.round(liveW)}×${Math.round(liveH)}`
                                );
                            }
                            resolve(undefined);
                        };

                        const root = document.createElement("div");
                        root.id = "jockey-image-resize";
                        root.setAttribute("data-jockey-ui", "image-resize");
                        root.style.cssText = [
                            "position:fixed",
                            "z-index:2147483646",
                            "pointer-events:auto",
                            "box-sizing:border-box",
                            "border:2px solid orchid",
                            "background:rgba(40,0,40,.35)",
                            "box-shadow:0 0 0 1px rgba(0,0,0,.5)",
                        ].join(";");

                        const label = document.createElement("div");
                        label.style.cssText =
                            "position:absolute;left:0;top:-1.4em;font:600 11px/1 monospace;color:#f8e7ff;text-shadow:0 1px 2px #000;white-space:nowrap;pointer-events:none";
                        root.appendChild(label);

                        const corners = ["nw", "ne", "sw", "se"];
                        const handles = {};
                        for (const c of corners) {
                            const h = document.createElement("button");
                            h.type = "button";
                            h.dataset.corner = c;
                            h.setAttribute("aria-label", `resize ${c}`);
                            h.style.cssText = [
                                "position:absolute",
                                `width:${HANDLE}px`,
                                `height:${HANDLE}px`,
                                "padding:0",
                                "margin:0",
                                "border:2px solid #fff",
                                "border-radius:50%",
                                "background:orchid",
                                "box-sizing:border-box",
                                "cursor:nwse-resize",
                                "pointer-events:auto",
                            ].join(";");
                            if (c === "ne" || c === "sw") {
                                h.style.cursor = "nesw-resize";
                            }
                            root.appendChild(h);
                            handles[c] = h;
                        }

                        const placeHandles = () => {
                            const half = HANDLE / 2;
                            handles.nw.style.left = `${-half}px`;
                            handles.nw.style.top = `${-half}px`;
                            handles.ne.style.left = `${boxW - half}px`;
                            handles.ne.style.top = `${-half}px`;
                            handles.sw.style.left = `${-half}px`;
                            handles.sw.style.top = `${boxH - half}px`;
                            handles.se.style.left = `${boxW - half}px`;
                            handles.se.style.top = `${boxH - half}px`;
                        };

                        const layout = () => {
                            root.style.left = `${boxLeft}px`;
                            root.style.top = `${boxTop}px`;
                            root.style.width = `${boxW}px`;
                            root.style.height = `${boxH}px`;
                            placeHandles();
                            label.textContent = `${Math.round(liveW)}×${Math.round(liveH)}`;
                        };

                        const px = api.jockey?._pointer?.x ?? 0;
                        const py = api.jockey?._pointer?.y ?? 0;
                        let boxLeft = px + 16;
                        let boxTop = Math.max(8, py - boxH - 16);
                        layout();
                        document.body.appendChild(root);
                        ui.root = root;

                        let drag = null;

                        const setLiveFromBox = () => {
                            liveW = Math.max(1, boxW * scale);
                            liveH = Math.max(1, boxH * scale);
                            applySize(img, liveW, liveH);
                            layout();
                        };

                        for (const c of corners) {
                            on(
                                "pointerdown",
                                handles[c],
                                (e) => {
                                    if (e.pointerType === "mouse" && e.button !== 0) {
                                        return;
                                    }
                                    e.preventDefault();
                                    e.stopPropagation();
                                    drag = {
                                        corner: c,
                                        startX: e.clientX,
                                        startY: e.clientY,
                                        startBoxW: boxW,
                                        startBoxH: boxH,
                                        startLeft: boxLeft,
                                        startTop: boxTop,
                                    };
                                    handles[c].style.background = "#fff";
                                    handles[c].style.borderColor = "orchid";
                                    try {
                                        handles[c].setPointerCapture(e.pointerId);
                                    } catch {
                                        /* ignore */
                                    }
                                },
                                true
                            );
                            // Fallback when PointerEvent is missing.
                            on(
                                "mousedown",
                                handles[c],
                                (e) => {
                                    if (window.PointerEvent) return;
                                    e.preventDefault();
                                    e.stopPropagation();
                                    drag = {
                                        corner: c,
                                        startX: e.clientX,
                                        startY: e.clientY,
                                        startBoxW: boxW,
                                        startBoxH: boxH,
                                        startLeft: boxLeft,
                                        startTop: boxTop,
                                    };
                                    handles[c].style.background = "#fff";
                                    handles[c].style.borderColor = "orchid";
                                },
                                true
                            );
                        }

                        on("pointermove", document, (e) => {
                            if (!drag) return;
                            e.preventDefault();
                            const dx = e.clientX - drag.startX;
                            const dy = e.clientY - drag.startY;
                            let nextW = drag.startBoxW;
                            // Prefer horizontal delta; lock aspect.
                            if (drag.corner === "se" || drag.corner === "ne") {
                                nextW = drag.startBoxW + dx;
                            } else {
                                nextW = drag.startBoxW - dx;
                            }
                            const absDx = Math.abs(dx);
                            const absDy = Math.abs(dy);
                            if (absDy > absDx) {
                                let nextH = drag.startBoxH;
                                if (drag.corner === "se" || drag.corner === "sw") {
                                    nextH = drag.startBoxH + dy;
                                } else {
                                    nextH = drag.startBoxH - dy;
                                }
                                nextW = nextH * aspect;
                            }
                            nextW = Math.max(48, nextW);
                            const nextH = nextW / aspect;
                            const dW = nextW - drag.startBoxW;
                            const dH = nextH - drag.startBoxH;

                            // Keep the opposite corner fixed so the frame pulls from the handle.
                            let nextLeft = drag.startLeft;
                            let nextTop = drag.startTop;
                            if (drag.corner === "nw") {
                                nextLeft = drag.startLeft - dW;
                                nextTop = drag.startTop - dH;
                            } else if (drag.corner === "ne") {
                                nextTop = drag.startTop - dH;
                            } else if (drag.corner === "sw") {
                                nextLeft = drag.startLeft - dW;
                            }

                            boxW = nextW;
                            boxH = nextH;
                            boxLeft = nextLeft;
                            boxTop = nextTop;
                            setLiveFromBox();
                        }, true);

                        on("mousemove", document, (e) => {
                            if (window.PointerEvent) return;
                            if (!drag) return;
                            e.preventDefault();
                            const dx = e.clientX - drag.startX;
                            const dy = e.clientY - drag.startY;
                            let nextW = drag.startBoxW;
                            if (drag.corner === "se" || drag.corner === "ne") {
                                nextW = drag.startBoxW + dx;
                            } else {
                                nextW = drag.startBoxW - dx;
                            }
                            const absDx = Math.abs(dx);
                            const absDy = Math.abs(dy);
                            if (absDy > absDx) {
                                let nextH = drag.startBoxH;
                                if (drag.corner === "se" || drag.corner === "sw") {
                                    nextH = drag.startBoxH + dy;
                                } else {
                                    nextH = drag.startBoxH - dy;
                                }
                                nextW = nextH * aspect;
                            }
                            nextW = Math.max(48, nextW);
                            const nextH = nextW / aspect;
                            const dW = nextW - drag.startBoxW;
                            const dH = nextH - drag.startBoxH;
                            let nextLeft = drag.startLeft;
                            let nextTop = drag.startTop;
                            if (drag.corner === "nw") {
                                nextLeft = drag.startLeft - dW;
                                nextTop = drag.startTop - dH;
                            } else if (drag.corner === "ne") {
                                nextTop = drag.startTop - dH;
                            } else if (drag.corner === "sw") {
                                nextLeft = drag.startLeft - dW;
                            }
                            boxW = nextW;
                            boxH = nextH;
                            boxLeft = nextLeft;
                            boxTop = nextTop;
                            setLiveFromBox();
                        }, true);

                        const endDrag = () => {
                            if (!drag) return;
                            const c = drag.corner;
                            drag = null;
                            if (handles[c]) {
                                handles[c].style.background = "orchid";
                                handles[c].style.borderColor = "#fff";
                            }
                        };
                        on("pointerup", document, endDrag, true);
                        on("pointercancel", document, endDrag, true);
                        on("mouseup", document, endDrag, true);

                        on("click", root, (e) => {
                            if (e.target !== root) return;
                            e.preventDefault();
                            e.stopPropagation();
                            void finish(true);
                        });

                        on(
                            "pointerdown",
                            document,
                            (e) => {
                                if (settled) return;
                                if (!root.isConnected) {
                                    void finish(false);
                                    return;
                                }
                                if (root.contains(e.target)) return;
                                e.preventDefault();
                                e.stopPropagation();
                                void finish(false);
                            },
                            true
                        );

                        on("keydown", document, (e) => {
                            if (e.key === "Escape") {
                                e.preventDefault();
                                void finish(false);
                            } else if (e.key === "Enter") {
                                e.preventDefault();
                                void finish(true);
                            }
                        });
                    });
                },
            },
        ],
    };

    return {
        name: "image_resize",
        commands: {
            image_resize: { name: "image_resize", description: "help", execute: async () => HELP },
        },
        version: "0.1.9",
        description:
            "Jockey +1: resize stage <img> via corner frame (png/jpeg/… / htm-img / htm-element)",

        moduleInfo: {
            name: "image_resize",
            version: "0.1.9",
            description:
                "Jockey +1: resize stage <img> via corner frame (png/jpeg/… / htm-img / htm-element)",
        },

        scrollbufferPlugin,

        onMount: async () => {
            if (typeof navi.callout === "function") {
                navi.callout("[image_resize] mounted");
            }
        },
    };
};
