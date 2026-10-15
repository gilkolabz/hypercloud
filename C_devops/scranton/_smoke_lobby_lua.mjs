/**
 * Offline smoke: runs C_devops/scranton/lobby_v1_schema.lua authorize() in fengari with the
 * host's JSON prelude, against lobby frames built by scranton_lobby_v1_client.
 *   node C_devops/scranton/_smoke_lobby_lua.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(import.meta.url);
const { lua, lauxlib, lualib, to_luastring } = require(path.join(ROOT, "B_native_mods/vendor/fengari/src/fengari.js"));

const hostSrc = fs.readFileSync(path.join(ROOT, "B_native_mods/hostparkinator_5000.js"), "utf8");
const preludeTpl = hostSrc.match(/const JSON_DECODE_LUA = `([\s\S]*?)`;/)[1];
const JSON_PRELUDE = new Function("return `" + preludeTpl + "`")();
const SCHEMA = fs.readFileSync(path.join(ROOT, "C_devops/scranton/lobby_v1_schema.lua"), "utf8");

const frames = new Map();

function authorize({ signer, frame, parentAddr, fn: entry = "authorize" }) {
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  const run = (src) => {
    if (lauxlib.luaL_dostring(L, to_luastring(src)) !== 0) throw new Error(lua.lua_tojsstring(L, -1));
  };
  const fn = (name, impl) => {
    lua.lua_pushcfunction(L, (Ls) => {
      const out = impl(...[1, 2, 3].map((i) => (lua.lua_isstring(Ls, i) ? lua.lua_tojsstring(Ls, i) : undefined)));
      if (typeof out === "boolean") lua.lua_pushboolean(Ls, out);
      else if (out === undefined) lua.lua_pushnil(Ls);
      else lua.lua_pushstring(Ls, to_luastring(out));
      return 1;
    });
    lua.lua_setfield(L, -2, to_luastring(name));
  };
  run("foobarch = {}");
  lua.lua_getglobal(L, to_luastring("foobarch"));
  const body = JSON.stringify({ transform: parentAddr ? "mut8" : "firstGen", newIbGib: frame, dnas: [], intermediateIbGibs: [] });
  fn("body", () => body);
  fn("fetch_frame", (addr) => (frames.has(addr) ? JSON.stringify(frames.get(addr)) : undefined));
  fn("verify_ed25519", (pub, msg, sig) => sig === `sig:${pub}`);
  lua.lua_pop(L, 1);
  run(JSON_PRELUDE);
  lua.lua_pushstring(L, to_luastring(JSON.stringify({
    sign_keys: [signer],
    signatures: [`sig:${signer}`],
    message: "proposal-write-v1",
    parent_addr: parentAddr || "",
    ib: "scranton/lobby/v1/horizon/enter",
  })));
  lua.lua_setglobal(L, to_luastring("CTX_JSON"));
  run("ctx = json_decode(CTX_JSON)");
  run(SCHEMA);
  run(`local r = ${entry}(); RESULT_ALLOW = r.allow; RESULT_ERROR = r.error`);
  lua.lua_getglobal(L, to_luastring("RESULT_ALLOW"));
  const allow = lua.lua_toboolean(L, -1);
  lua.lua_getglobal(L, to_luastring("RESULT_ERROR"));
  const error = lua.lua_isstring(L, -1) ? lua.lua_tojsstring(L, -1) : "";
  return { allow, error };
}

const navi = {
  origin: "https://foobarch.net",
  mod: {},
  storage: { item: { get: async () => null, set: async () => {} }, tip: { get: async () => null, mut8: async () => null } },
  on() {},
};
const { register } = await import(pathToFileURL(path.join(ROOT, "B_testkit_mods/scranton_lobby_v1_client.js")).href);
const client = register(navi).lobby;

const ib = "scranton/lobby/v1/horizon/enter";
const A = "AKEY";
const B = "BKEY";
const now = new Date().toISOString();
const genesis = await client.buildLobbyFrame(ib, {
  contract: "scranton_lobby_v1",
  path: "horizon/enter",
  created_at: now,
  creator: A,
  roster: { [A]: { joined_at: now, ts: 1 } },
  append: [{ addr: "old/note^AAA", by: B, at: now }],
});
const gAddr = `${ib}^${genesis.gib}`;
frames.set(gAddr, genesis);

async function mut8(signer, lobbyEdit, frameEdit = () => {}, parent = genesis, parentAddr = gAddr) {
  const l = structuredClone(parent.data.lobby);
  lobbyEdit(l);
  const f = await client.buildLobbyFrame(ib, l, { parentAddr, n: parent.data.n + 1, base: structuredClone(parent) });
  frameEdit(f);
  return authorize({ signer, frame: f, parentAddr });
}
const ok = async (p) => {
  const r = await p;
  assert.equal(r.allow, true, `expected allow, got: ${r.error}`);
};
const no = async (p, re) => {
  const r = await p;
  assert.equal(r.allow, false, `expected deny ${re}`);
  assert.match(r.error, re);
};
const join = (l) => (l.roster[B] = { joined_at: now, ts: 2 });
const push = (by = A, row = {}) => (l) => l.append.push({ addr: "new/note^BBB", by, at: now, ...row });

await ok(mut8(B, join));
await no(mut8(A, join), /signed by joining pubkey/);
await ok(mut8(A, push()));
await no(mut8(A, push(B)), /by must equal signer/);
await ok(mut8(B, (l) => l.append.splice(0, 1)));
await ok(mut8(A, (l) => l.append.splice(0, 1)));
await no(mut8(B, (l) => (l.append[0].by = A)), /by is immutable/);

await no(mut8(A, (l) => (l.creator = B)), /creator immutable/);
await no(mut8(A, (l) => (l.motd = "hi")), /only data\.lobby\.roster or data\.lobby\.append/);
await no(mut8(A, (l) => (l.created_at = "later")), /only data\.lobby\.roster or data\.lobby\.append/);
await no(mut8(B, (l) => { join(l); push(B)(l); }), /not both/);
await no(mut8(A, () => {}), /no lobby change/);
await no(mut8(A, push(), (f) => (f.data.method.DELETE = { kind: "commit" })), /only data\.lobby, data\.n/);
await no(mut8(A, push(), (f) => (f.data.park = "capture")), /only data\.lobby, data\.n/);
await no(mut8(A, push(), (f) => (f.data.n = 7)), /parent n \+ 1/);
await no(mut8(A, push(), (f) => delete f.rel8ns.policy), /only rel8ns\.past/);
await no(mut8(A, push(), (f) => (f.rel8ns.policy = ["my/own/policy"])), /only rel8ns\.past/);
await no(mut8(A, push(), (f) => f.rel8ns.past.push("x^Y")), /exactly the parent/);
await no(mut8(A, push(), (f) => (f.rel8ns.past = ["other^ADDR"])), /exactly the parent/);
await no(mut8(B, (l) => (l.roster[B] = { joined_at: now, ts: 2, admin: true })), /field not allowed: admin/);
await no(mut8(B, (l) => (l.roster[B] = { ts: 2 })), /needs joined_at/);
await no(mut8(A, (l) => (l.roster[A].ts = 99)), /existing roster entries/);
await no(mut8(A, push(A, { addr: "no caret" })), /ib\^gib/);
await no(mut8(A, push(A, { addr: "a^b^c" })), /ib\^gib/);
await no(mut8(A, push(A, { addr: "x".repeat(600) + "^B" })), /ib\^gib/);
await no(mut8(A, push(A, { extra: 1 })), /field not allowed: extra/);
await no(mut8(A, (l) => (l.append[0] = { ...l.append[0], note: "x" })), /field not allowed: note/);

// Lobbies written with `op` may carry it forward or rename it to `creator` (same pubkey).
const legacy = structuredClone(genesis);
legacy.data.lobby = { ...legacy.data.lobby, op: A };
delete legacy.data.lobby.creator;
const lAddr = `${ib}^LEGACY`;
frames.set(lAddr, legacy);
await ok(mut8(A, (l) => { l.creator = l.op; delete l.op; push()(l); }, () => {}, legacy, lAddr));
await ok(mut8(A, push(), () => {}, legacy, lAddr));
await no(mut8(A, (l) => { l.creator = B; delete l.op; push()(l); }, () => {}, legacy, lAddr), /creator immutable/);

// authorize_genesis: the host runs it for every firstGen under the scranton/lobby/v1 governor.
async function create(signer, edit = () => {}) {
  const l = {
    contract: "scranton_lobby_v1",
    path: "horizon/enter",
    created_at: now,
    creator: signer,
    roster: { [signer]: { joined_at: now, ts: 1 } },
    append: [],
  };
  const f = await client.buildLobbyFrame(ib, l, { n: 0 });
  edit(f, l);
  return authorize({ signer, frame: f, parentAddr: "", fn: "authorize_genesis" });
}
await ok(create(A));
await no(create(A, (f) => delete f.rel8ns.policy), /rel8ns must be exactly/);
await no(create(A, (f) => (f.rel8ns.policy = ["my/own/policy"])), /rel8ns must be exactly/);
await no(create(A, (f) => (f.rel8ns.genesis_policy = ["x"])), /rel8ns must be exactly/);
await no(create(A, (f) => (f.data.method.DELETE = { kind: "commit" })), /template/);
await no(create(A, (f) => (f.data.n = 3)), /template/);
await no(create(A, (f) => (f.data.extra = 1)), /template/);
await no(create(A, (f) => (f.ib = "scranton/lobby/v1/other")), /match the address/);
await no(create(A, (f, l) => (l.path = "other")), /path must match/);
await no(create(A, (f, l) => (l.motd = "squat")), /lobby field not allowed: motd/);
await no(create(A, (f, l) => (l.roster[B] = { joined_at: now, ts: 1 })), /just the creator/);
await no(create(A, (f, l) => (l.roster = { [B]: { joined_at: now, ts: 1 } })), /just the creator/);
await no(create(A, (f, l) => (l.roster[A].admin = true)), /field not allowed: admin/);
await no(create(A, (f, l) => l.append.push({ addr: "a^B", by: A, at: now })), /append must be empty/);
await no(create(A, (f, l) => (l.creator = B)), /creator must be the signer/);

console.log("LOBBY LUA SMOKE PASS");
