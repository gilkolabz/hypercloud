/**
 * Repair navi tip space after tip_frames.json clobber:
 * - Merge all frames from legacy* tip_frames.json into current tip_frames.json
 * - For each tips.json pointer whose addr is missing, retarget to the newest
 *   surviving frame for that ib (by data.n, then timestamp)
 *
 *   node navi_shell/scripts/repair_tip_frames_from_legacy.mjs
 *   node navi_shell/scripts/repair_tip_frames_from_legacy.mjs --dry
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const dry = process.argv.includes("--dry");
const root = path.join(os.homedir(), "AppData", "Roaming", ".navi_shell");
const tipsPath = path.join(root, "tips.json");
const framesPath = path.join(root, "tip_frames.json");

function readMap(p) {
  try {
    const raw = fs.readFileSync(p, "utf8");
    if (!String(raw || "").trim()) return {};
    const j = JSON.parse(raw);
    return j && typeof j === "object" && !Array.isArray(j) ? j : {};
  } catch {
    return {};
  }
}

function writeAtomic(p, data) {
  const body = JSON.stringify(data, null, 2);
  const stamp = `${process.pid}.${Date.now()}`;
  const tmp = `${p}.tmp.${stamp}`;
  const bak = `${p}.bak.${stamp}`;
  fs.writeFileSync(tmp, body, "utf8");
  try {
    fs.renameSync(tmp, p);
    return;
  } catch {
    /* dest exists */
  }
  try {
    fs.renameSync(p, bak);
  } catch {
    /* no live */
  }
  fs.renameSync(tmp, p);
  try {
    fs.unlinkSync(bak);
  } catch {
    /* keep bak */
  }
}

function frameRank(fr) {
  const n = Number(fr?.data?.n) || 0;
  const t = Date.parse(String(fr?.data?.timestamp || "")) || 0;
  return n * 1e15 + t;
}

const tips = readMap(tipsPath);
let frames = readMap(framesPath);
const beforeCount = Object.keys(frames).length;

const legacyDirs = fs
  .readdirSync(root, { withFileTypes: true })
  .filter((d) => d.isDirectory() && /^legacy/i.test(d.name))
  .map((d) => path.join(root, d.name));

let merged = 0;
for (const dir of legacyDirs) {
  const fp = path.join(dir, "tip_frames.json");
  if (!fs.existsSync(fp)) continue;
  const map = readMap(fp);
  console.log(`pool ${dir}: ${Object.keys(map).length} frames`);
  for (const [addr, fr] of Object.entries(map)) {
    if (!frames[addr]) {
      frames[addr] = fr;
      merged++;
    }
  }
}

// Index by ib → best frame addr
const byIb = new Map();
for (const [addr, fr] of Object.entries(frames)) {
  const ib = String(fr?.ib || addr.split("^")[0] || "").trim();
  if (!ib) continue;
  const gib = String(fr?.gib || addr.split("^")[1] || "").trim();
  const full = `${ib}^${gib}`;
  const prev = byIb.get(ib);
  if (!prev || frameRank(fr) >= frameRank(prev.fr)) {
    byIb.set(ib, { addr: full, fr });
  }
}

let retargeted = 0;
let ok = 0;
let dead = 0;
for (const [ib, row] of Object.entries(tips)) {
  const want =
    (row && typeof row === "object" && row.addr) ||
    (row?.gib ? `${ib}^${row.gib}` : "");
  if (want && frames[want]) {
    ok++;
    continue;
  }
  const best = byIb.get(ib);
  if (best) {
    tips[ib] = { ib, addr: best.addr, pointer: true };
    retargeted++;
    console.log(`retarget ${ib} → ${best.addr.slice(0, 72)}…`);
  } else {
    dead++;
    console.log(`DEAD    ${ib} (no frame in pools)`);
  }
}

console.log(
  `\nframes ${beforeCount}→${Object.keys(frames).length} (merged +${merged}); tips ok=${ok} retargeted=${retargeted} dead=${dead}`
);

if (!dry) {
  writeAtomic(framesPath, frames);
  writeAtomic(tipsPath, tips);
  console.log(`wrote ${framesPath}`);
  console.log(`wrote ${tipsPath}`);
} else {
  console.log("(dry run — no write)");
}
