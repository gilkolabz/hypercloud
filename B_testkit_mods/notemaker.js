/**
 * notemaker — passthru park + recordings bay (record | live transcribe | clip STT)
 */

export const register = (navi) => {
  const NAME = "notemaker";
  const VERSION = "1.3.4";
  const KIT = "torus/testkit/notemaker";
  const NOTE_PREFIX = "navi:note:";
  /** Default border/orb — halfway white→black. */
  const DEFAULT_COLOR = { r: 128, g: 128, b: 128 };
  const WHISPER_MOD =
    "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2";

  const textKey = (name) => NOTE_PREFIX + String(name || "");
  const noteHttpPath = (name) =>
    "/navi/note/" + encodeURIComponent(String(name || ""));

  const nameFromNotePath = (raw) => {
    const s = String(raw || "").trim();
    const m = s.match(/^(?:navi[:/])?note[:/](.+)$/i);
    if (m) return decodeURIComponent(m[1]);
    if (/^\/navi\/note\//i.test(s)) {
      try {
        return decodeURIComponent(s.replace(/^\/navi\/note\//i, ""));
      } catch {
        return s.replace(/^\/navi\/note\//i, "");
      }
    }
    return s.replace(/^\/+/, "");
  };

  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

  const cssRgb = (c) =>
    `rgb(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)})`;

  const parseColor = (raw) => {
    if (!raw || typeof raw !== "object" || raw.r == null) return { ...DEFAULT_COLOR };
    return {
      r: clamp(Number(raw.r) || 0, 0, 255),
      g: clamp(Number(raw.g) || 0, 0, 255),
      b: clamp(Number(raw.b) || 0, 0, 255),
    };
  };

  const loadColor = async (name) => {
    try {
      const tip = await navi.storage.tip.get(textKey(name));
      return parseColor(tip?.data?.color);
    } catch {
      return { ...DEFAULT_COLOR };
    }
  };

  const loadKitHtml = async () => {
    try {
      const local = await navi.park.check(KIT);
      if (local && local.hit && local.body) return String(local.body);
    } catch (_) {
      /* fall through */
    }
    if (typeof navi.resolveUrl === "function" && typeof fetch === "function") {
      const res = await fetch(navi.resolveUrl(KIT));
      if (res.ok) return await res.text();
    }
    return "";
  };

  const fillKit = (html, name, color) => {
    const c = cssRgb(color);
    const noteIb = textKey(name);
    const hx = noteHttpPath(name);
    if (typeof DOMParser === "undefined") {
      return html;
    }
    const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
    const host = doc.querySelector('[data-part="htmf"]');
    if (!host) return html;
    host.style.setProperty("--nm-border", c);
    host.setAttribute("data-note", noteIb);
    const h = host.querySelector('[data-part="title"]');
    if (h) h.textContent = name;
    const orb = host.querySelector('[data-part="orb"]');
    if (orb) orb.style.background = c;
    const p = host.querySelector('[data-part="body"]');
    if (p) {
      p.setAttribute("data-note", noteIb);
      p.replaceChildren();
      const span = doc.createElement("span");
      span.setAttribute("data-part", "note");
      span.setAttribute("data-path", noteIb);
      span.setAttribute("data-note", noteIb);
      span.setAttribute("style", "display:block;white-space:normal;word-wrap:break-word;overflow-wrap:anywhere;");
      p.appendChild(span);
      span.setAttribute("hx-get", hx);
      span.setAttribute("hx-trigger", "load");
      span.setAttribute("hx-swap", "innerHTML");
    }
    const offer = host.querySelector('[data-part="mod-offer"]');
    if (offer) offer.remove();
    return host.outerHTML;
  };

  const injectHtmf = (html) => {
    if (typeof document === "undefined" || !document.body) return;
    const wrap = document.createElement("div");
    wrap.setAttribute("data-part", "notemaker-swap");
    wrap.innerHTML = html;
    document.body.appendChild(wrap);
    wrap.querySelectorAll("script").forEach((oldScript) => {
      const script = document.createElement("script");
      for (const attr of oldScript.attributes) {
        script.setAttribute(attr.name, attr.value);
      }
      script.textContent = oldScript.textContent;
      oldScript.replaceWith(script);
    });
    const htmxApi = globalThis.htmx;
    if (htmxApi && typeof htmxApi.process === "function") {
      htmxApi.process(wrap);
    }
  };

  const generate = async (name) => {
    const color = await loadColor(name);
    const kit = await loadKitHtml();
    if (!kit) {
      throw new Error("notemaker kit missing (torus/testkit/notemaker)");
    }
    return fillKit(kit, name, color);
  };

  const execute = async (...args) => {
    const name = args.map(String).join(" ").trim();
    if (!name) {
      return "notemaker — usage: notemaker <name>";
    }
    const html = await generate(name);
    injectHtmf(html);
    navi.callout("[notemaker] " + name);
    return {
      media: html,
      mime: "text/html; charset=utf-8",
    };
  };

  const abToBase64 = (buf) => {
    const bytes =
      buf instanceof ArrayBuffer
        ? new Uint8Array(buf)
        : new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  };

  const base64ToBytes = (b64) => {
    const bin = atob(String(b64 || "").replace(/\s+/g, ""));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  };

  let whisperPipe = null;
  let whisperLoading = null;

  const ensureWhisper = async (onStatus) => {
    if (whisperPipe) return whisperPipe;
    if (whisperLoading) return whisperLoading;
    whisperLoading = (async () => {
      onStatus?.("processing… (loading speech model)");
      const mod = await import(/* @vite-ignore */ WHISPER_MOD);
      const { pipeline, env } = mod;
      if (env) {
        env.allowLocalModels = false;
        env.useBrowserCache = true;
      }
      whisperPipe = await pipeline(
        "automatic-speech-recognition",
        "Xenova/whisper-tiny.en",
        {
          progress_callback: (p) => {
            if (!onStatus || !p) return;
            if (p.status === "progress" && p.progress != null) {
              onStatus(
                "processing… (" + Math.round(Number(p.progress)) + "%)"
              );
            } else if (p.status === "ready") {
              onStatus("processing…");
            }
          },
        }
      );
      return whisperPipe;
    })();
    try {
      return await whisperLoading;
    } finally {
      whisperLoading = null;
    }
  };

  /** Per-root recordings bay controller. */
  const bindRecordings = (root, hooks = {}) => {
    if (!root || root.dataset.notemakerRecBound === "1") {
      return root.__notemakerRec || null;
    }
    root.dataset.notemakerRecBound = "1";

    const getName = () =>
      typeof hooks.getName === "function" ? hooks.getName() : null;
    const appendTranscript = (t) => {
      if (typeof hooks.appendTranscript === "function") {
        hooks.appendTranscript(t);
      }
    };
    const saveNoteBody = async () => {
      if (typeof hooks.saveNoteBody === "function") {
        await hooks.saveNoteBody();
      }
    };

    const recDotEl = () => root.querySelector('[data-part="rec-dot"]');
    const recBayEl = () => root.querySelector('[data-part="rec-bay"]');
    const recPlaysEl = () => root.querySelector('[data-part="rec-plays"]');
    const recErrorEl = () => root.querySelector('[data-part="rec-error"]');
    const recMeterLineEl = () =>
      root.querySelector('[data-part="rec-meter-line"]');
    const recMeterFillEl = () =>
      root.querySelector('[data-part="rec-meter-fill"]');
    const recRecordEl = () => root.querySelector('[data-act="rec-record"]');
    const recLiveEl = () => root.querySelector('[data-act="rec-live"]');

    let noteName = getName() || null;
    let recordings = [];
    let mode = null; // null | "record" | "live"
    let starting = false;
    let mediaRecorder = null;
    let mediaStream = null;
    let recordedChunks = [];
    let recAudioCtx = null;
    let recAnalyser = null;
    let recMeterRaf = 0;
    let speechRec = null;
    let speechWanted = false;
    let speechPendingInterim = "";
    let speechRestartTimer = 0;
    let playAudio = null;
    let playUrl = null;
    let playSha = null;
    let clipBusy = false;

    const setRecError = (msg) => {
      const el = recErrorEl();
      if (!el) return;
      el.style.color = "#c62828";
      el.textContent = msg ? "error: " + String(msg) : "";
    };
    const setRecStatus = (msg) => {
      const el = recErrorEl();
      if (!el) return;
      el.style.color = "#555";
      el.textContent = msg ? String(msg) : "";
    };
    const clearRecLine = () => {
      const el = recErrorEl();
      if (!el) return;
      el.style.color = "#c62828";
      el.textContent = "";
    };

    const openRecBay = () => {
      const dot = recDotEl();
      const bay = recBayEl();
      if (dot) dot.style.display = "none";
      if (bay) bay.style.display = "block";
    };
    const closeRecBay = () => {
      const dot = recDotEl();
      const bay = recBayEl();
      if (bay) bay.style.display = "none";
      if (dot) dot.style.display = "";
    };

    const syncModeButtons = () => {
      const recBtn = recRecordEl();
      const liveBtn = recLiveEl();
      if (starting) {
        if (mode === "record" && recBtn) {
          recBtn.textContent = "starting…";
          recBtn.disabled = true;
          recBtn.style.display = "";
          if (liveBtn) liveBtn.style.display = "none";
        } else if (mode === "live" && liveBtn) {
          liveBtn.textContent = "starting…";
          liveBtn.disabled = true;
          liveBtn.style.display = "";
          if (recBtn) recBtn.style.display = "none";
        }
        return;
      }
      if (mode === "record") {
        if (recBtn) {
          recBtn.textContent = "stop";
          recBtn.disabled = false;
          recBtn.style.display = "";
        }
        if (liveBtn) liveBtn.style.display = "none";
      } else if (mode === "live") {
        if (liveBtn) {
          liveBtn.textContent = "stop";
          liveBtn.disabled = false;
          liveBtn.style.display = "";
        }
        if (recBtn) recBtn.style.display = "none";
      } else {
        if (recBtn) {
          recBtn.textContent = "record";
          recBtn.disabled = false;
          recBtn.style.display = "";
        }
        if (liveBtn) {
          liveBtn.textContent = "transcribe";
          liveBtn.disabled = false;
          liveBtn.style.display = "";
        }
      }
    };

    const syncPlayButtons = () => {
      const row = recPlaysEl();
      if (!row) return;
      [...row.querySelectorAll('[data-act="rec-play"]')].forEach((btn, i) => {
        const sha = String(btn.getAttribute("data-sha") || "");
        btn.textContent =
          playSha && playSha === sha ? "stop" : "play " + (i + 1);
      });
    };

    const rebuildPlays = () => {
      const row = recPlaysEl();
      if (!row) return;
      row.replaceChildren();
      recordings.forEach((rec, i) => {
        const wrap = document.createElement("span");
        wrap.style.display = "inline-flex";
        wrap.style.gap = "0.25rem";
        wrap.style.alignItems = "center";

        const play = document.createElement("button");
        play.type = "button";
        play.setAttribute("data-act", "rec-play");
        play.setAttribute("data-sha", String(rec.sha || ""));
        play.setAttribute("data-mime", String(rec.mime || "audio/webm"));
        const sha = String(rec.sha || "");
        play.textContent =
          playSha && playSha === sha ? "stop" : "play " + (i + 1);

        const stt = document.createElement("button");
        stt.type = "button";
        stt.setAttribute("data-act", "rec-clip-stt");
        stt.setAttribute("data-sha", String(rec.sha || ""));
        stt.setAttribute("data-mime", String(rec.mime || "audio/webm"));
        stt.textContent = "transcribe " + (i + 1);
        stt.disabled = clipBusy;

        wrap.appendChild(play);
        wrap.appendChild(stt);
        row.appendChild(wrap);
      });
      syncModeButtons();
    };

    const persistRecordings = async (name) => {
      const tip = navi.storage?.tip;
      if (!tip || typeof tip.mut8 !== "function") {
        throw new Error("navi.storage.tip.mut8 unavailable");
      }
      await tip.mut8(textKey(name), { recordings });
    };

    const loadRecordings = async (name) => {
      recordings = [];
      try {
        const tip = await navi.storage?.tip?.get(textKey(name));
        const list = tip?.data?.recordings;
        if (Array.isArray(list)) {
          recordings = list
            .filter((r) => r && r.sha)
            .map((r) => ({
              sha: String(r.sha),
              mime: String(r.mime || "audio/webm"),
              stamp: r.stamp != null ? Number(r.stamp) : Date.now(),
            }));
        }
      } catch (_) {
        /* ignore */
      }
      rebuildPlays();
    };

    const stopPlayback = () => {
      if (playAudio) {
        try {
          playAudio.pause();
        } catch (_) {
          /* ignore */
        }
        playAudio = null;
      }
      if (playUrl) {
        try {
          URL.revokeObjectURL(playUrl);
        } catch (_) {
          /* ignore */
        }
        playUrl = null;
      }
      playSha = null;
      syncPlayButtons();
    };

    const playRecording = async (sha, mime) => {
      clearRecLine();
      const want = String(sha || "");
      if (!want) {
        setRecError("missing recording id");
        return;
      }
      if (playSha === want && playAudio) {
        stopPlayback();
        return;
      }
      stopPlayback();
      try {
        const binApi = navi.storage?.bin;
        if (!binApi || typeof binApi.get !== "function") {
          throw new Error("navi.storage.bin unavailable");
        }
        const bin = await binApi.get(want);
        if (!bin || bin.media == null) throw new Error("recording not found");
        const bytes = base64ToBytes(bin.media);
        const blob = new Blob([bytes], {
          type: mime || bin.mime || "audio/webm",
        });
        playUrl = URL.createObjectURL(blob);
        playAudio = new Audio(playUrl);
        playSha = want;
        syncPlayButtons();
        playAudio.addEventListener(
          "ended",
          () => {
            playSha = null;
            playAudio = null;
            if (playUrl) {
              try {
                URL.revokeObjectURL(playUrl);
              } catch (_) {
                /* ignore */
              }
              playUrl = null;
            }
            syncPlayButtons();
          },
          { once: true }
        );
        await playAudio.play();
      } catch (err) {
        stopPlayback();
        setRecError(err?.message || String(err));
      }
    };

    const flushSpeechInterim = () => {
      if (!speechPendingInterim) return;
      appendTranscript(speechPendingInterim);
      speechPendingInterim = "";
    };

    const stopSpeech = () => {
      speechWanted = false;
      if (speechRestartTimer) {
        clearTimeout(speechRestartTimer);
        speechRestartTimer = 0;
      }
      flushSpeechInterim();
      if (speechRec) {
        try {
          speechRec.onend = null;
          speechRec.onerror = null;
          speechRec.onresult = null;
          speechRec.stop();
        } catch (_) {
          /* ignore */
        }
      }
      speechRec = null;
    };

    const startSpeech = () => {
      const SR =
        globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
      if (!SR) {
        setRecError("speech recognition not available in this browser");
        return false;
      }
      if (speechRestartTimer) {
        clearTimeout(speechRestartTimer);
        speechRestartTimer = 0;
      }
      if (speechRec) {
        try {
          speechRec.onend = null;
          speechRec.onerror = null;
          speechRec.onresult = null;
          speechRec.stop();
        } catch (_) {
          /* ignore */
        }
        speechRec = null;
      }
      speechWanted = true;
      const rec = new SR();
      speechRec = rec;
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = (navigator.language || "en-US").toString();
      rec.onresult = (ev) => {
        let interim = "";
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const r = ev.results[i];
          const t = String(r[0]?.transcript || "");
          if (!t) continue;
          const conf = Number(r[0]?.confidence);
          const drafty =
            !r.isFinal || (Number.isFinite(conf) && conf === 0);
          if (drafty) interim += t;
          else {
            speechPendingInterim = "";
            appendTranscript(t);
          }
        }
        if (interim) {
          speechPendingInterim = interim.trim();
          setRecStatus("transcribing… " + speechPendingInterim);
        } else {
          speechPendingInterim = "";
          setRecStatus("transcribing…");
        }
      };
      rec.onerror = (ev) => {
        if (!speechWanted) return;
        const code = String(ev?.error || "speech recognition failed");
        if (code === "no-speech" || code === "aborted") {
          setRecStatus("transcribing… (waiting for speech)");
          return;
        }
        setRecError("transcription: " + code);
      };
      rec.onend = () => {
        if (!speechWanted || mode !== "live") return;
        flushSpeechInterim();
        setRecStatus("transcribing…");
        speechRestartTimer = setTimeout(() => {
          speechRestartTimer = 0;
          if (!speechWanted || mode !== "live") return;
          try {
            startSpeech();
          } catch (_) {
            /* ignore */
          }
        }, 150);
      };
      try {
        rec.start();
        setRecStatus("transcribing…");
        return true;
      } catch (err) {
        setRecError("transcription: " + (err?.message || String(err)));
        return false;
      }
    };

    const stopMeter = () => {
      if (recMeterRaf) {
        cancelAnimationFrame(recMeterRaf);
        recMeterRaf = 0;
      }
      const line = recMeterLineEl();
      const fill = recMeterFillEl();
      if (line) line.style.display = "none";
      if (fill) fill.style.width = "0%";
      if (recAudioCtx) {
        try {
          recAudioCtx.close();
        } catch (_) {
          /* ignore */
        }
      }
      recAudioCtx = null;
      recAnalyser = null;
    };

    const startMeter = (stream) => {
      stopMeter();
      const line = recMeterLineEl();
      const fill = recMeterFillEl();
      if (line) line.style.display = "block";
      try {
        const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!Ctx) return;
        recAudioCtx = new Ctx();
        const source = recAudioCtx.createMediaStreamSource(stream);
        recAnalyser = recAudioCtx.createAnalyser();
        recAnalyser.fftSize = 2048;
        source.connect(recAnalyser);
        const data = new Uint8Array(recAnalyser.fftSize);
        const tick = () => {
          if (!recAnalyser || mode !== "record") return;
          recAnalyser.getByteTimeDomainData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) {
            const v = (data[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / data.length);
          const pct = Math.min(100, Math.round(rms * 160));
          if (fill) fill.style.width = pct + "%";
          recMeterRaf = requestAnimationFrame(tick);
        };
        recMeterRaf = requestAnimationFrame(tick);
      } catch (_) {
        /* meter is best-effort */
      }
    };

    const releaseStream = () => {
      if (mediaStream) {
        try {
          mediaStream.getTracks().forEach((t) => t.stop());
        } catch (_) {
          /* ignore */
        }
      }
      mediaStream = null;
    };

    const finishRecordingBlob = async (blob) => {
      const name = noteName || getName();
      if (!name) {
        setRecError("save a note title first");
        return;
      }
      try {
        const buf = await blob.arrayBuffer();
        const b64 = abToBase64(buf);
        const mime = blob.type || "audio/webm";
        const binApi = navi.storage?.bin;
        if (!binApi || typeof binApi.putMedia !== "function") {
          throw new Error("navi.storage.bin.putMedia unavailable");
        }
        const sha = await binApi.putMedia({ media: b64, mime });
        recordings = recordings.concat([{ sha, mime, stamp: Date.now() }]);
        await persistRecordings(name);
        setRecStatus("recorded.");
        rebuildPlays();
      } catch (err) {
        setRecError(err?.message || String(err));
      }
    };

    const stopActive = async () => {
      const was = mode;
      starting = false;
      mode = null;
      stopSpeech();
      stopMeter();
      const mr = mediaRecorder;
      mediaRecorder = null;
      if (mr && mr.state !== "inactive") {
        try {
          mr.stop();
        } catch (_) {
          /* ignore */
        }
      } else {
        releaseStream();
      }
      syncModeButtons();
      if (was === "live") {
        try {
          await saveNoteBody();
        } catch (_) {
          /* ignore */
        }
        setRecStatus("transcribed.");
      } else if (was === "record") {
        try {
          await saveNoteBody();
        } catch (_) {
          /* ignore */
        }
      }
    };

    const startRecord = async () => {
      if (mode || starting || clipBusy) return;
      clearRecLine();
      const name = noteName || getName();
      if (!name) {
        setRecError("save a note title first");
        return;
      }
      noteName = name;
      if (typeof MediaRecorder === "undefined") {
        setRecError("MediaRecorder not available in this browser");
        return;
      }
      mode = "record";
      starting = true;
      syncModeButtons();
      openRecBay();
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        mediaStream = stream;
        let mime = "";
        if (
          typeof MediaRecorder.isTypeSupported === "function" &&
          MediaRecorder.isTypeSupported("audio/webm")
        ) {
          mime = "audio/webm";
        }
        const mr = mime
          ? new MediaRecorder(stream, { mimeType: mime })
          : new MediaRecorder(stream);
        mediaRecorder = mr;
        recordedChunks = [];
        mr.ondataavailable = (ev) => {
          if (ev.data && ev.data.size) recordedChunks.push(ev.data);
        };
        mr.onerror = (ev) => {
          setRecError(ev?.error?.message || "MediaRecorder error");
          void stopActive();
        };
        mr.onstop = () => {
          const type =
            mr.mimeType || mime || recordedChunks[0]?.type || "audio/webm";
          const blob = new Blob(recordedChunks, { type });
          recordedChunks = [];
          releaseStream();
          void finishRecordingBlob(blob);
          syncModeButtons();
        };
        mr.start();
        starting = false;
        startMeter(stream);
        setRecStatus("recording…");
        syncModeButtons();
      } catch (err) {
        starting = false;
        mode = null;
        releaseStream();
        stopMeter();
        syncModeButtons();
        setRecError(err?.message || String(err));
      }
    };

    const startLive = async () => {
      if (mode || starting || clipBusy) return;
      clearRecLine();
      const name = noteName || getName();
      if (!name) {
        setRecError("save a note title first");
        return;
      }
      noteName = name;
      if (
        !(globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition)
      ) {
        setRecError("speech recognition not available in this browser");
        return;
      }
      mode = "live";
      starting = true;
      syncModeButtons();
      openRecBay();
      starting = false;
      if (!startSpeech()) {
        mode = null;
        syncModeButtons();
        return;
      }
      syncModeButtons();
    };

    const blobFromSha = async (sha, mime) => {
      const binApi = navi.storage?.bin;
      if (!binApi || typeof binApi.get !== "function") {
        throw new Error("navi.storage.bin unavailable");
      }
      const bin = await binApi.get(sha);
      if (!bin || bin.media == null) throw new Error("recording not found");
      const bytes = base64ToBytes(bin.media);
      return new Blob([bytes], { type: mime || bin.mime || "audio/webm" });
    };

    const transcribeClip = async (sha, mime) => {
      if (clipBusy || mode || starting) {
        setRecError("finish the current record/transcribe first");
        return;
      }
      const want = String(sha || "");
      if (!want) {
        setRecError("missing recording id");
        return;
      }
      clipBusy = true;
      rebuildPlays();
      clearRecLine();
      setRecStatus("processing…");
      try {
        const blob = await blobFromSha(want, mime);
        const pipe = await ensureWhisper(setRecStatus);
        setRecStatus("processing…");
        const url = URL.createObjectURL(blob);
        let out;
        try {
          out = await pipe(url);
        } finally {
          try {
            URL.revokeObjectURL(url);
          } catch (_) {
            /* ignore */
          }
        }
        const text = String(
          typeof out === "string" ? out : out?.text || ""
        ).trim();
        if (!text) {
          setRecError("no speech detected in recording");
          return;
        }
        appendTranscript(text);
        try {
          await saveNoteBody();
        } catch (_) {
          /* ignore */
        }
        setRecStatus("transcribed.");
      } catch (err) {
        const msg = err?.message || String(err);
        setRecError(
          /Failed to fetch|import|NetworkError|CSP|blocked/i.test(msg)
            ? "clip transcription needs network once to load the on-device speech model"
            : msg
        );
      } finally {
        clipBusy = false;
        rebuildPlays();
      }
    };

    const onClick = (e) => {
      const openBtn =
        e.target.closest?.('[data-act="rec-open"]') ||
        e.target.closest?.('[data-part="rec-dot"]');
      if (openBtn && root.contains(openBtn)) {
        e.preventDefault();
        openRecBay();
        return;
      }
      const btn = e.target.closest?.("[data-act]");
      if (!btn || !root.contains(btn)) return;
      const act = btn.getAttribute("data-act");
      if (act === "rec-close") {
        e.preventDefault();
        closeRecBay();
        return;
      }
      if (act === "rec-record") {
        e.preventDefault();
        if (mode === "record") void stopActive();
        else void startRecord();
        return;
      }
      if (act === "rec-live") {
        e.preventDefault();
        if (mode === "live") void stopActive();
        else void startLive();
        return;
      }
      if (act === "rec-play") {
        e.preventDefault();
        void playRecording(
          btn.getAttribute("data-sha") || "",
          btn.getAttribute("data-mime") || "audio/webm"
        );
        return;
      }
      if (act === "rec-clip-stt") {
        e.preventDefault();
        void transcribeClip(
          btn.getAttribute("data-sha") || "",
          btn.getAttribute("data-mime") || "audio/webm"
        );
      }
    };

    root.addEventListener("click", onClick);

    const api = {
      setName: (name) => {
        noteName = name || null;
        if (noteName) void loadRecordings(noteName);
        else {
          recordings = [];
          rebuildPlays();
        }
      },
      reload: () => {
        const n = noteName || getName();
        if (n) void loadRecordings(n);
      },
      unbind: () => {
        void stopActive();
        stopPlayback();
        root.removeEventListener("click", onClick);
        delete root.dataset.notemakerRecBound;
        delete root.__notemakerRec;
      },
    };
    root.__notemakerRec = api;
    if (noteName) void loadRecordings(noteName);
    else rebuildPlays();
    return api;
  };

  const hasType = (context, name) => {
    const types = Array.isArray(context?.types) ? context.types : [];
    return types.includes(name) || context?.kind === name;
  };

  const notePathFromContext = (context) => {
    const el = context?.element;
    let path = String(
      context?.path ||
        context?.dataPath ||
        context?.mediaPath ||
        context?.presentation?.path ||
        ""
    ).trim();
    if (!path && el && typeof el.getAttribute === "function") {
      path = String(
        el.getAttribute("data-path") || el.getAttribute("data-note") || ""
      ).trim();
    }
    if (
      !path &&
      context?.hostElement &&
      typeof context.hostElement.getAttribute === "function"
    ) {
      path = String(
        context.hostElement.getAttribute("data-path") ||
          context.hostElement.getAttribute("data-note") ||
          ""
      ).trim();
    }
    return path;
  };

  const buildNoteClaim = () => ({
    id: "notemaker",
    direction: 1,
    types: ["note"],
    color: "#ffb347",
    describe: () => ({
      text: "notemaker",
      color: "#ffb347",
      textShadow: "0 1px 2px #4a2800, 0 0 2px #000, 0 0 1px #000",
    }),
    matches: (context) => {
      if (!hasType(context, "note")) return false;
      return !!nameFromNotePath(notePathFromContext(context));
    },
    async execute(context) {
      const path = notePathFromContext(context);
      const name = nameFromNotePath(path);
      if (!name) throw new Error("notemaker claim needs data-path / note name");
      const html = await generate(name);
      if (!html) throw new Error("notemaker produced no html for " + name);
      const noteIb = textKey(name);
      if (typeof navi.callout === "function") {
        navi.callout("[notemaker] → " + name);
      }
      return {
        types: ["offstage-member", "htmf", "note"],
        kind: "offstage-member",
        label: "notemaker " + name,
        part: "htmf",
        type: "htmf",
        value: html,
        html,
        path: noteIb,
        presentation: { type: "htmf", value: html },
        occupant: { type: "htmf", value: html, path: noteIb },
      };
    },
  });

  /** Present only when stagejockey is mounted (discovered live by scrollbuffer). */
  const getScrollbufferPlugin = () => {
    const sj =
      navi?.mod?.supermouse_plugin_stagejockey || navi?.mod?.stagejockey;
    if (!sj) return null;
    return {
      id: "notemaker",
      name: "notemaker",
      claims: [buildNoteClaim()],
    };
  };

  return {
    name: NAME,
    version: VERSION,
    description:
      "Passthru park + recordings bay; +1 note claim → offstage htmf for jockey-move",
    moduleInfo: {
      name: NAME,
      version: VERSION,
      description:
        "Passthru park + recordings bay; +1 note claim → offstage htmf for jockey-move",
    },
    bindRecordings,
    get scrollbufferPlugin() {
      return getScrollbufferPlugin();
    },
    commands: {
      notemaker: {
        name: "notemaker",
        description: "notemaker <name>",
        execute,
      },
    },
  };
};
