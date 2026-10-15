/**
 * Publish tips to foobarch_host for a named identity. Refuses unless --yes.
 *
 * Bootstrap: schema tip → policy tip (rel8ns.schema) → lock both under policy → tips.
 * Hypertext identity links the shared schema but does not re-lock it.
 *
 *   node C_devops/identity/_publish.mjs --yes
 *   node C_devops/identity/_publish.mjs --yes --identity hypertext
 *   node C_devops/identity/_publish.mjs --yes --identity torus
 *   node C_devops/identity/_publish.mjs --yes navi_shell.js
 *   node C_devops/identity/_publish.mjs --yes --identity hypertext enter
 *   node C_devops/identity/_publish.mjs --yes --identity torus text_editor
 *
 * Env:
 *   FOOBARCH_HOST            default http://localhost:5353
 *   FOOBARCH_USAGE_PASSWORD  local mint password (not stored in this repo)
 *   https://foobarch.net spends the local token reserve (_mint_token_reserve.mjs)
 *   FOOBARCH_STATIC          default foobarch/static
 */
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_HOST,
  DEFAULT_STATIC,
  DEFAULT_USAGE_PASSWORD,
  KEYS_V1_LUA,
  SCHEMA_CONTENT_TYPE,
  SCHEMA_IB,
  buildPolicyEnvelope,
  buildPolicyFrame,
  buildProxyFrame,
  buildPutEnvelope,
  buildSchemaFrame,
  buildShellFrame,
  getIdentity,
  listIdentities,
  loadOrCreateOwner,
  parkMethodBlock,
  readAssetBytes,
  resolvePublishSelection,
  saveJson,
  signHeadersForBody,
  takeUsageToken,
} from "./_lib.mjs";

function parseArgs(argv) {
  const yes = argv.includes("--yes");
  let identityName = "foobarch";
  const names = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--yes") continue;
    if (a === "--identity" || a === "-i") {
      identityName = argv[++i] || identityName;
      continue;
    }
    if (a.startsWith("--identity=")) {
      identityName = a.slice("--identity=".length) || identityName;
      continue;
    }
    if (a.startsWith("-")) {
      throw new Error(`unknown flag: ${a}`);
    }
    names.push(a);
  }
  return { yes, names, identityName };
}

async function mintToken(base, password) {
  return takeUsageToken(base, password);
}

async function getTip(base, ib) {
  const res = await fetch(`${base}/foobarch/tip/${encodeURIComponent(ib)}`);
  if (res.status === 404) return null;
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GET tip ${ib} → ${res.status}: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text);
}

