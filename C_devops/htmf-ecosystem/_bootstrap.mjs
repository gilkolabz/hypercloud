/**
 * ONE-TIME bootstrap: wrap repo sources into *.html in this folder.
 * Outputs are canonical — do not re-run unless intentionally refreshing from source.
 *
 *   node C_devops/htmf-ecosystem/_bootstrap.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FLOW_MODEL_PREFIX } from "../flow-model-docs/_catalog.mjs";
import { ECOSYSTEM_PREFIX, ECOSYSTEM_SOURCES } from "./_catalog.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const OUT_DIR = __dirname;

const TITLES = {
  hostparking: "Hostparking",
  "navi-style": "Navi devops style",
  "style-refinement": "Style refinement notes",
  "navi-shell": "navi_shell",
  "navi-modules-guide": "Navi modules guide",
  "navi-units": "navi units",
};

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function mdToArticleBody(md) {
  const lines = String(md).replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let inPre = false;
  let listType = null;

  const flushList = () => {
    if (listType) {
      out.push(listType === "ol" ? "</ol>" : "</ul>");
      listType = null;
    }
  };

  const inline = (s) =>
    String(s)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text, href) => {
        if (/^https?:\/\//i.test(href)) {
          return `<a href="${href}">${text}</a>`;
        }
        if (href.startsWith("/torus/")) {
          return `<a href="${href}">${text}</a>`;
        }
        if (href.startsWith("../../") || href.includes("A_document/") || href.includes("navi_shell/")) {
          return `<code>${text}</code>`;
        }
        return `<a href="${href}">${text}</a>`;
      });

  for (const raw of lines) {
    const line = raw;
    if (line.startsWith("```")) {
      flushList();
      if (!inPre) {
        inPre = true;
        out.push("<pre><code>");
      } else {
        inPre = false;
        out.push("</code></pre>");
      }
      continue;
    }
    if (inPre) {
      out.push(escapeHtml(line));
      continue;
    }
    if (!line.trim()) {
      flushList();
      continue;
    }
    if (/^#{1,6}\s/.test(line)) {
      flushList();
      const level = Math.min(line.match(/^#+/)[0].length, 4);
      const text = inline(line.replace(/^#+\s*/, ""));
      out.push(`<h${level}>${text}</h${level}>`);
      continue;
    }
    if (/^\d+\.\s/.test(line)) {
      if (listType !== "ol") {
        flushList();
        listType = "ol";
        out.push("<ol>");
      }
      out.push(`<li>${inline(line.replace(/^\d+\.\s+/, ""))}</li>`);
      continue;
    }
    if (/^[-*]\s/.test(line)) {
      if (listType !== "ul") {
        flushList();
        listType = "ul";
        out.push("<ul>");
      }
      out.push(`<li>${inline(line.replace(/^[-*]\s+/, ""))}</li>`);
      continue;
    }
    if (/^\|.+\|$/.test(line.trim())) {
      flushList();
      out.push(`<p>${inline(line)}</p>`);
      continue;
    }
    flushList();
    out.push(`<p>${inline(line)}</p>`);
  }
  flushList();
  if (inPre) out.push("</code></pre>");
  return out.join("\n    ");
}

function extractBodyFromHtml(html) {
  const m = String(html).match(/<body[^>]*>([\s\S]*)<\/body>/i);
  return m ? m[1].trim() : String(html).trim();
}

function wrapEcosystem(slug, title, bodyHtml) {
  const navEcosystem = ECOSYSTEM_SLUGS.map((s) => {
    const label = TITLES[s] || s;
    const active = s === slug ? ' aria-current="page"' : "";
    return `<a href="/${ECOSYSTEM_PREFIX}/${s}"${active}>${label}</a>`;
  }).join("\n      ");

  return `<div
  name="ecosystem-${slug}"
  data-path="${ECOSYSTEM_PREFIX}/${slug}"
  data-part="htmf"
  class="ecosystem-doc"
  style="max-width:52rem;font:15px/1.5 system-ui,sans-serif;padding:1rem;box-sizing:border-box;"
>
  <style>
    .ecosystem-doc nav { display:flex; flex-wrap:wrap; gap:0.35rem 0.75rem; margin:0 0 1rem; padding-bottom:0.75rem; border-bottom:1px solid #ccc; font-size:0.9rem; }
    .ecosystem-doc nav a { color:#06c; text-decoration:none; }
    .ecosystem-doc nav a[aria-current="page"] { font-weight:600; color:#000; }
    .ecosystem-doc pre { background:#f6f6f6; padding:0.75rem; overflow:auto; font-size:0.85rem; }
    .ecosystem-doc code { font-family:ui-monospace,monospace; font-size:0.9em; }
    .ecosystem-doc h1 { font-size:1.6rem; margin:0 0 0.75rem; }
    .ecosystem-doc h2 { font-size:1.25rem; margin:1.25rem 0 0.5rem; }
    .ecosystem-doc h3 { font-size:1.05rem; margin:1rem 0 0.35rem; }
    .ecosystem-doc h4 { font-size:1rem; margin:0.85rem 0 0.3rem; }
    .ecosystem-doc p, .ecosystem-doc li { margin:0.35rem 0; }
    .ecosystem-doc ul, .ecosystem-doc ol { margin:0.35rem 0 0.35rem 1.25rem; }
    .ecosystem-doc .back { margin:0 0 1rem; font-size:0.9rem; }
  </style>
  <p class="back"><a href="/${FLOW_MODEL_PREFIX}/readme">← flow-model index</a></p>
  <nav aria-label="ecosystem docs">
      ${navEcosystem}
  </nav>
  <article>
    ${bodyHtml}
  </article>
</div>
`;
}

const ECOSYSTEM_SLUGS = Object.keys(ECOSYSTEM_SOURCES);

fs.mkdirSync(OUT_DIR, { recursive: true });

for (const slug of ECOSYSTEM_SLUGS) {
  const rel = ECOSYSTEM_SOURCES[slug];
  const srcPath = path.join(ROOT, rel);
  const raw = fs.readFileSync(srcPath, "utf8");
  const title = TITLES[slug] || slug;
  const body =
    slug === "navi-units"
      ? extractBodyFromHtml(raw)
      : mdToArticleBody(raw);
  const html = wrapEcosystem(slug, title, body);
  const out = path.join(OUT_DIR, `${slug}.html`);
  fs.writeFileSync(out, html, "utf8");
  console.log(`wrote ${out}`);
}
