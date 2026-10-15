/**
 * Merge host-boot init_script lines into navi_init_script.frame.json for a
 * host-enabled navi_shell.exe build. Restored by build_host.bat after build.
 *
 *   node navi_shell/scripts/apply_host_boot_seed.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const SEED = path.join(
  ROOT,
  "C_devops/navi_redux/seed/navi_init_script.frame.json"
);
const FRAG = path.join(
  ROOT,
  "C_devops/navi_redux/seed/navi_init_script.host.fragment.json"
);
const MARKER = "[host_boot]";

const frame = JSON.parse(fs.readFileSync(SEED, "utf8"));
const frag = JSON.parse(fs.readFileSync(FRAG, "utf8"));
const extra = Array.isArray(frag.script_lines) ? frag.script_lines : [];
const script = Array.isArray(frame.data?.script)
  ? [...frame.data.script]
  : [];

for (const line of extra) {
  const s = String(line || "").trim();
  if (!s) continue;
  if (script.some((row) => String(row).includes(MARKER))) break;
  script.push(s);
}

frame.data.script = script;
fs.writeFileSync(SEED, JSON.stringify(frame, null, 2) + "\n", "utf8");
console.log("applied host boot to", SEED);
