/**
 * Legacy flowerpot snapshot — superseded by hostpark HTMF.
 * @deprecated use C_devops/flow-model-docs/_hostpark.mjs
 *
 *   node C_devops/flow-model-docs/_pot.mjs
 *   node C_devops/flow-model-docs/_pot.mjs README.md runtime.md
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { putSystems, TOKEN_FILE } from "../../hypernetizen/warez/_fp.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PREFIX = "devops/flow-model";
const CT = "text/markdown; charset=utf-8";

const PASSWORD =
  process.env.FLOWERPOT_PASSWORD ||
  "0f8fe7d4949c53add2dc74905e5611ed3b207a668aa57ce3fed9745b5c67a897";

const ALL = [
  "README.md",
  "overview.md",
  "runtime.md",
  "flow-artifacts.md",
  "manager.md",
  "composition.md",
  "variants.md",
  "program-manifest.md",
  "addressing.md",
  "ux-spectrum.md",
  "authoring.md",
  "ethos.md",
  "glossary.md",
];

async function ensureTokens(need) {
  let store = { "spare tokens": [] };
  try {
    store = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    /* empty */
  }
  const q = store["spare tokens"] || [];
  if (q.length >= need) return;
  const ask = Math.min(100, Math.max(need - q.length, 4));
  const res = await fetch("https://foobarch.net/flowerpot/_flowerpot/tokens", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Flowerpot-Usage-Password": PASSWORD,
    },
    body: JSON.stringify({ count: ask }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`mint ${res.status}: ${text.slice(0, 200)}`);
  store["spare tokens"] = [...JSON.parse(text).tokens, ...q];
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(store, null, 2) + "\n");
}

const want = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const files = want.length ? want : ALL;

await ensureTokens(files.length + 2);

const results = [];
for (const name of files) {
  const local = path.join(__dirname, name);
  if (!fs.existsSync(local)) throw new Error(`missing ${local}`);
  const route = `${PREFIX}/${name}`;
  const addr = await putSystems(route, fs.readFileSync(local), CT);
  results.push({ route, addr });
}

console.log("\n— snapshot —");
for (const r of results) console.log(`${r.route} → ${r.addr}`);
