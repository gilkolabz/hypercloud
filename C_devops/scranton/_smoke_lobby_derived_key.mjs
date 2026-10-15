/**
 * Offline smoke: scranton_lobby signs with keychain-derived "scranton_lobby" key,
 * but keeps "default" in lobbies where default is already OP/roster/appender.
 *   node C_devops/scranton/_smoke_lobby_derived_key.mjs
 */
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const mods = path.join(ROOT, "B_testkit_mods");

const items = new Map();
const tips = new Map();
const navi = {
  origin: "https://foobarch.net",
  mod: {},
  storage: {
    item: { get: async (k) => items.get(k) ?? null, set: async (k, v) => void items.set(k, v) },
    tip: {
      get: async (ib) => tips.get(ib) ?? null,
      mut8: async (ib, data) => {
        tips.set(ib, { ib, data: structuredClone(data) });
        return tips.get(ib);
      },
    },
  },
  on() {},
};
const stash = new Map();
const list = (h) => stash.get(h) || stash.set(h, []).get(h);
navi.tokens = {
  count: async (h) => list(h).length,
  add: async (h, t) => ({ added: list(h).push(...t), count: list(h).length }),
  take: async (h) => {
    const t = list(h).shift();
    if (!t) throw Object.assign(new Error("no tokens"), { code: "NO_TOKENS" });
    return t;
  },
  giveBack: async (h, t) => list(h).unshift(t),
};

const host = new Map();
const puts = [];
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  const json = (s, o) => new Response(JSON.stringify(o), { status: s });
  if (u.pathname.startsWith("/foobarch/tip/")) {
    const ib = decodeURIComponent(u.pathname.slice("/foobarch/tip/".length));
    const t = host.get(ib);
    return t ? json(200, t) : json(404, { error: "no tip" });
  }
  if (init.method === "PUT") {
    const ib = u.pathname.slice(1);
    const env = JSON.parse(init.body);
    const addr = `${ib}^${env.newIbGib.gib}`;
    host.set(ib, { ib, addr, frame: env.newIbGib });
    puts.push({ ib, signer: init.headers["X-Foobarch-Sign-Keys"] });
    return json(200, { addr });
  }
  return json(404, {});
};

for (const f of ["keychain.js", "scranton_lobby_v1_client.js"]) {
  const { register } = await import(pathToFileURL(path.join(mods, f)).href);
  const m = register(navi);
  navi.mod[m.name] = m;
}
const kc = navi.mod.keychain;
const lobby = navi.mod.scranton_lobby.lobby;
await navi.tokens.add("https://foobarch.net", Array.from({ length: 20 }, (_, i) => `t${i}`));

const def = (await kc.create("default")).publicKey;
const derived = (await kc.derive("scranton_lobby")).publicKey;
assert.notEqual(def, derived);
assert.equal(await lobby.pubkey(), derived);

// New lobby → derived key everywhere
const c = await lobby.create("fresh");
assert.equal(c.lobby.creator, derived);
assert.ok(!("op" in c.lobby));
assert.ok(c.lobby.roster[derived] && !c.lobby.roster[def]);
assert.equal(puts.at(-1).signer, derived);
await lobby.appendPush("fresh", "some/note^ABC");
assert.equal(host.get("scranton/lobby/v1/fresh").frame.data.lobby.append[0].by, derived);
assert.equal(puts.at(-1).signer, derived);

// Lobby created by default but stored under `op` → stays default (OP rights kept), renamed to `creator` on write
const legacyFrame = await lobby.buildLobbyFrame("scranton/lobby/v1/old", {
  contract: "scranton_lobby_v1",
  path: "old",
  op: def,
  roster: { [def]: { joined_at: "x", ts: 0 }, someone: { joined_at: "x", ts: 0 } },
  append: [],
});
host.set("scranton/lobby/v1/old", { ib: "scranton/lobby/v1/old", addr: "scranton/lobby/v1/old^L", frame: legacyFrame });
await lobby.kick("old", "someone");
assert.equal(puts.at(-1).signer, def, "kick on legacy lobby signs with default");
const migrated = host.get("scranton/lobby/v1/old").frame.data.lobby;
assert.equal(migrated.creator, def);
assert.ok(!("op" in migrated));
await lobby.appendPush("old", "x/y^Z");
assert.equal(host.get("scranton/lobby/v1/old").frame.data.lobby.append[0].by, def);
await lobby.leave("old");
assert.ok(!host.get("scranton/lobby/v1/old").frame.data.lobby.roster[def]);
assert.equal(puts.at(-1).signer, def);

// Someone else's lobby → join as derived
const otherFrame = await lobby.buildLobbyFrame("scranton/lobby/v1/other", {
  contract: "scranton_lobby_v1", path: "other", creator: "zzz", roster: {}, append: [],
});
host.set("scranton/lobby/v1/other", { ib: "scranton/lobby/v1/other", addr: "scranton/lobby/v1/other^O", frame: otherFrame });
await lobby.join("other");
const r = host.get("scranton/lobby/v1/other").frame.data.lobby.roster;
assert.ok(r[derived] && !r[def]);
assert.equal(puts.at(-1).signer, derived);

assert.equal(await navi.tokens.count("https://foobarch.net"), 20 - puts.length, "one token per write");
const before = await navi.tokens.count("https://foobarch.net");
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) =>
  init.method === "PUT" ? new Response("policy says no", { status: 403 }) : realFetch(url, init);
await assert.rejects(lobby.appendPush("fresh", "refused/note^R"), /policy says no/);
assert.equal(await navi.tokens.count("https://foobarch.net"), before, "refused write gives its token back");
globalThis.fetch = realFetch;

console.log("SMOKE PASS");
