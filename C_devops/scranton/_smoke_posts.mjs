/**
 * Offline smoke: scranton_lobby postsFor() + affordance registry + readAddress() validity,
 * with surfroster_stage_member as the stage_member post affordance.
 * A post counts only when post.author === the append row's `by` and post.page is the lobby's page.
 *   node C_devops/scranton/_smoke_posts.mjs
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const mods = path.join(ROOT, "B_testkit_mods");

const page = "Clip_Art_Deer_Drawing.jpg";
const lobbyIb = `scranton/lobby/v1/${page}`;
const A = "AUTHOR_KEY";
const M = "MALLORY_KEY";

const post = (author, onPage = page) => ({
  v: 1,
  kind: "stage_member",
  page: onPage,
  lobby: `scranton/lobby/v1/${onPage}`,
  author,
  stage_dir: { slot: "DS", at: 0, type: "htmf" },
  label: "I like this picture",
});
const frames = {
  "alice/likes/deer^G1": { ib: "alice/likes/deer", data: { stage_dir: {}, post: post(A) } },
  "copy/of/deer^G2": { ib: "copy/of/deer", data: { post: post(A) } },
  "other/deer^G3": { ib: "other/deer", data: { post: post(A, "hypertext/gadgets") } },
  "plain/note^G4": { ib: "plain/note", data: { about: { label: "not a post" } } },
};
const lobbyTip = {
  ib: lobbyIb,
  addr: `${lobbyIb}^L1`,
  tombstone: false,
  frame: {
    ib: lobbyIb,
    data: {
      contract: "scranton_lobby_v1",
      lobby: {
        contract: "scranton_lobby_v1",
        path: page,
        creator: A,
        roster: {},
        append: [
          { addr: "alice/likes/deer^G1", by: A, at: "t" },
          { addr: "copy/of/deer^G2", by: M, at: "t" },
          { addr: "other/deer^G3", by: A, at: "t" },
          { addr: "plain/note^G4", by: A, at: "t" },
        ],
      },
    },
    rel8ns: { policy: ["scranton/lobby/v1/policy"] },
  },
};

const COMMENTS = "scranton/affordance/v1/comments";
const POLICY = `${COMMENTS}/policy`;
const descriptors = {
  "scranton/affordance/v1": { affordances: { names: ["comments", "stage_member"] } },
  [COMMENTS]: {
    affordance: { v: 1, name: "comments", address: "comments/{page}", key: "comments", policy_ib: POLICY, fields: { text: { max: 2000 } }, columns: ["by", "text", "at"] },
  },
  "scranton/affordance/v1/stage_member": { affordance: { v: 1, name: "stage_member", post_kind: "stage_member", interpreter: { mod: "surfroster_stage_member" } } },
};
const commentsState = (rows, extra = {}) => ({ affordance: COMMENTS, page, lobby: lobbyIb, created_at: "t", creator: A, rows, ...extra });
const commentsFrame = (rows, extra) => ({ data: { comments: commentsState(rows, extra) }, rel8ns: { policy: [POLICY] } });
const addresses = {}; // ib → { tip frame, first frame, gib of the first frame }
let firstSeq = 0;
const setAddress = (ib, first, tip) => (addresses[ib] = { first, tip, gib: `F${++firstSeq}` });

// Identity "fam": policies/fam lists its key; fam/frens is signed by it. "fake/frens" is signed by a stranger.
const idPair = crypto.generateKeyPairSync("ed25519");
const strangerPair = crypto.generateKeyPairSync("ed25519");
const pubOf = (pair) => pair.publicKey.export({ format: "jwk" }).x;
const signFrens = (pair, frens) => crypto.sign(null, Buffer.from("scranton-frens-v1\n" + JSON.stringify(frens)), pair.privateKey).toString("base64url");
const famFrens = { identity: "fam", keys: [M], labels: { [M]: "mallory" } };
const tips = {
  "policies/fam": { data: { keys: [pubOf(idPair)] } },
  "fam/frens": { data: { frens: famFrens, frens_sig: { key: pubOf(idPair), sig: signFrens(idPair, famFrens) } } },
  "policies/fake": { data: { keys: [pubOf(idPair)] } },
  "fake/frens": { data: { frens: { identity: "fake", keys: [A] }, frens_sig: { key: pubOf(strangerPair), sig: signFrens(strangerPair, { identity: "fake", keys: [A] }) } } },
};

// A navi_script post whose posted bin hash matches (then a swapped body that does not).
const scriptText = "echo hi";
const scriptSha = crypto.createHash("sha256").update(scriptText).digest("hex");
frames["bob/script^S1"] = { ib: "bob/script", data: { post: { ...post(A), kind: "navi_script" } }, rel8ns: { bin: [`bin ${scriptSha}`] } };
let scriptBody = scriptText;

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  const p = decodeURIComponent(u.pathname);
  if (p === "/bob/script") return new Response(scriptBody, { status: 200 });
  if (p === `/foobarch/tip/${lobbyIb}`) return json(200, lobbyTip);
  if (p.startsWith("/foobarch/tip/")) {
    const ib = p.slice("/foobarch/tip/".length);
    if (tips[ib]) return json(200, { ib, addr: `${ib}^X`, frame: { ib, ...tips[ib] } });
    if (descriptors[ib]) return json(200, { ib, addr: `${ib}^D`, frame: { ib, data: descriptors[ib] } });
    if (addresses[ib]) return json(200, { ib, addr: `${ib}^T`, frame: addresses[ib].tip });
    if (frames[`${ib}^G1`]) return json(200, { ib, addr: `${ib}^G1` });
    return json(404, {});
  }
  if (p.startsWith("/foobarch/span/")) {
    const ib = p.slice("/foobarch/span/".length);
    return json(200, { hits: addresses[ib] ? [`${ib}^${addresses[ib].gib}`] : [] });
  }
  if (p.startsWith("/foobarch/frame/")) {
    const addr = p.slice("/foobarch/frame/".length);
    const [ib, gib] = addr.split("^");
    if (addresses[ib] && gib === addresses[ib].gib) return json(200, addresses[ib].first);
    const f = frames[addr];
    return f ? json(200, f) : json(404, {});
  }
  return json(404, {});
};

const items = new Map();
const parkTips = new Map();
const parkFrames = new Map();
const parkBins = new Map();
const navi = {
  origin: "https://foobarch.net",
  mod: {},
  storage: {
    item: { get: async (k) => structuredClone(items.get(k) ?? null), set: async (k, v) => void items.set(k, structuredClone(v)) },
    tip: {
      get: async (ib) => structuredClone(parkFrames.get(parkTips.get(ib)) ?? null),
      set: async (f) => {
        parkFrames.set(`${f.ib}^${f.gib}`, structuredClone(f));
        parkTips.set(f.ib, `${f.ib}^${f.gib}`);
        return f;
      },
      del: async (ib) => void parkTips.delete(ib),
      mut8: async () => null,
      frame: {
        get: async (addr) => structuredClone(parkFrames.get(addr) ?? null),
        put: async (f) => void parkFrames.set(`${f.ib}^${f.gib}`, structuredClone(f)),
        del: async (addr) => void parkFrames.delete(addr),
      },
    },
    bin: { get: async (sha) => structuredClone(parkBins.get(sha) ?? null), put: async (sha, v) => void parkBins.set(sha, structuredClone(v)) },
  },
  on() {},
};
for (const f of ["scranton_lobby_v1_client.js", "surfroster_stage_member.js"]) {
  const { register } = await import(pathToFileURL(path.join(mods, f)).href);
  const m = register(navi);
  navi.mod[m.name] = m;
}
const lobby = navi.mod.scranton_lobby.lobby;
assert.equal((await lobby.hideList()).only_trusted, true, "trusted-only is on by default");
await lobby.setOnlyTrusted(false);

// posts
const r = await lobby.postsFor(page);
assert.equal(r.lobby, true);
assert.equal(r.list.length, 4);
const [ok, copied, elsewhere, plain] = r.list;
assert.equal(ok.valid, true, "author-signed row for this page counts");
assert.equal(ok.kind, "stage_member");
assert.equal(ok.ib, "alice/likes/deer");
assert.equal(copied.valid, false, "someone else appending the author's post does not count");
assert.match(copied.reason, /author did not sign/);
assert.equal(elsewhere.valid, false, "post for another page does not count");
assert.match(elsewhere.reason, /not this page/);
assert.equal(plain.post, null);
assert.equal(plain.reason, "not a post");

// registry: descriptors from the index, plugins from interpreter mods (one mod may serve several)
const names = (await lobby.affordances()).map((a) => a.name).sort();
assert.deepEqual(names, ["comments", "navi_script", "stage_dir", "stage_member", "stagedir"]);
const sm = await lobby.affordanceForPostKind("stage_member");
assert.equal(sm.plugin, navi.mod.surfroster_stage_member.affordancePlugins.find((p) => p.name === "stage_member"), "interpreter mod supplies the plugin");
assert.equal((await lobby.affordanceNamed("stagedir")).address, "stagedir/{page}");
assert.equal((await lobby.affordanceForPostKind("stage_dir")).plugin.order, 0, "whole stage applies before placements");
assert.equal(sm.descriptor.interpreter.mod, "surfroster_stage_member");
assert.equal(await lobby.affordanceForPostKind("nope"), null);
assert.match(sm.plugin.describe(ok), /I like this picture.*DS\[0\]/);
const acts = await sm.plugin.actions(ok);
assert.deepEqual(acts.map((a) => a.id), ["stage", "trust"]);

// trust: keys, and identities via their signed frens list (one hop)
assert.equal((await lobby.isTrusted(A)).trusted, false);
await acts.find((a) => a.id === "trust").run();
assert.deepEqual(await lobby.isTrusted(A), { trusted: true, via: "key" });
assert.deepEqual((await sm.plugin.actions(ok)).map((a) => a.id), ["stage", "untrust"]);
const fam = await lobby.readFrens("fam");
assert.equal(fam.valid, true, fam.reason);
assert.deepEqual(fam.keys, [M]);
assert.equal((await lobby.isTrusted(M)).trusted, false, "frens count only once the identity is trusted");
await lobby.trustIdentity("fam");
assert.deepEqual(await lobby.isTrusted(M), { trusted: true, via: "frens of fam" });
assert.match((await lobby.readFrens("fake")).reason, /not signed by a policies\/fake key/);
tips["fam/frens"].data.frens = { ...famFrens, keys: [M, "INJECTED"] };
assert.match((await lobby.readFrens("fam", { fresh: true })).reason, /bad signature/, "edited list fails its signature");
assert.equal((await lobby.readFrens("nobody")).exists, false);

// posted content: only the posted bytes
const sx = { ib: "bob/script", addr: "bob/script^S1" };
assert.equal((await lobby.postContent(sx)).text, scriptText);
scriptBody = "evil()";
assert.equal((await lobby.postContent(sx)).text, scriptText, "parked posted bytes win over a changed host");
parkBins.clear();
await assert.rejects(lobby.postContent(sx), /changed since it was posted/);
const ns = await lobby.affordanceForPostKind("navi_script");
assert.equal(ns.plugin, navi.mod.scranton_lobby.affordancePlugin);
assert.equal(ns.plugin.name, "navi_script");

// From here on the stub host changes frames in place, so read it directly (no parked copies).
// address affordance: comments/{page}
await lobby.setSettings({ "park.on": false });
const cib = `comments/${page}`;
let c = await lobby.readAddress("comments", page);
assert.equal(c.ib, cib);
assert.equal(c.exists, false);

const row = { text: "nice deer", by: M, at: "t" };
setAddress(cib, commentsFrame([]), commentsFrame([row]));
c = await lobby.readAddress("comments", page);
assert.equal(c.valid, true, c.reason);
assert.deepEqual(c.rows, [row]);

setAddress(cib, commentsFrame([row]), commentsFrame([row]));
c = await lobby.readAddress("comments", page);
assert.equal(c.valid, false, "pre-seeded first generation is rejected");
assert.match(c.reason, /did not start empty/);
assert.deepEqual(c.rows, []);

setAddress(cib, { data: { comments: commentsState([]) }, rel8ns: {} }, commentsFrame([row]));
assert.match((await lobby.readAddress("comments", page)).reason, /first generation was not gated/);

setAddress(cib, commentsFrame([]), { data: { comments: commentsState([row]) }, rel8ns: {} });
assert.match((await lobby.readAddress("comments", page)).reason, /not gated by/);

setAddress(cib, commentsFrame([]), commentsFrame([row], { page: "other.jpg" }));
assert.match((await lobby.readAddress("comments", page)).reason, /for page other\.jpg/);

setAddress(cib, commentsFrame([]), commentsFrame([row], { affordance: "x/y" }));
assert.match((await lobby.readAddress("comments", page)).reason, /names affordance x\/y/);

// frens of frens: h1 vouches for h2 (and h2 back, a cycle); hops decide how far trust follows.
const signed = (identity, frens, pair = idPair) => ({ data: { frens: { identity, ...frens }, frens_sig: { key: pubOf(pair), sig: signFrens(pair, { identity, ...frens }) } } });
tips["policies/h1"] = { data: { keys: [pubOf(idPair)] } };
tips["policies/h2"] = { data: { keys: [pubOf(idPair)] } };
tips["h1/frens"] = signed("h1", { keys: [], identities: ["h2"] });
tips["h2/frens"] = signed("h2", { keys: ["DEEP"], identities: ["h1"] });
assert.deepEqual((await lobby.readFrens("h1")).identities, ["h2"]);
await lobby.trustIdentity("h1");
assert.equal((await lobby.isTrusted("DEEP")).trusted, false, "one hop: only h1's own keys");
await lobby.trustIdentity("h1", true, 2);
assert.deepEqual(await lobby.isTrusted("DEEP"), { trusted: true, via: "frens of h2 (via h1)" });
assert.equal((await lobby.isTrusted("NOBODY")).trusted, false, "a vouching cycle ends");
assert.equal((await lobby.trustIdentity("h1", true, 9)).identities.h1.hops, 3, "hops are capped");
await lobby.trustIdentity("h1", false);

// editors: the identity names keys that may sign its list.
const editorPair = crypto.generateKeyPairSync("ed25519");
const editorsMsg = (identity, editors) => "scranton-frens-editors-v1\n" + JSON.stringify({ identity, editors });
const edSig = (pair, identity, editors) => ({ key: pubOf(pair), sig: crypto.sign(null, Buffer.from(editorsMsg(identity, editors)), pair.privateKey).toString("base64url") });
tips["policies/crew"] = { data: { keys: [pubOf(idPair)] } };
tips["crew/frens"] = signed("crew", { keys: ["K1"] }, editorPair);
assert.match((await lobby.readFrens("crew")).reason, /not signed by a policies\/crew key or a named editor/);
tips["crew/frens"].data.frens_editors = { identity: "crew", editors: [pubOf(editorPair)], sig: edSig(idPair, "crew", [pubOf(editorPair)]) };
const crew = await lobby.readFrens("crew", { fresh: true });
assert.equal(crew.valid, true, crew.reason);
assert.deepEqual(crew.editors, [pubOf(editorPair)]);
assert.equal(crew.signer, pubOf(editorPair));
tips["crew/frens"].data.frens_editors.sig = edSig(strangerPair, "crew", [pubOf(editorPair)]);
assert.equal((await lobby.readFrens("crew", { fresh: true })).valid, false, "an editor list not signed by the identity names nobody");

// gates
assert.equal(lobby.gateOpen("", "anything"), true);
assert.equal(lobby.gateOpen("horizon/enter", "horizon/enter"), true);
assert.equal(lobby.gateOpen("horizon/enter", "hypertext/gadgets"), false);
assert.equal(lobby.gateOpen("horizon/*", "horizon"), true);
assert.equal(lobby.gateOpen("horizon/*", "horizon/enter"), true);
assert.equal(lobby.gateOpen("horizon/*", "horizonx"), false);
assert.equal(lobby.gateOpen("horiz*", "horizonx"), true);

// surf hooks honour gates and the personal filter (the real interpreters stay out of this run).
delete navi.mod.surfroster_stage_member;
frames["gated/deer^G5"] = { ib: "gated/deer", data: { post: { ...post(A), gate: { from: "horizon/enter" } } } };
lobbyTip.frame.data.lobby.append.push({ addr: "gated/deer^G5", by: A, at: "t" });
setAddress(cib, commentsFrame([]), commentsFrame([{ text: "plain", by: A, at: "t" }, { text: "gated", by: M, at: "t", from: "horizon/enter" }]));
const seen = { posts: null, rows: null };
lobby.registerAffordance({ name: "probe_posts", post_kind: "stage_member", onSurf: (list) => void (seen.posts = list.map((x) => x.addr)) });
lobby.registerAffordance({ name: "comments", address: "comments/{page}", onSurf: (read) => void (seen.rows = read.rows.map((x) => x.text)) });
const surf = async (from) => {
  seen.posts = null;
  seen.rows = null;
  await lobby.runSurfPlugins(page, from);
  return seen;
};
assert.deepEqual(await surf("elsewhere"), { posts: ["alice/likes/deer^G1"], rows: ["plain"] }, "gated items wait for their page");
assert.deepEqual(await surf("horizon/enter"), { posts: ["alice/likes/deer^G1", "gated/deer^G5"], rows: ["plain", "gated"] });
await lobby.hideKey(A, true);
assert.deepEqual(await surf("horizon/enter"), { posts: null, rows: ["gated"] }, "hidden author never acts");
assert.deepEqual(await lobby.isHidden(A), { hidden: true, why: "author hidden" });
await lobby.hideKey(A, false);
await lobby.hideKind("stage_member", true);
assert.equal((await surf("horizon/enter")).posts, null, "hidden kind never acts");
await lobby.hideKind("stage_member", false);
await lobby.setOnlyTrusted(true);
assert.deepEqual(await surf("horizon/enter"), { posts: ["alice/likes/deer^G1", "gated/deer^G5"], rows: ["plain"] }, "only trusted: A (trusted key) acts, M does not");
await lobby.setOnlyTrusted(false);
assert.deepEqual(await lobby.hideList(), { keys: {}, kinds: {}, only_trusted: false });

console.log("POSTS SMOKE PASS");
