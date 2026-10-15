/**
 * Hostpark scranton avatar contract + the avatar mod (not warez).
 *
 *   scranton/avatar/schema   Lua
 *   scranton/avatar/policy   → schema
 *   scranton_avatar          application/navi-module (B_testkit_mods/scranton_avatar.js)
 *   scranton/avatar          governor: rel8ns.genesis_policy → policy
 *
 * Plant schema/policy/mod first, then the governor, so those firstGens are not
 * gated as avis. Later avis: scranton/avatar/{pubkey}. The mod park is
 * scranton_avatar (not under the governor prefix).
 *
 *   FOOBARCH_HOST=https://foobarch.net node C_devops/scranton/_hostpark_avatar_v1.mjs --yes [--open]
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  getIdentity,
  loadOrCreateOwner,
  signHeadersForBody,
  takeUsageToken,
  DEFAULT_USAGE_PASSWORD,
} from "../identity/_lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const ROOT_IB = "scranton/avatar";
const SCHEMA_IB = `${ROOT_IB}/schema`;
const POLICY_IB = `${ROOT_IB}/policy`;
const MOD_IB = "scranton_avatar";
const CONTRACT = "scranton_avatar_v1";
const LUA_PATH = path.join(__dirname, "avatar_v1_schema.lua");
const MOD_PATH = path.join(ROOT, "B_testkit_mods", "scranton_avatar.js");

const base = (process.env.FOOBARCH_HOST || "https://foobarch.net").replace(/\/$/, "");
const password = process.env.FOOBARCH_USAGE_PASSWORD || DEFAULT_USAGE_PASSWORD;
const open = process.argv.includes("--open");

if (!process.argv.includes("--yes")) {
  console.log("usage: FOOBARCH_HOST=https://foobarch.net node C_devops/scranton/_hostpark_avatar_v1.mjs --yes [--open]");
  process.exit(0);
}

const sha256Hex = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

async function mintToken() {
  return takeUsageToken(base, password);
}

async function getTip(ib) {
  const res = await fetch(`${base}/foobarch/tip/${encodeURIComponent(ib)}`);
  if (res.status === 404) return null;
  const text = await res.text();
  if (!res.ok) throw new Error(`tip ${ib} → ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

const owner = open ? null : loadOrCreateOwner(getIdentity("foobarch"));
const ownerPolicy = open ? null : owner.policy_addr || (await getTip("policies/foobarch-shell"))?.addr;
if (!open && !ownerPolicy) throw new Error("policies/foobarch-shell addr missing (use --open on test hosts)");

const strip = (o, keys) => Object.fromEntries(Object.entries(o || {}).filter(([k]) => !keys.includes(k)));
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

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

const lua = Buffer.from(fs.readFileSync(LUA_PATH, "utf8").replace(/\r\n/g, "\n"), "utf8");
const luaSha = sha256Hex(lua);
const schemaAddr = await commit(
  SCHEMA_IB,
  {
    parts: ["write_schema", "ibgib_frame", "manifest", "json"],
    content_type: "text/x-lua",
    schema_kind: CONTRACT,
    contract: CONTRACT,
    default_method: "GET",
    method: { GET: { kind: "bin" }, ...commitMethods },
  },
  { bin: [`bin ${luaSha}`] },
  { bin: { sha256: luaSha, bytes_b64: lua.toString("base64"), content_type: "text/x-lua" } }
);

const policyAddr = await commit(
  POLICY_IB,
  {
    parts: ["scranton_avatar_v1_policy", "ibgib_frame", "manifest", "json"],
    contract: CONTRACT,
    schema_ib: SCHEMA_IB,
    about: {
      label: CONTRACT,
      description: "Avi cards at scranton/avatar/{pubkey}: signed by that key, optional png bin + relationship links.",
    },
    default_method: "GET",
    method: { GET: { kind: "frame" }, ...commitMethods },
  },
  { schema: [schemaAddr] }
);

const modBytes = Buffer.from(fs.readFileSync(MOD_PATH, "utf8").replace(/\r\n/g, "\n"), "utf8");
const modSha = sha256Hex(modBytes);
const modCtrl = { kind: "mod", target: "scranton_avatar", command: "scranton_avatar", mode: "async" };
const modAddr = await commit(
  MOD_IB,
  {
    parts: ["navi_park", "network_proposal", "ibgib_frame", "manifest", "json"],
    park: "capture",
    content_type: "application/navi-module",
    about: {
      name: "scranton_avatar",
      navi_name: "scranton_avatar",
      label: "scranton_avatar",
      description: "Surfroster plugin: signed avi (thumbnail + alias) shown only after you trust the pubkey.",
      acknowledges: ["scranton/avatar", "scranton/lobby/v1"],
    },
    module: { name: "scranton_avatar" },
    default_method: "GET",
    method: {
      GET: { ...modCtrl },
      POST: { ...modCtrl },
      PUT: { kind: "commit", mode: "async" },
      PATCH: { kind: "commit", mode: "async" },
      DELETE: { kind: "tombstone", mode: "async" },
    },
  },
  { bin: [`bin ${modSha}`] },
  { bin: { sha256: modSha, bytes_b64: modBytes.toString("base64"), content_type: "application/navi-module" } }
);

const governorAddr = await commit(
  ROOT_IB,
  {
    parts: ["scranton_avatar_v1_governor", "ibgib_frame", "manifest", "json"],
    contract: CONTRACT,
    about: {
      label: CONTRACT,
      description: `Every new tip under ${ROOT_IB}/{pubkey} must pass ${POLICY_IB} authorize_genesis().`,
    },
    default_method: "GET",
    method: { GET: { kind: "frame" }, ...commitMethods },
  },
  { genesis_policy: [POLICY_IB] }
);

if (!open) {
  fs.writeFileSync(
    path.join(__dirname, "avatar_v1_state.json"),
    JSON.stringify(
      {
        contract: CONTRACT,
        host: base,
        schema_ib: SCHEMA_IB,
        schema_addr: schemaAddr,
        policy_ib: POLICY_IB,
        policy_addr: policyAddr,
        mod_ib: MOD_IB,
        mod_addr: modAddr,
        governor_ib: ROOT_IB,
        governor_addr: governorAddr,
        published_at: new Date().toISOString(),
      },
      null,
      2
    ) + "\n"
  );
}
console.log("scranton_avatar_v1 hostpark done");
console.log(`  schema   ${SCHEMA_IB} → ${schemaAddr}`);
console.log(`  policy   ${POLICY_IB} → ${policyAddr}`);
console.log(`  mod      ${MOD_IB} → ${modAddr}`);
console.log(`  governor ${ROOT_IB} → ${governorAddr}`);
