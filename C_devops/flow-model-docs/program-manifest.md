# Program manifest

A **program manifest** is the shopping label for a runnable variant: which flow boots, which modules mount, which **feature tokens** it implements, and (optionally) which features it explicitly does **not** include.

Canonical JSON Schema: [`schema/program_manifest.schema.json`](schema/program_manifest.schema.json).

## Why manifests exist

Variants used to be vague names on parallel flow files. Manifests make each alternative **legible**:

- Viewport / `launch_index` can show what a program imps without opening every flow.
- Baseline flows stay thin — excluded features live in `feature_excludes` on *other* manifests, not as comments in shared JSON.
- Artifacts declare **contracts** (`provides` / `requires` / `consumes` / `emits`) so you can test one concern in isolation and compose later.

## Relationship to other flow-model types

| Concept | Manifest field | Notes |
|---------|----------------|-------|
| Flow JSON | `flow`, `entry` | Journey graph only — no feature laundry list |
| Launch | `launch` | Cold-start bookmark; sets session tip → flow |
| Program (composition) | `id`, `compose`, `compose_from` | Cross-family runtime |
| Variant | whole manifest | Declared alternative with written `why` |
| Module parks | `modules.mount`, `modules.init`, … | What gets mounted at boot |

See [composition.md](composition.md) for feature → artifact → instance → program hierarchy.

## Required fields

- **`id`** — stable program id (`tipunch:program:pm_field_v2`)
- **`label`** — human name (name the sandwich, not the missing lettuce)
- **`why`** — who + journey + wedge
- **`flow`** — logical route to flow artifact
- **`launch`** — logical route to launch fragment

## Feature shopping

- **`feature_imps`** — tokens this program implements (required for shopping UX)
- **`feature_excludes`** — optional explicit non-goals

Feature tokens are project-namespaced strings (`job_area_punch_hierarchy`, `sub_portal`, `photo_bin_storage`). Same token across manifests = same capability for merge / compose-all checks.

A **suite** program later sets `compose_from: […]` and lists the union of `feature_imps` — built after contracts are validated, not by polluting a thin field flow.

A **program network** (`kind: "network"`, members set `network` → parent id) groups related programs that share schemas but keep separate launches — field walk, role inbox, status/checklist, later portfolio/canvas. See [composition.md](composition.md) and [reiteration.md](reiteration.md).

## Layers (`layers`)

Map UX spectrum levels to artifact routes (see [ux-spectrum.md](ux-spectrum.md)):

```json
"layers": {
  "L0": ["schema/job", "schema/area", "schema/punch_item"],
  "L1": ["modules/tipunch_registry.js"],
  "L2": [],
  "L3": ["ui/tipunch_skin.css", "ui/jobs.html", "ui/job.html", "ui/area.html", "ui/punch.html", "ui/report.html"],
  "L4": ["modules/tipunch_manager.js", "flow/tipunch_jobs_first.json"]
}
```

Swap L2 (e.g. photo bin module) without renaming L4 flow when registry API stays stable.

## Artifact contracts

Optional **`artifact_contracts`** describe standard I/O for isolated testing:

```json
{
  "artifact": "modules/tipunch_registry.js",
  "kind": "module",
  "provides": ["registry.getJob", "registry.jobStats", "registry.buildJobReport"],
  "requires": ["navi.storage.tip", "navi.storage.bin"],
  "consumes": ["schema/job", "schema/area", "schema/punch_item"],
  "emits": ["tipunch:job:*", "tipunch:fact:*"]
}
```

Pages and Manager call stable registry methods; alternate UIs (sub portal vs PM walk) are different flows + manifests that **require** the same `provides` tokens.

## Boot pattern (unchanged)

Launch still:

1. Mounts init (+ optional `modules.mount`)
2. Sets session tip → `flow` path
3. Runs bootstrap → Manager opens `entry`

Manifest does not replace flow `policy` — it documents and selects the bundle.

## Project layout (convention)

```text
<project>/
  programs/<name>.json       # program manifests
  data/launch_index.json     # machine-readable shopping index
  flow/*.json
  launch/*.html            # bootstrap bookmarks (not flow screens)
  ui/*.html                # flow route screens only
  schema/program_manifest.schema.json  # optional $schema copy or $ref to flow-model
```

## Compose-all (later)

When every feature variant has contracts and a passing isolated test:

1. Union `feature_imps` from member manifests
2. New manifest `id: …:suite_v1`, `compose_from: [...]`
3. Flow may be generated (builder) or hand-assembled from route patches
4. Launch mounts union of `modules.mount`

Until then, ship **alternatives** — each testable on its own.

A network can exist **before** compose-all: members launch separately; the network record only declares kinship and shared schema expectations.

## Related

- [variants.md](variants.md) — swapping and shopping
- [composition.md](composition.md) — programs, launches, networks
- [reiteration.md](reiteration.md) — survey → brief after shopping
- [flow-artifacts.md](flow-artifacts.md) — flow JSON shape
- [ux-spectrum.md](ux-spectrum.md) — L0–Ln placement
