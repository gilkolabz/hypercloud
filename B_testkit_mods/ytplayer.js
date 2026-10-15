/**
 * ytplayer — old-school controls for YouTube embeds, wired by markup alone.
 *
 * Any element `[data-ytplayer]` holding `<iframe data-ytplayer-frame>` (a YouTube embed with
 * enablejsapi=1&controls=0) and a `[data-ytplayer-bar]` gets live controls. Buttons carry
 * `data-yt-act` = toggle | mute | cc | full | seek (track) | vol (track). Bars without a cc
 * button (players saved before it existed) get one. Display hooks:
 * `[data-yt-played]`, `[data-yt-loaded]`, `[data-yt-knob]`, `[data-yt-volfill]`, `[data-yt-time]`.
 *
 * One document-level listener + one message listener + a scan, so players work wherever they
 * land: staged, moved, draggem-wrapped, carried across surfs, or rehydrated from outerHTML.
 * Each player's iframe onload mounts this park when the page has it not.
 *
 * State lives on the element (data-yt-t seconds, data-yt-vol, data-yt-muted, data-yt-cc, data-yt-state),
 * so a saved/hostparked outerHTML restores time, volume, mute, captions and play/pause (not fullscreen) when the
 * player loads. Players carry data-stage-live and fire a bubbling "stage-dirty" on discrete
 * changes, so a stage that honors those keeps its saved copy current.
 * Talks to the player over YouTube's iframe postMessage protocol (no external script).
 */

const PARK = "ytplayer";
const STYLE_ID = "ytplayer-style";
const YT_ORIGIN = /^https:\/\/(www\.)?youtube(-nocookie)?\.com$/;

const CSS = `
[data-ytplayer]{display:inline-block;background:#000;border:1px solid #8c8c8c;box-shadow:0 1px 3px rgba(0,0,0,.35);font:11px/1 Arial,Helvetica,sans-serif;color:#333;line-height:normal;text-align:left;vertical-align:top;user-select:none}
[data-ytplayer] iframe[data-ytplayer-frame]{display:block;border:0;background:#000}
[data-ytplayer-bar]{display:flex;align-items:center;gap:5px;height:26px;padding:0 5px;box-sizing:border-box;background:linear-gradient(#fafafa,#e3e3e3 48%,#d2d2d2 52%,#c8c8c8);border-top:1px solid #7a7a7a}
[data-ytplayer-bar] button{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;height:18px;min-width:22px;padding:0 3px;border:1px solid #8f8f8f;border-radius:3px;background:linear-gradient(#fff,#e8e8e8 50%,#d6d6d6 51%,#ececec);box-shadow:inset 0 1px 0 #fff;cursor:pointer}
[data-ytplayer-bar] button:hover{border-color:#5f5f5f;background:linear-gradient(#fff,#f1f1f1 50%,#e1e1e1 51%,#f6f6f6)}
[data-ytplayer-bar] button:active{background:linear-gradient(#cfcfcf,#e6e6e6)}
[data-ytplayer-bar] svg{display:block;width:12px;height:12px;fill:#3a3a3a}
[data-ytplayer] [data-yt-icon="pause"],[data-ytplayer][data-yt-state="playing"] [data-yt-icon="play"],[data-ytplayer][data-yt-state="buffering"] [data-yt-icon="play"]{display:none}
[data-ytplayer][data-yt-state="playing"] [data-yt-icon="pause"],[data-ytplayer][data-yt-state="buffering"] [data-yt-icon="pause"]{display:block}
[data-ytplayer] [data-yt-icon="waves"]{display:inline}
[data-ytplayer][data-yt-muted="1"] [data-yt-icon="waves"]{display:none}
[data-ytplayer][data-yt-muted="1"] [data-yt-icon="x"]{display:inline}
[data-ytplayer] [data-yt-icon="x"]{display:none}
[data-yt-act="seek"]{position:relative;flex:1;height:8px;border:1px solid #6d6d6d;border-radius:4px;background:linear-gradient(#5a5a5a,#7d7d7d);box-shadow:inset 0 1px 2px rgba(0,0,0,.5);cursor:pointer}
[data-yt-loaded]{position:absolute;left:0;top:0;bottom:0;width:0;border-radius:3px;background:linear-gradient(#bdbdbd,#9a9a9a)}
[data-yt-played]{position:absolute;left:0;top:0;bottom:0;width:0;border-radius:3px;background:linear-gradient(#ff5a5a,#cc0000 60%,#a50000)}
[data-yt-knob]{position:absolute;top:50%;left:0;width:11px;height:11px;margin:-6px 0 0 -6px;border:1px solid #6a6a6a;border-radius:50%;background:radial-gradient(circle at 35% 30%,#fff,#d8d8d8 55%,#aaa);box-shadow:0 1px 2px rgba(0,0,0,.4)}
[data-yt-time]{min-width:72px;text-align:center;font:bold 11px Arial,Helvetica,sans-serif;color:#333;text-shadow:0 1px 0 #fff;white-space:nowrap}
[data-yt-act="vol"]{position:relative;width:40px;height:6px;border:1px solid #7a7a7a;background:#9a9a9a;box-shadow:inset 0 1px 1px rgba(0,0,0,.4);cursor:pointer}
[data-yt-volfill]{position:absolute;left:0;top:0;bottom:0;width:100%;background:linear-gradient(#6e9bd6,#2f64ad)}
[data-ytplayer-bar] button[data-yt-act="cc"]{font:bold 9px/1 Arial,Helvetica,sans-serif;color:#3a3a3a;letter-spacing:-.2px}
[data-ytplayer][data-yt-cc="0"] button[data-yt-act="cc"]{color:#9a9a9a;text-decoration:line-through}
[data-ytplayer]:fullscreen{display:flex;flex-direction:column;width:100vw;height:100vh;border:0}
[data-ytplayer]:fullscreen iframe[data-ytplayer-frame]{flex:1;width:100%;height:auto}
`;

