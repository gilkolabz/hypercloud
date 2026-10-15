/**
 * hostparkinator_5000 — ibgib-native Foobarch alternative (localnavi module).
 *
 * Proposals → route tips (park + http controls). Commit-frame PUT only.
 * SQLite beside navi_shell.exe. Default bind localhost:5353.
 *
 * Callin:
 *   hostparkinator_5000 start [port] | stop | status | status size | help
 *   hostparkinator_5000 host [localhost|0.0.0.0|127.0.0.1]
 *   hostparkinator_5000 db [path]              SQLite file (default: <exeDir>/hostparkinator_5000.sqlite)
 *   hostparkinator_5000 static [dir]
 *   hostparkinator_5000 password | password set <pwd>
 *   hostparkinator_5000 mint [count]           mint set: shared 16-hex lead + 48 unique (64 each)
 *   hostparkinator_5000 list | tip <ib> | reindex
 *   hostparkinator_5000 seed [staticDir]       seed navi_shell.js / sw.js from static dir
 *   hostparkinator_5000 seed schemas           seed foobarch.schema.keys.v1 Lua write gate
 *   hostparkinator_5000 admin delete <ib>
 *   hostparkinator_5000 remount_host [route] | remount_host path [route]
 *
 * HTTP:
 *   GET  WS /_foobarch/navi_shell?uuid=[&token=]   reverse-channel register (shell: relay connect → navi.origin; token optional)
 *        first frame: hello { owner, pay } — owner secret pinned per uuid on first connect; pay = one usage
 *        token spent per connection (tokens.used_addr = relay-connect:<uuid>); reply welcome { ok }
 *   GET|POST /{navi_shell park}/{remainder}      HTTP callin relay → 202 {job_id} (poll job); X-Navi-Shell-Wait:1 holds until result
 *   GET  /_foobarch/navi_shell/job/{uuid}/{id}   peek running or claim done body (then dump)
 *   GET  /{navi_shell park}/_job/{id}            same claim under the park
 *   *    /{ib}[…]                  park tip data.method[METHOD] → bin|proxy|redirect|commit|tombstone
 *   PUT|PATCH /{ib} (miss)         firstGen commit envelope + usage payment; if an ancestor tip has
 *                                  rel8ns.genesis_policy, its schema's authorize_genesis() must allow
 *   POST /foobarch/tokens          mint { tokens } (password)
 *   GET  /foobarch/list | tip | frame | span
 *   *    /foobarch/admin/*         usage-password gated
 *
 * Mutation payment (commit/tombstone kinds, any HTTP verb): X-Foobarch-Usage-Token
 * else data.foobarch.tokens (self, drop head) else foobarch.token_reserve (2 tokens).
 */

