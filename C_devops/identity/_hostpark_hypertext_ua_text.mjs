/**
 * Wire all hypertext/* tips: ua_get + text/plain ua_text bins + policies/hypertext only
 * (no hypertext_ua dual-key AND).
 *
 *   FOOBARCH_HOST=https://foobarch.net node C_devops/identity/_hostpark_hypertext_ua_text.mjs --yes
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_HOST,
  DEFAULT_USAGE_PASSWORD,
  ROOT,
  HYPERTEXT_ASSETS,
  buildPutEnvelope,
  getIdentity,
  loadOrCreateOwner,
  parkMethodBlock,
  sha256Hex,
  signHeadersForBody,
  signHeadersForOwners,
  takeUsageToken,
} from "./_lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UA_GET_IB = "scripts/ua_get";
const WAREZ_TEXT_IB = "scripts/hypertext/hypernetizenwarez_text";
const TEXT_DIR = path.join(ROOT, "B_fragments", "data", "text");

function parseArgs(argv) {
  const i = argv.indexOf("--only");
  const only = i >= 0 && argv[i + 1] ? String(argv[i + 1]).split(",").map((s) => s.trim()) : null;
  return { yes: argv.includes("--yes"), only };
}

function sha256HexBuf(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

async function mintToken(base, password) {
  return takeUsageToken(base, password);
}

async function getTip(base, ib) {
  const res = await fetch(`${base}/foobarch/tip/${encodeURIComponent(ib)}`);
  if (res.status === 404) return null;
  const text = await res.text();
  if (!res.ok) throw new Error(`GET tip ${ib} â†’ ${res.status}: ${text.slice(0, 200)}`);
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

async function putCommit(base, ib, envelope, headers, method = "PUT") {
  const body = JSON.stringify(envelope);
  const verb = String(method || "PUT").toUpperCase();
  const res = await fetch(`${base}/${ib}`, {
    method: verb,
    headers: { "Content-Type": "application/json", ...headers },
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${verb} /${ib} â†’ ${res.status}: ${text.slice(0, 500)}`);
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

function uaMenu(textAction) {
  return {
    default: "html",
    map: {
      cli: "text",
      curl: "text",
      text: "text",
      html: "html",
      chrome: "html",
      firefox: "html",
      safari: "html",
      edge: "html",
      opera: "html",
      ie: "html",
      bot: "html",
      unknown: "html",
    },
    cases: {
      html: { kind: "bin", content_type: "text/html; charset=utf-8" },
      text: textAction,
      default: { kind: "bin", content_type: "text/html; charset=utf-8" },
    },
  };
}

/** Map hypertext ib â†’ local text clone path under B_fragments/data/text/ */
function textPathForIb(ib) {
  const rest = String(ib).replace(/^hypertext\//, "");
  if (rest.endsWith(".html")) {
    return path.join(TEXT_DIR, rest.replace(/\.html$/i, ".txt"));
  }
  return path.join(TEXT_DIR, `${rest}.txt`);
}

async function putBinViaSidecar(base, owner, password, sidecarIb, bytes, policyAddr) {
  const tip = await getTip(base, sidecarIb);
  const parentAddr = tip && !tip.tombstone ? tip.addr : null;
  const n = parentAddr ? Number(tip.frame?.data?.n || 0) + 1 : 0;
  const sha = sha256HexBuf(bytes);
  const rel8ns = {
    bin: [`bin ${sha}`],
    past: parentAddr ? [parentAddr] : [],
    tjp: [],
    dna: [],
  };
  if (policyAddr) rel8ns.policy = [policyAddr];
  const data = {
    parts: ["network_proposal", "ibgib_frame", "manifest", "json"],
    park: "defer",
    gate: true,
    content_type: "text/plain; charset=utf-8",
    default_method: "GET",
    method: {
      GET: { kind: "bin" },
      PUT: { kind: "commit" },
      PATCH: { kind: "commit" },
    },
    n,
    timestamp: new Date().toUTCString(),
  };
  const gib = sha256Hex(
    Buffer.from(JSON.stringify({ data, rel8ns }), "utf8")
  ).toUpperCase();
  const frame = { ib: sidecarIb, gib, data, rel8ns };
  const envelope = buildPutEnvelope(frame, bytes, "text/plain; charset=utf-8");
  const body = JSON.stringify(envelope);
  const token = await mintToken(base, password);
  /** @type {Record<string, string>} */
  const headers = { "X-Foobarch-Usage-Token": token };
  if (parentAddr && tip.frame?.rel8ns?.policy?.[0]) {
    Object.assign(
      headers,
      signHeadersForBody(owner, { ib: sidecarIb, parentAddr, body })
    );
  }
  await putCommit(
    base,
    sidecarIb,
    envelope,
    headers,
    tip ? commitMethodForTip(tip.frame) : "PUT"
  );
  return sha;
}

async function wireTip(base, owner, password, policyAddr, asset) {
  const ib = asset.ib;
  const htmlBytes = fs.readFileSync(path.join(ROOT, asset.path));
  const textFile = textPathForIb(ib);
  if (!fs.existsSync(textFile)) {
    throw new Error(`missing text clone: ${textFile}`);
  }
  const textBytes = fs.readFileSync(textFile);
  const textSha = await putBinViaSidecar(
    base,
    owner,
    password,
    `${ib}/ua_text`,
    textBytes,
    policyAddr
  );

  const tip = await getTip(base, ib);
  if (!tip || tip.tombstone) {
    throw new Error(`${ib} missing â€” publish --identity hypertext first`);
  }
  const parentAddr = tip.addr;
  const n = Number(tip.frame?.data?.n || 0) + 1;
  const htmlSha = sha256HexBuf(htmlBytes);

  const textAction =
    ib === "hypertext/hypernetizenwarez"
      ? { kind: "park_request", path: WAREZ_TEXT_IB, method: "GET" }
      : {
          kind: "bin",
          rel8n: "ua_text",
          content_type: "text/plain; charset=utf-8",
        };

  const rel8ns = {
    ...(tip.frame?.rel8ns && typeof tip.frame.rel8ns === "object"
      ? tip.frame.rel8ns
      : {}),
    bin: [`bin ${htmlSha}`],
    ua_text: [`bin ${textSha}`],
    past: [parentAddr],
    policy: [policyAddr],
  };

  const data = {
    ...(tip.frame?.data && typeof tip.frame.data === "object"
      ? tip.frame.data
      : {}),
    parts: ["network_proposal", "ibgib_frame", "manifest", "json"],
    park: "defer",
    gate: true,
    content_type: "text/html; charset=utf-8",
    default_method: "GET",
    method: {
      GET: { kind: "lua", script: UA_GET_IB },
      PUT: { kind: "commit" },
      PATCH: { kind: "commit" },
    },
    ua: uaMenu(textAction),
    n,
    timestamp: new Date().toUTCString(),
  };
  delete data.http;

  const gib = sha256Hex(
    Buffer.from(JSON.stringify({ data, rel8ns }), "utf8")
  ).toUpperCase();
  const frame = { ib, gib, data, rel8ns };
  const envelope = buildPutEnvelope(
    frame,
    htmlBytes,
    "text/html; charset=utf-8"
  );
  const body = JSON.stringify(envelope);
  const token = await mintToken(base, password);
  const curPol = String(tip.frame?.rel8ns?.policy?.[0] || "");
  const needsDual =
    curPol.includes("policies/hypertext_ua") ||
    curPol.includes("foobarch-shell");
  /** @type {Record<string, string>} */
  const headers = { "X-Foobarch-Usage-Token": token };
  if (needsDual) {
    const foobarchOwner = loadOrCreateOwner(getIdentity("foobarch"));
    Object.assign(
      headers,
      signHeadersForOwners([owner, foobarchOwner], { ib, parentAddr, body })
    );
  } else {
    Object.assign(
      headers,
      signHeadersForBody(owner, { ib, parentAddr, body })
    );
  }
  const r = await putCommit(
    base,
    ib,
    envelope,
    headers,
    commitMethodForTip(tip.frame)
  );
  console.log(`mut8 ${ib} â†’ ${r.addr}`);
  return r.addr;
}

async function main() {
  const { yes, only } = parseArgs(process.argv.slice(2));
  if (!yes) {
    console.error("Refusing without --yes");
    process.exit(1);
  }
  const base = String(process.env.FOOBARCH_HOST || DEFAULT_HOST).replace(
    /\/+$/,
    ""
  );
  const password =
    process.env.FOOBARCH_USAGE_PASSWORD || DEFAULT_USAGE_PASSWORD;
  const identity = getIdentity("hypertext");
  const owner = loadOrCreateOwner(identity);
  const policyTip = await getTip(base, "policies/hypertext");
  if (!policyTip?.addr) throw new Error("policies/hypertext missing");
  const policyAddr = policyTip.addr;

  console.log(`host ${base}`);
  console.log(`policy ${policyAddr} (hypertext only â€” no AND)`);

  if (only && !only.every((ib) => HYPERTEXT_ASSETS.some((a) => a.ib === ib))) {
    throw new Error(`--only ${only.join(",")}: not all in HYPERTEXT_ASSETS`);
  }
  for (const asset of HYPERTEXT_ASSETS) {
    if (only && !only.includes(asset.ib)) continue;
    if (asset.content_type && !String(asset.content_type).includes("html")) {
      continue;
    }
    await wireTip(base, owner, password, policyAddr, asset);
  }
  console.log("\ndone â€” all hypertext tips on policies/hypertext + ua_get");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
