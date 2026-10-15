/**
 * Dry-run: dump foobarch_host commit shapes for an identity (no network).
 *
 *   node C_devops/identity/_shape.mjs
 *   node C_devops/identity/_shape.mjs --identity hypertext
 *   node C_devops/identity/_shape.mjs --include-bytes
 *   node C_devops/identity/_shape.mjs --identity hypertext enter
 */
import {
  DEFAULT_STATIC,
  SCHEMA_IB,
  buildEnvelope,
  buildPolicyEnvelope,
  buildPolicyFrame,
  buildSchemaFrame,
  buildShellFrame,
  getIdentity,
  listIdentities,
  loadOrCreateOwner,
  readAssetBytes,
  resolveAssets,
  sha256Hex,
} from "./_lib.mjs";

function parseArgs(argv) {
  const includeBytes = argv.includes("--include-bytes");
  let identityName = "foobarch";
  const names = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--include-bytes") continue;
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
  return { includeBytes, names, identityName };
}

const { includeBytes, names, identityName } = parseArgs(process.argv.slice(2));
const identity = getIdentity(identityName);
const owner = loadOrCreateOwner(identity);
const assets = resolveAssets(names, identity);

const schemaFrame = buildSchemaFrame();
delete schemaFrame._luaBytes;
delete schemaFrame._luaSha;
const schemaAddr = `${schemaFrame.ib}^${schemaFrame.gib}`;

const policyFrame = buildPolicyFrame(owner, {
  schemaAddr,
  policyIb: identity.policyIb,
});
const policyAddr = `${policyFrame.ib}^${policyFrame.gib}`;
const policyEnvelope = buildPolicyEnvelope(policyFrame);

console.log(`=== ${identity.id} identity shape (dry-run, no network) ===`);
console.log(`known: ${listIdentities().join(", ")}`);
console.log(`static_dir: ${DEFAULT_STATIC}`);
console.log(`schema_ib:  ${SCHEMA_IB}`);
console.log(`schema_addr (synthetic): ${schemaAddr}`);
console.log(`policy_ib:  ${identity.policyIb}`);
console.log(`policy_addr (synthetic gib): ${policyAddr}`);
console.log(`owner pubkey hash: ${owner.owner.hash}`);
console.log(`lock_schema: ${identity.lockSchema}`);
console.log("");
console.log("--- schema tip frame ---");
console.log(JSON.stringify(schemaFrame, null, 2));
console.log("");
console.log("--- policy tip frame ---");
console.log(JSON.stringify(policyFrame, null, 2));
console.log("");
console.log("--- policy commit envelope ---");
console.log(JSON.stringify(policyEnvelope, null, 2));

for (const asset of assets) {
  const bytes = readAssetBytes(asset);
  const sha = sha256Hex(bytes);
  const frame = buildShellFrame(asset, bytes, { policyAddr, n: 0 });
  const envelope = buildEnvelope(frame, bytes, asset.content_type, {
    includeBytes,
  });
  console.log("");
  console.log(`=== ${asset.ib} (${bytes.length} bytes, sha256=${sha}) ===`);
  console.log("--- tip frame ---");
  console.log(JSON.stringify(frame, null, 2));
  console.log("--- commit envelope ---");
  console.log(JSON.stringify(envelope, null, 2));
}

console.log("");
console.log(
  `done — ${assets.length}/${identity.assets.length} asset(s). Review before: node C_devops/identity/_publish.mjs --yes --identity ${identity.id}`
);
