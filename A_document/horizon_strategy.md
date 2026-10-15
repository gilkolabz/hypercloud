# Horizon strategy

Design intent for Horizon Proscenium v1 — a stage-direction layout that turns JSON into an HTMX-swappable HTML fragment. The working implementation lives in [B_devops/horizon_imp/](../B_devops/horizon_imp/); this document mirrors that folder, not an earlier sketch.

---

## Core values

Horizon renders HTML fragments, not full documents. Foobarch wraps browser navigation in a shell (Navi + HTMX); page content arrives via swap and may replace itself the same way. See [foobarch/README.md](../foobarch/README.md).

We align with:

- HTMX as the delivery mechanism for hypermedia fragments
- Islands-style composition: distinct regions that load, swap, or stand alone
- Classical REST / HATEOAS: representations carry the controls for how they are used

Slot content is typed. Occupant type `href` is resolved at render time: the module GETs `https://foobarch.net/{path}` and inserts the response body raw into the stage column. Paths do not lead with `/`.

---

## Tooling map

Everything routes through foobarch. The first path segment is a proposal key; foobarch forwards to the backing service. Horizon talks to proposals on foobarch the same way any other client would — not to those codebases directly.

| Proposal | Role for Horizon |
|----------|------------------|
| flowerpot | Store and GET manifest JSON, `horizon_v1.js`, rendered fragments, hx-ref targets |
| mimex | Run the hyperuri chain (gather GETs, pass bodies stage to stage) |
| arbiter | One hop: path declares mime and op (`js.module.render`) |
| fusion | One hop: path is `fuse`; runs the module |

Entry points: [flowerpot/README.md](../flowerpot/README.md), [mimex/README.md](../mimex/README.md), [hyperuri.md](../hyperuri.md). Arbiter/fusion READMEs are operator internals for the chain we happen to use.

List live proposals: `curl foobarch.net/foobar/list` (or the foobarch API).

---

## Working hyperuri (testkit v1)

Four stages. Op is `js.module.render` with two blobs: manifest JSON (data) and `horizon_v1.js` (module). No separate template blob — markup lives in the module.

Browser-safe form (`/--/` between stages — see [hyperuri.md](../hyperuri.md)):

```
/mimex/fusion/fuse/--/arbiter/mime/text/html/op/js.module.render/--/flowerpot/hypercloud/horizon/testkit/v1/--/flowerpot/hypercloud/manifest/testkit/v1
```

Equivalent with `//` (fine for fetch/curl):

```
/mimex/fusion/fuse//arbiter/mime/text/html/op/js.module.render//flowerpot/hypercloud/horizon/testkit/v1//flowerpot/hypercloud/manifest/testkit/v1
```

Gather order (rightmost first): manifest → module → arbiter render → fusion fuse. Publish both Flowerpot routes before running the chain.

Local sources before publish:

- [B_devops/horizon_imp/data/](../B_devops/horizon_imp/data/) — manifest JSON fixtures
- [B_devops/horizon_imp/template/horizon_v1.js](../B_devops/horizon_imp/template/horizon_v1.js) — renderer module
- [B_devops/horizon_imp/scripts/local-render-test.mjs](../B_devops/horizon_imp/scripts/local-render-test.mjs) — local `render(data, '')` sanity check (not a pipeline test)
- [B_devops/horizon_imp/outputs/](../B_devops/horizon_imp/outputs/) — HTML from the local script

Flowerpot routes in the chain above: `hypercloud/horizon/testkit/v1` (module), `hypercloud/manifest/testkit/v1` (data).

---

## What we are building

A full-viewport column flex layout. Manifest keys name positions on stage; the module maps those names to flex regions and emits a fragment suitable for HTMX outerHTML swap. No `<head>` or `<body>` — self-contained markup plus inline layout styles.

Root element: `<div name="horizon/v1" …>`. Three bands top to bottom (Upstage, Stage, Downstage), each a row flex when occupied.

Authorial **content** fragments that land in those columns (Flowerpot HTML for foobarch) should avoid `id` — use `data-part` + `name`. Horizon’s own band/column placement attrs are a separate renderer concern; see [foobarch/README.md](../foobarch/README.md) § Writing Flowerpot / foobarch HTML fragments.

