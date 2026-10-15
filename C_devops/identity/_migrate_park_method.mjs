/**
 * Mut8 foobarch park tips: data.http → data.method (then delete http).
 *
 * Dry-run (default):
 *   node C_devops/identity/_migrate_park_method.mjs
 *
 * Apply on foobarch.net:
 *   node C_devops/identity/_migrate_park_method.mjs --yes
 *
 * One tip only:
 *   node C_devops/identity/_migrate_park_method.mjs --yes --identity torus opry
 *
 * Env: FOOBARCH_HOST, FOOBARCH_USAGE_PASSWORD (same as _publish.mjs)
 */
import {
  DEFAULT_HOST,
  DEFAULT_USAGE_PASSWORD,
  buildMethodMigratedFrame,
  buildPolicyEnvelope,
  getIdentity,
  loadOrCreateOwner,
  needsParkMethodMigrate,
  parkMethodBlock,
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
    if (a.startsWith("-")) continue;
    names.push(a);
  }
  return { yes, names, identityName };
}

async function mintToken(base, password) {
  return takeUsageToken(base, password);
}

async function listTips(base, password) {
  const res = await fetch(`${base}/foobarch/list`, {
    headers: { "X-Foobarch-Usage-Password": password },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`list → ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text).tips || [];
}

async function getTip(base, ib) {
  const res = await fetch(`${base}/foobarch/tip/${encodeURIComponent(ib)}`);
  if (res.status === 404) return null;
  const text = await res.text();
  if (!res.ok) throw new Error(`GET tip ${ib} → ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

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

async function putCommit(base, ib, envelope, headers, method = "PUT") {
  const body = JSON.stringify(envelope);
  const verb = String(method || "PUT").toUpperCase();
  const res = await fetch(`${base}/${ib}`, {
    method: verb,
    headers: { "Content-Type": "application/json", ...headers },
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${verb} /${ib} → ${res.status}: ${text.slice(0, 400)}`);
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* ignore */
  }
  return {
    addr: res.headers.get("x-foobarch-ib^gib") || json?.addr || null,
  };
}

const { yes, names, identityName } = parseArgs(process.argv.slice(2));
const base = (process.env.FOOBARCH_HOST || DEFAULT_HOST).replace(/\/$/, "");
const password =
  process.env.FOOBARCH_USAGE_PASSWORD || DEFAULT_USAGE_PASSWORD;
const identity = getIdentity(identityName);
const owner = loadOrCreateOwner(identity);

const listed = await listTips(base, password);
  const want = new Set(names.map(String));
  const matchesFilter = (ib) => {
    if (!want.size) return true;
    for (const name of want) {
      if (ib === name) return true;
      const prefix = name.endsWith("/") ? name : `${name}/`;
      if (ib.startsWith(prefix)) return true;
    }
    return false;
  };
  const queue = [];
  for (const row of listed) {
    const ib = String(row?.ib || "").trim();
    if (!ib || row?.tombstone) continue;
    if (!matchesFilter(ib)) continue;
  const tip = await getTip(base, ib);
  if (!tip?.frame || tip.tombstone) continue;
  if (!needsParkMethodMigrate(tip.frame)) continue;
  queue.push(tip);
}

if (!queue.length) {
  console.log("no tips need data.http → data.method migration");
  process.exit(0);
}

console.log(`host: ${base}`);
console.log(`identity: ${identity.id}`);
console.log(`tips to migrate (${queue.length}): ${queue.map((t) => t.frame.ib).join(", ")}`);
if (!yes) {
  console.log("dry-run — pass --yes to mut8");
  process.exit(0);
}

for (const tip of queue) {
  const ib = String(tip.frame.ib);
  const frame = buildMethodMigratedFrame(tip);
  if (!frame) continue;
  const envelope = buildPolicyEnvelope(frame);
  const body = JSON.stringify(envelope);
  const token = await mintToken(base, password);
  /** @type {Record<string, string>} */
  const headers = { "X-Foobarch-Usage-Token": token };
  if (tip.addr && tip.frame?.rel8ns?.policy?.[0]) {
    Object.assign(
      headers,
      signHeadersForBody(owner, { ib, parentAddr: tip.addr, body })
    );
  }
  const method = commitMethodForTip(tip.frame);
  try {
    const r = await putCommit(base, ib, envelope, headers, method);
    console.log(`mut8 ${ib} → ${r.addr} (${method})`);
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    console.warn(`skip ${ib}: ${msg.split("\n")[0]}`);
  }
}

console.log("migrate done — verify GET /flowerpot/torus/native/foobarch_host returns JS, then foobarch_host remount_host");
