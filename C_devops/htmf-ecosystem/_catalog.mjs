/**
 * Hostpark catalog for the docs HTMFs.
 * Edit slugs here; *.html in this folder are hand-maintained sources.
 */
export const ECOSYSTEM_PREFIX = "torus/docs";

/** slug → repo path (under hypercloud root) — for _bootstrap.mjs only */
export const ECOSYSTEM_SOURCES = {
  hostparking: "A_document/hostparking.md",
  "foobarch-usage-budgets": "A_document/foobarch_usage_budgets.md",
  "navi-style": "A_document/_navi_style.md",
  "style-refinement": "A_document/_style_refinement.md",
  "navi-shell": "navi_shell/README.md",
  "navi-modules-guide": "navi_shell/docs/navi_modules_guide.md",
  "navi-units": "A_document/navi_units.html",
  manifest: "A_document/manifest.md",
  "navi-park-addressing": "A_document/navi_park_addressing.md",
};

export const ECOSYSTEM_SLUGS = [
  "readme",
  "hostparking",
  "foobarch-usage-budgets",
  "navi-style",
  "style-refinement",
  "navi-shell",
  "navi-modules-guide",
  "navi-units",
  "manifest",
  "navi-park-addressing",
];

export function ecosystemAsset(slug) {
  return {
    ib: `${ECOSYSTEM_PREFIX}/${slug}`,
    path: `C_devops/htmf-ecosystem/${slug}.html`,
    content_type: "text/html; charset=utf-8",
    gate: true,
  };
}

export const ECOSYSTEM_HTMF_ASSETS = ECOSYSTEM_SLUGS.map(ecosystemAsset);
