/**
 * Hostpark stagemods scripter text at torus/scripts/stagemods (torus identity, foobarch.net).
 *
 *   node C_devops/scripts/_pot_stagemods.mjs
 *
 * Run from gadgets: scripter run torus/scripts/stagemods
 */
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

const out = spawnSync(
  process.execPath,
  ["C_devops/identity/_publish.mjs", "--yes", "--identity", "torus", "torus/scripts/stagemods"],
  {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, FOOBARCH_HOST: process.env.FOOBARCH_HOST || "https://foobarch.net" },
  }
);
process.exit(out.status ?? 1);
