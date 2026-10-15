# Composition hierarchy

Vocabulary for building runnable products from published pieces without silent forks.

```text
feature  →  owns artifacts (multi-kind)
artifact →  a revisable published unit (HTML fragment, module, flow meta, …)
instance →  family-local prebake (one screen role assembled)
program  →  cross-family composition (what you actually run)
launch   →  bootstrap bookmark for a program / flow
```

This hierarchy is devops structure. Runtime still boils down to: launch sets session tip → Manager surfs routes → modules do work on parks.

## Features and artifacts

A feature is a stable idea/namespace (e.g. `add_affordance`, `list_toolbar`, `editor_chrome`).

An artifact is a concrete revision of that feature — often multi-kind:

- HTML fragment — Named slot in a host template
- JS behavior — Manager registration / resting module
- Flow meta / route — Merged into the active flow map
- CSS — Scoped under the artifact’s marker
- Assets — Static images/fonts/audio under `assets/` (`artifact_type: assets`); referenced by UI, not screen roles themselves
- Schema / data — flowerpot data routes (and/or planted tips)

Features translate ideas into placeable units. Individual artifacts may be parochial to a family; they need not be universally portable.

## Addressing tokens

Keep three concepts separate:

- Reference token — e.g. `add_affordance@topright_r1` — What instance records compose
- Catalog nesting — e.g. `add_affordance.topright_r1` — Registry tree
- Flowerpot path — e.g. `fragments/…/add_affordance@topright_r1.html` — Published storage (**pot addr** history)

Revision (`_r1`, `_r2`) = parallel branchable path (pin forever).
**Pot addr** = micro-history within one revision path on flowerpot.
**Tip frame** = local navi generation when you plant a copy — different word, see [glossary.md](glossary.md).

See [addressing.md](addressing.md) for typed ids and derived routes.

## Instances (family-local)

An instance is one family’s contribution — e.g. a particular list layout, a particular editor chrome, a particular entry splash.

- Hand-authored instances: declared in a registry with a `why`; source HTML is authority until a builder replaces it.
- Builder-generated instances: composed from a host + slot fragments + optional delta; emit UI (+ often flow + launch) as build products.

Fork rule: hand-editing a generated `ui/*.html` is a fork. Allowed only if promoted to a declared instance in the registry — never silent drift.

## Families

A family groups instances that share a screen role or spine (e.g. `journey`, `entry`, `folder`, `notes_list`). Programs compose across families.

Shared policy/routes for a family may live in a flow base document; instances patch what differs.

## Programs

A program is the layer above instances: the full runnable path.

```json
{
  "id": "example:program:notes_list_first",
  "why": "List entry with compact editor instance.",
  "compose": {
    "journey": {
      "spine_flow": "example:flow:notes:list_direct",
      "list_instance": "example:instance:notes:list_compact"
    },
    "entry": "example:instance:entry:splash"
  },
  "launch_id": "example:launch:notes:list_first",
  "flow_id": "example:flow:notes:list_direct",
  "entry": "list"
}
```

`compose` keys name family axes and hold typed ids. Devops indexes (linker, graph) may point launches at `program_id` without embedding program logic in the Manager.

**Program manifests** ([program-manifest.md](program-manifest.md)) document each runnable variant: `feature_imps`, optional `feature_excludes`, `layers`, and `artifact_contracts` for isolated testing and future `compose_from` suite builds.

## Program networks

A **program network** is a declared set of related programs that share fact schemas (and usually a project root) but **do not** share one journey or one launch.

```text
network (canvas / family runtime graph)
  ├─ program A — field walk (role: pm)
  ├─ program B — inbox (role: sub)
  ├─ program C — status / checklist (same facts, different entry)
  └─ program D — portfolio / map canvas (optional later leaf)
```

Why networks exist:

- Reiteration often wants **breadth** (portfolio, GIS, role portals) without stuffing every surface into the primary field launch.
- Role-split launches already prove features need not cross; a network is the same idea **one level up**.
- Linker / launch_index can show network membership so shopping and reiteration stay legible.

Convention on manifests:

- **`kind`: `"network"`** — this manifest is the network node; `compose_from` lists member program ids; it may omit a runnable `flow`/`launch` only if tooling treats it as an index (prefer still pointing at a suite launch when one exists).
- **`network`** — on a leaf program: id of the parent network manifest.
- Members stay **independently launchable**. Shared L0/L1; split L3/L4.

Amend the paradigm when product briefs need nesting that `compose_from` alone does not name — do not invent silent Manager globals.

See [reiteration.md](reiteration.md) for survey → brief → network growth.

## Launches

A launch is a cold-start HTML fragment (or equivalent bookmark) that:

1. Ensures navi + surf
2. Mounts init from its **bare hostpark** module route (plants park tip)
3. Sets which flow (and optionally program / manager module) via **session tip**
4. Runs bootstrap command → Manager opens `entry`

Launches are how humans and PWAs pick a variant combination. They are not the same as flow `entry` (that is the first in-app route key).

Do not rely on URL query params for variant selection — hostpark serves static fragments. The launch script chooses the flow. Do not prefix mounts/fetches with `/flowerpot/`.

## Builder (flavor A)

Build-time composition (deliberately dumb first):

1. Read instance record → resolve `feature@rev` tokens
2. Load host template with slot markers (`<!--slot:name-->` or equivalent)
3. Inject fragment markup; concatenate scoped CSS; note Manager hooks
4. Apply variant delta (add/replace/remove)
5. Emit `ui/<instance>.html` with a provenance header, plus flow/launch from templates
6. Upload via hostpark push scripts (e.g. `_hostpark_*.mjs`); flowerpot pot is alternate only

Flavor B (runtime slot-mount) reuses the same slot contracts later if needed.

Two artifacts claiming one slot → error loudly. No silent collision.

## Why this hierarchy exists

Without it, variants become hand-maintained forks: shared chrome drifts, one route change fans out across many flow files, and “baseline” becomes an assistant default instead of an explicit merge target.

With it: features are resting units; variants are declared compositions with written rationale; programs are shoppable runtimes; launches are the human-facing selector.

## Related

- [variants.md](variants.md)
- [addressing.md](addressing.md)
- [authoring.md](authoring.md)
