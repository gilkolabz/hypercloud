/**
 * Seed (or refresh) selected ecosystem HTMFs from ECOSYSTEM_SOURCES.
 * Does not touch hand-maintained pages outside the filter list.
 *
 *   node C_devops/htmf-ecosystem/_seed_slugs.mjs manifest navi-park-addressing
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ECOSYSTEM_PREFIX, ECOSYSTEM_SLUGS, ECOSYSTEM_SOURCES } from "./_catalog.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

const TITLES = {
  readme: "index",
  hostparking: "hostparking",
  "foobarch-usage-budgets": "foobarch-usage-budgets",
  "navi-style": "navi-style",
  "style-refinement": "style-refinement",
  "navi-shell": "navi-shell",
  "navi-modules-guide": "navi-modules-guide",
  "navi-units": "navi-units",
  manifest: "manifest",
  "navi-park-addressing": "navi-park-addressing",
};

const filters = process.argv.slice(2).filter((a) => !a.startsWith("-"));
if (!filters.length) {
  console.log("usage: node _seed_slugs.mjs <slug> [slug…]");
  process.exit(0);
}

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
        if (/^https?:\/\//i.test(href) || href.startsWith("/torus/")) {
          return `<a href="${href}">${text}</a>`;
        }
        if (
          href.startsWith("./") ||
          href.startsWith("../") ||
          href.includes("A_document/") ||
          href.includes("navi_shell/") ||
          href.endsWith(".md") ||
          href.endsWith(".html")
        ) {
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

function hxLink(slug, current) {
  const label = TITLES[slug] || slug;
  const href = `/${ECOSYSTEM_PREFIX}/${slug}`;
  const cur = slug === current ? ' aria-current="page"' : "";
  return `<a href="${href}" hx-get="${href}" hx-swap="outerHTML" hx-target="closest div[data-part='htmf']" hx-push-url="true"${cur}>${label}</a>`;
}

function wrap(slug, bodyHtml) {
  const nav = ECOSYSTEM_SLUGS.map((s) => hxLink(s, slug)).join("\n    ");
  const related = `<p>Related: <a href="/torus/devops/flow-model/readme" hx-get="/torus/devops/flow-model/readme" hx-swap="outerHTML" hx-target="closest div[data-part='htmf']" hx-push-url="true">flow-model</a>.</p>`;
  return `<div
  style="box-sizing:border-box;max-height:min(100vh,100dvh);overflow:auto;"
  name="docs-${slug}"
  data-path="${ECOSYSTEM_PREFIX}/${slug}"
  data-part="htmf"
>
  <nav aria-label="docs">
    ${nav}
  </nav>
  <article>
    ${bodyHtml}
    ${related}
  </article>
</div>
`;
}

for (const slug of filters) {
  const rel = ECOSYSTEM_SOURCES[slug];
  if (!rel) {
    console.error(`unknown or non-sourced slug: ${slug}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(path.join(ROOT, rel), "utf8");
  const body = /\.html$/i.test(rel)
    ? extractBodyFromHtml(raw)
    : mdToArticleBody(raw);
  const out = path.join(__dirname, `${slug}.html`);
  fs.writeFileSync(out, wrap(slug, body), "utf8");
  console.log(`wrote ${out}`);
}
