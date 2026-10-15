/**
 * scrollball — lower-center marble. Drag to roll; clamp at arrow mids but keep
 * rolling; pan the page via body translate (no overflow scroll). Release
 * springs the ball home and keeps the pan. Hold still 1.5s to minimize (grow+fade).
 * Double-tap: blue place-mode — drag moves the HUD; position prefs tip.
 *
 * Prefs tip: navi:scrollball:prefs  { hudX, hudY, minimized }
 * Minimize persists — next mount starts minimized if last left minimized.
 */
export const register = (navi) => {
  const NAME = "scrollball";
  const VERSION = "0.1.10";
  const DESCRIPTION =
    "Lower-center 48-corner marble. Drag pans; double-tap place-mode; hold 1.5s minimize (persists).";

  const isBrowser =
    typeof window !== "undefined" && typeof window.document !== "undefined";

  const PREFS_IB = "navi:scrollball:prefs";
  const DEFAULT_PREFS = { hudX: 0.5, hudY: 0.75, minimized: false };

  const GOLDEN = Math.PI * (3 - Math.sqrt(5));
  const CORNERS = 48;
  const CANVAS = 234;
  const ARROW_LEN = 26;
  const ARROW_WID = 13;
  /** Arrow mids at half the prior radius from center. */
  const ARROW_MID = Math.round((CANVAS / 2 + 5) / 2);
  const WIDGET = Math.max(CANVAS, ARROW_MID * 2 + ARROW_LEN + 16);
  const SENS = 6.4;
  const ROLL_K = 2.15 / 78;
  const HOLD_STILL_MS = 1500;
  const HOLD_REWIND_DELAY_MS = 500;
  const HOLD_SLOP = 36;
  const HOLD_EXPAND_PEAK = 1.48;
  const FADE_MS = 210;
  const DOUBLE_TAP_MS = 380;
  const DOUBLE_TAP_SLOP = 32;

  /** Face / edge / vertex draw alpha (half of prior 0.9). */
  const BALL_ALPHA = 0.45;
  /** Arrow fill/stroke opacity (half of prior 0.8). */
  const ARROW_ALPHA = 0.4;

  const ARROW_GREY = {
    fill: "#4e4e4e",
    stroke: "#2a2a2a",
  };
  const ARROW_BLUE = {
    fill: "#3a7adf",
    stroke: "#1a4a9a",
  };

  let prefs = { ...DEFAULT_PREFS };
  let placeMode = false;
  let savePrefsTimer = 0;
  let lastTapAt = 0;
  let lastTapPos = { x: 0, y: 0 };

  const eventListeners = [];
  const created = [];
  let enabled = false;
  let raf = 0;
  let canvas = null;
  let widget = null;
  let restoreBtn = null;
  let styleEl = null;
  let minimized = false;
  let holding = false;
  let holdOrigin = { x: 0, y: 0 };
  let holdTimer = 0;
  let holdStart = 0;
  let ballScale = 1;
  let fading = false;
  let fadeStart = 0;
  /** @type {{ fromX: number, fromY: number, fromOx: number, fromOy: number, start: number, totalMs: number }|null} */
  let rewind = null;

  let verts = [];
  let faces = [];
  let edges = [];
  let rot = { x: 0.35, y: 0.45 };
  let offset = { x: 0, y: 0 };
  let pan = { x: 0, y: 0 };
  let dragging = false;
  let lastPtr = { x: 0, y: 0 };
  let prevBodyTransform = "";
  let prevBodyWillChange = "";

  const trackListener = (element, event, handler, opts) => {
    element.addEventListener(event, handler, opts);
    eventListeners.push({ element, event, handler, opts });
  };

  const prefsTipIb = () => {
    try {
      const presume = navi.storage?.tip?.presume;
      if (typeof presume === "function") return String(presume(PREFS_IB));
    } catch {
      /* fall through */
    }
    return PREFS_IB;
  };

  const clampHud = (n) => {
    const x = Number(n);
    if (!Number.isFinite(x)) return null;
    return Math.min(0.92, Math.max(0.08, Math.round(x * 1000) / 1000));
  };

  const mergePrefs = (raw) => {
    const next = { ...DEFAULT_PREFS };
    if (!raw || typeof raw !== "object") return next;
    const x = clampHud(raw.hudX);
    const y = clampHud(raw.hudY);
    if (x != null) next.hudX = x;
    if (y != null) next.hudY = y;
    if (typeof raw.minimized === "boolean") next.minimized = raw.minimized;
    else if (raw.minimized === 0 || raw.minimized === 1) {
      next.minimized = !!raw.minimized;
    } else if (raw.minimized === "true" || raw.minimized === "false") {
      next.minimized = raw.minimized === "true";
    }
    return next;
  };

  const loadPrefs = async () => {
    try {
      const tip = navi.storage?.tip;
      if (!tip || typeof tip.get !== "function") {
        prefs = { ...DEFAULT_PREFS };
        return prefs;
      }
      const frame = await tip.get(prefsTipIb());
      prefs = mergePrefs(frame?.data);
    } catch (err) {
      console.warn("[scrollball] loadPrefs failed", err);
      prefs = { ...DEFAULT_PREFS };
    }
    return prefs;
  };

  const savePrefs = async () => {
    const tip = navi.storage?.tip;
    if (!tip || typeof tip.mut8 !== "function") {
      throw new Error("navi.storage.tip.mut8 unavailable");
    }
    await tip.mut8(
      prefsTipIb(),
      {
        hudX: prefs.hudX,
        hudY: prefs.hudY,
        minimized: !!prefs.minimized,
      },
      { replaceData: true, create: true }
    );
    return prefs;
  };

  const scheduleSavePrefs = () => {
    if (savePrefsTimer) clearTimeout(savePrefsTimer);
    savePrefsTimer = setTimeout(() => {
      savePrefsTimer = 0;
      void savePrefs().catch((err) =>
        console.warn("[scrollball] savePrefs failed", err)
      );
    }, 450);
  };

  const applyHudPos = () => {
    if (!widget || !isBrowser) return;
    const vw = Math.max(1, window.innerWidth || 1);
    const vh = Math.max(1, window.innerHeight || 1);
    widget.style.left = prefs.hudX * vw + "px";
    widget.style.top = prefs.hudY * vh + "px";
    widget.style.margin = "0";
    widget.style.transform = "translate(-50%, -50%)";
  };

  const paintArrows = () => {
    if (!widget) return;
    const c = placeMode ? ARROW_BLUE : ARROW_GREY;
    widget.querySelectorAll("[data-part=scrollball-arrows] polygon").forEach((p) => {
      p.setAttribute("fill", c.fill);
      p.setAttribute("stroke", c.stroke);
      p.setAttribute("fill-opacity", String(ARROW_ALPHA));
      p.setAttribute("stroke-opacity", String(ARROW_ALPHA));
    });
    widget.setAttribute("data-place", placeMode ? "1" : "0");
  };

  const setPlaceMode = (on) => {
    placeMode = !!on;
    paintArrows();
    if (!placeMode) scheduleSavePrefs();
  };

  const togglePlaceMode = () => {
    setPlaceMode(!placeMode);
    resetHoldGrow();
    clearHoldTimer();
    holding = false;
    dragging = false;
  };

  const norm = (v) => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  };

  const fibonacciSphere = (n) => {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const y = 1 - (2 * i) / Math.max(1, n - 1);
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const t = GOLDEN * i;
      pts.push(norm([Math.cos(t) * r, y, Math.sin(t) * r]));
    }
    return pts;
  };

  const hull = (pts) => {
    const n = pts.length;
    const faceList = [];
    const edgeSet = new Set();
    const key = (a, b) => (a < b ? a + "," + b : b + "," + a);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        for (let k = j + 1; k < n; k++) {
          const a = pts[i];
          const b = pts[j];
          const c = pts[k];
          let nx =
            (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
          let ny =
            (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
          let nz =
            (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
          const len = Math.hypot(nx, ny, nz);
          if (len < 1e-8) continue;
          nx /= len;
          ny /= len;
          nz /= len;
          const cx = (a[0] + b[0] + c[0]) / 3;
          const cy = (a[1] + b[1] + c[1]) / 3;
          const cz = (a[2] + b[2] + c[2]) / 3;
          if (nx * cx + ny * cy + nz * cz < 0) {
            nx = -nx;
            ny = -ny;
            nz = -nz;
          }
          let ok = true;
          for (let m = 0; m < n; m++) {
            if (m === i || m === j || m === k) continue;
            const p = pts[m];
            if (
              nx * (p[0] - a[0]) + ny * (p[1] - a[1]) + nz * (p[2] - a[2]) >
              1.2e-4
            ) {
              ok = false;
              break;
            }
          }
          if (!ok) continue;
          faceList.push({ ijk: [i, j, k], n: [nx, ny, nz] });
          edgeSet.add(key(i, j));
          edgeSet.add(key(j, k));
          edgeSet.add(key(k, i));
        }
      }
    }
    return {
      faces: faceList,
      edges: [...edgeSet].map((s) => s.split(",").map(Number)),
    };
  };

  const rotatePoint = (p) => {
    let [x, y, z] = p;
    const cx = Math.cos(rot.x);
    const sx = Math.sin(rot.x);
    let y1 = y * cx - z * sx;
    let z1 = y * sx + z * cx;
    y = y1;
    z = z1;
    const cy = Math.cos(rot.y);
    const sy = Math.sin(rot.y);
    const x1 = x * cy + z * sy;
    z1 = -x * sy + z * cy;
    return [x1, y, z1];
  };

  const project = (p, w, h) => {
    const cam = 3.05;
    const z = p[2] + cam;
    const scale = (w * 0.42) / Math.max(0.18, z);
    return {
      x: p[0] * scale + w / 2,
      y: -p[1] * scale + h / 2,
      z,
    };
  };

  const draw = () => {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w / 2 - 0.5, 0, Math.PI * 2);
    ctx.clip();

    const rotated = verts.map((v) => rotatePoint(v));
    const projected = rotated.map((v) => project(v, w, h));

    const painted = faces.map((f) => {
      const [i, j, k] = f.ijk;
      const a = rotated[i];
      const b = rotated[j];
      const c = rotated[k];
      let nx =
        (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
      let ny =
        (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
      let nz =
        (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
      const cz = (a[2] + b[2] + c[2]) / 3;
      return { ijk: f.ijk, nz, depth: cz };
    });
    painted.sort((a, b) => a.depth - b.depth);

    for (const f of painted) {
      const [i, j, k] = f.ijk;
      const pa = projected[i];
      const pb = projected[j];
      const pc = projected[k];
      const facing = Math.max(0, f.nz);
      const shade = 0.42 + 0.58 * facing;
      const g = Math.round(78 + 72 * shade);
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.lineTo(pc.x, pc.y);
      ctx.closePath();
      ctx.fillStyle =
        "rgba(" + g + "," + g + "," + g + "," + BALL_ALPHA + ")";
      ctx.fill();
      ctx.strokeStyle = "rgba(44,44,44," + BALL_ALPHA + ")";
      ctx.lineWidth = 0.85;
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(42,42,42," + BALL_ALPHA + ")";
    ctx.lineWidth = 0.7;
    for (const [a, b] of edges) {
      const pa = projected[a];
      const pb = projected[b];
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(47,47,47," + BALL_ALPHA + ")";
    for (let i = 0; i < projected.length; i++) {
      const p = projected[i];
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.55, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  };

  const applyPan = () => {
    if (!isBrowser || !document.body) return;
    document.body.style.willChange = "transform";
    document.body.style.transform =
      "translate3d(" + -pan.x + "px," + -pan.y + "px,0)";
  };

  const applyOffset = () => {
    if (!canvas) return;
    canvas.style.transform =
      "translate(" +
      offset.x +
      "px," +
      offset.y +
      "px) scale(" +
      ballScale +
      ")";
  };

  const resetHoldGrow = () => {
    ballScale = 1;
    holdStart = 0;
    rewind = null;
    applyOffset();
  };

  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

  const startRewind = () => {
    const remain =
      Math.max(0, HOLD_STILL_MS - HOLD_REWIND_DELAY_MS) + FADE_MS;
    rewind = {
      fromX: pan.x,
      fromY: pan.y,
      fromOx: offset.x,
      fromOy: offset.y,
      start: performance.now(),
      totalMs: Math.max(FADE_MS, remain),
    };
  };

  /** Ease pan/offset home; roll ball with each pan step. */
  const stepRewind = (now) => {
    if (!rewind) return;
    const t = Math.min(1, (now - rewind.start) / rewind.totalMs);
    const e = easeOutCubic(t);
    const nx = rewind.fromX * (1 - e);
    const ny = rewind.fromY * (1 - e);
    const dpx = nx - pan.x;
    const dpy = ny - pan.y;
    pan.x = nx;
    pan.y = ny;
    if (dpx || dpy) {
      applyPan();
      rollBy(dpx / SENS, dpy / SENS);
    }
    offset.x = rewind.fromOx * (1 - e);
    offset.y = rewind.fromOy * (1 - e);
    applyOffset();
    if (t >= 1) rewind = null;
  };

  const clampOffset = () => {
    const d = Math.hypot(offset.x, offset.y);
    if (d <= ARROW_MID || d < 1e-6) return false;
    const s = ARROW_MID / d;
    offset.x *= s;
    offset.y *= s;
    return true;
  };

  const rollBy = (dx, dy) => {
    rot.x += dy * ROLL_K;
    rot.y += dx * ROLL_K;
  };

  const hitSphere = (e) => {
    if (!canvas) return false;
    const r = canvas.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const rad = Math.min(r.width, r.height) / 2;
    return Math.hypot(e.clientX - cx, e.clientY - cy) <= rad;
  };

  const clearHoldTimer = () => {
    if (holdTimer) {
      clearTimeout(holdTimer);
      holdTimer = 0;
    }
  };

  const finishMinimize = () => {
    fading = false;
    minimized = true;
    prefs.minimized = true;
    dragging = false;
    holding = false;
    rewind = null;
    clearHoldTimer();
    offset.x = 0;
    offset.y = 0;
    pan.x = 0;
    pan.y = 0;
    ballScale = 1;
    applyPan();
    applyOffset();
    if (widget) {
      widget.style.display = "none";
      widget.style.opacity = "1";
    }
    if (restoreBtn) restoreBtn.style.display = "block";
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    scheduleSavePrefs();
  };

  const beginFadeMinimize = () => {
    if (fading || minimized) return;
    fading = true;
    fadeStart = performance.now();
    holding = false;
    dragging = false;
    clearHoldTimer();
    ballScale = HOLD_EXPAND_PEAK;
    if (!rewind) startRewind();
    applyOffset();
  };

  const setMinimized = (next) => {
    if (next) {
      beginFadeMinimize();
      return;
    }
    fading = false;
    minimized = false;
    prefs.minimized = false;
    dragging = false;
    holding = false;
    clearHoldTimer();
    offset.x = 0;
    offset.y = 0;
    ballScale = 1;
    applyOffset();
    if (widget) {
      widget.style.display = "block";
      widget.style.opacity = "1";
    }
    applyHudPos();
    paintArrows();
    if (restoreBtn) restoreBtn.style.display = "none";
    if (!raf) raf = requestAnimationFrame(tick);
    scheduleSavePrefs();
  };

  const onPointerDown = (e) => {
    if (!enabled || minimized || fading) return;
    if (e.button != null && e.button !== 0) return;
    const onArrow = !!e.target?.closest?.("[data-part=scrollball-arrows] polygon");
    if (!onArrow && !hitSphere(e)) return;
    holding = true;
    dragging = false;
    holdOrigin = { x: e.clientX, y: e.clientY };
    lastPtr = { x: e.clientX, y: e.clientY };
    holdStart = performance.now();
    ballScale = 1;
    applyOffset();
    clearHoldTimer();
    holdTimer = setTimeout(() => {
      holdTimer = 0;
      if (!holding || dragging || minimized || fading) return;
      beginFadeMinimize();
    }, HOLD_STILL_MS);
    try {
      (canvas || e.target).setPointerCapture?.(e.pointerId);
    } catch (_) {
      /* ignore */
    }
    canvas.style.cursor = "grabbing";
    e.preventDefault();
    e.stopPropagation();
  };

  const onPointerMove = (e) => {
    if (fading) return;
    if (!holding && !dragging) return;
    const dx = e.clientX - lastPtr.x;
    const dy = e.clientY - lastPtr.y;
    if (!dragging) {
      const fromHold = Math.hypot(
        e.clientX - holdOrigin.x,
        e.clientY - holdOrigin.y
      );
      lastPtr = { x: e.clientX, y: e.clientY };
      if (fromHold < HOLD_SLOP) return;
      dragging = true;
      clearHoldTimer();
      resetHoldGrow();
      return;
    }
    lastPtr = { x: e.clientX, y: e.clientY };
    if (dx === 0 && dy === 0) return;
    rollBy(dx, dy);
    if (placeMode) {
      const vw = Math.max(1, window.innerWidth || 1);
      const vh = Math.max(1, window.innerHeight || 1);
      const nx = clampHud(prefs.hudX + dx / vw);
      const ny = clampHud(prefs.hudY + dy / vh);
      if (nx != null) prefs.hudX = nx;
      if (ny != null) prefs.hudY = ny;
      applyHudPos();
      scheduleSavePrefs();
    } else {
      pan.x += dx * SENS;
      pan.y += dy * SENS;
      applyPan();
      offset.x += dx;
      offset.y += dy;
      clampOffset();
      applyOffset();
    }
    e.preventDefault();
  };

  const onPointerUp = (e) => {
    if (fading) return;
    if (!holding && !dragging) return;
    const wasDrag = dragging;
    const upX = e.clientX;
    const upY = e.clientY;
    holding = false;
    dragging = false;
    clearHoldTimer();
    resetHoldGrow();
    if (canvas) canvas.style.cursor = "grab";
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch (_) {
      /* ignore */
    }
    if (!wasDrag) {
      const now = performance.now();
      const dt = now - lastTapAt;
      const dist = Math.hypot(upX - lastTapPos.x, upY - lastTapPos.y);
      if (dt > 0 && dt <= DOUBLE_TAP_MS && dist <= DOUBLE_TAP_SLOP) {
        togglePlaceMode();
        lastTapAt = 0;
      } else {
        lastTapAt = now;
        lastTapPos = { x: upX, y: upY };
      }
    } else if (placeMode) {
      scheduleSavePrefs();
    }
  };

  const tick = () => {
    if (minimized) {
      raf = 0;
      return;
    }
    raf = requestAnimationFrame(tick);
    const now = performance.now();

    if (fading) {
      stepRewind(now);
      const t = Math.min(1, (now - fadeStart) / FADE_MS);
      if (widget) widget.style.opacity = String(1 - t);
      draw();
      if (t >= 1) finishMinimize();
      return;
    }

    if (holding && !dragging && holdStart) {
      const held = now - holdStart;
      const p = Math.min(1, held / HOLD_STILL_MS);
      ballScale = 1 + p * (HOLD_EXPAND_PEAK - 1);
      if (!rewind && held >= HOLD_REWIND_DELAY_MS) startRewind();
      if (rewind) stepRewind(now);
      else applyOffset();
    }

    if (!dragging && !holding) {
      const ox = offset.x;
      const oy = offset.y;
      if (Math.hypot(ox, oy) < 0.4) {
        if (ox || oy) {
          offset.x = 0;
          offset.y = 0;
          applyOffset();
        }
      } else {
        const nx = ox * 0.78;
        const ny = oy * 0.78;
        rollBy(nx - ox, ny - oy);
        offset.x = nx;
        offset.y = ny;
        applyOffset();
      }
    }
    draw();
  };

  const arrowSvg = () => {
    const c = WIDGET / 2;
    const parts = [];
    for (let i = 0; i < 8; i++) {
      const ang = (i * Math.PI) / 4;
      const dx = Math.sin(ang);
      const dy = -Math.cos(ang);
      const px = -dy;
      const py = dx;
      const len = ARROW_LEN;
      const wid = ARROW_WID;
      const mx = c + dx * ARROW_MID;
      const my = c + dy * ARROW_MID;
      const tx = mx + dx * (len / 2);
      const ty = my + dy * (len / 2);
      const bx = mx - dx * (len / 2);
      const by = my - dy * (len / 2);
      const p1x = bx + px * (wid / 2);
      const p1y = by + py * (wid / 2);
      const p2x = bx - px * (wid / 2);
      const p2y = by - py * (wid / 2);
      parts.push(
        "<polygon points=\"" +
          tx.toFixed(1) +
          "," +
          ty.toFixed(1) +
          " " +
          p1x.toFixed(1) +
          "," +
          p1y.toFixed(1) +
          " " +
          p2x.toFixed(1) +
          "," +
          p2y.toFixed(1) +
          "\" fill=\"#4e4e4e\" fill-opacity=\"" +
          ARROW_ALPHA +
          "\" stroke=\"#2a2a2a\" stroke-opacity=\"" +
          ARROW_ALPHA +
          "\" stroke-width=\"0.8\" filter=\"url(#scrollball-ashadow)\" pointer-events=\"auto\" />"
      );
    }
    return (
      '<svg data-part="scrollball-arrows" viewBox="0 0 ' +
      WIDGET +
      " " +
      WIDGET +
      '" width="' +
      WIDGET +
      '" height="' +
      WIDGET +
      '" style="position:absolute;inset:0;overflow:visible;pointer-events:none;z-index:2;">' +
      "<defs><filter id=\"scrollball-ashadow\" x=\"-50%\" y=\"-50%\" width=\"200%\" height=\"200%\">" +
      '<feDropShadow dx="0" dy="3" stdDeviation="1.1" flood-color="#000" flood-opacity="0.48"/>' +
      "</filter></defs>" +
      parts.join("") +
      "</svg>"
    );
  };

  const mountUi = () => {
    if (!isBrowser) return;
    verts = fibonacciSphere(CORNERS);
    const topo = hull(verts);
    faces = topo.faces;
    edges = topo.edges;

    styleEl = document.createElement("style");
    styleEl.id = "navi-scrollball-style";
    styleEl.textContent = `
      [data-part="scrollball-root"] {
        position: fixed;
        left: 50%;
        top: 75%;
        width: ${WIDGET}px;
        height: ${WIDGET}px;
        margin: 0;
        transform: translate(-50%, -50%);
        z-index: 50000;
        pointer-events: none;
        user-select: none;
        -webkit-user-select: none;
        opacity: 1;
      }
      [data-part="scrollball-view"] {
        position: absolute;
        left: 50%;
        top: 50%;
        width: ${CANVAS}px;
        height: ${CANVAS}px;
        margin: ${-CANVAS / 2}px 0 0 ${-CANVAS / 2}px;
        border-radius: 50%;
        pointer-events: auto;
        cursor: grab;
        touch-action: none;
        display: block;
        background: transparent;
        filter: drop-shadow(0 22px 10px rgba(0, 0, 0, 0.8));
        z-index: 1;
      }
      [data-part="scrollball-restore"] {
        position: fixed;
        top: 10px;
        right: 10px;
        background: #c0c0c0;
        color: #000000;
        padding: 4px 8px;
        font-size: 10px;
        cursor: pointer;
        border: 2px outset #c0c0c0;
        font-family: 'MS Sans Serif', sans-serif;
        user-select: none;
        z-index: 50001;
        display: none;
        pointer-events: auto;
      }
    `;
    document.head.appendChild(styleEl);
    created.push(styleEl);

    widget = document.createElement("div");
    widget.setAttribute("data-part", "scrollball-root");
    widget.innerHTML =
      arrowSvg() +
      '<canvas data-part="scrollball-view" width="' +
      CANVAS +
      '" height="' +
      CANVAS +
      '"></canvas>';
    document.documentElement.appendChild(widget);
    created.push(widget);
    applyHudPos();
    paintArrows();

    restoreBtn = document.createElement("div");
    restoreBtn.setAttribute("data-part", "scrollball-restore");
    restoreBtn.textContent = "scrollball";
    const onRestore = (e) => {
      e.preventDefault();
      e.stopPropagation();
      setMinimized(false);
    };
    restoreBtn.addEventListener("click", onRestore);
    eventListeners.push({
      element: restoreBtn,
      event: "click",
      handler: onRestore,
    });
    document.documentElement.appendChild(restoreBtn);
    created.push(restoreBtn);

    canvas = widget.querySelector("[data-part=scrollball-view]");
    const arrows = widget.querySelector("[data-part=scrollball-arrows]");
    trackListener(canvas, "pointerdown", onPointerDown, { capture: true });
    if (arrows) {
      trackListener(arrows, "pointerdown", onPointerDown, { capture: true });
    }
    trackListener(window, "pointermove", onPointerMove, { capture: true });
    trackListener(window, "pointerup", onPointerUp, { capture: true });
    trackListener(window, "pointercancel", onPointerUp, { capture: true });

    prevBodyTransform = document.body.style.transform;
    prevBodyWillChange = document.body.style.willChange;
    applyPan();
    applyOffset();
    draw();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
  };

  const unmountUi = () => {
    if (savePrefsTimer) {
      clearTimeout(savePrefsTimer);
      savePrefsTimer = 0;
    }
    dragging = false;
    holding = false;
    minimized = false;
    fading = false;
    ballScale = 1;
    rewind = null;
    placeMode = false;
    clearHoldTimer();
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    for (const { element, event, handler, opts } of eventListeners) {
      try {
        element.removeEventListener(event, handler, opts);
      } catch (_) {
        /* ignore */
      }
    }
    eventListeners.length = 0;
    for (const el of created) {
      try {
        el.remove();
      } catch (_) {
        /* ignore */
      }
    }
    created.length = 0;
    widget = null;
    canvas = null;
    restoreBtn = null;
    styleEl = null;
    if (isBrowser && document.body) {
      document.body.style.transform = prevBodyTransform;
      document.body.style.willChange = prevBodyWillChange;
    }
  };

  const enable = () => {
    if (!isBrowser) return "scrollball: browser required";
    if (enabled) return "scrollball: already on";
    enabled = true;
    mountUi();
    if (prefs.minimized) {
      finishMinimize();
      return "scrollball: on (minimized)";
    }
    return "scrollball: on";
  };

  const disable = () => {
    enabled = false;
    unmountUi();
    return "scrollball: off";
  };

  const resetPan = () => {
    pan.x = 0;
    pan.y = 0;
    if (enabled) applyPan();
    return "scrollball: pan reset";
  };

  const resetHud = async () => {
    prefs = { ...DEFAULT_PREFS };
    applyHudPos();
    if (minimized) setMinimized(false);
    try {
      await savePrefs();
    } catch (err) {
      console.warn("[scrollball] resetHud save failed", err);
    }
    return "scrollball: hud reset to default";
  };

  return {
    name: NAME,
    version: VERSION,
    description: DESCRIPTION,
    moduleInfo: {
      name: NAME,
      version: VERSION,
      description: DESCRIPTION,
    },
    commands: {
      scrollball: {
        name: "scrollball",
        description: "scrollball on | off | reset | prefs | place",
        execute: async (action, key) => {
          const a = String(action || "").toLowerCase();
          if (!a || a === "help") {
            return [
              "scrollball on | off | reset | place",
              "scrollball prefs",
              "scrollball prefs reset",
            ].join("\n");
          }
          if (a === "on" || a === "enable") return enable();
          if (a === "off" || a === "disable") return disable();
          if (a === "reset") return resetPan();
          if (a === "place") {
            togglePlaceMode();
            return placeMode ? "scrollball: place-mode on (blue)" : "scrollball: place-mode off (grey)";
          }
          if (a === "prefs" || a === "pref") {
            const k = String(key || "").toLowerCase();
            if (k === "reset") return resetHud();
            return (
              "hudX=" +
              prefs.hudX +
              " hudY=" +
              prefs.hudY +
              " minimized=" +
              (prefs.minimized ? "1" : "0") +
              " place=" +
              (placeMode ? "blue" : "grey")
            );
          }
          return "unknown: " + action;
        },
      },
    },
    onMount: async () => {
      await loadPrefs();
      const msg = enable();
      navi.callout(
        "[scrollball] " +
          String(msg || "mounted") +
          " · hud " +
          prefs.hudX +
          "," +
          prefs.hudY
      );
    },
    onUnmount: () => {
      disable();
      navi.callout("[scrollball] unmounted");
    },
  };
};
