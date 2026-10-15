# Glossary

Shared vocabulary for the flow model on foobarch / navi. Prefer these words in paradigm docs and cross-project talk.

**Rule:** when a term also exists in navi_shell, this glossary must match navi_shell. Flow-model-only names must not collide (see **pot addr** vs **tip frame**).

## Runtime (navi_shell)

foobarch — Dispatch origin that hosts the browser shell and proposals (including flowerpot).

navi / navi_shell — Persistent JS runtime in the shell: tip+bin storage, mount, callin, modules.

surf — In-app navigation: fetch HTML, replace `document.body` children; navi survives.

flowerpot — Alternate versioned artifact host (legacy transport `/flowerpot/…`). Flow-model **push and fetch** default to hostpark bare paths; do not client-prefix `/flowerpot/` onto logical routes.

**hostpark** — Server: origin holds park tips and serves logical routes from tip+bin. Default push target (`navi.origin`). Client localpark + mirror align dev with the same paths.

**tip** — Pointer to the latest tip frame for an ib (e.g. `navi:surf`, `notes:session:flow_artifact`).

**tip frame** — One generation of a tip lineage (`ib^gib`). Authoritative local record. Do **not** call flowerpot history a “frame.”

**bin** — Content-addressed bytes; tips often `rel8ns.bin` → `bin <sha>`.

**park tip** — A tip whose `http` controls make a path dispatchable (module, surface, bin GET, …). Module parks are flat `navi:<name>` (e.g. `navi:surf`). Ledger tip `navi:mod` lists planted module parks — it is not itself a module park. Session/config/artifact tips are still tips in the same space; give them GET bin/frame when you want park-check to serve them by path.

**localpark** — Client: `navi.park.check` (and surf/fetch that use it) resolve a planted tip before the network. For hostpark products, plant/cache at the **same bare ib** as the route (e.g. `opry/…/ui/list.html`). Only use tip ib `flowerpot/…` when the transport URL is intentionally `/flowerpot/…`.

**product skin** — Shared L3 CSS for a flow product’s screens and launches (`{root}/ui/{product}_skin.css`). Hostparked + plantable like any other byte. Loaded once into `document.head` via `navi.resolveUrl`. Not a flow route; not a Manager concern. See [ux-spectrum.md](ux-spectrum.md).

**hostpark** — Server: foobarch holds a park tip and serves the route from tip+bin (**default push** for flow-model product artifacts). Same tip idea; client localpark still applies.

**hostpark addr** — One pushed generation on a logical route (`route` + `x-foobarch-ib^gib`). Flow-model name for immutable history on that path. Not a tip frame.

**pot addr** — Legacy flowerpot generation name (same role as hostpark addr on the flowerpot surface).

callin — `navi("…")` → hard park dispatch: first token → tip `navi:<token>`, usually `http.POST`, then `commands.<verb>`. Mount/install is via surf: `navi("mount …")`.

bootstrap — Mount registry + Manager (and deps), seed if needed, surf to flow `entry`. Usually a **command** on the init module’s park (e.g. `navi("notes bootstrap")` after `notes_init` is mounted as `navi:notes` or similar).

init module — Project navi module that owns bootstrap commands and mounts the stack.

init_script — Shell tip `navi:init_script`: JS lines on every boot (often includes `navi.remount()`).

remount — `navi.remount()` mounts every park listed on ledger `navi:mod` from each tip’s bin.

entry-plug / unit — Multi-instance tip-space scaffolding in navi_shell. Flow products assume **one active session per navi window** and do not design against units; ignore unless you need advanced multi-tab bookkeeping. See [A_document/navi_units.html](../../A_document/navi_units.html).

## Flow model

flow model — Paradigm: journey as published flow artifacts + thin Manager + resting modules + surf; local-first via tip/park.

flow artifact — Journey JSON (`id`, `entry`, `routes`, `policy`, `meta`). Published on **hostpark** by default (bare logical route); **also plantable** as a local tip (+ bin) at that same ib so park-check wins offline / local-first.

route key — Named step in a flow (`list`, `edit`, …). Manager.go language.

policy — Map of named outcomes → next route keys.

meta — Soft capability / presentation flags on a flow (not hard navigation).

Manager — Thin navi module: load flow, go/surf, tip-backed journey context, lazy-mount, policy helpers; **local-first by default**, owns cache/request policy so UX stays good. Park tip e.g. `navi:notes_manager` with commands as needed.

