/**
 * Hostpark bin-bearing module parks from hypernetizen/warez discovery
 * (short-name ibs), then upsert each tip ib^gib onto hypernetizen/warez.
 * Prefer local B_testkit_mods bytes; flowerpot subject fetch is fallback.
 * Does NOT flowerpot-pot — publishes mod tips to foobarch_host only.
 *
 * Prefer for catalog publishes:
 *   FOOBARCH_HOST=https://foobarch.net node C_devops/mods/_pot_all.mjs --yes --only <name> --devnote "…"
 *
 *   FOOBARCH_HOST=https://foobarch.net node C_devops/identity/_hostpark_warez_mod_parks.mjs --yes
 *   FOOBARCH_HOST=https://foobarch.net node C_devops/identity/_hostpark_warez_mod_parks.mjs --yes potter_gibbert
 *
 * ib = underscore(about.name); target = about.navi_name || leaf(subject.ib).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  DEFAULT_HOST,
  DEFAULT_USAGE_PASSWORD,
  buildModParkFrame,
  buildPutEnvelope,
  getIdentity,
  loadOrCreateOwner,
  parkMethodBlock,
  saveJson,
  signHeadersForBody,
  takeUsageToken,
} from "./_lib.mjs";
import { getPayload } from "../../hypernetizen/warez/_fp.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const FP = "https://foobarch.net/flowerpot";
const WAREZ_TIP = "hypernetizen/warez";

function parseArgs(argv) {
  const yes = argv.includes("--yes");
  const only = [];
  for (const a of argv) {
    if (a === "--yes" || a.startsWith("-")) continue;
    only.push(String(a).trim());
  }
  return { yes, only: new Set(only.map((s) => s.toLowerCase())) };
}

function underscoreName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

function splitAddr(addr) {
  const a = String(addr || "");
  const i = a.indexOf("^");
  if (i <= 0) return { ib: a, gib: "" };
  return { ib: a.slice(0, i), gib: a.slice(i + 1) };
}

function leafName(pathOrName) {
  const s = String(pathOrName || "").trim();
  if (!s) return "";
  const base = s.includes("/") ? s.slice(s.lastIndexOf("/") + 1) : s;
  return base.replace(/\.js$/i, "");
}

/** Prefer C_devops/mods/<park>.json about over a stale live eframe about. */
function loadLocalSidecarAbout(parkIb) {
  const p = path.join(ROOT, "C_devops", "mods", `${parkIb}.json`);
  if (!fs.existsSync(p)) return null;
  try {
    const j = JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
    return j.about && typeof j.about === "object" ? j.about : null;
  } catch {
    return null;
  }
}

/**
 * Pull register()/moduleInfo version from module source when about is stale.
 * Prefer the last `version: "…"` near moduleInfo / return block.
 */