/** iframe onload: mount this park once if the page has no ytplayer yet. */
const BOOT =
    "if(!(window.navi&&navi.mod&&navi.mod.ytplayer)&&!window.__ytplayerBoot&&window.navi&&navi.callin)" +
    `{window.__ytplayerBoot=1;Promise.resolve(navi.callin({path:'${PARK}',method:'GET',parkBypass:true})).catch(function(){window.__ytplayerBoot=0})}`;

const CC_BUTTON = `<button type="button" data-yt-act="cc" title="captions on / off">CC</button>`;

/** Player markup (the HTMF / anyone can also write it by hand). */
export function playerHtml(videoId, { width = 400, height = 300, title = "" } = {}) {
    const id = String(videoId || "").replace(/[^A-Za-z0-9_-]/g, "");
    const esc = (s) =>
        String(s).replace(/[&"<>]/g, (c) => ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" })[c]);
    return (
        `<div data-ytplayer="${id}" data-stage-live style="width:${width}px">` +
        `<iframe data-ytplayer-frame width="${width}" height="${height}" title="${esc(title || "YouTube video")}" ` +
        `src="https://www.youtube.com/embed/${id}?enablejsapi=1&controls=0&rel=0&playsinline=1&iv_load_policy=3&disablekb=1" ` +
        `allow="autoplay; encrypted-media; picture-in-picture; fullscreen" referrerpolicy="strict-origin-when-cross-origin" ` +
        `onload="${BOOT}"></iframe>` +
        `<div data-ytplayer-bar>` +
        `<button type="button" data-yt-act="toggle" title="play / pause">` +
        `<svg data-yt-icon="play" viewBox="0 0 12 12"><path d="M3 1.5v9l7.5-4.5z"/></svg>` +
        `<svg data-yt-icon="pause" viewBox="0 0 12 12"><path d="M2.5 1.5h2.5v9H2.5zM7 1.5h2.5v9H7z"/></svg>` +
        `</button>` +
        `<div data-yt-act="seek" title="seek"><div data-yt-loaded></div><div data-yt-played></div><div data-yt-knob></div></div>` +
        `<span data-yt-time>0:00 / 0:00</span>` +
        `<button type="button" data-yt-act="mute" title="mute"><svg viewBox="0 0 12 12"><path d="M1 4.2h2.2L6.4 1.5v9L3.2 7.8H1z"/>` +
        `<path data-yt-icon="waves" d="M7.6 3.4a3.4 3.4 0 0 1 0 5.2l-.6-.7a2.5 2.5 0 0 0 0-3.8zM9 2a5.4 5.4 0 0 1 0 8l-.6-.7a4.5 4.5 0 0 0 0-6.6z"/>` +
        `<path data-yt-icon="x" d="M7.3 4.3l.7-.7 1.5 1.5 1.5-1.5.7.7-1.5 1.5 1.5 1.5-.7.7-1.5-1.5-1.5 1.5-.7-.7 1.5-1.5z"/></svg></button>` +
        `<div data-yt-act="vol" title="volume"><div data-yt-volfill></div></div>` +
        CC_BUTTON +
        `<button type="button" data-yt-act="full" title="full screen"><svg viewBox="0 0 12 12"><path d="M1 1h4v1.5H2.5V5H1zM7 1h4v4H9.5V2.5H7zM1 7h1.5v2.5H5V11H1zM9.5 7H11v4H7V9.5h2.5z"/></svg></button>` +
        `</div></div>`
    );
}