resting module — Capability module that does not own the journey. Park tip `navi:<name>`.

registry — L1 application data API (facts); no DOM. Prefer tip+bin (or tip `data`) over ad-hoc bags; `storage.item` / `file` are sugar only.

launch / launch fragment — Cold-start bookmark HTML that selects flow/program and bootstraps.

entry — Flow field: first route key after bootstrap. Not the same as a launch.

active flow — The journey Manager is driving: pointer tip (which flow) + body tip (the JSON). Same tip layer as config and UI caches.

config — Project defaults (module routes, default flow). A tip (often seeded/mirrored from flowerpot). Same layer as session and artifacts.

session tip — Journey context that must survive surf (active-flow pointer, pending ids, return-to). Still a tip — not “unparked storage.” Project-prefixed ibs are a naming habit, not a second system.

## Composition

feature — Stable idea/namespace that owns artifacts.

artifact — Revisable published unit (any kind: ui, module, flow, …).

revision — Parallel branch of a feature (`@r1`); distinct path.

instance — Family-local prebaked contribution (one assembled screen role).

family — Axis grouping instances (journey, entry, list, …).

program — Cross-family composed runnable runtime.

program network — Declared set of related programs sharing schemas/project root but not one journey; members stay independently launchable. See [composition.md](composition.md).

reiteration — Devops stage after shopping/spine: client survey → brief → sorted features. See [reiteration.md](reiteration.md).

brief — Project doc that turns a survey/transcript into prioritized features (acceptance, spectrum, not-this). Plan until human says go.

client survey — Raw prospect/operator input used to drive reiteration (kept alongside the brief).

launch index / linker / graph — Devops surfaces for finding and shopping launches.

builder — Build-time composer of hosts + slot fragments → instance UI (+ flow/launch).

slot — Named insertion point in a host; collisions must error.

provenance header — Comment on generated UI listing what composed it.

variant — Declared alternative (flow and/or UI and/or modules) with a written why.

program manifest — JSON record per runnable variant: `id`, `label`, `why`, `flow`, `launch`, `feature_imps`, optional `feature_excludes`, `layers`, optional `artifact_contracts`. See [program-manifest.md](program-manifest.md).

feature_imp / feature_exclude — Capability tokens for shopping and compose-all; same token across manifests = same capability.

artifact_contract — Declared provides/requires/consumes/emits for one artifact; enables isolated variant tests.

variant_of — Typed-id link to a parent instance/program for inherit/patch.

flow base / flow patch — Shared family journey defaults + per-instance deltas.

fork rule — Generated outputs may be forked only as declared registry instances.

mainline — Role: the launch people actually use; not a magic filename.

## Addressing

typed id — Canonical id (`product:kind:family:leaf[@rev]`).

logical route — Bare park ib / path string (e.g. `torus/…/flow/….json` or `opry/devops/ti_punch/…`). No `/flowerpot` prefix.

transport URL — Surfable / fetchable URL on `navi.origin`: `/{logical-route}` via `navi.resolveUrl(logical)`. Flowerpot transport (`/flowerpot/{logical-route}`) is legacy / alternate only.

artifact_type — Optional manifest / devops label for a published unit. Common values: `launch`, `flow`, `ui`, `module`, `data`, `doc`, `schema`, `config`, `assets` (static images/fonts/audio under `assets/` — not screen-role HTML), `skin` (shared L3 product CSS; often also listed under `ui/`), `goals` / `ops` (project devops ledgers under `devops/`), `qa_index`, `graph`, ….

## Devops provenance

**goal=** — Required why-string on every fsdevops `put` / `append` / `mut8` / `hostpark-push`. Intent, not “refresh tip from disk.” See [devops-goals.md](devops-goals.md).

**goals ledger** — `devops/goals.json` → tip `{project}:devops:goals`. Planned / layer goals (`id`, `text`, `layer`, `status`).

**ops ledger** — tip `{project}:devops:ops` (delta `ops-batch` frames via lineage). What was written: each op carries its `goal` string (and optional `goal_id`). Optional `ops-export` can snapshot `devops/ops.json`; tip frames are authoritative.

## Spectrum

UX spectrum — Placement of concerns from data/logic out to rich presentation (L0–Ln).

shop-for-final-version — Ship multiple implementations/launches; keep Manager/registry stable; choose later.
