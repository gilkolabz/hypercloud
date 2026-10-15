# Style Refinement Notes

Accumulated clarifications from real project work. When `_navi_style.md` leaves room for interpretation, project Q&A surfaces concrete decisions here so future projects start further along.

Parent doc: [_navi_style.md](_navi_style.md)

## Process: uncertainty → questions → refinement

`_navi_style.md` states principles; it cannot encode every domain. A productive scaffolding phase includes:

1. Propose a default architecture from style principles (modules, storage, no redundant servers).
2. Ask domain-specific questions where assumptions affect schema or UX.
3. Record answers in the project `devguide.md` decisions log.
4. Extract generalizable conclusions into this file when they apply beyond one project.

First extraction (2026-07-01).

## Navi runtime semantics

### callin, not stdin

The programmatic text-stream interface is `callin`, not `stdin`.

- Modules expose `commands`; the runtime wires callin listeners automatically (new `register` pattern).
- Manual: `navi.on('callin', …)` and `navi("command args")`.
- Aligns with `foobarch/static/navi_shell.js` and [navi_modules_guide.md](navi_modules_guide.md).

In devguides, say "callin/commands" or "programmatic API via commands". Avoid "stdin" in new docs.

### Namespaced callin commands

Each project's callin surface should use one top-level command (project name), with operations as subcommands. Do not use bare verbs like `lookup` or `list` that collide across modules.

Example:

```
allenvethosp start
allenvethosp lookup 12345
```

- The callin module (e.g. `allenvethosp_init`) owns the namespaced `commands` object.
- Logic modules (e.g. `allenvethosp_registry`) expose programmatic API only. No top-level commands unless the command name itself is namespaced.

Other modules call logic via `navi.mod.*.registry` — not ambiguous callin strings.

### onUnmount vs runtime cleanup

`navi.unmount(module)` automatically removes callin listeners registered from `commands` and deletes `navi.mod[name]`. Modules must not manually detach callin in `onUnmount`.

`onUnmount` is for module-owned resources the runtime does not know about: event listeners, DOM nodes, styles, observers, timers, and cascade unmounts (e.g. init unmounts registry it mounted).

A callout-only `onUnmount` is unnecessary for command-only modules.

## Flowerpot as artifact host

Projects do not need a dedicated foobarch proposal per product. Use the existing `/flowerpot` proposal.

### IDE ↔ flowerpot mirror

During IDE work, every file changed under `A_document/` or `A_devops/{project}/` subfolders gets a new flowerpot frame. Routes mirror the repo under `torus/`:

```
IDE: hypercloud/A_document/_navi_style.md
FP:  foobarch.net/flowerpot/torus/A_document/_navi_style.md
```

Mirrored: `A_document/**` and `A_devops/{project}/**`. Not mirrored: `A_devops/flowerpot_manifest.json` (local sync index only).

Flowerpot cannot list all paths. Track known routes in `flowerpot_manifest.json` (tokens, paths, frame addrs).

Mint tokens via `POST /flowerpot/_flowerpot/tokens` with `X-Flowerpot-Usage-Password`. Store tokens only in the manifest, never the password. Ask the project owner in chat to mint more.

Published modules and templates live on flowerpot. Doctor-created records and camera scans live in navi.storage.

### UI variants (allenvethosp)

To ship an alternate screen without replacing the default: add a new local HTML file, point a flow artifact route at it, add a `launch_*.html` that sets that flow before bootstrap, upload. Do not rely on URL query params. Full step-by-step and glossary: [allenvethosp devguide](../A_devops/allenvethosp/devguide.md) (Variant recipe, Glossary).

### QA launch linker (per-project)

Maintain a static HTML index on flowerpot — e.g. `ui/launch_linker.html` — with clickable links to every `launch_*.html` and a short “what to test” checklist under each entry. Add a **Current focus** blurb at the top; update that file whenever QA priorities change so the human tester keeps one bookmark instead of hunting URLs.

Pattern:

- One flowerpot path per project (`torus/A_devops/{project}/ui/launch_linker.html`).
- No bootstrap script — plain links only; each target launch fragment still owns `FLOW_ARTIFACT` + bootstrap.
- Agent or dev updates checklists when shipping features or before asking for observation.
- Cross-link from project devguide variant catalog.

