/**
 * Hostpark catalog for flow-model HTMFs.
 * Edit slugs here; htmf/*.html are hand-maintained sources (not synced from *.md).
 */
export const FLOW_MODEL_PREFIX = "torus/devops/flow-model";

export const FLOW_MODEL_SLUGS = [
  "readme",
  "overview",
  "runtime",
  "flow-artifacts",
  "manager",
  "composition",
  "variants",
  "program-manifest",
  "reiteration",
  "addressing",
  "ux-spectrum",
  "authoring",
  "devops-goals",
  "ethos",
  "glossary",
];

export function flowModelAsset(slug) {
  return {
    ib: `${FLOW_MODEL_PREFIX}/${slug}`,
    path: `C_devops/flow-model-docs/htmf/${slug}.html`,
    content_type: "text/html; charset=utf-8",
    gate: true,
  };
}

export const FLOW_MODEL_HTMF_ASSETS = FLOW_MODEL_SLUGS.map(flowModelAsset);