---

## Stage-direction vocabulary

Abbreviations are manifest keys. Omitted keys are not rendered as content (empty bands still emit a row shell; occupied bands use spacers — below).

| Key | Band | Meaning |
|-----|------|---------|
| USL, USC, USR | Upstage (top) | left / center / right |
| SL, CS, SR | Stage (middle) | Stage Left / Center Stage / Stage Right |
| DSL, DSC, DSR | Downstage (bottom) | left / center / right |

Band chrome ids in the HTML: `US`, `S`, `DS`. Band backgrounds are not authored in the manifest and not applied by the renderer.

### Arrays per direction

Each stage key is an array of occupant objects. A lone object is accepted and normalized to a one-element array. Empty arrays / omitted keys mean no content in that column.

Ordering within a column (as authored in JSON):

- Left columns (USL, SL, DSL): first in array is nearest center; last is furthest left. Renderer reverses left columns so visual order matches.
- Right columns (USR, SR, DSR): first nearest center; last furthest right.
- Center columns (USC, CS, DSC): left to right in array order.

### Row layout and spacers

Each occupied band is a three-column row (left / center / right), except left+right with no center — then only two children (no spacer).

Otherwise the module always emits three flex children, inserting empty spacer columns (`<div id="…" name="…" style="margin:auto"></div>`) where a key is missing. That keeps center centered and laterals in their regions when only one side is populated (e.g. DSC + DSR needs a DSL spacer).

Spacers are not authored in the manifest. They are structural markup from `horizon_v1.js` only.

---

## Data model

Top-level JSON: any stage keys that have content. Each occupant is a typed object. Implemented kinds:

- **href** — `{ "type": "href", "value": "flowerpot/…" }` (path, no leading `/`). Module fetches `FOOBARCH_BASE` + `/` + path and places the body raw.
- **data** — `{ "type": "data", "value": "<html…>" }`. Module punches `value` into the column as raw HTML (no escape). Prefer producing this via `data_to_stagedir` so `JSON.stringify` escapes quotes in the stored JSON.

Minimal demo (matches `manifest_test_1.json`):

```json
{
  "SL": [{ "type": "href", "value": "flowerpot/manifest/testkit/v1/sample_a" }],
  "CS": [{ "type": "href", "value": "flowerpot/manifest/testkit/v1/sample_b" }],
  "SR": [{ "type": "href", "value": "flowerpot/manifest/testkit/v1/sample_c" }]
}
```

Sample fragment bodies live at `flowerpot/manifest/testkit/v1/sample_{a…g}` (raw styled HTML tags). Fixtures: `manifest_test_1` (three hrefs), `manifest_test_2` (full stage), `manifest_test_3` (spacer cases).

---

## Render layer

Two authored artifacts: manifest JSON and `horizon_v1.js`. No template HTML file.

- Module exports async `render(data, _template)`; template arg unused (two-blob `js.module.render`).
- `FOOBARCH_BASE` is set at the top of the module (`https://foobarch.net`).
- Layout, spacers, column ordering, and typed occupant dispatch live in the module.
- Placement attrs: each band and column gets `id` + `name` (e.g. `id="SL" name="Stage Left"`).

`js.literal` was rejected: one template-literal blob cannot hold stage-direction logic and spacer rules cleanly.

Local check:

```bash
node B_devops/horizon_imp/scripts/local-render-test.mjs
```

---

## End-to-end flow

1. Author / edit manifest + `horizon_v1.js` under `B_devops/horizon_imp/`.
2. Publish module and manifest to the Flowerpot testkit routes above.
3. GET the mimex hyperuri (browser form with `/--/` or fetch with `//`).
4. Response is the HTML fragment; foobarch shell can swap it via HTMX.

---

## Related

- [hyperuri.md](../hyperuri.md) — `//` and `/--/` stage delimiters, mimex invocation
- [B_devops/horizon_imp/](../B_devops/horizon_imp/) — canonical implementation and fixtures
- [mimex/README.md](../mimex/README.md) — pipeline gather semantics
