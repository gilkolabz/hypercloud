/**
 * Reformat flow-model + ecosystem HTMFs: bare HTML, real tables, top nav, no CSS.
 *   node C_devops/flow-model-docs/_reformat-htmf.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FLOW_MODEL_PREFIX, FLOW_MODEL_SLUGS } from "./_catalog.mjs";
import { ECOSYSTEM_PREFIX, ECOSYSTEM_SOURCES } from "../htmf-ecosystem/_catalog.mjs";
import { sanitizeParkHtml } from "../htmf-ecosystem/_sanitize.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const FLOW_HTMF = path.join(__dirname, "htmf");
const ECO_HTMF = path.join(ROOT, "C_devops/htmf-ecosystem");

const FLOW_MD = [
  ["README.md", "readme"],
  ["overview.md", "overview"],
  ["runtime.md", "runtime"],
  ["flow-artifacts.md", "flow-artifacts"],
  ["manager.md", "manager"],
  ["composition.md", "composition"],
  ["variants.md", "variants"],
  ["addressing.md", "addressing"],
  ["ux-spectrum.md", "ux-spectrum"],
  ["authoring.md", "authoring"],
  ["ethos.md", "ethos"],
  ["glossary.md", "glossary"],
];

const ECO_LABELS = {
  readme: "index",
  hostparking: "hostparking",
  "navi-style": "navi-style",
  "style-refinement": "style-refinement",
  "navi-shell": "navi-shell",
  "navi-modules-guide": "navi-modules-guide",
  "navi-units": "navi-units",
};

const ECO_SLUGS = ["readme", ...Object.keys(ECOSYSTEM_SOURCES)];

const ECO_HREF = {
  "../../navi_shell/README.md": "/torus/docs/navi-shell",
  "../../navi_shell/docs/navi_modules_guide.md": "/torus/docs/navi-modules-guide",
  "../../A_document/_navi_style.md": "/torus/docs/navi-style",
  "../../A_document/_style_refinement.md": "/torus/docs/style-refinement",
  "../../A_document/hostparking.md": "/torus/docs/hostparking",
  "../../A_document/navi_units.html": "/torus/docs/navi-units",
  "navi_modules_guide.md": "/torus/docs/navi-modules-guide",
  "_navi_style.md": "/torus/docs/navi-style",
  "_style_refinement.md": "/torus/docs/style-refinement",
};

function slugFromMdLink(href) {
  const base = path.basename(String(href || "").split("#")[0]);
  if (!base) return "";
  if (base === "README.md") return "readme";
  return base.replace(/\.md$/i, "").replace(/\.html$/i, "");
}

function resolveHref(href) {
  if (/^https?:\/\//i.test(href)) return href;
  if (href.startsWith("/torus/")) return href;
  if (href.startsWith("../") || href.includes("C_devops/")) return null;
  if (ECO_HREF[href]) return ECO_HREF[href];
  const target = slugFromMdLink(href);
  if (href.startsWith("../../") || href.includes("A_document/") || href.includes("navi_shell/")) {
    for (const [k, v] of Object.entries(ECO_HREF)) {
      if (href.includes(k.replace("../", "")) || href.endsWith(k.split("/").pop())) return v;
    }
    return null;
  }
  if (target && !href.startsWith("../")) {
    return `/${FLOW_MODEL_PREFIX}/${target}`;
  }
  return null;
}

function linkLabel(text, href, resolved) {
  let label = text.replace(/\.md$/i, "").replace(/\.html$/i, "");
  if (label.includes("/") || label.includes("A_document") || label.includes("navi_shell")) {
    label = resolved.split("/").filter(Boolean).pop() || label;
  }
  return label;
}

/**
 * Same-origin park HTMF link: hx outerHTML swap of the page root + push URL.
 * Matches gadgets/sphere HTMF style; hx-push-url true so the address bar tracks
 * the park (surf itself does not push history — that's for in-app flow steps).
 */
function parkLink(href, label, { current = false } = {}) {
  const cur = current ? ' aria-current="page"' : "";
  if (/^https?:\/\//i.test(href)) {
    return `<a href="${href}"${cur}>${label}</a>`;
  }
  return (
    `<a href="${href}" hx-get="${href}" hx-swap="outerHTML" ` +
    `hx-target="closest div[data-part='htmf']" hx-push-url="true"${cur}>${label}</a>`
  );
}

function inline(s) {
  return String(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text, href) => {
      const resolved = resolveHref(href);
      if (!resolved) return `<code>${text}</code>`;
      return parkLink(resolved, linkLabel(text, href, resolved));
    });
}

function parseTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

function isTableSep(line) {
  return /^\|[\s\-:|]+\|$/.test(line.trim());
}

