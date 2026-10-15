/**
 * Offline smoke: scranton_lobby with alias "sprinter" talks to the sprinter mod
 * (relay simulated in-process). No foobarch, no tokens.
 *   node C_devops/scranton/_smoke_sprinter.mjs
 */
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const mods = path.join(ROOT, "B_testkit_mods");
const origin = "https://foobarch.net";

function memNavi() {
  const items = new Map();
  const tips = new Map();
  return {
    origin,
    mod: {},
    storage: {
      item: { get: async (k) => structuredClone(items.get(k) ?? null), set: async (k, v) => void items.set(k, structuredClone(v)) },
      tip: {
        get: async (ib) => tips.get(ib) ?? null,
        mut8: async (ib, data) => (tips.set(ib, { ib, data: structuredClone(data) }), tips.get(ib)),
      },
    },
    on() {},
    tokens: {
      count: async () => 0,
      take: async () => assert.fail("sprinter writes must not take tokens"),
      giveBack: async () => {},
      add: async () => {},
    },
  };
}

async function load(navi, files) {
  for (const f of files) {
    const { register } = await import(pathToFileURL(path.join(mods, f)).href + `?n=${Math.random()}`);
    const m = register(navi);
    navi.mod[m.name] = m;
    await m.onMount?.();
  }
}

const server = memNavi();
server.relayWhitelist = { add() {}, remove() {} };
await load(server, ["sprinter_server.js"]);
const sprinterCmd = server.mod.sprinter_server.commands.sprinter_server;

let calls = 0;
/** Posted frames live on foobarch; only the lobby is on sprinter. */
const foobarchFrames = new Map();
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  const segs = u.pathname.replace(/^\/+/, "").split("/");
  if (u.pathname.startsWith("/foobarch/frame/")) {
    const f = foobarchFrames.get(decodeURIComponent(u.pathname.slice("/foobarch/frame/".length)));
    return f ? new Response(JSON.stringify(f), { status: 200 }) : new Response("{}", { status: 404 });
  }
  if (segs[0] !== "sprinter") return new Response("not sprinter", { status: 404 });
  calls++;
  const headers = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  server.callinRequest = { method: init.method || "GET", headers, body: init.body || "", viaRelay: true };
  try {
    const media = await sprinterCmd.execute(...segs.slice(1));
    return new Response(media, { status: 200 });
  } finally {
    server.callinRequest = null;
  }
};

async function client() {
  const n = memNavi();
  await load(n, ["keychain.js", "scranton_lobby_v1_client.js"]);
  const lobby = n.mod.scranton_lobby.lobby;
  await lobby.setAlias("sprinter");
  return lobby;
}

const A = await client();
const B = await client();
const p = "horizon/enter";
const ib = A.lobbyIb(p);
assert.equal(ib, "sprinter/scranton/lobby/v1/horizon/enter");

const ping = JSON.parse(await (await fetch(`${origin}/sprinter`)).text());
assert.equal(ping.tagline, "we proudly bring you version S");

assert.equal(await A.getTip(ib), null);
const c = await A.create(p);
const op = c.lobby.creator;
assert.ok(op);
await assert.rejects(A.create(p), /already exists/);

await B.join(p);
const bPub = await B.pubkey();
let tip = await A.getTip(ib);
assert.ok(tip.frame.data.lobby.roster[bPub]);
assert.equal(tip.frame.data.n, 1);

await B.appendPush(p, "some/note^ABC");
tip = await A.getTip(ib);
assert.equal(tip.frame.data.lobby.append[0].by, bPub);

await assert.rejects(B.kick(p, op), /only the OP/);
await A.kick(p, bPub);
tip = await A.getTip(ib);
assert.ok(!tip.frame.data.lobby.roster[bPub]);

