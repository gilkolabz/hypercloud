/**
 * Maintain an identity's frens list: <identity>/frens, carrying
 *   data.frens          { identity, keys: [pubkey…], labels: { pubkey: label }, identities?: [identity…] }
 *   data.frens_sig      { key, sig }   ed25519 over "scranton-frens-v1\n" + JSON(frens)
 *   data.frens_editors  { identity, editors: [pubkey…], sig }   keys the identity lets edit the list
 * Readers (scranton_lobby trust identity <id>) accept the list only when frens_sig.key is in
 * policies/<id> or in a frens_editors list signed by a policies/<id> key.
 * Keys are lobby pubkeys (what posts and rows are signed with: `scranton_lobby key`).
 * `identities` are identities this one vouches for (followed when a reader trusts with hops ≥ 2).
 *
 * Write gate: policies/<id> until the first editor is added; then policies/<id>/frens, a keys policy
 * (owner + editors) that is itself gated by policies/<id>.
 *
 *   FOOBARCH_HOST=https://foobarch.net node C_devops/scranton/_hostpark_frens.mjs --identity hypernetizen list
 *   … init                         (empty signed list)
 *   … add <pubkey> [label…] | rm <pubkey>
 *   … vouch <identity> | unvouch <identity>
 *   … editor add <pubkey> | editor rm <pubkey>     (who may edit from a browser: scranton_lobby frens <id> add …)
 */
import crypto from "node:crypto";
import { getIdentity, loadOrCreateOwner, signHeadersForBody } from "../identity/_lib.mjs";
import { frensData, signEditors, signFrens } from "./_frens_lib.mjs";

const base = (process.env.FOOBARCH_HOST || "https://foobarch.net").replace(/\/$/, "");
const password = process.env.FOOBARCH_USAGE_PASSWORD || "";

const argv = process.argv.slice(2);
const at = argv.indexOf("--identity");
const idName = at >= 0 ? argv[at + 1] : "";
const rest = at >= 0 ? [...argv.slice(0, at), ...argv.slice(at + 2)] : argv;
const [verb = "list", ...args] = rest;
const VERBS = ["list", "init", "add", "rm", "vouch", "unvouch", "editor"];
const usage = () => {
  console.log(
    "usage: node C_devops/scranton/_hostpark_frens.mjs --identity <name> list | init | add <pubkey> [label…] | rm <pubkey> | vouch <identity> | unvouch <identity> | editor add|rm <pubkey>"
  );
  process.exit(1);
};
if (!idName || !VERBS.includes(verb)) usage();
if (["add", "rm", "vouch", "unvouch"].includes(verb) && !args[0]) usage();
if (verb === "editor" && (!["add", "rm"].includes(args[0]) || !args[1])) usage();

const identity = getIdentity(idName);
const owner = loadOrCreateOwner(identity);
const id = identity.id;
const ib = `${id}/frens`;
const editorsPolicyIb = `${identity.policyIb}/frens`;

