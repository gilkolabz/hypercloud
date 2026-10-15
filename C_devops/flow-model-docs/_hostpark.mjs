/**
 * Publish flow-model + ecosystem HTMFs to hostpark (torus identity).
 * Sources: flow-model-docs/htmf/*.html and htmf-ecosystem/*.html — edit directly; no MD build step.
 *
 *   node C_devops/flow-model-docs/_hostpark.mjs --yes
 *   FOOBARCH_HOST=https://foobarch.net node C_devops/flow-model-docs/_hostpark.mjs --yes
 *   node C_devops/flow-model-docs/_hostpark.mjs --yes flow-model/runtime docs/hostparking
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { FLOW_MODEL_SLUGS } from "./_catalog.mjs";
import { ECOSYSTEM_SLUGS } from "../htmf-ecosystem/_catalog.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

const argv = process.argv.slice(2);
if (!argv.includes("--yes")) {
  console.log("usage: node _hostpark.mjs --yes [flow-model/<slug> ...] [docs/<slug> ...]");
  console.log("  (no filters → publish all flow-model + docs HTMFs)");
  process.exit(0);
}

const filters = argv.filter((a) => a !== "--yes");
const publishArgs = [
  path.join(ROOT, "C_devops/identity/_publish.mjs"),
  "--yes",
  "--identity",
  "torus",
];

if (filters.length) {
  publishArgs.push(...filters);
} else {
  publishArgs.push(
    ...FLOW_MODEL_SLUGS.map((slug) => `flow-model/${slug}`),
    ...ECOSYSTEM_SLUGS.map((slug) => `docs/${slug}`)
  );
}

const r = spawnSync(process.execPath, publishArgs, {
  cwd: ROOT,
  stdio: "inherit",
  env: process.env,
});
if (r.status) process.exit(r.status || 1);
