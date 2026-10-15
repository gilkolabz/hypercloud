/**
 * Wire hypertext welcome + hypernetizenwarez for ua_get Accept/UA text split,
 * publish supporting tips, and attach policies/hypertext_ua (AND of
 * policies/hypertext + policies/foobarch-shell).
 *
 *   FOOBARCH_HOST=https://foobarch.net node C_devops/identity/_hostpark_hypertext_ua.mjs --yes
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_HOST,
  DEFAULT_USAGE_PASSWORD,
  ROOT,
  buildPutEnvelope,
  getIdentity,
  loadOrCreateOwner,
  parkMethodBlock,
  saveJson,
  sha256Hex,
  signHeadersForBody,
  signHeadersForOwners,
  takeUsageToken,
} from "./_lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const POLICY_AND_IB = "foobarch.schema.policy_and.v1";
const COMPOSITE_POLICY_IB = "policies/hypertext_ua";
const WAREZ_TEXT_IB = "scripts/hypertext/hypernetizenwarez_text";
const UA_GET_IB = "scripts/ua_get";

function parseArgs(argv) {
  const yes = argv.includes("--yes");
  const warezTextOnly = argv.includes("--warez-text-only");
  return { yes, warezTextOnly };
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
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* ignore */
  }
  if (!res.ok) {
    throw new Error(`${verb} /${ib} â†’ ${res.status}: ${text.slice(0, 500)}`);
  }
  return {
    status: res.status,
    addr: res.headers.get("x-foobarch-ib^gib") || json?.addr || null,
    body: json || text,
  };
}

async function publishLuaBin(base, owner, password, ib, fileRel, policyAddr, opts = {}) {
  const bytes = fs.readFileSync(path.join(ROOT, fileRel));
  const tip = await getTip(base, ib);
  const parentAddr = tip && !tip.tombstone ? tip.addr : null;
  const n = parentAddr ? Number(tip.frame?.data?.n || 0) + 1 : 0;
  const sha = sha256HexBuf(bytes);
  const gib = sha.toUpperCase();
  const rel8ns = {
    bin: [`bin ${sha}`],
    past: parentAddr ? [parentAddr] : [],
    tjp: [],
    dna: [],
  };
  if (policyAddr) rel8ns.policy = [policyAddr];
  const getKind = opts.executeSelf
    ? { kind: "lua", script: ib }
    : { kind: "bin" };
  const frame = {
    ib,
    gib,
    data: {
      parts: ["network_proposal", "ibgib_frame", "manifest", "json"],
      park: "defer",
      gate: true,
      content_type: "text/x-lua; charset=utf-8",
      default_method: "GET",
      method: {
        GET: getKind,
        PUT: { kind: "commit" },
        PATCH: { kind: "commit" },
      },
      n,
      timestamp: new Date().toUTCString(),
    },
    rel8ns,
  };
  const envelope = buildPutEnvelope(frame, bytes, "text/x-lua; charset=utf-8");
  const body = JSON.stringify(envelope);
  const token = await mintToken(base, password);
  /** @type {Record<string, string>} */
  const headers = { "X-Foobarch-Usage-Token": token };
  if (parentAddr && tip.frame?.rel8ns?.policy?.[0]) {
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
    tip ? commitMethodForTip(tip.frame) : "PUT"
  );
  console.log(`${parentAddr ? "mut8" : "firstGen"} ${ib} â†’ ${r.addr}`);
  return r.addr;
}