Example (allenvethosp): [launch_linker on flowerpot](https://foobarch.net/flowerpot/torus/A_devops/allenvethosp/ui/launch_linker.html).

### Launch graph explorer (per-project, separate from linker)

When launch combos multiply, add a second artifact — e.g. `ui/launch_graph.html` — backed by a machine-readable index (`data/launch_index.json` on flowerpot). The linker stays the human QA bookmark (checklists, current focus). The graph explorer is the variant matrix browser:

- Nodes: every launch (shipped, stub, planned), plus qa_index/graph meta nodes
- Fields per node: artifact_type, status, flow, entry, folder_variant, parents (for combo derivation), test_hint, flowerpot route
- UI: filter by type/status; click node → detail pane + Open launch button
- Link from bottom of launch_linker → launch_graph

Future: visual graph layout; sync index from flowerpot_manifest paths that include `artifact_type`; filter all artifact types (module, flow, ui), not only launches.

Example: [launch_graph on flowerpot](https://foobarch.net/flowerpot/torus/A_devops/allenvethosp/ui/launch_graph.html).

## Composable screen capabilities (not folder variants)

Small features on a **shared screen role** should not fork folder HTML or multiply layout variants. Use one host per screen role, optional flow meta, and a module or route for behavior.

**Decision tree**

| Question | If yes | If no |
|----------|--------|-------|
| Does the **whole screen layout** change? | New `ui/*.html` + flow artifact + `launch_*.html` (e.g. pile vs page-turn folder) | Keep existing host |
| Optional behavior on a shared screen? | Flow `meta` flag + module and/or new route key (e.g. settings sections, virtual edit) | — |
| Swappable logic you may shop later? | Separate module artifact (OCR, parse, view template) | Inline in host |

**Example: virtual record Edit (allenvethosp)**

- **Wrong layer:** `folder_virtual_records_with_edit_button.html` — edit is not on the folder list; all folder variants already call `mgr.openDoc()` → `doc_sheet`.
- **Right layer:**
  - Read host: `doc_sheet.html` — Edit button in toolbar (top-right)
  - Write host: `doc_edit.html` — new flow route `doc_edit`
  - Registry: `updateVirtualDoc`, `deleteVirtualDoc`; prior snapshot → owner `legacy_documents[timestamp]`
  - Enablement: flow `meta.virtual_record_actions: ["edit","delete"]` + clinic pref `virtualEditEnabled`
  - Manager: `openDocEdit()`, `canEditVirtual()` — mirrors settings return pattern without duplicating folder UIs

**Devops bookkeeping (minimum for any composable feature)**

1. One sentence in project `devguide.md` glossary
2. One checklist line in `launch_linker.html`
3. Flow artifact declares route + meta; `GOALS.md` notes phase scope
4. Optional stub flow only when a stakeholder needs the feature **off** (usually defer)

Shop-for-final-version model: swap modules (parse, view, edit policy) while Manager + registry API stay stable. Folder layout variants stay about **how you browse**; doc sheet/edit stay about **how you read/write one record**.

### UX variant shopping (clinical products)

For products where the **doctor or operator** chooses among presentation variants (folder layout, scan pile vs page-turn, entry splash, etc.):

- Ship **multiple `launch_*.html` bookmarks** + flow artifacts; do **not** force a default until the stakeholder picks.
- Record in `GOALS.md` which phase closes the decision (e.g. Phase 8 for allenvethosp folder UX).
- Design ethos: **clinical, exact, purposeful** — color where it aids recognition (digit codes), not blocky mobile-app chrome or wasted nav chrome. Example feedback: page-turn page-index dots work functionally but need a tighter visual treatment.
- Devops: launch_linker + launch_graph document variants; `artifact_type` on flowerpot paths.

See [allenvethosp GOALS](../A_devops/allenvethosp/GOALS.md) Phase 8 UX shopping.

### flowerpot_manifest artifact_type

`flowerpot_manifest.json` paths entries may include `artifact_type` for indexing and graph tools. Suggested values: `launch`, `flow`, `ui`, `module`, `data`, `doc`, `schema`, `config`, `qa_index`, `graph`. Not required on every path yet — backfill launches and flows first; upload script can infer from path patterns later.

## Artifact composition and variant management (allenvethosp retro, 2026-07-07)

This section records a mid-Phase-6 reflection prompted by the project owner. It is the most important refinement so far and should shape future projects from day one.

### Why this conversation happened

By Phase 6, allenvethosp had grown to **51 distinct flowerpot artifacts across 264 published frames** (iterations). Autopsy snapshot:

| Category | Artifacts | Frames | Notes |
|----------|-----------|--------|-------|
| ui screen | 17 | 83 | includes **3 forked folder layouts** (folder.html 12, folder_scan_pages.html 12, folder_scans_pile.html 9) + a likely-orphan `settings_pageturn.html` (1) |
| flow artifact | 7 | 48 | near-duplicate route+policy maps; adding one route = editing all 7 |
| launch bootstrap | 9 | 18 | per entry×layout combos; naming drift (`scanpages` vs flow `scan_pages`) |
| module | 8 | 43 | `allenvethosp_manager.js` alone = 16 frames (churn magnet) |
| doc/config/schema/data | 10 | 72 | devguide 25, GOALS 18 |

The owner noticed a real defect in how we got here: **variants are forks, not compositions.** The three folder screens share ~70% of their code (code row, pet sections, doc list, scan overlay, add chrome) but are hand-maintained monoliths. So a feature added to one (tab `+` popover, add-pet affordance) does **not** propagate to the others, and cross-cutting changes (adding `pet_add`/`doc_add` routes) fan out into 7 flow files by hand. This is the opposite of the navi_style ethos: resting, composable tools that Manager picks and chooses.

Honest root cause: the assistant introduced **"baseline"** as an implicit mainline and treated each folder layout as its own ongoing mini-app, folding decisions in prematurely instead of treating each feature as a distinct, composable, independently-versioned concept. The owner never actually chose to fold anything into baseline — it was invented for them.

### The owner's model (target pattern)

Treat a **variant as a composition of feature "concepts," not a fork.**

- **Concept artifact** = one composable feature unit (e.g. `folder_owner_tab`, `add_popover`, `add_footers`, `tick_nav`, `code_row`, `pet_sections`, `scan_overlay`, `folder_settings`, `section_order`). "page_turn" is itself a concept (a nav treatment), not a whole app.
- **Revisions** use `_r1`, `_r2` suffixes. A concept can be revised independently: `tick_nav_r2`.
- **Variant** = a named composition of concepts at chosen revisions, plus rationale. Examples of the owner's naming intuition:
  - `page_turn` → next iteration promotes the underlying artifact to `page_turn_r1`; the old branch stays pinned.
  - A variant that drops one concept: `page_turn_nofoldersettings` (branched off the iteration it was made from).
  - Compose the new base with the tweak: `page_turn_r1_nofoldersettings`.
  - Iterate the tweak itself: `page_turn_r1_nofoldersettings_r1`.
  - Another dev revises just that concept: `nofoldersettings_r2` → `page_turn_r1_nofoldersettings_r2`.
  - Variant-of-variant with a distinct handle: `nofoldersettings_r2_smileyface` → `page_turn_nofoldersettings_r2_smileyface`.
- Because listing every concept in the name gets verbose, prefer **one of**:
  1. short concept IDs tacked onto the address (`_a3c_b8d_8rf`), or
  2. (preferred) a **variant descriptor data structure** — each variant gets a wholly unique human name plus a record listing its concepts+revs, a **plain-language "why this variant exists"** field, base lineage, flow, launch, and status.
- **`baseline`** stays the merge-and-forget mainline: it may overwrite freely, but we must still keep a record of which concepts (and revisions) compose it. Folding into baseline is an explicit owner decision, never assumed by the assistant.

### Two layers to build

1. **Record-keeping layer (do first, cheap):** a variant/concept registry (extend `data/launch_index.json` or add `data/folder_variants.json` + `data/concepts.json`). Captures composition, revision lineage, rationale, and status. This alone restores coherence and lets us stop losing track — even while screens remain forked.
2. **Enforcement layer (bigger refactor):** a shared **folder builder** that assembles a screen from a variant descriptor by mounting enabled concept components, instead of three hand-maintained HTML files. Same idea for flow: generate the 7 flow artifacts from one base + variant deltas rather than editing each. This is what actually stops forking and fan-out edits.

### Decisions locked in this conversation

- **Keep Settings in the folder** for all variants. The owner used "remove folder settings" only as an example of an easy on-a-whim variant; the point is *we should not have to walk back* — distinct launches mean we never must decide. Do not fold decisions in heavily.
- **Page-turn keeps the manilla folder styling** (owner-name tab like baseline). The `+` living top-right (instead of beside the tab as in baseline) is a *good* deliberate shopping difference — keep both treatments as distinct concepts.
- The tick strip nav is approved.
- **parseLayout clarification:** a generic record (notes) is intentionally *not* a `layout_v1` record; only OCR'd scans produce sections. The section editor appears for layout records in both parse review and doc edit — working as intended.
- Legacy edits browser stays deferred to Phase 8.

### Lesson for future projects

Start with the **concept + variant-descriptor** model on day one. Every presentational feature is a resting, revisable unit; variants are declared compositions with written rationale; a builder composes them; "baseline" is an explicit, recorded merge target — never an assistant default. This is the concrete expression of the separation-of-concerns / composable-tools ethos in `_navi_style.md`, applied to UI/flow artifacts, not just logic modules.

### Design convergence — registry + builder mechanics (2026-07-07, cont.)

Vocabulary (owner's, adopted): **features own artifacts → artifacts compose into instances → instances compose into programs → launches bootstrap a program**. Instance always means family-local (e.g. a prebaked folder layout). **Program** is the layer above instances — the full runnable clinic path (journey spine + folder instance, optionally entry). Some instances and programs are variants of others.

**Journey under the journey family.** Numpad and the shared clinic spine live under the `journey` family axis; that is fine. A program's `compose.journey` references the journey flow (e.g. `allenvethosp:flow:journey:numpad_direct`) until/unless journey gets its own instance records.

**Artifacts are multi-kind.** A feature is a bundle that can span HTML (slot markup), JS (a behavior module), flow meta (route reachability), CSS, schema, and data. The instance wires each kind to its place: HTML → a named slot, JS → Manager registration, flow meta → merged into the route map. This is not new machinery — Manager already composes the *logic* artifacts at runtime (parse / virtual_view / edit-policy); the builder just extends "pick and place" to the *view* layer.

**Addressing — three distinct concepts, kept separate:**
- Reference token (canonical, in instance records): `feature@rev`, e.g. `add_affordance@topright_r1`.
- Catalog nesting (registry tree): `add_affordance.topright_r1`.
- Flowerpot storage path: a real route with frames, e.g. `fragments/add_affordance/topright.html`.

Two version axes, meaning different things:
- **Revision** (`_r1`, `_r2`) = a **distinct flowerpot path / parallel branch.** Lets a variant *pin* `topright_r1` forever while `topright_r2` exists alongside. (Frames cannot do this — they are linear per path.)
- **Frames** = micro-history *within* one revision (typo fixes, tweaks).

So: **feature = stable namespace → artifact-revision = distinct branchable path → frames = that path's edit history.** The registry is itself a framed artifact, so a third party can reconstruct the composition graph by querying paths (same principle as `launch_linker` / `launch_graph`).

**Slot contract (composition mechanism).** Prior art: named slots / content projection (Web Components `<slot name>`, Vue slots, transclusion, static-site partials). Our version does it **without a framework**, over plain surfed fragments:
- Host template exposes named slots. Day-one form: string markers `<!--slot:folder_top_lip-->` (trivial, inspectable — this is `#include`, not a slot engine; DOM slotting via jsdom is a later nicety).
- Fragment declares its target: `data-slot="folder_top_lip"` + `data-artifact="add_affordance@topright_r1"`. Prefer `data-*` over `name=` (collision-safe; `name` has form semantics).
- Builder matches by **stable slot id only.** Two artifacts claiming one slot → builder **errors loudly** (explicit, never silent collision).
- Scope each feature's CSS under its `data-artifact` selector to prevent layout bleed.
- **Machine contract vs authorial color:** the stable slot id + token is what the builder keys on; verbose/human names, authorship (`..._dropdown_by_mr_boaz`), and descriptions live in `description`/`author` fields. Corollary (owner's): the **feature (idea) is the translator**; individual artifacts may be parochial to the instance context and need not be universally portable. This collapses the combinatorial-collision worry — the builder only reconciles stable ids within a family.

**Builder — flavor A (build-time generate), deliberately dumb first:**
1. Read instance record → resolve each `feature@rev` token to its fragment.
2. Load host template with string slot markers.
3. Inject each fragment's markup at its slot; concatenate its scoped CSS; note the Manager method its JS needs.
4. Apply the variant `delta` (remove / replace / add).
5. Emit `ui/<instance>.html` with a **provenance header** comment (`<!-- built: folder_page_turn = layout_pageturn@r1 + owner_tab@r1 + ... @DATE -->`), plus its flow JSON and launch from templates; upload via existing script.

Doing A first also de-risks B (run-time slot-mount): A forces us to define the slot contracts, which B reuses. B has little added value for allenvethosp specifically, so it's deferred but not foreclosed.

**Fork rule (resolves the "generated output" question).** A generated `ui/*.html` is a *build product*. Hand-editing it silently forks it from its recipe — the exact drift disease. Forks are allowed, but a hand-edited output must be **promoted to a declared instance/artifact in the registry**, never left as silent drift. Forks can exist; they cannot steer the ethos or hide.

**Safety strategy — do not lose progress.** The builder proves itself by producing the **next needed change** (reintroduce the owner-name tab on page-turn), *not* by dismantling the three working forks. The existing forks stay declared in the registry as hand-authored instances until builder-generated equivalents are validated, then we cut over deliberately.

**Drift evidence (why this was worth stopping for).** Reading the three folder files back-to-back, the divergence is accumulated drift, not considered variation:
- `folder.html` (baseline): `code-row` digit chips, fused `+` dropdown (Add pet / Add document), pet management (add pet, per-pet "Add details"), section-order pref (`docs_first`).
- `folder_scans_pile.html`: no code-row, no pet management, no section-order.
- `folder_scan_pages.html`: no owner tab, no code-row.
Two of the three are simply older/less complete; good features never propagated. A feature matrix would surface these gaps instantly; a builder restores parity near-free instead of hand-porting.

### First cut shipped (2026-07-07)

- **"baseline" retired as a concept.** It was just `ui/folder.html`, anointed by the assistant. Renamed in the registry to the **`overview`** layout (inline sections + tap-scan-opens-**overlay**; flow `clinic_folder_overlay`). The three folder layouts are now peer features: `overview`, `pile`, `page_turn`. **"Mainline" is a role** (which launch a clinic bookmarks), not a name — any instance can hold it.
- **Table-of-contents (pencilled).** `overview`'s doc/pet rows could cross-link into the `page_turn` pager ("open this record as a page"), reusing the same doc artifacts. Opt-in feature, deferred.
- **Artifacts created:** `data/folder_concepts.json` (folder feature catalog), `data/folder_instances.json` (the 3 forks declared as hand-authored + the first builder-generated instance), `fragments/folder/*` (chrome slot fragments + `_host.pageturn.r1.html`), and `A_devops/_build_folder.mjs` (flavor-A string-marker builder).
- **First composition proven:** `folder_page_turn_owntab` = page-turn host + `folder_owner_tab@r1` (restores the owner tab) while keeping `add_affordance@topright_r1`. Built to `ui/folder_page_turn_owntab.html` with a provenance header; the three working forks were untouched (builder skips hand-authored instances). Flow + launch generation added 2026-07-08 (see below).

### Flow authoring modes (2026-07-08)

Inheritance is **optional convenience**, not a requirement. Three modes, same registry:

| Mode | When | Instance record |
|------|------|-----------------|
| **Full authorship** | Genuinely different journey (different `entry`, `policy`, routes) | `flow: "flow/my_flow.json"` — no `variant_of`, no generation; hand-authored artifact is authority |
| **Family base + patch** | Same clinic app, a few flow facts differ (`scan_presentation`, `settings_sections`, folder route) | `flow_patch: { meta, routes, policy? }` merged onto `data/folder_flow_base.json` |
| **Variant inherit** | Same flow as parent; only folder screen + labels change | `variant_of: "folder_page_turn"` — builder deep-copies parent flow, patches `id`, `description`, `meta.variant`, `routes.folder` |

Builder resolution order: `flow` (use as-is, skip gen) → `flow_patch` + base → `variant_of` inherit. A completely different flow is **mode 1** — write a dedicated flow artifact, point the instance at it, pair with launch. The registry records it; the builder does not synthesize policy you did not declare.

**Fork rule (flows):** hand-authored flow outside the registry does not exist in the model. Allowed, but must be a declared instance with a `why`.

**PENCILLED — flow fragments:** if several flows share ~70% policy within a family, split into `flow_policy@r1`, `flow_routes@r1`, `flow_meta@pageturn_r1` composable artifacts (same pattern as HTML slots). Deferred until fan-out pain justifies it.

**Shipped:** `data/folder_flow_base.json` (shared policy + non-folder routes), `fragments/folder/_launch.template.html`, builder extended to emit flow + launch for `folder_page_turn_owntab`.

### Canonical addressing doctrine (2026-07-08, strict turn)

The stronger model is:

- **Integral typed id** is canonical and authored. `allenvethosp` is the product namespace; `folder` is the explicit subfamily axis for this registry:
  - `allenvethosp:fragment:folder:add_affordance@topright_r1`
  - `allenvethosp:host:folder:layout_pageturn@r1`
  - `allenvethosp:instance:folder:page_turn_owntab`
  - `allenvethosp:flow:folder:page_turn_owntab`
  - `allenvethosp:launch:folder:page_turn_owntab`
  - `allenvethosp:program:folder_page_turn_owntab`
- **Derived branch route** is mechanical, never separately authored except as a rare escape hatch. Examples under the current physical root:
  - `allenvethosp:fragment:folder:add_affordance@topright_r1` -> `torus/A_devops/allenvethosp/fragments/folder/add_affordance@topright_r1.html`
  - `allenvethosp:host:folder:layout_pageturn@r1` -> `torus/A_devops/allenvethosp/fragments/folder/layout_pageturn@r1.html`
  - `allenvethosp:instance:folder:page_turn_owntab` -> `torus/A_devops/allenvethosp/ui/folder_page_turn_owntab.html`
  - `allenvethosp:flow:folder:page_turn_owntab` -> `torus/A_devops/allenvethosp/flow/flow_folder_page_turn_owntab.json`
  - `allenvethosp:launch:folder:page_turn_owntab` -> `torus/A_devops/allenvethosp/ui/launch_folder_page_turn_owntab.html`
- **Frame address** = the same branch route plus flowerpot's immutable `^hash` history. `flowerpot:` prefix is treated as a client/address presentation concern, not the conceptual root of the model.
- **Transport/surf URL** is derivative of the branch route for the current host: `/flowerpot/<branch-route>`.

This resolves the earlier route confusion cleanly:

- `torus/...` in session/config is the **logical artifact route** consumed by `fetchFlowerpot(route)`.
- `/flowerpot/torus/...` inside flow `routes` is the **surfable transport URL** consumed by the browser shell.

So there are still two forms, but they are now understood as **integral/logical** vs **transport/surf**, not as accidental inconsistency.

Strict policy adopted:

1. Do **not** author separate storage-route fields when the route can be derived from the typed id.
2. Publish **everything** as first-class routes eventually: fragments, hosts, instances, flows, launches. This preserves lossless devops history and enables future flavor-B runtime composition.
3. Generated outputs are build products, but their ids are still first-class (`instance`, `flow`, `launch`) and can themselves accumulate flowerpot frames.
4. Legacy names/paths may remain in existing published history, but new work should repot under the strict typed-id/derived-route schema rather than carrying forward old naming drift like `clinic_*`.
5. **`variant_of` uses typed instance ids**, not registry map keys. Example: `allenvethosp:instance:folder:page_turn`, not `folder_page_turn`.
6. **Product-level map:** `data/artifacts.json` is the canonical catalog for the entire allenvethosp project (all families). `data/programs.json` records programs (compose journey/entry/folder). `data/launch_index.json` points clinic launches at `program_id`. Folder composition detail remains in `folder_concepts.json` + `folder_instances.json` + `folder_flow_base.json`.

### Programs layer (2026-07-08)

Almost every clinic launch composes **journey** (numpad spine) + **folder** (+ sometimes **entry** splash). That composition is explicit now:

- **Instance** = one family's prebaked contribution (`allenvethosp:instance:folder:page_turn`).
- **Program** = composed runtime across families (`allenvethosp:program:folder_page_turn_owntab`).
- **Launch** = bootstrap bookmark for a program (`allenvethosp:launch:folder:page_turn_owntab`).

`programs.json` `compose` keys name the family axis (`journey`, `entry`, `folder`) and hold typed ids (flow for journey spine, instance for folder/entry screens). Devops surfaces (linker, graph) have no program.

## UX spectrum tree (per-project, in devguide)

Presentation extends from programmatic soundness and should be modularly divided. Each project `devguide.md` should name levels (L0 data, L1 logic, L2 devices, L3 pages, L4 manager, etc.), sibling branches, and prune points so features have a clear home.

See [allenvethosp devguide](../A_devops/allenvethosp/devguide.md).

## Flow: browser shell, surf, flow artifacts, Manager

Flow is how the user moves through a product — which screen comes next and what context carries forward. On foobarch this is expressed through the navi shell plus navi.storage, not a bloated flow.js UI module.

See [foobarch/README.md](../foobarch/README.md), section Browser shell, HTMX, and Navi.

### Browser shell and in-app navigation

- The top shell loads `navi_shell.js` once. `navi.storage`, `init_script`, and mounted modules persist while body content changes.
- Direct entry to a path: foobarch SSR may still bootstrap the first screen with an HTMX `hx-get` element in the shell body.
- Entry at `/`: empty body; init_script may seed an HTMX element to a default route and call `htmx.process`.
- Step-to-step movement inside a project uses surf, not HTMX. `navi.mod.surf.surf(url)` fetches the route, parses HTML into a template, and `replaceChildren` on `document.body`. No hx-get flicker.
- Flowerpot HTML fragments are the payload surf loads. Navi stays in the shell window.
- Prefer fragments **without `id`**. Use `data-part` + `name` (and `hx-target="div[name='…']"`). Ids are document-global and collide under HTMX swap / stage duplication; see [foobarch/README.md](../foobarch/README.md) § Writing Flowerpot / foobarch HTML fragments.
- Deep link matters for entry (bookmark, custom proposal). Inside the runtime, body content swaps while navi session persists.

Note: the older "telescope" iframe terminology is deprecated.

### What to build (not a fat flow module)

Flow artifact — versioned JSON on flowerpot. Route map (HTML paths), entry route, and movement policy (e.g. on miss, offer choices; do not auto-create).

HTML pages — one document per screen in `ui/` on flowerpot.

Manager — thin navi helper. Loads the active flow artifact from config, navigates via `navi.mod.surf.surf(url)` (fetch + replaceChildren), calls registry and resting modules. Example: `go("folder")` surfs to the folder route from the artifact. Pages use `navi` in the shell (same window after swap).

Resting modules — capability only. Folder, create, capture, numpad helpers. Invoked when needed; they do not orchestrate the journey.

Bootstrap — `init_script` or a small mod ensures registry, Manager, and deps are mounted after reload.

Example artifact sketch (not final):

```json
{
  "id": "clinic_numpad_direct",
  "entry": "numpad",
  "routes": {
    "splash": "/flowerpot/torus/A_devops/allenvethosp/ui/splash.html",
    "numpad": "/flowerpot/torus/A_devops/allenvethosp/ui/numpad.html",
    "result": "/flowerpot/torus/A_devops/allenvethosp/ui/result.html",
    "folder": "/flowerpot/torus/A_devops/allenvethosp/ui/folder.html",
    "create": "/flowerpot/torus/A_devops/allenvethosp/ui/create.html"
  }
}
```

State can live on navi between pages when a specific implementation needs it. That is a per-project choice, not a required framework. Owner data stays in registry keys.

### Ethos

1. Modules do not orchestrate UX. Resting modules provide capability. The Manager (driven by flow artifact policy) decides what happens next.
2. Lower layers keep a voice. Registry lookup/create; pages render; none auto-open because of events alone.
3. No presumptive auto-reaction. Result page offers Try again / Create / Cancel. Create runs only when the user chooses.
4. Tools rest. Manager moves. Logic stays dumb about the journey.

Anti-patterns: fat `allenvethosp_flow.js` with all HTML in JS; event spaghetti where folder listens for `owner_found` and create listens for `owner_missing`.

### Multiple flow artifacts as variance records

Use separate flow artifact files to record alternative journey designs, even when divergence is small (e.g. splash entry vs direct numpad entry).

Rationale:

- Each artifact is a named, versioned document of how movement was decided at a point in time.
- Comparing two artifacts (e.g. `clinic_numpad_direct.json` vs `clinic_numpad_splash.json`) shows exactly where responsibility diverged — usually entry and one transition, sometimes more later.
- Alternatives stay published on flowerpot and remain switchable without rewriting code.
- You ship one active flow per deployment; the others are preserved design options, not dead code.

Project `config.json` (or equivalent) declares which flow artifact is active:

```json
{
  "flowerpot": {
    "flow_artifact": "torus/A_devops/allenvethosp/flow/clinic_numpad_direct.json"
  }
}
```

Manager loads whatever config points at. Changing the shipped experience is a config change (and maybe init_script default route), not a fork of registry or resting modules.

Longer term: maintain a catalog of alternatives at each decision level (flow, schema shape, module split). Only one is active per environment; the rest document variance and stay usable if priorities change.

This is intentional design archaeology — not duplication for its own sake, and not a reason to build a generic flow engine early. Each artifact stays concrete and readable.

"Defer a generic flow engine" still applies: no abstract rules interpreter on day one. Add another JSON file when a new journey or entry variant is worth recording.

Custom foobarch proposals can expose clean entry URLs while config selects the flow artifact.

### Fragment page pattern

HTML fragments are what surf loads into the shell. Navi is in the same window — pages call `navi` directly. Inline script may invoke Manager or a resting module. init_script re-mounts deps after reload.

Fragments or heavier SPA patterns are fine at higher UX spectrum levels when needed. surf is the default in-app navigation tool; HTMX may still bootstrap first paint on entry.

## Domain modeling: derived vs stored fields

When a UI artifact encodes information already in another field, derive it. Do not store redundantly.

Example (allenvethosp): each numpad digit has a fixed color. Store `code` only; map digits via `digit_colors.json`.

## Create-record flows

When lookup can miss, the Manager introduces create as an option — not an automatic next step. Prefill code when user chooses create. Collect owner name and pets. Seed dummy defaults for demo usability.

## Scaffolding checklist

When starting a project under `A_devops/{name}/`:

1. readme.md, devguide.md, GOALS.md
2. Domain Q&A → decisions log + schema
3. UX spectrum levels in devguide before UI
4. schema/, data/, modules/
5. Register paths in flowerpot_manifest.json
6. Phase 1: registry + callin only (no DOM)
7. New local save in mirrored paths → new flowerpot frame
8. Phase 2+: flow artifact(s) + Manager + HTML; config picks active flow; resting modules
9. `ui/launch_linker.html` on flowerpot — QA index with launch links and test checklists (update when observation needed)
10. `data/launch_index.json` + `ui/launch_graph.html` when launch matrix grows beyond a handful of combos

## Changelog

2026-07-01 — allenvethosp scaffolding: callin, flowerpot paths, UX tree, derived colors.

2026-07-01 — flowerpot IDE mirror: torus/A_document, torus/A_devops; flowerpot_manifest.json.

2026-07-01 — namespaced callin; logic modules programmatic-only.

2026-07-01 — flow layer: resting UI; Manager moves; logic agnostic.

2026-07-01 — flow artifact + HTML on flowerpot; no fat flow module.

2026-07-03 — multiple flow artifacts as variance records; config selects active flow.

2026-07-03 — HTMX shell replaces telescope iframe; Manager uses surf for navigation.

2026-07-05 — surf uses fetch + replaceChildren, not HTMX (avoids load flicker).

2026-07-06 — QA launch linker pattern: per-project `launch_linker.html` on flowerpot with demo links and test checklists.

2026-07-06 — Launch graph explorer + launch_index.json; manifest artifact_type for flowerpot path indexing.

2026-07-06 — Composable screen capabilities pattern (virtual edit example); decision tree; devops bookkeeping minimum.

2026-07-06 — UX variant shopping pattern (clinical folder layouts); Phase 5 done; digit colors clinic-confirmed as hex + descriptions.

2026-07-06 — Folder pair colors (double-digit corner codes) documented as separate system; Phase 7.
