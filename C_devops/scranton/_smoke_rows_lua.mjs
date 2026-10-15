/**
 * Offline smoke: runs rows_v1_schema.lua (configured for comments, then stagedir) authorize() in
 * fengari with the host's JSON prelude, against frames built by scranton_lobby_v1_client.
 *   node C_devops/scranton/_smoke_comments_lua.mjs
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
const { rowsLua } = await import(pathToFileURL(path.join(ROOT, "C_devops/scranton/_affordance_lua.mjs")).href);
let SCHEMA = rowsLua({ key: "comments", fields: { text: { max: 2000 } } });

const frames = new Map();
let IB = "comments/Clip_Art_Deer_Drawing.jpg";

function authorize({ signer, frame, parentAddr }) {
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
  const body = JSON.stringify({ transform: "mut8", newIbGib: frame, dnas: [], intermediateIbGibs: [] });
  fn("body", () => body);
  fn("fetch_frame", (addr) => (frames.has(addr) ? JSON.stringify(frames.get(addr)) : undefined));
  fn("verify_ed25519", (pub, msg, sig) => sig === `sig:${pub}`);
  lua.lua_pop(L, 1);
  run(JSON_PRELUDE);
  lua.lua_pushstring(L, to_luastring(JSON.stringify({
    sign_keys: [signer],
    signatures: [`sig:${signer}`],
    message: "proposal-write-v1",
    parent_addr: parentAddr,
    ib: IB,
  })));
  lua.lua_setglobal(L, to_luastring("CTX_JSON"));
  run("ctx = json_decode(CTX_JSON)");
  run(SCHEMA);
  run("local r = authorize(); RESULT_ALLOW = r.allow; RESULT_ERROR = r.error");
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

const D = {
  name: "comments",
  ib: "scranton/affordance/v1/comments",
  address: "comments/{page}",
  key: "comments",
  policy_ib: "scranton/affordance/v1/comments/policy",
  fields: { text: { max: 2000 } },
};
const A = "AKEY";
const B = "BKEY";
const now = new Date().toISOString();
const page = "Clip_Art_Deer_Drawing.jpg";
const state0 = { affordance: D.ib, page, lobby: `scranton/lobby/v1/${page}`, created_at: now, creator: A, rows: [{ text: "first", by: B, at: now }] };
const genesis = await client.buildAddressFrame(IB, D, page, state0);
assert.deepEqual(genesis.rel8ns.policy, [D.policy_ib]);
const gAddr = `${IB}^${genesis.gib}`;
frames.set(gAddr, genesis);

async function mut8(signer, stateEdit, frameEdit = () => {}) {
  const s = structuredClone(genesis.data.comments);
  stateEdit(s);
  const f = await client.buildAddressFrame(IB, D, page, s, { base: structuredClone(genesis), parentAddr: gAddr, n: genesis.data.n + 1 });
  frameEdit(f);
  return authorize({ signer, frame: f, parentAddr: gAddr });
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
const push = (by = A, row = {}) => (s) => s.rows.push({ text: "nice deer", by, at: now, ...row });

await ok(mut8(A, push()));
await no(mut8(A, push(B)), /by must equal signer/);
await no(mut8(A, push(A, { text: "" })), /text must be/);
await no(mut8(A, push(A, { text: "x".repeat(2001) })), /text must be/);
await no(mut8(A, push(A, { html: "<b>" })), /field not allowed: html/);
await no(mut8(A, push(A, { at: "x".repeat(80) })), /at must be/);
await ok(mut8(B, (s) => s.rows.splice(0, 1)));
await no(mut8(A, (s) => s.rows.splice(0, 1)), /only the row's author/);
await no(mut8(B, (s) => (s.rows[0].text = "edited")), /push one row or delete one row/);
await no(mut8(A, (s) => { push()(s); s.rows[0].text = "x"; }), /keep prior rows intact/);
await no(mut8(A, (s) => { push()(s); push()(s); }), /push one row or delete one row/);
await no(mut8(A, (s) => { s.page = "other"; push()(s); }), /only data\.comments\.rows/);
await no(mut8(A, (s) => { s.creator = B; push()(s); }), /only data\.comments\.rows/);
await no(mut8(A, push(), (f) => (f.data.method.DELETE = { kind: "commit" })), /only data\.comments, data\.n/);
await no(mut8(A, push(), (f) => (f.data.n = 9)), /parent n \+ 1/);
await no(mut8(A, push(), (f) => delete f.rel8ns.policy), /only rel8ns\.past/);
await no(mut8(A, push(), (f) => (f.rel8ns.past = ["other^X"])), /exactly the parent/);

// Same template configured for stagedir/{page}: three fields, pos may be empty.
const SD = {
  name: "stagedir",
  ib: "scranton/affordance/v1/stagedir",
  address: "stagedir/{page}",
  key: "stagedir",
  policy_ib: "scranton/affordance/v1/stagedir/policy",
  fields: { member: { max: 512 }, slot: { max: 16 }, pos: { min: 0, max: 8 } },
};
SCHEMA = rowsLua({ key: SD.key, fields: SD.fields });
IB = `stagedir/${page}`;
const sdGenesis = await client.buildAddressFrame(IB, SD, page, { affordance: SD.ib, page, lobby: `scranton/lobby/v1/${page}`, created_at: now, creator: A, rows: [] });
const sdAddr = `${IB}^${sdGenesis.gib}`;
frames.set(sdAddr, sdGenesis);
const sdPush = async (signer, row) => {
  const s = structuredClone(sdGenesis.data.stagedir);
  s.rows.push({ by: signer, at: now, ...row });
  const f = await client.buildAddressFrame(IB, SD, page, s, { base: structuredClone(sdGenesis), parentAddr: sdAddr, n: 1 });
  return authorize({ signer, frame: f, parentAddr: sdAddr });
};
await ok(sdPush(A, { member: "alice/likes/deer", slot: "DS", pos: "0" }));
await ok(sdPush(A, { member: "alice/likes/deer", slot: "DS", pos: "" }));
await no(sdPush(A, { member: "alice/likes/deer", slot: "" , pos: "" }), /slot must be 1\.\.16/);
await no(sdPush(A, { member: "alice/likes/deer", slot: "DS" }), /pos must be 0\.\.8/);
await no(sdPush(A, { member: "x", slot: "DS", pos: "", text: "hi" }), /field not allowed: text/);
assert.throws(() => rowsLua({ key: "bad key", fields: { a: {} } }), /identifier/);

console.log("ROWS LUA SMOKE PASS (comments + stagedir)");
