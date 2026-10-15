/**
 * link_dive — on hyperlink press, camera-zoom the viewport toward the link,
 * then snap back after the dive completes. Does not intercept the click.
 *
 * Prefs tip: navi:link_dive:prefs  { durationMs, peakScale }
 */
export const register = (navi) => {
  const NAME = "link_dive";
  const VERSION = "0.1.2";
  const DESCRIPTION =
    "Viewport camera-dive toward clicked hyperlinks; snap-reset after full dive; click still fires.";

  const isBrowser =
    typeof window !== "undefined" && typeof window.document !== "undefined";

  const PREFS_IB = "navi:link_dive:prefs";
  const DEFAULT_PREFS = {
    durationMs: 120,
    peakScale: 3.44,
  };

  let prefs = { ...DEFAULT_PREFS };

  const eventListeners = [];
  let resetTimer = 0;
  let enabled = false;
  let diving = false;
  let prevHtmlTransform = "";
  let prevHtmlOrigin = "";
  let prevHtmlTransition = "";
  let prevHtmlWillChange = "";

  const trackListener = (element, event, handler, opts) => {
    element.addEventListener(event, handler, opts);
    eventListeners.push({ element, event, handler, opts });
  };

  const htmlEl = () => (isBrowser ? document.documentElement : null);

  const prefsTipIb = () => {
    try {
      const presume = navi.storage?.tip?.presume;
      if (typeof presume === "function") return String(presume(PREFS_IB));
    } catch {
      /* fall through */
    }
    return PREFS_IB;
  };

  const clampDuration = (n) => {
    const x = Number(n);
    if (!Number.isFinite(x)) return null;
    return Math.min(5000, Math.max(16, Math.round(x)));
  };

  const clampScale = (n) => {
    const x = Number(n);
    if (!Number.isFinite(x)) return null;
    return Math.min(12, Math.max(1.05, Math.round(x * 1000) / 1000));
  };

  const mergePrefs = (raw) => {
    const next = { ...DEFAULT_PREFS };
    if (!raw || typeof raw !== "object") return next;
    const d = clampDuration(raw.durationMs);
    const s = clampScale(raw.peakScale);
    if (d != null) next.durationMs = d;
    if (s != null) next.peakScale = s;
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
      const data = frame?.data;
      prefs = mergePrefs(data && typeof data === "object" ? data : null);
    } catch (err) {
      console.warn("[link_dive] loadPrefs failed", err);
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
        durationMs: prefs.durationMs,
        peakScale: prefs.peakScale,
      },
      { replaceData: true, create: true }
    );
    return prefs;
  };

  const prefsStatus = () =>
    `durationMs=${prefs.durationMs} peakScale=${prefs.peakScale}` +
    ` (defaults ${DEFAULT_PREFS.durationMs}/${DEFAULT_PREFS.peakScale})`;

  const snapReset = () => {
    if (resetTimer) {
      clearTimeout(resetTimer);
      resetTimer = 0;
    }
    const html = htmlEl();
    if (!html) {
      diving = false;
      return;
    }
    html.style.transition = "none";
    html.style.transform = prevHtmlTransform;
    html.style.transformOrigin = prevHtmlOrigin;
    html.style.willChange = prevHtmlWillChange;
    html.removeAttribute("data-link-dive");
    void html.offsetWidth;
    html.style.transition = prevHtmlTransition;
    diving = false;
  };

  const diveToward = (x, y) => {
    const html = htmlEl();
    if (!html) return;
    if (diving) snapReset();

    const durationMs = prefs.durationMs;
    const peakScale = prefs.peakScale;

    prevHtmlTransform = html.style.transform;
    prevHtmlOrigin = html.style.transformOrigin;
    prevHtmlTransition = html.style.transition;
    prevHtmlWillChange = html.style.willChange;

    diving = true;
    html.setAttribute("data-link-dive", "1");
    html.style.willChange = "transform";
    html.style.transition = "none";
    html.style.transformOrigin = `${x}px ${y}px`;
    html.style.transform = "scale(1)";
    void html.offsetWidth;
    html.style.transition = `transform ${durationMs}ms cubic-bezier(0.2, 0, 0.65, 1)`;
    html.style.transform = `scale(${peakScale})`;

    resetTimer = setTimeout(snapReset, durationMs);
  };

  const onClick = (e) => {
    if (!enabled || !isBrowser) return;
    if (e.button != null && e.button !== 0) return;
    const a = e.target?.closest?.("a");
    if (!a || !document.documentElement.contains(a)) return;
    const rect = a.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    diveToward(x, y);
  };

  const enable = () => {
    if (!isBrowser) return "link_dive: browser required";
    if (enabled) return "link_dive: already on";
    enabled = true;
    trackListener(document, "click", onClick, true);
    return "link_dive: on";
  };

  const disable = () => {
    snapReset();
    enabled = false;
    for (const { element, event, handler, opts } of eventListeners) {
      try {
        element.removeEventListener(event, handler, opts);
      } catch (_) {
        /* ignore */
      }
    }
    eventListeners.length = 0;
    return "link_dive: off";
  };

  const help = () =>
    [
      "link_dive on | off",
      "link_dive prefs",
      "link_dive prefs scale <n>",
      "link_dive prefs duration <ms>",
      "link_dive prefs reset",
      "",
      prefsStatus(),
    ].join("\n");

  const runPrefs = async (...args) => {
    const key = String(args[0] || "").toLowerCase();
    if (!key) return prefsStatus();

    if (key === "reset" || key === "defaults") {
      prefs = { ...DEFAULT_PREFS };
      await savePrefs();
      return "prefs reset → " + prefsStatus();
    }

    if (key === "scale" || key === "peak" || key === "peakscale") {
      const s = clampScale(args[1]);
      if (s == null) return "usage: link_dive prefs scale <n>  (e.g. 3.44)";
      prefs.peakScale = s;
      await savePrefs();
      return prefsStatus();
    }

    if (key === "duration" || key === "ms" || key === "durationms") {
      const d = clampDuration(args[1]);
      if (d == null) return "usage: link_dive prefs duration <ms>  (e.g. 120)";
      prefs.durationMs = d;
      await savePrefs();
      return prefsStatus();
    }

    return "unknown prefs key: " + key + "\n" + help();
  };

  const run = async (...args) => {
    const action = String(args[0] || "").toLowerCase();
    if (!action || action === "help") return help();
    if (action === "on" || action === "enable") return enable();
    if (action === "off" || action === "disable") return disable();
    if (action === "prefs" || action === "pref") {
      return runPrefs(...args.slice(1));
    }
    if (action === "scale" || action === "duration" || action === "reset") {
      return runPrefs(...args);
    }
    return "unknown: " + args[0] + "\n" + help();
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
      link_dive: {
        name: "link_dive",
        description: "link_dive on|off | prefs [scale|duration|reset] …",
        execute: run,
      },
    },
    onMount: async () => {
      await loadPrefs();
      const msg = enable();
      navi.callout(
        "[link_dive] " + String(msg || "mounted") + " · " + prefsStatus()
      );
    },
    onUnmount: () => {
      disable();
      navi.callout("[link_dive] unmounted");
    },
  };
};
