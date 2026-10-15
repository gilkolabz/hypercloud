# Devops goals (fsdevopstracker + hostpark)

Normative rule for **why** every artifact mut8 / hostpark push exists. Applies to all flow-model products indexed by **fsdevopstracker** (`put`, `append`, `mut8`, `hostpark-push`).

## Why goals exist

- **Ops lineage** — each write records `{ op, path, goal, actor, at, … }` as a delta frame on `{project}:devops:ops` (tip lineage via `past`).
- **Tinyviewport** — flowchart / goal edges read ops + `devops/goals.json`.
- **Human archaeology** — “why did this frame land?” without reading the whole diff.

A push without a real goal is incomplete devops.

## Required shape

Every fsdevops write that changes tip bytes **must** include:

```text
goal=<why>
```

| Field | Rule |
|-------|------|
| **Required** | Non-empty `goal=` on `put` / `append` / `mut8` / `hostpark-push` |
| **One artifact** | Prefer **one clear goal string per path** (or `goal=… [rel]` when a batch script stamps the same why onto several rels) |
| **Why, not what** | State intent / product reason — not `refresh tip from disk` or `update file` |
| **Layer when useful** | Prefix with layer or variant when it clarifies: `L3 scholastic: …`, `versatile job: …`, `L1 registry: …` |
| **Stable goals ledger** | Longer-lived work also lives in `devops/goals.json` (`id`, `text`, `layer`, `status`); ops may cite `goal_id` |

### Good examples

```text
goal=versatile jobs: NEW JOB section label above title input (match CREW/TRADES)
goal=scholastic: MARK JOB DONE green; PUNCH REPORT amber (was done-btn color)
goal=L1 registry 0.3.0: notes[] append/edit/delete + tipunch:crew_names suggestions
goal=hostpark-push ti_punch runtime + tipunch_skin.css for PM field launch
```

### Bad examples (reject / rewrite)

```text
goal=refresh tip from disk: ui/jobs.html
goal=update
goal=fix
goal=wip
```

## Two ledgers (do not confuse)

| Ledger | Path / tip | Role |
|--------|------------|------|
| **Goals** | `devops/goals.json` → `{project}:devops:goals` | Planned / layer goals (`g16`, status, layer) |
| **Ops** | `{project}:devops:ops` | What actually happened — each put/push is its own mut8 frame (`ops-batch` event); walk lineage, do not balloon a full index file |

`goals.json` answers “what are we trying to finish?”  
Ops answers “what did we ship, and why was that write done?”

## Workflow (relay iterate → hostpark ship)

1. **Edit on disk** under the project root (`config.json` `flowerpot.root`).
2. **Plant / put** into fsdevops tip space with `goal=<why>` (relay preview).  
   - `mirror` alone **does not** refresh tip bins from disk — it only rebuilds `navi/{route_prefix}/…` parks from **existing** tip content. After content changes, **`put` (or reinit)** then `mirror`.
3. **Preview** via `navi-{alias}/{route_prefix}/…` (often with temporary `navi.origin` pointing at the relay).
4. **Hostpark-push** the same rels with the **same quality of goal** (production lineage).  
   `hostpark-push <rel> goal=<why>` — required; tokens + policy key as usual.
5. Ops land as tip frames on `:devops:ops` automatically. Optional `ops-export` can snapshot `devops/ops.json` for bootstrap/import — not part of the put path.

### Callin / script shapes

```text
# REPL / callin
fsdevopstracker put path=ui/jobs_versatile.html goal=<why> body=…
fsdevopstracker hostpark-push ui/jobs_versatile.html goal=<why>

# Batch helper (requires goal=)
node B_native_mods/_fsdevops_put_disk_files.mjs nativenest goal=<why> ui/a.html ui/b.css
```

POST JSON (relay): `{ "path": "…", "goal": "…", "body": "…" }` for put/append; `{ "path": "…", "goal": "…" }` for hostpark-push.

## Catalog duty

When a project ships new hostpark paths, list them on **torus host catalog** (`torus/host-catalog`) under the product section (and identity catalogs when they are first-class assets). Goals do not replace the catalog — they explain each generation.

## Related

- [authoring.md](authoring.md) — scaffold + publishing checklist  
- [runtime.md](runtime.md) — hostpark as default artifact host  
- [glossary.md](glossary.md) — ops / goals terms  
- [fsdevopstracker readme](/torus/testkit/mod/fsdevopstracker/readme) — commands  
- [hostparking](/torus/docs/hostparking) — origin publish + spans  
