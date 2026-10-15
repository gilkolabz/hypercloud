/**
 * Admin hard-delete identity-published foobarch_host tips (force wipe).
 *
 *   node C_devops/identity/_wipe.mjs                         # dry-run foobarch
 *   node C_devops/identity/_wipe.mjs --identity hypertext    # dry-run hypertext
 *   node C_devops/identity/_wipe.mjs --yes --identity hypertext
 *
 * Env: FOOBARCH_HOST, FOOBARCH_USAGE_PASSWORD
 *
 * Note: --identity foobarch also lists the shared schema tip. Hypertext wipe
 * does not delete foobarch.schema.keys.v1 (owned by foobarch).
 */
import {
  DEFAULT_HOST,
  DEFAULT_USAGE_PASSWORD,
  SCHEMA_IB,
  getIdentity,
  listIdentities,
} from "./_lib.mjs";

function parseArgs(argv) {
  const yes = argv.includes("--yes");
  let identityName = "foobarch";
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
  }
  return { yes, identityName };
}

const { yes, identityName } = parseArgs(process.argv.slice(2));
const identity = getIdentity(identityName);
const base = (process.env.FOOBARCH_HOST || DEFAULT_HOST).replace(/\/$/, "");
const password =
  process.env.FOOBARCH_USAGE_PASSWORD || DEFAULT_USAGE_PASSWORD;

const IBS = [
  ...identity.assets.map((a) => a.ib),
  ...identity.proxies.map((t) => t.ib),
  identity.policyIb,
];
if (identity.lockSchema) {
  IBS.push(SCHEMA_IB);
}
IBS.sort();

console.log(`identity: ${identity.id} (known: ${listIdentities().join(", ")})`);
console.log(`host: ${base}`);
console.log(`ibs (${IBS.length}):`);
for (const ib of IBS) console.log(`  ${ib}`);

if (!yes) {
  console.error("\ndry-run only — pass --yes to admin-delete");
  process.exit(0);
}

async function adminDelete(ib) {
  const path = ib
    .split("/")
    .map((s) => encodeURIComponent(s))
    .join("/");
  const res = await fetch(`${base}/foobarch/admin/delete/${path}`, {
    method: "DELETE",
    headers: { "X-Foobarch-Usage-Password": password },
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* ignore */
  }
  return { status: res.status, text, json };
}

let ok = 0;
let miss = 0;
let fail = 0;
for (const ib of IBS) {
  const r = await adminDelete(ib);
  if (r.status === 200) {
    console.log(`deleted ${ib}`);
    ok++;
  } else if (r.status === 404 || /no tip|hadTip.:false/i.test(r.text)) {
    console.log(`absent  ${ib} (${r.status})`);
    miss++;
  } else {
    console.error(`FAIL    ${ib} → ${r.status}: ${r.text.slice(0, 200)}`);
    fail++;
  }
}
console.log(`\nwipe done: deleted=${ok} absent=${miss} fail=${fail}`);
if (fail) process.exit(1);
