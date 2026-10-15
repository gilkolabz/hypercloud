/**
 * Mut8 identity-catalog park tips onto:
 *   park: "capture" | "defer"  (omit = not in resolve set)
 * Drops park_depth / park_precedence / park_capture.
 * Also folds leftover data.http → data.method when present.
 *
 * Scope (default): only ibs this identity tracks in _lib.mjs
 * (assets + proxies + policyIb) — not a full host tip scan.
 *
 * Dry-run:
 *   FOOBARCH_HOST=https://foobarch.net node C_devops/identity/_migrate_park_claim.mjs
 *
 * Apply one identity (signs with that owner):
 *   node C_devops/identity/_migrate_park_claim.mjs --yes --identity torus
 *
 * All write-gate catalogs in sequence:
 *   node C_devops/identity/_migrate_park_claim.mjs --yes --all-identities
 *
 * Extra ib / prefix filter (still within catalog unless --host-list):
 *   node C_devops/identity/_migrate_park_claim.mjs --yes --identity foobarch mimex
 *
 * Full host list (opt-in; not default):
 *   node C_devops/identity/_migrate_park_claim.mjs --yes --all-identities --host-list
 *
 * Env: FOOBARCH_HOST, FOOBARCH_USAGE_PASSWORD (same as _publish.mjs)
 */
import {
  DEFAULT_HOST,
  DEFAULT_USAGE_PASSWORD,
  buildParkClaimMigratedFrame,
  buildPolicyEnvelope,
  getIdentity,
  listIdentities,
  loadOrCreateOwner,
  needsParkClaimMigrate,
  needsParkMethodMigrate,
  parkMethodBlock,
  resolveParkClaim,
  signHeadersForBody,
  takeUsageToken,
} from "./_lib.mjs";

function parseArgs(argv) {
  const yes = argv.includes("--yes");
  const allIdentities = argv.includes("--all-identities");
  const hostList = argv.includes("--host-list");
  let identityName = "foobarch";
  const names = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--yes" || a === "--all-identities" || a === "--host-list") {
      continue;
    }
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
  return { yes, names, identityName, allIdentities, hostList };
}

/** Ibs this identity authored / publishes (outside host DB discovery). */
function catalogIbs(identity) {
  const set = new Set();
  for (const a of identity.assets || []) {
    const ib = String(a?.ib || "").trim();
    if (ib) set.add(ib);
  }
  for (const p of identity.proxies || []) {
    const ib = String(p?.ib || "").trim();
    if (ib) set.add(ib);
  }
  const policy = String(identity.policyIb || "").trim();
  if (policy) set.add(policy);
  return set;
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
  if (!res.ok) {
    throw new Error(`GET tip ${ib} → ${res.status}: ${text.slice(0, 300)}`);
  }
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
  if (!res.ok) {
    throw new Error(`${verb} /${ib} → ${res.status}: ${text.slice(0, 400)}`);
  }
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

function summarizeClaim(frame) {
  const next = resolveParkClaim(frame?.data);
  const bits = [];
  const d = frame?.data || {};
  if (d.park === true) bits.push("park:true");
  else if (d.park != null) bits.push(`park:${JSON.stringify(d.park)}`);
  if (d.park_precedence) bits.push(`precedence:${d.park_precedence}`);
  if (d.park_capture) bits.push("park_capture");
  if ("park_depth" in d) bits.push(`depth:${d.park_depth}`);
  if (needsParkMethodMigrate(frame)) bits.push("http→method");
  return `${bits.join(" ") || "?"} → ${next == null ? "(omit)" : next}`;
}

function matchesFilter(ib, want) {
  if (!want.size) return true;
  for (const name of want) {
    if (ib === name) return true;
    const prefix = name.endsWith("/") ? name : `${name}/`;
    if (ib.startsWith(prefix)) return true;
  }
  return false;
}

const { yes, names, identityName, allIdentities, hostList } = parseArgs(
  process.argv.slice(2)
);
const base = (process.env.FOOBARCH_HOST || DEFAULT_HOST).replace(/\/$/, "");
const password =
  process.env.FOOBARCH_USAGE_PASSWORD || DEFAULT_USAGE_PASSWORD;
const want = new Set(names.map(String));

const identityIds = allIdentities ? listIdentities() : [identityName];

console.log(`host: ${base}`);
console.log(
  `scope: ${hostList ? "host tip list" : "identity catalog (assets+proxies+policy)"}`
);

let ok = 0;
let skipped = 0;
let planned = 0;

for (const idName of identityIds) {
  const identity = getIdentity(idName);
  const owner = loadOrCreateOwner(identity);
  const catalog = catalogIbs(identity);

  /** @type {string[]} */
  let ibs = [];
  if (hostList) {
    const listed = await listTips(base, password);
    ibs = listed
      .map((row) => String(row?.ib || "").trim())
      .filter((ib) => ib && !rowTombstone(listed, ib));
  } else {
    ibs = [...catalog];
  }

  const queue = [];
  for (const ib of ibs) {
    if (!matchesFilter(ib, want)) continue;
    if (!hostList && !catalog.has(ib)) continue;
    const tip = await getTip(base, ib);
    if (!tip?.frame || tip.tombstone) continue;
    if (
      !needsParkClaimMigrate(tip.frame) &&
      !needsParkMethodMigrate(tip.frame)
    ) {
      continue;
    }
    queue.push(tip);
  }

  console.log(
    `\nidentity: ${identity.id}  catalog=${catalog.size}  need=${queue.length}`
  );
  for (const t of queue) {
    console.log(`  ${t.frame.ib}  ${summarizeClaim(t.frame)}`);
  }
  planned += queue.length;

  if (!yes) continue;

  for (const tip of queue) {
    const ib = String(tip.frame.ib);
    const live = await getTip(base, ib);
    if (!live?.frame || live.tombstone) continue;
    if (
      !needsParkClaimMigrate(live.frame) &&
      !needsParkMethodMigrate(live.frame)
    ) {
      continue;
    }
    const frame = buildParkClaimMigratedFrame(live);
    if (!frame) continue;
    const envelope = buildPolicyEnvelope(frame);
    const body = JSON.stringify(envelope);
    const token = await mintToken(base, password);
    /** @type {Record<string, string>} */
    const headers = { "X-Foobarch-Usage-Token": token };
    if (live.addr && live.frame?.rel8ns?.policy?.[0]) {
      Object.assign(
        headers,
        signHeadersForBody(owner, { ib, parentAddr: live.addr, body })
      );
    }
    const method = commitMethodForTip(live.frame);
    try {
      const r = await putCommit(base, ib, envelope, headers, method);
      console.log(
        `mut8 ${ib} → ${r.addr} (${method}) park=${frame.data.park ?? "(omit)"}`
      );
      ok++;
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      console.warn(`skip ${ib} [${idName}]: ${msg.split("\n")[0]}`);
      skipped++;
    }
  }
}

function rowTombstone(listed, ib) {
  const row = listed.find((r) => String(r?.ib || "") === ib);
  return !!(row && row.tombstone);
}

if (!planned) {
  console.log("\nno catalog tips need park claim (or http→method) migration");
  process.exit(0);
}

if (!yes) {
  console.log(
    "\ndry-run — pass --yes to mut8 (use --all-identities or --identity)"
  );
  process.exit(0);
}

console.log(`\nmigrate done — ok=${ok} skip=${skipped}`);
console.log("foobarch_host reindex if park index looks stale after mut8");