async function putCommit(base, ib, envelope, headers, method = "PUT") {
  const body = JSON.stringify(envelope);
  const verb = String(method || "PUT").toUpperCase();
  const res = await fetch(`${base}/${ib}`, {
    method: verb,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* ignore */
  }
  if (!res.ok) {
    throw new Error(`${verb} /${ib} → ${res.status}: ${text.slice(0, 400)}`);
  }
  return {
    status: res.status,
    addr: res.headers.get("x-foobarch-ib^gib") || json?.addr || null,
    body: json || text,
  };
}

/** Pick a tip method whose kind is commit (host defaults omit→commit for PUT/PATCH). */
function commitMethodForTip(frame) {
  const block = parkMethodBlock(frame);
  if (!block) return "PUT";
  for (const m of ["PATCH", "PUT"]) {
    const c = block[m];
    if (!c) return m;
    if (String(c.kind || "").toLowerCase() === "commit") return m;
  }
  for (const [m, c] of Object.entries(block)) {
    if (String(c?.kind || "").toLowerCase() === "commit") return m;
  }
  return "PUT";
}

function schemaLinked(frame) {
  return !!(
    frame?.rel8ns?.schema?.[0] ||
    frame?.data?.schema_ib ||
    frame?.data?.schema
  );
}

async function putSchema(base, owner, identity, password, opts = {}) {
  const frame = buildSchemaFrame({
    parentAddr: opts.parentAddr || null,
    policyAddr: opts.policyAddr || null,
    n: opts.n != null ? opts.n : 0,
    lua: KEYS_V1_LUA,
  });
  const bytes = frame._luaBytes;
  const sha = frame._luaSha;
  delete frame._luaBytes;
  delete frame._luaSha;
  const envelope = buildPutEnvelope(frame, bytes, SCHEMA_CONTENT_TYPE);
  envelope.bin = {
    sha256: sha,
    bytes_b64: bytes.toString("base64"),
    content_type: SCHEMA_CONTENT_TYPE,
  };
  const body = JSON.stringify(envelope);
  const token = await mintToken(base, password);
  /** @type {Record<string, string>} */
  const headers = { "X-Foobarch-Usage-Token": token };
  if (opts.sign && opts.parentAddr) {
    Object.assign(
      headers,
      signHeadersForBody(owner, {
        ib: SCHEMA_IB,
        parentAddr: opts.parentAddr,
        body,
      })
    );
  }
  const r = await putCommit(base, SCHEMA_IB, envelope, headers);
  owner.schema_addr = r.addr;
  saveJson(identity.ownerPath, owner);
  return r.addr;
}

/**
 * Ensure stock Lua schema tip exists (open firstGen). Lock later after policy.
 * Non-locking identities only require an existing schema tip.
 */
async function ensureSchema(base, owner, identity, password) {
  const existing = await getTip(base, SCHEMA_IB);
  if (existing && !existing.tombstone) {
    console.log(`schema ok ${existing.addr}`);
    owner.schema_addr = existing.addr;
    owner.schema_ib = SCHEMA_IB;
    saveJson(identity.ownerPath, owner);
    return existing.addr;
  }
  if (!identity.lockSchema) {
    throw new Error(
      `schema tip ${SCHEMA_IB} missing — publish foobarch identity first to seed it`
    );
  }
  const addr = await putSchema(base, owner, identity, password, { n: 0 });
  console.log(`schema firstGen ${addr}`);
  owner.schema_ib = SCHEMA_IB;
  saveJson(identity.ownerPath, owner);
  return addr;
}

async function putPolicyMut8(base, owner, identity, password, parentAddr, opts) {
  const policyIb = identity.policyIb;
  const frame = buildPolicyFrame(owner, {
    parentAddr,
    policyAddr: opts.policyGateAddr,
    schemaAddr: opts.schemaAddr,
    n: opts.n,
    policyIb,
  });
  const envelope = buildPolicyEnvelope(frame);
  const body = JSON.stringify(envelope);
  const token = await mintToken(base, password);
  /** @type {Record<string, string>} */
  const headers = { "X-Foobarch-Usage-Token": token };
  if (opts.sign) {
    Object.assign(
      headers,
      signHeadersForBody(owner, { ib: policyIb, parentAddr, body })
    );
  }
  const r = await putCommit(base, policyIb, envelope, headers);
  owner.policy_addr = r.addr;
  saveJson(identity.ownerPath, owner);
  return r.addr;
}

async function ensurePolicy(base, owner, identity, password, schemaAddr) {
  const policyIb = identity.policyIb;
  const existing = await getTip(base, policyIb);

  if (existing && !existing.tombstone) {
    const addr = existing.addr;
    const keys = existing.frame?.data?.keys;
    const keyed =
      Array.isArray(keys) &&
      keys.length === 1 &&
      keys[0] === owner.owner.publicKey;
    const gated = !!existing.frame?.rel8ns?.policy?.[0];
    const hasSchema = schemaLinked(existing.frame);

    if (keyed && gated && hasSchema) {
      console.log(`policy ok (schema+write-gated) ${addr}`);
      owner.policy_addr = addr;
      saveJson(identity.ownerPath, owner);
      return addr;
    }

    // Rebuild shape: mut8 to attach schema and/or self-lock.
    const parentAddr = existing.addr;
    const n = Number(existing.frame?.data?.n || 0) + 1;
    const needSign = gated;
    const gate = gated
      ? existing.frame.rel8ns.policy[0]
      : parentAddr;
    const next = await putPolicyMut8(base, owner, identity, password, parentAddr, {
      sign: needSign,
      n,
      policyGateAddr: gate,
      schemaAddr,
    });
    console.log(`policy mut8 (schema+lock) ${next}`);
    return next;
  }

  const frame = buildPolicyFrame(owner, { schemaAddr, policyIb });
  const envelope = buildPolicyEnvelope(frame);
  const token = await mintToken(base, password);
  const r = await putCommit(base, policyIb, envelope, {
    "X-Foobarch-Usage-Token": token,
  });
  console.log(`policy firstGen ${r.addr}`);
  const locked = await putPolicyMut8(base, owner, identity, password, r.addr, {
    sign: false,
    n: 1,
    policyGateAddr: r.addr,
    schemaAddr,
  });
  console.log(`policy locked under ${r.addr} → ${locked}`);
  owner.potted_at = new Date().toISOString();
  saveJson(identity.ownerPath, owner);
  return locked;
}

/** After policy is gated, pin schema tip under that policy (open → gated). */
async function lockSchema(base, owner, identity, password, schemaAddr, policyAddr) {
  if (!identity.lockSchema) {
    console.log(`schema lock skipped (identity ${identity.id})`);
    return schemaAddr;
  }
  const tip = await getTip(base, SCHEMA_IB);
  if (!tip || tip.tombstone) {
    throw new Error("schema tip missing before lock");
  }
  if (tip.frame?.rel8ns?.policy?.[0]) {
    console.log(`schema already write-gated ${tip.addr}`);
    owner.schema_addr = tip.addr;
    saveJson(identity.ownerPath, owner);
    return tip.addr;
  }
  const n = Number(tip.frame?.data?.n || 0) + 1;
  const next = await putSchema(base, owner, identity, password, {
    parentAddr: tip.addr,
    policyAddr,
    n,
    sign: false, // tip still open
  });
  console.log(`schema locked under policy ${policyAddr} → ${next}`);
  return next;
}

async function publishAsset(base, owner, asset, policyAddr, password, staticDir) {
  const bytes = readAssetBytes(asset, staticDir);
  const tip = await getTip(base, asset.ib);
  const parentAddr = tip && !tip.tombstone ? tip.addr : null;
  const n = parentAddr ? Number(tip.frame?.data?.n || 0) + 1 : 0;
  /** @type {Record<string, string[]>} */
  const rel8ns = {};
  for (const [name, ibs] of Object.entries(asset.rel8 || {})) {
    rel8ns[name] = [];
    for (const ib of ibs) {
      const t = await getTip(base, ib);
      if (!t || t.tombstone) throw new Error(`${asset.ib}: rel8 ${name} → ${ib} has no live tip`);
      rel8ns[name].push(t.addr);
    }
  }
  const frame = buildShellFrame(asset, bytes, {
    policyAddr,
    parentAddr,
    n,
    rel8ns,
  });
  if (asset.keepReserve && tip?.frame?.data?.foobarch) {
    frame.data.foobarch = tip.frame.data.foobarch;
  }
  const envelope = buildPutEnvelope(frame, bytes, asset.content_type);
  const body = JSON.stringify(envelope);
  const token = await mintToken(base, password);
  /** @type {Record<string, string>} */
  const headers = { "X-Foobarch-Usage-Token": token };

  if (parentAddr && tip.frame?.rel8ns?.policy?.[0]) {
    Object.assign(
      headers,
      signHeadersForBody(owner, {
        ib: asset.ib,
        parentAddr,
        body,
      })
    );
  }

  const r = await putCommit(
    base,
    asset.ib,
    envelope,
    headers,
    tip ? commitMethodForTip(tip.frame) : "PUT"
  );
  console.log(
    `${parentAddr ? "mut8" : "firstGen"} ${asset.ib} → ${r.addr} (${bytes.length} bytes)`
  );
  return r;
}

async function publishProxy(base, owner, tipDef, policyAddr, password) {
  const tip = await getTip(base, tipDef.ib);
  const parentAddr = tip && !tip.tombstone ? tip.addr : null;
  const n = parentAddr ? Number(tip.frame?.data?.n || 0) + 1 : 0;
  const frame = buildProxyFrame(tipDef, { policyAddr, parentAddr, n });
  const envelope = buildPolicyEnvelope(frame);
  const body = JSON.stringify(envelope);
  const token = await mintToken(base, password);
  /** @type {Record<string, string>} */
  const headers = { "X-Foobarch-Usage-Token": token };
  if (parentAddr && tip.frame?.rel8ns?.policy?.[0]) {
    Object.assign(
      headers,
      signHeadersForBody(owner, {
        ib: tipDef.ib,
        parentAddr,
        body,
      })
    );
  }
  const method = tip ? commitMethodForTip(tip.frame) : "PUT";
  const r = await putCommit(base, tipDef.ib, envelope, headers, method);
  console.log(
    `${parentAddr ? "mut8" : "firstGen"} ${tipDef.ib} → ${r.addr} (${method} ${tipDef.kind || "proxy"} ${tipDef.target})`
  );
  return r;
}

const { yes, names, identityName } = parseArgs(process.argv.slice(2));
if (!yes) {
  console.error(
    "refusing to PUT — pass --yes after reviewing: node C_devops/identity/_shape.mjs [--identity NAME]"
  );
  process.exit(1);
}

const identity = getIdentity(identityName);
const base = (process.env.FOOBARCH_HOST || DEFAULT_HOST).replace(/\/$/, "");
const password =
  process.env.FOOBARCH_USAGE_PASSWORD || DEFAULT_USAGE_PASSWORD;
const staticDir = process.env.FOOBARCH_STATIC
  ? path.resolve(process.env.FOOBARCH_STATIC)
  : DEFAULT_STATIC;

const owner = loadOrCreateOwner(identity);
const { assets, proxies } = resolvePublishSelection(names, identity);

if (assets.length && !fs.existsSync(staticDir)) {
  // hypertext assets are all path-based under B_fragments; static only needed for file: assets
  const needsStatic = assets.some((a) => a.file && !a.path);
  if (needsStatic) {
    throw new Error(`static dir missing: ${staticDir}`);
  }
}

console.log(`identity: ${identity.id} (known: ${listIdentities().join(", ")})`);
console.log(`host:     ${base}`);
if (assets.some((a) => a.file && !a.path)) console.log(`static:   ${staticDir}`);
console.log(`public:   ${identity.publicPath}`);
console.log(`schema:   ${SCHEMA_IB}`);
console.log(`policy:   ${identity.policyIb}`);
if (assets.length) {
  console.log(`assets:   ${assets.map((a) => a.ib).join(", ")}`);
}
if (proxies.length) {
  console.log(`proxies:  ${proxies.map((t) => t.ib).join(", ")}`);
}

const schemaAddr = await ensureSchema(base, owner, identity, password);
const policyAddr = await ensurePolicy(base, owner, identity, password, schemaAddr);
await lockSchema(base, owner, identity, password, schemaAddr, policyAddr);

for (const asset of assets) {
  await publishAsset(base, owner, asset, policyAddr, password, staticDir);
}
for (const tipDef of proxies) {
  await publishProxy(base, owner, tipDef, policyAddr, password);
}

console.log("publish done");
