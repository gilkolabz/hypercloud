/**
 * Hostpark the normative scranton affordances on foobarch.
 *
 * Address affordances (rows under their own policy; rows_v1_schema.lua configured per affordance):
 *   scranton/affordance/v1/<name>/schema   Lua (push one own row / delete one own row, nothing else)
 *   scranton/affordance/v1/<name>/policy   → schema; every <address> tip names it as rel8ns.policy
 *   scranton/affordance/v1/<name>          descriptor
 *     comments   comments/{page}  rows { text }
 *     stagedir   stagedir/{page}  rows { member, slot, pos, from }   interpreter surfroster_stage_member
 *     links      links/{page}     rows { path (type surf) }
 * Post affordances (descriptor only):
 *     stage_member, stage_dir      interpreter surfroster_stage_member
 *     navi_script                  POST application/navi-script (scranton_lobby)
 * Trust:
 *     frens      {identity}/frens, signed by a policies/{identity} key or a named editor (see _hostpark_frens.mjs)
 *   scranton/affordance/v1                 index: data.affordances.names
 *
 * Descriptors live in data.affordance; scranton_lobby ≥ 1.10.0 reads the index, then each descriptor.
 * All tips here are write-gated by policies/foobarch-shell (foobarch owner signs mut8s). A tip whose
 * content is unchanged is skipped (no token, no new generation).
 * --open skips the owner policy (local test hosts without policies/foobarch-shell).
 *
 *   FOOBARCH_HOST=https://foobarch.net node C_devops/scranton/_hostpark_affordances_v1.mjs --yes [--open]
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { getIdentity, loadOrCreateOwner, signHeadersForBody } from "../identity/_lib.mjs";
import { rowsLua } from "./_affordance_lua.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ROOT_IB = "scranton/affordance/v1";

const base = (process.env.FOOBARCH_HOST || "https://foobarch.net").replace(/\/$/, "");
const password = process.env.FOOBARCH_USAGE_PASSWORD || "";
const open = process.argv.includes("--open");

if (!process.argv.includes("--yes")) {
  console.log(
    "usage: FOOBARCH_HOST=https://foobarch.net node C_devops/scranton/_hostpark_affordances_v1.mjs --yes [--open]"
  );
  process.exit(0);
}

function sha256Hex(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

async function mintToken() {
  const res = await fetch(`${base}/foobarch/tokens`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Foobarch-Usage-Password": password,
    },
    body: JSON.stringify({ count: 1 }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`mint → ${res.status}: ${text.slice(0, 200)}`);
  const token = JSON.parse(text).tokens?.[0];
  if (!token) throw new Error("mint returned no token");
  return token;
}

async function getTip(ib) {
  const res = await fetch(`${base}/foobarch/tip/${encodeURIComponent(ib)}`);
  if (res.status === 404) return null;
  const text = await res.text();
  if (!res.ok) throw new Error(`tip ${ib} → ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

const owner = open ? null : loadOrCreateOwner(getIdentity("foobarch"));
const ownerPolicy = open
  ? null
  : owner.policy_addr || (await getTip("policies/foobarch-shell"))?.addr;
if (!open && !ownerPolicy) throw new Error("policies/foobarch-shell addr missing (use --open on test hosts)");

const strip = (o, keys) => Object.fromEntries(Object.entries(o || {}).filter(([k]) => !keys.includes(k)));
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** firstGen or mut8 `ib` with `data` (+n/timestamp) and `rel8ns` (+past/tjp/dna/owner policy). */
async function commit(ib, data, rel8ns, extra = {}) {
  const tip = await getTip(ib);
  const parentAddr = tip && !tip.tombstone ? tip.addr : null;
  if (
    parentAddr &&
    sameJson(strip(tip.frame?.data, ["n", "timestamp"]), data) &&
    sameJson(strip(tip.frame?.rel8ns, ["past", "tjp", "dna", "policy"]), rel8ns)
  ) {
    console.log(`same     ${ib} → ${parentAddr}`);
    return parentAddr;
  }
  const fullData = {
    ...data,
    n: parentAddr ? Number(tip.frame?.data?.n || 0) + 1 : 0,
    timestamp: new Date().toUTCString(),
  };
  const fullRel8ns = {
    ...rel8ns,
    ...(ownerPolicy ? { policy: [ownerPolicy] } : {}),
    past: parentAddr ? [parentAddr] : [],
    tjp: [],
    dna: [],
  };
  const gib = sha256Hex(Buffer.from(JSON.stringify({ data: fullData, rel8ns: fullRel8ns }), "utf8")).toUpperCase();
  const envelope = {
    transform: parentAddr ? "mut8" : "firstGen",
    newIbGib: { ib, gib, data: fullData, rel8ns: fullRel8ns },
    dnas: [],
    intermediateIbGibs: [],
    ...extra,
  };
  const body = JSON.stringify(envelope);
  const headers = {
    "Content-Type": "application/json",
    "X-Foobarch-Usage-Token": await mintToken(),
  };
  if (parentAddr && tip.frame?.rel8ns?.policy?.length) {
    if (!owner) throw new Error(`${ib} is owner-gated; rerun without --open`);
    Object.assign(headers, signHeadersForBody(owner, { ib, parentAddr, body }));
  }
  const res = await fetch(`${base}/${ib}`, { method: "PUT", headers, body });
  const text = await res.text();
  if (!res.ok) throw new Error(`PUT ${ib} → ${res.status}: ${text.slice(0, 400)}`);
  const addr = JSON.parse(text).addr;
  console.log(`${envelope.transform} ${ib} → ${addr}`);
  return addr;
}

