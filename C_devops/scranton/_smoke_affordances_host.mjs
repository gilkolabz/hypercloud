/**
 * End-to-end smoke: in-process hostparkinator_5000 + _hostpark_affordances_v1.mjs --open + the real
 * scranton_lobby client. Proves comments/{page} and stagedir/{page} work through the host's policy
 * gate, signed frens lists extend trust, and posted content is read back byte-for-byte.
 *   node C_devops/scranton/_smoke_affordances_host.mjs
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
const PORT = 5398;
const base = `http://localhost:${PORT}`;
const PASSWORD = process.env.FOOBARCH_USAGE_PASSWORD || "";
const DB = path.join(os.tmpdir(), `affordances_host_smoke_${process.pid}.sqlite`);
const { signFrens, signEditors, frensData } = await import(pathToFileURL(path.join(ROOT, "C_devops/scranton/_frens_lib.mjs")).href);

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
  for (const script of ["_hostpark_lobby_v1.mjs", "_hostpark_affordances_v1.mjs"]) {
    const code = await new Promise((resolve) =>
      spawn(process.execPath, [path.join(ROOT, "C_devops/scranton", script), "--yes", "--open"], {
        env: { ...process.env, FOOBARCH_HOST: base, FOOBARCH_USAGE_PASSWORD: PASSWORD },
        stdio: "inherit",
      }).on("exit", resolve)
    );
    assert.equal(code, 0, `${script} failed`);
  }

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
    for (const f of ["keychain.js", "scranton_lobby_v1_client.js", "surfroster_stage_member.js"]) {
      const { register } = await import(pathToFileURL(path.join(mods, f)).href + `?n=${Math.random()}`);
      const m = register(navi);
      navi.mod[m.name] = m;
      await m.onMount?.();
    }
    return navi.mod.scranton_lobby.lobby;
  }

  const A = await client();
  const B = await client();
  const page = "Clip_Art_Deer_Drawing.jpg";
  const ib = `comments/${page}`;

  assert.deepEqual((await A.affordances()).map((a) => a.name).sort(), ["comments", "frens", "links", "navi_script", "stage_dir", "stage_member", "stagedir"]);
  assert.ok((await A.affordanceForPostKind("stage_member")).plugin, "stage_member interpreter mod is mounted");

  const pre = await A.readAddress("comments", page);
  assert.equal(pre.exists, false, JSON.stringify({ ...pre, descriptor: undefined }).slice(0, 600));
  const first = await A.addressPush("comments", page, { text: "nice deer" });
  assert.equal(first.created, true);
  await B.addressPush("comments", page, { text: "agreed" });
  let r = await B.readAddress("comments", page);
  assert.equal(r.valid, true, r.reason);
  assert.deepEqual(r.rows.map((x) => x.text), ["nice deer", "agreed"]);
  assert.equal(r.rows[0].by, (await A.lobbyKey()).publicKey);
  assert.equal(await A.getTip(A.lobbyIb(page)), null, "comments never create or touch the page's lobby");

  await assert.rejects(B.addressDelete("comments", page, 0), /only the row's author/);

  // Forged writes, signed and paid, are refused by the comments policy.
  async function forged(signerLobby, edit) {
    const t = await A.readAddress("comments", page);
    const state = structuredClone(t.state);
    edit(state);
    const f = await A.buildAddressFrame(ib, t.descriptor, page, state, { base: t.tip.frame, parentAddr: t.tip.addr, n: t.tip.frame.data.n + 1 });
    const body = JSON.stringify({ transform: "mut8", newIbGib: f, dnas: [], intermediateIbGibs: [] });
    const signer = await signerLobby.lobbyKey();
    const headers = await signerLobby.writeHeaders(ib, body, { sign: true, parentAddr: t.tip.addr, signer });
    headers["X-Foobarch-Usage-Token"] = await mint();
    const res = await fetch(`${base}/${ib}`, { method: "PUT", headers, body });
    return { status: res.status, text: await res.text() };
  }
  let f = await forged(B, (s) => s.rows.splice(0, 1));
  assert.equal(f.status, 401, f.text);
  assert.match(f.text, /only the row's author/);
  f = await forged(B, (s) => s.rows.push({ text: "as A", by: s.rows[0].by, at: "t" }));
  assert.equal(f.status, 401, f.text);
  assert.match(f.text, /by must equal signer/);
  f = await forged(B, (s) => (s.page = "elsewhere.jpg"));
  assert.equal(f.status, 401, f.text);

  // Unsigned mut8 is refused too.
  {
    const t = await A.readAddress("comments", page);
    const state = { ...t.state, rows: [...t.rows, { text: "anon", by: "x", at: "t" }] };
    const nf = await A.buildAddressFrame(ib, t.descriptor, page, state, { base: t.tip.frame, parentAddr: t.tip.addr, n: t.tip.frame.data.n + 1 });
    const res = await fetch(`${base}/${ib}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Foobarch-Usage-Token": await mint() },
      body: JSON.stringify({ transform: "mut8", newIbGib: nf, dnas: [], intermediateIbGibs: [] }),
    });
    assert.equal(res.status, 401, await res.text());
  }

  await A.addressDelete("comments", page, 0);
  r = await A.readAddress("comments", page);
  assert.equal(r.valid, true, r.reason);
  assert.deepEqual(r.rows.map((x) => x.text), ["agreed"]);

  // stagedir/{page}: rows { member, slot, pos } with optional slot/pos, through the generated policy.
  const sd1 = await A.addressPush("stagedir", page, { member: "alice/likes/deer", slot: "DS", pos: "0" });
  assert.equal(sd1.created, true);
  await B.addressPush("stagedir", page, { member: "bob/likes/deer", slot: "", pos: "", from: "horizon/enter" });
  r = await A.readAddress("stagedir", page);
  assert.equal(r.valid, true, r.reason);
  assert.deepEqual(r.rows.map((x) => [x.member, x.slot, x.pos, x.from]), [["alice/likes/deer", "DS", "0", ""], ["bob/likes/deer", "", "", "horizon/enter"]]);

  // links/{page}: descriptor-only rows, one surf path each.
  await A.addressPush("links", page, { path: "hypertext/gadgets" });
  await B.addressPush("links", page, { path: "bob/deer_page" });
  const links = await A.readAddress("links", page);
  assert.equal(links.valid, true, links.reason);
  assert.deepEqual(links.rows.map((x) => x.path), ["hypertext/gadgets", "bob/deer_page"]);
  assert.equal(links.descriptor.fields.path.type, "surf");
  await assert.rejects(A.addressPush("links", page, { path: "" }), /path required/);
  await assert.rejects(A.addressPush("stagedir", page, { member: "", slot: "DS" }), /member required/);
  const sdPlugin = (await A.affordanceNamed("stagedir")).plugin;
  assert.deepEqual((await sdPlugin.rowActions(r.rows[1], 1, r, {})).map((a) => a.id), ["place", "trust"]);

  // Frens: an identity policy lists its key; <id>/frens signed by it extends trust one hop.
  const idKeys = crypto.generateKeyPairSync("ed25519").privateKey.export({ format: "jwk" });
  const idOwner = { publicKey: idKeys.x, privateKey: idKeys.d };
  async function openPut(ib, data, extra = {}) {
    const body = JSON.stringify({ transform: "firstGen", newIbGib: { ib, gib: crypto.createHash("sha256").update(JSON.stringify(data)).digest("hex").toUpperCase(), data, rel8ns: { past: [], tjp: [], dna: [], ...(extra.rel8ns || {}) } }, dnas: [], intermediateIbGibs: [], ...(extra.envelope || {}) });
    const res = await fetch(`${base}/${ib}`, { method: "PUT", headers: { "Content-Type": "application/json", "X-Foobarch-Usage-Token": await mint() }, body });
    const text = await res.text();
    assert.ok(res.ok, text);
    return JSON.parse(text).addr;
  }
  await openPut("policies/fam", { keys: [idOwner.publicKey], threshold: 1 });
  const bKey = (await B.lobbyKey()).publicKey;
  const frens = { identity: "fam", keys: [bKey], labels: { [bKey]: "B" }, updated_at: new Date().toISOString() };
  await openPut("fam/frens", frensData("fam", frens, signFrens(idOwner, frens), 0));
  assert.equal((await A.isTrusted(bKey)).trusted, false);
  await A.trustIdentity("fam");
  assert.deepEqual(await A.isTrusted(bKey), { trusted: true, via: "frens of fam" });

  // Editors: identity "crew" names B as an editor (signed), and the write policy policies/crew/frens
  // (a keys policy: identity + B) lets B change the list from its browser; A cannot.
  await host.server.seedSchemas();
  const schemaTip = await (await fetch(`${base}/foobarch/tip/foobarch.schema.keys.v1`)).json();
  await openPut("policies/crew", { keys: [idOwner.publicKey], threshold: 1 });
  await openPut(
    "policies/crew/frens",
    { parts: ["keys_policy", "ibgib_frame", "manifest", "json"], schema_ib: "foobarch.schema.keys.v1", threshold: 1, keys: [idOwner.publicKey, bKey] },
    { rel8ns: { schema: [schemaTip.addr] } }
  );
  const crewFrens = { identity: "crew", keys: ["K1"], labels: {}, updated_at: new Date().toISOString() };
  await openPut("crew/frens", frensData("crew", crewFrens, signFrens(idOwner, crewFrens), 0, signEditors(idOwner, "crew", [bKey])), { rel8ns: { policy: ["policies/crew/frens"] } });
  assert.deepEqual((await A.readFrens("crew")).editors, [bKey]);
  await assert.rejects(A.frensEdit("crew", { add: "K2" }), /not an editor/);
  const edited = await B.frensEdit("crew", { add: "K2", label: "two" });
  assert.equal(edited.keys, 2);
  let crew = await A.readFrens("crew", { fresh: true });
  assert.equal(crew.valid, true, crew.reason);
  assert.deepEqual(crew.keys, ["K1", "K2"]);
  assert.equal(crew.signer, bKey, "the editor signed this generation");
  {
    // A forges a write straight to the host: the editors policy refuses it.
    const t = crew.tip;
    const data = { ...t.frame.data, frens: { ...t.frame.data.frens, keys: ["A_WAS_HERE"] }, n: t.frame.data.n + 1 };
    const rel8ns = { ...t.frame.rel8ns, past: [t.addr] };
    const frame = { ib: "crew/frens", gib: crypto.createHash("sha256").update(JSON.stringify({ data, rel8ns })).digest("hex").toUpperCase(), data, rel8ns };
    await assert.rejects(A.commit("crew/frens", frame, { parentAddr: t.addr, sign: true, signer: await A.lobbyKey() }), /401|threshold/);
  }
  // Frens of frens: crew vouches for fam; trusting crew with 2 hops reaches B through fam.
  await B.frensEdit("crew", { addIdentity: "fam" });
  assert.deepEqual((await A.readFrens("crew", { fresh: true })).identities, ["fam"]);
  await A.trustIdentity("fam", false);
  await A.trustIdentity("crew", true, 1);
  assert.equal((await A.isTrusted(bKey)).trusted, false, "one hop: only crew's keys");
  await A.trustIdentity("crew", true, 2);
  assert.deepEqual(await A.isTrusted(bKey), { trusted: true, via: "frens of fam (via crew)" });

  // navi_script post: the posted bin, read back through GET /<ib> and its sha.
  await A.create(page);
  const script = "echo posted\nnavi.callout('hi')";
  const sha = crypto.createHash("sha256").update(script).digest("hex");
  const aKey = (await A.lobbyKey()).publicKey;
  const postData = { v: 1, kind: "navi_script", page, lobby: A.lobbyIb(page), author: aKey, label: "hello", mode: "js", created_at: new Date().toISOString() };
  const scriptAddr = await openPut(
    "a/hello_script",
    { content_type: "application/navi-script", default_method: "GET", method: { GET: { kind: "bin" } }, post: postData, n: 0 },
    { rel8ns: { bin: [`bin ${sha}`] }, envelope: { bin: { sha256: sha, bytes_b64: Buffer.from(script).toString("base64"), content_type: "application/navi-script" } } }
  );
  await A.appendPush(page, scriptAddr);
  const posts = await B.postsFor(page);
  const sx = posts.list.find((x) => x.addr === scriptAddr);
  assert.equal(sx.valid, true, sx.reason);
  assert.equal((await B.postContent(sx)).text, script);
  assert.equal((await B.affordanceForPostKind("navi_script")).plugin.name, "navi_script");

  console.log("AFFORDANCES HOST SMOKE PASS");
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
