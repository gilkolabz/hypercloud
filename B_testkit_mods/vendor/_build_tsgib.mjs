/**
 * Rebuild browser-global ts-gib vendor (htmx-style).
 *
 *   node B_testkit_mods/vendor/_build_tsgib.mjs
 *
 * Output: tsgib.min.js — IIFE that sets globalThis.tsgib (works under navi.mount wrap).
 * Mount first, then use tiny_ibgib_space (it navi.mounts this vendor on init).
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const entry = path.join(ROOT, "flowerpot_v2", "lib", "ts-gib", "dist", "index.mjs");
const out = path.join(__dirname, "tsgib.min.js");

const r = spawnSync(
  "npx",
  [
    "--yes",
    "esbuild",
    entry,
    "--bundle",
    "--format=iife",
    "--global-name=tsgib",
    "--platform=browser",
    "--target=es2020",
    `--outfile=${out}`,
    "--footer:js=globalThis.tsgib=tsgib;",
  ],
  { cwd: ROOT, stdio: "inherit", shell: true }
);
process.exit(r.status ?? 1);