function mdToArticle(md) {
  const lines = String(md).replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let inPre = false;
  let listType = null;
  let para = [];

  const flushPara = () => {
    if (!para.length) return;
    out.push(`<p>${inline(para.join(" "))}</p>`);
    para = [];
  };

  const flushList = () => {
    flushPara();
    if (listType) {
      out.push(listType === "ol" ? "</ol>" : "</ul>");
      listType = null;
    }
  };

  const flushTable = (rows) => {
    flushList();
    if (!rows.length) return;
    const [head, ...body] = rows;
    out.push("<table>");
    out.push("<thead><tr>" + head.map((c) => `<th>${inline(c)}</th>`).join("") + "</tr></thead>");
    out.push("<tbody>");
    for (const row of body) {
      out.push("<tr>" + row.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>");
    }
    out.push("</tbody></table>");
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("```")) {
      flushList();
      if (!inPre) {
        inPre = true;
        const lang = line.slice(3).trim();
        out.push(lang ? `<pre><code class="${lang}">` : "<pre><code>");
      } else {
        inPre = false;
        out.push("</code></pre>");
      }
      i++;
      continue;
    }
    if (inPre) {
      out.push(line.replace(/</g, "&lt;").replace(/>/g, "&gt;"));
      i++;
      continue;
    }

    if (line.trim() === "---") {
      flushList();
      i++;
      continue;
    }

    if (/^\|.+\|$/.test(line.trim())) {
      const tableRows = [];
      while (i < lines.length && /^\|.+\|$/.test(lines[i].trim())) {
        if (!isTableSep(lines[i])) tableRows.push(parseTableRow(lines[i]));
        i++;
      }
      flushTable(tableRows);
      continue;
    }

    if (!line.trim()) {
      flushList();
      i++;
      continue;
    }

    if (/^#{1,6}\s/.test(line)) {
      flushList();
      const level = Math.min(line.match(/^#+/)[0].length, 4);
      out.push(`<h${level}>${inline(line.replace(/^#+\s*/, ""))}</h${level}>`);
      i++;
      continue;
    }

    if (/^\d+\.\s/.test(line)) {
      flushPara();
      if (listType !== "ol") {
        flushList();
        listType = "ol";
        out.push("<ol>");
      }
      out.push(`<li>${inline(line.replace(/^\d+\.\s+/, ""))}</li>`);
      i++;
      continue;
    }

    if (/^[-*]\s/.test(line)) {
      flushPara();
      if (listType !== "ul") {
        flushList();
        listType = "ul";
        out.push("<ul>");
      }
      out.push(`<li>${inline(line.replace(/^[-*]\s+/, ""))}</li>`);
      i++;
      continue;
    }

    para.push(line.trim());
    i++;
  }
  flushList();
  if (inPre) out.push("</code></pre>");
  return out.join("\n    ");
}

function flowNav(current) {
  const links = FLOW_MODEL_SLUGS.map((s) => {
    const label = s === "readme" ? "index" : s;
    return parkLink(`/${FLOW_MODEL_PREFIX}/${s}`, label, {
      current: s === current,
    });
  });
  links.push(parkLink(`/${ECOSYSTEM_PREFIX}/readme`, "docs"));
  return links.join("\n    ");
}

function ecoNav(current) {
  const links = ECO_SLUGS.map((s) => {
    const label = ECO_LABELS[s] || s;
    return parkLink(`/${ECOSYSTEM_PREFIX}/${s}`, label, {
      current: s === current,
    });
  });
  return links.join("\n    ");
}

function wrapFlow(slug, article) {
  return `<div
  name="flow-model-${slug}"
  data-path="${FLOW_MODEL_PREFIX}/${slug}"
  data-part="htmf"
>
  <nav aria-label="flow-model">
    ${flowNav(slug)}
  </nav>
  <article>
    ${article}
  </article>
</div>
`;
}

function wrapEco(slug, article) {
  const related = /<h2>Related<\/h2>/.test(article)
    ? ""
    : `\n    <p>Related: ${parkLink(`/${FLOW_MODEL_PREFIX}/readme`, "flow-model")}.</p>`;
  return `<div
  style="box-sizing:border-box;max-height:min(100vh,100dvh);overflow:auto;"
  name="docs-${slug}"
  data-path="${ECOSYSTEM_PREFIX}/${slug}"
  data-part="htmf"
>
  <nav aria-label="docs">
    ${ecoNav(slug)}
  </nav>
  <article>
    ${article}${related}
  </article>
</div>
`;
}

function hostparkingArticle() {
  return `
    <h1>Hostparking</h1>
    <p><strong>Hostparking</strong> is publishing a local asset to a foobarch host as a <strong>park tip</strong> — a route whose <code>ib^gib</code> frame the host serves directly, so a plain HTTP GET to that route returns the parked bytes instead of proxying elsewhere.</p>
    <p>Where the browser shell's <code>navi.park.check</code> wins locally (a planted tip beats the network for that path), hostparking is the same idea on the <strong>server</strong>: the host holds the tip and answers <code>/{ib}</code> from it. Publishing (or updating) a parked asset is a tip <strong>commit</strong> — a new generation (<code>mut8</code>) whose <code>data</code> describes the route and whose <code>rel8ns.bin</code> points at the content bytes.</p>
    <h2>How it works</h2>
    <p>Each publish is a signed write under a <strong>write-gate identity</strong>:</p>
    <ol>
      <li><strong>Schema</strong> — Lua <code>keys.v1</code> write gate (ed25519 m-of-n), seeded once.</li>
      <li><strong>Policy</strong> — keys policy tip (<code>{ threshold, keys }</code>) linked under that schema and self-locked.</li>
      <li><strong>Asset commit</strong> — <code>network_proposal</code> frame with <code>data.method.GET = { kind: "bin" }</code>, <code>rel8ns.bin</code> pointing at content bytes; signed PUT to <code>/{ib}</code>. First write is <code>firstGen</code>; later writes are <code>mut8</code> with <code>rel8ns.past</code>.</li>
    </ol>
    <p>The host stores the frame and bin and indexes the route as a park. A GET to <code>/{ib}</code> returns the bin with the declared <code>content_type</code>.</p>
    <p>Asset catalog: <code>C_devops/identity/_lib.mjs</code>. Publisher: <code>C_devops/identity/_publish.mjs</code>.</p>
    <h2>Hostparking navi_shell</h2>
    <p>Publish built shell assets (<code>navi_shell.js</code>, <code>sw.js</code>) to a foobarch host.</p>
    <h3>Build</h3>
    <pre><code>cd navi_shell
npm run build</code></pre>
    <h3>Park</h3>
    <pre><code>node C_devops/identity/_publish.mjs --yes navi_shell.js
node C_devops/identity/_publish.mjs --yes sw.js</code></pre>
    <p>Set <code>FOOBARCH_HOST</code> to target the live host before publishing.</p>
    <h3>Notes</h3>
    <ul>
      <li>Owner keystores (<code>*_owner.json</code>) are gitignored.</li>
      <li>After parking a new <code>sw.js</code>, reload once so the browser fetches the new worker.</li>
    </ul>
  `.trim();
}

function ecosystemIndexArticle() {
  const p = (slug, label = slug) =>
    parkLink(`/${ECOSYSTEM_PREFIX}/${slug}`, label);
  return `
    <h1>Documentation</h1>
    <p>Cross-cutting foobarch / navi references.</p>
    <h2>Pages</h2>
    <table>
      <thead>
        <tr><th>Park</th><th>Topic</th></tr>
      </thead>
      <tbody>
        <tr><td>${p("hostparking")}</td><td>Publish assets as park tips on a foobarch host</td></tr>
        <tr><td>${p("navi-style")}</td><td>Devops style of the foobarch/navi framework</td></tr>
        <tr><td>${p("style-refinement")}</td><td>Accumulated clarifications from project work</td></tr>
        <tr><td>${p("navi-shell")}</td><td>Runtime affordances</td></tr>
        <tr><td>${p("navi-modules-guide")}</td><td>Module and park contract</td></tr>
        <tr><td>${p("navi-units")}</td><td>Multi-instance tip space (entry-plug); out of scope for most flow products</td></tr>
      </tbody>
    </table>
    <h2>Related</h2>
    <ul>
      <li>${parkLink(`/${FLOW_MODEL_PREFIX}/readme`, "flow-model index")}</li>
      <li>${parkLink("/torus/testkit/mod/fsdevopstracker/readme", "fsdevopstracker readme")} — flow-model devops tooling</li>
    </ul>
  `.trim();
}

function flowReadmeArticle() {
  const p = (slug, label = slug) =>
    parkLink(`/${FLOW_MODEL_PREFIX}/${slug}`, label);
  return `
    <h1>Flow model documentation</h1>
    <p>The flow model is how foobarch / navi_shell products express user journeys: which screen comes next, what context carries forward, and how alternative journeys stay publishable and swappable without forking core logic.</p>
    <p>Assumes current navi_shell: tip+bin storage, park callin, <code>navi:mod</code> remount, <strong>hostpark</strong> as default push host, <strong>local-first</strong> plant/park-check. Shell units / entry-plug are out of scope for flow products (one session per navi window).</p>
    <h2>Who this is for</h2>
    <p>Anyone publishing modules, HTML fragments, flow JSON, and launches onto hostpark and running them inside the navi shell.</p>
    <h2>Doc map</h2>
    <table>
      <thead>
        <tr><th>Page</th><th>Summary</th></tr>
      </thead>
      <tbody>
        <tr><td>${p("overview")}</td><td>What the flow model is and is not</td></tr>
        <tr><td>${p("runtime")}</td><td>foobarch shell, tips/parks, surf, hostpark push</td></tr>
        <tr><td>${p("flow-artifacts")}</td><td>Flow JSON: entry, routes, policy, meta</td></tr>
        <tr><td>${p("manager")}</td><td>Thin Manager, session tips, navigation contract</td></tr>
        <tr><td>${p("composition")}</td><td>Features → artifacts → instances → programs → launches</td></tr>
        <tr><td>${p("variants")}</td><td>Variance records, swapping, shopping, builders</td></tr>
        <tr><td>${p("addressing")}</td><td>Typed ids, logical routes, hostpark addr vs tip frame</td></tr>
        <tr><td>${p("ux-spectrum")}</td><td>L0–Ln placement of concerns</td></tr>
        <tr><td>${p("authoring")}</td><td>How to author a program</td></tr>
        <tr><td>${p("ethos")}</td><td>Principles and anti-patterns</td></tr>
        <tr><td>${p("glossary")}</td><td>Shared vocabulary (navi_shell terms win)</td></tr>
      </tbody>
    </table>
    <h2>Documentation</h2>
    <p>See ${parkLink(`/${ECOSYSTEM_PREFIX}/readme`, "docs")} for navi_shell, hostparking, style guides, and modules reference.</p>
    <h2>Devops tooling</h2>
    <p>${parkLink("/torus/testkit/mod/fsdevopstracker/readme", "fsdevopstracker readme")} — index projects, goals/sprints, mirror, hostpark-push.</p>
  `.trim();
}

function extractBodyFromHtml(html) {
  const m = String(html).match(/<article[^>]*>([\s\S]*)<\/article>/i);
  if (m) return m[1].trim();
  const b = String(html).match(/<body[^>]*>([\s\S]*)<\/body>/i);
  return b ? b[1].trim() : String(html).trim();
}

// flow-model pages
fs.mkdirSync(FLOW_HTMF, { recursive: true });
for (const [mdName, slug] of FLOW_MD) {
  let article;
  if (slug === "readme") {
    article = flowReadmeArticle();
  } else {
    const md = fs.readFileSync(path.join(__dirname, mdName), "utf8");
    article = mdToArticle(md);
  }
  const out = path.join(FLOW_HTMF, `${slug}.html`);
  fs.writeFileSync(out, wrapFlow(slug, article), "utf8");
  console.log(`flow-model ${out}`);
}

// ecosystem index
fs.mkdirSync(ECO_HTMF, { recursive: true });
fs.writeFileSync(
  path.join(ECO_HTMF, "readme.html"),
  wrapEco("readme", ecosystemIndexArticle()),
  "utf8"
);
console.log("ecosystem readme");

for (const [slug, rel] of Object.entries(ECOSYSTEM_SOURCES)) {
  if (slug === "navi-style") {
    console.log("ecosystem skip navi-style (hand-maintained)");
    continue;
  }
  const srcPath = path.join(ROOT, rel);
  const raw = fs.readFileSync(srcPath, "utf8");
  let article;
  if (slug === "hostparking") {
    article = hostparkingArticle();
  } else if (slug === "navi-units") {
    article = extractBodyFromHtml(raw);
  } else {
    article = sanitizeParkHtml(mdToArticle(raw));
  }
  const out = path.join(ECO_HTMF, `${slug}.html`);
  fs.writeFileSync(out, wrapEco(slug, article), "utf8");
  console.log(`ecosystem ${out}`);
}

/** Upgrade plain same-origin park <a href> → hx outerHTML + push-url (idempotent). */
function upgradeParkAnchors(html) {
  return String(html).replace(
    /<a\s+href="(\/[^"]+)"([^>]*)>/gi,
    (full, href, rest) => {
      if (/\bhx-get\s*=/.test(rest) || /\bhx-get\s*=/.test(full)) return full;
      if (/^https?:\/\//i.test(href)) return full;
      return (
        `<a href="${href}" hx-get="${href}" hx-swap="outerHTML" ` +
        `hx-target="closest div[data-part='htmf']" hx-push-url="true"${rest}>`
      );
    }
  );
}

// Hand-maintained HTMFs: refresh nav/body park links without rewriting content.
for (const file of [
  path.join(ECO_HTMF, "navi-style.html"),
  path.join(ROOT, "C_devops/fragment/torus_host_catalog.html"),
  path.join(ROOT, "C_devops/fragment/torus_flowerpot_catalog.html"),
  path.join(ROOT, "C_devops/fragment/navi_fsdevopstracker_readme.html"),
]) {
  if (!fs.existsSync(file)) continue;
  const before = fs.readFileSync(file, "utf8");
  const after = upgradeParkAnchors(before);
  if (after !== before) {
    fs.writeFileSync(file, after, "utf8");
    console.log(`upgrade anchors ${file}`);
  }
}