function versionFromSource(source) {
  const text = String(source || "");
  const hits = [
    ...text.matchAll(/\bversion\s*:\s*["']([0-9]+(?:\.[0-9]+){1,3})["']/g),
  ].map((m) => m[1]);
  return hits.length ? hits[hits.length - 1] : "";
}

async function getJson(url) {
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status}: ${text.slice(0, 160)} (${url})`);
  return JSON.parse(text);
}

function tipUrl(ib, addr) {
  const pathPart = String(ib)
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
  const base = `${FP}/${pathPart}`;
  return addr ? `${base}?addr=${encodeURIComponent(addr)}` : base;
}

async function mintToken(base, password) {
  return takeUsageToken(base, password);
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

async function putCommit(base, ib, envelope, headers, method = "PUT") {
  const body = JSON.stringify(envelope);
  const res = await fetch(`${base}/${ib}`, {
    method,
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
    throw new Error(`${method} /${ib} → ${res.status}: ${text.slice(0, 400)}`);
  }
  return {
    status: res.status,
    addr: res.headers.get("x-foobarch-ib^gib") || json?.addr || null,
  };
}

const { yes, only } = parseArgs(process.argv.slice(2));
if (!yes) {
  console.error(
    "refusing to PUT — pass --yes: node C_devops/identity/_hostpark_warez_mod_parks.mjs --yes"
  );
  process.exit(1);
}

const identity = getIdentity("foobarch");
const base = (process.env.FOOBARCH_HOST || DEFAULT_HOST).replace(/\/$/, "");
const password =
  process.env.FOOBARCH_USAGE_PASSWORD || DEFAULT_USAGE_PASSWORD;
const owner = loadOrCreateOwner(identity);
const policyAddr = owner.policy_addr || null;

console.log(`identity: ${identity.id}`);
console.log(`host:     ${base}`);
console.log(`warez:    ${WAREZ_TIP}`);

const warezRes = await getPayload(WAREZ_TIP);
if (!warezRes.ok) throw new Error(`GET ${WAREZ_TIP} → ${warezRes.status}: ${warezRes.text.slice(0, 160)}`);
const tip = JSON.parse(warezRes.text);
const frames = Array.isArray(tip?.frames) ? tip.frames.map(String) : [];
if (!frames.length) throw new Error("warez index empty");

let done = 0;
let skipped = 0;
for (const frameAddr of frames) {
  const { ib: manIb } = splitAddr(frameAddr);
  const shortPark = !manIb.includes("/") && !manIb.includes(":");

  /** @type {Record<string, unknown>} */
  let about = {};
  /** @type {Record<string, unknown>} */
  let sub = {};
  let parkIb = "";
  let displayName = "";
  let target = "";
  let subjectIb = "";
  let subjectAddr = null;

  if (shortPark) {
    // Index already holds hostpark tip ib^gib — refresh from host eframe + warez_subject.
    parkIb = manIb;
    if (only.size && !only.has(parkIb)) continue;
    try {
      const er = await fetch(`${base}/${encodeURIComponent(parkIb)}`, {
        headers: { Accept: "application/eframe" },
      });
      const et = await er.text();
      if (!er.ok) throw new Error(`${er.status}: ${et.slice(0, 120)}`);
      const tipFrame = JSON.parse(et);
      const data =
        tipFrame.data && typeof tipFrame.data === "object" ? tipFrame.data : tipFrame;
      about = data.about && typeof data.about === "object" ? data.about : {};
      displayName =
        about.name != null ? String(about.name) : parkIb;
      target =
        about.navi_name != null && String(about.navi_name).trim()
          ? String(about.navi_name).trim()
          : String(data.module?.name || parkIb);
      subjectIb = String(about.warez_subject || "")
        .replace(/^flowerpot\//i, "")
        .replace(/^\/+/, "");
    } catch (err) {
      console.error(`skip ${parkIb}: eframe ${err.message || err}`);
      skipped++;
      continue;
    }
  } else {
    let man;
    try {
      man = await getJson(tipUrl(manIb, frameAddr));
    } catch (err) {
      console.error(`skip manifest ${frameAddr}: ${err.message || err}`);
      skipped++;
      continue;
    }
    about = man.about && typeof man.about === "object" ? man.about : {};
    sub = man.subject && typeof man.subject === "object" ? man.subject : {};
    displayName =
      about.name != null ? String(about.name) : leafName(manIb);
    parkIb = underscoreName(displayName);
    if (!parkIb) {
      console.error(`skip ${frameAddr}: empty name`);
      skipped++;
      continue;
    }
    if (only.size && !only.has(parkIb) && !only.has(displayName.toLowerCase())) {
      continue;
    }
    target =
      about.navi_name != null && String(about.navi_name).trim()
        ? String(about.navi_name).trim()
        : leafName(sub.ib || manIb);
    subjectIb = String(sub.ib || "")
      .replace(/^flowerpot\//i, "")
      .replace(/^\/+/, "");
    subjectAddr = sub.addr != null ? String(sub.addr) : null;
  }

  if (!subjectIb) {
    console.error(`skip ${parkIb}: no subject.ib / warez_subject`);
    skipped++;
    continue;
  }
  let source;
  // Prefer local bytes (hostpark lane). Flowerpot subject GET kept as fallback.
  const legacyPrefix = "hypercloud/testkit/mods/legacy/";
  const localRel = subjectIb.startsWith(legacyPrefix)
    ? subjectIb.slice(legacyPrefix.length)
    : "";
  const localPath = localRel
    ? path.join(ROOT, "B_testkit_mods", localRel)
    : "";
  if (localPath && fs.existsSync(localPath)) {
    source = fs.readFileSync(localPath, "utf8");
    console.log(`  source local ${localRel}`);
  } else {
    try {
      // LEGACY fallback: pull subject bytes from flowerpot tip.
      const url = tipUrl(subjectIb, subjectAddr);
      const res = await fetch(url);
      const text = await res.text();
      if (!res.ok) throw new Error(`${res.status}: ${text.slice(0, 120)}`);
      source = text;
      console.log(`  source flowerpot ${subjectIb}`);
    } catch (err) {
      console.error(`skip ${parkIb}: subject fetch ${err.message || err}`);
      skipped++;
      continue;
    }
  }
  if (!source.trim()) {
    console.error(`skip ${parkIb}: empty subject`);
    skipped++;
    continue;
  }

  // Sidecar/local about wins over stale live eframe about (version drift bug).
  const sidecarAbout = loadLocalSidecarAbout(parkIb);
  if (sidecarAbout) {
    about = { ...about, ...sidecarAbout };
    if (about.name != null) displayName = String(about.name);
    if (about.navi_name != null && String(about.navi_name).trim()) {
      target = String(about.navi_name).trim();
    }
    console.log(`  about from C_devops/mods/${parkIb}.json (v${about.version || "?"})`);
  }
  const srcVer = versionFromSource(source);
  if (srcVer && String(about.version || "") !== srcVer) {
    console.log(
      `  version sync ${about.version || "(none)"} → ${srcVer} (from module source)`
    );
    about = { ...about, version: srcVer };
  }
  if (!target) target = parkIb;

  const existing = await getTip(base, parkIb);
  const parentAddr = existing && !existing.tombstone ? existing.addr : null;
  const n = parentAddr ? Number(existing.frame?.data?.n || 0) + 1 : 0;
  const bytes = Buffer.from(source, "utf8");
  const frame = buildModParkFrame(
    {
      ib: parkIb,
      target,
      command: target,
      about: {
        name: displayName || parkIb,
        navi_name: target,
        version: about.version != null ? String(about.version) : undefined,
        description:
          about.description != null ? String(about.description) : undefined,
        ...(about["commit-devnote"]
          ? { "commit-devnote": String(about["commit-devnote"]) }
          : {}),
        warez_subject: subjectIb,
      },
      gate: true,
    },
    bytes,
    { policyAddr, parentAddr, n }
  );
  const envelope = buildPutEnvelope(
    frame,
    bytes,
    "application/navi-module"
  );
  const body = JSON.stringify(envelope);
  const token = await mintToken(base, password);
  /** @type {Record<string, string>} */
  const headers = { "X-Foobarch-Usage-Token": token };
  if (parentAddr && existing.frame?.rel8ns?.policy?.[0]) {
    Object.assign(
      headers,
      signHeadersForBody(owner, { ib: parkIb, parentAddr, body })
    );
  }
  const method = existing ? commitMethodForTip(existing.frame) : "PUT";
  const r = await putCommit(base, parkIb, envelope, headers, method);
  console.log(
    `${parentAddr ? "mut8" : "firstGen"} ${parkIb} → ${r.addr} (target=${target}, ${bytes.length} bytes)`
  );
  if (r.addr) {
    const up = spawnSync(
      process.execPath,
      [path.join(ROOT, "hypernetizen", "warez", "_upsert.mjs"), r.addr],
      { cwd: ROOT, encoding: "utf8" }
    );
    if (up.stdout) process.stdout.write(up.stdout);
    if (up.stderr) process.stderr.write(up.stderr);
    if (up.status !== 0) {
      console.error(`warez upsert failed for ${r.addr} (exit ${up.status})`);
    }
  }
  done++;
}

saveJson(identity.ownerPath, owner);
console.log(`done — ${done} mod parks hostparked, ${skipped} skipped`);