const HELP = [
    "ytplayer — old-school controls for YouTube embeds marked [data-ytplayer].",
    "  play/pause · seek bar (click or drag) · time · mute · volume · captions on/off · full screen",
    "  markup: navi.mod.ytplayer.playerHtml(videoId, { width, height, title })",
    "  testkit/youtube_search mounts this park and stages players in this format.",
].join("\n");

const fmt = (s) => {
    s = Math.max(0, Math.floor(Number(s) || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = String(s % 60).padStart(2, "0");
    return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
};

export const register = (navi) => {
    const isBrowser = typeof document !== "undefined";
    /** @type {WeakMap<HTMLIFrameElement, any>} */
    const states = new WeakMap();
    const STATE_NAMES = { "-1": "unstarted", 0: "ended", 1: "playing", 2: "paused", 3: "buffering", 5: "cued" };
    let drag = null;
    let timer = null;

    const post = (frame, msg) => {
        try {
            frame.contentWindow?.postMessage(JSON.stringify(msg), "*");
        } catch {
            /* ignore */
        }
    };
    const handshake = (frame) => post(frame, { event: "listening", id: 1, channel: "widget" });
    const command = (frame, func, args = []) => post(frame, { event: "command", func, args });

    const stateOf = (frame) => {
        let st = states.get(frame);
        if (!st) {
            st = { ready: false, restored: false, shookAt: 0, time: 0, at: 0, duration: 0, loaded: 0, state: -1, muted: false, volume: 100, rate: 1, cc: null };
            states.set(frame, st);
            frame.addEventListener("load", () => {
                st.ready = false;
                st.restored = false;
                handshake(frame);
            });
        }
        return st;
    };

    const players = () => (isBrowser ? Array.from(document.querySelectorAll("[data-ytplayer]")) : []);
    const frameOf = (player) => player.querySelector("iframe[data-ytplayer-frame]");

    const nowTime = (st) =>
        st.state === 1 ? st.time + ((performance.now() - st.at) / 1000) * (st.rate || 1) : st.time;

    /** Players saved before the captions button existed get one, just before full screen. */
    function ensureCcButton(player) {
        const bar = player.querySelector("[data-ytplayer-bar]");
        if (!bar || bar.querySelector('[data-yt-act="cc"]')) return;
        const tpl = document.createElement("template");
        tpl.innerHTML = CC_BUTTON;
        bar.insertBefore(tpl.content.firstChild, bar.querySelector('[data-yt-act="full"]'));
    }

    /** YouTube loads its captions module when playback starts, so "off" is re-sent then too. */
    function applyCc(frame, on) {
        if (on) {
            command(frame, "loadModule", ["captions"]);
        } else {
            command(frame, "setOption", ["captions", "track", {}]);
            command(frame, "unloadModule", ["captions"]);
        }
    }

    function render(player) {
        const frame = frameOf(player);
        if (!frame) return;
        ensureCcButton(player);
        const st = stateOf(frame);
        const t =
            drag?.player === player && drag.kind === "seek"
                ? drag.time
                : Math.min(nowTime(st), st.duration || Infinity);
        const pct = st.duration ? Math.max(0, Math.min(100, (t / st.duration) * 100)) : 0;
        const set = (sel, prop, v) => {
            const el = player.querySelector(sel);
            if (el && el.style[prop] !== v) el.style[prop] = v;
        };
        set("[data-yt-played]", "width", pct + "%");
        set("[data-yt-knob]", "left", pct + "%");
        set("[data-yt-loaded]", "width", Math.max(0, Math.min(100, st.loaded * 100)) + "%");
        set("[data-yt-volfill]", "width", (st.muted ? 0 : st.volume) + "%");
        const timeEl = player.querySelector("[data-yt-time]");
        const text = `${fmt(t)} / ${fmt(st.duration)}`;
        if (timeEl && timeEl.textContent !== text) timeEl.textContent = text;
        // Snapshot attrs only once restored, so a reload never clobbers the saved state.
        if (!st.restored) return;
        const attr = (k, v) => {
            if (player.getAttribute(k) !== v) player.setAttribute(k, v);
        };
        attr("data-yt-state", STATE_NAMES[st.state] || "unstarted");
        attr("data-yt-muted", st.muted ? "1" : "0");
        if (st.cc != null) attr("data-yt-cc", st.cc ? "1" : "0");
        attr("data-yt-vol", String(Math.round(st.volume)));
        attr("data-yt-t", String(Math.floor(t)));
    }

    /** Tell whoever saves this element (e.g. the stage) that its state changed. */
    function dirty(player) {
        render(player);
        player.dispatchEvent(new CustomEvent("stage-dirty", { bubbles: true }));
    }

    /** First contact after a load: re-apply time/volume/mute/play state saved on the element. */
    function restore(player, frame, st) {
        st.restored = true;
        const t = Number(player.getAttribute("data-yt-t"));
        const vol = player.getAttribute("data-yt-vol");
        const muted = player.getAttribute("data-yt-muted") === "1";
        const want = player.getAttribute("data-yt-state");
        if (vol != null && Number.isFinite(Number(vol))) {
            st.volume = Number(vol);
            command(frame, "setVolume", [st.volume]);
        }
        if (muted) {
            st.muted = true;
            command(frame, "mute");
        }
        const cc = player.getAttribute("data-yt-cc");
        if (cc === "0" || cc === "1") {
            st.cc = cc === "1";
            if (!st.cc) applyCc(frame, false);
        }
        if (Number.isFinite(t) && t > 0) {
            st.time = t;
            st.at = performance.now();
            command(frame, "seekTo", [t, true]);
            // seekTo starts playback; settle back unless it was playing.
            if (want !== "playing" && want !== "buffering") command(frame, "pauseVideo");
        }
        if (want === "playing" || want === "buffering") command(frame, "playVideo");
    }

    function tick() {
        const now = performance.now();
        for (const player of players()) {
            const frame = frameOf(player);
            if (!frame) continue;
            const st = stateOf(frame);
            if (!st.ready && now - st.shookAt > 1000) {
                st.shookAt = now;
                handshake(frame);
            }
            if (st.restored && st.state === 1 && now - (st.savedAt || 0) > 10000) {
                st.savedAt = now;
                dirty(player);
            } else {
                render(player);
            }
        }
    }

    function onMessage(e) {
        if (!YT_ORIGIN.test(String(e.origin || ""))) return;
        let data = e.data;
        if (typeof data === "string") {
            try {
                data = JSON.parse(data);
            } catch {
                return;
            }
        }
        if (!data || typeof data !== "object") return;
        const player = players().find((p) => frameOf(p)?.contentWindow === e.source);
        if (!player) return;
        const frame = frameOf(player);
        const st = stateOf(frame);
        st.ready = true;
        const info = data.info;
        const prevState = st.state;
        if (data.event === "onStateChange" && typeof info === "number") {
            st.time = nowTime(st);
            st.at = performance.now();
            st.state = info;
        } else if (data.event === "infoDelivery" && info && typeof info === "object") {
            if (typeof info.currentTime === "number") {
                st.time = info.currentTime;
                st.at = performance.now();
            }
            if (typeof info.duration === "number" && info.duration > 0) st.duration = info.duration;
            if (typeof info.videoLoadedFraction === "number") st.loaded = info.videoLoadedFraction;
            if (typeof info.playerState === "number") st.state = info.playerState;
            if (typeof info.muted === "boolean") st.muted = info.muted;
            if (typeof info.volume === "number") st.volume = info.volume;
            if (typeof info.playbackRate === "number") st.rate = info.playbackRate;
        }
        if (!st.restored) {
            restore(player, frame, st);
            render(player);
            return;
        }
        if (st.cc === false && (st.state === 1 || st.state === 3) && prevState !== 1 && prevState !== 3) {
            applyCc(frame, false);
        }
        const settled = (s) => (s === 1 ? 1 : s === 2 ? 2 : s === 0 ? 0 : null);
        if (settled(st.state) != null && settled(st.state) !== settled(prevState)) dirty(player);
        else render(player);
    }

    const fraction = (track, clientX) => {
        const r = track.getBoundingClientRect();
        return r.width ? Math.max(0, Math.min(1, (clientX - r.left) / r.width)) : 0;
    };

    function setVolume(player, frac) {
        const frame = frameOf(player);
        const st = stateOf(frame);
        const v = Math.round(frac * 100);
        command(frame, "setVolume", [v]);
        st.volume = v;
        if (v > 0 && st.muted) {
            command(frame, "unMute");
            st.muted = false;
        }
        render(player);
    }

    /**
     * Full-page transparent layer while dragging: the YouTube iframe (cross-origin) would
     * otherwise swallow pointermove/pointerup once the cursor crosses it.
     */
    let shield = null;
    function raiseShield(cursor) {
        if (!shield) {
            shield = document.createElement("div");
            shield.setAttribute("data-ytplayer-shield", "");
            shield.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:transparent;touch-action:none;";
        }
        shield.style.cursor = cursor || "pointer";
        (document.body || document.documentElement).appendChild(shield);
    }
    function dropShield() {
        shield?.remove();
    }

    function dragTo(clientX, final) {
        if (!drag) return;
        const { player, track, kind, pointerId } = drag;
        const frac = fraction(track, clientX);
        const frame = frameOf(player);
        const st = stateOf(frame);
        if (final) {
            drag = null;
            dropShield();
            try {
                track.releasePointerCapture?.(pointerId);
            } catch {
                /* ignore */
            }
        }
        if (kind === "vol") {
            setVolume(player, frac);
            if (final) dirty(player);
            return;
        }
        if (!final) {
            drag.time = frac * (st.duration || 0);
            render(player);
            return;
        }
        if (!st.duration) return render(player);
        const t = frac * st.duration;
        command(frame, "seekTo", [t, true]);
        st.time = t;
        st.at = performance.now();
        dirty(player);
    }

    function onDown(e) {
        if (e.button !== 0) return;
        const act = e.target instanceof Element ? e.target.closest("[data-yt-act]") : null;
        const player = act?.closest("[data-ytplayer]");
        if (!player || !frameOf(player)) return;
        e.preventDefault();
        e.stopPropagation();
        const kind = act.getAttribute("data-yt-act");
        const frame = frameOf(player);
        const st = stateOf(frame);
        if (kind === "toggle") {
            command(frame, st.state === 1 || st.state === 3 ? "pauseVideo" : "playVideo");
        } else if (kind === "mute") {
            command(frame, st.muted ? "unMute" : "mute");
            st.muted = !st.muted;
            dirty(player);
        } else if (kind === "cc") {
            st.cc = st.cc === false;
            applyCc(frame, st.cc);
            dirty(player);
        } else if (kind === "full") {
            if (document.fullscreenElement === player) void document.exitFullscreen?.();
            else void player.requestFullscreen?.();
        } else if (kind === "seek" || kind === "vol") {
            // Capture so the release still reaches us when it lands over the YouTube iframe.
            try {
                act.setPointerCapture?.(e.pointerId);
            } catch {
                /* ignore */
            }
            drag = { player, track: act, kind, time: 0, pointerId: e.pointerId };
            raiseShield(getComputedStyle(act).cursor);
            dragTo(e.clientX, false);
        }
    }

    const onMove = (e) => {
        if (!drag) return;
        // Release we never saw (e.g. focus loss): end the drag where it is.
        if (e.buttons === 0) return dragTo(e.clientX, true);
        dragTo(e.clientX, false);
    };
    const onUp = (e) => drag && dragTo(e.clientX, true);
    const onBlur = () => {
        if (!drag) return;
        const r = drag.track.getBoundingClientRect();
        const frac = drag.kind === "vol" ? stateOf(frameOf(drag.player)).volume / 100 : 0;
        const st = stateOf(frameOf(drag.player));
        const seekFrac = st.duration ? drag.time / st.duration : 0;
        dragTo(r.left + r.width * (drag.kind === "vol" ? frac : seekFrac), true);
    };
    const swallowClick = (e) => {
        const act = e.target instanceof Element ? e.target.closest("[data-yt-act]") : null;
        if (act?.closest("[data-ytplayer]")) {
            e.preventDefault();
            e.stopPropagation();
        }
    };

    if (isBrowser) {
        if (!document.getElementById(STYLE_ID)) {
            const style = document.createElement("style");
            style.id = STYLE_ID;
            style.textContent = CSS;
            document.head.appendChild(style);
        }
        document.addEventListener("pointerdown", onDown, true);
        document.addEventListener("pointermove", onMove, true);
        document.addEventListener("pointerup", onUp, true);
        document.addEventListener("pointercancel", onUp, true);
        document.addEventListener("click", swallowClick, true);
        window.addEventListener("message", onMessage);
        window.addEventListener("blur", onBlur);
        timer = setInterval(tick, 250);
        tick();
    }

    return {
        name: "ytplayer",
        version: "0.3.0",
        description: "Old-school custom controls for [data-ytplayer] YouTube embeds",
        moduleInfo: {
            name: "ytplayer",
            version: "0.3.0",
            description: "Old-school custom controls for [data-ytplayer] YouTube embeds",
        },
        commands: {
            ytplayer: { name: "ytplayer", description: "help", execute: async () => HELP },
        },
        playerHtml,
        onUnmount: () => {
            if (!isBrowser) return;
            clearInterval(timer);
            document.removeEventListener("pointerdown", onDown, true);
            document.removeEventListener("pointermove", onMove, true);
            document.removeEventListener("pointerup", onUp, true);
            document.removeEventListener("pointercancel", onUp, true);
            document.removeEventListener("click", swallowClick, true);
            window.removeEventListener("message", onMessage);
            window.removeEventListener("blur", onBlur);
            dropShield();
            document.getElementById(STYLE_ID)?.remove();
        },
    };
};