// Server-side whitelist holds even when the client is bypassed: valid frame, one forged change.
const sha = async (s) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
async function post(who, frame, parentAddr, { rehash = true } = {}) {
  if (rehash) frame.gib = await sha(JSON.stringify(frame.data));
  const body = JSON.stringify({ transform: parentAddr ? "mut8" : "firstGen", newIbGib: frame, dnas: [], intermediateIbGibs: [] });
  const headers = await who.writeHeaders(ib, body, { sign: true, parentAddr });
  return JSON.parse(await (await fetch(`${origin}/${ib}`, { method: "POST", headers, body })).text());
}
async function forgeMut8(who, lobbyEdit, frameEdit = () => {}) {
  const t = await A.getTip(ib);
  const l = structuredClone(t.frame.data.lobby);
  lobbyEdit(l);
  const f = await A.buildLobbyFrame(ib, l, { parentAddr: t.addr, n: t.frame.data.n + 1, base: structuredClone(t.frame) });
  const rehash = frameEdit(f) !== false;
  return post(who, f, t.addr, { rehash });
}
const refused = async (pending, re) => {
  const out = await pending;
  assert.equal(out.ok, false, `expected refusal ${re}`);
  assert.match(out.error, re);
};
const aKey = await A.pubkey();
await refused(forgeMut8(A, (l) => (l.creator = "someone-else")), /creator immutable/);
await refused(forgeMut8(A, (l) => (l.motd = "hi")), /only data\.lobby\.roster or data\.lobby\.append/);
await refused(forgeMut8(A, (l) => (l.path = "elsewhere")), /only data\.lobby\.roster or data\.lobby\.append/);
await refused(forgeMut8(A, (l) => (l.append = [{ addr: "x^Y" }])), /field|needs by|at must/);
await refused(forgeMut8(A, () => {}, (f) => (f.data.method.DELETE = { kind: "commit" })), /only data\.lobby, data\.n/);
await refused(forgeMut8(A, () => {}, (f) => (f.data.extra = 1)), /only data\.lobby, data\.n/);
await refused(forgeMut8(A, (l) => (l.append = []), (f) => (f.data.n += 5)), /parent n \+ 1/);
await refused(forgeMut8(A, (l) => (l.append = []), (f) => delete f.rel8ns.policy), /only rel8ns\.past/);
await refused(forgeMut8(A, (l) => (l.append = []), (f) => void f.rel8ns.past.push("x^Y")), /exactly the parent/);
await refused(forgeMut8(A, (l) => (l.roster[aKey].ts = 1)), /existing roster entries/);
await refused(forgeMut8(B, (l) => (l.roster[bPub] = { joined_at: "now", ts: 1, admin: true })), /roster entry field not allowed: admin/);
await refused(forgeMut8(A, (l) => l.append.push({ addr: "no caret", by: aKey, at: "now" })), /ib\^gib/);
await refused(forgeMut8(A, (l) => l.append.push({ addr: "a^B", by: aKey, at: "now", x: 1 })), /field not allowed: x/);
await refused(forgeMut8(A, (l) => l.append.push({ addr: "a^B", by: aKey, at: "now" }), (f) => void (f.extra = 1)), /newIbGib field not allowed: extra/);
await refused(forgeMut8(A, (l) => l.append.push({ addr: "a^B", by: aKey, at: "now" }), (f) => ((f.gib = "0".repeat(64)), false)), /sha256 of data/);
assert.equal((await forgeMut8(A, (l) => l.append.push({ addr: "a^B", by: aKey, at: "now" }))).ok, true, "plain push still allowed");
tip = await A.getTip(ib);

// Create is whitelisted against the client template.
await sprinterCmd.execute("drop", "horizon", "enter");
async function forgeCreate(edit) {
  const now = new Date().toISOString();
  const l = { contract: "scranton_lobby_v1", path: p, created_at: now, creator: aKey, roster: { [aKey]: { joined_at: now, ts: 1 } }, append: [] };
  const f = await A.buildLobbyFrame(ib, l, { n: 0 });
  edit(f, l);
  return post(A, f, null);
}
await refused(forgeCreate((f) => delete f.rel8ns.policy), /rel8ns must be exactly/);
await refused(forgeCreate((f) => (f.rel8ns.policy = ["my/own/policy"])), /rel8ns must be exactly/);
await refused(forgeCreate((f) => (f.data.method.DELETE = { kind: "commit" })), /template/);
await refused(forgeCreate((f) => (f.data.n = 3)), /template/);
await refused(forgeCreate((f, l) => (l.motd = "squat")), /lobby field not allowed: motd/);
await refused(forgeCreate((f, l) => (l.roster.fake = { joined_at: "x", ts: 1 })), /just the creator/);
await refused(forgeCreate((f, l) => l.append.push({ addr: "a^B", by: aKey, at: "x" })), /append must be empty/);
await refused(forgeCreate((f, l) => (l.creator = "someone-else")), /creator must be the signer/);
assert.equal((await forgeCreate(() => {})).ok, true, "template create allowed");
tip = await A.getTip(ib);
let r;

