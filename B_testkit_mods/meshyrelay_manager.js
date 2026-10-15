/**
 * meshyrelay_manager — mesh of navi_shell relays (alias ping, profile, msgs, tip xfer).
 *
 *   mount flowerpot/hypercloud/testkit/mods/legacy/meshyrelay_manager.js
 *   meshyrelay_manager status | help | connect | advertise | ping <alias> | …
 *
 * Peer callins (via /navi-{alias}/meshyrelay_manager/<cmd>):
 *   hello | notify | msg | tipxfer | renew | state
 *
 * CLI (no HTMF) — after mount + relay connect + advertise:
 *   meshyrelay_manager ping fren
 *   meshyrelay_manager msg * hello mesh          # broadcast to all members
 *   meshyrelay_manager msg fren hi               # one peer
 *   meshyrelay_manager tip fren navi:foo         # one tip
 *   meshyrelay_manager tip * navi:meshyrelay:    # all tips under prefix → all peers
 *   meshyrelay_manager ibgroups
 */

export const register = (navi) => {
  const NAME = "meshyrelay_manager";
  const VERSION = "0.1.23";
  const WAREZ_SUBJECT =
    "flowerpot/hypercloud/testkit/mods/legacy/meshyrelay_manager.js";
  const WAREZ_MANIFEST =
    "flowerpot/hypercloud/testkit/mods/meshyrelay_manager";
  const STATE_IB = "navi:meshyrelay:state";
  const LOG_IB = "navi:meshyrelay:log";
  const PREFS_IB = "navi:meshyrelay_manager:prefs";
  const PARK_IB = "navi:meshyrelay";
  const LOG_MAX = 400;
  const FEED_MAX = 80;

  const DEFAULT_PREFS = {
    ibAutofill: true,
    allowRenew: true,
    /** ISO stamp — feed rows after this are "new" when HTMF reopens. */
    lastFeedSeenAt: "",
    /** When someone notifies/joins, admit them automatically. */
    autoAdmit: true,
    /**
     * Incoming (and outbound ping) mesh placement:
     *   default — join/use default mesh (first mesh, or peer's mesh id)
     *   new     — spawn a fresh mesh for that relationship
     */
    admitMode: "default",
    /** After a successful connect, remount/reload should reconnect. */
    wantConnected: false,
    /** After advertise, remount should re-advertise once connected. */
    wantAdvertised: false,
  };

  const DEFAULT_PROFILE = {
    alias: "",
    emoji: "🛰️",
    color: "#1a6b8a",
    fontWeight: "600",
    fontStyle: "normal",
    textDecoration: "none",
    letterSpacing: "0.02em",
    kind: "client",
    device: "desktop",
    meshId: "",
    allowRenew: true,
  };

  /** @type {{ profile: any, members: Record<string, any>, meshes: Record<string, any>, activeMeshId: string, defaultMeshId: string, feed: any[], prefs: any } | null} */
  let cache = null;
  /** Live HTMF / UI listeners — manager keeps working with zero listeners. */
  /** @type {Set<() => void>} */
  const listeners = new Set();
  /** True while at least one HTMF has called openUi and not closeUi. */
  let uiOpenCount = 0;
  /** Last syncRelayMeta result — light snapshots reuse this (no relay status). */
  let lastMeta = {
    connected: false,
    hasPark: false,
    expiresAt: "",
    alias: "",
    relayHost: "",
  };
  /** Skip duplicate disconnect toasts from navi callouts after our disconnect(). */
  let hushDisconnectToastUntil = 0;

  const uiIsLive = () => uiOpenCount > 0;

  const tipApi = () => navi?.storage?.tip || null;
  const binApi = () => navi?.storage?.bin || null;

  /**
   * Viewport toast — fixed top-of-screen from the mod (no HTMF needed).
   * @param {string} text
   * @param {"ok"|"warn"|"err"|"info"} [tone]
   */
  const viewportToast = (text, tone = "ok") => {
    if (typeof document === "undefined") return;
    const msg = String(text || "").trim();
    if (!msg) return;
    const parent = document.body || document.documentElement;
    if (!parent) return;

    let host = document.getElementById("meshyrelay-viewport-toasts");
    if (!host) {
      host = document.createElement("div");
      host.id = "meshyrelay-viewport-toasts";
      host.setAttribute("aria-live", "polite");
      host.style.cssText = [
        "position:fixed",
        "top:0",
        "left:0",
        "right:0",
        "z-index:2147483646",
        "display:flex",
        "flex-direction:column",
        "align-items:center",
        "gap:0.4rem",
        "padding:0.75rem 0.85rem 0",
        "pointer-events:none",
        "box-sizing:border-box",
      ].join(";");
      parent.appendChild(host);
    }

    const tones = {
      ok: {
        bg: "linear-gradient(180deg,#e8f7ff 0%,#7ec8e8 42%,#3a9bc7 100%)",
        border: "rgba(255,255,255,0.85)",
        color: "#0a3a55",
      },
      info: {
        bg: "linear-gradient(180deg,#f0f9ff 0%,#a8d4ef 45%,#5a9fc8 100%)",
        border: "rgba(255,255,255,0.8)",
        color: "#1a4a66",
      },
      warn: {
        bg: "linear-gradient(180deg,#fff8e8 0%,#f0c878 45%,#d4a040 100%)",
        border: "rgba(255,255,255,0.85)",
        color: "#5a3a08",
      },
      err: {
        bg: "linear-gradient(180deg,#ffe8e8 0%,#e88888 45%,#c05050 100%)",
        border: "rgba(255,255,255,0.85)",
        color: "#5a1010",
      },
    };
    const t = tones[tone] || tones.ok;

    const el = document.createElement("div");
    el.textContent = msg;
    el.style.cssText = [
      "pointer-events:none",
      "max-width:min(32rem,92vw)",
      "padding:0.55rem 1.15rem",
      "border-radius:999px",
      `background:${t.bg}`,
      `border:1px solid ${t.border}`,
      `color:${t.color}`,
      "font:600 0.95rem/1.25 system-ui,Segoe UI,sans-serif",
      "letter-spacing:0.02em",
      "text-shadow:0 1px 0 rgba(255,255,255,0.65)",
      "box-shadow:0 4px 18px rgba(40,120,180,0.35),inset 0 1px 0 rgba(255,255,255,0.75),inset 0 -1px 0 rgba(0,60,100,0.15)",
      "opacity:0",
      "transform:translateY(-10px)",
      "transition:opacity 0.45s ease,transform 0.45s ease",
    ].join(";");
    host.appendChild(el);
    requestAnimationFrame(() => {
      el.style.opacity = "1";
      el.style.transform = "translateY(0)";
    });
    const holdMs = tone === "err" ? 4200 : 3000;
    setTimeout(() => {
      el.style.opacity = "0";
      el.style.transform = "translateY(-8px)";
      setTimeout(() => {
        try {
          el.remove();
        } catch {
          /* ignore */
        }
        if (host && !host.childElementCount) {
          try {
            host.remove();
          } catch {
            /* ignore */
          }
        }
      }, 500);
    }, holdMs);
  };

  const setWantFlags = async (patch) => {
    const st = await loadState();
    if (patch.wantConnected != null) st.prefs.wantConnected = !!patch.wantConnected;
    if (patch.wantAdvertised != null) {
      st.prefs.wantAdvertised = !!patch.wantAdvertised;
    }
    await savePrefs();
    return st.prefs;
  };

  const stamp = () => {
    try {
      if (navi?.stamp?.time) return navi.stamp.time();
    } catch {
      /* fall through */
    }
    return new Date().toISOString();
  };

  const uuid = () => {
    try {
      if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
    } catch {
      /* fall through */
    }
    return `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  };

  const sanitizeAlias = (raw) => {
    const alias = String(raw || "")
      .trim()
      .replace(/^navi-/i, "");
    if (!alias) return "";
    if (/[\s/:]/.test(alias)) {
      throw new Error("alias must not contain spaces, /, or :");
    }
    return alias;
  };

  const inferDevice = () => {
    try {
      const ua = String(globalThis.navigator?.userAgent || "").toLowerCase();
      if (/mobile|android|iphone|ipad|ipod|webos|blackberry|iemobile/.test(ua)) {
        return "mobile";
      }
    } catch {
      /* ignore */
    }
    return "desktop";
  };

  const inferKind = () => {
    // Browser shells are clients; native/host shells often lack window chrome.
    try {
      if (typeof globalThis.window === "undefined") return "server";
      if (!globalThis.document) return "server";
    } catch {
      return "server";
    }
    return "client";
  };

  const callinBody = () => {
    try {
      const req = navi?.callinRequest;
      if (req && req.body != null) return String(req.body);
    } catch {
      /* ignore */
    }
    return "";
  };

  const parseJson = (raw) => {
    const s = String(raw || "").trim();
    if (!s) return null;
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };

  const emptyState = () => ({
    profile: {
      ...DEFAULT_PROFILE,
      device: inferDevice(),
      kind: inferKind(),
    },
    members: {},
    meshes: {},
    activeMeshId: "",
    defaultMeshId: "",
    feed: [],
    prefs: { ...DEFAULT_PREFS },
  });

  const syncActiveMembers = (st) => {
    const id = String(st.activeMeshId || st.defaultMeshId || "").trim();
    if (id && st.meshes && st.meshes[id]) {
      st.members = st.meshes[id].members || {};
      st.profile.meshId = id;
    } else if (!st.members) {
      st.members = {};
    }
  };

  const ensureMesh = (st, meshId, opts = {}) => {
    if (!st.meshes || typeof st.meshes !== "object") st.meshes = {};
    const id = String(meshId || "").trim() || uuid();
    if (!st.meshes[id]) {
      st.meshes[id] = {
        id,
        label: opts.label ? String(opts.label) : "",
        createdAt: stamp(),
        members: {},
      };
    } else if (opts.label && !st.meshes[id].label) {
      st.meshes[id].label = String(opts.label);
    }
    return st.meshes[id];
  };

  const ensureDefaultMesh = (st) => {
    if (st.defaultMeshId && st.meshes[st.defaultMeshId]) {
      return st.defaultMeshId;
    }
    if (st.activeMeshId && st.meshes[st.activeMeshId]) {
      st.defaultMeshId = st.activeMeshId;
      return st.defaultMeshId;
    }
    const id = String(st.profile.meshId || "").trim() || uuid();
    ensureMesh(st, id, { label: "default" });
    st.defaultMeshId = id;
    if (!st.activeMeshId) st.activeMeshId = id;
    st.profile.meshId = st.activeMeshId || id;
    return id;
  };

  const migrateMeshes = (st) => {
    if (!st.meshes || typeof st.meshes !== "object") st.meshes = {};
    st.activeMeshId = String(st.activeMeshId || "").trim();
    st.defaultMeshId = String(st.defaultMeshId || "").trim();
    const flat = st.members && typeof st.members === "object" ? st.members : {};
    if (!Object.keys(st.meshes).length && Object.keys(flat).length) {
      const id = String(st.profile.meshId || "").trim() || uuid();
      st.meshes[id] = {
        id,
        label: "default",
        createdAt: stamp(),
        members: { ...flat },
      };
      st.activeMeshId = id;
      st.defaultMeshId = id;
      st.profile.meshId = id;
    } else if (
      st.profile.meshId &&
      !st.meshes[st.profile.meshId] &&
      Object.keys(flat).length
    ) {
      const id = String(st.profile.meshId);
      st.meshes[id] = {
        id,
        label: "default",
        createdAt: stamp(),
        members: { ...flat },
      };
      if (!st.activeMeshId) st.activeMeshId = id;
      if (!st.defaultMeshId) st.defaultMeshId = id;
    }
    if (st.activeMeshId && !st.meshes[st.activeMeshId]) st.activeMeshId = "";
    if (st.defaultMeshId && !st.meshes[st.defaultMeshId]) st.defaultMeshId = "";
    if (!st.defaultMeshId && st.activeMeshId) st.defaultMeshId = st.activeMeshId;
    if (!st.activeMeshId && st.defaultMeshId) st.activeMeshId = st.defaultMeshId;
    if (st.prefs.autoAdmit == null) st.prefs.autoAdmit = true;
    if (st.prefs.admitMode !== "new") st.prefs.admitMode = "default";
    syncActiveMembers(st);
  };

  const loadState = async () => {
    if (cache) return cache;
    const tip = tipApi();
    const next = emptyState();
    if (tip?.get) {
      try {
        const st = await tip.get(STATE_IB);
        const d = st?.data;
        if (d && typeof d === "object") {
          if (d.profile && typeof d.profile === "object") {
            next.profile = { ...next.profile, ...d.profile };
          }
          if (d.members && typeof d.members === "object") {
            next.members = { ...d.members };
          }
          if (d.meshes && typeof d.meshes === "object") {
            next.meshes = { ...d.meshes };
          }
          if (d.activeMeshId) next.activeMeshId = String(d.activeMeshId);
          if (d.defaultMeshId) next.defaultMeshId = String(d.defaultMeshId);
          if (Array.isArray(d.feed)) next.feed = d.feed.slice(-FEED_MAX);
        }
      } catch {
        /* ignore */
      }
      try {
        const pr = await tip.get(PREFS_IB);
        if (pr?.data && typeof pr.data === "object") {
          next.prefs = { ...DEFAULT_PREFS, ...pr.data };
          if (pr.data.allowRenew != null) {
            next.profile.allowRenew = !!pr.data.allowRenew;
          }
        }
      } catch {
        /* ignore */
      }
    }
    if (!next.profile.device) next.profile.device = inferDevice();
    if (!next.profile.kind) next.profile.kind = inferKind();
    migrateMeshes(next);
    cache = next;
    return cache;
  };

  const saveState = async (opts) => {
    const st = await loadState();
    syncActiveMembers(st);
    const tip = tipApi();
    if (!tip?.mut8) {
      if (!opts?.silent) notify();
      return st;
    }
    const patch = {
      parts: ["meshyrelay_state", "ibgib_frame", "manifest", "json"],
      profile: st.profile,
      members: st.members,
      meshes: st.meshes,
      activeMeshId: st.activeMeshId,
      defaultMeshId: st.defaultMeshId,
      feed: st.feed.slice(-FEED_MAX),
      updated_at: stamp(),
    };
    await tip.mut8(STATE_IB, patch, { replaceData: true, create: true });
    if (!opts?.silent) notify();
    return st;
  };

  const savePrefs = async () => {
    const st = await loadState();
    const tip = tipApi();
    if (!tip?.mut8) return st.prefs;
    await tip.mut8(
      PREFS_IB,
      {
        parts: ["meshyrelay_prefs", "ibgib_frame", "manifest", "json"],
        ...st.prefs,
        allowRenew: !!st.profile.allowRenew,
        updated_at: stamp(),
      },
      { replaceData: true, create: true }
    );
    return st.prefs;
  };

  /** Optional hint lets HTMF paint feed/members without waiting on tip.mut8. */
  const notify = (hint) => {
    for (const fn of listeners) {
      try {
        fn(hint);
      } catch {
        /* ignore */
      }
    }
  };

  const onChange = (fn) => {
    if (typeof fn !== "function") return () => {};
    listeners.add(fn);
    return () => listeners.delete(fn);
  };

  const appendLog = async (kind, detail = {}) => {
    const tip = tipApi();
    if (!tip?.mut8) return;
    const event = {
      at: stamp(),
      kind: String(kind || "event"),
      ...detail,
    };
    try {
      await tip.mut8(LOG_IB, { event }, { replaceData: true, create: true });
    } catch (err) {
      console.warn("[meshyrelay] log failed", err);
    }
  };

  const membersForUi = (st) => {
    if (!uiIsLive()) return st.members;
    const out = {};
    for (const [k, m] of Object.entries(st.members || {})) {
      out[k] = { ...m, unread: 0 };
    }
    return out;
  };

  const meshSummary = (st) =>
    Object.values(st.meshes || {}).map((m) => ({
      id: m.id,
      label: m.label || String(m.id || "").slice(0, 8),
      memberCount: Object.keys(m.members || {}).length,
    }));

  const uiHint = (st) => ({
    feed: (st.feed || []).slice(-FEED_MAX),
    members: membersForUi(st),
    unseenIds: [],
    unseenCount: 0,
    memberUnread: 0,
    profile: st.profile,
    prefs: st.prefs,
    meshes: meshSummary(st),
    activeMeshId: st.activeMeshId || "",
    defaultMeshId: st.defaultMeshId || "",
    connected: !!lastMeta.connected,
    hasPark: !!lastMeta.hasPark,
    uiOpen: uiIsLive(),
  });

  const pushFeed = async (entry) => {
    const st = await loadState();
    const row = {
      id: uuid(),
      at: stamp(),
      ...entry,
    };
    st.feed.push(row);
    if (st.feed.length > FEED_MAX) st.feed = st.feed.slice(-FEED_MAX);
    // Paint before durable tip write — IndexedDB mut8 is the lag.
    notify(uiHint(st));
    void saveState({ silent: true });
    return row;
  };

  /** Delta log + human feed line (works with or without HTMF open). */
  const note = async (kind, text, detail = {}) => {
    await pushFeed({
      type: kind,
      alias: detail.alias || "",
      text: text == null ? "" : String(text),
    });
    void appendLog(kind, detail);
  };

  const unseenFeed = (st) => {
    // Actively watching the feed — nothing is "waiting".
    if (uiIsLive()) return [];
    const since = String(st.prefs?.lastFeedSeenAt || "").trim();
    const sinceT = since ? Date.parse(since) : 0;
    return (st.feed || []).filter((f) => {
      const t = Date.parse(String(f.at || ""));
      if (!Number.isFinite(t)) return !since;
      return !sinceT || t > sinceT;
    });
  };

  const totalUnread = (st) => {
    if (uiIsLive()) return 0;
    return Object.values(st.members || {}).reduce(
      (n, m) => n + (Number(m?.unread) || 0),
      0
    );
  };

  /** Clear unread while HTMF is watching (in-memory; durable via silent save). */
  const clearLiveUnread = async () => {
    const st = await loadState();
    for (const m of Object.values(st.members || {})) {
      if (Number(m?.unread) > 0) m.unread = 0;
    }
    st.prefs.lastFeedSeenAt = stamp();
    await savePrefs();
    await saveState({ silent: true });
    return st;
  };

  /** HTMF opened — paint from cache; pass { meta: true } once to sync advert/link. */
  const openUi = async (opts) => {
    uiOpenCount += 1;
    await ensurePinPark();
    const st = await clearLiveUnread();
    notify(uiHint(st));
    return snapshot(opts && opts.meta ? { meta: true } : {});
  };

  /** HTMF navigated away — stamp feed seen; further events accumulate again. */
  const closeUi = async () => {
    uiOpenCount = Math.max(0, uiOpenCount - 1);
    if (uiOpenCount === 0) {
      try {
        await markFeedSeen();
      } catch {
        /* ignore */
      }
    }
    return { ok: true, uiOpen: uiOpenCount > 0 };
  };

  /** Call after HTMF paints the feed so later arrivals are "new". */
  const markFeedSeen = async () => {
    const st = await loadState();
    st.prefs.lastFeedSeenAt = stamp();
    await savePrefs();
    await saveState({ silent: true });
    notify(uiHint(st));
    return st.prefs.lastFeedSeenAt;
  };

  const readRelayPrefs = async () => {
    try {
      const item = navi?.storage?.item;
      if (!item?.get) return null;
      const raw = await item.get("relay");
      return raw && typeof raw === "object" ? raw : null;
    } catch {
      return null;
    }
  };

  /** Expiry from saved advertise frame data (JSON), not callout text. */
  const expiresFromRelayPrefs = async (alias) => {
    const prefs = await readRelayPrefs();
    const a = sanitizeAlias(alias);
    const row = prefs?.frames?.[a];
    const raw = row?.frame?.data?.relay_expires_at;
    if (raw == null || raw === "") return null;
    const t = Date.parse(String(raw));
    if (!Number.isFinite(t)) return String(raw);
    return new Date(t).toISOString();
  };

  /** Cache relay connected checks — snapshot used to call status on every UI tick. */
  let connectedCache = { at: 0, value: false };
  const CONNECTED_TTL_MS = 4000;

  const isRelayConnected = async (opts) => {
    const force = !!(opts && opts.force);
    const now = Date.now();
    if (!force && now - connectedCache.at < CONNECTED_TTL_MS) {
      return connectedCache.value;
    }
    try {
      // Call navi directly — do not depend on relayCmd init order.
      let st = "";
      if (typeof navi === "function") {
        st = String((await navi("relay status")) || "");
      } else if (navi && typeof navi.callin === "function") {
        st = String((await navi.callin("relay status")) || "");
      }
      const value = /relay\s+connected\b/i.test(st);
      connectedCache = { at: now, value };
      return value;
    } catch {
      connectedCache = { at: now, value: false };
      return false;
    }
  };

  /**
   * Pull live connection + advert expiry from relay item prefs (JSON frames).
   * Clears stale profile.expiresAt that said "expired" while park is still up.
   * Expensive: navi("relay status") callouts to console — only for explicit meta refresh.
   */
  const syncRelayMeta = async () => {
    const st = await loadState();
    const prefs = await readRelayPrefs();
    const alias = sanitizeAlias(st.profile.alias || prefs?.alias || "");
    const connected = await isRelayConnected({ force: true });
    const hasPark = !!(alias && prefs?.parks && prefs.parks[alias]);

    let expiresAt = "";
    if (alias) {
      const fromFrame = await expiresFromRelayPrefs(alias);
      if (fromFrame) expiresAt = fromFrame;
    }

    if (!expiresAt && hasPark) {
      // Park is live — drop a stale past stamp left by the old callout regex.
      const oldT = Date.parse(String(st.profile.expiresAt || ""));
      if (Number.isFinite(oldT) && oldT >= Date.now()) {
        expiresAt = new Date(oldT).toISOString();
      } else {
        expiresAt = "";
      }
    } else if (!expiresAt && !hasPark) {
      const oldT = Date.parse(String(st.profile.expiresAt || ""));
      if (Number.isFinite(oldT)) expiresAt = new Date(oldT).toISOString();
    }

    let dirty = false;
    if (String(st.profile.expiresAt || "") !== expiresAt) {
      st.profile.expiresAt = expiresAt;
      dirty = true;
    }
    if (alias && !st.profile.alias) {
      st.profile.alias = alias;
      dirty = true;
    }
    // Silent — never notify→refreshAll→syncRelayMeta loop.
    if (dirty) await saveState({ silent: true });
    lastMeta = {
      connected,
      hasPark,
      expiresAt,
      alias: st.profile.alias || alias,
      relayHost: String(prefs?.host || "").trim(),
    };
    return lastMeta;
  };

  /**
   * Default is cache-only (no relay status). Pass { meta: true } after connect/advert.
   * { light: true } kept for older HTMF callers — same as default.
   */
  const snapshot = async (opts) => {
    const wantMeta = !!(opts && opts.meta);
    const meta = wantMeta ? await syncRelayMeta() : lastMeta;
    const st = await loadState();
    syncActiveMembers(st);
    const unseen = unseenFeed(st);
    return {
      version: VERSION,
      profile: st.profile,
      members: membersForUi(st),
      feed: st.feed.slice(-FEED_MAX),
      prefs: st.prefs,
      meshes: meshSummary(st),
      activeMeshId: st.activeMeshId || "",
      defaultMeshId: st.defaultMeshId || "",
      unseenCount: unseen.length,
      unseenIds: unseen.map((f) => f.id).filter(Boolean),
      memberUnread: totalUnread(st),
      uiOpen: uiOpenCount > 0,
      connected: !!meta.connected,
      hasPark: !!meta.hasPark,
      relayHost: meta.relayHost || "",
      subject: WAREZ_SUBJECT,
      manifest: WAREZ_MANIFEST,
    };
  };

  const publicProfileForMesh = async (meshId) => {
    const st = await loadState();
    const p = st.profile;
    const mesh = (meshId && st.meshes[meshId]) || st.meshes[st.activeMeshId] || {
      members: st.members,
    };
    const members = Object.values(mesh.members || {}).map((m) => ({
      alias: m.alias,
      emoji: m.emoji,
      color: m.color,
      kind: m.kind,
      device: m.device,
      expiresAt: m.expiresAt || null,
    }));
    return {
      v: 1,
      alias: p.alias,
      emoji: p.emoji,
      color: p.color,
      fontWeight: p.fontWeight,
      fontStyle: p.fontStyle,
      textDecoration: p.textDecoration,
      letterSpacing: p.letterSpacing,
      kind: p.kind,
      device: p.device,
      meshId: meshId || st.activeMeshId || p.meshId || "",
      allowRenew: p.allowRenew !== false,
      expiresAt: p.expiresAt || null,
      members,
    };
  };

  const publicProfile = async () => {
    const st = await loadState();
    return publicProfileForMesh(st.activeMeshId || st.defaultMeshId || st.profile.meshId);
  };

  const ensureMeshId = async () => {
    const st = await loadState();
    const id = ensureDefaultMesh(st);
    syncActiveMembers(st);
    await saveState({ silent: true });
    return id;
  };

  const upsertMemberInMesh = async (meshId, alias, patch, opts = {}) => {
    const a = sanitizeAlias(alias);
    if (!a) return { member: null, wasNew: false, meshId: "" };
    const st = await loadState();
    const mesh = ensureMesh(st, meshId);
    const prev = mesh.members[a] || { alias: a, unread: 0 };
    const wasNew = !mesh.members[a];
    mesh.members[a] = {
      ...prev,
      ...patch,
      alias: a,
      meshId: mesh.id,
      lastSeen: stamp(),
    };
    syncActiveMembers(st);
    if (!opts.skipSave) {
      await saveState(opts.silent ? { silent: true } : undefined);
    }
    return { member: mesh.members[a], wasNew, meshId: mesh.id };
  };

  const upsertMember = async (alias, patch) => {
    const st = await loadState();
    const meshId = st.activeMeshId || ensureDefaultMesh(st);
    const { member } = await upsertMemberInMesh(meshId, alias, patch);
    return member;
  };

  /** Tell every other mesh sibling our profile (incl. members) so joins propagate. */
  const announceToMesh = async (meshId, exceptAliases = []) => {
    const st = await loadState();
    const mesh = st.meshes[meshId];
    if (!mesh) return [];
    const skip = new Set(
      [...exceptAliases, st.profile.alias]
        .map((x) => sanitizeAlias(x))
        .filter(Boolean)
    );
    const payload = {
      ...(await publicProfileForMesh(meshId)),
      meshId,
      announce: true,
    };
    const results = [];
    for (const raw of Object.keys(mesh.members || {})) {
      const a = sanitizeAlias(raw);
      if (!a || skip.has(a)) continue;
      try {
        // Soft-merged roster can list peers that are offline / not advertised.
        const live = await peerFetch(a, "");
        if (!live.ok) {
          results.push({
            alias: a,
            ok: false,
            status: live.status,
            skipped: "offline",
          });
          continue;
        }
        const res = await peerFetch(a, "meshyrelay/notify", {
          method: "POST",
          body: payload,
        });
        results.push({
          alias: a,
          ok: res.ok,
          status: res.status,
          text: String(res.text || "").slice(0, 120),
        });
      } catch (err) {
        results.push({ alias: a, ok: false, error: String(err?.message || err) });
      }
    }
    return results;
  };

  const setActiveMesh = async (meshId) => {
    const st = await loadState();
    const id = String(meshId || "").trim();
    if (!id || !st.meshes[id]) throw new Error("unknown mesh");
    st.activeMeshId = id;
    st.profile.meshId = id;
    syncActiveMembers(st);
    await saveState();
    notify(uiHint(st));
    await note("mesh", "switched to " + (st.meshes[id].label || id.slice(0, 8)), {
      alias: "",
      meshId: id,
    });
    return { ok: true, activeMeshId: id };
  };

  const setDefaultMesh = async (meshId) => {
    const st = await loadState();
    const id = String(meshId || "").trim();
    if (!id || !st.meshes[id]) throw new Error("unknown mesh");
    st.defaultMeshId = id;
    await saveState();
    notify(uiHint(st));
    await note("mesh", "default mesh " + (st.meshes[id].label || id.slice(0, 8)), {
      meshId: id,
    });
    return { ok: true, defaultMeshId: id };
  };

  const updatePrefs = async (patch = {}) => {
    const st = await loadState();
    const p = patch && typeof patch === "object" ? patch : {};
    if (p.autoAdmit != null) st.prefs.autoAdmit = !!p.autoAdmit;
    if (p.admitMode != null) {
      st.prefs.admitMode = String(p.admitMode) === "new" ? "new" : "default";
    }
    if (p.ibAutofill != null) st.prefs.ibAutofill = !!p.ibAutofill;
    if (p.allowRenew != null) {
      st.prefs.allowRenew = !!p.allowRenew;
      st.profile.allowRenew = !!p.allowRenew;
    }
    await savePrefs();
    await saveState();
    notify(uiHint(st));
    return st.prefs;
  };

  const listMeshes = async () => {
    const st = await loadState();
    return {
      meshes: meshSummary(st),
      activeMeshId: st.activeMeshId,
      defaultMeshId: st.defaultMeshId,
    };
  };

  const resolveUrl = (path) => {
    const p = String(path || "").replace(/^\/+/, "");
    if (typeof navi?.resolveUrl === "function") {
      return navi.resolveUrl("/" + p);
    }
    return "/" + p;
  };

  const peerFetch = async (alias, remainder, opts = {}) => {
    const raw = String(alias ?? "").trim().toLowerCase();
    // Never treat * / mesh as a park leaf — expand in sendMsg/sendTips first.
    if (!raw || raw === "*" || raw === "mesh" || raw === "all" || raw === "@mesh") {
      throw new Error("mesh target must be expanded to peer aliases (not navi-*)");
    }
    const a = sanitizeAlias(alias);
    if (!a || a === "*") throw new Error("peer alias required");
    let rem = String(remainder || "").replace(/^\/+/, "");
    // Prefer short pin park navi:meshyrelay; fall back to module park.
    // Empty rem = bare /navi-{alias}/ inherent ping — do not invent meshyrelay/.
    if (rem && !/^meshyrelay(_manager)?(\/|$)/i.test(rem)) {
      rem = "meshyrelay/" + rem;
    }
    // Always try pin first; manager path is the alt (hello already did this;
    // notify/msg used manager-only and failed when peers only had navi:meshyrelay).
    let primary = rem;
    let alt = "";
    if (/^meshyrelay_manager\//i.test(rem)) {
      primary = rem.replace(/^meshyrelay_manager\//i, "meshyrelay/");
      alt = rem;
    } else if (/^meshyrelay\//i.test(rem)) {
      alt = rem.replace(/^meshyrelay\//i, "meshyrelay_manager/");
    }
    const pathFor = (r) => (r ? `navi-${a}/${r}` : `navi-${a}/`);
    // Safari/iOS PWA often memory-caches bare GET /navi-{alias}/ (incl. stale
    // 410) above the SW; navigations bypass that. Force network + bust key.
    const bust = `_mr=${Date.now()}`;
    const withBust = (u) => {
      const s = String(u || "");
      return s.includes("?") ? `${s}&${bust}` : `${s}?${bust}`;
    };
    const method = String(opts.method || "GET").toUpperCase();
    const init = {
      method,
      headers: { ...(opts.headers || {}) },
      cache: "no-store",
    };
    if (opts.body != null && method !== "GET" && method !== "HEAD") {
      init.body =
        typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
      if (!init.headers["Content-Type"] && !init.headers["content-type"]) {
        init.headers["Content-Type"] = "application/json; charset=utf-8";
      }
    }
    const t0 = performance.now?.() || Date.now();
    let url = withBust(resolveUrl(pathFor(primary)));
    let res = await fetch(url, init);
    if (!res.ok && alt) {
      url = withBust(resolveUrl(pathFor(alt)));
      res = await fetch(url, init);
    }
    const text = await res.text();
    const ms = Math.round((performance.now?.() || Date.now()) - t0);
    return { ok: res.ok, status: res.status, text, ms, url };
  };

  /**
   * Hit navi:relay via space-separated callin (presumes navi/…).
   * Do NOT slash-join — `relay/connect` is a literal hostpark path, not navi:relay.
   */
  const relayCmd = async (...parts) => {
    const args = parts
      .map((p) => (p == null ? "" : String(p).trim()))
      .filter((p) => p.length > 0);
    const line = ["relay", ...args].join(" ");
    if (typeof navi === "function") return await navi(line);
    if (navi && typeof navi.callin === "function") return await navi.callin(line);
    throw new Error("navi callin unavailable");
  };

  const relayStatus = async () => String((await relayCmd("status")) || "");

  const waitRelayConnected = async (ms = 8000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const st = await relayStatus();
      const line = st.split(/\n/)[0] || "";
      if (/^relay connected\b/i.test(line)) return st;
      await new Promise((r) => setTimeout(r, 200));
    }
    const st = await relayStatus();
    if (!/^relay connected\b/i.test(st.split(/\n/)[0] || "")) {
      throw new Error(st.split(/\n/)[0] || "relay did not connect");
    }
    return st;
  };

  const connect = async (token, alias) => {
    const t = token != null && String(token).trim() ? String(token).trim() : "";
    const a = alias ? sanitizeAlias(alias) : "";
    // Host is navi.origin inside relay connect — never pass a URL through callin.
    // Avoid `relay connect - <alias>`: older shells persisted "-" as prefs.host.
    if (t) {
      await relayCmd("token", t === "-" || t === "none" ? "clear" : t);
    } else {
      await relayCmd("token", "clear");
    }
    const args = ["connect"];
    if (t && t !== "-" && t !== "none") {
      args.push(t);
      if (a) args.push(a);
    } else if (a) {
      args.push(a);
    }
    try {
      await relayCmd(...args);
      connectedCache = { at: 0, value: false };
      const status = await waitRelayConnected();
      connectedCache = { at: Date.now(), value: true };
      lastMeta = { ...lastMeta, connected: true };
      if (a) {
        const st = await loadState();
        st.profile.alias = a;
        await saveState();
      }
      await setWantFlags({ wantConnected: true });
      const hostLine = status.split(/\n/).find((l) => /^host\b/i.test(l));
      const msg = hostLine ? `connected · ${hostLine}` : "connected";
      viewportToast("mesh connected!", "ok");
      await note("connect", msg, { alias: a || null });
      return msg;
    } catch (err) {
      connectedCache = { at: Date.now(), value: false };
      lastMeta = { ...lastMeta, connected: false };
      viewportToast("mesh connect failed", "err");
      throw err;
    }
  };

  /** Ensure reverse-channel is up (navi.origin). */
  const ensureConnected = async () => {
    if (await isRelayConnected()) return "connected";
    const st = await loadState();
    return connect(undefined, st.profile.alias || undefined);
  };

  const disconnect = async () => {
    hushDisconnectToastUntil = Date.now() + 2500;
    const out = await relayCmd("disconnect");
    connectedCache = { at: Date.now(), value: false };
    lastMeta = { ...lastMeta, connected: false };
    await setWantFlags({ wantConnected: false, wantAdvertised: false });
    viewportToast("mesh disconnected", "warn");
    await note("disconnect", "disconnected", {});
    return String(out || "disconnected");
  };

  const advertise = async (alias, expiresSec) => {
    const st = await loadState();
    const a = sanitizeAlias(alias || st.profile.alias);
    if (!a) throw new Error("alias required");
    st.profile.alias = a;
    const args = ["advertise", a];
    const secArg =
      expiresSec != null && Number(expiresSec) > 0
        ? Math.floor(Number(expiresSec))
        : null;
    if (secArg) args.push(String(secArg));
    await relayCmd(...args);

    // Prefer JSON on the saved advertise frame (item 'relay'.frames[alias]).
    let exp = await expiresFromRelayPrefs(a);
    if (!exp) {
      const prefs = await readRelayPrefs();
      const sec =
        secArg ||
        (Number(prefs?.expiresSec) > 0 ? Math.floor(Number(prefs.expiresSec)) : 86400);
      exp = new Date(Date.now() + sec * 1000).toISOString();
    }
    st.profile.expiresAt = exp;
    await ensureMeshId();
    await saveState();
    await ensurePinPark();
    await setWantFlags({ wantAdvertised: true, wantConnected: true });
    const msg = `advertised @${a}`;
    viewportToast(`mesh advertised @${a}`, "ok");
    await note("advertise", msg, { alias: a, expiresAt: exp });
    return msg;
  };

  const ensurePinPark = async () => {
    const tip = tipApi();
    if (!tip?.mut8 && !tip?.set) return;
    const cmds = [
      NAME,
      "hello",
      "notify",
      "msg",
      "tipxfer",
      "renew",
      "state",
      "ping",
    ];
    const data = {
      parts: ["navi_park", "ibgib_frame", "manifest", "json"],
      park: "capture",
      default_method: "GET",
      method: {
        GET: {
          kind: "mod",
          target: NAME,
          command: "hello",
          mode: "async",
          commands: cmds,
        },
        POST: {
          kind: "mod",
          target: NAME,
          command: NAME,
          mode: "async",
          commands: cmds,
        },
      },
      about: {
        label: "meshyrelay pin",
        description: "Mesh hello/msg/tipxfer/renew for peer relays.",
      },
    };
    try {
      const existing = await tip.get(PARK_IB);
      if (existing?.data) {
        await tip.mut8(PARK_IB, data, { replaceData: true });
      } else {
        await tip.set({
          ib: PARK_IB,
          gib: "",
          data,
          rel8ns: { bin: [], past: [], tjp: [], dna: [] },
        });
      }
    } catch (err) {
      console.warn("[meshyrelay] pin park failed", err);
    }
  };

  const ping = async (alias) => {
    const a = sanitizeAlias(alias);
    if (!a) throw new Error("alias required");
    // Bare /navi-{alias}/ — inherent shell ping (no tip knowledge needed).
    try {
      const live = await peerFetch(a, "");
      if (!live.ok) {
        await note("ping_fail", "HTTP " + live.status + " (bare)", {
          alias: a,
          status: live.status,
          text: String(live.text || "").slice(0, 240),
        });
        throw new Error(
          "peer offline or not advertised (HTTP " + live.status + ")"
        );
      }
    } catch (err) {
      if (String(err?.message || err).includes("peer offline")) throw err;
      await note("ping_fail", String(err?.message || err), {
        alias: a,
        error: String(err?.message || err),
      });
      throw err;
    }
    let res;
    try {
      res = await peerFetch(a, "meshyrelay/hello");
    } catch (err) {
      await note("ping_fail", String(err?.message || err), {
        alias: a,
        error: String(err?.message || err),
      });
      throw err;
    }
    if (!res.ok) {
      await note("ping_fail", "HTTP " + res.status, {
        alias: a,
        status: res.status,
        ms: res.ms,
      });
      throw new Error(`ping ${a} → HTTP ${res.status}`);
    }
    const body = parseJson(res.text) || {};
    const st = await loadState();
    const theirMesh = String(body.meshId || "").trim();
    const admitMode = st.prefs.admitMode === "new" ? "new" : "default";
    const already =
      theirMesh && st.activeMeshId && theirMesh === st.activeMeshId;
    const theyKnowUs =
      Array.isArray(body.members) &&
      body.members.some(
        (m) => sanitizeAlias(m?.alias) === sanitizeAlias(st.profile.alias)
      );

    let meshId;
    if (admitMode === "new") {
      meshId = uuid();
      ensureMesh(st, meshId, { label: "@" + a });
    } else if (theirMesh) {
      meshId = theirMesh;
      ensureMesh(st, meshId);
    } else {
      meshId = ensureDefaultMesh(st);
    }
    if (!st.defaultMeshId) st.defaultMeshId = meshId;
    st.activeMeshId = meshId;
    st.profile.meshId = meshId;

    const memberPatch = {
      emoji: body.emoji || "🛰️",
      color: body.color || "#1a6b8a",
      fontWeight: body.fontWeight || "600",
      fontStyle: body.fontStyle || "normal",
      textDecoration: body.textDecoration || "none",
      letterSpacing: body.letterSpacing || "0.02em",
      kind: body.kind || "client",
      device: body.device || "desktop",
      expiresAt: body.expiresAt || null,
      meshId,
    };
    await upsertMemberInMesh(meshId, a, memberPatch, { skipSave: true });

    // Soft-merge their known members into this mesh.
    if (Array.isArray(body.members)) {
      for (const m of body.members) {
        const ma = sanitizeAlias(m?.alias);
        if (!ma || ma === sanitizeAlias(st.profile.alias)) continue;
        await upsertMemberInMesh(
          meshId,
          ma,
          {
            emoji: m.emoji || "🛰️",
            color: m.color || "#555",
            kind: m.kind || "client",
            device: m.device || "desktop",
            expiresAt: m.expiresAt || null,
            meshId,
          },
          { skipSave: true }
        );
      }
    }

    syncActiveMembers(st);
    await saveState();
    const pingText =
      `ping ok (${res.ms}ms)` +
      (theyKnowUs || already ? " · mesh rejoin" : "") +
      (admitMode === "new" ? " · new mesh" : "");
    await note("ping", pingText, {
      alias: a,
      ms: res.ms,
      meshId,
      rejoined: !!(already || theyKnowUs),
    });

    // Introduce ourselves to the peer we pinged.
    try {
      await peerFetch(a, "meshyrelay/notify", {
        method: "POST",
        body: await publicProfileForMesh(meshId),
      });
    } catch {
      /* optional */
    }

    // Everyone else in this mesh discovers the roster (incl. the new peer).
    void announceToMesh(meshId, [a]).then((results) => {
      const okN = results.filter((r) => r.ok).length;
      if (!results.length) return;
      const failBits = results
        .filter((r) => !r.ok)
        .map((r) => {
          if (r.skipped === "offline") return `${r.alias}:offline/${r.status}`;
          if (r.status) return `${r.alias}:HTTP${r.status}`;
          return `${r.alias}:${String(r.error || "?").slice(0, 40)}`;
        })
        .slice(0, 6);
      void note(
        "mesh_announce",
        `${okN}/${results.length} peers told` +
          (failBits.length ? ` · ${failBits.join(" ")}` : ""),
        {
          alias: a,
          meshId,
          ok: okN,
          results,
        }
      );
    });

    return {
      ok: true,
      alias: a,
      ms: res.ms,
      profile: body,
      meshId,
      rejoined: !!(already || theyKnowUs),
    };
  };

  const telegraph = async (patch = null, meshId = null) => {
    const st = await loadState();
    const mid = meshId || st.activeMeshId || st.defaultMeshId;
    const payload = patch
      ? { ...(await publicProfileForMesh(mid)), ...patch }
      : await publicProfileForMesh(mid);
    const mesh = st.meshes[mid];
    const aliases = mesh
      ? Object.keys(mesh.members || {})
      : Object.keys(st.members);
    const self = sanitizeAlias(st.profile.alias);
    const results = [];
    for (const a of aliases) {
      if (a === self) continue;
      try {
        const res = await peerFetch(a, "meshyrelay/notify", {
          method: "POST",
          body: payload,
        });
        results.push({ alias: a, ok: res.ok, status: res.status });
      } catch (err) {
        results.push({ alias: a, ok: false, error: String(err?.message || err) });
      }
    }
    await note("telegraph", `${results.filter((r) => r.ok).length}/${results.length} peers`, {
      targets: results.length,
      ok: results.filter((r) => r.ok).length,
      meshId: mid,
    });
    return results;
  };

  const updateProfile = async (patch = {}) => {
    const st = await loadState();
    const p = { ...patch };
    if (p.alias != null) p.alias = sanitizeAlias(p.alias);
    st.profile = { ...st.profile, ...p };
    if (p.allowRenew != null) st.prefs.allowRenew = !!p.allowRenew;
    await saveState();
    await savePrefs();
    await note("profile", "updated · telegraphing", { keys: Object.keys(patch) });
    void telegraph();
    return st.profile;
  };

  const isMeshTarget = (alias) => {
    const t = String(alias ?? "")
      .trim()
      .toLowerCase();
    return !t || t === "*" || t === "mesh" || t === "all" || t === "@mesh";
  };

  const meshAliases = async () => {
    const st = await loadState();
    const self = sanitizeAlias(st.profile.alias);
    return Object.keys(st.members || {})
      .map((a) => sanitizeAlias(a))
      .filter((a) => a && a !== self);
  };

  const assertPeerLive = async (a) => {
    const live = await peerFetch(a, "");
    if (!live.ok) {
      throw new Error(
        `@${a} offline or not advertised (HTTP ${live.status})`
      );
    }
    return live;
  };

  const deliverMsg = async (a, msg) => {
    try {
      await assertPeerLive(a);
    } catch (err) {
      await note("msg_fail", String(err?.message || err), {
        alias: a,
        offline: true,
      });
      throw err;
    }
    const st = await loadState();
    const body = {
      from: st.profile.alias || "?",
      text: msg,
      at: stamp(),
      emoji: st.profile.emoji,
      color: st.profile.color,
    };
    const res = await peerFetch(a, "meshyrelay_manager/msg", {
      method: "POST",
      body,
    });
    if (!res.ok) {
      const errMsg = `msg → @${a} HTTP ${res.status}: ${res.text.slice(0, 120)}`;
      await note("msg_fail", errMsg, {
        alias: a,
        status: res.status,
        offline: res.status === 404 || res.status === 502 || res.status === 503,
      });
      throw new Error(errMsg);
    }
    return { ok: true, alias: a, ms: res.ms };
  };

  const sendMsg = async (alias, text) => {
    const msg = String(text || "").trim();
    if (!msg) throw new Error("message required");
    if (isMeshTarget(alias)) {
      const targets = await meshAliases();
      if (!targets.length) throw new Error("no mesh members — ping someone first");
      const results = [];
      for (const a of targets) {
        try {
          await deliverMsg(a, msg);
          await note("msg_out", msg, { alias: a, bytes: msg.length });
          results.push({ ok: true, alias: a });
        } catch (err) {
          // msg_fail already in feed via deliverMsg
          results.push({
            ok: false,
            alias: a,
            error: String(err?.message || err),
          });
        }
      }
      const okN = results.filter((r) => r.ok).length;
      if (!okN) {
        throw new Error(
          `msg failed — all ${targets.length} peers offline/unreachable`
        );
      }
      return { ok: true, alias: "*", results, sent: okN, failed: targets.length - okN };
    }
    const a = sanitizeAlias(alias);
    if (!a) throw new Error("alias required (or * / mesh for everyone)");
    await deliverMsg(a, msg);
    await note("msg_out", msg, { alias: a, bytes: msg.length });
    return { ok: true, alias: a };
  };

  /** Path/colon dirname used to group tips for bulk send. */
  const ibDirPrefix = (ib) => {
    const s = String(ib || "");
    const slash = s.lastIndexOf("/");
    if (slash >= 0) return s.slice(0, slash + 1);
    const colon = s.lastIndexOf(":");
    if (colon >= 0) return s.slice(0, colon + 1);
    return s;
  };

  const listIbs = async (q = "", opts = {}) => {
    const tip = tipApi();
    if (!tip?.list) return [];
    const all = await tip.list();
    const needle = String(q || "").trim().toLowerCase();
    const prefix = String(opts.prefix || "").trim();
    let ibs = (all || []).map(String);
    if (prefix) ibs = ibs.filter((ib) => ib.startsWith(prefix));
    else if (needle) ibs = ibs.filter((ib) => ib.toLowerCase().includes(needle));
    const lim = Number(opts.limit);
    const limit = Number.isFinite(lim) && lim > 0 ? lim : 200;
    return ibs.slice(0, limit);
  };

  const listIbGroups = async (q = "") => {
    const ibs = await listIbs(q, { limit: 2000 });
    const map = new Map();
    for (const ib of ibs) {
      const p = ibDirPrefix(ib) || ib;
      if (!map.has(p)) map.set(p, []);
      map.get(p).push(ib);
    }
    return [...map.entries()]
      .map(([prefix, items]) => ({
        prefix,
        count: items.length,
        ibs: items,
      }))
      .sort((a, b) => b.count - a.count || a.prefix.localeCompare(b.prefix));
  };

  const tipExists = async (ib) => {
    const tip = tipApi();
    if (!tip?.get) return false;
    try {
      const t = await tip.get(String(ib || "").trim());
      return !!(t && t.ib);
    } catch {
      return false;
    }
  };

  const resolveTipIbs = async (ibOrPrefix) => {
    const raw = String(ibOrPrefix || "").trim();
    if (!raw) throw new Error("ib or prefix required");
    if (raw.endsWith("*")) {
      return listIbs("", { prefix: raw.slice(0, -1), limit: 500 });
    }
    if (raw.endsWith("/") || raw.endsWith(":")) {
      return listIbs("", { prefix: raw, limit: 500 });
    }
    if (await tipExists(raw)) return [raw];
    const asPrefix = await listIbs("", { prefix: raw, limit: 500 });
    if (asPrefix.length) return asPrefix;
    throw new Error(`tip not found: ${raw}`);
  };

  const deliverTip = async (a, tipIb) => {
    const tip = tipApi();
    const bin = binApi();
    if (!tip?.get || !bin?.get) throw new Error("tip/bin storage unavailable");
    const frame = await tip.get(tipIb);
    if (!frame?.ib) throw new Error(`tip not found: ${tipIb}`);
    const bins = {};
    const refs = Array.isArray(frame.rel8ns?.bin) ? frame.rel8ns.bin : [];
    for (const ref of refs) {
      const sha = String(ref || "")
        .replace(/^bin\s+/i, "")
        .trim();
      if (!sha) continue;
      const rec = await bin.get(sha);
      if (rec?.media != null) {
        bins[sha] = { media: rec.media, mime: rec.mime || "application/octet-stream" };
      }
    }
    const payload = {
      from: (await loadState()).profile.alias || "?",
      tip: {
        ib: frame.ib,
        gib: frame.gib || "",
        data: frame.data || {},
        rel8ns: frame.rel8ns || {},
      },
      bins,
      at: stamp(),
    };
    const res = await peerFetch(a, "meshyrelay_manager/tipxfer", {
      method: "POST",
      body: payload,
    });
    if (!res.ok) {
      throw new Error(`tipxfer → HTTP ${res.status}: ${res.text.slice(0, 120)}`);
    }
    return { ok: true, ib: tipIb, bins: Object.keys(bins).length };
  };

  /** One tip → one peer (or * mesh). For prefix/bulk use sendTips. */
  const sendTip = async (alias, ib) => {
    const tipIb = String(ib || "").trim();
    if (!tipIb) throw new Error("ib required");
    if (isMeshTarget(alias)) {
      return sendTips("*", tipIb);
    }
    const a = sanitizeAlias(alias);
    if (!a) throw new Error("alias required (or * / mesh)");
    const out = await deliverTip(a, tipIb);
    await note("tip_out", tipIb, { alias: a, ib: tipIb, bins: out.bins });
    return out;
  };

  /**
   * Bulk tip xfer: alias may be * / mesh; ibOrPrefix may be one ib, a prefix
   * ending in / or :, or prefix* — all matching local tips are sent.
   */
  const sendTips = async (alias, ibOrPrefix) => {
    const ibs = await resolveTipIbs(ibOrPrefix);
    if (!ibs.length) throw new Error("no tips match that prefix/ib");
    const targets = isMeshTarget(alias)
      ? await meshAliases()
      : [sanitizeAlias(alias)].filter(Boolean);
    if (!targets.length) {
      throw new Error(
        isMeshTarget(alias)
          ? "no mesh members — ping someone first"
          : "alias required (or * / mesh)"
      );
    }
    const results = [];
    for (const a of targets) {
      for (const tipIb of ibs) {
        try {
          const out = await deliverTip(a, tipIb);
          results.push({ ok: true, alias: a, ib: tipIb, bins: out.bins });
        } catch (err) {
          results.push({
            ok: false,
            alias: a,
            ib: tipIb,
            error: String(err?.message || err),
          });
        }
      }
    }
    const okN = results.filter((r) => r.ok).length;
    await note("tip_out", String(ibOrPrefix), {
      alias: isMeshTarget(alias) ? "*" : targets[0],
      prefix: String(ibOrPrefix),
      tips: ibs.length,
      targets: targets.length,
      ok: okN,
    });
    return {
      ok: okN > 0,
      tips: ibs.length,
      targets: targets.length,
      sent: okN,
      results,
    };
  };

  const ingestMsg = async () => {
    const body = parseJson(callinBody()) || {};
    const from = sanitizeAlias(body.from);
    const text = String(body.text || "").trim();
    if (!from || !text) return { ok: false, error: "from/text required" };
    const st = await loadState();
    const prev = st.members[from] || { alias: from, unread: 0 };
    // Unread only stacks while no HTMF is watching.
    const unread = uiIsLive() ? 0 : (Number(prev.unread) || 0) + 1;
    st.members[from] = {
      ...prev,
      emoji: body.emoji || prev.emoji,
      color: body.color || prev.color,
      unread,
      alias: from,
      lastSeen: stamp(),
    };
    const row = {
      id: uuid(),
      at: stamp(),
      type: "msg_in",
      alias: from,
      text,
    };
    st.feed.push(row);
    if (st.feed.length > FEED_MAX) st.feed = st.feed.slice(-FEED_MAX);
    // Cache already updated — paint before any tip.mut8.
    notify(uiHint(st));
    void saveState({ silent: true });
    void appendLog("msg_in", { alias: from, bytes: text.length });
    return { ok: true };
  };

  const ingestNotify = async () => {
    const body = parseJson(callinBody()) || {};
    const from = sanitizeAlias(body.alias || body.from);
    if (!from) return { ok: false, error: "alias required" };
    const st = await loadState();
    if (st.prefs.autoAdmit === false) {
      await note("admit_deny", "auto-admit off · ignored @" + from, {
        alias: from,
        meshId: body.meshId || null,
      });
      return { ok: false, denied: true, reason: "autoAdmit off" };
    }

    const admitMode = st.prefs.admitMode === "new" ? "new" : "default";
    const theirMesh = String(body.meshId || "").trim();
    let meshId;
    if (admitMode === "new") {
      meshId = uuid();
      ensureMesh(st, meshId, { label: "@" + from });
      if (!st.defaultMeshId) st.defaultMeshId = meshId;
      if (!st.activeMeshId) st.activeMeshId = meshId;
    } else {
      meshId = st.defaultMeshId || theirMesh || ensureDefaultMesh(st);
      if (theirMesh && !st.defaultMeshId) {
        meshId = theirMesh;
        st.defaultMeshId = theirMesh;
      }
      ensureMesh(st, meshId);
      if (!st.activeMeshId) st.activeMeshId = meshId;
      if (!st.defaultMeshId) st.defaultMeshId = meshId;
    }
    st.profile.meshId = st.activeMeshId || meshId;

    const { wasNew } = await upsertMemberInMesh(meshId, from, {
      emoji: body.emoji || "🛰️",
      color: body.color || "#1a6b8a",
      fontWeight: body.fontWeight || "600",
      fontStyle: body.fontStyle || "normal",
      textDecoration: body.textDecoration || "none",
      letterSpacing: body.letterSpacing || "0.02em",
      kind: body.kind || "client",
      device: body.device || "desktop",
      expiresAt: body.expiresAt || null,
      meshId,
    });

    if (Array.isArray(body.members)) {
      const rosterAdds = [];
      for (const m of body.members) {
        const ma = sanitizeAlias(m?.alias);
        if (!ma || ma === sanitizeAlias(st.profile.alias) || ma === from) continue;
        const mesh = st.meshes[meshId];
        if (mesh?.members?.[ma]) continue;
        await upsertMemberInMesh(meshId, ma, {
          emoji: m.emoji || "🛰️",
          color: m.color || "#555",
          kind: m.kind || "client",
          device: m.device || "desktop",
          expiresAt: m.expiresAt || null,
          meshId,
        });
        rosterAdds.push(ma);
      }
      if (rosterAdds.length) {
        await note(
          "roster",
          `+${rosterAdds.map((x) => "@" + x).join(" ")} via @${from}`,
          { alias: from, meshId, adds: rosterAdds, announce: !!body.announce }
        );
      }
    }

    await note(
      wasNew ? "admit" : "notify",
      (wasNew ? "admitted @" : "profile from @") + from,
      { alias: from, meshId, announce: !!body.announce }
    );

    // Propagate new joins to the rest of this mesh.
    if (wasNew) {
      void announceToMesh(meshId, [from]).then((results) => {
        const okN = results.filter((r) => r.ok).length;
        if (!results.length) return;
        const failBits = results
          .filter((r) => !r.ok)
          .map((r) => {
            if (r.skipped === "offline") return `${r.alias}:offline/${r.status}`;
            if (r.status) return `${r.alias}:HTTP${r.status}`;
            return `${r.alias}:${String(r.error || "?").slice(0, 40)}`;
          })
          .slice(0, 6);
        void note(
          "mesh_announce",
          `${okN}/${results.length} peers told` +
            (failBits.length ? ` · ${failBits.join(" ")}` : ""),
          { alias: from, meshId, ok: okN, results }
        );
      });
    }
    return { ok: true, meshId, admitted: wasNew };
  };

  const ingestTip = async () => {
    const body = parseJson(callinBody()) || {};
    const tipFrame = body.tip;
    const bins = body.bins && typeof body.bins === "object" ? body.bins : {};
    const from = sanitizeAlias(body.from);
    if (!tipFrame?.ib) return { ok: false, error: "tip.ib required" };
    const tip = tipApi();
    const bin = binApi();
    if (!tip?.set || !bin?.putMedia) return { ok: false, error: "storage unavailable" };
    for (const [sha, rec] of Object.entries(bins)) {
      try {
        await bin.putMedia({
          media: rec.media,
          mime: rec.mime || "application/octet-stream",
          sha,
        });
      } catch {
        try {
          await bin.putMedia({
            media: rec.media,
            mime: rec.mime || "application/octet-stream",
          });
        } catch (err) {
          console.warn("[meshyrelay] bin put failed", sha, err);
        }
      }
    }
    await tip.set({
      ib: tipFrame.ib,
      gib: tipFrame.gib || "",
      data: tipFrame.data || {},
      rel8ns: tipFrame.rel8ns || { bin: [], past: [], tjp: [], dna: [] },
    });
    if (from) {
      const st = await loadState();
      const prev = st.members[from] || { alias: from, unread: 0 };
      prev.unread = uiIsLive() ? 0 : (Number(prev.unread) || 0) + 1;
      st.members[from] = prev;
      await saveState({ silent: true });
      notify(uiHint(st));
    }
    await note("tip_in", tipFrame.ib, {
      alias: from || null,
      ib: tipFrame.ib,
      bins: Object.keys(bins).length,
    });
    return { ok: true, ib: tipFrame.ib };
  };

  const askRenew = async (alias) => {
    const a = sanitizeAlias(alias);
    const res = await peerFetch(a, "meshyrelay_manager/renew", {
      method: "POST",
      body: { from: (await loadState()).profile.alias || "?", at: stamp() },
    });
    if (!res.ok) {
      await note("renew", "ask failed HTTP " + res.status, {
        alias: a,
        ok: false,
        status: res.status,
      });
      throw new Error(`renew → HTTP ${res.status}`);
    }
    const body = parseJson(res.text) || {};
    if (body.expiresAt) {
      await upsertMember(a, { expiresAt: body.expiresAt });
    }
    await note(
      "renew",
      body.ok ? "peer renewed" : String(body.error || "denied"),
      { alias: a, ok: !!body.ok }
    );
    return body;
  };

  const handleRenew = async () => {
    const st = await loadState();
    if (st.profile.allowRenew === false || st.prefs.allowRenew === false) {
      await note("renew_deny", "renew denied by prefs", {});
      return { ok: false, error: "renew denied by peer prefs" };
    }
    const a = st.profile.alias;
    if (!a) return { ok: false, error: "no local alias" };
    const out = await advertise(a);
    return { ok: true, expiresAt: (await loadState()).profile.expiresAt, out: String(out) };
  };

  const clearUnread = async (alias) => {
    const a = sanitizeAlias(alias);
    const st = await loadState();
    if (st.members[a]) {
      st.members[a].unread = 0;
      await saveState();
    }
  };

  const jsonOut = (obj) => {
    const s = JSON.stringify(obj);
    return s;
  };

  const runHello = async () => jsonOut(await publicProfile());
  const runState = async () => jsonOut(await snapshot());

  const HELP = [
    "meshyrelay_manager — mesh of navi_shell relays (no HTMF required)",
    "",
    "Setup:",
    "  mount flowerpot/hypercloud/testkit/mods/legacy/meshyrelay_manager.js",
    "  meshyrelay_manager connect [token|-] [alias]",
    "  meshyrelay_manager advertise [alias]",
    "  meshyrelay_manager ping <peer>     # join mesh / exchange profiles",
    "",
    "Messages:",
    "  meshyrelay_manager msg <alias> <text…>   # one peer",
    "  meshyrelay_manager msg * <text…>         # everyone in members",
    "  meshyrelay_manager msg mesh <text…>      # same as *",
    "",
    "Tips / bins:",
    "  meshyrelay_manager tip <alias> <ib>           # one tip → one peer",
    "  meshyrelay_manager tip * <prefix>             # all matching tips → all peers",
    "  meshyrelay_manager tip fren navi:foo:  # prefix (ends with : or /)",
    "  meshyrelay_manager tip fren navi:foo*         # glob prefix*",
    "  meshyrelay_manager ibs [query]",
    "  meshyrelay_manager ibgroups [query]",
    "  meshyrelay_manager mesh list|use <id>|default <id>",
    "  meshyrelay_manager prefs {\"autoAdmit\":true,\"admitMode\":\"default\"|\"new\"}",
    "",
    "Other:",
    "  status | help | snapshot | telegraph | renew <alias>",
    "  profile [json-patch] | disconnect",
    "",
    "Peer paths: /navi-{alias}/meshyrelay_manager/{hello|notify|msg|tipxfer|renew}",
  ].join("\n");

  const run = async (...args) => {
    const raw = args.map(String);
    // When invoked as default command with remainder, first seg may be subcmd.
    let sub = String(raw[0] || "help").trim().toLowerCase();
    let rest = raw.slice(1);
    if (sub === NAME || sub === "meshyrelay") {
      sub = String(rest[0] || "help").trim().toLowerCase();
      rest = rest.slice(1);
    }

    switch (sub) {
      case "help":
      case "-h":
        return HELP;
      case "status":
      case "snapshot":
        return jsonOut(await snapshot());
      case "hello":
        return runHello();
      case "state":
        return runState();
      case "connect":
        return await connect(rest[0], rest[1]);
      case "disconnect":
        return await disconnect();
      case "advertise":
      case "advert":
        return await advertise(rest[0], rest[1]);
      case "ping":
        return jsonOut(await ping(rest[0]));
      case "profile": {
        const patch = parseJson(rest.join(" ")) || {};
        return jsonOut(await updateProfile(patch));
      }
      case "msg":
      case "broadcast":
        if (sub === "broadcast") {
          return jsonOut(await sendMsg("*", rest.join(" ")));
        }
        return jsonOut(await sendMsg(rest[0], rest.slice(1).join(" ")));
      case "tip":
      case "tipxfer":
        if (String(navi?.callinRequest?.method || "").toUpperCase() === "POST") {
          return jsonOut(await ingestTip());
        }
        // tip <alias> <ib|prefix…> — prefix may contain spaces? unlikely; join rest[1+]
        return jsonOut(await sendTips(rest[0], rest.slice(1).join(" ")));
      case "renew":
        if (String(navi?.callinRequest?.method || "").toUpperCase() === "POST" && !rest[0]) {
          return jsonOut(await handleRenew());
        }
        return jsonOut(await askRenew(rest[0]));
      case "notify":
        return jsonOut(await ingestNotify());
      case "telegraph":
        return jsonOut(await telegraph());
      case "ibs":
        return jsonOut(await listIbs(rest.join(" ")));
      case "ibgroups":
      case "prefixes":
        return jsonOut(await listIbGroups(rest.join(" ")));
      case "mesh": {
        const sub2 = String(rest[0] || "list").trim().toLowerCase();
        if (sub2 === "list" || sub2 === "ls") return jsonOut(await listMeshes());
        if (sub2 === "use" || sub2 === "switch" || sub2 === "active") {
          return jsonOut(await setActiveMesh(rest[1]));
        }
        if (sub2 === "default") return jsonOut(await setDefaultMesh(rest[1]));
        return "mesh list | mesh use <id> | mesh default <id>";
      }
      case "prefs": {
        const st = await loadState();
        if (rest[0]) {
          const patch = parseJson(rest.join(" ")) || {};
          return jsonOut(await updatePrefs(patch));
        }
        return jsonOut(st.prefs);
      }
      default:
        // POST body without subcmd → try ingest by content-type shape
        if (String(navi?.callinRequest?.method || "").toUpperCase() === "POST") {
          const body = parseJson(callinBody());
          if (body?.text != null) return jsonOut(await ingestMsg());
          if (body?.tip) return jsonOut(await ingestTip());
          if (body?.alias || body?.from) return jsonOut(await ingestNotify());
        }
        return `Unknown meshyrelay_manager form '${sub}'. Type 'meshyrelay_manager help'.`;
    }
  };

  // Named command handlers for park remainder dispatch.
  const cmd = (name, fn) => ({
    name,
    description: `meshyrelay ${name}`,
    execute: async (...a) => fn(...a),
  });

  return {
    name: NAME,
    version: VERSION,
    description:
      "Mesh of navi relays — ping aliases, profile telegraph, msgs, tip/bin xfer",
    moduleInfo: {
      name: NAME,
      version: VERSION,
      description: "Companion manager for testkit/meshyrelay HTMF",
    },

    // HTMF / programmatic API
    snapshot,
    openUi,
    closeUi,
    markFeedSeen,
    loadState,
    ping,
    connect,
    ensureConnected,
    disconnect,
    advertise,
    updateProfile,
    sendMsg,
    sendTip,
    sendTips,
    askRenew,
    telegraph,
    listIbs,
    listIbGroups,
    listMeshes,
    setActiveMesh,
    setDefaultMesh,
    updatePrefs,
    tipExists,
    clearUnread,
    onChange,
    appendLog,
    publicProfile,
    ensurePinPark,
    WAREZ_SUBJECT,
    WAREZ_MANIFEST,

    commands: {
      [NAME]: {
        name: NAME,
        description: "meshyrelay_manager help | connect | advertise | ping | …",
        execute: run,
      },
      hello: cmd("hello", runHello),
      state: cmd("state", runState),
      notify: cmd("notify", async () => jsonOut(await ingestNotify())),
      msg: cmd("msg", async (...a) => {
        if (String(navi?.callinRequest?.method || "").toUpperCase() === "POST") {
          return jsonOut(await ingestMsg());
        }
        return jsonOut(await sendMsg(a[0], a.slice(1).join(" ")));
      }),
      tipxfer: cmd("tipxfer", async (...a) => {
        if (String(navi?.callinRequest?.method || "").toUpperCase() === "POST") {
          return jsonOut(await ingestTip());
        }
        return jsonOut(await sendTips(a[0], a.slice(1).join(" ")));
      }),
      renew: cmd("renew", async (...a) => {
        if (
          String(navi?.callinRequest?.method || "").toUpperCase() === "POST" &&
          !a[0]
        ) {
          return jsonOut(await handleRenew());
        }
        return jsonOut(await askRenew(a[0]));
      }),
      ping: cmd("ping", async (...a) => jsonOut(await ping(a[0]))),
    },

    onMount: async () => {
      // Durable tip state survives HTMF navigation; keep pin parks warm.
      cache = null;
      await loadState();
      const st = await loadState();
      st.profile.device = st.profile.device || inferDevice();
      st.profile.kind = st.profile.kind || inferKind();
      await saveState();
      await ensurePinPark();

      // Surface unexpected socket drops as viewport toasts (mod-owned).
      if (typeof navi?.on === "function") {
        if (typeof navi.__meshyrelayOnCallout === "function") {
          try {
            navi.off?.("callout", navi.__meshyrelayOnCallout);
          } catch {
            /* ignore */
          }
        }
        const onCallout = (data) => {
          const s = String(
            data && typeof data === "object"
              ? data.message ?? data.text ?? data
              : data ?? ""
          );
          if (!/\[navi\]\s*relay\s+(disconnected|socket closed)/i.test(s)) {
            return;
          }
          if (Date.now() < hushDisconnectToastUntil) return;
          connectedCache = { at: Date.now(), value: false };
          lastMeta = { ...lastMeta, connected: false };
          viewportToast("mesh disconnected", "warn");
          try {
            notify(uiHint(cache));
          } catch {
            /* ignore */
          }
        };
        navi.__meshyrelayOnCallout = onCallout;
        navi.on("callout", onCallout);
      }

      console.log(
        `[meshyrelay_manager] v${VERSION} loaded — mesh runs without HTMF; feed accumulates in ${STATE_IB}`
      );

      // Persist intent: reconnect (+ re-advertise) without opening HTMF.
      if (st.prefs.wantConnected) {
        void (async () => {
          try {
            viewportToast("mesh connecting…", "info");
            const already = await isRelayConnected({ force: true });
            await ensureConnected();
            if (already) viewportToast("mesh connected!", "ok");
            const live = await loadState();
            if (live.prefs.wantAdvertised && live.profile.alias) {
              await advertise(live.profile.alias);
            }
          } catch (err) {
            viewportToast("mesh reconnect failed", "err");
            console.warn(
              "[meshyrelay_manager] auto-reconnect failed",
              err?.message || err
            );
          }
        })();
      }
    },
  };
};
