/**
 * Check torus/scripts/stagemods (live hostpark) → every mounted short park serves the local
 * B_testkit_mods source, and gadgets points at it.
 *   node C_devops/scripts/_check_stagemods_drift.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCAL = path.join(__dirname, "..", "..", "B_testkit_mods");
const BASE = "https://foobarch.net";

const SUBJECT = {
  supermouse: "supermouse.js",
  stagedir: "horizon_stagedir.js",
  dropdown: "supermouse_plugin_dropdown.js",
  no_dubclick: "supermouse_plugin_no_dubclick.js",
  draggem_div: "supermouse_plugin_draggem_div.js",
  stagejockey: "supermouse_plugin_stagejockey.js",
  jockey_remove: "jockey-plugins/jockey-remove.js",
  jockey_move: "jockey-plugins/jockey_move.js",
  stage_casting: "jockey-plugins/stage_casting.js",
  image_resize: "jockey-plugins/image_resize.js",
  surf_persist: "jockey-plugins/surf_persist.js",
  stage_draggem: "jockey-plugins/stage_draggem.js",
  relativespan: "jockey-plugins/relativespan.js",
  tabletop_render: "jockey-plugins/tabletop_render.js",
  zip_manifest: "jockey-plugins/zip-manifest.js",
  scripter: "scripter.js",
};

const norm = (s) => s.replace(/\r\n/g, "\n").replace(/^\uFEFF/, "");
const ver = (s) => s?.match(/version:\s*["']([^"']+)/)?.[1] || "?";

const sres = await fetch(`${BASE}/torus/scripts/stagemods`);
const script = await sres.text();
console.log(`torus/scripts/stagemods ${sres.status} ${sres.headers.get("content-type")}`);
const parks = [...script.matchAll(/mount (\S+?)"\)/g)].map((m) => m[1]);
parks.push("scripter");

for (const park of parks) {
  const res = await fetch(`${BASE}/${park}`);
  const live = norm(await res.text());
  const rel = SUBJECT[park];
  let local = null;
  try {
    local = rel ? norm(fs.readFileSync(path.join(LOCAL, ...rel.split("/")), "utf8")) : null;
  } catch {
    /* missing */
  }
  const ct = res.headers.get("content-type") || "";
  const state =
    res.status !== 200
      ? `HTTP ${res.status}`
      : !/navi-module/.test(ct)
        ? `not a module (${ct})`
        : local == null
          ? `v${ver(live)} (no local subject mapped)`
          : live === local
            ? `v${ver(live)} = local`
            : `v${ver(live)} ≠ local v${ver(local)} (unpublished local edits)`;
  console.log(`  ${park.padEnd(16)} ${state}`);
}

const g = await (await fetch(`${BASE}/hypertext/gadgets`)).text();
console.log(
  `hypertext/gadgets: ${/scripter run torus\/scripts\/stagemods/.test(g) && /mount scripter/.test(g) && !/flowerpot/.test(g) ? "points at hostpark (no flowerpot)" : "STALE"}`
);