const sha256Hex = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
async function getTip(tipIb) {
  const res = await fetch(`${base}/foobarch/tip/${encodeURIComponent(tipIb)}`);
  if (res.status === 404) return null;
  const text = await res.text();
  if (!res.ok) throw new Error(`tip ${tipIb} → ${res.status}: ${text.slice(0, 200)}`);
  const tip = JSON.parse(text);
  return tip?.tombstone ? null : tip;
}
async function mintToken() {
  const res = await fetch(`${base}/foobarch/tokens`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Foobarch-Usage-Password": password },
    body: JSON.stringify({ count: 1 }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`mint → ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text).tokens[0];
}
async function put(tipIb, data, rel8ns, parentAddr) {
  const gib = sha256Hex(Buffer.from(JSON.stringify({ data, rel8ns }), "utf8")).toUpperCase();
  const body = JSON.stringify({ transform: parentAddr ? "mut8" : "firstGen", newIbGib: { ib: tipIb, gib, data, rel8ns }, dnas: [], intermediateIbGibs: [] });
  const headers = {
    "Content-Type": "application/json",
    "X-Foobarch-Usage-Token": await mintToken(),
    ...signHeadersForBody(owner, { ib: tipIb, parentAddr, body }),
  };
  const res = await fetch(`${base}/${tipIb}`, { method: "PUT", headers, body });
  const text = await res.text();
  if (!res.ok) throw new Error(`PUT ${tipIb} → ${res.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text).addr;
}

const policyTip = await getTip(identity.policyIb);
if (!policyTip?.addr) throw new Error(`${identity.policyIb} is not on ${base} (publish the identity first)`);
if (!(policyTip.frame?.data?.keys || []).includes(owner.owner.publicKey)) {
  throw new Error(`${identity.policyIb} does not list this identity's owner key`);
}

const live = await getTip(ib);
const prev = live?.frame?.data?.frens;
const keys = Array.isArray(prev?.keys) ? [...prev.keys] : [];
const labels = prev?.labels && typeof prev.labels === "object" ? { ...prev.labels } : {};
const identities = Array.isArray(prev?.identities) ? [...prev.identities] : [];
const prevEditors = live?.frame?.data?.frens_editors || null;
let editors = Array.isArray(prevEditors?.editors) ? [...prevEditors.editors] : [];

if (verb === "list") {
  if (!live) console.log(`${ib}: none`);
  else
    console.log(
      [
        `${ib} (${keys.length} fren(s)):`,
        ...keys.map((k) => `  ${k}${labels[k] ? ` (${labels[k]})` : ""}`),
        ...identities.map((x) => `  vouches for identity ${x}`),
        ...editors.map((k) => `  editor ${k}`),
        `  write gate: ${(live.frame?.rel8ns?.policy || []).join(", ") || "(none)"}`,
      ].join("\n")
    );
  process.exit(0);
}
if (verb === "init" && live) {
  console.log(`${ib} already exists (${keys.length} fren(s))`);
  process.exit(0);
}
if (verb !== "init" && !live) throw new Error(`${ib} does not exist yet — run init first`);

const [a0, a1] = args;
let note = "";
if (verb === "add") {
  if (!keys.includes(a0)) keys.push(a0);
  if (args.length > 1) labels[a0] = args.slice(1).join(" ");
  note = `added ${a0}`;
} else if (verb === "rm") {
  if (!keys.includes(a0)) {
    console.log(`${a0} is not on ${ib}`);
    process.exit(0);
  }
  keys.splice(keys.indexOf(a0), 1);
  delete labels[a0];
  note = `removed ${a0}`;
} else if (verb === "vouch") {
  if (a0 === id) throw new Error("an identity cannot vouch for itself");
  if (!identities.includes(a0)) identities.push(a0);
  note = `vouching for ${a0}`;
} else if (verb === "unvouch") {
  if (!identities.includes(a0)) {
    console.log(`${ib} does not vouch for ${a0}`);
    process.exit(0);
  }
  identities.splice(identities.indexOf(a0), 1);
  note = `no longer vouching for ${a0}`;
} else if (verb === "editor") {
  if (a0 === "add" && !editors.includes(a1)) editors.push(a1);
  if (a0 === "rm") editors = editors.filter((k) => k !== a1);
  note = `editor ${a0} ${a1}`;
} else {
  note = "created";
}

let gate = live?.frame?.rel8ns?.policy || [policyTip.addr];
if (verb === "editor") {
  // The editors' write policy: owner + editors, changeable only under policies/<id>.
  const pTip = await getTip(editorsPolicyIb);
  const schema = policyTip.frame?.rel8ns?.schema || [];
  const pData = {
    parts: ["keys_policy", "ibgib_frame", "manifest", "json"],
    schema_ib: policyTip.frame?.data?.schema_ib || "foobarch.schema.keys.v1",
    threshold: 1,
    keys: [owner.owner.publicKey, ...editors.filter((k) => k !== owner.owner.publicKey)],
    n: pTip ? Number(pTip.frame?.data?.n || 0) + 1 : 0,
    timestamp: new Date().toUTCString(),
  };
  const pRel = { past: pTip ? [pTip.addr] : [], tjp: [], dna: [], schema, policy: [policyTip.addr] };
  const pAddr = await put(editorsPolicyIb, pData, pRel, pTip?.addr || null);
  console.log(`${editorsPolicyIb} → ${pAddr} (${pData.keys.length} key(s))`);
  gate = [editorsPolicyIb];
}

const frens = { identity: id, keys, labels, ...(identities.length ? { identities } : {}), updated_at: new Date().toISOString() };
const frensEditors = verb === "editor" ? signEditors(owner.owner, id, editors) : prevEditors;
const parentAddr = live?.addr || null;
const data = frensData(id, frens, signFrens(owner.owner, frens), parentAddr ? Number(live.frame?.data?.n || 0) + 1 : 0, frensEditors);
const rel8ns = { policy: gate, past: parentAddr ? [parentAddr] : [], tjp: [], dna: [] };
const addr = await put(ib, data, rel8ns, parentAddr);
console.log(`${note} · ${ib} → ${addr} (${keys.length} fren(s)${identities.length ? `, vouches for ${identities.join(", ")}` : ""}${editors.length ? `, ${editors.length} editor(s)` : ""})`);
