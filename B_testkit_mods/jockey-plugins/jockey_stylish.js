/**
 * jockey_stylish — jockey +1 on htm-element / word / phrase / char:
 * Word/Paint-ish CSS ribbon.
 *
 * Live-edits common style attributes on the selected element. For text
 * selections, wraps the range in an inline-block span first. Done keeps the
 * styles (local DOM / park); Cancel restores prior style or unwraps a new wrap.
 * No tiny_ibgib / jockey_tiny frames.
 *
 * Requires: supermouse_plugin_stagejockey
 * Optional: stylishmod — its `fonts` provider feeds the font picker the open
 * web font catalog; without it the picker lists system fonts only.
 */

function hasType(context, name) {
  const types = Array.isArray(context?.types) ? context.types : [];
  return types.includes(name) || context?.kind === name;
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

/** Controlled CSS properties written into the style attribute. */
const WEIGHTS = ["normal", "bold", "100", "300", "500", "600", "700", "900"];
const FONT_STYLES = ["normal", "italic", "oblique"];
const DECOS = ["none", "underline", "line-through", "overline"];
const ALIGNS = ["left", "center", "right", "justify"];
const BORDER_STYLES = [
  "none",
  "solid",
  "dashed",
  "dotted",
  "double",
  "groove",
  "ridge",
];

/** Font picker: used when stylishmod (web font provider) is not mounted. */
const LOCAL_FONTS = [
  ["system-ui", "sans-serif"],
  ["sans-serif", "sans-serif"],
  ["serif", "serif"],
  ["monospace", "monospace"],
  ["cursive", "handwriting"],
  ["Arial", "sans-serif"],
  ["Segoe UI", "sans-serif"],
  ["Tahoma", "sans-serif"],
  ["Trebuchet MS", "sans-serif"],
  ["Verdana", "sans-serif"],
  ["Georgia", "serif"],
  ["Times New Roman", "serif"],
  ["Consolas", "monospace"],
  ["Courier New", "monospace"],
  ["Comic Sans MS", "handwriting"],
  ["Impact", "display"],
].map(([family, category]) => ({
  id: `system:${family}`,
  family,
  category,
  source: "system",
}));
const FONT_CATEGORIES = [
  "all",
  "system",
  "sans-serif",
  "serif",
  "monospace",
  "display",
  "handwriting",
];
const FONT_LIST_CHUNK = 150;
const FONT_PREVIEW_DELAY_MS = 140;

const localFontStack = (font) => {
  const generic =
    font.category === "serif"
      ? "serif"
      : font.category === "monospace"
        ? "monospace"
        : font.category === "handwriting"
          ? "cursive"
          : "sans-serif";
  if (/^(serif|sans-serif|monospace|cursive|fantasy|system-ui)$/i.test(font.family)) {
    return font.family;
  }
  return `"${String(font.family).replace(/"/g, "")}", ${generic}`;
};

/** image-resize-like preview frame for Layout ▸ Resize */
const RESIZE_UI_MAX = 200;
const RESIZE_HANDLE = 12;

const previewBox = (w, h) => {
  const aspect = w / Math.max(h, 1);
  let pw = w;
  let ph = h;
  if (pw > RESIZE_UI_MAX || ph > RESIZE_UI_MAX) {
    if (aspect >= 1) {
      pw = RESIZE_UI_MAX;
      ph = RESIZE_UI_MAX / aspect;
    } else {
      ph = RESIZE_UI_MAX;
      pw = RESIZE_UI_MAX * aspect;
    }
  }
  pw = Math.max(48, Math.round(pw));
  ph = Math.max(48, Math.round(ph));
  return { pw, ph };
};

/** Place a fixed box near `el`, preferring the side with more viewport room. */
const placeNearTarget = (el, boxW, boxH) => {
  const rect =
    el instanceof HTMLElement
      ? el.getBoundingClientRect()
      : { left: 24, top: 48, right: 24, bottom: 48, width: 0, height: 0 };
  const pad = 14;
  const vw = typeof window !== "undefined" ? window.innerWidth : 800;
  const vh = typeof window !== "undefined" ? window.innerHeight : 600;
  const roomRight = vw - rect.right - pad;
  const roomLeft = rect.left - pad;
  const roomBelow = vh - rect.bottom - pad;
  const roomAbove = rect.top - pad;

  let left;
  if (roomRight >= boxW || roomRight >= roomLeft) {
    left = rect.right + pad;
    if (left + boxW > vw - 8) left = Math.max(8, vw - boxW - 8);
  } else {
    left = rect.left - boxW - pad;
    if (left < 8) left = 8;
  }

  let top;
  if (roomBelow >= boxH || roomBelow >= roomAbove) {
    top = rect.bottom + pad;
    if (top + boxH > vh - 8) top = Math.max(8, vh - boxH - 8);
  } else {
    top = rect.top - boxH - pad;
    if (top < 8) top = 8;
  }
  return { left, top };
};
const cssColor = (raw, fallback = "#000000") => {
  const s = String(raw || "").trim();
  if (/^#[0-9a-f]{3,8}$/i.test(s)) {
    if (s.length === 4) {
      return (
        "#" +
        s[1] +
        s[1] +
        s[2] +
        s[2] +
        s[3] +
        s[3]
      ).toLowerCase();
    }
    return s.slice(0, 7).toLowerCase();
  }
  if (typeof document === "undefined") return fallback;
  try {
    const probe = document.createElement("div");
    probe.style.color = s;
    const got = probe.style.color;
    if (!got) return fallback;
    const m = got.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (!m) return fallback;
    const hex = (n) => Number(n).toString(16).padStart(2, "0");
    return `#${hex(m[1])}${hex(m[2])}${hex(m[3])}`;
  } catch {
    return fallback;
  }
};

const parsePx = (raw, fallback = 0) => {
  const n = Number.parseFloat(String(raw || "").replace(/px$/i, ""));
  return Number.isFinite(n) ? n : fallback;
};

const parseShadow = (raw) => {
  const s = String(raw || "").trim();
  if (!s || s === "none") {
    return { on: false, color: "#000000", blur: 4, x: 0, y: 0 };
  }
  const colorMatch = s.match(/(#[0-9a-f]{3,8}|rgba?\([^)]+\))/i);
  const color = cssColor(colorMatch?.[1] || "#000000");
  const nums = [...s.matchAll(/(-?\d+(?:\.\d+)?)\s*px/gi)].map((m) =>
    Number(m[1])
  );
  return {
    on: true,
    color,
    x: nums[0] ?? 0,
    y: nums[1] ?? 0,
    blur: nums[2] ?? 4,
  };
};

const shadowCss = (sh) => {
  if (!sh?.on) return "";
  return `${sh.x || 0}px ${sh.y || 0}px ${sh.blur || 0}px ${sh.color || "#000"}`;
};

const readState = (el) => {
  const cs = typeof getComputedStyle === "function" ? getComputedStyle(el) : null;
  const live = el.style;
  const pick = (camel, cssName) => {
    const inline = live[camel];
    if (inline) return inline;
    return cs ? cs.getPropertyValue(cssName) || cs[camel] || "" : "";
  };

  const fontSize = parsePx(pick("fontSize", "font-size"), 16);
  const borderWidth = parsePx(pick("borderWidth", "border-top-width"), 0);
  const borderRadius = parsePx(pick("borderRadius", "border-radius"), 0);
  const padding = parsePx(pick("padding", "padding-top"), 0);
  const margin = parsePx(pick("margin", "margin-top"), 0);
  const opacity = Number.parseFloat(pick("opacity", "opacity") || "1");
  const weight = String(pick("fontWeight", "font-weight") || "normal")
    .toLowerCase()
    .replace("700", "bold")
    .replace("400", "normal");
  const fontStyle = String(pick("fontStyle", "font-style") || "normal").toLowerCase();
  let deco = String(pick("textDecorationLine", "text-decoration-line") || "")
    .toLowerCase()
    .split(/\s+/)[0];
  if (!deco || deco === "") {
    deco = String(pick("textDecoration", "text-decoration") || "none")
      .toLowerCase()
      .split(/\s+/)[0];
  }
  if (!DECOS.includes(deco)) deco = "none";
  const align = String(pick("textAlign", "text-align") || "left").toLowerCase();
  let borderStyle = String(
    pick("borderStyle", "border-top-style") || "none"
  ).toLowerCase();
  if (!BORDER_STYLES.includes(borderStyle)) borderStyle = "none";

  const rect =
    typeof el.getBoundingClientRect === "function"
      ? el.getBoundingClientRect()
      : { width: 0, height: 0 };
  const inlineW = parsePx(live.width, NaN);
  const inlineH = parsePx(live.height, NaN);
  const width =
    Number.isFinite(inlineW) && inlineW > 0
      ? inlineW
      : Math.max(0, Math.round(rect.width) || 0);
  const height =
    Number.isFinite(inlineH) && inlineH > 0
      ? inlineH
      : Math.max(0, Math.round(rect.height) || 0);

  return {
    // Inline only; computed family is shown as a hint, never stamped.
    fontFamily: String(live.fontFamily || "").trim(),
    fontId: el.getAttribute("data-jockey-font") || "",
    computedFontFamily: cs
      ? String(cs.getPropertyValue("font-family") || cs.fontFamily || "").trim()
      : "",
    color: cssColor(pick("color", "color"), "#222222"),
    backgroundColor: cssColor(
      live.backgroundColor || pick("backgroundColor", "background-color"),
      "#ffffff"
    ),
    bgClear: !String(live.backgroundColor || "").trim(),
    fontSize,
    fontWeight: WEIGHTS.includes(weight)
      ? weight
      : Number(weight) >= 600
        ? "bold"
        : "normal",
    fontStyle: FONT_STYLES.includes(fontStyle) ? fontStyle : "normal",
    textDecoration: deco,
    textAlign: ALIGNS.includes(align) ? align : "left",
    borderWidth,
    borderStyle,
    borderColor: cssColor(
      pick("borderColor", "border-top-color"),
      "#444444"
    ),
    borderRadius,
    // text-shadow inherits — prefer inline; fall back to computed so a nested
    // wrap still shows the visible shadow and can punch it with `none`.
    textShadow: (() => {
      const inline = String(live.textShadow || "").trim();
      if (inline) return parseShadow(inline);
      const computed = cs
        ? String(cs.getPropertyValue("text-shadow") || cs.textShadow || "").trim()
        : "";
      if (computed && computed !== "none") return parseShadow(computed);
      return { on: false, color: "#000000", blur: 4, x: 0, y: 0 };
    })(),
    // box-shadow does not inherit — inline only (avoid false "on" from noise).
    boxShadow: parseShadow(String(live.boxShadow || "").trim()),
    opacity: Number.isFinite(opacity) ? opacity : 1,
    padding,
    margin,
    width,
    height,
  };
};
/**
 * Only write properties the user actually changed (touched).
 * Restores original inline CSS first so untouched computed defaults never get stamped.
 * "No style" choices clear the property instead of writing none/0 noise.
 */
const applyState = (el, state, { touched, originalCss } = {}) => {
  const marks = touched instanceof Set ? touched : null;
  const has = (k) => !marks || marks.has(k);

  if (typeof originalCss === "string") {
    el.style.cssText = originalCss;
  }

  if (has("color")) el.style.color = state.color;

  if (has("fontFamily")) {
    el.style.fontFamily = state.fontFamily || "";
    if (state.fontId) el.setAttribute("data-jockey-font", state.fontId);
    else el.removeAttribute("data-jockey-font");
  }

  if (has("backgroundColor")) {
    el.style.backgroundColor = state.bgClear ? "" : state.backgroundColor;
  }

  if (has("fontSize")) el.style.fontSize = `${state.fontSize}px`;
  if (has("fontWeight")) el.style.fontWeight = state.fontWeight;
  if (has("fontStyle")) el.style.fontStyle = state.fontStyle;

  if (has("textDecoration")) {
    el.style.textDecoration =
      !state.textDecoration || state.textDecoration === "none"
        ? ""
        : state.textDecoration;
  }

  if (has("textAlign")) el.style.textAlign = state.textAlign;

  if (
    has("borderWidth") ||
    has("borderStyle") ||
    has("borderColor") ||
    has("borderRadius")
  ) {
    const width = Number(state.borderWidth) || 0;
    const style =
      width > 0 && state.borderStyle === "none" ? "solid" : state.borderStyle;
    if (width <= 0 || style === "none") {
      if (has("borderWidth") || has("borderStyle")) {
        el.style.borderWidth = "";
        el.style.borderStyle = "";
      }
      if (has("borderColor")) el.style.borderColor = "";
    } else {
      if (has("borderWidth")) el.style.borderWidth = `${width}px`;
      if (has("borderStyle") || has("borderWidth")) el.style.borderStyle = style;
      if (has("borderColor")) el.style.borderColor = state.borderColor;
    }
    if (has("borderRadius")) {
      el.style.borderRadius =
        state.borderRadius > 0 ? `${state.borderRadius}px` : "";
    }
  }

  if (has("textShadow")) {
    // "" removes the property and re-inherits from a parent wrap — use none.
    el.style.textShadow = state.textShadow?.on
      ? shadowCss(state.textShadow)
      : "none";
  }
  if (has("boxShadow")) {
    el.style.boxShadow = state.boxShadow?.on
      ? shadowCss(state.boxShadow)
      : "none";
  }

  if (has("opacity")) {
    el.style.opacity =
      state.opacity == null || state.opacity === 1 ? "" : String(state.opacity);
  }
  if (has("padding") || has("margin") || has("width") || has("height")) {
    // Stage text / bare spans are display:inline — vertical margin is ignored
    // and vertical padding / width / height do not push layout. Promote.
    const liveDisp = String(el.style.display || "").trim().toLowerCase();
    const computedDisp =
      !liveDisp && typeof getComputedStyle === "function"
        ? String(getComputedStyle(el).display || "").toLowerCase()
        : liveDisp;
    if (!liveDisp && (computedDisp === "inline" || computedDisp === "")) {
      el.style.display = "inline-block";
    }
  }
  if (has("padding")) {
    el.style.padding = state.padding > 0 ? `${state.padding}px` : "";
  }
  if (has("margin")) {
    const m = Number(state.margin);
    el.style.margin = Number.isFinite(m) && m !== 0 ? `${m}px` : "";
  }
  if (has("width")) {
    const w = Number(state.width);
    el.style.width = Number.isFinite(w) && w > 0 ? `${Math.round(w)}px` : "";
  }
  if (has("height")) {
    const h = Number(state.height);
    el.style.height = Number.isFinite(h) && h > 0 ? `${Math.round(h)}px` : "";
  }
};
const HELP = [
    "jockey_stylish — a Word-style formatting ribbon for anything on the page.",
    "use: select an element, word, phrase, or char with stagejockey → +1 \"stylishmod\".",
    "     Text selections get wrapped in a span first. Done keeps the styles;",
    "     Cancel restores the old style (or removes the new wrap).",
    "needs: stagejockey (mount stylishmod too for web fonts; otherwise system fonts only)",
].join("\n");

export const register = (navi) => {
  const callout = (msg) => {
    if (typeof navi.callout === "function") navi.callout(msg);
  };

  const liveEl = (context) => {
    const el = context?.element;
    return el instanceof HTMLElement ? el : null;
  };

  const textRootOf = (context) => {
    if (context?.textRoot instanceof HTMLElement) return context.textRoot;
    if (context?.element instanceof HTMLElement) return context.element;
    if (context?.hostElement instanceof HTMLElement) return context.hostElement;
    return null;
  };

  const isTextClaim = (context) =>
    hasType(context, "word") ||
    hasType(context, "phrase") ||
    hasType(context, "char");

  const canStylish = (context) => {
    if (isTextClaim(context)) {
      const root = textRootOf(context);
      const span = context?.textSpan;
      if (!(root instanceof HTMLElement) || !span) return false;
      const a = Number(span.start);
      const b = Number(span.end);
      return Number.isFinite(a) && Number.isFinite(b) && b > a;
    }
    if (!hasType(context, "htm-element")) return false;
    return !!liveEl(context);
  };

  const domRangeFromTextOffsets = (root, startOffs, endOffs) => {
    if (!(root instanceof HTMLElement)) return null;
    const a = Math.max(0, Math.min(startOffs, endOffs));
    const b = Math.max(startOffs, endOffs);
    try {
      const range = document.createRange();
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let acc = 0;
      let startNode = null;
      let startOff = 0;
      let endNode = null;
      let endOff = 0;
      let lastNode = null;
      let n;
      while ((n = walker.nextNode())) {
        const len = String(n.textContent || "").length;
        if (len === 0) continue;
        lastNode = n;
        if (!startNode && a < acc + len) {
          startNode = n;
          startOff = a - acc;
        }
        if (!endNode && b <= acc + len) {
          endNode = n;
          endOff = b - acc;
          break;
        }
        acc += len;
      }
      if (!startNode) {
        if (!lastNode) return null;
        startNode = lastNode;
        startOff = String(lastNode.textContent || "").length;
      }
      if (!endNode) {
        if (!lastNode) return null;
        endNode = lastNode;
        endOff = String(lastNode.textContent || "").length;
      }
      range.setStart(startNode, startOff);
      range.setEnd(endNode, endOff);
      return range;
    } catch {
      return null;
    }
  };

  /** If the range is already exactly one stylish wrap, reuse it. */
  const existingStylishWrap = (range) => {
    try {
      const node = range?.commonAncestorContainer;
      const el = node?.nodeType === 1 ? node : node?.parentElement;
      if (!(el instanceof HTMLElement)) return null;
      const wrap =
        el.getAttribute?.("data-jockey-stylish") === "1"
          ? el
          : el.closest?.('span[data-jockey-stylish="1"]');
      if (!(wrap instanceof HTMLElement)) return null;
      const r = document.createRange();
      r.selectNodeContents(wrap);
      if (
        range.compareBoundaryPoints(Range.START_TO_START, r) === 0 &&
        range.compareBoundaryPoints(Range.END_TO_END, r) === 0
      ) {
        return wrap;
      }
    } catch {
      /* ignore */
    }
    return null;
  };

  const wrapTextSelection = (context) => {
    const root = textRootOf(context);
    const span = context?.textSpan;
    if (!(root instanceof HTMLElement) || !span) {
      throw new Error("no text selection");
    }
    const startOffs = Number(span.start) || 0;
    const endOffs = Math.max(startOffs, Number(span.end) || startOffs);
    if (endOffs <= startOffs) throw new Error("empty text selection");

    const range = domRangeFromTextOffsets(root, startOffs, endOffs);
    if (!range) throw new Error("cannot map text range");

    const reuse = existingStylishWrap(range);
    if (reuse) return { el: reuse, created: false };

    const wrap = document.createElement("span");
    wrap.setAttribute("data-jockey-stylish", "1");
    wrap.style.display = "inline-block";
    const extracted = range.extractContents();
    if (extracted && extracted.childNodes?.length) {
      wrap.appendChild(extracted);
    } else {
      wrap.textContent =
        span.text != null
          ? String(span.text)
          : String(root.textContent || "").slice(startOffs, endOffs);
    }
    range.insertNode(wrap);
    return { el: wrap, created: true };
  };

  const unwrapStylish = (wrap) => {
    if (!(wrap instanceof HTMLElement) || !wrap.parentNode) return;
    const parent = wrap.parentNode;
    while (wrap.firstChild) parent.insertBefore(wrap.firstChild, wrap);
    wrap.remove();
  };

  const refreshHostPresentation = (context, stage, textRoot) => {
    if (!stage || typeof stage.rememberPresentation !== "function") return;
    const host =
      (context?.hostElement instanceof HTMLElement && context.hostElement) ||
      (textRoot instanceof HTMLElement &&
        textRoot.closest?.("[data-part], [data-path]")) ||
      textRoot;
    if (!(host instanceof HTMLElement)) return;
    const prior =
      typeof stage.presentationFor === "function"
        ? stage.presentationFor(host)
        : null;
    const type = host.getAttribute("data-part") || prior?.type || "htmf";
    const path =
      host.getAttribute("data-path") ||
      prior?.path ||
      context?.path ||
      "";
    stage.rememberPresentation(host, {
      ...(prior && typeof prior === "object" ? prior : {}),
      type,
      value: host.outerHTML,
      ...(path ? { path: String(path).replace(/^\/+/, "") } : {}),
    });
  };

  const scrollbufferPlugin = {
    id: "jockey_stylish",
    name: "jockey_stylish",
    claims: [
      {
        id: "stylishmod",
        direction: 1,
        types: ["htm-element", "word", "phrase", "char"],
        color: "#2f6fed",
        describe: () => ({
          text: "stylishmod",
          color: "#2f6fed",
          textShadow: "0 1px 2px #001433, 0 0 2px #000, 0 0 1px #000",
        }),
        matches: (context) => canStylish(context),
        async execute(context, api) {
          if (typeof document === "undefined") return undefined;

          let el = null;
          let createdWrap = false;
          if (isTextClaim(context)) {
            const wrapped = wrapTextSelection(context);
            el = wrapped.el;
            createdWrap = wrapped.created;
          } else {
            el = liveEl(context);
          }
          if (!(el instanceof HTMLElement)) {
            throw new Error("no stylish target");
          }

          if (typeof api?.terminate === "function") api.terminate();

          const originalAttr = el.getAttribute("style");
          const originalCss = el.style.cssText;
          const originalFontAttr = el.getAttribute("data-jockey-font");
          const state = readState(el);
          const fontApi = navi?.mod?.stylishmod?.fonts || null;
          /** Font ids this ribbon loaded just for previews (released on close). */
          const previewLoaded = new Set();
          const touched = new Set();
          const mark = (...keys) => {
            for (const k of keys) touched.add(k);
          };

          return new Promise((resolve) => {
            const ui = { listeners: [] };
            const on = (type, target, fn, opts) => {
              target.addEventListener(type, fn, opts);
              ui.listeners.push([type, target, fn, opts]);
            };

            let settled = false;
            let resizeUi = null;

            const dismissResize = () => {
              if (!resizeUi) return;
              dismissUi(resizeUi);
              resizeUi = null;
            };

            const releasePreviews = (keepId) => {
              if (!fontApi || typeof fontApi.release !== "function") return;
              for (const id of previewLoaded) {
                if (id === keepId) continue;
                if (document.querySelector(`[data-jockey-font="${CSS.escape(id)}"]`)) continue;
                try {
                  fontApi.release(id);
                } catch {
                  /* ignore */
                }
              }
              previewLoaded.clear();
            };

            const restore = () => {
              dismissResize();
              if (createdWrap) {
                unwrapStylish(el);
                return;
              }
              if (originalFontAttr == null) el.removeAttribute("data-jockey-font");
              else el.setAttribute("data-jockey-font", originalFontAttr);
              if (originalAttr == null) el.removeAttribute("style");
              else el.setAttribute("style", originalAttr);
              if (!originalAttr && originalCss) {
                el.style.cssText = originalCss;
              }
            };

            const paint = () =>
              applyState(el, state, { touched, originalCss });

            const finish = (commit) => {
              if (settled) return;
              settled = true;
              dismissResize();
              for (const fn of ui.cleanups || []) {
                try {
                  fn();
                } catch {
                  /* ignore */
                }
              }
              dismissUi(ui);
              if (!commit) {
                restore();
                releasePreviews(null);
                resolve(undefined);
                return;
              }
              paint();
              if (!String(el.getAttribute("style") || "").trim()) {
                el.removeAttribute("style");
              }
              const keepFont = touched.has("fontFamily") ? state.fontId : "";
              if (keepFont && typeof fontApi?.remember === "function") {
                void Promise.resolve(fontApi.remember(keepFont)).catch(() => {});
              }
              releasePreviews(keepFont || null);
              const stage =
                api?.stage || navi?.mod?.stagedir?.stage || null;
              if (createdWrap || isTextClaim(context)) {
                const textRoot = textRootOf(context) || el.parentElement;
                refreshHostPresentation(context, stage, textRoot);
                if (stage && typeof stage.persist === "function") {
                  void stage.persist();
                }
              }
              callout(
                createdWrap
                  ? "[jockey_stylish] styled text wrap"
                  : "[jockey_stylish] applied styles on element"
              );
              resolve(undefined);
            };
            const root = document.createElement("div");
            root.id = "jockey-stylish";
            root.setAttribute("data-jockey-ui", "jockey-stylish");
            root.style.cssText = [
              "position:fixed",
              "z-index:2147483646",
              "width:min(22rem,calc(100vw - 16px))",
              "max-height:min(78vh,36rem)",
              "overflow:auto",
              "box-sizing:border-box",
              "padding:0.55rem 0.65rem 0.65rem",
              "background:linear-gradient(180deg,#f3f4f6 0%,#e5e7eb 100%)",
              "border:1px solid #9ca3af",
              "box-shadow:0 8px 24px rgba(0,0,0,.28), inset 0 1px 0 #fff",
              "font:12px/1.35 'Segoe UI',Tahoma,sans-serif",
              "color:#111827",
              "pointer-events:auto",
            ].join(";");

            const title = document.createElement("div");
            title.textContent = "stylish";
            title.style.cssText =
              "font:700 13px/1 'Segoe UI',Tahoma,sans-serif;letter-spacing:0.02em;margin:0 0 0.45rem;color:#1f2937;";
            root.appendChild(title);

            root.appendChild(title);

            const section = (label) => {
              const wrap = document.createElement("div");
              wrap.style.cssText =
                "margin:0.45rem 0 0.25rem;padding-top:0.35rem;border-top:1px solid #cbd5e1;";
              const h = document.createElement("div");
              h.textContent = label;
              h.style.cssText =
                "font:600 10px/1 'Segoe UI',Tahoma,sans-serif;text-transform:uppercase;letter-spacing:0.06em;color:#4b5563;margin-bottom:0.35rem;";
              wrap.appendChild(h);
              root.appendChild(wrap);
              return wrap;
            };

            const row = (parent) => {
              const r = document.createElement("div");
              r.style.cssText =
                "display:flex;flex-wrap:wrap;gap:0.35rem 0.55rem;align-items:center;margin:0.2rem 0;";
              parent.appendChild(r);
              return r;
            };

            const labelEl = (text) => {
              const s = document.createElement("span");
              s.textContent = text;
              s.style.cssText = "min-width:3.2rem;color:#374151;font-weight:600;";
              return s;
            };

            const fieldStyle =
              "font:12px 'Segoe UI',Tahoma,sans-serif;padding:0.15rem 0.3rem;border:1px solid #9ca3af;border-radius:2px;background:#fff;color:#111;min-width:0;";

            const makeSelect = (values, current, onChange) => {
              const sel = document.createElement("select");
              sel.style.cssText = fieldStyle + "min-width:5.5rem;";
              for (const v of values) {
                const opt = document.createElement("option");
                opt.value = v;
                opt.textContent = v;
                if (String(v) === String(current)) opt.selected = true;
                sel.appendChild(opt);
              }
              on("change", sel, () => onChange(sel.value));
              return sel;
            };

            const makeNumber = (value, opts, onChange) => {
              const input = document.createElement("input");
              input.type = "number";
              if (opts.min != null) input.min = String(opts.min);
              if (opts.max != null) input.max = String(opts.max);
              if (opts.step != null) input.step = String(opts.step);
              input.value = String(value);
              input.style.cssText = fieldStyle + "width:4.2rem;";
              const fire = () => {
                const n = Number.parseFloat(input.value);
                if (!Number.isFinite(n)) return;
                onChange(n);
              };
              on("input", input, fire);
              on("change", input, fire);
              return input;
            };

            const makeColor = (value, onChange) => {
              const wrap = document.createElement("span");
              wrap.style.cssText = "display:inline-flex;align-items:center;gap:0.25rem;";
              const swatch = document.createElement("input");
              swatch.type = "color";
              swatch.value = cssColor(value, "#000000");
              swatch.style.cssText =
                "width:1.6rem;height:1.4rem;padding:0;border:1px solid #6b7280;border-radius:2px;background:#fff;cursor:pointer;";
              const hex = document.createElement("input");
              hex.type = "text";
              hex.value = swatch.value;
              hex.spellcheck = false;
              hex.style.cssText = fieldStyle + "width:5.2rem;font-family:ui-monospace,Consolas,monospace;";
              const sync = (c) => {
                const next = cssColor(c, swatch.value);
                swatch.value = next;
                hex.value = next;
                onChange(next);
              };
              on("input", swatch, () => sync(swatch.value));
              on("change", hex, () => sync(hex.value));
              wrap.appendChild(swatch);
              wrap.appendChild(hex);
              return wrap;
            };

            const makeCheck = (label, checked, onChange) => {
              const wrap = document.createElement("label");
              wrap.style.cssText =
                "display:inline-flex;align-items:center;gap:0.25rem;cursor:pointer;font-weight:600;color:#374151;";
              const box = document.createElement("input");
              box.type = "checkbox";
              box.checked = !!checked;
              on("change", box, () => onChange(box.checked));
              wrap.appendChild(box);
              wrap.appendChild(document.createTextNode(label));
              return wrap;
            };

            // —— Font ——
            const fontSec = section("Font");
            const stackOf = (font) =>
              typeof fontApi?.stack === "function"
                ? fontApi.stack(font)
                : localFontStack(font);
            const firstFamily = (stack) =>
              String(stack || "").split(",")[0].replace(/["']/g, "").trim();

            const fontHead = row(fontSec);
            fontHead.appendChild(labelEl("Font"));
            const currentFont = document.createElement("span");
            currentFont.style.cssText =
              "flex:1 1 6rem;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;color:#111827;";
            const showCurrent = () => {
              const fam = state.fontFamily || "";
              const inherited = firstFamily(state.computedFontFamily);
              currentFont.textContent = fam
                ? firstFamily(fam)
                : `(inherit${inherited ? `: ${inherited}` : ""})`;
              currentFont.title = fam || state.computedFontFamily || "";
              currentFont.style.fontFamily = fam || "";
              currentFont.style.fontStyle = fam ? "normal" : "italic";
            };
            showCurrent();
            fontHead.appendChild(currentFont);
            const inheritBtn = document.createElement("button");
            inheritBtn.type = "button";
            inheritBtn.textContent = "inherit";
            inheritBtn.title = "Remove font-family from this element";
            inheritBtn.style.cssText =
              "font:600 11px 'Segoe UI',Tahoma,sans-serif;padding:0.1rem 0.45rem;border-radius:3px;cursor:pointer;border:1px solid #9ca3af;background:#f9fafb;color:#111827;";
            fontHead.appendChild(inheritBtn);

            const fontFilterRow = row(fontSec);
            const fontFilter = document.createElement("input");
            fontFilter.type = "search";
            fontFilter.placeholder = "search fonts…";
            fontFilter.spellcheck = false;
            fontFilter.style.cssText = fieldStyle + "flex:1 1 8rem;";
            fontFilterRow.appendChild(fontFilter);
            let refilter = () => {};
            const fontCat = makeSelect(FONT_CATEGORIES, "all", () => refilter());
            fontFilterRow.appendChild(fontCat);

            const fontList = document.createElement("div");
            fontList.setAttribute("role", "listbox");
            fontList.style.cssText =
              "max-height:11rem;overflow-y:auto;overscroll-behavior:contain;border:1px solid #9ca3af;border-radius:2px;background:#fff;margin:0.25rem 0 0.15rem;";
            fontSec.appendChild(fontList);
            const fontNote = document.createElement("div");
            fontNote.style.cssText = "font-size:10px;color:#6b7280;";
            fontSec.appendChild(fontNote);

            let allFonts =
              typeof fontApi?.system === "function" ? fontApi.system() : LOCAL_FONTS;
            let filtered = [];
            let rendered = 0;
            /** font id → list row */
            const fontRows = new Map();
            const previewTimers = new Map();
            let catalogNote = fontApi
              ? fontApi.enabled?.() === false
                ? "web fonts off — stylishmod fonts on"
                : "loading open font catalog…"
              : "system fonts only — mount stylishmod for open web fonts";

            const isCurrent = (font) =>
              state.fontId
                ? font.id === state.fontId
                : !!state.fontFamily && stackOf(font) === state.fontFamily;

            const markSelected = () => {
              for (const rowEl of fontRows.values()) {
                const sel = !!rowEl._font && isCurrent(rowEl._font);
                rowEl.style.background = sel ? "#dbeafe" : "";
                rowEl.setAttribute("aria-selected", sel ? "true" : "false");
              }
            };

            const loadWebFont = async (font) => {
              if (font.source === "system" || !fontApi) return stackOf(font);
              const was = fontApi.loaded?.(font.id);
              const got = await fontApi.load(font);
              if (!was) previewLoaded.add(font.id);
              return got?.stack || stackOf(font);
            };

            const previewObserver =
              typeof IntersectionObserver === "function"
                ? new IntersectionObserver(
                    (entries) => {
                      for (const entry of entries) {
                        const rowEl = entry.target;
                        const font = rowEl._font;
                        if (!font) continue;
                        if (!entry.isIntersecting) {
                          clearTimeout(previewTimers.get(font.id));
                          previewTimers.delete(font.id);
                          continue;
                        }
                        if (previewTimers.has(font.id)) continue;
                        previewTimers.set(
                          font.id,
                          setTimeout(async () => {
                            previewTimers.delete(font.id);
                            if (settled) return;
                            previewObserver.unobserve(rowEl);
                            try {
                              rowEl._name.style.fontFamily = await loadWebFont(font);
                            } catch {
                              /* keep generic fallback */
                            }
                          }, FONT_PREVIEW_DELAY_MS)
                        );
                      }
                    },
                    { root: fontList }
                  )
                : null;

            const makeFontRow = (font, idx) => {
              const rowEl = document.createElement("div");
              rowEl.setAttribute("role", "option");
              rowEl.dataset.fontIdx = String(idx);
              rowEl.style.cssText =
                "display:flex;align-items:baseline;gap:0.4rem;padding:0.2rem 0.4rem;cursor:pointer;border-bottom:1px solid #f1f5f9;";
              const name = document.createElement("span");
              name.textContent = font.family;
              name.style.cssText =
                "flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;line-height:1.3;";
              name.style.fontFamily =
                font.source === "system"
                  ? stackOf(font)
                  : localFontStack({ family: "sans-serif", category: font.category });
              const tag = document.createElement("span");
              tag.textContent = font.source === "system" ? "system" : font.category;
              tag.style.cssText = "flex:none;font-size:9px;color:#9ca3af;";
              rowEl.appendChild(name);
              rowEl.appendChild(tag);
              rowEl._font = font;
              rowEl._name = name;
              fontRows.set(font.id, rowEl);
              if (font.source !== "system" && previewObserver) previewObserver.observe(rowEl);
              return rowEl;
            };

            const renderMore = () => {
              const end = Math.min(filtered.length, rendered + FONT_LIST_CHUNK);
              if (end <= rendered) return;
              const frag = document.createDocumentFragment();
              for (let i = rendered; i < end; i++) frag.appendChild(makeFontRow(filtered[i], i));
              rendered = end;
              fontList.appendChild(frag);
              markSelected();
            };

            const updateNote = () => {
              fontNote.textContent = `${filtered.length} of ${allFonts.length} fonts · ${catalogNote}`;
            };

            refilter = () => {
              const q = fontFilter.value.trim().toLowerCase();
              const cat = fontCat.value;
              filtered = allFonts.filter((f) => {
                if (cat === "system" && f.source !== "system") return false;
                if (cat !== "all" && cat !== "system" && f.category !== cat) return false;
                return !q || f.family.toLowerCase().includes(q) || f.id.toLowerCase().includes(q);
              });
              if (previewObserver) previewObserver.disconnect();
              for (const t of previewTimers.values()) clearTimeout(t);
              previewTimers.clear();
              fontRows.clear();
              fontList.textContent = "";
              fontList.scrollTop = 0;
              rendered = 0;
              renderMore();
              updateNote();
            };

            const selectFont = async (font) => {
              let stack = stackOf(font);
              try {
                stack = await loadWebFont(font);
              } catch (err) {
                fontNote.textContent = `load failed: ${err?.message || err}`;
              }
              if (settled) return;
              state.fontFamily = stack;
              state.fontId = font.source === "system" ? "" : font.id;
              mark("fontFamily");
              paint();
              showCurrent();
              markSelected();
            };

            on("click", fontList, (e) => {
              const rowEl = e.target instanceof Element ? e.target.closest("[data-font-idx]") : null;
              const font = rowEl?._font;
              if (font) void selectFont(font);
            });
            on("scroll", fontList, () => {
              if (fontList.scrollTop + fontList.clientHeight >= fontList.scrollHeight - 48) {
                renderMore();
              }
            });
            let filterTimer = null;
            on("input", fontFilter, () => {
              clearTimeout(filterTimer);
              filterTimer = setTimeout(() => refilter(), 120);
            });
            on("keydown", fontFilter, (e) => {
              if (e.key === "Escape") return;
              e.stopPropagation();
              if (e.key === "Enter" && filtered[0]) {
                e.preventDefault();
                void selectFont(filtered[0]);
              }
            });
            on("click", inheritBtn, (e) => {
              e.preventDefault();
              state.fontFamily = "";
              state.fontId = "";
              mark("fontFamily");
              paint();
              showCurrent();
              markSelected();
            });

            ui.cleanups = [
              () => {
                clearTimeout(filterTimer);
                for (const t of previewTimers.values()) clearTimeout(t);
                previewTimers.clear();
                previewObserver?.disconnect();
              },
            ];

            refilter();
            if (fontApi && fontApi.enabled?.() !== false && typeof fontApi.list === "function") {
              Promise.resolve(fontApi.list())
                .then((list) => {
                  if (settled || !Array.isArray(list) || !list.length) return;
                  allFonts = list;
                  const webCount = list.filter((f) => f.source !== "system").length;
                  catalogNote = webCount
                    ? "open fonts via stylishmod"
                    : "catalog unavailable — system fonts only";
                  refilter();
                })
                .catch((err) => {
                  catalogNote = `catalog failed: ${err?.message || err}`;
                  updateNote();
                });
            }

            // —— Text ——
            const textSec = section("Text");
            let r = row(textSec);
            r.appendChild(labelEl("Color"));
            r.appendChild(
              makeColor(state.color, (c) => {
                state.color = c;
                mark("color");
                paint();
              })
            );
            r = row(textSec);
            r.appendChild(labelEl("Size"));
            r.appendChild(
              makeNumber(state.fontSize, { min: 6, max: 200, step: 1 }, (n) => {
                state.fontSize = n;
                mark("fontSize");
                paint();
              })
            );
            r.appendChild(document.createTextNode("px"));
            r.appendChild(labelEl("Weight"));
            r.appendChild(
              makeSelect(WEIGHTS, state.fontWeight, (v) => {
                state.fontWeight = v;
                mark("fontWeight");
                paint();
              })
            );
            r = row(textSec);
            r.appendChild(labelEl("Style"));
            r.appendChild(
              makeSelect(FONT_STYLES, state.fontStyle, (v) => {
                state.fontStyle = v;
                mark("fontStyle");
                paint();
              })
            );
            r.appendChild(labelEl("Align"));
            r.appendChild(
              makeSelect(ALIGNS, state.textAlign, (v) => {
                state.textAlign = v;
                mark("textAlign");
                paint();
              })
            );
            r = row(textSec);
            r.appendChild(labelEl("Deco"));
            r.appendChild(
              makeSelect(DECOS, state.textDecoration, (v) => {
                state.textDecoration = v;
                mark("textDecoration");
                paint();
              })
            );

            // —— Highlight ——
            const fillSec = section("Highlight");
            r = row(fillSec);
            r.appendChild(labelEl("Fill"));
            r.appendChild(
              makeColor(state.backgroundColor, (c) => {
                state.backgroundColor = c;
                state.bgClear = false;
                mark("backgroundColor");
                paint();
              })
            );
            r.appendChild(
              makeCheck("clear", state.bgClear, (onClear) => {
                state.bgClear = onClear;
                mark("backgroundColor");
                paint();
              })
            );

            // —— Border ——
            const borderSec = section("Border");
            r = row(borderSec);
            r.appendChild(labelEl("Width"));
            r.appendChild(
              makeNumber(
                state.borderWidth,
                { min: 0, max: 64, step: 1 },
                (n) => {
                  state.borderWidth = n;
                  mark("borderWidth");
                  paint();
                }
              )
            );
            r.appendChild(document.createTextNode("px"));
            r.appendChild(
              makeSelect(BORDER_STYLES, state.borderStyle, (v) => {
                state.borderStyle = v;
                mark("borderStyle");
                paint();
              })
            );
            r = row(borderSec);
            r.appendChild(labelEl("Color"));
            r.appendChild(
              makeColor(state.borderColor, (c) => {
                state.borderColor = c;
                mark("borderColor");
                paint();
              })
            );
            r.appendChild(labelEl("Radius"));
            r.appendChild(
              makeNumber(
                state.borderRadius,
                { min: 0, max: 200, step: 1 },
                (n) => {
                  state.borderRadius = n;
                  mark("borderRadius");
                  paint();
                }
              )
            );

            // —— Shadow ——
            const shadowSec = section("Shadow");
            r = row(shadowSec);
            r.appendChild(
              makeCheck("text", state.textShadow.on, (onSh) => {
                state.textShadow.on = onSh;
                mark("textShadow");
                paint();
              })
            );
            r.appendChild(
              makeColor(state.textShadow.color, (c) => {
                state.textShadow.color = c;
                state.textShadow.on = true;
                mark("textShadow");
                paint();
              })
            );
            r.appendChild(document.createTextNode("blur"));
            r.appendChild(
              makeNumber(
                state.textShadow.blur,
                { min: 0, max: 64, step: 1 },
                (n) => {
                  state.textShadow.blur = n;
                  state.textShadow.on = true;
                  mark("textShadow");
                  paint();
                }
              )
            );
            r = row(shadowSec);
            r.appendChild(
              makeCheck("box", state.boxShadow.on, (onSh) => {
                state.boxShadow.on = onSh;
                mark("boxShadow");
                paint();
              })
            );
            r.appendChild(
              makeColor(state.boxShadow.color, (c) => {
                state.boxShadow.color = c;
                state.boxShadow.on = true;
                mark("boxShadow");
                paint();
              })
            );
            r.appendChild(document.createTextNode("blur"));
            r.appendChild(
              makeNumber(
                state.boxShadow.blur,
                { min: 0, max: 64, step: 1 },
                (n) => {
                  state.boxShadow.blur = n;
                  state.boxShadow.on = true;
                  mark("boxShadow");
                  paint();
                }
              )
            );

            // —— Layout ——
            const layoutSec = section("Layout");
            r = row(layoutSec);
            r.appendChild(labelEl("Pad"));
            r.appendChild(
              makeNumber(state.padding, { min: 0, max: 200, step: 1 }, (n) => {
                state.padding = n;
                mark("padding");
                paint();
              })
            );
            r.appendChild(document.createTextNode("px"));
            r.appendChild(labelEl("Marg"));
            r.appendChild(
              makeNumber(
                state.margin,
                { min: -200, max: 200, step: 1 },
                (n) => {
                  state.margin = n;
                  mark("margin");
                  paint();
                }
              )
            );
            r.appendChild(document.createTextNode("px"));
            r.appendChild(labelEl("Opacity"));
            r.appendChild(
              makeNumber(
                state.opacity,
                { min: 0, max: 1, step: 0.05 },
                (n) => {
                  state.opacity = Math.max(0, Math.min(1, n));
                  mark("opacity");
                  paint();
                }
              )
            );

            r = row(layoutSec);
            r.appendChild(labelEl("W"));
            const widthInput = makeNumber(
              state.width,
              { min: 1, max: 4000, step: 1 },
              (n) => {
                state.width = n;
                mark("width");
                paint();
              }
            );
            r.appendChild(widthInput);
            r.appendChild(document.createTextNode("px"));
            r.appendChild(labelEl("H"));
            const heightInput = makeNumber(
              state.height,
              { min: 1, max: 4000, step: 1 },
              (n) => {
                state.height = n;
                mark("height");
                paint();
              }
            );
            r.appendChild(heightInput);
            r.appendChild(document.createTextNode("px"));

            const syncSizeFields = (w, h) => {
              state.width = Math.max(1, Math.round(w));
              state.height = Math.max(1, Math.round(h));
              mark("width", "height");
              widthInput.value = String(state.width);
              heightInput.value = String(state.height);
              paint();
            };

            const openResizeUi = () => {
              if (settled) return;
              dismissResize();

              const startW = Math.max(1, Number(state.width) || 1);
              const startH = Math.max(1, Number(state.height) || 1);
              const { pw: initPw, ph: initPh } = previewBox(startW, startH);
              let boxW = initPw;
              let boxH = initPh;
              const scaleX = startW / boxW;
              const scaleY = startH / boxH;
              let liveW = startW;
              let liveH = startH;

              const rui = { listeners: [] };
              const ron = (type, target, fn, opts) => {
                target.addEventListener(type, fn, opts);
                rui.listeners.push([type, target, fn, opts]);
              };

              const frame = document.createElement("div");
              frame.id = "jockey-stylish-resize";
              frame.setAttribute("data-jockey-ui", "jockey-stylish-resize");
              frame.style.cssText = [
                "position:fixed",
                "z-index:2147483647",
                "pointer-events:auto",
                "box-sizing:border-box",
                "border:2px solid #2f6fed",
                "background:rgba(47,111,237,.18)",
                "box-shadow:0 0 0 1px rgba(0,0,0,.45)",
              ].join(";");

              const label = document.createElement("div");
              label.style.cssText =
                "position:absolute;left:0;top:-1.4em;font:600 11px/1 monospace;color:#dbeafe;text-shadow:0 1px 2px #000;white-space:nowrap;pointer-events:none";
              frame.appendChild(label);

              const corners = ["nw", "ne", "sw", "se"];
              const handles = {};
              for (const c of corners) {
                const h = document.createElement("button");
                h.type = "button";
                h.dataset.corner = c;
                h.setAttribute("aria-label", `resize ${c}`);
                h.style.cssText = [
                  "position:absolute",
                  `width:${RESIZE_HANDLE}px`,
                  `height:${RESIZE_HANDLE}px`,
                  "padding:0",
                  "margin:0",
                  "border:2px solid #fff",
                  "border-radius:50%",
                  "background:#2f6fed",
                  "box-sizing:border-box",
                  "cursor:nwse-resize",
                  "pointer-events:auto",
                ].join(";");
                if (c === "ne" || c === "sw") h.style.cursor = "nesw-resize";
                frame.appendChild(h);
                handles[c] = h;
              }

              const placeHandles = () => {
                const half = RESIZE_HANDLE / 2;
                handles.nw.style.left = `${-half}px`;
                handles.nw.style.top = `${-half}px`;
                handles.ne.style.left = `${boxW - half}px`;
                handles.ne.style.top = `${-half}px`;
                handles.sw.style.left = `${-half}px`;
                handles.sw.style.top = `${boxH - half}px`;
                handles.se.style.left = `${boxW - half}px`;
                handles.se.style.top = `${boxH - half}px`;
              };

              let pos = placeNearTarget(el, boxW, boxH);
              let boxLeft = pos.left;
              let boxTop = pos.top;

              const layout = () => {
                frame.style.left = `${boxLeft}px`;
                frame.style.top = `${boxTop}px`;
                frame.style.width = `${boxW}px`;
                frame.style.height = `${boxH}px`;
                placeHandles();
                label.textContent = `${Math.round(liveW)}×${Math.round(liveH)}`;
              };

              const setLiveFromBox = () => {
                liveW = Math.max(1, boxW * scaleX);
                liveH = Math.max(1, boxH * scaleY);
                syncSizeFields(liveW, liveH);
                layout();
              };

              layout();
              document.body.appendChild(frame);
              rui.root = frame;
              resizeUi = rui;

              let drag = null;

              for (const c of corners) {
                ron(
                  "pointerdown",
                  handles[c],
                  (e) => {
                    if (e.pointerType === "mouse" && e.button !== 0) return;
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
                    handles[c].style.borderColor = "#2f6fed";
                    try {
                      handles[c].setPointerCapture(e.pointerId);
                    } catch {
                      /* ignore */
                    }
                  },
                  true
                );
              }

              ron(
                "pointermove",
                document,
                (e) => {
                  if (!drag) return;
                  e.preventDefault();
                  const dx = e.clientX - drag.startX;
                  const dy = e.clientY - drag.startY;
                  let nextW = drag.startBoxW;
                  let nextH = drag.startBoxH;
                  if (drag.corner === "se" || drag.corner === "ne") {
                    nextW = drag.startBoxW + dx;
                  } else {
                    nextW = drag.startBoxW - dx;
                  }
                  if (drag.corner === "se" || drag.corner === "sw") {
                    nextH = drag.startBoxH + dy;
                  } else {
                    nextH = drag.startBoxH - dy;
                  }
                  nextW = Math.max(48, nextW);
                  nextH = Math.max(48, nextH);
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
                },
                true
              );

              const endDrag = () => {
                if (!drag) return;
                const c = drag.corner;
                drag = null;
                if (handles[c]) {
                  handles[c].style.background = "#2f6fed";
                  handles[c].style.borderColor = "#fff";
                }
              };
              ron("pointerup", document, endDrag, true);
              ron("pointercancel", document, endDrag, true);

              // Click frame (not handle) → close resize UI; sizes stay in stylish.
              ron("click", frame, (e) => {
                if (e.target !== frame) return;
                e.preventDefault();
                e.stopPropagation();
                dismissResize();
              });

              for (const ev of ["pointerdown", "mousedown", "click", "wheel"]) {
                ron(ev, frame, (e) => {
                  e.stopPropagation();
                });
              }
            };

            const resizeBtn = document.createElement("button");
            resizeBtn.type = "button";
            resizeBtn.textContent = "Resize";
            resizeBtn.title =
              "Open a corner frame near the target; sizes feed W/H here";
            resizeBtn.style.cssText = [
              "font:600 11px 'Segoe UI',Tahoma,sans-serif",
              "padding:0.2rem 0.55rem",
              "border-radius:3px",
              "cursor:pointer",
              "border:1px solid #1d4ed8",
              "background:#dbeafe",
              "color:#1e3a8a",
            ].join(";");
            on("pointerdown", resizeBtn, (e) => {
              e.preventDefault();
              e.stopPropagation();
              openResizeUi();
            });
            on("click", resizeBtn, (e) => {
              e.preventDefault();
              e.stopPropagation();
              openResizeUi();
            });
            r.appendChild(resizeBtn);
            // —— Actions ——
            const actions = document.createElement("div");
            actions.style.cssText =
              "display:flex;justify-content:flex-end;gap:0.45rem;margin-top:0.65rem;padding-top:0.45rem;border-top:1px solid #cbd5e1;";
            const btnCss = (primary) =>
              [
                "font:600 12px 'Segoe UI',Tahoma,sans-serif",
                "padding:0.35rem 0.85rem",
                "border-radius:3px",
                "cursor:pointer",
                primary
                  ? "border:1px solid #1d4ed8;background:#2563eb;color:#fff"
                  : "border:1px solid #9ca3af;background:#f9fafb;color:#111827",
              ].join(";");

            const cancelBtn = document.createElement("button");
            cancelBtn.type = "button";
            cancelBtn.textContent = "Cancel";
            cancelBtn.style.cssText = btnCss(false);

            const doneBtn = document.createElement("button");
            doneBtn.type = "button";
            doneBtn.textContent = "Done";
            doneBtn.style.cssText = btnCss(true);

            const bindAction = (btn, commit) => {
              const go = (e) => {
                e.preventDefault();
                e.stopPropagation();
                void finish(commit);
              };
              // pointerdown: supermouse/stage often swallow later click
              on("pointerdown", btn, go);
              on("click", btn, go);
            };
            bindAction(cancelBtn, false);
            bindAction(doneBtn, true);

            actions.appendChild(cancelBtn);
            actions.appendChild(doneBtn);
            root.appendChild(actions);

            const px = api.jockey?._pointer?.x ?? 24;
            const py = api.jockey?._pointer?.y ?? 48;
            root.style.left = `${Math.min(px + 14, window.innerWidth - 360)}px`;
            root.style.top = `${Math.max(8, Math.min(py - 8, window.innerHeight - 120))}px`;

            document.body.appendChild(root);
            ui.root = root;

            on(
              "keydown",
              window,
              (e) => {
                if (e.key !== "Escape") return;
                e.preventDefault();
                if (resizeUi) {
                  dismissResize();
                  return;
                }
                void finish(false);
              },
              true
            );

            // Bubble only — capture:true was stopping events before Cancel/Done.
            for (const ev of ["pointerdown", "mousedown", "click", "wheel"]) {
              on(ev, root, (e) => {
                e.stopPropagation();
              });
            }

            // Outside ribbon: dismiss resize first if open; else Cancel stylish.
            const outside = (e) => {
              if (settled) return;
              const t = e.target;
              if (t instanceof Node && root.contains(t)) return;
              if (t instanceof Node && resizeUi?.root?.contains?.(t)) return;
              e.preventDefault?.();
              e.stopPropagation?.();
              if (resizeUi) {
                dismissResize();
                return;
              }
              void finish(false);
            };
            queueMicrotask(() => {
              if (settled) return;
              on("pointerdown", document, outside, true);
              on("mousedown", document, outside, true);
            });
          });
        },
      },
    ],
  };

  return {
    name: "jockey_stylish",
    commands: {
      jockey_stylish: { name: "jockey_stylish", description: "help", execute: async () => HELP },
    },
    version: "0.2.1",
    description:
      "Jockey +1 htm-element/word/phrase/char: CSS ribbon; text wraps then styles",
    moduleInfo: {
      name: "jockey_stylish",
      version: "0.2.1",
      description:
        "Searchable, scrolling font picker (open web fonts via stylishmod, system fonts otherwise)",
    },
    scrollbufferPlugin,
    onMount: async () => {
      if (typeof navi.callout === "function") {
        navi.callout(
          "[jockey_stylish] mounted — +1 stylishmod on htm-element · word · phrase · char"
        );
      }
    },
  };
};