const commitMethods = { PUT: { kind: "commit" }, PATCH: { kind: "commit" } };
const frameMethods = { default_method: "GET", method: { GET: { kind: "frame" }, ...commitMethods } };

const descriptor = (name, label, description, affordance) => ({
  parts: ["scranton_affordance_v1", "ibgib_frame", "manifest", "json"],
  contract: "scranton_affordance_v1",
  about: { label, description },
  affordance: { v: 1, name, label, description, ...affordance },
  ...frameMethods,
});

const ROWS = [
  {
    name: "comments",
    label: "comments",
    description:
      "A comments table for any page, kept at comments/{page}. Anyone may start it; its policy accepts only text rows signed by their author, and the page's lobby is never changed.",
    address: "comments/{page}",
    key: "comments",
    fields: { text: { max: 2000 } },
    columns: ["by", "text", "at"],
  },
  {
    name: "stagedir",
    label: "stage directions",
    description:
      "Shared stage directions for a page, kept at stagedir/{page}: one signed row per placement { member, slot, pos, from } applied onto the reader's current stage (stagedir place). Slot/pos empty = the member's own stage_dir. from (optional) = only applied on its own when the reader arrives from that page.",
    address: "stagedir/{page}",
    key: "stagedir",
    fields: { member: { max: 512 }, slot: { min: 0, max: 16 }, pos: { min: 0, max: 8 }, from: { min: 0, max: 512 } },
    columns: ["by", "member", "slot", "pos", "from", "at"],
    interpreter: { mod: "surfroster_stage_member" },
  },
  {
    name: "links",
    label: "links",
    description:
      "Shared links for any page, kept at links/{page}: one signed row per link { path }. A path resolves via surf; following it surfs there.",
    address: "links/{page}",
    key: "links",
    fields: { path: { max: 512, type: "surf" } },
    columns: ["path", "by", "at"],
  },
];

const POSTS = [
  {
    name: "stage_member",
    label: "stage member",
    description:
      "A post whose frame is a stage member for the page (data.post.stage_dir says where it stands). Readers may place it onto their stage or trust its author to auto-place.",
    post_kind: "stage_member",
    interpreter: { mod: "surfroster_stage_member" },
    post_fields: ["page", "lobby", "author", "stage_dir", "label", "created_at"],
  },
  {
    name: "stage_dir",
    label: "whole stage",
    description:
      "A post whose frame is a whole stage (stage_dir JSON). Readers may apply it (replaces their stage) or trust its author to apply it on surf. Only the posted bytes apply.",
    post_kind: "stage_dir",
    interpreter: { mod: "surfroster_stage_member" },
    post_fields: ["page", "lobby", "author", "label", "created_at"],
  },
  {
    name: "navi_script",
    label: "navi-script",
    description:
      "A post whose frame is a navi-script park (application/navi-script). Readers may show or POST it; trusted authors' scripts run on surf. Only the posted bytes run. navi itself runs the park — no extra interpreter mod.",
    post_kind: "navi_script",
    post_fields: ["page", "lobby", "author", "label", "mode", "created_at"],
  },
];

