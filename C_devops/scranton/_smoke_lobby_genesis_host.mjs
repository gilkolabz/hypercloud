/**
 * End-to-end smoke: in-process hostparkinator_5000 + _hostpark_lobby_v1.mjs --open + the real
 * scranton_lobby client. Proves the governor's genesis_policy gates lobby firstGen on the host.
 *   node C_devops/scranton/_smoke_lobby_genesis_host.mjs
 */
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import assert from "node:assert/strict";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 5399;
const base = `http://localhost:${PORT}`;
const PASSWORD = process.env.FOOBARCH_USAGE_PASSWORD || "";
const DB = path.join(os.tmpdir(), `lobby_genesis_smoke_${process.pid}.sqlite`);

const hostStore = new Map();
const hostNavi = {
  require: createRequire(import.meta.url),
  storage: { item: { get: async (k) => hostStore.get(k) ?? null, set: async (k, v) => void hostStore.set(k, v) } },
  mod: {},
  callout: () => {},
  stamp: { time: () => new Date().toISOString(), uuid: () => crypto.randomUUID() },
};
const { register: registerHost } = await import(pathToFileURL(path.join(ROOT, "B_native_mods/hostparkinator_5000.js")).href);
const host = registerHost(hostNavi);
await hostNavi.storage.item.set("hostparkinator_5000.db_path", DB);
await host.onMount();
await host.start(PORT);

const mint = async () => {
  const res = await fetch(`${base}/foobarch/tokens`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Foobarch-Usage-Password": PASSWORD },
    body: JSON.stringify({ count: 1 }),
  });
  return (await res.json()).tokens[0];
};

try {
  const code = await new Promise((resolve) =>
    spawn(process.execPath, [path.join(ROOT, "C_devops/scranton/_hostpark_lobby_v1.mjs"), "--yes", "--open"], {
      env: { ...process.env, FOOBARCH_HOST: base, FOOBARCH_USAGE_PASSWORD: PASSWORD },
      stdio: "inherit",
    }).on("exit", resolve)
  );
  assert.equal(code, 0, "hostpark lobby script failed");

  const mods = path.join(ROOT, "B_testkit_mods");
  async function client() {
    const items = new Map();
    const tips = new Map();
    const navi = {
      origin: base,
      mod: {},
      storage: {
        item: { get: async (k) => structuredClone(items.get(k) ?? null), set: async (k, v) => void items.set(k, structuredClone(v)) },
        tip: {
          get: async (ib) => tips.get(ib) ?? null,
          mut8: async (ib, data) => (tips.set(ib, { ib, data: structuredClone(data) }), tips.get(ib)),
        },
      },
      on() {},
      tokens: { count: async () => 1, take: mint, giveBack: async () => {}, add: async () => {} },
    };
    for (const f of ["keychain.js", "scranton_lobby_v1_client.js"]) {
      const { register } = await import(pathToFileURL(path.join(mods, f)).href + `?n=${Math.random()}`);
      const m = register(navi);
      navi.mod[m.name] = m;
      await m.onMount?.();
    }
    return navi.mod.scranton_lobby.lobby;
  }

  const A = await client();
  const B = await client();
  const p = "horizon/enter";
  const ib = A.lobbyIb(p);

  // Real client flow passes both gates.
  const c = await A.create(p);
  await B.join(p);
  await B.appendPush(p, "some/note^ABC");
  const tip = await A.getTip(ib);
  assert.equal(tip.frame.data.n, 2);
  assert.ok(tip.frame.data.lobby.roster[await B.pubkey()]);
  assert.ok(c.addr);

  // Forged firstGen (signed, paid) is refused by authorize_genesis.
  async function forgedCreate(pathRaw, edit) {
    const fib = A.lobbyIb(pathRaw);
    const pub = await A.pubkey();
    const now = new Date().toISOString();
    const l = { contract: "scranton_lobby_v1", path: pathRaw, created_at: now, creator: pub, roster: { [pub]: { joined_at: now, ts: 1 } }, append: [] };
    const f = await A.buildLobbyFrame(fib, l, { n: 0 });
    edit(f, l);
    const body = JSON.stringify({ transform: "firstGen", newIbGib: f, dnas: [], intermediateIbGibs: [] });
    const headers = await A.writeHeaders(fib, body, { sign: true, parentAddr: null });
    headers["X-Foobarch-Usage-Token"] = await mint();
    const res = await fetch(`${base}/${fib}`, { method: "PUT", headers, body });
    return { status: res.status, text: await res.text() };
  }
  let r = await forgedCreate("squat/one", (f) => delete f.rel8ns.policy);
  assert.equal(r.status, 401, r.text);
  assert.match(r.text, /rel8ns must be exactly/);
  r = await forgedCreate("squat/two", (f, l) => (l.motd = "squatted"));
  assert.equal(r.status, 401, r.text);
  assert.match(r.text, /lobby field not allowed: motd/);
  r = await forgedCreate("squat/three", (f, l) => (l.roster.fake = { joined_at: "x", ts: 1 }));
  assert.match(r.text, /just the creator/);
  assert.equal(await A.getTip(A.lobbyIb("squat/one")), null);

  // Unsigned firstGen under the governor is refused; outside it, the host stays open.
  const unsignedBody = JSON.stringify({
    transform: "firstGen",
    newIbGib: { ib: "scranton/lobby/v1/raw", gib: "A".repeat(64), data: { anything: 1 }, rel8ns: {} },
    dnas: [],
    intermediateIbGibs: [],
  });
  r = await fetch(`${base}/scranton/lobby/v1/raw`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "X-Foobarch-Usage-Token": await mint() },
    body: unsignedBody,
  });
  assert.equal(r.status, 401);
  const openBody = unsignedBody.replaceAll("scranton/lobby/v1/raw", "elsewhere/raw");
  r = await fetch(`${base}/elsewhere/raw`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "X-Foobarch-Usage-Token": await mint() },
    body: openBody,
  });
  assert.ok(r.ok, await r.text());

  // Forged mut8 still refused by authorize().
  const t = await A.getTip(ib);
  const l = structuredClone(t.frame.data.lobby);
  l.motd = "x";
  const f = await A.buildLobbyFrame(ib, l, { parentAddr: t.addr, n: t.frame.data.n + 1, base: t.frame });
  const body = JSON.stringify({ transform: "mut8", newIbGib: f, dnas: [], intermediateIbGibs: [] });
  const headers = await A.writeHeaders(ib, body, { sign: true, parentAddr: t.addr });
  headers["X-Foobarch-Usage-Token"] = await mint();
  r = await fetch(`${base}/${ib}`, { method: "PUT", headers, body });
  assert.equal(r.status, 401);
  assert.match(await r.text(), /only data\.lobby\.roster or data\.lobby\.append/);

  // A miss under the governor is still a miss, not the governor frame.
  assert.equal((await fetch(`${base}/foobarch/tip/${encodeURIComponent("scranton/lobby/v1/nobody")}`)).status, 404);

  console.log("LOBBY GENESIS HOST SMOKE PASS");
} finally {
  await host.stop?.();
  await host.onUnmount?.();
  try {
    fs.unlinkSync(DB);
  } catch {
    /* ignore */
  }
}
process.exit(0);
