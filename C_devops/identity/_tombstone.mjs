/**
 * Tombstone one hostpark tip (mut8, preserves history).
 *
 *   FOOBARCH_HOST=https://foobarch.net node C_devops/identity/_tombstone.mjs --yes torus/testkit/fsdevopstracker.js
 */
import {
  DEFAULT_HOST,
  DEFAULT_USAGE_PASSWORD,
  getIdentity,
  loadOrCreateOwner,
  saveJson,
  signHeadersForBody,
  takeUsageToken,
} from "./_lib.mjs";

function parseArgs(argv) {
  const yes = argv.includes("--yes");
  let identityName = "torus";
  const ibs = [];
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
    if (a.startsWith("-")) throw new Error(`unknown flag: ${a}`);
    ibs.push(a);
  }
  if (!ibs.length) throw new Error("usage: _tombstone.mjs --yes <ib> [ib…]");
  return { yes, identityName, ibs };
}

async function mintToken(base, password) {
  return takeUsageToken(base, password);
}

async function getTip(base, ib) {
  const res = await fetch(`${base}/foobarch/tip/${encodeURIComponent(ib)}`);
  if (res.status === 404) return null;
  const text = await res.text();
  if (!res.ok) throw new Error(`GET tip ${ib} → ${res.status}`);
  return JSON.parse(text);
}

async function tombstoneIb(base, owner, password, ib) {
  const tip = await getTip(base, ib);
  if (!tip || tip.tombstone) {
    console.log(`skip ${ib} (absent or already tombstoned)`);
    return;
  }
  const parent = tip.frame;
  const n = (Number(parent?.data?.n) || 0) + 1;
  const data = {
    ...(parent?.data && typeof parent.data === "object" ? parent.data : {}),
    tombstone: true,
    retired: true,
    n,
    timestamp: new Date().toUTCString(),
  };
  const envelope = {
    transform: "mut8",
    newIbGib: {
      ib,
      gib: "TOMBSTONE",
      data,
      rel8ns: {
        ...(parent?.rel8ns && typeof parent.rel8ns === "object"
          ? parent.rel8ns
          : {}),
        past: [tip.addr],
        tjp: [],
        dna: [],
      },
    },
    dnas: [],
    intermediateIbGibs: [],
  };
  const body = JSON.stringify(envelope);
  const token = await mintToken(base, password);
  const headers = {
    "Content-Type": "application/json",
    "X-Foobarch-Usage-Token": token,
  };
  if (parent?.rel8ns?.policy?.[0]) {
    Object.assign(
      headers,
      signHeadersForBody(owner, { ib, parentAddr: tip.addr, body })
    );
  }
  const res = await fetch(`${base}/${ib}`, {
    method: "PUT",
    headers,
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`tombstone ${ib} → ${res.status}: ${text.slice(0, 300)}`);
  const addr = res.headers.get("x-foobarch-ib^gib") || "";
  console.log(`tombstoned ${ib} → ${addr}`);
}

const { yes, identityName, ibs } = parseArgs(process.argv.slice(2));
const identity = getIdentity(identityName);
const base = (process.env.FOOBARCH_HOST || DEFAULT_HOST).replace(/\/$/, "");
const password =
  process.env.FOOBARCH_USAGE_PASSWORD || DEFAULT_USAGE_PASSWORD;
const owner = loadOrCreateOwner(identity);

console.log(`identity: ${identity.id}`);
console.log(`host: ${base}`);
console.log(`ibs: ${ibs.join(", ")}`);

if (!yes) {
  console.error("\ndry-run — pass --yes to tombstone");
  process.exit(0);
}

for (const ib of ibs) {
  await tombstoneIb(base, owner, password, ib);
}
saveJson(identity.ownerPath, owner);