async function ensureCompositePolicy(base, foobarchOwner, password, schemaAddr) {
  const hypertextTip = await getTip(base, "policies/hypertext");
  const shellTip = await getTip(base, "policies/foobarch-shell");
  if (!hypertextTip?.addr) throw new Error("policies/hypertext missing");
  if (!shellTip?.addr) throw new Error("policies/foobarch-shell missing");

  const existing = await getTip(base, COMPOSITE_POLICY_IB);
  const policies = [hypertextTip.addr, shellTip.addr];

  const buildFrame = (opts) => {
    const data = {
      parts: ["policy_and", "keys_policy", "ibgib_frame", "manifest", "json"],
      schema_ib: POLICY_AND_IB,
      policies,
      threshold: 2,
      n: opts.n || 0,
      timestamp: new Date().toUTCString(),
      about: {
        label: COMPOSITE_POLICY_IB,
        description:
          "AND write-gate: policies/hypertext + policies/foobarch-shell (both keyrings).",
      },
    };
    const gib = sha256Hex(
      Buffer.from(JSON.stringify(data), "utf8")
    ).toUpperCase();
    /** @type {Record<string, unknown>} */
    const rel8ns = {
      past: opts.parentAddr ? [opts.parentAddr] : [],
      tjp: [],
      dna: [],
      schema: [schemaAddr],
      and_policy: policies,
    };
    if (opts.policyAddr) rel8ns.policy = [opts.policyAddr];
    return { ib: COMPOSITE_POLICY_IB, gib, data, rel8ns };
  };

  if (!existing || existing.tombstone) {
    const frame = buildFrame({ n: 0 });
    const envelope = {
      transform: "firstGen",
      newIbGib: frame,
      dnas: [],
      intermediateIbGibs: [],
    };
    const token = await mintToken(base, password);
    const r = await putCommit(base, COMPOSITE_POLICY_IB, envelope, {
      "X-Foobarch-Usage-Token": token,
    });
    console.log(`policy firstGen ${COMPOSITE_POLICY_IB} â†’ ${r.addr}`);
    // Self-lock while still open (unsigned).
    const lockedFrame = buildFrame({
      n: 1,
      parentAddr: r.addr,
      policyAddr: r.addr,
    });
    const lockEnv = {
      transform: "mut8",
      newIbGib: lockedFrame,
      dnas: [],
      intermediateIbGibs: [],
    };
    const token2 = await mintToken(base, password);
    const r2 = await putCommit(base, COMPOSITE_POLICY_IB, lockEnv, {
      "X-Foobarch-Usage-Token": token2,
    });
    console.log(`policy locked ${COMPOSITE_POLICY_IB} â†’ ${r2.addr}`);
    foobarchOwner.hypertext_ua_policy_addr = r2.addr;
    saveJson(path.join(__dirname, "foobarch_owner.json"), foobarchOwner);
    return r2.addr;
  }

  const gated = !!existing.frame?.rel8ns?.policy?.[0];
  const n = Number(existing.frame?.data?.n || 0) + 1;
  const frame = buildFrame({
    n,
    parentAddr: existing.addr,
    policyAddr: gated ? existing.frame.rel8ns.policy[0] : existing.addr,
  });
  const envelope = {
    transform: "mut8",
    newIbGib: frame,
    dnas: [],
    intermediateIbGibs: [],
  };
  const body = JSON.stringify(envelope);
  const token = await mintToken(base, password);
  /** @type {Record<string, string>} */
  const headers = { "X-Foobarch-Usage-Token": token };
  if (gated) {
    // After lock, AND requires both owners.
    const hypertextOwner = loadOrCreateOwner(getIdentity("hypertext"));
    Object.assign(
      headers,
      signHeadersForOwners([foobarchOwner, hypertextOwner], {
        ib: COMPOSITE_POLICY_IB,
        parentAddr: existing.addr,
        body,
      })
    );
  }
  const r = await putCommit(
    base,
    COMPOSITE_POLICY_IB,
    envelope,
    headers,
    commitMethodForTip(existing.frame)
  );
  console.log(`policy mut8 ${COMPOSITE_POLICY_IB} â†’ ${r.addr}`);
  foobarchOwner.hypertext_ua_policy_addr = r.addr;
  saveJson(path.join(__dirname, "foobarch_owner.json"), foobarchOwner);
  return r.addr;
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

async function putBinViaSidecar(base, owner, password, sidecarIb, bytes, contentType, policyAddr) {
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
    content_type: contentType,
    default_method: "GET",
    method: {
      GET: { kind: "bin" },
      PUT: { kind: "commit" },
      PATCH: { kind: "commit" },
    },
    n,
    timestamp: new Date().toUTCString(),
    about: {
      label: sidecarIb,
      description: "Secondary ua_text bytes for sibling hypertext tip",
    },
  };
  const gib = sha256Hex(Buffer.from(JSON.stringify({ data, rel8ns }), "utf8")).toUpperCase();
  const frame = { ib: sidecarIb, gib, data, rel8ns };
  const envelope = buildPutEnvelope(frame, bytes, contentType);
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
  const r = await putCommit(
    base,
    sidecarIb,
    envelope,
    headers,
    tip ? commitMethodForTip(tip.frame) : "PUT"
  );
  console.log(`${parentAddr ? "mut8" : "firstGen"} ${sidecarIb} â†’ ${r.addr} (sha ${sha.slice(0, 12)}â€¦)`);
  return sha;
}