const stale = await A.buildLobbyFrame(ib, { ...tip.frame.data.lobby, append: [] }, { parentAddr: c.addr, n: 9 });
const staleBody = JSON.stringify({ transform: "mut8", newIbGib: stale, dnas: [], intermediateIbGibs: [] });
r = JSON.parse(await (await fetch(`${origin}/${ib}`, { method: "POST", headers: await A.writeHeaders(ib, staleBody, { sign: true, parentAddr: c.addr }), body: staleBody })).text());
assert.match(r.error, /stale parent/);

const unsigned = await A.buildLobbyFrame(ib, { ...tip.frame.data.lobby, append: [] }, { parentAddr: tip.addr, n: 9 });
const unsignedBody = JSON.stringify({ transform: "mut8", newIbGib: unsigned, dnas: [], intermediateIbGibs: [] });
r = JSON.parse(await (await fetch(`${origin}/${ib}`, { method: "POST", headers: { "content-type": "application/json" }, body: unsignedBody })).text());
assert.equal(r.status, 401);

assert.match(await sprinterCmd.execute("list"), /horizon\/enter/);
assert.match(await sprinterCmd.execute("drop", "horizon", "enter"), /dropped/);
assert.equal(await A.getTip(ib), null);

// Follow surfs: each surf leaves the old lobby and joins/creates the page's lobby.
await A.setFollow(true);
let s = await A.onSurfPath("hypertext/gadgets");
assert.equal(s.action, "create");
assert.equal(A.hereIb, "sprinter/scranton/lobby/v1/hypertext/gadgets");
const aPub = await A.pubkey();
s = await A.onSurfPath("horizon/enter");
assert.equal(s.action, "create");
assert.ok(!(await A.getTip("sprinter/scranton/lobby/v1/hypertext/gadgets")).frame.data.lobby.roster[aPub], "left gadgets");
await B.setFollow(true);
s = await B.onSurfPath("horizon/enter");
assert.equal(s.action, "join");
const fast = [A.onSurfPath("fast/one"), A.onSurfPath("fast/two"), A.onSurfPath("fast/three")];
const outs = await Promise.all(fast);
assert.deepEqual(outs.slice(0, 2), [null, null], "overtaken surfs skip their join");
assert.equal(outs[2].action, "create");
assert.equal(await A.getTip("sprinter/scranton/lobby/v1/fast/one"), null);
assert.equal(A.hereIb, "sprinter/scranton/lobby/v1/fast/three");
await A.setFollow(false);
assert.equal(await A.onSurfPath("somewhere/else"), null, "follow off: plain surf only leaves");
assert.equal(A.hereIb, "");

// Posts on the sprinter lane: the row goes to the sprinter lobby (free), the post frame is on foobarch.
const bKey = await B.pubkey();
const postFrame = (author, lobbyIb) => ({ ib: "b/deer", data: { post: { v: 1, kind: "stage_member", page: "horizon/enter", lobby: lobbyIb, author, stage_dir: { slot: "DS", at: 0 } } } });
foobarchFrames.set("b/deer^P1", postFrame(bKey, B.lobbyIb("horizon/enter")));
foobarchFrames.set("b/deer^P2", postFrame(bKey, "scranton/lobby/v1/horizon/enter"));
await B.appendPush("horizon/enter", "b/deer^P1");
await B.appendPush("horizon/enter", "b/deer^P2");
const sp = await A.postsFor("horizon/enter");
assert.equal(sp.ib, "sprinter/scranton/lobby/v1/horizon/enter");
assert.deepEqual(sp.list.map((x) => [x.addr, x.valid]), [["b/deer^P1", true], ["b/deer^P2", false]]);
assert.match(sp.list[1].reason, /names lobby scranton\/lobby\/v1\/horizon\/enter/, "a post made for the foobarch lobby does not count in the sprinter room");

assert.ok(calls > 8);
console.log("SPRINTER SMOKE PASS");
