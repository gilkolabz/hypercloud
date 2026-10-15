/**
 * Restore navi_init_script.frame.json from .bak (build_host.bat).
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
const BAK = SEED + ".bak";

if (!fs.existsSync(BAK)) {
  console.log("no backup to restore:", BAK);
  process.exit(0);
}
fs.copyFileSync(BAK, SEED);
fs.unlinkSync(BAK);
console.log("restored", SEED);
