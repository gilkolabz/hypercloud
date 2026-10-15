/**
 * flip2welcome — mobile/PWA only: flip phone upside-down → surf hypertext/welcome
 * plus fleeting upside-down "welcome back" overlays.
 */

export const register = (navi) => {
  const NAME = "flip2welcome";
  const VERSION = "1.0.0";
  const DESCRIPTION =
    "Mobile/PWA: upside-down flip surfs hypertext/welcome + welcome-back overlays.";

  const isBrowser =
    typeof window !== "undefined" && typeof window.document !== "undefined";

  const isMobileOrPwa = () => {
    if (!isBrowser) return false;
    const ua = String(navigator.userAgent || "");
    const mobileUa = /Android|iPhone|iPad|iPod|Mobile|webOS|BlackBerry|IEMobile|Opera Mini/i.test(
      ua
    );
    const standalone =
      (typeof window.matchMedia === "function" &&
        window.matchMedia("(display-mode: standalone)").matches) ||
      navigator.standalone === true;
    return mobileUa || standalone;
  };

  if (!isMobileOrPwa()) {
    throw new Error(
      "flip2welcome: mount failed — mobile device or installed PWA required"
    );
  }

  const eventListeners = [];
  const createdElements = [];
  const timers = [];
  let motionHandler = null;
  let listening = false;
  let permissionGranted = false;
  let wasUpsideDown = false;
  let armed = false; // need a sample that is NOT upside-down first
  let cooldownUntil = 0;
  let surfBusy = false;
  let gestureBound = false;

  const trackListener = (element, event, handler, opts) => {
    element.addEventListener(event, handler, opts);
    eventListeners.push({ element, event, handler, opts });
  };

  const trackTimer = (id) => {
    timers.push(id);
    return id;
  };

  const randomColor = () => {
    const h = Math.floor(Math.random() * 360);
    const s = 55 + Math.floor(Math.random() * 35);
    const l = 40 + Math.floor(Math.random() * 25);
    return `hsl(${h} ${s}% ${l}%)`;
  };

  const spawnWelcomeBack = () => {
    if (!isBrowser || !document.body) return;
    const w = Math.max(120, window.innerWidth || 320);
    const h = Math.max(120, window.innerHeight || 480);
    for (let i = 0; i < 5; i++) {
      const el = document.createElement("div");
      el.setAttribute("data-part", "flip2welcome-overlay");
      el.textContent = "welcome back";
      const left = Math.floor(Math.random() * Math.max(1, w - 140));
      const top = Math.floor(Math.random() * Math.max(1, h - 40));
      el.style.cssText = [
        "position:fixed",
        "left:" + left + "px",
        "top:" + top + "px",
        "z-index:2147483646",
        "pointer-events:none",
        "font:600 1.1rem/1.2 system-ui,sans-serif",
        "color:" + randomColor(),
        "transform:rotate(180deg)",
        "transform-origin:center center",
        "opacity:1",
        "transition:opacity 3s linear",
        "user-select:none",
        "-webkit-user-select:none",
      ].join(";");
      document.body.appendChild(el);
      createdElements.push(el);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          el.style.opacity = "0";
        });
      });
      trackTimer(
        setTimeout(() => {
          try {
            el.remove();
          } catch (_) {
            /* ignore */
          }
          const idx = createdElements.indexOf(el);
          if (idx >= 0) createdElements.splice(idx, 1);
        }, 3100)
      );
    }
  };

  const surfWelcome = async () => {
    if (surfBusy) return;
    surfBusy = true;
    try {
      spawnWelcomeBack();
      if (typeof navi === "function") {
        await navi("surf hypertext/welcome");
      } else if (navi?.mod?.surf?.commands?.surf?.execute) {
        await navi.mod.surf.commands.surf.execute("hypertext/welcome");
      } else {
        navi.callout("[flip2welcome] surf unavailable");
      }
    } catch (err) {
      console.error("[flip2welcome] surf failed", err);
      navi.callout(
        "[flip2welcome] surf failed: " + (err?.message || String(err))
      );
    } finally {
      surfBusy = false;
    }
  };

  const isUpsideDownFromMotion = (ev) => {
    const g = ev?.accelerationIncludingGravity;
    if (!g || g.y == null || Number.isNaN(Number(g.y))) return null;
    // Portrait upright ≈ y negative; upside-down ≈ y positive (common mobile convention).
    const y = Number(g.y);
    if (y > 6.5) return true;
    if (y < -6.5) return false;
    return null; // ambiguous / tilted — ignore for edge detect
  };

  const onMotion = (ev) => {
    const state = isUpsideDownFromMotion(ev);
    if (state == null) return;

    if (!armed) {
      if (state === false) {
        armed = true;
        wasUpsideDown = false;
      }
      return;
    }

    if (state === true && wasUpsideDown === false) {
      const now = Date.now();
      if (now >= cooldownUntil) {
        cooldownUntil = now + 2500;
        void surfWelcome();
      }
    }
    wasUpsideDown = state;
  };

  const requestMotionPermission = async () => {
    const DME = window.DeviceMotionEvent;
    if (DME && typeof DME.requestPermission === "function") {
      const r = await DME.requestPermission();
      return r === "granted";
    }
    // Most Android browsers: no prompt API; listening is enough.
    return true;
  };

  const startListening = () => {
    if (listening || !isBrowser) return;
    motionHandler = onMotion;
    trackListener(window, "devicemotion", motionHandler, { passive: true });
    listening = true;
    navi.callout("[flip2welcome] motion listening — flip upside down for welcome");
  };

  const tryEnable = async () => {
    if (!isBrowser) return false;
    try {
      const ok = await requestMotionPermission();
      permissionGranted = !!ok;
      if (!ok) {
        navi.callout("[flip2welcome] motion permission denied");
        return false;
      }
      startListening();
      return true;
    } catch (err) {
      navi.callout(
        "[flip2welcome] permission error: " + (err?.message || String(err))
      );
      return false;
    }
  };

  const bindGestureFallback = () => {
    if (gestureBound || !isBrowser) return;
    gestureBound = true;
    const onGesture = () => {
      if (listening) return;
      void tryEnable();
    };
    trackListener(document, "pointerdown", onGesture, true);
    trackListener(document, "touchend", onGesture, true);
    trackListener(document, "click", onGesture, true);
    navi.callout(
      "[flip2welcome] tap the screen once to allow motion (needed on iOS)"
    );
  };

  const runHelp = async (...args) => {
    const cmd = args[0] == null ? "help" : String(args[0]);
    if (cmd === "help") {
      return [
        "flip2welcome — mobile/PWA upside-down → surf hypertext/welcome",
        "  flip2welcome status",
        "  flip2welcome enable",
      ].join("\n");
    }
    if (cmd === "status") {
      return (
        "listening=" +
        listening +
        " permission=" +
        permissionGranted +
        " armed=" +
        armed +
        " upsideDown=" +
        wasUpsideDown
      );
    }
    if (cmd === "enable") {
      const ok = await tryEnable();
      if (!ok) bindGestureFallback();
      return ok ? "enabled" : "waiting for permission (tap screen on iOS)";
    }
    return "unknown: " + cmd;
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
      flip2welcome: {
        name: "flip2welcome",
        description: "flip2welcome help | status | enable",
        execute: runHelp,
      },
    },
    onMount: async () => {
      const ok = await tryEnable();
      if (!ok) bindGestureFallback();
    },
    onUnmount: () => {
      for (const { element, event, handler, opts } of eventListeners) {
        try {
          element.removeEventListener(event, handler, opts);
        } catch (_) {
          /* ignore */
        }
      }
      eventListeners.length = 0;
      for (const el of createdElements) {
        try {
          el.remove();
        } catch (_) {
          /* ignore */
        }
      }
      createdElements.length = 0;
      for (const t of timers) clearTimeout(t);
      timers.length = 0;
      listening = false;
      motionHandler = null;
      gestureBound = false;
    },
  };
};