async function putHypertextUaFrame(base, owners, password, opts) {
  const {
    ib,
    htmlPath,
    textBinBytes,
    textRel8n,
    textAction,
    policyAddr,
    textOwner,
    textPolicyAddr,
  } = opts;
  const htmlBytes = fs.readFileSync(path.join(ROOT, htmlPath));
  const htmlSha = sha256HexBuf(htmlBytes);
  const sidecarIb = `${ib}/ua_text`;
  const textSha = await putBinViaSidecar(
    base,
    textOwner || owners[0],
    password,
    sidecarIb,
    textBinBytes,
    "text/plain; charset=utf-8",
    textPolicyAddr || policyAddr
  );

  const tip = await getTip(base, ib);
  if (!tip || tip.tombstone) {
    throw new Error(`${ib} missing â€” publish hypertext identity first`);
  }
  const parentAddr = tip.addr;
  const n = Number(tip.frame?.data?.n || 0) + 1;

  const rel8ns = {
    ...(tip.frame?.rel8ns && typeof tip.frame.rel8ns === "object"
      ? tip.frame.rel8ns
      : {}),
    bin: [`bin ${htmlSha}`],
    past: [parentAddr],
    policy: [policyAddr],
  };
  if (textRel8n) {
    rel8ns[textRel8n] = [`bin ${textSha}`];
  }

  const data = {
    ...(tip.frame?.data && typeof tip.frame.data === "object" ? tip.frame.data : {}),
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
  const envelope = buildPutEnvelope(frame, htmlBytes, "text/html; charset=utf-8");
  const body = JSON.stringify(envelope);
  const token = await mintToken(base, password);
  // Existing tip is usually policies/hypertext-only; both sigs still ok (extra ignored).
  const headers = {
    "X-Foobarch-Usage-Token": token,
    ...signHeadersForOwners(owners, { ib, parentAddr, body }),
  };
  const r = await putCommit(
    base,
    ib,
    envelope,
    headers,
    commitMethodForTip(tip.frame)
  );
  console.log(`mut8 ${ib} â†’ ${r.addr} (ua_get + ${textRel8n || "text"})`);
  return r.addr;
}

async function main() {
  const { yes, warezTextOnly } = parseArgs(process.argv.slice(2));
  if (!yes) {
    console.error("Refusing without --yes");
    process.exit(1);
  }
  const base = String(process.env.FOOBARCH_HOST || DEFAULT_HOST).replace(/\/+$/, "");
  const password =
    process.env.FOOBARCH_USAGE_PASSWORD || DEFAULT_USAGE_PASSWORD;

  const foobarchId = getIdentity("foobarch");
  const hypertextId = getIdentity("hypertext");
  const foobarchOwner = loadOrCreateOwner(foobarchId);
  const hypertextOwner = loadOrCreateOwner(hypertextId);

  console.log(`host ${base}`);

  // 1) Supporting Lua tips under foobarch-shell.
  const shellPolicy =
    foobarchOwner.policy_addr ||
    (await getTip(base, "policies/foobarch-shell"))?.addr;
  if (!shellPolicy) throw new Error("policies/foobarch-shell addr missing");

  if (warezTextOnly) {
    await publishLuaBin(
      base,
      foobarchOwner,
      password,
      WAREZ_TEXT_IB,
      "C_devops/identity/scripts/hypertext/hypernetizenwarez_text.lua",
      shellPolicy,
      { executeSelf: true }
    );
    console.log(`\ndone — ${WAREZ_TEXT_IB} only`);
    return;
  }

  await publishLuaBin(
    base,
    foobarchOwner,
    password,
    UA_GET_IB,
    "C_devops/identity/scripts/ua_get.lua",
    shellPolicy
  );
  const schemaAddr = await publishLuaBin(
    base,
    foobarchOwner,
    password,
    POLICY_AND_IB,
    "C_devops/identity/schemas/policy_and_v1.lua",
    shellPolicy
  );
  await publishLuaBin(
    base,
    foobarchOwner,
    password,
    WAREZ_TEXT_IB,
    "C_devops/identity/scripts/hypertext/hypernetizenwarez_text.lua",
    shellPolicy,
    { executeSelf: true }
  );

  // 2) Composite AND policy.
  const compositeAddr = await ensureCompositePolicy(
    base,
    foobarchOwner,
    password,
    schemaAddr
  );
  const hypertextTipAddr =
    (await getTip(base, "policies/hypertext"))?.addr || null;
  if (!hypertextTipAddr) throw new Error("policies/hypertext missing");

  // 3) Hypertext tips â€” dual-signed under composite.
  const owners = [foobarchOwner, hypertextOwner];
  const welcomeText = fs.readFileSync(
    path.join(ROOT, "B_fragments/data/welcome.txt")
  );
  // Placeholder text bin for warez (lua serves live table; bin is Accept fallback).
  const warezFallback = Buffer.from(
    "Hypernetizen Warez (text)\n\n(see scripts/hypertext/hypernetizenwarez_text via ua_get)\n",
    "utf8"
  );

  await putHypertextUaFrame(base, owners, password, {
    ib: "hypertext/welcome",
    htmlPath: "B_fragments/data/welcome.html",
    textBinBytes: welcomeText,
    textRel8n: "ua_text",
    textAction: {
      kind: "bin",
      rel8n: "ua_text",
      content_type: "text/plain; charset=utf-8",
    },
    policyAddr: compositeAddr,
    textOwner: hypertextOwner,
    textPolicyAddr: hypertextTipAddr,
  });

  await putHypertextUaFrame(base, owners, password, {
    ib: "hypertext/hypernetizenwarez",
    htmlPath: "B_fragments/data/hypernetizenwarez.html",
    textBinBytes: warezFallback,
    textRel8n: "ua_text",
    textAction: {
      kind: "park_request",
      path: WAREZ_TEXT_IB,
      method: "GET",
    },
    policyAddr: compositeAddr,
    textOwner: hypertextOwner,
    textPolicyAddr: hypertextTipAddr,
  });

  console.log("\ndone â€” browse hypertext/welcome | hypertext/hypernetizenwarez");
  console.log(`policy ${COMPOSITE_POLICY_IB} â†’ ${compositeAddr}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