const state = { host: base, index: null, affordances: {} };

for (const r of ROWS) {
  const ib = `${ROOT_IB}/${r.name}`;
  const contract = `scranton_affordance_v1_${r.name}`;
  // LF only: a checkout's line endings must not change the published schema bytes.
  const lua = Buffer.from(rowsLua({ key: r.key, fields: r.fields }).replace(/\r\n/g, "\n"), "utf8");
  const luaSha = sha256Hex(lua);
  const schemaAddr = await commit(
    `${ib}/schema`,
    {
      parts: ["write_schema", "ibgib_frame", "manifest", "json"],
      content_type: "text/x-lua",
      schema_kind: contract,
      contract,
      default_method: "GET",
      method: { GET: { kind: "bin" }, ...commitMethods },
    },
    { bin: [`bin ${luaSha}`] },
    { bin: { sha256: luaSha, bytes_b64: lua.toString("base64"), content_type: "text/x-lua" } }
  );
  const policyAddr = await commit(
    `${ib}/policy`,
    {
      parts: [`${contract}_policy`, "ibgib_frame", "manifest", "json"],
      contract,
      schema_ib: `${ib}/schema`,
      about: {
        label: `${r.label} policy`,
        description: `${r.address}: each write pushes one row { ${Object.keys(r.fields).join(", ")} } signed by its author, or deletes one of the signer's own rows. Nothing else changes.`,
      },
      ...frameMethods,
    },
    { schema: [schemaAddr] }
  );
  const { name, label, description, ...rest } = r;
  const addr = await commit(ib, descriptor(name, label, description, { ...rest, policy_ib: `${ib}/policy` }), {});
  state.affordances[name] = { descriptor: { ib, addr }, schema: { ib: `${ib}/schema`, addr: schemaAddr }, policy: { ib: `${ib}/policy`, addr: policyAddr } };
}

for (const p of POSTS) {
  const ib = `${ROOT_IB}/${p.name}`;
  const { name, label, description, ...rest } = p;
  state.affordances[name] = { descriptor: { ib, addr: await commit(ib, descriptor(name, label, description, rest), {}) } };
}

{
  const ib = `${ROOT_IB}/frens`;
  const addr = await commit(
    ib,
    descriptor(
      "frens",
      "frens",
      "An identity's trust list: {identity}/frens with data.frens { identity, keys[], labels?, identities? } and data.frens_sig { key, sig }, an ed25519 signature over \"scranton-frens-v1\\n\" + JSON(frens) by a key in policies/{identity} or by an editor named in data.frens_editors (signed by a policies/{identity} key). Trusting the identity trusts every key listed; with hops ≥ 2 also the frens of the identities it vouches for.",
      {
        identity_address: "{identity}/frens",
        key: "frens",
        signature: { prefix: "scranton-frens-v1\n", by: "policies/{identity} or frens_editors" },
        editors: { key: "frens_editors", prefix: "scranton-frens-editors-v1\n", by: "policies/{identity}", write_policy: "policies/{identity}/frens" },
        trust: { hops: { default: 1, max: 3 }, follows: "frens.identities" },
      }
    ),
    {}
  );
  state.affordances.frens = { descriptor: { ib, addr } };
}

const names = [...ROWS, ...POSTS].map((x) => x.name).concat("frens");
state.index = {
  ib: ROOT_IB,
  addr: await commit(
    ROOT_IB,
    {
      parts: ["scranton_affordance_v1_index", "ibgib_frame", "manifest", "json"],
      contract: "scranton_affordance_v1",
      about: {
        label: "scranton affordances",
        description: `Normative affordance descriptors live at ${ROOT_IB}/<name>; this index lists them.`,
      },
      affordances: { names },
      ...frameMethods,
    },
    {}
  ),
};

if (!open) {
  fs.writeFileSync(
    path.join(__dirname, "affordances_v1_state.json"),
    JSON.stringify({ ...state, published_at: new Date().toISOString() }, null, 2) + "\n"
  );
}
console.log(`scranton affordances v1 hostpark done (${names.join(", ")})`);
