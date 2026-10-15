/**
 * Collect every locally recorded flowerpot logical route → HTMF catalog.
 *   node C_devops/fragment/_collect_flowerpot_routes.mjs
 *   node C_devops/fragment/_collect_flowerpot_routes.mjs --write-html
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const WRITE_HTML = process.argv.includes("--write-html");
const routes = new Map();

function add(route, source) {
  if (!route || typeof route !== "string") return;
  let r = route.trim().replace(/^\/+/, "").replace(/\\/g, "/");
  if (r.startsWith("flowerpot/")) r = r.slice("flowerpot/".length);
  if (r.startsWith("flowerpot:")) r = r.slice("flowerpot:".length).split("^")[0];
  if (!r) return;
  if (/[…<>{}]/.test(r) || r.includes("...")) return;
  if (r.startsWith("_flowerpot/")) return;
  // identity labels / single tokens are not flowerpot routes
  if (!r.includes("/") && r !== "horizon" && r !== "manifest") return;
  if (!routes.has(r)) routes.set(r, new Set());
  routes.get(r).add(source);
}

function walkFiles(dir, pred, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === "node_modules" || ent.name === ".git") continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkFiles(full, pred, out);
    else if (pred(ent.name, full)) out.push(full);
  }
  return out;
}

function rel(p) {
  return path.relative(ROOT, p).replace(/\\/g, "/");
}

// --- systems_pot_index ---
{
  const idx = path.join(ROOT, "A_devops/systems_pot_index");
  if (fs.existsSync(idx)) {
    for (const line of fs.readFileSync(idx, "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (t) add(t, "A_devops/systems_pot_index");
    }
  }
}

// --- flowerpot_manifest.json (use flowerpot_route, not local key) ---
{
  const manPath = path.join(ROOT, "A_devops/flowerpot_manifest.json");
  if (fs.existsSync(manPath)) {
    const man = JSON.parse(fs.readFileSync(manPath, "utf8"));
    const paths = man.paths;
    if (Array.isArray(paths)) {
      for (const p of paths) {
        if (typeof p === "string") add(p, "A_devops/flowerpot_manifest.json");
        else if (p?.flowerpot_route) add(p.flowerpot_route, "A_devops/flowerpot_manifest.json");
        else if (p?.route) add(p.route, "A_devops/flowerpot_manifest.json");
      }
    } else if (paths && typeof paths === "object") {
      for (const v of Object.values(paths)) {
        if (typeof v === "string") add(v, "A_devops/flowerpot_manifest.json");
        else if (v?.flowerpot_route) add(v.flowerpot_route, "A_devops/flowerpot_manifest.json");
        else if (v?.route) add(v.route, "A_devops/flowerpot_manifest.json");
      }
    }
  }
}

// --- B_devops/v2_paths ---
{
  const vp = path.join(ROOT, "B_devops/v2_paths");
  if (fs.existsSync(vp)) {
    const st = fs.statSync(vp);
    if (st.isFile()) {
      for (const line of fs.readFileSync(vp, "utf8").split(/\r?\n/)) {
        const t = line.trim();
        if (t && !t.startsWith("#")) add(t, "B_devops/v2_paths");
      }
    } else if (st.isDirectory()) {
      for (const f of walkFiles(vp, () => true)) {
        const text = fs.readFileSync(f, "utf8");
        try {
          const j = JSON.parse(text);
          if (Array.isArray(j)) {
            for (const x of j) add(typeof x === "string" ? x : x.route || x.flowerpot_route, rel(f));
          } else if (j.route || j.flowerpot_route) {
            add(j.route || j.flowerpot_route, rel(f));
          } else if (j.paths) {
            for (const x of j.paths) add(typeof x === "string" ? x : x.route || x.flowerpot_route, rel(f));
          }
        } catch {
          for (const line of text.split(/\r?\n/)) {
            const t = line.trim();
            if (t && !t.startsWith("#")) add(t, rel(f));
          }
        }
      }
    }
  }
}

// --- explicit ROUTE / *_IB / route: in _pot*.mjs ---
{
  const pots = walkFiles(ROOT, (name) => /^_pot.*\.mjs$/.test(name) || name === "_pot.mjs");
  for (const f of pots) {
    const text = fs.readFileSync(f, "utf8");
    const src = rel(f);
    for (const m of text.matchAll(/\b(?:route|ROUTE|TIP_IB|POLICY_IB|TURTLE_IB|MANIFEST_IB|IDENTITY_IB|SHIELD_IB)\s*[:=]\s*["'`]([^"'`]+)["'`]/g)) {
      add(m[1], src);
    }
    for (const m of text.matchAll(/route:\s*["'`]([^"'`]+)["'`]/g)) add(m[1], src);
  }
}

// --- legacy mods dir ---
{
  const MODS_DIR = path.join(ROOT, "B_testkit_mods");
  const PREFIX = "hypercloud/testkit/mods/legacy";
  if (fs.existsSync(MODS_DIR)) {
    for (const name of fs.readdirSync(MODS_DIR)) {
      const full = path.join(MODS_DIR, name);
      if (fs.statSync(full).isFile()) add(`${PREFIX}/${name}`, "B_testkit_mods");
    }
    const jockey = path.join(MODS_DIR, "jockey-plugins");
    if (fs.existsSync(jockey)) {
      for (const name of fs.readdirSync(jockey)) {
        const full = path.join(jockey, name);
        if (fs.statSync(full).isFile())
          add(`${PREFIX}/jockey-plugins/${name}`, "B_testkit_mods");
      }
    }
  }
}

// --- C_devops/mods/_pot_all CATALOG → subject + manifest pots ---
{
  const f = path.join(ROOT, "C_devops/mods/_pot_all.mjs");
  if (fs.existsSync(f)) {
    const text = fs.readFileSync(f, "utf8");
    const LEGACY = "hypercloud/testkit/mods/legacy";
    const MAN_PREFIX = "hypercloud/testkit/mods";
    for (const m of text.matchAll(/subjectRel:\s*["'`]([^"'`]+)["'`]/g)) {
      add(`${LEGACY}/${m[1]}`, "C_devops/mods/_pot_all.mjs");
    }
    for (const m of text.matchAll(/name:\s*["'`]([^"'`]+)["'`]/g)) {
      // only catalog about.name entries near subjectRel — accept all string names in file is noisy;
      // pot leaf = about.name from objects that also have subjectRel
    }
    // parse CATALOG blocks roughly: { name: "...", subjectRel
    for (const m of text.matchAll(/\{\s*name:\s*["'`]([^"'`]+)["'`],\s*subjectRel:/g)) {
      add(`${MAN_PREFIX}/${m[1]}`, "C_devops/mods/_pot_all.mjs");
    }
    add(`${LEGACY}/fetchgater.js`, "C_devops/mods/_pot_all.mjs");
  }
}

// --- native mods ---
{
  const natives = [
    "server_manager",
    "foobarch_server",
    "foobarch_host",
    "phonebook_server",
    "faucet_server",
    "caddy_server",
    "spacebarz_arbiter",
    "spacebarz_fusion",
    "mimex",
    "dummyrelay",
  ];
  for (const n of natives) add(`torus/native/${n}`, "B_native_mods/README.md");
  add("torus/testkit/fsdevopstracker.js", "B_native_mods/_pot_fsdevopstracker.mjs");
  add("torus/testkit/mod/fsdevopstracker", "B_native_mods/README.md");
}

// --- snowcone / popsicle ---
{
  add("torus/hypernet/navi/snowcone/navi_shell.js", "navi_shell/_pot_snowcone.mjs");
  add("torus/hypernet/navi/snowcone/sw.js", "navi_shell/_pot_snowcone.mjs");
  add("torus/hypernet/navi/popsicle/navi_shell.js", "navi_shell/_pot_popsicle.mjs");
  add("torus/hypernet/navi/popsicle/sw.js", "navi_shell/_pot_popsicle.mjs");
}

// --- flow-model-docs ---
{
  const dir = path.join(ROOT, "C_devops/flow-model-docs");
  const PREFIX = "devops/flow-model";
  if (fs.existsSync(dir)) {
    for (const name of fs.readdirSync(dir)) {
      if (!/\.md$/i.test(name) || name.startsWith("_")) continue;
      add(`${PREFIX}/${name}`, "C_devops/flow-model-docs/_pot.mjs");
    }
  }
}

// --- ti_punch ALL list ---
{
  const pot = path.join(ROOT, "C_devops/opryland/ti_punch/_pot.mjs");
  if (fs.existsSync(pot)) {
    const text = fs.readFileSync(pot, "utf8");
    const PREFIX = "opry/devops/ti_punch";
    const allM = text.match(/const ALL = \[([\s\S]*?)\];/);
    if (allM) {
      for (const m of allM[1].matchAll(/["'`]([^"'`]+)["'`]/g)) {
        add(`${PREFIX}/${m[1]}`, "C_devops/opryland/ti_punch/_pot.mjs");
      }
    }
  }
}

// --- fragment single-route pots ---
{
  const singles = [
    ["torus/testkit/relaytest", "C_devops/fragment/_pot_relaytest.mjs"],
    ["torus/testkit/notemaker", "C_devops/fragment/_pot_notemaker.mjs"],
    ["torus/testkit/legacy/notemaker_v1", "C_devops/fragment/_pot_notemaker_v1.mjs"],
    ["torus/testkit/text_editor", "C_devops/fragment/_pot_text_editor.mjs"],
    ["torus/testkit/tablemaker", "C_devops/fragment/_pot_tablemaker.mjs"],
    ["torus/testkit/tinyviewport", "C_devops/fragment/_pot_tinyviewport.mjs"],
    ["testkit/tinyviewport", "C_devops/fragment/_pot_tinyviewport.mjs"],
    ["research/opryland", "C_devops/fragment/_pot_research_opryland.mjs"],
  ];
  for (const [r, s] of singles) add(r, s);
}

// --- attest / shield ---
{
  add("torus/devops/attest_imp/test_module_turtle/turtle.js", "B_devops/attest_imp");
  add("torus/devops/attest_imp/test_module_turtle/turtle_manifest", "B_devops/attest_imp");
  add("torus/devops/attest_imp/rootproofer_identity", "B_devops/attest_imp");
  add("torus/devops/rootproofer_shield/rootproofer_shield.js", "B_devops/rootproofer_shield");
  add("torus/devops/rootproofer_shield/rootproofer_shield_manifest", "B_devops/rootproofer_shield");
}

// --- hypernetizen warez ---
{
  add("hypernetizen/warez", "hypernetizen/warez/_fp.mjs");
  add("hypernetizen/warez_policy", "hypernetizen/warez/_fp.mjs");
  add("hypernetizen/testkit2/warez", "hypernetizen/testkit2/warez/_fp.mjs");
  add("hypernetizen/testkit2/warez_policy", "hypernetizen/testkit2/warez/_fp.mjs");
}

// --- token stashes (documented) ---
{
  add("torus/devops/tokens/a", "A_document/stashing.md");
  add("torus/devops/tokens/ti_punch", "B_native_mods/_smoke_fsdevopstracker_relay.mjs");
  add("torus/devops/phonebook-tokens/a", "B_native_mods/README.md");
  add("torus/devops/phonebook-tokens/navi", "B_native_mods/README.md");
}

// --- policy / schema ---
{
  add("policies/systems-pot", "A_devops/_pot_systems_index.mjs");
  add("flowerpot.schema.keys.v1", "A_devops/_pot_systems_index.mjs");
}

// --- identity redirect targets ---
{
  add("horizon", "C_devops/identity/_lib.mjs");
  add("manifest", "C_devops/identity/_lib.mjs");
}

// --- gadgets + horizon fragment pots (route: already scanned); add known trash notes ---
{
  const trash = path.join(ROOT, "deprecated_trash.md");
  if (fs.existsSync(trash)) {
    const text = fs.readFileSync(trash, "utf8");
    for (const m of text.matchAll(/flowerpot\/([a-zA-Z0-9_./@+-]+)/g)) {
      const r = m[1].replace(/\/+$/, "");
      if (r.includes("++") || r.includes("--") || r.includes("__")) continue;
      if (r.length > 200) continue;
      add(r, "deprecated_trash.md");
    }
  }
}

// --- this catalog ---
add("torus/flowerpot-catalog", "C_devops/fragment/torus_flowerpot_catalog.html");
add("torus/host-catalog", "C_devops/fragment/torus_host_catalog.html");

function category(r) {
  if (r.startsWith("torus/native/")) return "torus/native";
  if (r.startsWith("torus/hypernet/")) return "torus/hypernet (snowcone/popsicle)";
  if (r.startsWith("torus/testkit/") || r.startsWith("testkit/")) return "torus/testkit";
  if (r.startsWith("torus/systems/")) return "torus/systems (allenvethosp live index)";
  if (r.startsWith("torus/A_document/") || r.startsWith("torus/A_devops/"))
    return "torus/A_* (flowerpot_manifest)";
  if (r.startsWith("torus/devops/attest") || r.startsWith("torus/devops/rootproofer"))
    return "torus/devops attest / shield";
  if (r.startsWith("torus/devops/tokens") || r.startsWith("torus/devops/phonebook-tokens"))
    return "torus/devops token stashes";
  if (r.startsWith("torus/devops/") || r.startsWith("devops/")) return "devops docs";
  if (r.startsWith("torus/flowerpot-catalog") || r.startsWith("torus/host-catalog"))
    return "torus catalogs (hostpark)";
  if (r.startsWith("hypercloud/testkit/mods/legacy")) return "hypercloud legacy mods";
  if (r.startsWith("hypercloud/testkit/mods/")) return "hypercloud mod manifests";
  if (r.startsWith("hypercloud/")) return "hypercloud gadgets / testkit data";
  if (r.startsWith("opry/")) return "opryland";
  if (r.startsWith("hypernetizen/")) return "hypernetizen warez";
  if (r.startsWith("horizon/") || r === "horizon") return "horizon";
  if (r.startsWith("manifest/") || r === "manifest") return "manifest";
  if (r.startsWith("policies/") || r.includes("schema.keys") || r.endsWith(".schema.keys.v1"))
    return "policy / schema";
  if (r.startsWith("research/")) return "research";
  if (r.startsWith("sept/")) return "sept (legacy fly)";
  return "other";
}

const sorted = [...routes.keys()].sort((a, b) => a.localeCompare(b));
const byCat = new Map();
for (const r of sorted) {
  const c = category(r);
  if (!byCat.has(c)) byCat.set(c, []);
  byCat.get(c).push(r);
}

const catOrder = [
  "torus/native",
  "torus/hypernet (snowcone/popsicle)",
  "torus/testkit",
  "torus/systems (allenvethosp live index)",
  "torus/A_* (flowerpot_manifest)",
  "torus/devops attest / shield",
  "torus/devops token stashes",
  "devops docs",
  "hypercloud legacy mods",
  "hypercloud mod manifests",
  "hypercloud gadgets / testkit data",
  "opryland",
  "hypernetizen warez",
  "horizon",
  "manifest",
  "policy / schema",
  "research",
  "sept (legacy fly)",
  "torus catalogs (hostpark)",
  "other",
];

const out = {
  count: sorted.length,
  categories: Object.fromEntries(
    catOrder.filter((k) => byCat.has(k)).map((k) => [k, byCat.get(k).length])
  ),
  byCat: Object.fromEntries(catOrder.filter((k) => byCat.has(k)).map((k) => [k, byCat.get(k)])),
};

fs.writeFileSync(
  path.join(__dirname, "_flowerpot_routes_collected.json"),
  JSON.stringify(out, null, 2) + "\n"
);
console.log(`count: ${sorted.length}`);
console.log(JSON.stringify(out.categories, null, 2));

if (WRITE_HTML) {
  const sections = catOrder
    .filter((k) => byCat.has(k))
    .map((k) => {
      const items = byCat
        .get(k)
        .map((r) => `      <li><code>flowerpot/${r}</code></li>`)
        .join("\n");
      return `    <h2>${k}</h2>\n    <ul>\n${items}\n    </ul>`;
    })
    .join("\n\n");

  const html = `<div
  name="torus-flowerpot-catalog"
  data-path="torus/flowerpot-catalog"
  data-part="htmf"
>
  <article>
    <h1>Torus flowerpot catalog</h1>
    <p>
      Known flowerpot logical routes recorded locally
      (${sorted.length} unique). Listed as tip ibs under the
      <code>flowerpot/</code> prefix (surf/fetch
      <code>/flowerpot/&lt;route&gt;</code>).
    </p>
    <p>
      Sources: <code>A_devops/systems_pot_index</code>,
      <code>A_devops/flowerpot_manifest.json</code>,
      <code>_pot*.mjs</code> scripts, legacy mods dir,
      native README, snowcone/popsicle, attest/shield,
      warez, token stashes, deprecated notes.
      See also <a href="/torus/host-catalog" hx-get="/torus/host-catalog" hx-swap="outerHTML" hx-target="closest div[data-part='htmf']" hx-push-url="true">host catalog</a>.
    </p>

${sections}
  </article>
</div>
`;
  const htmlPath = path.join(__dirname, "torus_flowerpot_catalog.html");
  fs.writeFileSync(htmlPath, html);
  console.log(`wrote ${htmlPath}`);
}
