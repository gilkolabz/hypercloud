/**
 * Hostpark scranton_lobby_v1 schema + policy + governor on foobarch.
 *
 *   scranton/lobby/v1/schema   Lua (authorize = mut8 whitelist, authorize_genesis = create whitelist)
 *   scranton/lobby/v1/policy   → schema; every lobby tip names it as rel8ns.policy
 *   scranton/lobby/v1          governor: rel8ns.genesis_policy → policy, so the host runs
 *                              authorize_genesis() on every new lobby under the prefix
 *
 * All three are write-gated by policies/foobarch-shell (foobarch owner signs mut8s).
 * --open skips the owner policy (local test hosts without policies/foobarch-shell).
 *
 *   FOOBARCH_HOST=https://foobarch.net node C_devops/scranton/_hostpark_lobby_v1.mjs --yes [--open]
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { getIdentity, loadOrCreateOwner, signHeadersForBody } from "../identity/_lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const GOVERNOR_IB = "scranton/lobby/v1";
const SCHEMA_IB = "scranton/lobby/v1/schema";
const POLICY_IB = "scranton/lobby/v1/policy";
const CONTRACT = "scranton_lobby_v1";
const LUA_PATH = path.join(__dirname, "lobby_v1_schema.lua");

const base = (process.env.FOOBARCH_HOST || "https://foobarch.net").replace(/\/$/, "");
const password = process.env.FOOBARCH_USAGE_PASSWORD || "";
const open = process.argv.includes("--open");

if (!process.argv.includes("--yes")) {
  console.log(
    "usage: FOOBARCH_HOST=https://foobarch.net node C_devops/scranton/_hostpark_lobby_v1.mjs --yes [--open]"
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

/** firstGen or mut8 `ib` with `data` (+n/timestamp) and `rel8ns` (+past/tjp/dna/owner policy). Unchanged tips are skipped. */
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

// LF only: a checkout's line endings must not change the published schema bytes.
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
    parts: ["scranton_lobby_v1_policy", "ibgib_frame", "manifest", "json"],
    contract: CONTRACT,
    schema_ib: SCHEMA_IB,
    about: {
      label: CONTRACT,
      description: "Roster lobby v1 — whitelisted create, signed join/leave, OP kick, append index. Linked schema authorize() / authorize_genesis().",
    },
    default_method: "GET",
    method: { GET: { kind: "frame" }, ...commitMethods },
  },
  { schema: [schemaAddr] }
);

const governorAddr = await commit(
  GOVERNOR_IB,
  {
    parts: ["scranton_lobby_v1_governor", "ibgib_frame", "manifest", "json"],
    contract: CONTRACT,
    about: {
      label: CONTRACT,
      description: `Every new tip under ${GOVERNOR_IB}/ must pass ${POLICY_IB} authorize_genesis().`,
    },
    default_method: "GET",
    method: { GET: { kind: "frame" }, ...commitMethods },
  },
  { genesis_policy: [POLICY_IB] }
);

if (!open) {
  fs.writeFileSync(
    path.join(__dirname, "lobby_v1_state.json"),
    JSON.stringify(
      {
        contract: CONTRACT,
        host: base,
        schema_ib: SCHEMA_IB,
        schema_addr: schemaAddr,
        policy_ib: POLICY_IB,
        policy_addr: policyAddr,
        governor_ib: GOVERNOR_IB,
        governor_addr: governorAddr,
        published_at: new Date().toISOString(),
      },
      null,
      2
    ) + "\n"
  );
}
console.log("scranton_lobby_v1 hostpark done");
console.log(`  schema   ${SCHEMA_IB} → ${schemaAddr}`);
console.log(`  policy   ${POLICY_IB} → ${policyAddr}`);
console.log(`  governor ${GOVERNOR_IB} → ${governorAddr}`);
