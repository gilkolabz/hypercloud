/**
 * Offline smoke: sprinter_client ↔ sprinter_server eoas (relay simulated in-process).
 *   node C_devops/scranton/_smoke_sprinter_eoas.mjs
 */
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const mods = path.join(ROOT, "B_testkit_mods");
const origin = "https://foobarch.net";

/** Just enough element for capture/apply: attributes, clone, outerHTML, events. */
class FakeEl {
  constructor(tag, attrs = {}) {
    this.tagName = tag.toUpperCase();
    this._a = new Map(Object.entries(attrs));
    this.isConnected = true;
    this.style = { outline: "", outlineOffset: "" };
    this.events = [];
  }
  get attributes() {
    return [...this._a].map(([name, value]) => ({ name, value }));
  }
  getAttribute(n) {
    return this._a.has(n) ? this._a.get(n) : null;
  }
  setAttribute(n, v) {
    this._a.set(n, String(v));
  }
  removeAttribute(n) {
    this._a.delete(n);
  }
  cloneNode() {
    return new FakeEl(this.tagName.toLowerCase(), Object.fromEntries(this._a));
  }
  querySelectorAll() {
    return [];
  }
  get outerHTML() {
    const a = this.attributes.map(({ name, value }) => ` ${name}="${value}"`).join("");
    return `<${this.tagName.toLowerCase()}${a}></${this.tagName.toLowerCase()}>`;
  }
  dispatchEvent(e) {
    this.events.push(e.type);
    return true;
  }
}
globalThis.HTMLElement = FakeEl;

function memNavi() {
  const items = new Map();
  return {
    origin,
    mod: {},
    storage: {
      item: {
        get: async (k) => structuredClone(items.get(k) ?? null),
        set: async (k, v) => void items.set(k, structuredClone(v)),
        del: async (k) => void items.delete(k),
      },
    },
    on() {},
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

let lastMime = "";
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  const segs = u.pathname.replace(/^\/+/, "").split("/");
  if (segs[0] !== "sprinter") return new Response("not sprinter", { status: 404 });
  const headers = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  server.callinRequest = { method: init.method || "GET", headers, body: init.body || "", viaRelay: true };
  try {
    const out = await sprinterCmd.execute(...segs.slice(1));
    lastMime = typeof out === "object" && out ? out.mime : "application/json";
    return new Response(typeof out === "object" && out ? out.media : out, { status: 200 });
  } finally {
    server.callinRequest = null;
  }
};
const get = async (rest) => (await fetch(`${origin}/sprinter/eoas${rest}`)).text();
const getJson = async (rest) => JSON.parse(await get(rest));

async function client() {
  const n = memNavi();
  await load(n, ["keychain.js", "sprinter_client.js"]);
  return n.mod.sprinter_client;
}
const A = await client();
const B = await client();
const hookFor = (c, el) => {
  const hash = el.getAttribute("data-hash");
  c.eoas.hooks.set(hash, { el, registered: null, lastPushed: "", checking: false });
  return hash;
};

// Register: the claim's work, with rules.
const elA = new FakeEl("div", { "data-ytplayer": "abc", "data-yt-t": "100", "data-yt-vol": "50", style: "outline:2px solid red" });
const reg = await A.eoas.register(elA, { watch: ["data-yt-t", "data-yt-vol"], deadzone: { "data-yt-t": 5 } });
const hash = reg.hash;
assert.equal(reg.rev, 0);
assert.ok(elA.getAttribute("data-hash"), "register stamps a data-hash");
assert.ok(elA.events.includes("stage-dirty"), "a fresh data-hash asks the stage to save");

const raw = await get(`/${hash}`);
assert.match(raw, /data-yt-t="100"/);
assert.match(lastMime, /^text\/plain/, "raw html never served as text/html");
let st = await getJson(`/${hash}/state`);
assert.equal(st.rev, 0);
assert.deepEqual(st.watch, ["data-yt-t", "data-yt-vol"]);
assert.equal(st.attrs.style, undefined, "style is ignored by default");
assert.equal(st.attrs["data-hash"], undefined);
assert.equal((await getJson(`/${hash}/data-yt-t`)).value, "100");
assert.equal((await getJson(`/${hash}/attrs/data-yt-vol`)).value, "50");
assert.equal((await getJson(`/${hash}/tag`)).value, "div");
assert.equal((await getJson(`/${hash}/nope`)).status, 404);

// Owner tick: pushes only when the capture changed.
await A.eoas.tick();
assert.equal(A.eoas.stats.pushes, 1, "no change, no push");
elA.setAttribute("data-yt-t", "103");
await A.eoas.tick();
assert.equal(A.eoas.stats.pushes, 2);
assert.equal((await getJson(`/${hash}/rev`)).value, 1);

// Follower: inside the deadzone nothing happens; outside it the record wins.
const elB = new FakeEl("div", { "data-hash": hash, "data-ytplayer": "abc", "data-yt-t": "101", "data-yt-vol": "50" });
hookFor(B, elB);
await B.eoas.check();
assert.equal(B.eoas.stats.updates, 0, "101 vs 103 is within the 5s deadzone");
elB.setAttribute("data-yt-vol", "20");
await B.eoas.check();
assert.equal(elB.getAttribute("data-yt-vol"), "50");
assert.equal(elB.getAttribute("data-yt-t"), "101", "in-deadzone attr left alone");
assert.ok(elB.events.includes("sprinter:update") && elB.events.includes("stage-dirty"));
elB.setAttribute("data-yt-t", "90");
await B.eoas.check();
assert.equal(elB.getAttribute("data-yt-t"), "103");
assert.equal(B.eoas.stats.updates, 2);
// Unwatched attributes never make it stale.
elB.setAttribute("data-ytplayer", "other");
await B.eoas.check();
assert.equal(elB.getAttribute("data-ytplayer"), "other");

// Only the owner writes.
await assert.rejects(B.eoas.register(elB, {}), /registered to another key/);
const forged = JSON.stringify({ v: 1, hash, rev: 2, html: "<b></b>", attrs: { "data-yt-t": "0" } });
let r = JSON.parse(await (await fetch(`${origin}/sprinter/eoas/${hash}`, { method: "POST", headers: { "content-type": "application/json" }, body: forged })).text());
assert.equal(r.status, 401);
r = JSON.parse(await (await fetch(`${origin}/sprinter/eoas/${hash}`, { method: "POST", body: JSON.stringify({ v: 1, hash, rev: 9, html: "", attrs: {} }) })).text());
assert.equal(r.status, 409);
r = JSON.parse(await (await fetch(`${origin}/sprinter/eoas/${hash}`, { method: "POST", body: JSON.stringify({ v: 1, hash, rev: 2, html: "", attrs: {}, extra: 1 }) })).text());
assert.match(r.error, /field not allowed: extra/);

// Local operator view.
assert.match(await sprinterCmd.execute("eoas", "list"), new RegExp(hash));
assert.match(await sprinterCmd.execute("status"), /element registers: 1/);
assert.match(await A.commands.sprinter_client.execute("eoas", "status"), /owned 1/);

// Unregister: owner only, then followers see no register.
assert.match(await A.eoas.unregister(hash), /unregistered/);
assert.equal((await getJson(`/${hash}/state`)).status, 404);
await B.eoas.check();
assert.equal(B.eoas.hooks.get(hash).registered, false);
assert.match(await sprinterCmd.execute("eoas", "list"), /no element registers/);

// Lobbies untouched by the new room.
assert.equal(JSON.parse(await (await fetch(`${origin}/sprinter`)).text()).tagline, "we proudly bring you version S");

console.log("SPRINTER EOAS SMOKE PASS");
