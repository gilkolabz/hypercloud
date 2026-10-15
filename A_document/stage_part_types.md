# Stage part types & contexts

Informational Flowerpot tip (intended route: `torus/devops/docs/stage_part_types`).

Vague manifests are tagged JSON — general idea in [manifest.md](manifest.md).
This file is the stage / occupant / rootproofer *cases* detail. Software that
cares reads `parts` and/or per-occupant `type`. Nothing enforces a global
schema — each context affords different features.

---

## Document-level `parts`

Common tags on a whole JSON document. Order matters: leftmost is most specific;
generic tails (`manifest`, `json`) sit on the right — same habit as
`["stage_dir","manifest","json"]` and `["ibgib_frame","manifest","json"]`.

- `stage_dir` — 3×3 stage map (USL…DSR slot keys); Horizon, `horizon_stagedir`, stagejockey
- `module_sidecar` — sidecar for a module tip (subject + attestation); rootproofer
- `attestation` — carries or is about cryptographic attestation; rootproofer / shield
- `identity` — discovery doc for a signing identity (pubkey, nickname); rootproofer
- `ibgib_frame` — raw flowerpot frame-shaped object; potter_gibbert
- `manifest` — tagged vague JSON, not a specific layout (generic / jockey)
- `json` — payload is JSON-shaped (soft hint)

Example stage_dir declaration:

```json
{ "parts": ["stage_dir", "manifest", "json"], "CS": [ /* occupants */ ] }
```

Rootproofer sidecar: `["module_sidecar", "attestation", "manifest", "json"]`.
Identity: `["identity", "manifest", "json"]`.

Legacy: some stage maps omit `parts` and are still treated as stage_dir if they
have slot keys and no conflicting parts list (`horizon_v1` / `horizon_stagedir`).

---

## Occupant `type` (stage_dir slots)

Each slot value is an array of occupant objects `{ "type", "value", … }`.

### Horizon render (`horizon_v1` / `js.module.render`)

- `text` — escape and wrap in a stamped `<span data-part="text">`
- `href` — GET foobarch + path (no leading `/`); insert body; stamp `data-part="htmf"` + `data-path="<route>"` (never `data-part="href"`; passthrough if already stamped)
- `html` — punch `value` as markup (same path as data)
- `data` — punch `value` as markup (raw HTML inside JSON — usually produced via `data_to_stagedir`)
- custom / other / missing — punch markup from `value` / `data` / `html`; stamp `data-part` when type is set

Horizon does not execute scripts specially beyond what the returned HTML already
contains after foobarch/HTMX handling. `href` is fetch-at-render-time; the live
DOM part name after stamp is `htmf`, with the route on `data-path`.

### Live stage (`horizon_stagedir` navi module)

Works on already-rendered DOM occupants (move / add / preset). It loads
stage_dir JSON to repaint; it does not re-interpret every occupant type the way
Horizon does on first render. Presets store stage_dir manifests in
`navi.storage`.

### Stagejockey / casting

- `offstage-member` — scrollbuffer / prep — not yet placed on stage
- `stage-member` — claimed for / on stage
- occupant `href` / `text` / other — cast from unbound parts into `offstage-member` wrappers
- `draggemdiv` — live drag chrome around HTML (`supermouse_plugin_draggem_div` /
  `stage_draggem`). Free-float (dropdown path) uses `surf.persist` and survives
  stage surfs; stage-member wraps do **not** persist and leave with the stage.
  +1 wrap / −1 unwrap via jockey `stage_draggem`.

Plugins (`stage_casting`, `jockey_move`, `tabletop_render`, …) decide menus from
these types. Affordance is plugin-local.

### Live members (`data-stage-live`, `stage-dirty`)

A stage member normally saves the markup it had when it was staged. A member that
is (or contains) `data-stage-live` saves its **current** `outerHTML` instead, and
any element on stage can fire a bubbling `stage-dirty` event to have the live slot
re-saved (debounced). Elements keep their own state in attributes and restore it on
load, e.g. the YouTube player's `data-yt-t` / `data-yt-vol` / `data-yt-muted` /
`data-yt-state`; `stagedir publish` then hostparks that state too.

### Stageable objects (`data-stageable`)

Any offstage element marked `data-stageable` is a launcher for `jockey_move`:
**left-click** it and the 3×3 grid opens; pick a spot and it goes on stage. Stagejockey
right-click → **move onstage** does the same (the nearest `data-stageable` or htmf
ancestor wins, so a stageable inside an htmf is staged on its own).

| Attribute | Meaning |
|-----------|---------|
| `data-stageable` / `="self"` | stage the element itself |
| `data-stageable="span"` (or `div`, `section`, `figure`) | stage a new `<span data-part="htmf">` holding the content |
| `<template data-stageable-content>` | content is a clone of the template; the launcher stays (stage it again) |
| `data-stageable-content` (any other element) | content is its children, moved; the element is a vessel and is removed |
| `data-stageable-style` | inline style for the new wrapper |

Example: `testkit/youtube_search` shows a tabled icon (`data-stageable="span"`) with
the player in a `<template data-stageable-content>`; clicking the icon stages it
inside a span htmf. The player is an old-school `[data-ytplayer]` (YouTube embed
with `controls=0` + its own control bar) wired by the `ytplayer` mod. The mod is
hostparked (park `ytplayer`, not listed on warez); the HTMF mounts it, and each
player's iframe `onload` mounts it when a page has it not.

---

## Rootproofer sidecar shape (not stage)

Separate from stage_dir. Typical `parts`:

`["module_sidecar","attestation","manifest","json"]`

Fields of interest: `subject.{ib,addr,content_sha256,content_type}`,
`attestation.{scheme,public_key,signature,identity_ib}`, `about.*`.

Verified by `rootproofer_shield` / `_verify_manifest.mjs` under scheme
`rootproofer-attestation-v1`.

---

## Practical rules of thumb

1. Author fragments for foobarch/HTMX: prefer `data-part` + `name`, avoid `id`.
2. Put fragments on stage via Horizon: use `href` to a flowerpot path, or
   `data`/`html` with inline markup (often via `data_to_stagedir`).
3. Rearrange live stage: mount `horizon_stagedir`, use `stagedir …`.
4. Jockey menus: types must match what plugins advertise (`offstage-member`, etc.).
5. Mount gating: use module sidecars + `shielded_mount`, not stage_dir parts.

When inventing a new `type` or `parts` tag, document it here and say which
context implements it — otherwise it is only a comment for humans.