export const register = (navi) => {
    const isBrowser =
        typeof window !== "undefined" && typeof window.document !== "undefined";
    const isNode =
        typeof process !== "undefined" &&
        !!(process.versions && process.versions.node);

    const eventListeners = [];
    const createdElements = [];
    const addedStyles = [];
    const observers = [];
    const timers = [];

    const DEFAULT_PORT = 5353;
    const DEFAULT_HOST = "localhost";
    const DEFAULT_STATIC = "static";
    const DEFAULT_USAGE_PASSWORD =
        (typeof process !== "undefined" && process.env && process.env.FOOBARCH_USAGE_PASSWORD) || "";
    const USAGE_TOKEN_HEADER = "X-Foobarch-Usage-Token";
    const USAGE_PASSWORD_HEADER = "X-Foobarch-Usage-Password";
    const WRITE_SIGN_PREFIX = "proposal-write-v1";

    const DEFAULT_REMOUNT_PATH = "torus/native/hostparkinator_5000";

    const STORAGE = {
        port: "hostparkinator_5000.port",
        host: "hostparkinator_5000.host",
        staticDir: "hostparkinator_5000.static_dir",
        dbPath: "hostparkinator_5000.db_path",
        remountPath: "hostparkinator_5000.remount_host",
    };
    /** Pre-rename keys (module was foobarch_host ≤0.3.22); read-only fallback. */
    const LEGACY_STORAGE = {
        port: "foobarch_host.port",
        host: "foobarch_host.host",
        staticDir: "foobarch_host.static_dir",
        dbPath: "foobarch_host.db_path",
    };
    const DB_FILE = "hostparkinator_5000.sqlite";
    const LEGACY_DB_FILE = "foobarch_host.sqlite";

    const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    const NAVI_SHELL_TOKEN_HEADER = "X-Navi-Shell-Usage-Token";
    const NAVI_SHELL_WAIT_HEADER = "X-Navi-Shell-Wait";
    const NAVI_SHELL_MAX_INFLIGHT = 16;
    /** A relay socket must send its paid hello within this window or it is closed. */
    const NAVI_SHELL_HELLO_MS = 15000;
    /** Max time a sync-wait (X-Navi-Shell-Wait) callin may run before 504. */
    const NAVI_SHELL_JOB_MS = (() => {
        const v = Number(process.env.FOOBARCH_NAVI_SHELL_JOB_MS);
        return Number.isFinite(v) && v > 0 ? v : 600000;
    })();
    /** After result is ready, drop unclaimed jobs (avoid ballooning). */
    const NAVI_SHELL_JOB_DONE_TTL_MS = (() => {
        const v = Number(process.env.FOOBARCH_NAVI_SHELL_JOB_DONE_TTL_MS);
        return Number.isFinite(v) && v > 0 ? v : 60000;
    })();
    /** Skip (do not close the socket) navi_shell WS payloads above this. */
    const NAVI_SHELL_WS_MAX_PAYLOAD = (() => {
        const v = Number(process.env.FOOBARCH_NAVI_SHELL_WS_MAX_MB);
        return (Number.isFinite(v) && v > 0 ? v : 128) * 1024 * 1024;
    })();

    function naviShellWantWait(headers) {
        const raw = (() => {
            if (!headers || typeof headers !== "object") return "";
            for (const [k, v] of Object.entries(headers)) {
                if (String(k).toLowerCase() === NAVI_SHELL_WAIT_HEADER.toLowerCase()) {
                    return Array.isArray(v) ? String(v[0] || "") : String(v || "");
                }
            }
            return "";
        })();
        const s = raw.trim().toLowerCase();
        return s === "1" || s === "true" || s === "yes" || s === "wait";
    }

    function formatNaviShellResult(result, extra) {
        if (!result || result.ok === false) {
            const status = Number(result?.status) || 502;
            if (result?.media != null && String(result.media).length) {
                return {
                    status,
                    body: String(result.media),
                    type:
                        result.mime ||
                        "application/json; charset=utf-8",
                };
            }
            return {
                status,
                body: JSON.stringify({
                    error: result?.error || "navi_shell callin failed",
                    ...extra,
                    via: "navi_shell",
                }),
                type: "application/json; charset=utf-8",
            };
        }
        const media = result.media != null ? String(result.media) : "";
        const mime = result.mime || "text/plain; charset=utf-8";
        return { status: 200, body: media, type: mime };
    }

    // Keep in sync with navi_shell/src/navi_redux_seeds.ts (delimiter race + gate).

    const normalizeParkIb = (ib) =>
        String(ib || "")
            .trim()
            .replace(/^\/+/, "");

    const pct20ToSpace = (s) => String(s || "").replace(/%20/gi, " ");

    const tokenizeParkIb = (ib) => {
        const s = normalizeParkIb(pct20ToSpace(ib));
        const segments = [];
        const gaps = [];
        let buf = "";
        let i = 0;
        const pushSeg = () => {
            if (!buf) return;
            segments.push(buf);
            buf = "";
        };
        while (i < s.length) {
            if (s.startsWith("//", i)) {
                pushSeg();
                if (segments.length) gaps.push("//");
                i += 2;
                continue;
            }
            const c = s[i];
            if (c === ":" || c === "/" || /\s/.test(c)) {
                pushSeg();
                if (!segments.length) {
                    i += 1;
                    continue;
                }
                if (/\s/.test(c)) {
                    while (i < s.length && /\s/.test(s[i]) && !s.startsWith("//", i)) {
                        i += 1;
                    }
                    gaps.push(" ");
                } else {
                    gaps.push(c);
                    i += 1;
                }
                continue;
            }
            buf += c;
            i += 1;
        }
        pushSeg();
        while (gaps.length >= segments.length) gaps.pop();
        return { segments, gaps };
    };

    const joinParkIb = (segments, gaps) => {
        if (!segments.length) return "";
        let out = segments[0];
        const n = Math.min(gaps.length, segments.length - 1);
        for (let i = 0; i < n; i++) out += gaps[i] + segments[i + 1];
        for (let i = n + 1; i < segments.length; i++) out += " " + segments[i];
        return out;
    };

    /**
     * Resolve-set claim: only `park: "capture" | "defer"`.
     * Boolean / precedence / capture flags are not read — migrate tips first.
     */
    const isParkClaimed = (data) => {
        if (typeof data?.park !== "string") return false;
        const s = data.park.trim().toLowerCase();
        return s === "capture" || s === "defer";
    };

    /** Capture vs defer — string claim only. */
    const isParkCaptureData = (data) => {
        if (typeof data?.park !== "string") return false;
        return data.park.trim().toLowerCase() === "capture";
    };

    /** Index depth from ib segments. */
    const parkDepthForIndex = (ib) => {
        const segs = tokenizeParkIb(ib).segments.length;
        return segs > 0 ? segs : 1;
    };

    const delimiterRaceSignature = (ib) => {
        const raw = normalizeParkIb(pct20ToSpace(ib));
        if (!raw) return "";
        if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return "abs:" + raw;
        const { segments, gaps } = tokenizeParkIb(raw);
        const marks = [];
        for (let i = 0; i < segments.length - 1; i++) {
            marks.push((gaps[i] || " ") === "//" ? "//" : "*");
        }
        return segments.join("\0") + "\n" + marks.join("\0");
    };

    const liveDelimiterHits = (want, live) => {
        const sig = delimiterRaceSignature(want);
        if (!sig) return [];
        const raw = normalizeParkIb(pct20ToSpace(want));
        const hits = (live || []).filter(
            (ib) => delimiterRaceSignature(ib) === sig
        );
        if (raw && hits.includes(raw)) {
            return [raw, ...hits.filter((h) => h !== raw)];
        }
        return hits;
    };

    const isTipGateTrue = (data) =>
        !!(data && typeof data === "object" && data.gate === true);

    const isGatePassthruHeader = (value) => {
        const s = String(value ?? "")
            .trim()
            .toLowerCase();
        return s === "1" || s === "true" || s === "yes";
    };

    const wsAccept = (key) => {
        const crypto = nodeRequire("crypto");
        return crypto
            .createHash("sha1")
            .update(String(key || "") + WS_GUID)
            .digest("base64");
    };

    const wsEncodeText = (text) => {
        const payload = Buffer.from(String(text ?? ""), "utf8");
        const len = payload.length;
        let header;
        if (len < 126) {
            header = Buffer.alloc(2);
            header[0] = 0x81;
            header[1] = len;
        } else if (len < 65536) {
            header = Buffer.alloc(4);
            header[0] = 0x81;
            header[1] = 126;
            header.writeUInt16BE(len, 2);
        } else {
            header = Buffer.alloc(10);
            header[0] = 0x81;
            header[1] = 127;
            header.writeUInt32BE(0, 2);
            header.writeUInt32BE(len, 6);
        }
        return Buffer.concat([header, payload]);
    };

    const wsEncodePong = (payload) => {
        const p = Buffer.isBuffer(payload) ? payload : Buffer.alloc(0);
        const header = Buffer.alloc(2);
        header[0] = 0x8a;
        header[1] = p.length < 126 ? p.length : 0;
        if (p.length >= 126) return Buffer.concat([Buffer.from([0x8a, 0]), p.slice(0, 0)]);
        return Buffer.concat([header, p]);
    };

    const wsEncodeClose = () => Buffer.from([0x88, 0x00]);

    /** Parse one or more complete WS frames from buf. Returns { msgs, rest, ping, closed }. */
    // Browsers split messages over ~64KB into continuation frames (FIN=0, then
    // opcode 0); `frag` carries the partial message across socket chunks.
    const wsDecode = (buf, frag = { parts: null, size: 0 }) => {
        const msgs = [];
        const pings = [];
        let closed = false;
        let offset = 0;
        while (buf.length - offset >= 2) {
            const b0 = buf[offset];
            const b1 = buf[offset + 1];
            const fin = (b0 & 0x80) !== 0;
            const opcode = b0 & 0x0f;
            const masked = (b1 & 0x80) !== 0;
            let len = b1 & 0x7f;
            let hdr = 2;
            if (len === 126) {
                if (buf.length - offset < 4) break;
                len = buf.readUInt16BE(offset + 2);
                hdr = 4;
            } else if (len === 127) {
                if (buf.length - offset < 10) break;
                const hi = buf.readUInt32BE(offset + 2);
                const lo = buf.readUInt32BE(offset + 6);
                hdr = 10;
                // Oversize closes the socket so held callins fail fast instead of hanging.
                if (hi !== 0 || lo > NAVI_SHELL_WS_MAX_PAYLOAD) {
                    closed = true;
                    break;
                }
                len = lo;
            }
            const maskLen = masked ? 4 : 0;
            if (buf.length - offset < hdr + maskLen + len) break;
            let payload = buf.slice(offset + hdr + maskLen, offset + hdr + maskLen + len);
            if (masked) {
                const mask = buf.slice(offset + hdr, offset + hdr + 4);
                const out = Buffer.alloc(payload.length);
                for (let i = 0; i < payload.length; i++) out[i] = payload[i] ^ mask[i % 4];
                payload = out;
            }
            offset += hdr + maskLen + len;
            if (opcode === 0x8) {
                closed = true;
                break;
            }
            if (opcode === 0x9) {
                pings.push(payload);
                continue;
            }
            if (opcode === 0xa) continue;
            if (opcode === 0x1 || opcode === 0x2) {
                if (fin) {
                    frag.parts = null;
                    frag.size = 0;
                    msgs.push(payload.toString("utf8"));
                } else {
                    frag.parts = [payload];
                    frag.size = payload.length;
                }
                continue;
            }
            if (opcode === 0x0 && frag.parts) {
                frag.size += payload.length;
                if (frag.size > NAVI_SHELL_WS_MAX_PAYLOAD) {
                    closed = true;
                    break;
                }
                frag.parts.push(payload);
                if (fin) {
                    msgs.push(Buffer.concat(frag.parts).toString("utf8"));
                    frag.parts = null;
                    frag.size = 0;
                }
            }
        }
        return { msgs, pings, closed, rest: buf.slice(offset) };
    };

    const nodeRequire = (id) => navi.require(id);

    function log(...args) {
        console.log("[hostparkinator_5000]", ...args);
    }
    function warn(...args) {
        console.warn("[hostparkinator_5000]", ...args);
    }

    const ensureNative = () => {
        if (isBrowser || !isNode) {
            throw new Error("[hostparkinator_5000] native (Node / navi_shell.exe) only");
        }
    };

    const randomHex = (n) => {
        const crypto = nodeRequire("crypto");
        return crypto.randomBytes(n).toString("hex");
    };

    const sha256Hex = (buf) => {
        const crypto = nodeRequire("crypto");
        return crypto.createHash("sha256").update(buf).digest("hex");
    };
    const sha256HexSync = (s) => sha256Hex(Buffer.from(String(s), "utf8"));
    const relaySecretEqual = (a, b) => {
        const x = Buffer.from(String(a), "utf8");
        const y = Buffer.from(String(b), "utf8");
        return x.length === y.length && nodeRequire("crypto").timingSafeEqual(x, y);
    };

    const formatBytes = (n) => {
        const b = Math.max(0, Number(n) || 0);
        if (b < 1024) return `${b} B`;
        if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
        if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
        return `${(b / 1024 ** 3).toFixed(2)} GB`;
    };

    const sqliteFileSizes = (dbPath) => {
        const fs = nodeRequire("fs");
        const files = [];
        let total = 0;
        const kinds = [
            { kind: "sqlite", path: dbPath },
            { kind: "wal", path: `${dbPath}-wal` },
            { kind: "shm", path: `${dbPath}-shm` },
            { kind: "journal", path: `${dbPath}-journal` },
        ];
        for (const k of kinds) {
            let bytes = 0;
            let exists = false;
            try {
                const st = fs.statSync(k.path);
                if (st.isFile()) {
                    exists = true;
                    bytes = Number(st.size) || 0;
                    total += bytes;
                }
            } catch {
                /* missing sidecar */
            }
            files.push({
                kind: k.kind,
                path: k.path,
                exists,
                bytes,
                size: formatBytes(bytes),
            });
        }
        return { files, total, size: formatBytes(total) };
    };

    const defaultDbPath = () => {
        const path = nodeRequire("path");
        const exe = process.execPath || process.argv?.[0] || ".";
        const dir = path.dirname(exe);
        const next = path.join(dir, DB_FILE);
        const legacy = path.join(dir, LEGACY_DB_FILE);
        const fs = nodeRequire("fs");
        if (!fs.existsSync(next) && fs.existsSync(legacy)) return legacy;
        return next;
    };

    // ─── SQLite store (inlined for single-file mount) ───────────────────────

    const SCHEMA = `
CREATE TABLE IF NOT EXISTS frames (
  addr TEXT PRIMARY KEY NOT NULL,
  ib TEXT NOT NULL,
  gib TEXT NOT NULL,
  json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tips (
  ib TEXT PRIMARY KEY NOT NULL,
  addr TEXT NOT NULL,
  tombstone INTEGER NOT NULL DEFAULT 0,
  park INTEGER NOT NULL DEFAULT 0,
  park_depth INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS versions (
  ib TEXT NOT NULL,
  addr TEXT NOT NULL,
  n INTEGER,
  PRIMARY KEY (ib, addr)
);
CREATE TABLE IF NOT EXISTS bin (
  sha256 TEXT PRIMARY KEY NOT NULL,
  bytes BLOB NOT NULL,
  content_type TEXT
);
CREATE TABLE IF NOT EXISTS park_index (
  root TEXT NOT NULL,
  ib TEXT NOT NULL,
  park_depth INTEGER NOT NULL DEFAULT 1,
  addr TEXT NOT NULL,
  PRIMARY KEY (root, ib)
);
CREATE TABLE IF NOT EXISTS tokens (
  token TEXT PRIMARY KEY NOT NULL,
  used_addr TEXT
);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_park_root ON park_index(root);
CREATE INDEX IF NOT EXISTS idx_frames_ib ON frames(ib);
`;

    function wrapDb(raw) {
        return {
            exec(sql) {
                raw.exec(sql);
            },
            prepare(sql) {
                const stmt = raw.prepare(sql);
                return {
                    get(...params) {
                        return stmt.get(...params);
                    },
                    all(...params) {
                        return stmt.all(...params);
                    },
                    run(...params) {
                        const info = stmt.run(...params);
                        return { changes: Number(info?.changes ?? 0) };
                    },
                };
            },
        };
    }

    function openStore(dbPath) {
        const { DatabaseSync } = nodeRequire("node:sqlite");
        const fs = nodeRequire("fs");
        const path = nodeRequire("path");
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });
        const raw = new DatabaseSync(dbPath);
        const db = wrapDb(raw);
        db.exec(SCHEMA);

        const stmts = {
            putFrame: db.prepare(
                `INSERT OR REPLACE INTO frames(addr, ib, gib, json) VALUES(?, ?, ?, ?)`
            ),
            getFrame: db.prepare(`SELECT json FROM frames WHERE addr = ?`),
            putTip: db.prepare(
                `INSERT OR REPLACE INTO tips(ib, addr, tombstone, park, park_depth) VALUES(?, ?, ?, ?, ?)`
            ),
            getTip: db.prepare(
                `SELECT ib, addr, tombstone, park, park_depth FROM tips WHERE ib = ?`
            ),
            delTip: db.prepare(`DELETE FROM tips WHERE ib = ?`),
            listTips: db.prepare(
                `SELECT ib, addr, tombstone, park, park_depth FROM tips ORDER BY ib LIMIT ? OFFSET ?`
            ),
            listTipIbs: db.prepare(
                `SELECT ib FROM tips WHERE tombstone = 0 ORDER BY ib`
            ),
            putVersion: db.prepare(
                `INSERT OR IGNORE INTO versions(ib, addr, n) VALUES(?, ?, ?)`
            ),
            delVersions: db.prepare(`DELETE FROM versions WHERE ib = ?`),
            versionsNewest: db.prepare(
                `SELECT addr FROM versions WHERE ib = ? ORDER BY rowid DESC LIMIT ?`
            ),
            putBin: db.prepare(
                `INSERT OR REPLACE INTO bin(sha256, bytes, content_type) VALUES(?, ?, ?)`
            ),
            getBin: db.prepare(
                `SELECT bytes, content_type FROM bin WHERE sha256 = ?`
            ),
            putPark: db.prepare(
                `INSERT OR REPLACE INTO park_index(root, ib, park_depth, addr) VALUES(?, ?, ?, ?)`
            ),
            delParkIb: db.prepare(`DELETE FROM park_index WHERE ib = ?`),
            parksForRoot: db.prepare(
                `SELECT root, ib, park_depth, addr FROM park_index WHERE root = ?`
            ),
            reindexClear: db.prepare(`DELETE FROM park_index`),
            putToken: db.prepare(
                `INSERT OR IGNORE INTO tokens(token, used_addr) VALUES(?, NULL)`
            ),
            getToken: db.prepare(
                `SELECT token, used_addr FROM tokens WHERE token = ?`
            ),
            useToken: db.prepare(
                `UPDATE tokens SET used_addr = ? WHERE token = ? AND used_addr IS NULL`
            ),
            getMeta: db.prepare(`SELECT value FROM meta WHERE key = ?`),
            setMeta: db.prepare(
                `INSERT OR REPLACE INTO meta(key, value) VALUES(?, ?)`
            ),
            delFramesForIb: db.prepare(`DELETE FROM frames WHERE ib = ?`),
            frameAddrsForIb: db.prepare(`SELECT addr FROM frames WHERE ib = ?`),
            delFrame: db.prepare(`DELETE FROM frames WHERE addr = ?`),
            delVersionAddr: db.prepare(`DELETE FROM versions WHERE addr = ?`),
            delTokensUsedBy: db.prepare(`DELETE FROM tokens WHERE used_addr = ?`),
            delBin: db.prepare(`DELETE FROM bin WHERE lower(sha256) = lower(?)`),
            sumFrames: db.prepare(
                `SELECT IFNULL(SUM(LENGTH(json)), 0) AS bytes FROM frames`
            ),
            sumBin: db.prepare(
                `SELECT IFNULL(SUM(LENGTH(bytes)), 0) AS bytes FROM bin`
            ),
        };

        const getMeta = (key, fallback = null) => {
            const row = stmts.getMeta.get(key);
            return row ? String(row.value) : fallback;
        };
        const setMeta = (key, value) => stmts.setMeta.run(key, String(value));

        const putFrame = (ibGib) => {
            if (!ibGib || ibGib.ib == null || ibGib.gib == null) {
                throw new Error("putFrame requires ibGib with ib+gib");
            }
            const addr = `${ibGib.ib}^${ibGib.gib}`;
            stmts.putFrame.run(
                addr,
                String(ibGib.ib),
                String(ibGib.gib),
                JSON.stringify(ibGib)
            );
            return addr;
        };

        const getFrame = (addr) => {
            const row = stmts.getFrame.get(String(addr || "").trim());
            if (!row?.json) return null;
            try {
                return JSON.parse(row.json);
            } catch {
                return null;
            }
        };

        const putBin = (sha256, bytes, contentType) => {
            const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
            stmts.putBin.run(
                String(sha256),
                buf,
                contentType || "application/octet-stream"
            );
            return sha256;
        };

        const getBin = (sha256) => {
            const row = stmts.getBin.get(String(sha256 || "").trim());
            if (!row) return null;
            return {
                bytes: Buffer.from(row.bytes),
                content_type: row.content_type || "application/octet-stream",
            };
        };

        const rootOf = (ib) => {
            const segs = tokenizeParkIb(ib).segments;
            return segs[0] || "";
        };

        const assertParkGate = (ib, frame) => {
            if (!isTipGateTrue(frame?.data)) return;
            const want = String(ib || "").trim();
            const live = stmts.listTipIbs.all().map((r) => r.ib);
            for (const key of liveDelimiterHits(want, live)) {
                if (key === want) continue;
                const other = getTip(key);
                if (
                    other &&
                    !other.tombstone &&
                    isTipGateTrue(other.frame?.data)
                ) {
                    throw new Error(
                        `cannot gate '${want}': race set already has gate frame '${other.ib}'. Mut8 that park to gate=false (or omit gate) first.`
                    );
                }
            }
        };

        const setTip = (ib, addr, { tombstone = false } = {}) => {
            const frame = getFrame(addr);
            const park = isParkClaimed(frame?.data);
            const parkDepth = park ? parkDepthForIndex(ib) : 0;
            const n = Number(frame?.data?.n);
            stmts.putTip.run(
                ib,
                addr,
                tombstone ? 1 : 0,
                park ? 1 : 0,
                park ? parkDepth : 0
            );
            stmts.putVersion.run(ib, addr, Number.isFinite(n) ? n : null);
            stmts.delParkIb.run(ib);
            if (park && !tombstone) {
                const root = rootOf(ib);
                if (root) stmts.putPark.run(root, ib, parkDepth, addr);
            }
            return { ib, addr, park, parkDepth };
        };

        const getTip = (ib) => {
            const row = stmts.getTip.get(String(ib || "").trim());
            if (!row) return null;
            return {
                ib: row.ib,
                addr: row.addr,
                tombstone: !!row.tombstone,
                park: !!row.park,
                park_depth: Number(row.park_depth) || 0,
                frame: getFrame(row.addr),
            };
        };

        /** Past chain newest-first; `max` stops after that many hits. */
        const walkLineage = (ib, max) => {
            const want = String(ib || "").trim();
            if (!want) return [];
            const cap =
                max != null && Number.isFinite(Number(max))
                    ? Math.max(0, Math.floor(Number(max)))
                    : Infinity;
            if (cap === 0) return [];
            const tip = getTip(want);
            if (!tip?.frame) return [];
            const hits = [];
            const seen = new Set();
            let frame = tip.frame;
            let tipIb = String(frame.ib || want).trim();
            while (frame && hits.length < cap) {
                const gib = String(frame.gib || "").trim();
                if (!gib) break;
                const addr = `${tipIb}^${gib}`;
                if (seen.has(addr)) break;
                seen.add(addr);
                hits.push({
                    addr,
                    ib: tipIb,
                    gib,
                    n: Number(frame.data?.n) || hits.length,
                    frame,
                });
                if (hits.length >= cap) break;
                const past0 = Array.isArray(frame.rel8ns?.past)
                    ? String(frame.rel8ns.past[0] || "").trim()
                    : "";
                if (!past0) break;
                frame = getFrame(past0);
                tipIb = String(frame?.ib || tipIb).trim();
            }
            return hits;
        };

        /**
         * Newest frame ever committed to `ib` (any chain, by commit order) whose data has every
         * `where` path equal to its value, e.g. { "about.branch": "stage" }.
         */
        const latestVersionWhere = (ib, where, scanCap = 2000) => {
            const want = String(ib || "").trim();
            const conds = Object.entries(where || {});
            if (!want || !conds.length) return null;
            const valueAt = (obj, path) => {
                let cur = obj;
                for (const seg of String(path).split(".")) {
                    if (cur == null || typeof cur !== "object") return undefined;
                    cur = cur[seg];
                }
                return cur;
            };
            const rows = stmts.versionsNewest.all(want, scanCap);
            for (const row of rows) {
                const frame = getFrame(row.addr);
                if (!frame) continue;
                const ok = conds.every(([path, value]) => {
                    const v = valueAt(frame.data, path);
                    return v != null && typeof v !== "object" && String(v) === String(value);
                });
                if (ok) return { ib: want, addr: row.addr, frame };
            }
            return null;
        };

        const parksForRoot = (root) =>
            stmts.parksForRoot.all(String(root || "").trim()).map((r) => ({
                root: r.root,
                ib: r.ib,
                park_depth: Number(r.park_depth) || 1,
                addr: r.addr,
            }));

        const reindexParks = () => {
            stmts.reindexClear.run();
            let n = 0;
            for (const t of stmts.listTips.all(100000, 0)) {
                if (t.tombstone) continue;
                const frame = getFrame(t.addr);
                if (!isParkClaimed(frame?.data)) continue;
                const root = rootOf(t.ib);
                if (!root) continue;
                const parkDepth = parkDepthForIndex(t.ib);
                stmts.putPark.run(root, t.ib, parkDepth, t.addr);
                n++;
            }
            return n;
        };

        const hardDeleteIb = (ib) => {
            const tip = getTip(ib);
            for (const row of stmts.frameAddrsForIb.all(ib)) {
                stmts.delTokensUsedBy.run(row.addr);
            }
            stmts.delParkIb.run(ib);
            stmts.delVersions.run(ib);
            stmts.delTip.run(ib);
            stmts.delFramesForIb.run(ib);
            return { ib, hadTip: !!tip };
        };

        /**
         * Admin purge of one frame: row, version entry, and the usage token that paid for it.
         * If it is its ib's tip, the tip rewinds to rel8ns.past[0] (or the ib is dropped).
         */
        const purgeFrame = (addr) => {
            const a = String(addr || "").trim();
            const frame = getFrame(a);
            const ib = String(frame?.ib ?? a.split("^")[0]).trim();
            const tip = getTip(ib);
            let rewoundTo = null;
            let tipDeleted = false;
            if (tip && tip.addr === a) {
                const past = Array.isArray(frame?.rel8ns?.past)
                    ? String(frame.rel8ns.past[0] || "").trim()
                    : "";
                if (past && getFrame(past)) {
                    setTip(ib, past, { tombstone: !!getFrame(past)?.data?.tombstone });
                    rewoundTo = past;
                } else {
                    stmts.delParkIb.run(ib);
                    stmts.delVersions.run(ib);
                    stmts.delTip.run(ib);
                    tipDeleted = true;
                }
            }
            stmts.delFrame.run(a);
            stmts.delVersionAddr.run(a);
            stmts.delTokensUsedBy.run(a);
            return { addr: a, hadFrame: !!frame, rewoundTo, tipDeleted };
        };

        const purgeBin = (sha256) => ({
            sha256: String(sha256 || "").trim().toLowerCase(),
            deleted: stmts.delBin.run(String(sha256 || "").trim()).changes,
        });

        /**
         * Mint a set: shared 16-hex lead once, then 48-hex unique suffix each
         * → 64-char tokens. Same lead ⇒ same mint batch (read it off tokens[0].slice(0,16)).
         * @returns {string[]}
         */
        const mintTokens = (count) => {
            const n = Math.min(100, Math.max(1, Number(count) || 1));
            const lead = randomHex(8); // 8 bytes → 16 hex
            const out = [];
            for (let i = 0; i < n; i++) {
                const t = lead + randomHex(24); // 24 bytes → 48 hex
                stmts.putToken.run(t);
                out.push(t);
            }
            return out;
        };

        const probeToken = (token) => {
            const row = stmts.getToken.get(String(token || "").trim());
            if (!row) return { ok: false, status: 401, error: "invalid usage token" };
            if (row.used_addr) {
                return {
                    ok: false,
                    status: 403,
                    error: "usage token already consumed",
                };
            }
            return { ok: true, token: row.token };
        };

        const consumeToken = (token, addr) => {
            const probe = probeToken(token);
            if (!probe.ok) return probe;
            const r = stmts.useToken.run(String(addr || "ok"), probe.token);
            if (!r.changes) {
                return {
                    ok: false,
                    status: 403,
                    error: "usage token already consumed",
                };
            }
            return { ok: true };
        };

        const persistTransform = (envelope) => {
            const head = envelope?.newIbGib;
            if (!head) throw new Error("commit envelope missing newIbGib");
            assertParkGate(String(head.ib), head);
            const all = [];
            if (Array.isArray(envelope.intermediateIbGibs)) {
                all.push(...envelope.intermediateIbGibs);
            }
            if (Array.isArray(envelope.dnas)) all.push(...envelope.dnas);
            all.push(head);
            const addrs = [];
            for (const frame of all) {
                if (frame?.ib != null && frame?.gib != null) {
                    addrs.push(putFrame(frame));
                }
            }
            if (envelope.bin?.sha256 && envelope.bin?.bytes_b64) {
                putBin(
                    envelope.bin.sha256,
                    Buffer.from(envelope.bin.bytes_b64, "base64"),
                    envelope.bin.content_type || "application/octet-stream"
                );
            }
            // Optional multi-bin: array or { sha → bin } map (ua_get secondary slots).
            const extraBins = Array.isArray(envelope.bins)
                ? envelope.bins
                : envelope.bins && typeof envelope.bins === "object"
                  ? Object.values(envelope.bins)
                  : [];
            for (const b of extraBins) {
                if (!b?.sha256 || !b?.bytes_b64) continue;
                if (
                    envelope.bin?.sha256 &&
                    String(b.sha256) === String(envelope.bin.sha256)
                ) {
                    continue;
                }
                putBin(
                    b.sha256,
                    Buffer.from(b.bytes_b64, "base64"),
                    b.content_type || "application/octet-stream"
                );
            }
            const addr = `${head.ib}^${head.gib}`;
            setTip(String(head.ib), addr, {
                tombstone: !!head?.data?.tombstone,
            });
            return { addr, addrs, head };
        };

        if (!getMeta("usage_password")) {
            setMeta("usage_password", DEFAULT_USAGE_PASSWORD);
        }
        if (getMeta("park_index_root") !== "token") {
            reindexParks();
            setMeta("park_index_root", "token");
        }

        return {
            dbPath,
            putFrame,
            getFrame,
            putBin,
            getBin,
            setTip,
            getTip,
            walkLineage,
            latestVersionWhere,
            parksForRoot,
            reindexParks,
            hardDeleteIb,
            purgeFrame,
            purgeBin,
            mintTokens,
            probeToken,
            consumeToken,
            persistTransform,
            getMeta,
            setMeta,
            listTips: (limit = 200, offset = 0) =>
                stmts.listTips.all(limit, offset).map((r) => ({
                    ib: r.ib,
                    addr: r.addr,
                    tombstone: !!r.tombstone,
                    park: !!r.park,
                    park_depth: Number(r.park_depth) || 0,
                })),
            listTipIbs: () => stmts.listTipIbs.all().map((r) => String(r.ib || "")),
            payloadSizes: () => {
                const frames = Number(stmts.sumFrames.get()?.bytes ?? 0);
                const bin = Number(stmts.sumBin.get()?.bytes ?? 0);
                return {
                    frames: { bytes: frames, size: formatBytes(frames) },
                    bin: { bytes: bin, size: formatBytes(bin) },
                };
            },
            close: () => {
                try {
                    raw.close();
                } catch {
                    /* ignore */
                }
            },
        };
    }

    function normalizeSpanDir(raw) {
        const d = String(raw || "").trim().toLowerCase();
        if (d === "forward" || d === "all") return d;
        return "reverse";
    }

    function orderSpanHits(chain, opts = {}) {
        const dir = normalizeSpanDir(opts.dir);
        const offset = Math.max(0, Math.floor(Number(opts.offset) || 0));
        const ordered = dir === "reverse" ? chain : chain.slice().reverse();
        const limitRaw = opts.limit;
        if (limitRaw != null && Number.isFinite(Number(limitRaw))) {
            return ordered.slice(
                offset,
                offset + Math.max(0, Math.floor(Number(limitRaw)))
            );
        }
        if (offset > 0) return ordered.slice(offset);
        return ordered;
    }

    // ─── Write gates: schema tip (Lua) → policy tip → content tip ───────────
    // tip.rel8ns.policy → policy frame → rel8ns.schema | data.schema_ib → Lua
    // authorize(). Stock schema ib: foobarch.schema.keys.v1 (fengari VM).
    // Fail closed if policy has no resolvable Lua schema (no embedded JS keys gate).

    const SCHEMA_KEYS_IB = "foobarch.schema.keys.v1";
    const SCHEMA_CONTENT_TYPE = "text/x-lua";
    const SCHEMA_FETCH_BUDGET = 64;
    const SCHEMA_TIMEOUT_MS = (() => {
        const v = Number(process.env.FOOBARCH_SCHEMA_TIMEOUT_MS);
        return Number.isFinite(v) && v > 0 ? v : 2000;
    })();
    const LUA_TIMEOUT_MS = (() => {
        const v = Number(process.env.FOOBARCH_LUA_TIMEOUT_MS);
        return Number.isFinite(v) && v > 0 ? v : 5000;
    })();
    const PARK_REQUEST_TIMEOUT_MS = (() => {
        const v = Number(process.env.FOOBARCH_PARK_REQUEST_TIMEOUT_MS);
        return Number.isFinite(v) && v > 0 ? v : 8000;
    })();
    const LUA_PARK_HOPS = 8;
    const READ_SIGN_PREFIX = "proposal-read-v1";

    /** Pure-Lua JSON (Flowerpot-compatible). Lua has no native JSON. */
    const JSON_DECODE_LUA = `
do
  local function skip_ws(s, i)
    return (s:find("[^ \\t\\r\\n]", i)) or (#s + 1)
  end
  local function fail(msg, i)
    error("json_decode: " .. msg .. " at " .. i, 0)
  end
  local escapes = { ['"']='"', ["\\\\"]="\\\\", ["/"]="/", b="\\b", f="\\f", n="\\n", r="\\r", t="\\t" }
  local function decode_string(s, i)
    i = i + 1
    local out = {}
    while true do
      local c = s:sub(i, i)
      if c == "" then fail("unterminated string", i) end
      if c == '"' then return table.concat(out), i + 1 end
      if c == "\\\\" then
        local e = s:sub(i + 1, i + 1)
        if e == "u" then
          local code = tonumber(s:sub(i + 2, i + 5), 16)
          if not code then fail("bad unicode escape", i) end
          out[#out + 1] = utf8.char(code)
          i = i + 6
        elseif escapes[e] then
          out[#out + 1] = escapes[e]
          i = i + 2
        else
          fail("bad escape", i)
        end
      else
        out[#out + 1] = c
        i = i + 1
      end
    end
  end
  local function decode_number(s, i)
    local j = s:find("[^-+0-9eE.]", i) or (#s + 1)
    local n = tonumber(s:sub(i, j - 1))
    if n == nil then fail("bad number", i) end
    return n, j
  end
  local decode_value
  decode_value = function(s, i)
    i = skip_ws(s, i)
    local c = s:sub(i, i)
    if c == "" then fail("unexpected end", i) end
    if c == '"' then return decode_string(s, i) end
    if c == "{" then
      local obj = {}
      i = skip_ws(s, i + 1)
      if s:sub(i, i) == "}" then return obj, i + 1 end
      while true do
        i = skip_ws(s, i)
        if s:sub(i, i) ~= '"' then fail("expected key", i) end
        local k
        k, i = decode_string(s, i)
        i = skip_ws(s, i)
        if s:sub(i, i) ~= ":" then fail("expected ':'", i) end
        local v
        v, i = decode_value(s, i + 1)
        obj[k] = v
        i = skip_ws(s, i)
        local d = s:sub(i, i)
        if d == "," then i = i + 1
        elseif d == "}" then return obj, i + 1
        else fail("expected ',' or '}'", i) end
      end
    end
    if c == "[" then
      local arr = {}
      i = skip_ws(s, i + 1)
      if s:sub(i, i) == "]" then return arr, i + 1 end
      local n = 0
      while true do
        local v
        v, i = decode_value(s, i)
        n = n + 1
        arr[n] = v
        i = skip_ws(s, i)
        local d = s:sub(i, i)
        if d == "," then i = i + 1
        elseif d == "]" then return arr, i + 1
        else fail("expected ',' or ']'", i) end
      end
    end
    if s:sub(i, i + 3) == "true" then return true, i + 4 end
    if s:sub(i, i + 4) == "false" then return false, i + 5 end
    if s:sub(i, i + 3) == "null" then return nil, i + 4 end
    return decode_number(s, i)
  end
  json_decode = function(s)
    if type(s) ~= "string" then return nil, "json_decode: expected string" end
    local ok, value = pcall(decode_value, s, 1)
    if not ok then return nil, value end
    return value
  end
  pcall(function()
    if flowerpot then flowerpot.json_decode = json_decode end
    if foobarch then foobarch.json_decode = json_decode end
  end)
end
`;

    const readMessage = ({ ib, timestamp = "" }) =>
        [READ_SIGN_PREFIX, ib || "", timestamp === undefined || timestamp === null ? "" : String(timestamp)].join(
            "\n"
        );

    /** Sync HTTP via child Node (Lua host cannot await on the same thread). */
    const syncHttpFetch = (url, { method = "GET", headers = {}, body = null, timeoutMs }) => {
        const fs = nodeRequire("fs");
        const path = nodeRequire("path");
        const os = nodeRequire("os");
        const { spawnSync } = nodeRequire("child_process");
        const tmp = path.join(os.tmpdir(), `foobarch_park_${randomHex(8)}.mjs`);
        const payload = {
            url: String(url),
            method: String(method || "GET").toUpperCase(),
            headers: headers && typeof headers === "object" ? headers : {},
            body_b64: body ? Buffer.from(body).toString("base64") : "",
        };
        const script =
            `const p = ${JSON.stringify(payload)};\n` +
            "const body = p.body_b64 ? Buffer.from(p.body_b64, 'base64') : undefined;\n" +
            "const res = await fetch(p.url, { method: p.method, headers: p.headers, body });\n" +
            "const buf = Buffer.from(await res.arrayBuffer());\n" +
            "const hdrs = {};\n" +
            "res.headers.forEach((v, k) => { hdrs[k] = v; });\n" +
            "process.stdout.write(JSON.stringify({\n" +
            "  status: res.status,\n" +
            "  type: res.headers.get('content-type') || 'application/octet-stream',\n" +
            "  headers: hdrs,\n" +
            "  body_b64: buf.toString('base64'),\n" +
            "}));\n";
        fs.writeFileSync(tmp, script, "utf8");
        try {
            const r = spawnSync(process.execPath, [tmp], {
                encoding: "buffer",
                timeout: timeoutMs || PARK_REQUEST_TIMEOUT_MS,
                maxBuffer: 12 * 1024 * 1024,
                windowsHide: true,
            });
            if (r.error) throw r.error;
            if (r.status !== 0) {
                const err =
                    (r.stderr && r.stderr.toString("utf8")) || `status ${r.status}`;
                throw new Error(`park_request http failed: ${err.slice(0, 300)}`);
            }
            return JSON.parse(r.stdout.toString("utf8"));
        } finally {
            try {
                fs.unlinkSync(tmp);
            } catch {
                /* ignore */
            }
        }
    };
    /** Stock keys gate — keep in sync with hostparkinator_5000/schemas/keys_v1.lua */
    const KEYS_V1_LUA = `-- foobarch.schema.keys.v1
-- m-of-n ed25519 write authorization (client-generated keys).
-- Policy instance data: { threshold = n, keys = { "x1", "x2", ... } }
-- ctx is provided by foobarch_host; flowerpot.* / foobarch.* are host builtins.

function authorize()
  local keys = ctx.policy.keys
  local threshold = ctx.policy.threshold
  if type(keys) ~= "table" or #keys < 1 then
    return { allow = false, aside_ok = true, error = "policy.keys required" }
  end
  if type(threshold) ~= "number" or threshold < 1 then
    threshold = #keys
  end
  if threshold > #keys then
    return { allow = false, aside_ok = false, error = "invalid threshold" }
  end

  local sign_keys = ctx.sign_keys or {}
  local signatures = ctx.signatures or {}
  local used = {}
  local valid = 0
  local n = math.min(#sign_keys, #signatures)
  local verify = (foobarch and foobarch.verify_ed25519)
    or (flowerpot and flowerpot.verify_ed25519)

  for i = 1, n do
    local pub = sign_keys[i]
    local sig = signatures[i]
    if pub and sig and not used[pub] then
      local listed = false
      for _, k in ipairs(keys) do
        if k == pub then
          listed = true
          break
        end
      end
      if listed and verify(pub, ctx.message, sig) then
        used[pub] = true
        valid = valid + 1
      end
    end
  end

  if valid >= threshold then
    return { allow = true }
  end
  return {
    allow = false,
    aside_ok = true,
    error = "keys threshold not met",
    valid = valid,
    threshold = threshold,
  }
end
`;

    const writeMessage = ({ ib, parentAddr = "", body, contentType }) => {
        const buf = Buffer.isBuffer(body) ? body : Buffer.from(body ?? []);
        const contentSha256 = sha256Hex(buf);
        return [
            WRITE_SIGN_PREFIX,
            ib,
            parentAddr || "",
            contentSha256,
            contentType || "application/octet-stream",
        ].join("\n");
    };

    const verifyEd25519 = (publicKeyX, message, signatureB64url) => {
        const crypto = nodeRequire("crypto");
        try {
            const key = crypto.createPublicKey({
                key: { kty: "OKP", crv: "Ed25519", x: publicKeyX },
                format: "jwk",
            });
            return crypto.verify(
                null,
                Buffer.from(message, "utf8"),
                key,
                Buffer.from(signatureB64url, "base64url")
            );
        } catch {
            return false;
        }
    };

    const parseHeaderList = (raw) => {
        if (!raw) return [];
        const s = String(raw).trim();
        if (!s) return [];
        if (s.startsWith("[")) {
            try {
                const arr = JSON.parse(s);
                return Array.isArray(arr) ? arr.map(String) : [];
            } catch {
                /* fall through */
            }
        }
        return s.split(/[,\s]+/).filter(Boolean);
    };

    const policyAddrOf = (frame) => {
        const pol = frame?.rel8ns?.policy;
        return Array.isArray(pol) && pol.length ? String(pol[pol.length - 1]) : "";
    };

    /**
     * firstGen gate: nearest live ancestor tip (by "/" segments) whose
     * rel8ns.genesis_policy names a policy. Its schema's authorize_genesis()
     * decides every first write (and tombstone reclaim) under that prefix.
     */
    const genesisGateFor = (store, ib) => {
        const segs = String(ib || "").split("/");
        for (let i = segs.length - 1; i >= 1; i--) {
            const prefix = segs.slice(0, i).join("/");
            const tip = store.getTip(prefix);
            if (!tip || tip.tombstone) continue;
            const pol = tip.frame?.rel8ns?.genesis_policy;
            if (Array.isArray(pol) && pol.length) {
                return { governor: prefix, policyAddr: String(pol[pol.length - 1]) };
            }
        }
        return null;
    };

    const readPayloadJson = (store, addr) => {
        const frame = store.getFrame(addr);
        if (!frame) return null;
        const binAddr = frame.rel8ns?.bin?.[0];
        if (binAddr) {
            const sha = String(binAddr).replace(/^bin\s+/i, "");
            const blob = store.getBin(sha);
            if (blob) {
                try {
                    return JSON.parse(blob.bytes.toString("utf8"));
                } catch {
                    /* fall through */
                }
            }
        }
        return frame.data && typeof frame.data === "object" ? { ...frame.data } : {};
    };

    const readPayloadText = (store, addr) => {
        const frame = store.getFrame(addr);
        if (!frame) return "";
        const binAddr = frame.rel8ns?.bin?.[0];
        if (binAddr) {
            const sha = String(binAddr).replace(/^bin\s+/i, "");
            const blob = store.getBin(sha);
            if (blob) return blob.bytes.toString("utf8");
        }
        if (typeof frame.data?.source === "string") return frame.data.source;
        if (typeof frame.data?.lua === "string") return frame.data.lua;
        return "";
    };

    /**
     * Which rel8ns.bin entry a method control serves.
     *   ctrl.select { "<first remainder segment>": index | "bin <sha>" } + ctrl.default
     *   ctrl.bin    index | "bin <sha>" (fixed)
     *   else        rel8ns.bin[0]
     * Only refs already listed in rel8ns.bin are servable.
     */
    const selectBinRef = (frame, ctrl, remainder) => {
        const bins = Array.isArray(frame?.rel8ns?.bin) ? frame.rel8ns.bin.map(String) : [];
        if (!bins.length) return { ref: "", status: 404, error: "bin control requires rel8ns.bin" };
        const shaOf = (s) => String(s || "").replace(/^bin\s+/i, "").trim().toLowerCase();
        const pick = (v) => {
            if (v == null || v === "") return "";
            if (typeof v === "number" || /^\d+$/.test(String(v).trim())) {
                return bins[Number(v)] || "";
            }
            const want = shaOf(v);
            return bins.find((b) => shaOf(b) === want) || "";
        };
        const seg = String(remainder || "").replace(/^\/+/, "").split("/")[0] || "";
        let key = seg;
        try {
            key = decodeURIComponent(seg);
        } catch {
            /* keep */
        }
        let chosen;
        if (ctrl?.select && typeof ctrl.select === "object") {
            if (key && Object.prototype.hasOwnProperty.call(ctrl.select, key)) {
                chosen = ctrl.select[key];
            } else if (ctrl.default != null) {
                chosen = ctrl.default;
            } else {
                return {
                    ref: "",
                    status: 404,
                    error: key ? `no bin case '${key}'` : "bin case required",
                };
            }
        } else if (ctrl?.bin != null) {
            chosen = ctrl.bin;
        } else {
            return { ref: bins[0], sha: shaOf(bins[0]) };
        }
        const ref = pick(chosen);
        if (!ref) {
            return {
                ref: "",
                status: 404,
                error: `bin selection '${chosen}' is not in rel8ns.bin`,
            };
        }
        return { ref, sha: shaOf(ref), key };
    };

    const resolveRefToAddr = (store, ref) => {
        const s = String(ref || "").trim();
        if (!s) return "";
        if (s.includes("^")) {
            return store.getFrame(s) ? s : "";
        }
        const tip = store.getTip(s);
        if (!tip || tip.tombstone) return "";
        return tip.addr || "";
    };

    const loadPolicyBundle = (store, policyAddr) => {
        const addr = resolveRefToAddr(store, policyAddr) || String(policyAddr || "");
        const frame = store.getFrame(addr);
        if (!frame) {
            return {
                policyAddr: addr,
                policy: null,
                schemaRef: "",
                schemaAddr: "",
                luaSource: "",
            };
        }
        const policy = readPayloadJson(store, addr) || frame.data || {};
        const schRel = frame.rel8ns?.schema;
        let schemaRef =
            (Array.isArray(schRel) && schRel.length
                ? String(schRel[schRel.length - 1])
                : "") ||
            (typeof policy.schema === "string" ? policy.schema : "") ||
            (typeof frame.data?.schema_ib === "string" ? frame.data.schema_ib : "") ||
            (typeof frame.data?.schema === "string" ? frame.data.schema : "");
        if (!schemaRef) {
            return {
                policyAddr: addr,
                policy,
                schemaRef: "",
                schemaAddr: "",
                luaSource: "",
            };
        }
        const schemaAddr = resolveRefToAddr(store, schemaRef);
        const luaSource = schemaAddr ? readPayloadText(store, schemaAddr) : "";
        return { policyAddr: addr, policy, schemaRef, schemaAddr, luaSource };
    };

    /** True when tip has a write policy linked (gated), regardless of schema/keys. */
    const isWriteGated = (frame) => !!policyAddrOf(frame);

    // ─── Fengari Lua schema VM ───────────────────────────────────────────────

    let _fengari = null;
    let _fengariTried = false;
    let _fengariPath = "";

    /** Same root as navi_shell Node storage: %APPDATA%\.navi_shell on Windows. */
    const naviShellDir = () => {
        const path = nodeRequire("path");
        const os = nodeRequire("os");
        if (process.platform === "win32") {
            const roaming =
                process.env.APPDATA ||
                path.join(os.homedir(), "AppData", "Roaming");
            return path.join(roaming, ".navi_shell");
        }
        return path.join(os.homedir(), ".navi_shell");
    };

    const fengariAppDataPath = () => {
        const path = nodeRequire("path");
        return path.join(naviShellDir(), "hostparkinator_5000", "vendor", "fengari");
    };

    const fengariCandidates = () => {
        const path = nodeRequire("path");
        const fs = nodeRequire("fs");
        const exe = process.execPath || process.argv?.[0] || ".";
        const exeDir = path.dirname(exe);
        const envPath = String(process.env.FOOBARCH_FENGARI || "").trim();
        const out = [];
        const add = (p) => {
            if (p && !out.includes(p)) out.push(p);
        };
        if (envPath) add(envPath);
        add(fengariAppDataPath());
        add(path.join(naviShellDir(), "foobarch_host", "vendor", "fengari"));
        // Reuse fusion's vendored copy if already installed.
        add(path.join(naviShellDir(), "spacebarz_fusion", "vendor", "fengari"));
        add(path.join(exeDir, "vendor", "fengari"));
        add(path.join(exeDir, "B_native_mods", "vendor", "fengari"));
        add(path.join(process.cwd(), "B_native_mods", "vendor", "fengari"));
        add(path.join(process.cwd(), "vendor", "fengari"));
        // Walk up from cwd / exeDir looking for the repo mirror.
        for (const start of [process.cwd(), exeDir]) {
            let dir = start;
            for (let i = 0; i < 8; i++) {
                add(path.join(dir, "B_native_mods", "vendor", "fengari"));
                add(path.join(dir, "vendor", "fengari"));
                const parent = path.dirname(dir);
                if (parent === dir) break;
                dir = parent;
            }
        }
        return out.filter((dest) => {
            try {
                return fs.existsSync(path.join(dest, "src", "fengari.js"));
            } catch {
                return false;
            }
        });
    };

    const tryLoadFengariAt = (dest) => {
        const path = nodeRequire("path");
        const Module = nodeRequire("module");
        const entry = path.join(dest, "src", "fengari.js");
        const req = Module.createRequire(path.join(dest, "package.json"));
        return req(entry);
    };

    /**
     * Ensure fengari is loadable — prefer AppData copy (works after remount_host
     * when cwd is not the repo). Seeds from repo mirror / FOOBARCH_FENGARI when needed.
     */
    const ensureFengariVendor = () => {
        const fs = nodeRequire("fs");
        const path = nodeRequire("path");
        const dest = fengariAppDataPath();
        const entry = path.join(dest, "src", "fengari.js");
        const hasMods = fs.existsSync(path.join(dest, "node_modules"));
        if (fs.existsSync(entry) && hasMods) {
            return { ok: true, path: dest, installed: false };
        }

        // Prefer an already-complete candidate (repo or fusion appdata).
        let src = null;
        for (const c of fengariCandidates()) {
            if (
                c !== dest &&
                fs.existsSync(path.join(c, "src", "fengari.js")) &&
                fs.existsSync(path.join(c, "node_modules"))
            ) {
                src = c;
                break;
            }
        }
        if (!src) {
            for (const c of fengariCandidates()) {
                if (c !== dest && fs.existsSync(path.join(c, "src", "fengari.js"))) {
                    src = c;
                    break;
                }
            }
        }
        if (!src) {
            return {
                ok: false,
                path: dest,
                error:
                    "fengari not found — set FOOBARCH_FENGARI, copy B_native_mods/vendor/fengari into AppData, or run hostparkinator_5000 from the hypercloud repo once",
            };
        }
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.cpSync(src, dest, { recursive: true });
        if (!fs.existsSync(path.join(dest, "node_modules"))) {
            const { spawnSync } = nodeRequire("child_process");
            const r = spawnSync(
                process.platform === "win32" ? "npm.cmd" : "npm",
                ["install", "--omit=dev", "--no-package-lock"],
                { cwd: dest, encoding: "utf8" }
            );
            if (r.status !== 0) {
                return {
                    ok: false,
                    path: dest,
                    error: `npm install in ${dest} failed: ${(r.stderr || r.stdout || "").slice(0, 300)}`,
                };
            }
        }
        return { ok: true, path: dest, installed: true, from: src };
    };

    const loadFengari = () => {
        if (_fengari) return _fengari;
        if (_fengariTried) return null;
        _fengariTried = true;

        const tryList = () => {
            const list = fengariCandidates();
            // Always try AppData dest last after ensure.
            const dest = fengariAppDataPath();
            if (!list.includes(dest)) list.push(dest);
            for (const candidate of list) {
                try {
                    _fengari = tryLoadFengariAt(candidate);
                    _fengariPath = candidate;
                    log("fengari", candidate);
                    return _fengari;
                } catch (err) {
                    warn("fengari load failed", candidate, err?.message || err);
                }
            }
            return null;
        };

        if (tryList()) return _fengari;

        // Seed AppData from repo / fusion copy, then retry once.
        const ensured = ensureFengariVendor();
        if (!ensured.ok) {
            warn(
                "fengari not found — schema Lua gates unavailable:",
                ensured.error ||
                    "copy B_native_mods/vendor/fengari beside navi_shell or run hostparkinator_5000 vendor"
            );
            return null;
        }
        if (ensured.installed) log("fengari vendor installed", ensured.path, "from", ensured.from);
        try {
            _fengari = tryLoadFengariAt(ensured.path);
            _fengariPath = ensured.path;
            log("fengari", ensured.path);
            return _fengari;
        } catch (err) {
            warn("fengari load failed after vendor", ensured.path, err?.message || err);
            return null;
        }
    };

    /** Force re-resolve (e.g. after hostparkinator_5000 vendor). */
    const resetFengari = () => {
        _fengari = null;
        _fengariTried = false;
        _fengariPath = "";
    };

    const goToLua = (fengari, L, v) => {
        const { lua, to_luastring } = fengari;
        if (v === null || v === undefined) {
            lua.lua_pushnil(L);
            return;
        }
        if (typeof v === "boolean") {
            lua.lua_pushboolean(L, v);
            return;
        }
        if (typeof v === "number") {
            lua.lua_pushnumber(L, v);
            return;
        }
        if (typeof v === "string") {
            lua.lua_pushstring(L, to_luastring(v));
            return;
        }
        if (Array.isArray(v)) {
            lua.lua_createtable(L, v.length, 0);
            for (let i = 0; i < v.length; i++) {
                goToLua(fengari, L, v[i]);
                lua.lua_rawseti(L, -2, i + 1);
            }
            return;
        }
        if (typeof v === "object") {
            const keys = Object.keys(v);
            lua.lua_createtable(L, 0, keys.length);
            for (const k of keys) {
                goToLua(fengari, L, v[k]);
                lua.lua_setfield(L, -2, to_luastring(String(k)));
            }
            return;
        }
        lua.lua_pushnil(L);
    };

    const luaToGo = (fengari, L, idx) => {
        const { lua, to_jsstring } = fengari;
        const t = lua.lua_type(L, idx);
        if (t === lua.LUA_TNIL) return null;
        if (t === lua.LUA_TBOOLEAN) return !!lua.lua_toboolean(L, idx);
        if (t === lua.LUA_TNUMBER) return lua.lua_tonumber(L, idx);
        if (t === lua.LUA_TSTRING) return to_jsstring(lua.lua_tostring(L, idx));
        if (t === lua.LUA_TTABLE) {
            const abs = lua.lua_absindex(L, idx);
            const len = lua.lua_rawlen(L, abs);
            if (len > 0) {
                const arr = [];
                let sequential = true;
                for (let i = 1; i <= len; i++) {
                    lua.lua_rawgeti(L, abs, i);
                    if (lua.lua_type(L, -1) === lua.LUA_TNIL) {
                        lua.lua_pop(L, 1);
                        sequential = false;
                        break;
                    }
                    arr.push(luaToGo(fengari, L, -1));
                    lua.lua_pop(L, 1);
                }
                if (sequential && arr.length === len) return arr;
            }
            const obj = {};
            lua.lua_pushnil(L);
            while (lua.lua_next(L, abs) !== 0) {
                const kt = lua.lua_type(L, -2);
                let k;
                if (kt === lua.LUA_TSTRING) k = to_jsstring(lua.lua_tostring(L, -2));
                else if (kt === lua.LUA_TNUMBER) k = String(lua.lua_tonumber(L, -2));
                else {
                    lua.lua_pop(L, 1);
                    continue;
                }
                obj[k] = luaToGo(fengari, L, -1);
                lua.lua_pop(L, 1);
            }
            return obj;
        }
        return null;
    };

    const pushHostApi = (fengari, L, store, bodyBuf, extras = {}) => {
        const { lua, lauxlib, to_luastring, to_jsstring } = fengari;
        let spent = 0;
        const spend = () => {
            spent += 1;
            if (spent > SCHEMA_FETCH_BUDGET) {
                throw new Error(`schema fetch budget exceeded (${SCHEMA_FETCH_BUDGET})`);
            }
        };
        const clean = (v) => String(v || "").trim();
        const checkDeadline = () => {
            if (extras.deadline && Date.now() > extras.deadline) {
                throw new Error("lua deadline exceeded");
            }
        };

        const pushFn = (name, arity, impl) => {
            lua.lua_pushjsfunction(L, (LL) => {
                try {
                    checkDeadline();
                    const args = [];
                    for (let i = 1; i <= arity; i++) {
                        const t = lua.lua_type(LL, i);
                        if (t === lua.LUA_TNIL || t === lua.LUA_TNONE) args.push(undefined);
                        else if (t === lua.LUA_TBOOLEAN) args.push(!!lua.lua_toboolean(LL, i));
                        else if (t === lua.LUA_TNUMBER) args.push(lua.lua_tonumber(LL, i));
                        else if (t === lua.LUA_TSTRING)
                            args.push(to_jsstring(lua.lua_tostring(LL, i)));
                        else args.push(undefined);
                    }
                    const out = impl(...args);
                    if (typeof out === "boolean") {
                        lua.lua_pushboolean(LL, out);
                        return 1;
                    }
                    if (typeof out === "number") {
                        lua.lua_pushnumber(LL, out);
                        return 1;
                    }
                    if (typeof out === "string") {
                        lua.lua_pushstring(LL, to_luastring(out));
                        return 1;
                    }
                    if (out == null) {
                        lua.lua_pushnil(LL);
                        return 1;
                    }
                    goToLua(fengari, LL, out);
                    return 1;
                } catch (err) {
                    return lauxlib.luaL_error(
                        LL,
                        to_luastring(String(err?.message || err))
                    );
                }
            });
            lua.lua_setfield(L, -2, to_luastring(name));
        };

        const api = {
            api: 2,
            write_sign_prefix: WRITE_SIGN_PREFIX,
            read_sign_prefix: READ_SIGN_PREFIX,
        };

        lua.lua_createtable(L, 0, 24);
        for (const [k, v] of Object.entries(api)) {
            goToLua(fengari, L, v);
            lua.lua_setfield(L, -2, to_luastring(k));
        }
        pushFn("now", 0, () => Math.floor(Date.now() / 1000));
        pushFn("now_ms", 0, () => Date.now());
        pushFn("sha256_hex", 1, (value) =>
            sha256Hex(Buffer.from(value == null ? "" : String(value), "utf8"))
        );
        pushFn("write_message", 4, (ib, parentAddr, bodyShaHex, contentType) =>
            [
                WRITE_SIGN_PREFIX,
                ib || "",
                parentAddr || "",
                bodyShaHex || "",
                contentType || "application/octet-stream",
            ].join("\n")
        );
        pushFn("read_message", 2, (ib, timestamp) =>
            readMessage({ ib, timestamp })
        );
        pushFn("verify_ed25519", 3, (pub, message, sig) =>
            verifyEd25519(String(pub || ""), String(message || ""), String(sig || ""))
        );
        pushFn("body", 0, () => {
            spend();
            if (bodyBuf == null) return "";
            return Buffer.isBuffer(bodyBuf)
                ? bodyBuf.toString("utf8")
                : String(bodyBuf);
        });
        pushFn("latest_addr", 1, (ib) => {
            spend();
            const tip = store.getTip(clean(ib));
            return tip && !tip.tombstone ? tip.addr : undefined;
        });
        pushFn("fetch_latest", 1, (ib) => {
            spend();
            const tip = store.getTip(clean(ib));
            if (!tip || tip.tombstone) return undefined;
            return readPayloadText(store, tip.addr) || undefined;
        });
        pushFn("fetch_addr", 1, (addr) => {
            spend();
            const t = readPayloadText(store, clean(addr));
            return t || undefined;
        });
        pushFn("fetch_frame", 1, (addr) => {
            spend();
            const frame = store.getFrame(clean(addr));
            return frame ? JSON.stringify(frame) : undefined;
        });
        pushFn("get_bin", 1, (shaOrBin) => {
            spend();
            const sha = String(shaOrBin || "")
                .replace(/^bin\s+/i, "")
                .trim();
            if (!sha) return undefined;
            const blob = store.getBin(sha);
            if (!blob) return undefined;
            return {
                sha256: sha,
                content_type: blob.content_type,
                body_b64: blob.bytes.toString("base64"),
                byte_length: blob.bytes.length,
            };
        });
        pushFn("park_request", 3, (path, method, body) => {
            spend();
            checkDeadline();
            if (typeof extras.parkRequest !== "function") {
                throw new Error("park_request not available in this context");
            }
            return extras.parkRequest(
                clean(path),
                method ? String(method).toUpperCase() : "GET",
                body == null || body === undefined ? null : String(body)
            );
        });
        // leave table on stack
    };

    const runSchemaAuthorize = (store, luaSource, ctx, bodyBuf, opts = {}) => {
        const fengari = loadFengari();
        if (!fengari) {
            return {
                allow: false,
                aside_ok: false,
                error: "schema Lua engine unavailable (fengari missing)",
            };
        }
        const fnName = opts.fn || "authorize";
        const timeoutMs =
            Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : SCHEMA_TIMEOUT_MS;
        const { lua, lauxlib, lualib, to_luastring, to_jsstring } = fengari;
        const L = lauxlib.luaL_newstate();
        const started = Date.now();
        try {
            lualib.luaL_openlibs(L);

            pushHostApi(fengari, L, store, bodyBuf, {
                deadline: started + timeoutMs,
                parkRequest: opts.parkRequest,
            });
            lua.lua_pushvalue(L, -1);
            lua.lua_setglobal(L, to_luastring("flowerpot"));
            lua.lua_setglobal(L, to_luastring("foobarch"));

            goToLua(fengari, L, ctx);
            lua.lua_setglobal(L, to_luastring("ctx"));

            if (lauxlib.luaL_dostring(L, to_luastring(JSON_DECODE_LUA)) !== lua.LUA_OK) {
                const err = to_jsstring(lua.lua_tostring(L, -1));
                return {
                    allow: false,
                    aside_ok: false,
                    error: `json_decode prelude: ${err}`,
                };
            }

            const chunk =
                `${String(luaSource)}\n` +
                `if type(${fnName}) ~= "function" then return { __fb_missing_fn = true } end\n` +
                `return ${fnName}()`;
            if (lauxlib.luaL_dostring(L, to_luastring(chunk)) !== lua.LUA_OK) {
                const err = to_jsstring(lua.lua_tostring(L, -1));
                return {
                    allow: false,
                    aside_ok: false,
                    error: `schema error: ${err}`,
                };
            }
            if (Date.now() - started > timeoutMs) {
                return {
                    allow: false,
                    aside_ok: false,
                    error: `schema timeout (${timeoutMs}ms)`,
                };
            }
            const raw = luaToGo(fengari, L, -1);
            if (raw && typeof raw === "object" && raw.__fb_missing_fn) {
                return {
                    allow: false,
                    aside_ok: false,
                    error: `schema missing ${fnName}()`,
                };
            }
            if (raw == null) {
                return { allow: false, aside_ok: false, error: `${fnName} returned nil` };
            }
            if (typeof raw === "boolean") {
                return { allow: raw, aside_ok: !raw, via: "lua" };
            }
            if (typeof raw !== "object") {
                return {
                    allow: false,
                    aside_ok: false,
                    error: `${fnName} must return table`,
                };
            }
            return {
                ...raw,
                allow: Boolean(raw.allow),
                aside_ok:
                    raw.aside_ok === undefined ? !raw.allow : Boolean(raw.aside_ok),
                error: raw.error != null ? String(raw.error) : undefined,
                via: "lua",
            };
        } catch (err) {
            return {
                allow: false,
                aside_ok: false,
                error: `schema error: ${err?.message || err}`,
            };
        } finally {
            lua.lua_close(L);
        }
    };

    /**
     * Run park http.kind=lua script. Expects global handle() (or process()) returning
     * { status?, content_type?, body?, body_b64?, bin?, headers? }.
     */
    const runLuaHandle = (store, luaSource, req, extras = {}) => {
        const fengari = loadFengari();
        if (!fengari) {
            return {
                ok: false,
                status: 503,
                error: "lua engine unavailable (fengari missing)",
            };
        }
        const timeoutMs =
            Number(extras.timeoutMs) > 0 ? Number(extras.timeoutMs) : LUA_TIMEOUT_MS;
        const { lua, lauxlib, lualib, to_luastring, to_jsstring } = fengari;
        const L = lauxlib.luaL_newstate();
        const started = Date.now();
        const bodyBuf = extras.bodyBuf || Buffer.alloc(0);
        try {
            lualib.luaL_openlibs(L);
            pushHostApi(fengari, L, store, bodyBuf, {
                deadline: started + timeoutMs,
                parkRequest: extras.parkRequest,
            });
            lua.lua_pushvalue(L, -1);
            lua.lua_setglobal(L, to_luastring("flowerpot"));
            lua.lua_setglobal(L, to_luastring("foobarch"));

            goToLua(fengari, L, req);
            lua.lua_setglobal(L, to_luastring("req"));
            lua.lua_pushvalue(L, -1);
            lua.lua_setglobal(L, to_luastring("ctx"));

            if (lauxlib.luaL_dostring(L, to_luastring(JSON_DECODE_LUA)) !== lua.LUA_OK) {
                const err = to_jsstring(lua.lua_tostring(L, -1));
                return { ok: false, status: 500, error: `json_decode prelude: ${err}` };
            }

            const chunk =
                `${String(luaSource)}\n` +
                `local __fn = handle or process\n` +
                `if type(__fn) ~= "function" then return { __fb_missing_fn = true } end\n` +
                `return __fn(req)`;
            if (lauxlib.luaL_dostring(L, to_luastring(chunk)) !== lua.LUA_OK) {
                const err = to_jsstring(lua.lua_tostring(L, -1));
                return { ok: false, status: 500, error: `lua error: ${err}` };
            }
            if (Date.now() - started > timeoutMs) {
                return {
                    ok: false,
                    status: 504,
                    error: `lua timeout (${timeoutMs}ms)`,
                };
            }
            const raw = luaToGo(fengari, L, -1);
            if (raw && typeof raw === "object" && raw.__fb_missing_fn) {
                return {
                    ok: false,
                    status: 500,
                    error: "script missing handle() or process()",
                };
            }
            if (raw == null || typeof raw !== "object") {
                return {
                    ok: false,
                    status: 500,
                    error: "handle() must return a table",
                };
            }
            return { ok: true, result: raw };
        } catch (err) {
            return {
                ok: false,
                status: 500,
                error: `lua error: ${err?.message || err}`,
            };
        } finally {
            lua.lua_close(L);
        }
    };

    const authorizeWrite = (
        store,
        tipFrame,
        { ib, parentAddr, body, headers, parkRequest, policyAddr, fn, transform } = {}
    ) => {
        const pAddr = policyAddr || policyAddrOf(tipFrame);
        if (!pAddr) return { allow: true, reason: "open tip" };

        const bundle = loadPolicyBundle(store, pAddr);
        if (!bundle.policy) {
            return {
                allow: false,
                error: `policy frame missing: ${pAddr}`,
                policyAddr: pAddr,
            };
        }

        const signKeys = parseHeaderList(
            headers["x-flowerpot-sign-keys"] || headers["x-foobarch-sign-keys"]
        );
        const signatures = parseHeaderList(
            headers["x-flowerpot-signatures"] || headers["x-foobarch-signatures"]
        );
        const bodyBuf = Buffer.isBuffer(body) ? body : Buffer.from(body ?? []);
        const message = writeMessage({
            ib,
            parentAddr,
            body: bodyBuf,
            contentType: "application/json",
        });

        if (!bundle.schemaRef) {
            return {
                allow: false,
                aside_ok: false,
                error:
                    "policy has no schema (rel8ns.schema or data.schema_ib) — host no longer embeds keys gates",
                policyAddr: bundle.policyAddr,
            };
        }
        if (!bundle.luaSource) {
            return {
                allow: false,
                aside_ok: false,
                error: bundle.schemaAddr
                    ? "schema tip has no Lua payload"
                    : `schema tip not found: ${bundle.schemaRef}`,
                policyAddr: bundle.policyAddr,
                schemaRef: bundle.schemaRef,
                schemaAddr: bundle.schemaAddr,
            };
        }
        const result = runSchemaAuthorize(
            store,
            bundle.luaSource,
            {
                ib,
                parent_addr: parentAddr || "",
                body_sha256: sha256Hex(bodyBuf),
                body_size: bodyBuf.length,
                content_type: "application/json",
                message,
                sign_keys: signKeys,
                signatures,
                policy: bundle.policy,
                policy_addr: bundle.policyAddr,
                schema_addr: bundle.schemaAddr,
                schema_ref: bundle.schemaRef,
                operation: "put",
                transform: transform || (parentAddr ? "mut8" : "firstGen"),
            },
            bodyBuf,
            { parkRequest, timeoutMs: SCHEMA_TIMEOUT_MS, fn }
        );
        return {
            ...result,
            policyAddr: bundle.policyAddr,
            schemaAddr: bundle.schemaAddr,
        };
    };

    /** HEAD authorizes as GET; method names are reduced to [a-z0-9_]. */
    const accessMethodKey = (method) => {
        const m = String(method || "GET").trim().toUpperCase();
        return (m === "HEAD" ? "GET" : m).toLowerCase().replace(/[^a-z0-9_]/g, "_");
    };

    /**
     * Policy for a non-commit method: rel8ns.<method>_policy (e.g. post_policy)
     * overrides rel8ns.read_policy, which gates every method by default.
     */
    const accessPolicyAddrOf = (frame, method) => {
        const last = (pol) =>
            Array.isArray(pol) && pol.length ? String(pol[pol.length - 1]) : "";
        const key = accessMethodKey(method);
        return last(frame?.rel8ns?.[`${key}_policy`]) || last(frame?.rel8ns?.read_policy);
    };

    /**
     * GET/HEAD keep the proposal-read-v1 message (ib, timestamp) so existing
     * signed GET clients still verify. Other methods also sign METHOD and the
     * body sha so a GET signature cannot be replayed as a POST.
     */
    const accessMessage = ({ ib, timestamp = "", method, bodySha256 = "" }) => {
        const key = accessMethodKey(method);
        if (key === "get") return readMessage({ ib, timestamp });
        return [
            READ_SIGN_PREFIX,
            ib || "",
            timestamp == null ? "" : String(timestamp),
            key.toUpperCase(),
            bodySha256,
        ].join("\n");
    };

    /**
     * Non-commit access gate for every method (GET/HEAD/POST/QUERY/…).
     * Schema fn chain: authorize_<method>() → authorize_read() → authorize().
     * Commit/tombstone writes use authorizeWrite on rel8ns.policy instead.
     */
    const authorizeAccess = (
        store,
        tipFrame,
        { ib, method = "GET", headers = {}, body, timestamp, parkRequest } = {}
    ) => {
        const key = accessMethodKey(method);
        const pAddr = accessPolicyAddrOf(tipFrame, method);
        if (!pAddr) return { allow: true, reason: "open access" };

        const bundle = loadPolicyBundle(store, pAddr);
        if (!bundle.policy || !bundle.luaSource) {
            return {
                allow: false,
                aside_ok: false,
                error: bundle.policy
                    ? `${key} policy schema missing Lua`
                    : `${key} policy missing: ${pAddr}`,
                policyAddr: pAddr,
            };
        }
        const signKeys = parseHeaderList(
            headers["x-flowerpot-sign-keys"] || headers["x-foobarch-sign-keys"]
        );
        const signatures = parseHeaderList(
            headers["x-flowerpot-signatures"] || headers["x-foobarch-signatures"]
        );
        const ts =
            timestamp != null && timestamp !== ""
                ? String(timestamp)
                : headers["x-foobarch-read-timestamp"] ||
                  headers["x-flowerpot-read-timestamp"] ||
                  "";
        const bodyBuf =
            key === "get"
                ? Buffer.alloc(0)
                : Buffer.isBuffer(body)
                  ? body
                  : Buffer.from(body ?? []);
        const bodySha256 = sha256Hex(bodyBuf);
        const ctx = {
            ib,
            method: key.toUpperCase(),
            timestamp: ts,
            message: accessMessage({ ib, timestamp: ts, method, bodySha256 }),
            body_sha256: bodySha256,
            body_size: bodyBuf.length,
            sign_keys: signKeys,
            signatures,
            policy: bundle.policy,
            policy_addr: bundle.policyAddr,
            schema_addr: bundle.schemaAddr,
            schema_ref: bundle.schemaRef,
            operation: key === "get" ? "read" : key,
        };
        const authOpts = { parkRequest, timeoutMs: SCHEMA_TIMEOUT_MS };
        const chain = [`authorize_${key}`, "authorize_read", "authorize"].filter(
            (fn, i, arr) => arr.indexOf(fn) === i
        );
        let result = null;
        for (const fn of chain) {
            result = runSchemaAuthorize(store, bundle.luaSource, ctx, bodyBuf, {
                ...authOpts,
                fn,
            });
            if (!(result.error && String(result.error).includes(`schema missing ${fn}()`))) {
                break;
            }
        }
        return {
            ...result,
            policyAddr: bundle.policyAddr,
            schemaAddr: bundle.schemaAddr,
        };
    };

    /** Resolve http.kind=lua script tip → source text. */
    const resolveLuaScriptSource = (store, ctrl, tipAddr) => {
        const ref = String(ctrl?.script || ctrl?.target || ctrl?.ib || "").trim();
        if (ref) {
            let addr = resolveRefToAddr(store, ref);
            if (!addr && !ref.includes("^")) {
                const tip = store.getTip(ref.replace(/^\/+/, ""));
                if (tip && !tip.tombstone) addr = tip.addr;
            }
            if (addr) {
                const source = readPayloadText(store, addr);
                if (source) return { source, scriptAddr: addr };
                return { source: "", scriptAddr: addr, error: "script tip has no Lua payload" };
            }
            return { source: "", scriptAddr: "", error: `script tip not found: ${ref}` };
        }
        if (tipAddr) {
            const source = readPayloadText(store, tipAddr);
            if (source) return { source, scriptAddr: tipAddr };
        }
        return {
            source: "",
            scriptAddr: "",
            error: "lua control missing script (or tip Lua bin)",
        };
    };

    /** Map handle()/process() table → HTTP result. */
    const mapLuaHttpResult = (store, raw, method) => {
        const status = Number(raw.status);
        const outStatus = Number.isFinite(status) && status > 0 ? status : 200;
        /** @type {Record<string, string>} */
        const headers = { "X-Foobarch-Lua": "1" };
        if (raw.headers && typeof raw.headers === "object") {
            for (const [k, v] of Object.entries(raw.headers)) {
                if (v == null) continue;
                headers[String(k)] = String(v);
            }
        }
        let type =
            raw.content_type || raw.type || "application/octet-stream";
        /** @type {Buffer|string} */
        let body = "";

        if (raw.bin != null && raw.bin !== "") {
            const sha = String(raw.bin).replace(/^bin\s+/i, "").trim();
            const blob = store.getBin(sha);
            if (!blob) {
                return {
                    status: 404,
                    body: "bin missing\n",
                    type: "text/plain",
                    headers,
                };
            }
            body = blob.bytes;
            type = raw.content_type || blob.content_type || type;
        } else if (raw.body_b64 != null && raw.body_b64 !== "") {
            body = Buffer.from(String(raw.body_b64), "base64");
        } else if (raw.body != null) {
            body = Buffer.from(String(raw.body), "utf8");
        }

        return {
            status: outStatus,
            body: method === "HEAD" ? "" : body,
            type,
            headers,
        };
    };

    /** @deprecated alias — tombstone / callers that only need policy payload */
    const loadPolicyData = (store, frame) => {
        const pAddr = policyAddrOf(frame);
        if (!pAddr) return null;
        const bundle = loadPolicyBundle(store, pAddr);
        return bundle.policy;
    };

    // ─── Server ─────────────────────────────────────────────────────────────

    class FoobarchHost {
        constructor() {
            this.listening = false;
            this.port = DEFAULT_PORT;
            this.host = DEFAULT_HOST;
            this.staticDir = DEFAULT_STATIC;
            this.dbPath = null;
            this.store = null;
            this._server = null;
            /** uuid → { token, socket, inflight: Map, jobs: Map } — not ibgib; dies with the socket. */
            this._naviShells = new Map();
            this._naviShellJobSweeper = null;
        }

        ensureNaviShellJobSweeper() {
            if (this._naviShellJobSweeper) return;
            this._naviShellJobSweeper = setInterval(() => {
                this.sweepNaviShellJobs();
            }, 15000);
            if (typeof this._naviShellJobSweeper.unref === "function") {
                this._naviShellJobSweeper.unref();
            }
        }

        sweepNaviShellJobs() {
            const now = Date.now();
            for (const row of this._naviShells.values()) {
                if (!row?.jobs) continue;
                for (const [id, job] of [...row.jobs.entries()]) {
                    if (!job) {
                        row.jobs.delete(id);
                        continue;
                    }
                    if (
                        job.state === "done" &&
                        job.doneAt &&
                        now - job.doneAt > NAVI_SHELL_JOB_DONE_TTL_MS
                    ) {
                        row.jobs.delete(id);
                        continue;
                    }
                    if (
                        job.state === "running" &&
                        job.createdAt &&
                        now - job.createdAt > NAVI_SHELL_JOB_MS
                    ) {
                        row.jobs.delete(id);
                    }
                }
            }
        }

        naviShellJobLoad(row) {
            let n = row.inflight?.size || 0;
            if (row.jobs) {
                for (const job of row.jobs.values()) {
                    if (job?.state === "running") n += 1;
                }
            }
            return n;
        }

        async loadState() {
            const pick = async (key) => {
                const v = await navi.storage.item.get(STORAGE[key]);
                if (v != null && v !== "") return v;
                return navi.storage.item.get(LEGACY_STORAGE[key]);
            };
            try {
                const p = await pick("port");
                if (p != null) this.port = Number(p) || DEFAULT_PORT;
            } catch {
                /* ignore */
            }
            try {
                const h = await pick("host");
                if (h) this.host = String(h);
            } catch {
                /* ignore */
            }
            try {
                const s = await pick("staticDir");
                if (s) this.staticDir = String(s);
            } catch {
                /* ignore */
            }
            try {
                const d = await pick("dbPath");
                if (d) this.dbPath = String(d);
            } catch {
                /* ignore */
            }
            if (!this.dbPath) this.dbPath = defaultDbPath();
        }

        async persistPort() {
            await navi.storage.item.set(STORAGE.port, this.port);
            await navi.storage.item.set(STORAGE.host, this.host);
        }

        ensureStore() {
            if (!this.store) {
                if (!this.dbPath) this.dbPath = defaultDbPath();
                this.store = openStore(this.dbPath);
                log("sqlite", this.dbPath);
            }
            return this.store;
        }

        usagePassword() {
            return this.ensureStore().getMeta("usage_password", DEFAULT_USAGE_PASSWORD);
        }

        dropNaviShell(uuid, socket) {
            const id = String(uuid || "").trim();
            const row = this._naviShells.get(id);
            if (!row) return;
            if (socket && row.socket !== socket) return;
            for (const pending of row.inflight.values()) {
                try {
                    clearTimeout(pending.timer);
                    pending.reject(new Error("navi_shell disconnected"));
                } catch {
                    /* ignore */
                }
            }
            row.inflight.clear();
            if (row.jobs) {
                for (const job of row.jobs.values()) {
                    job.state = "error";
                    job.error = "navi_shell disconnected";
                    job.doneAt = Date.now();
                }
                row.jobs.clear();
            }
            try {
                row.socket.write(wsEncodeClose());
            } catch {
                /* ignore */
            }
            try {
                row.socket.destroy();
            } catch {
                /* ignore */
            }
            this._naviShells.delete(id);
            log(`navi_shell dropped ${id}`);
        }

        sendNaviShell(uuid, obj) {
            const row = this._naviShells.get(String(uuid || "").trim());
            if (!row || !row.socket || row.socket.destroyed) return false;
            try {
                row.socket.write(wsEncodeText(JSON.stringify(obj)));
                return true;
            } catch {
                return false;
            }
        }

        handleNaviShellUpgrade(req, socket, _head) {
            const url = new URL(req.url || "/", "http://local");
            if (url.pathname !== "/_foobarch/navi_shell") {
                socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
                socket.destroy();
                return;
            }
            const key = req.headers["sec-websocket-key"];
            if (!key || String(req.headers.upgrade || "").toLowerCase() !== "websocket") {
                socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
                socket.destroy();
                return;
            }
            const uuid = String(url.searchParams.get("uuid") || "").trim();
            const token = String(url.searchParams.get("token") || "").trim();
            if (!uuid) {
                socket.write(
                    "HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\nmissing uuid\n"
                );
                socket.destroy();
                return;
            }
            const accept = wsAccept(key);
            socket.write(
                "HTTP/1.1 101 Switching Protocols\r\n" +
                    "Upgrade: websocket\r\n" +
                    "Connection: Upgrade\r\n" +
                    `Sec-WebSocket-Accept: ${accept}\r\n` +
                    "\r\n"
            );
            const row = {
                uuid,
                token,
                socket,
                authed: false,
                inflight: new Map(),
                jobs: new Map(),
                buf: Buffer.alloc(0),
                frag: { parts: null, size: 0 },
            };
            const helloTimer = setTimeout(() => {
                if (!row.authed) this.rejectNaviShellHello(row, 401, "no paid hello within 15s");
            }, NAVI_SHELL_HELLO_MS);
            if (typeof helloTimer.unref === "function") helloTimer.unref();
            const drop = () => {
                clearTimeout(helloTimer);
                if (row.authed) this.dropNaviShell(uuid, socket);
                else {
                    try {
                        socket.destroy();
                    } catch {
                        /* ignore */
                    }
                }
            };
            socket.on("data", (chunk) => {
                row.buf = Buffer.concat([row.buf, chunk]);
                const decoded = wsDecode(row.buf, row.frag);
                row.buf = decoded.rest;
                for (const ping of decoded.pings) {
                    try {
                        socket.write(wsEncodePong(ping));
                    } catch {
                        /* ignore */
                    }
                }
                for (const msg of decoded.msgs) {
                    if (row.authed) this.onNaviShellMessage(uuid, msg);
                    else if (this.acceptNaviShellHello(row, msg)) clearTimeout(helloTimer);
                    if (socket.destroyed) break;
                }
                if (decoded.closed) drop();
            });
            socket.on("error", drop);
            socket.on("close", drop);
            socket.on("end", drop);
        }

        rejectNaviShellHello(row, status, error) {
            log(`navi_shell refused ${row.uuid}: ${error}`);
            try {
                row.socket.write(
                    wsEncodeText(JSON.stringify({ type: "welcome", ok: false, status, error }))
                );
                row.socket.write(wsEncodeClose());
            } catch {
                /* ignore */
            }
            try {
                row.socket.end();
            } catch {
                /* ignore */
            }
            setTimeout(() => {
                try {
                    row.socket.destroy();
                } catch {
                    /* ignore */
                }
            }, 1000).unref?.();
        }

        /**
         * First frame on a relay socket must be `hello` with `owner` (install secret) and
         * `pay` (one usage token). The uuid is public (advertise frames), so the first
         * owner secret seen for a uuid is pinned and later connects must present it.
         * Synchronous so frames that follow in the same chunk see the authed row.
         * @returns {boolean} true when the socket is now registered
         */
        acceptNaviShellHello(row, raw) {
            let msg;
            try {
                msg = JSON.parse(raw);
            } catch {
                msg = null;
            }
            if (!msg || msg.type !== "hello") {
                this.rejectNaviShellHello(row, 401, "first relay frame must be hello");
                return false;
            }
            const owner = String(msg.owner || "").trim();
            const pay = String(msg.pay || "").trim();
            if (owner.length < 32) {
                this.rejectNaviShellHello(row, 401, "hello needs owner (install relay secret) — update navi");
                return false;
            }
            if (!pay) {
                this.rejectNaviShellHello(row, 402, "relay connect costs one usage token (hello.pay)");
                return false;
            }
            const store = this.ensureStore();
            const ownerKey = `relay_owner:${row.uuid}`;
            const ownerSha = sha256HexSync(owner);
            const pinned = store.getMeta(ownerKey);
            if (pinned && !relaySecretEqual(pinned, ownerSha)) {
                this.rejectNaviShellHello(row, 403, "uuid belongs to another navi (owner secret mismatch)");
                return false;
            }
            const paid = store.consumeToken(pay, `relay-connect:${row.uuid}`);
            if (!paid.ok) {
                this.rejectNaviShellHello(row, paid.status || 402, paid.error || "usage token refused");
                return false;
            }
            if (!pinned) store.setMeta(ownerKey, ownerSha);
            const prev = this._naviShells.get(row.uuid);
            if (prev && prev.socket !== row.socket) {
                this.dropNaviShell(row.uuid, prev.socket);
            }
            row.authed = true;
            this._naviShells.set(row.uuid, row);
            this.ensureNaviShellJobSweeper();
            log(`navi_shell connected ${row.uuid} (paid ${pay.slice(0, 16)})`);
            this.sendNaviShell(row.uuid, { type: "welcome", ok: true, lead: pay.slice(0, 16) });
            return true;
        }

        onNaviShellMessage(uuid, raw) {
            let msg;
            try {
                msg = JSON.parse(raw);
            } catch {
                return;
            }
            if (!msg || typeof msg !== "object") return;
            if (msg.type === "hello") return;
            if (msg.type === "advertise" || msg.type === "retire") {
                void this.handleNaviShellRelayOp(uuid, msg);
                return;
            }
            if (msg.type !== "result") return;
            const row = this._naviShells.get(uuid);
            if (!row) return;
            const callId = String(msg.id || "");
            const pending = row.inflight.get(callId);
            if (pending) {
                clearTimeout(pending.timer);
                row.inflight.delete(callId);
                if (row.jobs) row.jobs.delete(callId);
                pending.resolve(msg);
                return;
            }
            const job = row.jobs?.get(callId);
            if (!job) return;
            job.state = msg.ok === false ? "error" : "done";
            job.result = msg;
            job.doneAt = Date.now();
        }

        /**
         * Peek / claim a callin job. Claiming a done job returns the result body
         * and deletes the record (no mailbox balloon).
         */
        naviShellJobResponse(uuid, token, jobId) {
            const id = String(uuid || "").trim();
            const jid = String(jobId || "").trim();
            const row = this._naviShells.get(id);
            if (!row) {
                return this.relayErrorResponse(404, "navi_shell unknown or offline", {
                    via: "hostparkinator_5000",
                    job_id: jid || null,
                });
            }
            const job = row.jobs?.get(jid);
            if (job?.aliasSha) {
                if (!this.relayAliasTokenOk(job.aliasSha, token)) {
                    return this.relayErrorResponse(401, "bad relay alias token", {
                        via: "hostparkinator_5000",
                        job_id: jid || null,
                    });
                }
            } else if (row.token && token !== row.token) {
                return this.relayErrorResponse(401, "bad navi_shell usage token", {
                    via: "hostparkinator_5000",
                    job_id: jid || null,
                });
            }
            if (!job) {
                return this.relayErrorResponse(404, "unknown or expired job", {
                    via: "hostparkinator_5000",
                    job_id: jid || null,
                });
            }
            if (job.state === "running") {
                return {
                    status: 200,
                    body: JSON.stringify({
                        job_id: jid,
                        state: "running",
                        remainder: job.remainder || "",
                        created_at: job.createdAt || null,
                    }),
                    type: "application/json; charset=utf-8",
                };
            }
            // done / error — deliver once then dump
            const result = job.result;
            row.jobs.delete(jid);
            return formatNaviShellResult(result, {
                via: "hostparkinator_5000",
                job_id: jid,
            });
        }

        /** Per-alias callin token: advertise frames carry sha256(token) only. */
        relayAliasTokenSha(frame) {
            const s = String(frame?.data?.relay_token_sha256 || "").trim().toLowerCase();
            return /^[0-9a-f]{64}$/.test(s) ? s : "";
        }

        relayAliasTokenOk(sha, token) {
            if (!token) return false;
            const got = Buffer.from(sha256Hex(Buffer.from(String(token), "utf8")), "utf8");
            const want = Buffer.from(sha, "utf8");
            return got.length === want.length && nodeRequire("crypto").timingSafeEqual(got, want);
        }

        /** navi-* parks carry no policy; only the owning shell (relay advertise/retire) may write them. */
        relayParkWriteForbidden(ib) {
            return {
                status: 403,
                body: JSON.stringify({
                    error: `relay park ${ib} is written only by its shell over the relay (relay advertise / retire)`,
                }),
                type: "application/json",
            };
        }

        isRelayParkIb(ib) {
            const s = String(ib || "").trim();
            return /^navi-[a-zA-Z0-9._-]+$/.test(s);
        }

        parseRelayExpiresAt(raw) {
            const t = Date.parse(String(raw || "").trim());
            return Number.isFinite(t) ? t : null;
        }

        isRelayFrameExpired(frame) {
            const exp = frame?.data?.relay_expires_at;
            if (!exp) return false;
            const t = this.parseRelayExpiresAt(exp);
            if (t == null) return false;
            return Date.now() > t;
        }

        relayFrameUnavailable(resolved) {
            const frame = resolved?.frame;
            const tip = resolved?.tip;
            if (tip?.tombstone || frame?.data?.tombstone) {
                return { kind: "tombstone" };
            }
            if (this.isRelayFrameExpired(frame)) {
                return {
                    kind: "expired",
                    expires_at: frame?.data?.relay_expires_at || null,
                };
            }
            return null;
        }

        expiredParkResponse(expiresAt) {
            return this.relayErrorResponse(410, "relay park expired", {
                via: "hostparkinator_5000",
                relay_expires_at: expiresAt || null,
            });
        }

        /**
         * Always-bodied JSON error for the remote relay caller.
         * `plain` adds content_type/body_b64 for lua park_request.
         */
        relayErrorResponse(status, error, extra = {}) {
            const payload = {
                error: String(error || "relay failed"),
                via: extra.via || "hostparkinator_5000",
            };
            if (extra.method) payload.method = extra.method;
            if (extra.path) payload.path = extra.path;
            if (extra.remainder != null && extra.remainder !== undefined) {
                payload.remainder = extra.remainder;
            }
            if (extra.timeout_ms != null) payload.timeout_ms = extra.timeout_ms;
            if (extra.relay_expires_at != null) {
                payload.relay_expires_at = extra.relay_expires_at;
            }
            if (extra.max != null) payload.max = extra.max;
            const body = JSON.stringify(payload, null, 2);
            if (extra.plain) {
                return {
                    status,
                    content_type: "application/json; charset=utf-8",
                    body,
                    body_b64: Buffer.from(body, "utf8").toString("base64"),
                };
            }
            return {
                status,
                body,
                type: "application/json; charset=utf-8",
            };
        }

        relayParkGoneResponse(unavailable, plain = false) {
            if (unavailable?.kind === "expired") {
                return this.relayErrorResponse(410, "relay park expired", {
                    via: "hostparkinator_5000",
                    relay_expires_at: unavailable.expires_at || null,
                    plain,
                });
            }
            return this.relayErrorResponse(410, "relay park gone", {
                via: "hostparkinator_5000",
                plain,
            });
        }

        relayParkOwnerUuid(frame) {
            const data = frame?.data;
            if (!data || typeof data !== "object") return "";
            return String(
                data.navi_shell_uuid || data.method?.POST?.target || ""
            ).trim();
        }

        buildRelayParkHead(frame, existing) {
            const ib = String(frame?.ib || "").trim();
            if (!this.isRelayParkIb(ib)) {
                throw new Error("relay park ib must be navi-<alias>");
            }
            const data = {
                ...(frame?.data && typeof frame.data === "object"
                    ? frame.data
                    : {}),
            };
            delete data.tombstone;
            delete data.retired;
            const n =
                existing && !existing.tombstone
                    ? (Number(existing.frame?.data?.n) || 0) + 1
                    : 0;
            data.n = n;
            data.timestamp = navi.stamp.time();
            const gib = sha256Hex(
                Buffer.from(JSON.stringify(data), "utf8")
            ).toUpperCase();
            const rel8ns = {
                ...(frame?.rel8ns && typeof frame.rel8ns === "object"
                    ? frame.rel8ns
                    : {}),
                past:
                    existing && !existing.tombstone && existing.addr
                        ? [existing.addr]
                        : [],
                tjp: Array.isArray(frame?.rel8ns?.tjp)
                    ? frame.rel8ns.tjp
                    : [],
                dna: Array.isArray(frame?.rel8ns?.dna)
                    ? frame.rel8ns.dna
                    : [],
            };
            return { ib, gib, data, rel8ns };
        }

        async relayAdvertiseCommit(uuid, frame) {
            const id = String(uuid || "").trim();
            const owner = this.relayParkOwnerUuid(frame);
            if (owner !== id) {
                throw new Error("relay frame target uuid must match connected shell");
            }
            const store = this.ensureStore();
            const existing = store.getTip(String(frame?.ib || ""));
            const head = this.buildRelayParkHead(frame, existing);
            // Soft-expire is only a callin gate — tip stays live, so renew is mut8.
            // Tombstone (or missing) → firstGen reclaim.
            const transform =
                existing && !existing.tombstone ? "mut8" : "firstGen";
            const envelope = {
                transform,
                newIbGib: head,
                dnas: [],
                intermediateIbGibs: [],
            };
            const body = Buffer.from(JSON.stringify(envelope), "utf8");
            const res = await this.applyCommitEnvelope(
                head.ib,
                envelope,
                body,
                {},
                null,
                { relay: true, relayUuid: id }
            );
            return this.assertRelayCommitOk(
                res,
                `relay advertise ${head.ib}`,
                head.ib
            );
        }

        async relayRetireCommit(uuid, ibRaw) {
            const id = String(uuid || "").trim();
            const ib = String(ibRaw || "").trim();
            if (!this.isRelayParkIb(ib)) {
                throw new Error("relay retire ib must be navi-<alias>");
            }
            const store = this.ensureStore();
            const existing = store.getTip(ib);
            if (!existing || existing.tombstone || !existing.frame) {
                throw new Error(`no live relay park: ${ib}`);
            }
            if (this.relayParkOwnerUuid(existing.frame) !== id) {
                throw new Error("relay retire: connected uuid does not own this park");
            }
            const parent = existing.frame;
            const n = (Number(parent.data?.n) || 0) + 1;
            const data = {
                ...(parent.data && typeof parent.data === "object"
                    ? parent.data
                    : {}),
                tombstone: true,
                retired: true,
                n,
                timestamp: navi.stamp.time(),
            };
            const gib = sha256Hex(
                Buffer.from(JSON.stringify(data), "utf8")
            ).toUpperCase();
            const envelope = {
                transform: "mut8",
                newIbGib: {
                    ib,
                    gib,
                    data,
                    rel8ns: {
                        ...(parent.rel8ns && typeof parent.rel8ns === "object"
                            ? parent.rel8ns
                            : {}),
                        past: [existing.addr],
                        tjp: Array.isArray(parent.rel8ns?.tjp)
                            ? parent.rel8ns.tjp
                            : [],
                        dna: Array.isArray(parent.rel8ns?.dna)
                            ? parent.rel8ns.dna
                            : [],
                    },
                },
                dnas: [],
                intermediateIbGibs: [],
            };
            const body = Buffer.from(JSON.stringify(envelope), "utf8");
            const res = await this.applyCommitEnvelope(
                ib,
                envelope,
                body,
                {},
                null,
                { relay: true, relayUuid: id }
            );
            return this.assertRelayCommitOk(res, `relay retire ${ib}`, ib);
        }

        /**
         * Relay WS advertise/retire must never report success unless the tip advanced.
         * Ping uses ib (navi-{alias}); addr proves the commit landed.
         */
        assertRelayCommitOk(res, label, ibFallback) {
            const status = Number(res?.status) || 0;
            let json = {};
            try {
                json = JSON.parse(String(res?.body || ""));
            } catch {
                json = {};
            }
            if (status < 200 || status >= 300) {
                const err =
                    json.error ||
                    String(res?.body || "")
                        .trim()
                        .slice(0, 240) ||
                    `HTTP ${status}`;
                throw new Error(`${label}: ${err}`);
            }
            const addr =
                String(json.addr || "").trim() ||
                String(res?.headers?.["X-Foobarch-ib^gib"] || "").trim();
            if (!addr) {
                throw new Error(`${label}: commit returned no tip addr`);
            }
            return {
                ib:
                    String(json.ib || "").trim() ||
                    String(ibFallback || "").trim() ||
                    undefined,
                addr,
            };
        }

        async handleNaviShellRelayOp(uuid, msg) {
            const id = String(msg.id || "");
            const reply = (payload) =>
                this.sendNaviShell(uuid, {
                    type: "result",
                    id,
                    ...payload,
                });
            if (!this._naviShells.get(String(uuid || "").trim())) {
                reply({ ok: false, error: "navi_shell not registered" });
                return;
            }
            try {
                if (msg.type === "advertise") {
                    const r = await this.relayAdvertiseCommit(uuid, msg.frame);
                    reply({ ok: true, ib: r.ib, addr: r.addr });
                    return;
                }
                if (msg.type === "retire") {
                    const r = await this.relayRetireCommit(
                        uuid,
                        String(msg.ib || "").trim()
                    );
                    reply({ ok: true, ib: r.ib, addr: r.addr });
                    return;
                }
                reply({ ok: false, error: `unknown relay op: ${msg.type}` });
            } catch (err) {
                reply({
                    ok: false,
                    error: err && err.message ? err.message : String(err),
                });
            }
        }

        async relayNaviShellCallin(uuid, token, remainder, body, meta = {}) {
            const id = String(uuid || "").trim();
            const rem = remainder == null ? "" : String(remainder);
            const extra = {
                via: "hostparkinator_5000",
                method: String(meta.method || "").toUpperCase() || null,
                path: meta.path || "",
                remainder: rem,
            };
            const row = this._naviShells.get(id);
            if (!row || !row.socket || row.socket.destroyed) {
                return this.relayErrorResponse(503, "navi_shell offline", extra);
            }
            // A per-alias token (checked at the park) replaces the shell-wide token.
            if (!meta.aliasSha && row.token && token !== row.token) {
                return this.relayErrorResponse(
                    401,
                    "bad navi_shell usage token",
                    extra
                );
            }
            if (!row.jobs) row.jobs = new Map();
            if (this.naviShellJobLoad(row) >= NAVI_SHELL_MAX_INFLIGHT) {
                return this.relayErrorResponse(429, "too many in-flight callins", {
                    ...extra,
                    max: NAVI_SHELL_MAX_INFLIGHT,
                });
            }

            // Park-relative job claim: GET /navi-{alias}/_job/{id}
            const jobClaim = rem.match(/^_job\/([^/]+)$/i);
            if (jobClaim) {
                return this.naviShellJobResponse(id, token, jobClaim[1]);
            }

            const callId = randomHex(8);
            const wait = naviShellWantWait(meta.headers || {});
            const job = {
                id: callId,
                state: "running",
                createdAt: Date.now(),
                remainder: rem,
                aliasSha: meta.aliasSha || null,
            };
            row.jobs.set(callId, job);

            const payload = {
                type: "callin",
                id: callId,
                alias: meta.alias || "",
                remainder: rem,
                body: body == null ? "" : String(body),
                method: String(meta.method || "POST").toUpperCase(),
                path: String(meta.path || ""),
                headers: this.relayCallinHeaders(meta.headers || {}),
            };

            if (!wait) {
                const ok = this.sendNaviShell(id, payload);
                if (!ok) {
                    row.jobs.delete(callId);
                    return this.relayErrorResponse(503, "navi_shell send failed", extra);
                }
                const statusPath = `/_foobarch/navi_shell/job/${encodeURIComponent(id)}/${encodeURIComponent(callId)}`;
                return {
                    status: 202,
                    body: JSON.stringify({
                        job_id: callId,
                        state: "running",
                        status_path: statusPath,
                        park_job_path: `_job/${callId}`,
                        hint:
                            "Poll status_path (or park_job_path under this navi park). Done response delivers body once then dumps the job.",
                    }),
                    type: "application/json; charset=utf-8",
                    headers: {
                        Location: statusPath,
                    },
                };
            }

            // Escape hatch: X-Navi-Shell-Wait — hold HTTP until result (long job budget).
            try {
                const result = await new Promise((resolve, reject) => {
                    const timer = setTimeout(() => {
                        row.inflight.delete(callId);
                        row.jobs.delete(callId);
                        reject(new Error("navi_shell callin timeout"));
                    }, NAVI_SHELL_JOB_MS);
                    row.inflight.set(callId, { resolve, reject, timer });
                    const ok = this.sendNaviShell(id, payload);
                    if (!ok) {
                        clearTimeout(timer);
                        row.inflight.delete(callId);
                        row.jobs.delete(callId);
                        reject(new Error("navi_shell send failed"));
                    }
                });
                row.jobs.delete(callId);
                if (!result || result.ok === false) {
                    const status = Number(result?.status) || 502;
                    if (result?.media != null && String(result.media).length) {
                        return {
                            status,
                            body: String(result.media),
                            type:
                                result.mime ||
                                "application/json; charset=utf-8",
                        };
                    }
                    return this.relayErrorResponse(
                        status,
                        result?.error || "navi_shell callin failed",
                        { ...extra, via: "navi_shell" }
                    );
                }
                const media = result.media != null ? String(result.media) : "";
                const mime = result.mime || "text/plain; charset=utf-8";
                return { status: 200, body: media, type: mime };
            } catch (err) {
                row.jobs.delete(callId);
                const msg = err && err.message ? err.message : String(err);
                const status = /timeout/i.test(msg) ? 504 : 503;
                return this.relayErrorResponse(status, msg, {
                    ...extra,
                    timeout_ms: /timeout/i.test(msg)
                        ? NAVI_SHELL_JOB_MS
                        : undefined,
                });
            }
        }

        setUsagePassword(pwd) {
            this.ensureStore().setMeta("usage_password", String(pwd || ""));
        }

        shellHtml(hxPath) {
            const hostName =
                typeof this?._lastReqHost === "string"
                    ? this._lastReqHost
                    : "";
            const pageTitle = /punchbox/i.test(hostName) ? "Punchbox" : "Foobarch";
            let pathTitle = String(hxPath || "")
                .split("?")[0]
                .replace(/^\/+/, "");
            try {
                pathTitle = decodeURIComponent(pathTitle);
            } catch {
                /* keep encoded */
            }
            const tabTitle = (pathTitle || pageTitle)
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;");
            const body = hxPath
                ? `<body style="margin:0;padding:0;overflow:hidden;"><span hx-get="${hxPath}" hx-trigger="load" hx-swap="outerHTML">Surfing...</span></body>`
                : `<body style="margin:0;padding:0;overflow:hidden;"></body>`;
            return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-title" content="${pageTitle}">
    <meta name="apple-mobile-web-app-status-bar-style" content="default">
    <meta name="theme-color" content="#ffffff">
    <title>${tabTitle}</title>
    <link rel="icon" href="/favicon.ico" type="image/x-icon" sizes="16x16 32x32 48x48">
    <link rel="icon" href="/manifest.json/icon-192.png" type="image/png" sizes="192x192">
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180">
    <link rel="manifest" href="/manifest.json">
    <style>
      html, body {
        margin: 0;
        padding: 0;
        overflow: hidden;
        overflow-x: hidden;
        -webkit-text-size-adjust: none;
        text-size-adjust: none;
        touch-action: pan-x pan-y;
      }
      /* iOS Safari zooms focused controls when computed font-size is under 16px */
      input, select, textarea, button { font-size: 16px; }
    </style>
    <script>
      (function () {
        var block = function (e) { e.preventDefault(); };
        document.addEventListener("gesturestart", block, { passive: false });
        document.addEventListener("gesturechange", block, { passive: false });
        document.addEventListener("gestureend", block, { passive: false });
        document.addEventListener("touchmove", function (e) {
          if (e.touches && e.touches.length > 1) e.preventDefault();
        }, { passive: false });
      })();
    </script>
    <script src="/navi_shell.js"></script>
</head>
${body}
</html>`;
        }

        isBrowserRequest(req) {
            const ua = req.headers["user-agent"] || "";
            if (!ua) return false;
            return [
                "Mozilla",
                "Chrome",
                "Safari",
                "Firefox",
                "Edge",
                "Opera",
                "Gecko",
                "WebKit",
                "Trident",
            ].some((x) => ua.includes(x));
        }

        isDirectNavigation(req) {
            const dest = req.headers["sec-fetch-dest"];
            const mode = req.headers["sec-fetch-mode"];
            if (dest === "document") return true;
            if (mode === "navigate") return true;
            return false;
        }

        normalizePath(pathname) {
            let p = String(pathname || "/").split("?")[0];
            try {
                p = decodeURIComponent(p);
            } catch {
                /* ignore */
            }
            p = p.replace(/\\/g, "/");
            if (!p.startsWith("/")) p = "/" + p;
            if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
            return p;
        }

        pathToIb(pathname) {
            return this.normalizePath(pathname).replace(/^\/+/, "");
        }

        pickTipRace(store, ib, gatePassthru, allowIbs) {
            const live =
                allowIbs instanceof Set && allowIbs.size
                    ? [...allowIbs]
                    : store.listTipIbs();
            let keys = liveDelimiterHits(ib, live);
            if (!keys.length) {
                const raw = normalizeParkIb(pct20ToSpace(ib));
                if (raw) keys = [raw];
            }
            const loaded = keys.map((key) => {
                const t = store.getTip(key);
                if (!t || t.tombstone) return null;
                return t;
            });
            if (!gatePassthru) {
                const gated = loaded.find((t) => t && isTipGateTrue(t.frame?.data));
                if (gated) return gated;
            }
            return loaded.find((t) => t) || null;
        }

        joinIbPrefix(ib, nSegs) {
            const { segments, gaps } = tokenizeParkIb(ib);
            if (!segments.length || nSegs <= 0) return "";
            const n = Math.min(nSegs, segments.length);
            return joinParkIb(segments.slice(0, n), gaps.slice(0, Math.max(0, n - 1)));
        }

        isParkCapture(frame) {
            return isParkCaptureData(frame?.data);
        }

        /**
         * Parks under first token (space / : / /). Longest matching prefix
         * wins unless a capturing park claims the request (remainder
         * delimiters then do not matter). `%20` becomes space before search.
         * Same-depth twins race: exact first, then space, then `:`, then `/`.
         * data.gate=true in the race set always wins unless X-Navi-Gate-Passthru.
         *
         * Claim shape: `park: "capture"|"defer"` only (migrate legacy tips first).
         */
        resolveRoute(pathname, opts = {}) {
            const store = this.ensureStore();
            const ibPath = this.pathToIb(pathname);
            if (!ibPath) return { kind: "root" };

            const headers = opts.headers || {};
            const gatePassthru = isGatePassthruHeader(
                this.headerGet(headers, "X-Navi-Gate-Passthru")
            );

            const reqSegs = tokenizeParkIb(ibPath).segments;
            if (!reqSegs.length) return { kind: "root" };

            const seen = new Set();
            const parks = [];
            const rootSlash = ibPath.split("/")[0];
            for (const root of [reqSegs[0], rootSlash]) {
                if (!root) continue;
                for (const p of store.parksForRoot(root)) {
                    const pib = String(p.ib || "");
                    if (!pib || seen.has(pib)) continue;
                    seen.add(pib);
                    parks.push(p);
                }
            }

            const matching = [];
            for (const park of parks) {
                const pib = String(park.ib || "");
                const parkSegs = tokenizeParkIb(pib).segments;
                if (
                    !parkSegs.length ||
                    parkSegs.length > reqSegs.length ||
                    !parkSegs.every((s, i) => s === reqSegs[i])
                ) {
                    continue;
                }
                const tip = store.getTip(park.ib);
                if (!tip || tip.tombstone) continue;
                const frame = tip.frame || store.getFrame(park.addr);
                matching.push({
                    park,
                    tip,
                    frame,
                    ib: pib,
                    segs: parkSegs,
                });
            }

            const finish = (picked, depth, kindHint) => {
                if (!picked) return null;
                const remainder = reqSegs.slice(depth).join("/");
                const park = !!picked.park;
                return {
                    kind: kindHint || (park ? "park" : "tip"),
                    ib: picked.ib,
                    remainder,
                    tip: picked,
                    addr: picked.addr,
                    frame: picked.frame,
                };
            };

            if (matching.length) {
                matching.sort((a, b) => a.segs.length - b.segs.length);
                const captures = matching.filter((m) =>
                    this.isParkCapture(m.frame)
                );
                const chosenDepth = captures.length
                    ? captures[0].segs.length
                    : matching[matching.length - 1].segs.length;
                const pool = (captures.length ? captures : matching).filter(
                    (m) => m.segs.length === chosenDepth
                );
                const allowIbs = new Set(pool.map((m) => m.ib));
                const raceIb = this.joinIbPrefix(ibPath, chosenDepth);
                const picked = this.pickTipRace(
                    store,
                    raceIb || ibPath,
                    gatePassthru,
                    allowIbs
                );
                const resolved = finish(
                    picked,
                    chosenDepth,
                    captures.length ? "park" : picked?.park ? "park" : "tip"
                );
                if (resolved) return resolved;
            }

            const exact = this.pickTipRace(store, ibPath, gatePassthru);
            if (exact) {
                const depth = tokenizeParkIb(exact.ib).segments.length;
                return (
                    finish(exact, depth, exact.park ? "park" : "tip") || {
                        kind: "miss",
                        ib: ibPath,
                    }
                );
            }

            // /{ib}^{gib}[/{remainder}]: tip-ib must exist, then pin that gib
            // (do not use tip.addr). Method controls come from the pinned frame.
            const caret = ibPath.lastIndexOf("^");
            if (caret > 0) {
                const tipIb = ibPath.slice(0, caret);
                const after = ibPath.slice(caret + 1);
                const gm = /^([^/:\s]+)(.*)$/.exec(after);
                if (tipIb && gm) {
                    const gib = gm[1];
                    const remRaw = String(gm[2] || "").replace(/^[/:\s]+/, "");
                    const tipRow = store.getTip(tipIb);
                    if (tipRow && !tipRow.tombstone) {
                        const addr = `${tipIb}^${gib}`;
                        const frame = store.getFrame(addr);
                        if (
                            frame &&
                            String(frame.ib || tipIb) === tipIb &&
                            String(frame.gib || gib) === gib
                        ) {
                            return {
                                kind: tipRow.park ? "park" : "tip",
                                ib: tipIb,
                                remainder: remRaw,
                                tip: tipRow,
                                addr,
                                frame,
                                pinnedGib: true,
                            };
                        }
                        return {
                            kind: "miss",
                            ib: tipIb,
                            addr,
                            reason: "gib_not_found",
                        };
                    }
                }
            }

            return { kind: "miss", ib: ibPath };
        }

        httpControl(frame, method) {
            const m = String(method || "GET").toUpperCase();
            const block = frame?.data?.method;
            if (block && typeof block === "object" && block[m]) return block[m];
            // Write verbs only — GET/HEAD must be explicit in data.method (no implicit bin).
            if (m === "PUT" || m === "PATCH") return { kind: "commit" };
            if (m === "DELETE") return { kind: "tombstone" };
            return null;
        }

        /**
         * Accept lists media type with q!=0 (exact type match).
         * `application/navi-mod` does not match `application/navi-module`.
         */
        acceptHasType(acceptHeader, typeName) {
            const a = String(acceptHeader || "").toLowerCase();
            const want = String(typeName || "")
                .toLowerCase()
                .trim();
            if (!a || !want) return false;
            for (const part of a.split(",")) {
                const media = part.trim().split(";")[0].trim();
                if (media !== want) continue;
                const qm = part.match(/;\s*q\s*=\s*([0-9.]+)/i);
                if (qm && Number(qm[1]) === 0) continue;
                return true;
            }
            return false;
        }

        /**
         * Tip/frame JSON: application/eframe (legacy: application/ibgib+json).
         */
        wantsEframe(acceptHeader) {
            return (
                this.acceptHasType(acceptHeader, "application/eframe") ||
                this.acceptHasType(acceptHeader, "application/ibgib+json")
            );
        }

        /**
         * Mod provision (multipart eframe + bin): Accept application/navi-mod
         * (legacy: application/navi-mod+json).
         */
        wantsNaviMod(acceptHeader) {
            return (
                this.acceptHasType(acceptHeader, "application/navi-mod") ||
                this.acceptHasType(acceptHeader, "application/navi-mod+json")
            );
        }

        /** Raw module source bytes (not the navi-mod multipart). */
        wantsNaviModuleBytes(acceptHeader) {
            if (this.acceptHasType(acceptHeader, "application/navi-module"))
                return true;
            const a = String(acceptHeader || "").toLowerCase();
            return (
                a.includes("application/javascript") ||
                a.includes("text/javascript")
            );
        }

        /**
         * Accept priority among tip/content classes: html > text > eframe.
         * Tip JSON only when eframe wins (no html/text, and no other primary
         * payload type). Never "attach" eframe beside another body.
         */
        wantsIbGibFrame(acceptHeader) {
            if (!this.wantsEframe(acceptHeader)) return false;
            if (this.acceptHasType(acceptHeader, "text/html")) return false;
            if (this.acceptHasType(acceptHeader, "text/plain")) return false;
            if (this.wantsNaviMod(acceptHeader)) return false;
            const a = String(acceptHeader || "").toLowerCase();
            for (const part of a.split(",")) {
                const media = part.trim().split(";")[0].trim();
                if (!media) continue;
                const qm = part.match(/;\s*q\s*=\s*([0-9.]+)/i);
                if (qm && Number(qm[1]) === 0) continue;
                if (
                    media === "application/eframe" ||
                    media === "application/ibgib+json" ||
                    media === "application/json" ||
                    media === "*/*"
                ) {
                    continue;
                }
                return false;
            }
            return true;
        }

        wantsNaviModPackage(acceptHeader) {
            return this.wantsNaviMod(acceptHeader);
        }

        /** Eframe snapshot with bins: Accept application/eframe + multipart/related. */
        wantsFrameSnapshot(acceptHeader) {
            return (
                this.wantsEframe(acceptHeader) &&
                this.acceptHasType(acceptHeader, "multipart/related")
            );
        }

        /**
         * Bins a GET snapshot may carry. data.snapshot_bins: true (all rel8ns.bin)
         * or a list of indices / "bin <sha>" refs. X-Foobarch-Snapshot-Bins
         * (indices or shas) narrows that set; it can never widen it.
         */
        snapshotBinShas(frame, headers) {
            const bins = Array.isArray(frame?.rel8ns?.bin) ? frame.rel8ns.bin.map(String) : [];
            const spec = frame?.data?.snapshot_bins;
            if (!bins.length || spec == null || spec === false) return [];
            const shaOf = (s) => String(s || "").replace(/^bin\s+/i, "").trim().toLowerCase();
            const resolveEntry = (v) => {
                if (typeof v === "number" || /^\d+$/.test(String(v).trim())) {
                    return bins[Number(v)] ? shaOf(bins[Number(v)]) : "";
                }
                const want = shaOf(v);
                return bins.some((b) => shaOf(b) === want) ? want : "";
            };
            let allowed =
                spec === true
                    ? bins.map(shaOf)
                    : Array.isArray(spec)
                      ? spec.map(resolveEntry)
                      : [];
            allowed = allowed.filter((s, i, arr) => s && arr.indexOf(s) === i);
            const narrowRaw = String(
                this.headerGet(headers, "x-foobarch-snapshot-bins") || ""
            ).trim();
            if (!narrowRaw) return allowed;
            const narrow = new Set(
                narrowRaw
                    .split(/[,\s]+/)
                    .filter(Boolean)
                    .map(resolveEntry)
                    .filter(Boolean)
            );
            return allowed.filter((s) => narrow.has(s));
        }

        /**
         * multipart/related: eframe + selected bins. Each bin part carries
         * X-Foobarch-Bin; the response lists delivered shas in X-Foobarch-Bins.
         */
        buildFrameSnapshot(resolved, store, shas, method) {
            const frame = resolved.frame;
            const boundary =
                "foobarch-" +
                Date.now().toString(36) +
                "-" +
                Math.random().toString(36).slice(2, 10);
            const parts = [
                Buffer.from(
                    `--${boundary}\r\n` +
                        `Content-Type: application/eframe; charset=utf-8\r\n` +
                        `Content-ID: <eframe>\r\n` +
                        `Content-Disposition: inline; name="eframe"\r\n` +
                        `\r\n`,
                    "utf8"
                ),
                Buffer.from(JSON.stringify(frame), "utf8"),
                Buffer.from("\r\n", "utf8"),
            ];
            const delivered = [];
            for (const sha of shas) {
                const blob = store.getBin(sha);
                if (!blob) continue;
                const bytes = Buffer.isBuffer(blob.bytes)
                    ? blob.bytes
                    : Buffer.from(blob.bytes || "");
                const ct = blob.content_type || "application/octet-stream";
                parts.push(
                    Buffer.from(
                        `--${boundary}\r\n` +
                            `Content-Type: ${ct}\r\n` +
                            `Content-ID: <bin ${sha}>\r\n` +
                            `Content-Disposition: attachment; name="bin"; filename="bin ${sha}"\r\n` +
                            `X-Foobarch-Bin: ${sha}\r\n` +
                            `Content-Transfer-Encoding: binary\r\n` +
                            `\r\n`,
                        "utf8"
                    ),
                    bytes,
                    Buffer.from("\r\n", "utf8")
                );
                delivered.push(sha);
            }
            parts.push(Buffer.from(`--${boundary}--\r\n`, "utf8"));
            return {
                status: 200,
                body: method === "HEAD" ? "" : Buffer.concat(parts),
                type: `multipart/related; boundary="${boundary}"; type="application/eframe"; start="<eframe>"`,
                headers: {
                    "X-Foobarch-ib^gib": resolved.addr,
                    "X-Foobarch-Package": "application/eframe+bins",
                    "X-Foobarch-Bins": delivered.join(","),
                },
            };
        }

        /**
         * kind=mod provision: multipart/related with eframe + addressed bin.
         * Same organization as host store — navi parks the eframe and puts the
         * bin under its sha without rewriting rel8ns.
         */
        buildNaviModPackage(resolved, store) {
            const frame = resolved.frame;
            const binRel = frame?.rel8ns?.bin?.[0];
            if (!binRel) {
                return {
                    status: 404,
                    body: JSON.stringify({
                        error: "mod package requires rel8ns.bin",
                        via: "hostparkinator_5000",
                        ib: frame?.ib || resolved.ib,
                    }),
                    type: "application/json",
                    headers: { "X-Foobarch-ib^gib": resolved.addr },
                };
            }
            const sha = String(binRel).replace(/^bin\s+/i, "").trim().toLowerCase();
            const blob = store.getBin(sha);
            if (!blob) {
                return {
                    status: 404,
                    body: "bin missing\n",
                    type: "text/plain",
                };
            }
            const binCt =
                blob.content_type ||
                frame.data?.content_type ||
                "application/navi-module";
            const bytes = Buffer.isBuffer(blob.bytes)
                ? blob.bytes
                : Buffer.from(blob.bytes || "");
            const boundary =
                "foobarch-" +
                Date.now().toString(36) +
                "-" +
                Math.random().toString(36).slice(2, 10);
            const frameJson = Buffer.from(JSON.stringify(frame), "utf8");
            const parts = [];
            parts.push(
                Buffer.from(
                    `--${boundary}\r\n` +
                        `Content-Type: application/eframe; charset=utf-8\r\n` +
                        `Content-ID: <eframe>\r\n` +
                        `Content-Disposition: inline; name="eframe"\r\n` +
                        `\r\n`,
                    "utf8"
                )
            );
            parts.push(frameJson);
            parts.push(Buffer.from("\r\n", "utf8"));
            parts.push(
                Buffer.from(
                    `--${boundary}\r\n` +
                        `Content-Type: ${binCt}\r\n` +
                        `Content-ID: <bin>\r\n` +
                        `Content-Disposition: attachment; name="bin"; filename="bin ${sha}"\r\n` +
                        `X-Foobarch-Bin: ${sha}\r\n` +
                        `Content-Transfer-Encoding: binary\r\n` +
                        `\r\n`,
                    "utf8"
                )
            );
            parts.push(bytes);
            parts.push(Buffer.from(`\r\n--${boundary}--\r\n`, "utf8"));
            return {
                status: 200,
                body: Buffer.concat(parts),
                type: `multipart/related; boundary="${boundary}"; type="application/eframe"; start="<eframe>"`,
                headers: {
                    "X-Foobarch-ib^gib": resolved.addr,
                    "X-Foobarch-Package": "application/navi-mod",
                    "X-Foobarch-Bin": sha,
                },
            };
        }

        /**
         * Sync park/path controller for Lua (park_request). Avoids HTTP self-fetch
         * deadlock; external URLs use child-process fetch with a hard timeout.
         */
        makeParkRequestController(opts = {}) {
            const self = this;
            let hops = Number(opts.hops) || 0;
            const deadline =
                opts.deadline || Date.now() + Math.max(LUA_TIMEOUT_MS, PARK_REQUEST_TIMEOUT_MS);
            const headers = opts.headers || {};
            const fn = (path, method, body) => {
                const useHops = hops;
                hops += 1;
                return self.parkRequestFromLua(path, method, body, {
                    hops: useHops,
                    deadline,
                    headers,
                    parkRequest: fn,
                });
            };
            return fn;
        }

        /**
         * @returns {{ status: number, content_type?: string, headers?: object, body?: string, body_b64?: string, error?: string }}
         */
        parkRequestFromLua(pathOrUrl, method, body, opts = {}) {
            const hops = Number(opts.hops) || 0;
            if (hops >= LUA_PARK_HOPS) {
                throw new Error(`park_request hop limit exceeded (${LUA_PARK_HOPS})`);
            }
            if (opts.deadline && Date.now() > opts.deadline) {
                throw new Error("lua deadline exceeded");
            }
            const methodU = String(method || "GET").toUpperCase();
            const raw = String(pathOrUrl || "").trim();
            if (!raw) throw new Error("park_request: empty path");

            const remainingMs = opts.deadline
                ? Math.max(1, opts.deadline - Date.now())
                : PARK_REQUEST_TIMEOUT_MS;
            const timeoutMs = Math.min(PARK_REQUEST_TIMEOUT_MS, remainingMs);

            if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
                const r = syncHttpFetch(raw, {
                    method: methodU,
                    headers: opts.headers || {},
                    body: body != null ? Buffer.from(String(body), "utf8") : null,
                    timeoutMs,
                });
                const buf = Buffer.from(r.body_b64 || "", "base64");
                return {
                    status: r.status,
                    content_type: r.type,
                    headers: r.headers || {},
                    body: buf.toString("utf8"),
                    body_b64: r.body_b64 || "",
                    byte_length: buf.length,
                };
            }

            let path = raw.startsWith("/") ? raw : `/${raw}`;
            let search = "";
            const q = path.indexOf("?");
            if (q >= 0) {
                search = path.slice(q);
                path = path.slice(0, q);
            }
            path = this.normalizePath(path);

            const store = this.ensureStore();
            const resolved = this.resolveRoute(path, {
                headers: opts.headers || {},
            });
            if (resolved.kind === "miss" || resolved.kind === "root" || !resolved.frame) {
                return {
                    status: 404,
                    content_type: "text/plain",
                    body: `no tip for ${this.pathToIb(path)}\n`,
                    body_b64: "",
                };
            }
            const unavailable = this.relayFrameUnavailable(resolved);
            if (unavailable) {
                return this.relayParkGoneResponse(unavailable, true);
            }

            const ctrl = this.httpControl(
                resolved.frame,
                methodU === "HEAD" ? "GET" : methodU
            );
            if (!ctrl) {
                return {
                    status: 405,
                    content_type: "application/json",
                    body: JSON.stringify({ error: `no http control for ${methodU}` }),
                    body_b64: "",
                };
            }
            const kind = String(ctrl.kind || "bin").toLowerCase();

            if (kind !== "commit" && kind !== "tombstone") {
                const accessAuth = authorizeAccess(store, resolved.frame, {
                    ib: resolved.frame?.ib || this.pathToIb(path),
                    method: methodU,
                    headers: opts.headers || {},
                    body: body != null ? Buffer.from(String(body), "utf8") : Buffer.alloc(0),
                    parkRequest: opts.parkRequest,
                });
                if (!accessAuth.allow) {
                    const json = JSON.stringify({
                        error: accessAuth.error || `${methodU} unauthorized`,
                        via: accessAuth.via,
                        policyAddr: accessAuth.policyAddr,
                    });
                    return {
                        status: accessAuth.aside_ok === false ? 403 : 401,
                        content_type: "application/json",
                        body: json,
                        body_b64: Buffer.from(json, "utf8").toString("base64"),
                    };
                }
            }

            if (kind === "navi_shell" || kind === "relay") {
                const json = JSON.stringify(
                    {
                        error:
                            "navi_shell relay is async; not available from lua park_request",
                        via: "hostparkinator_5000",
                        method: methodU,
                        path,
                        remainder: resolved.remainder || "",
                    },
                    null,
                    2
                );
                return {
                    status: 503,
                    content_type: "application/json; charset=utf-8",
                    body: json,
                    body_b64: Buffer.from(json, "utf8").toString("base64"),
                };
            }

            if (kind === "frame" || kind === "manifest") {
                const json = JSON.stringify(resolved.frame, null, 2);
                return {
                    status: 200,
                    content_type: "application/json",
                    headers: { "X-Foobarch-ib^gib": resolved.addr },
                    body: json,
                    body_b64: Buffer.from(json, "utf8").toString("base64"),
                };
            }

            if (kind === "proxy") {
                const target = String(ctrl.target || resolved.frame.data?.proxy_target || "");
                if (!target) {
                    return {
                        status: 500,
                        content_type: "application/json",
                        body: JSON.stringify({ error: "proxy control missing target" }),
                        body_b64: "",
                    };
                }
                let url = target;
                if (resolved.remainder) {
                    const rem = String(resolved.remainder).replace(/^\/+/, "");
                    url = target.replace(/\/+$/, "") + "/" + rem;
                }
                if (search) url += search;
                const r = syncHttpFetch(url, {
                    method: methodU === "HEAD" ? "GET" : methodU,
                    headers: this.proxyForwardHeaders(opts.headers || {}),
                    body:
                        methodU !== "GET" &&
                        methodU !== "HEAD" &&
                        body != null
                            ? Buffer.from(String(body), "utf8")
                            : null,
                    timeoutMs,
                });
                const buf = Buffer.from(r.body_b64 || "", "base64");
                return {
                    status: r.status,
                    content_type: r.type,
                    headers: { ...(r.headers || {}), "X-Foobarch-Proxy": url },
                    body: buf.toString("utf8"),
                    body_b64: r.body_b64 || "",
                    byte_length: buf.length,
                };
            }

            if (kind === "redirect") {
                const target = String(
                    ctrl.target || resolved.frame.data?.redirect_target || ""
                ).trim();
                if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) {
                    return {
                        status: 500,
                        content_type: "application/json",
                        body: JSON.stringify({
                            error:
                                "redirect target must be a route ib/path (not an absolute URL)",
                        }),
                        body_b64: "",
                    };
                }
                let ibPath = this.pathToIb(target);
                if (resolved.remainder) {
                    const rem = String(resolved.remainder).replace(/^\/+/, "");
                    ibPath = ibPath
                        ? ibPath.replace(/\/+$/, "") + "/" + rem
                        : rem;
                }
                const next = "/" + ibPath + search;
                const nested =
                    typeof opts.parkRequest === "function"
                        ? opts.parkRequest(next, methodU, body)
                        : this.parkRequestFromLua(next, methodU, body, {
                              ...opts,
                              hops: hops + 1,
                          });
                return {
                    ...nested,
                    headers: {
                        ...(nested.headers || {}),
                        "X-Foobarch-Redirect": "/" + ibPath,
                    },
                };
            }

            if (kind === "lua") {
                const script = resolveLuaScriptSource(store, ctrl, resolved.addr);
                if (!script.source) {
                    return {
                        status: 500,
                        content_type: "application/json",
                        body: JSON.stringify({
                            error: script.error || "lua script missing",
                        }),
                        body_b64: "",
                    };
                }
                const parkRequest =
                    typeof opts.parkRequest === "function"
                        ? opts.parkRequest
                        : this.makeParkRequestController({
                              hops: hops + 1,
                              deadline: opts.deadline,
                              headers: opts.headers || {},
                          });
                const reqCtx = {
                    method: methodU,
                    path,
                    remainder: resolved.remainder || "",
                    search: search || "",
                    headers: opts.headers || {},
                    tip: {
                        ib: resolved.frame.ib,
                        addr: resolved.addr,
                        data: resolved.frame.data || {},
                        rel8ns: resolved.frame.rel8ns || {},
                    },
                    script_addr: script.scriptAddr,
                };
                const run = runLuaHandle(store, script.source, reqCtx, {
                    bodyBuf:
                        body != null
                            ? Buffer.from(String(body), "utf8")
                            : Buffer.alloc(0),
                    parkRequest,
                    timeoutMs: Math.min(LUA_TIMEOUT_MS, remainingMs),
                });
                if (!run.ok) {
                    return {
                        status: run.status || 500,
                        content_type: "application/json",
                        body: JSON.stringify({ error: run.error }),
                        body_b64: "",
                    };
                }
                const mapped = mapLuaHttpResult(store, run.result, methodU);
                const buf = Buffer.isBuffer(mapped.body)
                    ? mapped.body
                    : Buffer.from(String(mapped.body || ""), "utf8");
                return {
                    status: mapped.status,
                    content_type: mapped.type,
                    headers: mapped.headers || {},
                    body: buf.toString("utf8"),
                    body_b64: buf.toString("base64"),
                    byte_length: buf.length,
                };
            }

            const picked = selectBinRef(resolved.frame, ctrl, resolved.remainder);
            if (!picked.ref) {
                const json = JSON.stringify({
                    error: picked.error,
                    via: "hostparkinator_5000",
                    ib: resolved.frame?.ib || resolved.ib,
                });
                return {
                    status: picked.status || 404,
                    content_type: "application/json",
                    headers: { "X-Foobarch-ib^gib": resolved.addr },
                    body: json,
                    body_b64: Buffer.from(json, "utf8").toString("base64"),
                };
            }
            const sha = picked.sha;
            const blob = store.getBin(sha);
            if (!blob) {
                return {
                    status: 404,
                    content_type: "text/plain",
                    body: "bin missing\n",
                    body_b64: "",
                };
            }
            const ct =
                ctrl.content_type ||
                resolved.frame.data?.content_type ||
                blob.content_type ||
                "application/octet-stream";
            return {
                status: 200,
                content_type: ct,
                headers: { "X-Foobarch-ib^gib": resolved.addr, "X-Foobarch-Bin": sha },
                body: blob.bytes.toString("utf8"),
                body_b64: blob.bytes.toString("base64"),
                byte_length: blob.bytes.length,
            };
        }

        async readBody(req) {
            const chunks = [];
            for await (const c of req) chunks.push(c);
            return Buffer.concat(chunks);
        }

        headerGet(headers, name) {
            const lower = name.toLowerCase();
            for (const [k, v] of Object.entries(headers || {})) {
                if (String(k).toLowerCase() === lower) return v;
            }
            return undefined;
        }

        /**
         * Headers to forward on proxy (classic foobarch: most headers except
         * hop-by-hop / Accept-Encoding). Keeps X-Flowerpot-* for upstream PUT.
         */
        proxyForwardHeaders(headers) {
            const skip = new Set([
                "host",
                "connection",
                "keep-alive",
                "proxy-authenticate",
                "proxy-authorization",
                "te",
                "trailers",
                "transfer-encoding",
                "upgrade",
                "content-length",
                "accept-encoding",
            ]);
            /** @type {Record<string, string>} */
            const out = {};
            for (const [k, v] of Object.entries(headers || {})) {
                const lk = String(k).toLowerCase();
                if (skip.has(lk)) continue;
                if (v == null) continue;
                out[k] = Array.isArray(v) ? String(v[0]) : String(v);
            }
            return out;
        }

        /**
         * Request headers the shell may callout on a relay use.
         * Drops hop-by-hop, cookies, and usage tokens.
         */
        relayCallinHeaders(headers) {
            const skip = new Set([
                "connection",
                "keep-alive",
                "proxy-authenticate",
                "proxy-authorization",
                "te",
                "trailers",
                "transfer-encoding",
                "upgrade",
                "content-length",
                "cookie",
                "authorization",
                USAGE_TOKEN_HEADER.toLowerCase(),
                NAVI_SHELL_TOKEN_HEADER.toLowerCase(),
            ]);
            /** @type {Record<string, string>} */
            const out = {};
            for (const [k, v] of Object.entries(headers || {})) {
                const lk = String(k).toLowerCase();
                if (skip.has(lk)) continue;
                if (v == null) continue;
                out[lk] = Array.isArray(v) ? String(v[0]) : String(v);
            }
            return out;
        }

        /**
         * Ordered unused usage tokens on a tip (`data.foobarch.tokens`).
         * @param {any} frame
         * @returns {string[]}
         */
        readFoobarchTokens(frame) {
            const raw = frame?.data?.foobarch?.tokens;
            if (!Array.isArray(raw)) return [];
            return raw
                .map((x) => String(x || "").trim())
                .filter(Boolean);
        }

        /**
         * Reserve tip ibs: rel8ns["foobarch.token_reserve"] then data.foobarch.token_reserve.
         * @param {any} frame
         * @returns {string[]}
         */
        readTokenReserveRefs(frame) {
            if (!frame || typeof frame !== "object") return [];
            const out = [];
            const seen = new Set();
            const push = (raw) => {
                const s = String(raw || "").trim();
                if (!s) return;
                const ib = s.includes("^") ? s.slice(0, s.indexOf("^")) : s;
                if (!ib || seen.has(ib)) return;
                seen.add(ib);
                out.push(ib);
            };
            const rel = frame.rel8ns?.["foobarch.token_reserve"];
            if (Array.isArray(rel)) {
                for (const r of rel) push(r);
            } else if (rel != null) {
                push(rel);
            }
            push(frame.data?.foobarch?.token_reserve);
            return out;
        }

        /**
         * Self-index pay: new tip must equal old tokens with head removed.
         * @returns {{ ok: true, token: string } | { ok: false, status: number, error: string }}
         */
        assertSelfTokenDrop(oldFrame, newFrame) {
            const oldToks = this.readFoobarchTokens(oldFrame);
            if (!oldToks.length) {
                return {
                    ok: false,
                    status: 402,
                    error: "self foobarch.tokens empty",
                };
            }
            const spent = oldToks[0];
            const expected = oldToks.slice(1);
            const newToks = this.readFoobarchTokens(newFrame);
            if (newToks.length !== expected.length) {
                return {
                    ok: false,
                    status: 400,
                    error:
                        "self-index: new data.foobarch.tokens must drop head only",
                    spent,
                    expected_len: expected.length,
                    got_len: newToks.length,
                };
            }
            for (let i = 0; i < expected.length; i++) {
                if (newToks[i] !== expected[i]) {
                    return {
                        ok: false,
                        status: 400,
                        error:
                            "self-index: new data.foobarch.tokens mismatch after drop",
                        spent,
                    };
                }
            }
            return { ok: true, token: spent };
        }

        /**
         * Payment for tip-advancing ops. Precedence:
         * header → self data.foobarch.tokens → foobarch.token_reserve (2 tokens).
         * @returns {object} payment descriptor or { ok:false, status, error }
         */
        resolveMutationPayment({ store, headers, existingFrame, newFrame }) {
            const headerTok = String(
                this.headerGet(headers, USAGE_TOKEN_HEADER) || ""
            ).trim();
            if (headerTok) {
                const probe = store.probeToken(headerTok);
                if (!probe.ok) {
                    return {
                        ok: false,
                        status: probe.status,
                        error: probe.error,
                    };
                }
                return {
                    ok: true,
                    mode: "header",
                    tokens: [probe.token],
                };
            }

            if (existingFrame) {
                const selfToks = this.readFoobarchTokens(existingFrame);
                if (selfToks.length) {
                    const drop = this.assertSelfTokenDrop(
                        existingFrame,
                        newFrame
                    );
                    if (!drop.ok) return drop;
                    const probe = store.probeToken(drop.token);
                    if (!probe.ok) {
                        return {
                            ok: false,
                            status: probe.status,
                            error: probe.error,
                        };
                    }
                    return {
                        ok: true,
                        mode: "self",
                        tokens: [probe.token],
                    };
                }
            }

            // Prefer newFrame reserve refs (client can retarget after remint),
            // then existingFrame — prior tips often still point at an exhausted stash.
            const refs = [];
            const seen = new Set();
            for (const ib of [
                ...this.readTokenReserveRefs(newFrame),
                ...this.readTokenReserveRefs(existingFrame),
            ]) {
                if (!ib || seen.has(ib)) continue;
                seen.add(ib);
                refs.push(ib);
            }
            for (const reserveIb of refs) {
                const tip = store.getTip(reserveIb);
                if (!tip || tip.tombstone || !tip.frame) continue;
                const toks = this.readFoobarchTokens(tip.frame);
                if (toks.length < 2) continue;
                const p0 = store.probeToken(toks[0]);
                const p1 = store.probeToken(toks[1]);
                if (!p0.ok || !p1.ok) continue;
                return {
                    ok: true,
                    mode: "reserve",
                    tokens: [p0.token, p1.token],
                    reserveIb,
                    reserveAddr: tip.addr,
                };
            }

            return {
                ok: false,
                status: 402,
                error:
                    "no usage payment: need X-Foobarch-Usage-Token, data.foobarch.tokens, or foobarch.token_reserve (≥2)",
            };
        }

        /**
         * Host-authored mut8: drop first `n` entries from reserve tip's foobarch.tokens.
         * Does not consume global tokens (caller does).
         */
        hostMut8ReserveDrop(store, reserveIb, n) {
            const tip = store.getTip(reserveIb);
            if (!tip || tip.tombstone || !tip.frame) {
                return {
                    ok: false,
                    status: 402,
                    error: `token_reserve tip missing: ${reserveIb}`,
                };
            }
            const parent = tip.frame;
            const oldToks = this.readFoobarchTokens(parent);
            const dropN = Math.max(0, Number(n) || 0);
            if (oldToks.length < dropN) {
                return {
                    ok: false,
                    status: 402,
                    error: `token_reserve ${reserveIb} has ${oldToks.length} tokens; need ${dropN}`,
                };
            }
            const remaining = oldToks.slice(dropN);
            const prevFoobarch =
                parent.data?.foobarch && typeof parent.data.foobarch === "object"
                    ? { ...parent.data.foobarch }
                    : {};
            prevFoobarch.tokens = remaining;
            const data = {
                ...(parent.data && typeof parent.data === "object"
                    ? parent.data
                    : {}),
                foobarch: prevFoobarch,
                n: (Number(parent.data?.n) || 0) + 1,
                timestamp: navi.stamp.time(),
            };
            const gib = sha256Hex(
                Buffer.from(JSON.stringify(data), "utf8")
            ).toUpperCase();
            const head = {
                ib: String(reserveIb),
                gib,
                data,
                rel8ns: {
                    ...(parent.rel8ns && typeof parent.rel8ns === "object"
                        ? parent.rel8ns
                        : {}),
                    past: [tip.addr],
                    dna: Array.isArray(parent.rel8ns?.dna)
                        ? parent.rel8ns.dna
                        : [],
                    tjp: Array.isArray(parent.rel8ns?.tjp)
                        ? parent.rel8ns.tjp
                        : [],
                },
            };
            try {
                const result = store.persistTransform({
                    transform: "mut8",
                    newIbGib: head,
                    dnas: [],
                    intermediateIbGibs: [],
                });
                return { ok: true, addr: result.addr, head, dropped: oldToks.slice(0, dropN) };
            } catch (err) {
                return {
                    ok: false,
                    status: 500,
                    error: err?.message || String(err),
                };
            }
        }

        async handleCommitPut(ib, bodyBuf, headers) {
            let envelope;
            try {
                envelope = JSON.parse(bodyBuf.toString("utf8"));
            } catch {
                return {
                    status: 400,
                    body: JSON.stringify({
                        error: "commit body must be JSON commit envelope",
                    }),
                    type: "application/json",
                };
            }

            const store = this.ensureStore();
            const existing = store.getTip(ib);
            const existingFrame =
                existing && !existing.tombstone ? existing.frame : null;
            const payment = this.resolveMutationPayment({
                store,
                headers,
                existingFrame,
                newFrame: envelope?.newIbGib,
            });
            if (!payment.ok) {
                return {
                    status: payment.status || 401,
                    body: JSON.stringify({
                        error: payment.error || "usage payment required",
                        spent: payment.spent,
                        expected_len: payment.expected_len,
                        got_len: payment.got_len,
                    }),
                    type: "application/json",
                };
            }

            return await this.applyCommitEnvelope(
                ib,
                envelope,
                bodyBuf,
                headers,
                payment
            );
        }

        /**
         * Soft-delete tip: empty body → auto mut8 tombstone (open tips only);
         * non-empty body → treat as commit envelope (keys tips send signed tombstone).
         */
        async handleTombstone(ib, bodyBuf, headers) {
            if (bodyBuf && bodyBuf.length) {
                return await this.handleCommitPut(ib, bodyBuf, headers);
            }

            if (this.isRelayParkIb(ib)) return this.relayParkWriteForbidden(ib);
            const store = this.ensureStore();
            const existing = store.getTip(ib);
            if (!existing || existing.tombstone || !existing.frame) {
                return {
                    status: 404,
                    body: JSON.stringify({ error: `no tip to tombstone: ${ib}` }),
                    type: "application/json",
                };
            }

            if (isWriteGated(existing.frame)) {
                return {
                    status: 405,
                    body: JSON.stringify({
                        error:
                            "gated tip: DELETE with empty body not allowed; send signed tombstone commit envelope as body, tip http.DELETE proxy, or /foobarch/admin/delete/{ib}",
                    }),
                    type: "application/json",
                };
            }

            const parent = existing.frame;
            const n = Number(parent.data?.n) || 0;
            const selfToks = this.readFoobarchTokens(parent);
            const headerTok = String(
                this.headerGet(headers, USAGE_TOKEN_HEADER) || ""
            ).trim();
            // Host-authored tombstone: if paying via self-index, drop head token here.
            let foobarch = parent.data?.foobarch;
            if (
                !headerTok &&
                selfToks.length &&
                foobarch &&
                typeof foobarch === "object"
            ) {
                foobarch = { ...foobarch, tokens: selfToks.slice(1) };
            }
            const data = {
                ...(parent.data && typeof parent.data === "object" ? parent.data : {}),
                ...(foobarch ? { foobarch } : {}),
                tombstone: true,
                n: n + 1,
                timestamp: navi.stamp.time(),
            };
            const gib = sha256Hex(
                Buffer.from(JSON.stringify(data), "utf8")
            ).toUpperCase();
            const head = {
                ib: String(ib),
                gib,
                data,
                rel8ns: {
                    ...(parent.rel8ns && typeof parent.rel8ns === "object"
                        ? parent.rel8ns
                        : {}),
                    past: [existing.addr],
                    dna: Array.isArray(parent.rel8ns?.dna) ? parent.rel8ns.dna : [],
                    tjp: Array.isArray(parent.rel8ns?.tjp) ? parent.rel8ns.tjp : [],
                },
            };
            const envelope = {
                transform: "mut8",
                newIbGib: head,
                dnas: [],
                intermediateIbGibs: [],
            };
            const body = Buffer.from(JSON.stringify(envelope), "utf8");
            const payment = this.resolveMutationPayment({
                store,
                headers,
                existingFrame: parent,
                newFrame: head,
            });
            if (!payment.ok) {
                return {
                    status: payment.status || 401,
                    body: JSON.stringify({
                        error: payment.error || "usage payment required",
                    }),
                    type: "application/json",
                };
            }
            return await this.applyCommitEnvelope(
                ib,
                envelope,
                body,
                headers,
                payment
            );
        }

        /**
         * @param {object|null} payment — from resolveMutationPayment; null when opts.relay
         */
        async applyCommitEnvelope(ib, envelope, bodyBuf, headers, payment, opts = {}) {
            const store = this.ensureStore();
            const relay = !!opts.relay;
            const relayUuid = String(opts.relayUuid || "").trim();
            const transform = String(envelope.transform || "").trim();
            const head = envelope.newIbGib;
            if (!head || head.ib == null || head.gib == null) {
                return {
                    status: 400,
                    body: JSON.stringify({ error: "newIbGib.ib/gib required" }),
                    type: "application/json",
                };
            }
            if (String(head.ib) !== String(ib)) {
                return {
                    status: 400,
                    body: JSON.stringify({
                        error: `newIbGib.ib (${head.ib}) must match route (${ib})`,
                    }),
                    type: "application/json",
                };
            }
            if (!relay && this.isRelayParkIb(ib)) {
                return this.relayParkWriteForbidden(ib);
            }

            if (!relay) {
                if (!payment || !payment.ok || !Array.isArray(payment.tokens)) {
                    return {
                        status: 401,
                        body: JSON.stringify({
                            error: "usage payment required for mutation",
                        }),
                        type: "application/json",
                    };
                }
            }

            const existing = store.getTip(ib);
            if (existing?.tombstone) {
                // treat as open first write after tombstone
            }

            if (!existing || existing.tombstone) {
                if (transform && transform !== "firstGen") {
                    return {
                        status: 400,
                        body: JSON.stringify({
                            error: "first write requires transform firstGen",
                        }),
                        type: "application/json",
                    };
                }
                const gate = relay ? null : genesisGateFor(store, ib);
                if (gate) {
                    const auth = authorizeWrite(store, null, {
                        ib,
                        parentAddr: "",
                        body: bodyBuf,
                        headers,
                        policyAddr: gate.policyAddr,
                        fn: "authorize_genesis",
                        transform: "firstGen",
                        parkRequest: this.makeParkRequestController({
                            deadline: Date.now() + SCHEMA_TIMEOUT_MS,
                            headers,
                        }),
                    });
                    if (!auth.allow) {
                        return {
                            status: 401,
                            body: JSON.stringify({
                                error: auth.error || "unauthorized",
                                hint: `firstGen under '${gate.governor}' is gated by its genesis_policy`,
                                governor: gate.governor,
                                via: auth.via,
                                policyAddr: auth.policyAddr,
                                schemaAddr: auth.schemaAddr,
                            }),
                            type: "application/json",
                        };
                    }
                }
            } else {
                if (transform && transform !== "mut8" && transform !== "rel8") {
                    // allow omit; still require past link
                }
                const past = head.rel8ns?.past;
                const parentAddr = existing.addr;
                const linked =
                    Array.isArray(past) && past.map(String).includes(parentAddr);
                if (!linked) {
                    return {
                        status: 400,
                        body: JSON.stringify({
                            error: "mut8 commit must rel8ns.past include parent tip addr",
                            parentAddr,
                        }),
                        type: "application/json",
                    };
                }
                const auth = authorizeWrite(store, existing.frame, {
                    ib,
                    parentAddr,
                    body: bodyBuf,
                    headers,
                    parkRequest: this.makeParkRequestController({
                        deadline: Date.now() + SCHEMA_TIMEOUT_MS,
                        headers,
                    }),
                });
                if (!relay && !auth.allow) {
                    return {
                        status: 401,
                        body: JSON.stringify({
                            error: auth.error || "unauthorized",
                            hint:
                                "Satisfy schema/policy signatures (proposal-write-v1) or use /foobarch/admin",
                            valid: auth.valid,
                            threshold: auth.threshold,
                            via: auth.via,
                            policyAddr: auth.policyAddr,
                            schemaAddr: auth.schemaAddr,
                        }),
                        type: "application/json",
                    };
                }
                if (relay) {
                    const owner = this.relayParkOwnerUuid(existing.frame);
                    const expired = this.isRelayFrameExpired(existing.frame);
                    // Soft-expire is only a callin gate. Same uuid may always
                    // renew; any connected shell may reclaim an expired park.
                    if (owner && owner !== relayUuid && !expired) {
                        return {
                            status: 403,
                            body: JSON.stringify({
                                error: "relay commit: uuid does not own this park",
                            }),
                            type: "application/json",
                        };
                    }
                }
            }

            let result;
            try {
                result = store.persistTransform(envelope);
            } catch (err) {
                const msg = err.message || String(err);
                const conflict = String(msg).includes("cannot gate");
                return {
                    status: conflict ? 409 : 500,
                    body: JSON.stringify({ error: msg }),
                    type: "application/json",
                };
            }

            let reserveAddr = null;
            if (!relay && payment) {
                if (payment.mode === "reserve") {
                    const dropped = this.hostMut8ReserveDrop(
                        store,
                        payment.reserveIb,
                        2
                    );
                    if (!dropped.ok) {
                        return {
                            status: dropped.status || 500,
                            body: JSON.stringify({
                                error: dropped.error || "token_reserve mut8 failed",
                                content_addr: result.addr,
                                hint:
                                    "content tip advanced but reserve index was not updated",
                            }),
                            type: "application/json",
                        };
                    }
                    reserveAddr = dropped.addr;
                    const c0 = store.consumeToken(
                        payment.tokens[0],
                        dropped.addr
                    );
                    const c1 = store.consumeToken(
                        payment.tokens[1],
                        result.addr
                    );
                    if (!c0.ok || !c1.ok) {
                        return {
                            status: (!c0.ok ? c0.status : c1.status) || 403,
                            body: JSON.stringify({
                                error:
                                    (!c0.ok ? c0.error : c1.error) ||
                                    "usage token consume failed",
                                content_addr: result.addr,
                                reserve_addr: reserveAddr,
                            }),
                            type: "application/json",
                        };
                    }
                } else {
                    for (const tok of payment.tokens) {
                        const consumed = store.consumeToken(tok, result.addr);
                        if (!consumed.ok) {
                            return {
                                status: consumed.status,
                                body: JSON.stringify({ error: consumed.error }),
                                type: "application/json",
                            };
                        }
                    }
                }
            }

            const bodyObj = {
                status: "ok",
                transform: transform || (existing ? "mut8" : "firstGen"),
                ib,
                addr: result.addr,
                park: !!head?.data?.park,
                addrs: result.addrs,
            };
            if (payment?.mode) bodyObj.payment = payment.mode;
            if (reserveAddr) {
                bodyObj.reserve_ib = payment.reserveIb;
                bodyObj.reserve_addr = reserveAddr;
            }

            return {
                status: existing && !existing.tombstone ? 200 : 201,
                body: JSON.stringify(bodyObj),
                type: "application/json",
                headers: { "X-Foobarch-ib^gib": result.addr },
            };
        }

        async handleGetPayload(resolved, method, opts = {}) {
            const store = this.ensureStore();
            const frame = resolved.frame;
            if (!frame) {
                return { status: 404, body: "not found\n", type: "text/plain" };
            }
            const unavailable = this.relayFrameUnavailable(resolved);
            if (unavailable) {
                return this.relayParkGoneResponse(unavailable, false);
            }

            const methodU = String(method || "GET").toUpperCase();
            const accept = this.headerGet(opts.headers, "accept");
            if (
                (methodU === "GET" || methodU === "HEAD") &&
                this.wantsFrameSnapshot(accept)
            ) {
                const shas = this.snapshotBinShas(frame, opts.headers);
                if (shas.length) {
                    return this.buildFrameSnapshot(resolved, store, shas, methodU);
                }
                const json = JSON.stringify(frame, null, 2);
                return {
                    status: 200,
                    body: methodU === "HEAD" ? "" : json,
                    type: "application/eframe; charset=utf-8",
                    headers: { "X-Foobarch-ib^gib": resolved.addr, "X-Foobarch-Bins": "" },
                };
            }
            if (
                (methodU === "GET" || methodU === "HEAD") &&
                this.wantsIbGibFrame(accept)
            ) {
                const json = JSON.stringify(frame, null, 2);
                return {
                    status: 200,
                    body: methodU === "HEAD" ? "" : json,
                    type: "application/eframe; charset=utf-8",
                    headers: { "X-Foobarch-ib^gib": resolved.addr },
                };
            }

            const ctrl = this.httpControl(frame, methodU === "HEAD" ? "GET" : methodU);
            if (!ctrl) {
                return {
                    status: 405,
                    body: JSON.stringify({ error: `no http control for ${method}` }),
                    type: "application/json",
                };
            }

            const kind = String(ctrl.kind || "bin").toLowerCase();

            if (kind === "navi_shell") {
                if (
                    methodU !== "POST" &&
                    methodU !== "GET" &&
                    methodU !== "HEAD"
                ) {
                    return {
                        status: 405,
                        body: JSON.stringify({
                            error: "navi_shell parks are GET or POST only",
                        }),
                        type: "application/json",
                    };
                }
                const token =
                    this.headerGet(opts.headers, NAVI_SHELL_TOKEN_HEADER) ||
                    this.headerGet(opts.headers, USAGE_TOKEN_HEADER);
                const relayAlias = String(frame.ib || "").replace(/^navi-/i, "");
                const aliasSha = this.relayAliasTokenSha(frame);
                if (aliasSha && !this.relayAliasTokenOk(aliasSha, token)) {
                    return this.relayErrorResponse(401, "bad relay alias token", {
                        via: "hostparkinator_5000",
                        alias: relayAlias,
                        header: NAVI_SHELL_TOKEN_HEADER,
                    });
                }
                const uuid = String(
                    ctrl.target || frame.data?.navi_shell_uuid || ""
                ).trim();
                if (!uuid) {
                    return {
                        status: 500,
                        body: JSON.stringify({
                            error: "navi_shell control missing target uuid",
                        }),
                        type: "application/json",
                    };
                }
                const bodyStr =
                    methodU === "GET" || methodU === "HEAD"
                        ? ""
                        : opts.bodyBuf && opts.bodyBuf.length
                          ? Buffer.from(opts.bodyBuf).toString("utf8")
                          : "";
                const relay = await this.relayNaviShellCallin(
                    uuid,
                    token,
                    resolved.remainder || "",
                    bodyStr,
                    {
                        method: methodU,
                        path: opts.path || "",
                        headers: opts.headers || {},
                        alias: relayAlias,
                        aliasSha,
                    }
                );
                if (methodU === "HEAD" && relay.status >= 200 && relay.status < 300) {
                    return { ...relay, body: "" };
                }
                return relay;
            }

            if (kind === "frame" || kind === "manifest") {
                const json = JSON.stringify(frame, null, 2);
                return {
                    status: 200,
                    body: methodU === "HEAD" ? "" : json,
                    type: "application/eframe; charset=utf-8",
                    headers: { "X-Foobarch-ib^gib": resolved.addr },
                };
            }

            if (kind === "relay") {
                // Front door to a navi relayed by this host: target = alias, path = park
                // path inside that navi. Internal dispatch keeps the caller's headers
                // (X-Forwarded-For etc.) that an HTTP hop through the front proxy would drop.
                const alias = String(ctrl.target || frame.data?.relay_alias || "")
                    .trim()
                    .replace(/^navi-/i, "");
                if (!/^[a-zA-Z0-9._-]+$/.test(alias)) {
                    return {
                        status: 500,
                        body: JSON.stringify({ error: "relay control needs target alias ([a-zA-Z0-9._-]+)" }),
                        type: "application/json",
                    };
                }
                const hops = Number(opts.redirectHops) || 0;
                if (hops >= 8) {
                    return {
                        status: 508,
                        body: JSON.stringify({ error: "relay hop limit exceeded", hops }),
                        type: "application/json",
                    };
                }
                const sub = String(ctrl.path || frame.data?.relay_path || "").replace(/^\/+|\/+$/g, "");
                const rem = String(resolved.remainder || "").replace(/^\/+/, "");
                const relayPath = [`/navi-${alias}`, sub, rem].filter(Boolean).join("/");
                const result = await this.dispatch({
                    method,
                    url: relayPath + (opts.search || ""),
                    headers: opts.headers || {},
                    bodyBuf: opts.bodyBuf || Buffer.alloc(0),
                    internal: true,
                    redirectHops: hops + 1,
                });
                return {
                    ...result,
                    headers: { ...(result.headers || {}), "X-Foobarch-Relay": relayPath },
                };
            }

            if (kind === "proxy") {
                const target = String(ctrl.target || frame.data?.proxy_target || "");
                if (!target) {
                    return {
                        status: 500,
                        body: JSON.stringify({ error: "proxy control missing target" }),
                        type: "application/json",
                    };
                }
                let url = target;
                if (resolved.remainder) {
                    const rem = resolved.remainder.replace(/^\/+/, "");
                    url = target.replace(/\/+$/, "") + "/" + rem;
                }
                if (opts.search) url += opts.search;
                try {
                    /** @type {RequestInit} */
                    const init = {
                        method: method === "HEAD" ? "GET" : method,
                        headers: this.proxyForwardHeaders(opts.headers || {}),
                    };
                    if (
                        method !== "GET" &&
                        method !== "HEAD" &&
                        opts.bodyBuf &&
                        opts.bodyBuf.length
                    ) {
                        init.body = opts.bodyBuf;
                    }
                    const res = await fetch(url, init);
                    const buf = Buffer.from(await res.arrayBuffer());
                    const ct =
                        res.headers.get("content-type") || "application/octet-stream";
                    /** @type {Record<string, string>} */
                    const outHdrs = { "X-Foobarch-Proxy": url };
                    // Surface useful upstream X-* (e.g. x-flowerpot-ib^gib).
                    res.headers.forEach((v, k) => {
                        const lk = String(k).toLowerCase();
                        if (lk.startsWith("x-") && lk !== "x-foobarch-proxy") {
                            outHdrs[k] = v;
                        }
                    });
                    return {
                        status: res.status,
                        body: method === "HEAD" ? "" : buf,
                        type: ct,
                        headers: outHdrs,
                    };
                } catch (err) {
                    return {
                        status: 502,
                        body: JSON.stringify({ error: err.message || String(err) }),
                        type: "application/json",
                    };
                }
            }

            if (kind === "redirect") {
                // Internal redispatch: target is a route ib (same as URL path after
                // host). Leading "/" optional — both "flowerpot" and "/flowerpot"
                // go through pathToIb / resolveRoute like any other request.
                const hops = Number(opts.redirectHops) || 0;
                const maxHops = 8;
                if (hops >= maxHops) {
                    return {
                        status: 508,
                        body: JSON.stringify({
                            error: "redirect hop limit exceeded",
                            hops,
                        }),
                        type: "application/json",
                    };
                }
                const target = String(
                    ctrl.target || frame.data?.redirect_target || ""
                ).trim();
                if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) {
                    return {
                        status: 500,
                        body: JSON.stringify({
                            error:
                                "redirect target must be a route ib/path (not an absolute URL)",
                        }),
                        type: "application/json",
                    };
                }
                // Same join as proxy keep: target ib + "/" + remainder (if any).
                let ibPath = this.pathToIb(target);
                if (resolved.remainder) {
                    const rem = String(resolved.remainder).replace(/^\/+/, "");
                    ibPath = ibPath
                        ? ibPath.replace(/\/+$/, "") + "/" + rem
                        : rem;
                }
                const path = "/" + ibPath;
                const nextUrl = path + (opts.search || "");
                const result = await this.dispatch({
                    method,
                    url: nextUrl,
                    headers: opts.headers || {},
                    bodyBuf: opts.bodyBuf || Buffer.alloc(0),
                    internal: true,
                    redirectHops: hops + 1,
                });
                return {
                    ...result,
                    headers: {
                        ...(result.headers || {}),
                        "X-Foobarch-Redirect": path,
                    },
                };
            }

            if (kind === "lua") {
                const store = this.ensureStore();
                const script = resolveLuaScriptSource(store, ctrl, resolved.addr);
                if (!script.source) {
                    return {
                        status: 500,
                        body: JSON.stringify({
                            error: script.error || "lua script missing",
                        }),
                        type: "application/json",
                    };
                }
                const deadline = Date.now() + LUA_TIMEOUT_MS;
                const parkRequest = this.makeParkRequestController({
                    deadline,
                    headers: opts.headers || {},
                    hops: Number(opts.luaHops) || 0,
                });
                /** @type {Record<string, string>} */
                const hdrs = {};
                for (const [k, v] of Object.entries(opts.headers || {})) {
                    hdrs[String(k).toLowerCase()] = Array.isArray(v)
                        ? String(v[0])
                        : String(v);
                }
                const reqCtx = {
                    method: method === "HEAD" ? "GET" : method,
                    path: "/" + (resolved.ib || resolved.frame?.ib || ""),
                    remainder: resolved.remainder || "",
                    search: opts.search || "",
                    headers: hdrs,
                    tip: {
                        ib: frame.ib,
                        addr: resolved.addr,
                        data: frame.data || {},
                        rel8ns: frame.rel8ns || {},
                    },
                    script_addr: script.scriptAddr,
                };
                const run = runLuaHandle(store, script.source, reqCtx, {
                    bodyBuf: opts.bodyBuf || Buffer.alloc(0),
                    parkRequest,
                    timeoutMs: LUA_TIMEOUT_MS,
                });
                if (!run.ok) {
                    return {
                        status: run.status || 500,
                        body: JSON.stringify({ error: run.error }),
                        type: "application/json",
                    };
                }
                return mapLuaHttpResult(store, run.result, method);
            }

            // kind=mod + Accept application/navi-mod → multipart eframe + bin
            if (kind === "mod" && this.wantsNaviModPackage(accept)) {
                return this.buildNaviModPackage(resolved, store);
            }

            const picked = selectBinRef(frame, ctrl, resolved.remainder);
            if (!picked.ref) {
                return {
                    status: picked.status || 404,
                    body: JSON.stringify({
                        error: picked.error,
                        via: "hostparkinator_5000",
                        ib: frame?.ib || resolved.ib,
                    }),
                    type: "application/json",
                    headers: { "X-Foobarch-ib^gib": resolved.addr },
                };
            }
            const sha = picked.sha;
            const blob = store.getBin(sha);
            if (!blob) {
                return { status: 404, body: "bin missing\n", type: "text/plain" };
            }
            const ct =
                ctrl.content_type ||
                frame.data?.content_type ||
                blob.content_type ||
                "application/octet-stream";
            return {
                status: 200,
                body: method === "HEAD" ? "" : blob.bytes,
                type: ct,
                headers: { "X-Foobarch-ib^gib": resolved.addr, "X-Foobarch-Bin": sha },
            };
        }

        async handleFoobarchApi(method, pathname, headers, bodyBuf, requestUrl) {
            const store = this.ensureStore();
            const parts = pathname.replace(/^\/+/, "").split("/").filter(Boolean);
            // parts[0] === foobarch
            const op = parts[1] || "";
            let searchIb = "";
            let searchAddr = "";
            try {
                const u = new URL(requestUrl || "/", "http://local");
                searchIb = u.searchParams.get("ib") || "";
                searchAddr = u.searchParams.get("addr") || "";
            } catch {
                /* ignore */
            }

            // tip/frame/span serve the same frames as their parks; same read gate.
            const readDenied = (tipOrFrame) => {
                const tipFrame = tipOrFrame?.frame || tipOrFrame;
                if (!tipFrame) return null;
                const auth = authorizeAccess(store, tipFrame, {
                    ib: tipFrame.ib,
                    method: "GET",
                    headers,
                    body: Buffer.alloc(0),
                });
                if (auth.allow) return null;
                return {
                    status: auth.aside_ok === false ? 403 : 401,
                    body: JSON.stringify({
                        error: auth.error || "read unauthorized",
                        via: auth.via,
                        policyAddr: auth.policyAddr,
                    }),
                    type: "application/json",
                };
            };

            if (op === "tokens") {
                if (method !== "POST") {
                    return { status: 405, body: "POST only\n", type: "text/plain" };
                }
                const pwd = this.headerGet(headers, USAGE_PASSWORD_HEADER);
                if (pwd !== this.usagePassword()) {
                    return { status: 401, body: "bad password\n", type: "text/plain" };
                }
                let count = 1;
                try {
                    const j = JSON.parse(bodyBuf.toString("utf8") || "{}");
                    count = Math.min(100, Math.max(1, Number(j.count) || 1));
                } catch {
                    count = 1;
                }
                const tokens = store.mintTokens(count);
                return {
                    status: 200,
                    body: JSON.stringify({ tokens }),
                    type: "application/json",
                };
            }

            if (op === "list") {
                if (method !== "GET") {
                    return { status: 405, body: "GET only\n", type: "text/plain" };
                }
                const pwd = this.headerGet(headers, USAGE_PASSWORD_HEADER);
                if (pwd !== this.usagePassword()) {
                    return {
                        status: 401,
                        body: "list requires usage password\n",
                        type: "text/plain",
                    };
                }
                return {
                    status: 200,
                    body: JSON.stringify({ tips: store.listTips(500, 0) }, null, 2),
                    type: "application/json",
                };
            }

            if (op === "tip") {
                if (method !== "GET") {
                    return { status: 405, body: "GET only\n", type: "text/plain" };
                }
                let ib = parts.slice(2).join("/");
                if (!ib) ib = searchIb;
                const tip = store.getTip(ib);
                if (!tip) {
                    return { status: 404, body: "no tip\n", type: "text/plain" };
                }
                const denied = readDenied(tip);
                if (denied) return denied;
                // ?data.<path>=<value> → newest frame on this ib whose data matches (any chain).
                const where = {};
                try {
                    const u = new URL(requestUrl || "/", "http://local");
                    for (const [k, v] of u.searchParams) {
                        if (k.startsWith("data.") && k.length > 5) where[k.slice(5)] = v;
                    }
                } catch {
                    /* ignore */
                }
                if (Object.keys(where).length) {
                    const hit = store.latestVersionWhere(tip.ib, where);
                    if (!hit) {
                        return { status: 404, body: "no frame on this ib matches\n", type: "text/plain" };
                    }
                    return {
                        status: 200,
                        body: JSON.stringify(
                            { ...hit, tombstone: tip.tombstone, latest: hit.addr === tip.addr, where },
                            null,
                            2
                        ),
                        type: "application/eframe; charset=utf-8",
                    };
                }
                return {
                    status: 200,
                    body: JSON.stringify(tip, null, 2),
                    type: "application/eframe; charset=utf-8",
                };
            }

            if (op === "frame") {
                if (method !== "GET") {
                    return { status: 405, body: "GET only\n", type: "text/plain" };
                }
                const addr = parts.slice(2).join("/") || searchAddr;
                const frame = store.getFrame(addr);
                if (!frame) {
                    return { status: 404, body: "no frame\n", type: "text/plain" };
                }
                const denied = readDenied((frame.ib && store.getTip(frame.ib)) || frame);
                if (denied) return denied;
                return {
                    status: 200,
                    body: JSON.stringify(frame, null, 2),
                    type: "application/eframe; charset=utf-8",
                };
            }

            if (op === "span") {
                if (method !== "GET") {
                    return { status: 405, body: "GET only\n", type: "text/plain" };
                }
                let ib = parts.slice(2).join("/");
                if (!ib) ib = searchIb;
                const tip = store.getTip(ib);
                if (!tip) {
                    return { status: 404, body: "no tip\n", type: "text/plain" };
                }
                const denied = readDenied(tip);
                if (denied) return denied;
                let dir = "reverse";
                let limit;
                let offset = 0;
                let addrsOnly = false;
                try {
                    const u = new URL(requestUrl || "/", "http://local");
                    dir = u.searchParams.get("dir") || dir;
                    if (u.searchParams.has("limit")) {
                        limit = Number(u.searchParams.get("limit"));
                    }
                    if (u.searchParams.has("offset")) {
                        offset = Number(u.searchParams.get("offset"));
                    }
                    const ao = u.searchParams.get("addrsOnly");
                    addrsOnly = ao === "1" || ao === "true";
                } catch {
                    /* ignore */
                }
                // Only a bounded reverse span can stop early (forward starts at the root).
                const walkMax =
                    normalizeSpanDir(dir) === "reverse" && Number.isFinite(limit)
                        ? Math.max(0, Math.floor(Number(offset) || 0)) +
                          Math.max(0, Math.floor(limit))
                        : undefined;
                const chain = store.walkLineage(ib, walkMax);
                const hits = orderSpanHits(chain, { dir, limit, offset });
                const payload = {
                    ib,
                    dir: normalizeSpanDir(dir),
                    hits: addrsOnly ? hits.map((h) => h.addr) : hits,
                };
                return {
                    status: 200,
                    body: JSON.stringify(payload, null, 2),
                    type: "application/json",
                };
            }

            if (op === "admin") {
                const pwd = this.headerGet(headers, USAGE_PASSWORD_HEADER);
                if (pwd !== this.usagePassword()) {
                    return { status: 401, body: "admin requires usage password\n", type: "text/plain" };
                }
                const action = parts[2] || "";
                if (action === "delete" && method === "DELETE") {
                    const ib = parts.slice(3).join("/");
                    const r = store.hardDeleteIb(ib);
                    return {
                        status: 200,
                        body: JSON.stringify(r),
                        type: "application/json",
                    };
                }
                if ((action === "frame" || action === "bin") && method === "DELETE") {
                    const key = parts
                        .slice(3)
                        .map((s) => {
                            try {
                                return decodeURIComponent(s);
                            } catch {
                                return s;
                            }
                        })
                        .join("/");
                    const r = action === "frame" ? store.purgeFrame(key) : store.purgeBin(key);
                    return {
                        status: 200,
                        body: JSON.stringify(r),
                        type: "application/json",
                    };
                }
                if (action === "reindex" && method === "POST") {
                    const n = store.reindexParks();
                    return {
                        status: 200,
                        body: JSON.stringify({ reindexed: n }),
                        type: "application/json",
                    };
                }
                if (action === "password" && method === "PUT") {
                    let pwdNew = "";
                    try {
                        pwdNew = String(JSON.parse(bodyBuf.toString("utf8")).password || "");
                    } catch {
                        pwdNew = bodyBuf.toString("utf8").trim();
                    }
                    this.setUsagePassword(pwdNew);
                    return {
                        status: 200,
                        body: JSON.stringify({ ok: true }),
                        type: "application/json",
                    };
                }
                return {
                    status: 400,
                    body: JSON.stringify({
                        error: "admin actions: DELETE /foobarch/admin/delete/{ib}, DELETE /foobarch/admin/frame/{addr}, DELETE /foobarch/admin/bin/{sha256}, POST /foobarch/admin/reindex, PUT /foobarch/admin/password",
                    }),
                    type: "application/json",
                };
            }

            return {
                status: 404,
                body: JSON.stringify({
                    error: "foobarch api",
                    routes: [
                        "POST /foobarch/tokens",
                        "GET /foobarch/list (usage password)",
                        "GET /foobarch/tip/{ib}",
                        "GET /foobarch/tip/{ib}?data.{path}={value} (newest frame on ib whose data matches, any chain)",
                        "GET /foobarch/frame/{addr}",
                        "GET /foobarch/span/{ib}?dir=reverse|forward|all&limit=&offset=&addrsOnly=",
                        "DELETE /foobarch/admin/delete/{ib}",
                        "DELETE /foobarch/admin/frame/{addr}",
                        "DELETE /foobarch/admin/bin/{sha256}",
                        "POST /foobarch/admin/reindex",
                        "PUT /foobarch/admin/password",
                    ],
                }),
                type: "application/json",
            };
        }

        async dispatch(reqLike) {
            const method = String(reqLike.method || "GET").toUpperCase();
            const url = new URL(reqLike.url || "/", "http://local");
            const pathname = this.normalizePath(url.pathname);
            const headers = reqLike.headers || {};
            const outHeaders = {};
            this._lastReqHost = String(
                this.headerGet(headers, "x-forwarded-host") ||
                    this.headerGet(headers, "host") ||
                    ""
            )
                .split(",")[0]
                .trim()
                .toLowerCase();

            if (method === "OPTIONS") {
                return {
                    status: 204,
                    body: "",
                    type: "text/plain",
                    headers: {
                        "Access-Control-Allow-Origin": "*",
                        "Access-Control-Allow-Headers":
                            "Content-Type, X-Foobarch-Usage-Token, X-Foobarch-Usage-Password, X-Foobarch-Sign-Keys, X-Foobarch-Signatures, X-Foobarch-Read-Timestamp, X-Flowerpot-Sign-Keys, X-Flowerpot-Signatures, X-Flowerpot-Read-Timestamp, X-Flowerpot-Usage-Password, X-Flowerpot-Usage-Token, X-Navi-Shell-Usage-Token, X-Navi-Shell-Wait, X-Navi-Gate-Passthru",
                        "Access-Control-Allow-Methods":
                            "GET, HEAD, POST, PUT, PATCH, DELETE, QUERY, OPTIONS",
                    },
                };
            }

            if (pathname === "/" || pathname === "") {
                if (!reqLike.internal && this.isBrowserRequest(reqLike)) {
                    return {
                        status: 200,
                        body: this.shellHtml(""),
                        type: "text/html; charset=utf-8",
                    };
                }
                return {
                    status: 200,
                    body: "Foobarch Host (ibgib-native) — GET /foobarch/list (password)\n",
                    type: "text/plain",
                };
            }

            if (pathname === "/_foobarch/frame" || pathname.startsWith("/_foobarch/frame")) {
                const addr = url.searchParams.get("addr") || "";
                const store = this.ensureStore();
                const frame = store.getFrame(addr);
                if (!frame) {
                    return { status: 404, body: "no frame\n", type: "text/plain" };
                }
                const gate = (frame.ib && store.getTip(frame.ib)?.frame) || frame;
                const auth = authorizeAccess(store, gate, {
                    ib: gate.ib,
                    method: "GET",
                    headers,
                    body: Buffer.alloc(0),
                });
                if (!auth.allow) {
                    return {
                        status: auth.aside_ok === false ? 403 : 401,
                        body: JSON.stringify({ error: auth.error || "read unauthorized", via: auth.via }),
                        type: "application/json",
                    };
                }
                return {
                    status: 200,
                    body: JSON.stringify(frame, null, 2),
                    type: "application/eframe; charset=utf-8",
                };
            }

            // Async callin job peek/claim: GET /_foobarch/navi_shell/job/{uuid}/{jobId}
            {
                const jobMatch = pathname.match(
                    /^\/_foobarch\/navi_shell\/job\/([^/]+)\/([^/]+)\/?$/i
                );
                if (jobMatch && (method === "GET" || method === "HEAD")) {
                    const shellUuid = decodeURIComponent(jobMatch[1]);
                    const jobId = decodeURIComponent(jobMatch[2]);
                    const token =
                        this.headerGet(headers, NAVI_SHELL_TOKEN_HEADER) ||
                        this.headerGet(headers, USAGE_TOKEN_HEADER) ||
                        url.searchParams.get("token") ||
                        "";
                    const relay = this.naviShellJobResponse(
                        shellUuid,
                        token,
                        jobId
                    );
                    if (method === "HEAD" && relay.status >= 200 && relay.status < 300) {
                        return { ...relay, body: "" };
                    }
                    return relay;
                }
            }

            const first = pathname.replace(/^\/+/, "").split("/")[0];
            if (first === "foobarch") {
                const bodyBuf = reqLike.bodyBuf || Buffer.alloc(0);
                return await this.handleFoobarchApi(
                    method,
                    pathname,
                    headers,
                    bodyBuf,
                    reqLike.url
                );
            }

            // Browser document navigate → shell wrap (skip on internal redirect
            // and skip navi_shell parks so the remote caller sees callin result
            // or the JSON error body).
            const wrapResolved = this.resolveRoute(pathname, { headers });
            const wrapCtrl = wrapResolved?.frame
                ? this.httpControl(
                      wrapResolved.frame,
                      method === "HEAD" ? "GET" : method
                  )
                : null;
            const wrapKind = String(wrapCtrl?.kind || "").toLowerCase();
            if (
                !reqLike.internal &&
                method === "GET" &&
                this.isBrowserRequest(reqLike) &&
                this.isDirectNavigation(reqLike) &&
                wrapKind !== "navi_shell"
            ) {
                return {
                    status: 200,
                    body: this.shellHtml(pathname + (url.search || "")),
                    type: "text/html; charset=utf-8",
                };
            }

            const ib = this.pathToIb(pathname);
            const bodyBuf = reqLike.bodyBuf || Buffer.alloc(0);
            const payloadOpts = {
                bodyBuf,
                headers,
                search: url.search || "",
                path: pathname + (url.search || ""),
                redirectHops: Number(reqLike.redirectHops) || 0,
            };

            // Tip data.method[METHOD] drives every verb (GET/POST/PUT/PATCH/DELETE/QUERY/…).
            // Miss: PUT|PATCH → local firstGen; else 404.
            const resolved = this.resolveRoute(pathname, { headers });
            if (resolved.kind === "miss" || resolved.kind === "root") {
                if (method === "PUT" || method === "PATCH") {
                    return await this.handleCommitPut(ib, bodyBuf, headers);
                }
                if (method === "DELETE") {
                    return await this.handleTombstone(ib, bodyBuf, headers);
                }
                return {
                    status: 404,
                    body:
                        resolved.reason === "gib_not_found"
                            ? `no frame ${resolved.addr || ib}\n`
                            : `no tip for ${ib}\n`,
                    type: "text/plain",
                };
            }

            if (resolved.kind === "park" || resolved.kind === "tip") {
                const ctrl = this.httpControl(resolved.frame, method);
                if (!ctrl) {
                    return {
                        status: 405,
                        body: JSON.stringify({
                            error: `no method control for ${method}`,
                        }),
                        type: "application/json",
                    };
                }
                const kind = String(ctrl.kind || "bin").toLowerCase();
                if (kind === "commit") {
                    // Exact request path ib (not park tip alone).
                    return await this.handleCommitPut(ib, bodyBuf, headers);
                }
                if (kind === "tombstone") {
                    return await this.handleTombstone(ib, bodyBuf, headers);
                }
                if (
                    kind === "proxy" ||
                    kind === "relay" ||
                    kind === "redirect" ||
                    kind === "bin" ||
                    kind === "mod" ||
                    kind === "frame" ||
                    kind === "manifest" ||
                    kind === "lua" ||
                    kind === "navi_shell"
                ) {
                    const accessAuth = authorizeAccess(this.ensureStore(), resolved.frame, {
                        ib: resolved.frame?.ib || ib,
                        method,
                        headers,
                        body: bodyBuf,
                        parkRequest: this.makeParkRequestController({
                            deadline: Date.now() + SCHEMA_TIMEOUT_MS,
                            headers,
                        }),
                    });
                    if (!accessAuth.allow) {
                        return {
                            status: accessAuth.aside_ok === false ? 403 : 401,
                            body: JSON.stringify({
                                error: accessAuth.error || `${method} unauthorized`,
                                via: accessAuth.via,
                                policyAddr: accessAuth.policyAddr,
                                schemaAddr: accessAuth.schemaAddr,
                            }),
                            type: "application/json",
                        };
                    }
                    return await this.handleGetPayload(resolved, method, payloadOpts);
                }
                return {
                    status: 405,
                    body: JSON.stringify({
                        error: `${method} kind '${kind}' not supported`,
                    }),
                    type: "application/json",
                };
            }

            return { status: 404, body: "not found\n", type: "text/plain", headers: outHeaders };
        }

        async handleRequest(req, res) {
            try {
                const bodyBuf = await this.readBody(req);
                const reqHeaders = { ...req.headers };
                if (!reqHeaders["x-forwarded-for"] && req.socket?.remoteAddress) {
                    reqHeaders["x-forwarded-for"] = String(req.socket.remoteAddress).replace(/^::ffff:/, "");
                }
                const result = await this.dispatch({
                    method: req.method,
                    url: req.url,
                    headers: reqHeaders,
                    bodyBuf,
                });
                const headers = {
                    "Content-Type": result.type || "text/plain",
                    "Access-Control-Allow-Origin": "*",
                    ...(result.headers || {}),
                };
                // Relay parks are live presence — never let Safari/PWA cache a
                // prior 410/503 over a renewed tip (memory cache sits above SW).
                try {
                    const leaf = String(req.url || "")
                        .split("?")[0]
                        .replace(/^\/+/, "")
                        .split("/")[0];
                    if (this.isRelayParkIb(leaf)) {
                        headers["Cache-Control"] = "no-store";
                    }
                } catch {
                    /* ignore */
                }
                const body = result.body ?? "";
                if (Buffer.isBuffer(body)) {
                    headers["Content-Length"] = String(body.length);
                    res.writeHead(result.status || 200, headers);
                    res.end(body);
                } else {
                    const buf = Buffer.from(String(body), "utf8");
                    headers["Content-Length"] = String(buf.length);
                    res.writeHead(result.status || 200, headers);
                    res.end(buf);
                }
            } catch (err) {
                warn("request failed", err);
                res.writeHead(500, { "Content-Type": "text/plain" });
                res.end(String(err.message || err));
            }
        }

        async start(port) {
            ensureNative();
            await this.loadState();
            if (port != null && port !== "") {
                this.port = Number(port) || DEFAULT_PORT;
            }
            this.ensureStore();
            // Schema gates need fengari; seed AppData vendor if missing.
            const eng = loadFengari();
            if (!eng) {
                warn(
                    "fengari unavailable at start — gated mut8 will fail until: hostparkinator_5000 vendor"
                );
            }
            if (this.listening) {
                return `hostparkinator_5000 already listening on ${this.host}:${this.port}`;
            }
            const http = nodeRequire("http");
            this._server = http.createServer((req, res) => {
                void this.handleRequest(req, res);
            });
            this._server.on("upgrade", (req, socket, head) => {
                this.handleNaviShellUpgrade(req, socket, head);
            });
            await new Promise((resolve, reject) => {
                this._server.once("error", reject);
                this._server.listen(this.port, this.host, () => resolve());
            });
            this.listening = true;
            await this.persistPort();
            const msg = `hostparkinator_5000 listening on http://${this.host}:${this.port} db=${this.dbPath}${
                _fengariPath ? ` fengari=${_fengariPath}` : " fengari=missing"
            }`;
            log(msg);
            return msg;
        }

        async stop() {
            if (!this.listening || !this._server) {
                return "hostparkinator_5000 not listening";
            }
            for (const uuid of [...this._naviShells.keys()]) {
                this.dropNaviShell(uuid);
            }
            await new Promise((resolve) => {
                this._server.close(() => resolve());
            });
            this._server = null;
            this.listening = false;
            if (this.store) {
                this.store.close();
                this.store = null;
            }
            return "hostparkinator_5000 stopped";
        }

        status() {
            return {
                id: "hostparkinator_5000",
                listening: this.listening,
                port: this.port,
                host: this.host,
                dbPath: this.dbPath || defaultDbPath(),
                staticDir: this.staticDir,
                fengari: _fengariPath || (loadFengari() ? _fengariPath : null),
            };
        }

        statusSize() {
            const dbPath = this.dbPath || defaultDbPath();
            const disk = sqliteFileSizes(dbPath);
            let tables = null;
            try {
                tables = this.ensureStore().payloadSizes();
            } catch (err) {
                tables = {
                    error: String(err && err.message ? err.message : err),
                };
            }
            return {
                dbPath,
                on_disk: { bytes: disk.total, size: disk.size },
                files: disk.files.filter((f) => f.exists || f.kind === "sqlite"),
                tables,
            };
        }

        /**
         * Seed navi_shell.js / sw.js as firstGen-style tips with bin + park + http controls.
         * Uses synthetic frames (gib = content hash) without full ts-gib — fine for bootstrap.
         */
        async seedFromStatic(staticDir) {
            const fs = nodeRequire("fs");
            const path = nodeRequire("path");
            const store = this.ensureStore();
            const dir = staticDir || this.staticDir;
            const files = [
                {
                    name: "navi_shell.js",
                    content_type: "application/javascript; charset=utf-8",
                },
                {
                    name: "sw.js",
                    content_type: "application/javascript; charset=utf-8",
                },
            ];
            const seeded = [];
            for (const f of files) {
                const fp = path.resolve(dir, f.name);
                if (!fs.existsSync(fp)) {
                    warn("seed skip missing", fp);
                    continue;
                }
                const bytes = fs.readFileSync(fp);
                const sha = sha256Hex(bytes);
                store.putBin(sha, bytes, f.content_type);
                const gib = sha.slice(0, 64).toUpperCase();
                const ibGib = {
                    ib: f.name,
                    gib,
                    data: {
                        parts: ["network_proposal", "ibgib_frame", "manifest", "json"],
                        park: "defer",
                        content_type: f.content_type,
                        default_method: "GET",
                        method: {
                            GET: { kind: "bin" },
                            PUT: { kind: "commit" },
                        },
                        n: 0,
                        timestamp: navi.stamp.time(),
                        seed: true,
                    },
                    rel8ns: {
                        bin: [`bin ${sha}`],
                        past: [],
                        tjp: [],
                        dna: [],
                    },
                };
                const token = store.mintTokens(1)[0];
                const envelope = {
                    transform: "firstGen",
                    newIbGib: ibGib,
                    dnas: [],
                    intermediateIbGibs: [],
                };
                // Bypass commit path token race: persist then consume
                const existing = store.getTip(f.name);
                if (existing && !existing.tombstone) {
                    seeded.push({ ib: f.name, skipped: true, addr: existing.addr });
                    continue;
                }
                const result = store.persistTransform(envelope);
                store.consumeToken(token, result.addr);
                seeded.push({ ib: f.name, addr: result.addr, sha });
            }
            return seeded;
        }

        /**
         * Seed stock write-gate schema tip(s) as open Lua tips (chicken-egg).
         * Lock later by mut8 + rel8ns.policy → a keys policy instance.
         */
        async seedSchemas() {
            const store = this.ensureStore();
            const seeded = [];
            const schemas = [
                {
                    ib: SCHEMA_KEYS_IB,
                    lua: KEYS_V1_LUA,
                    label: "keys_v1",
                },
            ];
            for (const s of schemas) {
                const existing = store.getTip(s.ib);
                if (existing && !existing.tombstone) {
                    seeded.push({
                        ib: s.ib,
                        skipped: true,
                        addr: existing.addr,
                    });
                    continue;
                }
                const bytes = Buffer.from(s.lua, "utf8");
                const sha = sha256Hex(bytes);
                store.putBin(sha, bytes, SCHEMA_CONTENT_TYPE);
                const gib = sha.slice(0, 64).toUpperCase();
                const ibGib = {
                    ib: s.ib,
                    gib,
                    data: {
                        parts: ["write_schema", "ibgib_frame", "manifest", "json"],
                        content_type: SCHEMA_CONTENT_TYPE,
                        schema_kind: s.label,
                        default_method: "GET",
                        method: {
                            GET: { kind: "bin" },
                            PUT: { kind: "commit" },
                            PATCH: { kind: "commit" },
                        },
                        n: 0,
                        timestamp: navi.stamp.time(),
                        seed: true,
                    },
                    rel8ns: {
                        bin: [`bin ${sha}`],
                        past: [],
                        tjp: [],
                        dna: [],
                    },
                };
                const token = store.mintTokens(1)[0];
                const result = store.persistTransform({
                    transform: "firstGen",
                    newIbGib: ibGib,
                    dnas: [],
                    intermediateIbGibs: [],
                    bin: {
                        sha256: sha,
                        bytes_b64: bytes.toString("base64"),
                        content_type: SCHEMA_CONTENT_TYPE,
                    },
                });
                store.consumeToken(token, result.addr);
                seeded.push({ ib: s.ib, addr: result.addr, sha });
            }
            return seeded;
        }
    }

    const svc = new FoobarchHost();

    const run = async (...args) => {
        ensureNative();
        const [cmd, ...rest] = args;
        const c = String(cmd || "help").toLowerCase();

        if (c === "help" || c === "--help" || c === "-h") {
            return [
                "hostparkinator_5000 — ibgib-native Foobarch (default localhost:5353)",
                "  start [port] | stop | status | status size",
                "  host [addr] | db [path] | static [dir]",
                "  password | password set <pwd>",
                "  mint [count] | list | tip <ib> | reindex",
                "  seed [staticDir] | seed schemas",
                "  admin delete <ib>",
                "  vendor | fengari                 ensure/load Lua VM (AppData vendor)",
                "  remount_host [route] | remount_host path [route]",
                "",
                "  Write gates: schema tip (Lua) → policy tip (keys) → content rel8ns.policy",
                `  Stock schema ib: ${SCHEMA_KEYS_IB} (hostparkinator_5000 seed schemas)`,
                "  Fengari: %APPDATA%\\.navi_shell\\hostparkinator_5000\\vendor\\fengari (or FOOBARCH_FENGARI)",
            ].join("\n");
        }

        await svc.loadState();

        if (c === "vendor" || c === "fengari") {
            resetFengari();
            const ensured = ensureFengariVendor();
            if (!ensured.ok) {
                throw new Error(ensured.error || "fengari vendor failed");
            }
            const eng = loadFengari();
            if (!eng) {
                throw new Error(`fengari still unloadable at ${ensured.path}`);
            }
            return [
                `fengari ok path=${_fengariPath || ensured.path}`,
                ensured.installed
                    ? `vendor installed from ${ensured.from}`
                    : "vendor already present",
            ].join("\n");
        }

        if (c === "start") return await svc.start(rest[0]);
        if (c === "stop") return await svc.stop();
        if (c === "status") {
            const sub = String(rest[0] || "").toLowerCase();
            if (sub === "size") {
                return JSON.stringify(svc.statusSize(), null, 2);
            }
            if (sub) {
                return `unknown status subcommand ${sub} — hostparkinator_5000 status | status size`;
            }
            return JSON.stringify(svc.status(), null, 2);
        }

        if (c === "remount_host" || c === "remount") {
            return await remountHost(rest);
        }

        if (c === "host") {
            if (rest[0]) {
                svc.host = String(rest[0]);
                await navi.storage.item.set(STORAGE.host, svc.host);
            }
            return `host=${svc.host}`;
        }
        if (c === "db") {
            if (rest[0]) {
                svc.dbPath = String(rest[0]);
                await navi.storage.item.set(STORAGE.dbPath, svc.dbPath);
                if (svc.store) {
                    svc.store.close();
                    svc.store = null;
                }
            }
            return `db=${svc.dbPath || defaultDbPath()}`;
        }
        if (c === "static") {
            if (rest[0]) {
                svc.staticDir = String(rest[0]);
                await navi.storage.item.set(STORAGE.staticDir, svc.staticDir);
            }
            return `static=${svc.staticDir}`;
        }
        if (c === "password") {
            svc.ensureStore();
            if (rest[0] === "set" && rest[1]) {
                svc.setUsagePassword(rest.slice(1).join(" "));
                return "password updated";
            }
            return `usage_password=${svc.usagePassword()}`;
        }
        if (c === "mint") {
            const n = Math.min(100, Math.max(1, Number(rest[0]) || 1));
            const tokens = svc.ensureStore().mintTokens(n);
            return JSON.stringify({ tokens }, null, 2);
        }
        if (c === "list") {
            return JSON.stringify({ tips: svc.ensureStore().listTips(500, 0) }, null, 2);
        }
        if (c === "tip") {
            const ib = rest.join("/");
            const tip = svc.ensureStore().getTip(ib);
            return tip ? JSON.stringify(tip, null, 2) : "no tip";
        }
        if (c === "reindex") {
            const n = svc.ensureStore().reindexParks();
            return `reindexed ${n} parks`;
        }
        if (c === "seed") {
            if (String(rest[0] || "").toLowerCase() === "schemas") {
                return JSON.stringify(await svc.seedSchemas(), null, 2);
            }
            const seeded = await svc.seedFromStatic(rest[0]);
            return JSON.stringify(seeded, null, 2);
        }
        if (c === "admin" && rest[0] === "delete") {
            const ib = rest.slice(1).join("/");
            return JSON.stringify(svc.ensureStore().hardDeleteIb(ib), null, 2);
        }

        return `unknown command ${c} — hostparkinator_5000 help`;
    };

    async function remountPathGet() {
        const v = await navi.storage.item.get(STORAGE.remountPath);
        const s = v == null ? "" : String(v).trim();
        return s || DEFAULT_REMOUNT_PATH;
    }

    async function remountPathSet(route) {
        let next = normalizeRemountRoute(route);
        if (!next) throw new Error("remount_host path requires a route");
        await navi.storage.item.set(STORAGE.remountPath, next);
        return next;
    }

    /**
     * Remount source is an arbitrary route (usually flowerpot/…), never a
     * callin URL. Heal shredded https/host → https://host if someone pasted one.
     */
    function normalizeRemountRoute(route) {
        let rel = String(route || "")
            .trim()
            .replace(/^\/+/, "");
        if (/^https?\/[^/]/i.test(rel) && !/^https?:\/\//i.test(rel)) {
            rel = rel.replace(/^(https?)\/+/i, "$1://");
        }
        return rel;
    }

    async function fetchRemountSource(route) {
        const rel = normalizeRemountRoute(route);
        if (!rel) throw new Error("empty remount route");

        const candidates = [];
        if (/^[a-z][a-z0-9+.-]*:\/\//i.test(rel)) {
            candidates.push(rel);
        } else {
            if (typeof navi.resolveUrl === "function") {
                candidates.push(navi.resolveUrl(rel));
            } else {
                const origin = String(navi.origin || "")
                    .trim()
                    .replace(/\/+$/, "");
                candidates.push(origin ? `${origin}/${rel}` : `/${rel}`);
            }
            // foobarch flowerpot capture park sometimes returns the tip JSON
            // instead of proxying; same content lives on flowerpotv2 upstream.
            const m = rel.match(/^flowerpot\/+(.+)$/i);
            if (m) {
                candidates.push(
                    `https://xomud.quest/flowerpotv2/${m[1].replace(/^\/+/, "")}`
                );
            }
        }

        let lastErr = null;
        for (const url of candidates) {
            try {
                const res = await fetch(url, {
                    method: "GET",
                    headers: {
                        Accept:
                            "application/navi-module, text/javascript, application/javascript, text/plain, */*",
                    },
                });
                const text = await res.text();
                if (!res.ok) {
                    lastErr = new Error(
                        `GET ${url} → ${res.status}: ${text.slice(0, 200)}`
                    );
                    continue;
                }
                if (
                    !/export\s+(?:const|function|async\s+function)\s+register\b/.test(
                        text
                    ) &&
                    !/export\s*\{[^}]*\bregister\b/.test(text)
                ) {
                    lastErr = new Error(
                        `not a Navi module from ${url} (${text.length} bytes)`
                    );
                    continue;
                }
                return { url, code: text };
            } catch (err) {
                lastErr =
                    err instanceof Error
                        ? err
                        : new Error(String(err || "fetch failed"));
            }
        }
        throw lastErr || new Error(`remount fetch failed for ${rel}`);
    }

    /**
     * Download host bin → stop → unmount self → mount new source.
     * setTimeout(0) lets the current callin return before commands are torn down.
     */
    async function remountHost(args) {
        ensureNative();
        const a0 = args[0] != null ? String(args[0]).trim() : "";

        if (a0.toLowerCase() === "path") {
            if (args[1] != null && String(args[1]).trim()) {
                // Remainder segments → route (callin folds / into args).
                const next = await remountPathSet(args.slice(1).join("/"));
                return `remount_host path=${next}`;
            }
            return `remount_host path=${await remountPathGet()}`;
        }

        let route = await remountPathGet();
        if (a0) {
            route = await remountPathSet(args.join("/"));
        }

        const { url, code } = await fetchRemountSource(route);
        const wasListening = !!svc.listening;
        const port = svc.port;
        const host = svc.host;

        // Stop HTTP before unmount so listeners are gone; onUnmount also stops.
        try {
            await svc.stop();
        } catch {
            /* ignore */
        }

        const bytes = Buffer.byteLength(code, "utf8");
        log(`remount_host downloaded ${bytes} bytes from ${url}`);

        return await new Promise((resolve, reject) => {
            // Not tracked in `timers` — onUnmount clears that list.
            setTimeout(async () => {
                try {
                    const self = navi.mod && navi.mod.hostparkinator_5000;
                    if (self && typeof navi.unmount === "function") {
                        navi.unmount(self);
                    }
                    await navi.mount(code);
                    const next = navi.mod && navi.mod.hostparkinator_5000;
                    if (!next) {
                        throw new Error("mount succeeded but navi.mod.hostparkinator_5000 missing");
                    }
                    let startMsg = "not started";
                    if (wasListening && typeof next.start === "function") {
                        startMsg = await next.start(port);
                    }
                    const msg = `remount_host ok route=${route} bytes=${bytes} host=${host} ${startMsg}`;
                    log(msg);
                    if (typeof navi.callout === "function") navi.callout(`[hostparkinator_5000] ${msg}`);
                    resolve(msg);
                } catch (err) {
                    const msg = `remount_host failed: ${err && err.message ? err.message : err}`;
                    warn(msg);
                    if (typeof navi.callout === "function") navi.callout(`[hostparkinator_5000] ${msg}`);
                    reject(new Error(msg));
                }
            }, 0);
        });
    }

    let unregServer = null;

    return {
        name: "hostparkinator_5000",
        version: "0.7.2",
        description:
            "ibgib-native Foobarch host — park routing; eframe tip-only; navi-mod multipart; /ib^gib pin",

        moduleInfo: {
            name: "hostparkinator_5000",
            version: "0.7.2",
            description:
                "Every park method passes its access policy; method controls select bins; GET snapshots can carry chosen bins",
        },

        server: svc,
        start: (port) => svc.start(port),
        stop: () => svc.stop(),
        status: () => svc.status(),

        commands: {
            hostparkinator_5000: {
                name: "hostparkinator_5000",
                description: "ibgib-native Foobarch host (:5353)",
                execute: async (...args) => run(...args),
            },
        },

        onMount: async () => {
            ensureNative();
            await svc.loadState();
            const sm = navi.mod?.server_manager;
            if (sm && typeof sm.register === "function") {
                sm.register({
                    id: "hostparkinator_5000",
                    name: "hostparkinator_5000",
                    description: "ibgib-native Foobarch host",
                    defaultPort: DEFAULT_PORT,
                    start: (port) => svc.start(port),
                    stop: () => svc.stop(),
                    status: () => svc.status(),
                    module: "hostparkinator_5000",
                });
                unregServer = () => {
                    try {
                        sm.unregister("hostparkinator_5000");
                    } catch {
                        /* ignore */
                    }
                };
            }
            if (typeof navi.callout === "function") {
                navi.callout(
                    `[hostparkinator_5000] mounted — hostparkinator_5000 start  (default :${DEFAULT_PORT})`
                );
            }
        },

        onUnmount: async () => {
            if (typeof unregServer === "function") unregServer();
            unregServer = null;
            try {
                await svc.stop();
            } catch {
                /* ignore */
            }
            for (const t of timers) clearTimeout(t);
            timers.length = 0;
        },
    };
};
