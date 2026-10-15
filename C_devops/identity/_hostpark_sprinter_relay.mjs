/**
 * Hostpark relay frame `sprinter` → sprinter_server on a relayed navi.
 *
 *   https://foobarch.net/sprinter/{…}  →  (internal) /navi-{alias}/sprinter_server/{…}
 *
 * Capture park: every /sprinter/… address resolves here (never a miss, never a
 * foobarch tip). Write-gated by policies/foobarch-shell (foobarch owner signs mut8s).
 *
 *   node C_devops/identity/_hostpark_sprinter_relay.mjs --yes [--alias xomud_host_mechset]
 */
import {
  DEFAULT_HOST,
  DEFAULT_USAGE_PASSWORD,
  getIdentity,
  loadOrCreateOwner,
  parkMethodBlock,
  sha256Hex,
  signHeadersForBody,
  takeUsageToken,
} from "./_lib.mjs";

const IB = "sprinter";
const MOD_PATH = "sprinter_server";
const TAGLINE = "we proudly bring you version S";

function argVal(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function getTip(base, ib) {
  const res = await fetch(`${base}/foobarch/tip/${encodeURIComponent(ib)}`);
  if (res.status === 404) return null;
  const text = await res.text();
  if (!res.ok) throw new Error(`GET tip ${ib} → ${res.status}: ${text.slice(0, 200)}`);
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
  return "PUT";
}

async function main() {
  const argv = process.argv.slice(2);
  if (!argv.includes("--yes")) {
    console.error("Refusing without --yes");
    process.exit(1);
  }
  const alias = String(argVal(argv, "--alias") || "xomud_host_mechset").trim().replace(/^navi-/, "");
  if (!/^[a-zA-Z0-9._-]+$/.test(alias)) {
    console.error("--alias <relay-alias> must be [a-zA-Z0-9._-]+");
    process.exit(1);
  }
  const base = String(process.env.FOOBARCH_HOST || DEFAULT_HOST).replace(/\/+$/, "");
  const password = process.env.FOOBARCH_USAGE_PASSWORD || DEFAULT_USAGE_PASSWORD;
  const relay = { kind: "relay", target: alias, path: MOD_PATH };

  const owner = loadOrCreateOwner(getIdentity("foobarch"));
  const policyAddr =
    owner.policy_addr || (await getTip(base, "policies/foobarch-shell"))?.addr;
  if (!policyAddr) throw new Error("policies/foobarch-shell addr missing");

  const tip = await getTip(base, IB);
  const parentAddr = tip && !tip.tombstone ? tip.addr : null;
  const n = parentAddr ? Number(tip.frame?.data?.n || 0) + 1 : 0;

  const data = {
    parts: ["network_proposal", "ibgib_frame", "manifest", "json"],
    park: "capture",
    default_method: "GET",
    method: {
      GET: relay,
      POST: relay,
      PUT: { kind: "commit" },
      PATCH: { kind: "commit" },
    },
    n,
    timestamp: new Date().toUTCString(),
    about: {
      label: IB,
      tagline: TAGLINE,
      description:
        "Fast lane for scranton_lobby_v1 lobbies: GET /sprinter/scranton/lobby/v1/{path} reads, POST writes a signed envelope. Served by sprinter_server on a relayed navi; no foobarch tips or usage tokens per lobby write.",
    },
  };
  const rel8ns = {
    past: parentAddr ? [parentAddr] : [],
    tjp: [],
    dna: [],
    policy: [policyAddr],
  };
  const gib = sha256Hex(Buffer.from(JSON.stringify({ data, rel8ns }), "utf8")).toUpperCase();
  const envelope = {
    transform: parentAddr ? "mut8" : "firstGen",
    newIbGib: { ib: IB, gib, data, rel8ns },
    dnas: [],
    intermediateIbGibs: [],
  };
  const body = JSON.stringify(envelope);
  const headers = {
    "Content-Type": "application/json",
    "X-Foobarch-Usage-Token": await takeUsageToken(base, password),
  };
  if (parentAddr && tip.frame?.rel8ns?.policy?.[0]) {
    Object.assign(headers, signHeadersForBody(owner, { ib: IB, parentAddr, body }));
  }
  const method = tip ? commitMethodForTip(tip.frame) : "PUT";
  const res = await fetch(`${base}/${IB}`, { method, headers, body });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} /${IB} → ${res.status}: ${text.slice(0, 400)}`);
  console.log(
    `${parentAddr ? "mut8" : "firstGen"} ${IB} → ${res.headers.get("x-foobarch-ib^gib") || "?"}`
  );
  console.log(`relay ${base}/${IB}/… → navi-${alias}/${MOD_PATH}/…`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
