# Flow model — documentation

> **Canonical surf docs:** `C_devops/flow-model-docs/htmf/*.html` → hostpark `torus/devops/flow-model/*`.  
> The `*.md` files in this folder are a local archive; they are not synced to HTMF.

The flow model is how foobarch / navi_shell products express user journeys: which screen comes next, what context carries forward, and how alternative journeys stay publishable and swappable without forking core logic.

This folder is the general paradigm guide for journeys on foobarch / navi_shell. It assumes **current** navi_shell: tip+bin storage, park callin, `navi:mod` remount, **hostpark** as default push host (`navi.origin`), **local-first** plant/park-check (UX guides when to refresh). Shell units / entry-plug are out of scope for flow products (one session per navi window).

Publish: `node C_devops/flow-model-docs/_hostpark.mjs --yes`

## Layout

| Path | Role |
|------|------|
| `htmf/*.html` | **Canonical** flow-model pages → `torus/devops/flow-model/*` |
| `../htmf-ecosystem/*.html` | **Canonical** docs pages → `torus/docs/*` |
| `*.md` (this folder) | Local archive only — not synced to HTMF |
| `_catalog.mjs` | Flow-model slug list for identity publish |
| `_hostpark.mjs` | Publish flow-model + docs HTMFs to hostpark |

Docs catalog and sources: `C_devops/htmf-ecosystem/`.

## Who this is for

Anyone publishing modules, HTML fragments, flow JSON, and launches onto **hostpark** and running them inside the navi shell — including people who invent programs and variants dynamically rather than shipping one fixed product path.

## Doc map

- [overview.md](overview.md) — What the flow model is, what it is not, mental model
- [runtime.md](runtime.md) — foobarch shell, navi_shell tips/parks, surf, hostpark push
- [flow-artifacts.md](flow-artifacts.md) — Flow JSON shape: entry, routes, policy, meta
- [manager.md](manager.md) — Thin Manager role, session tips, navigation contract
- [composition.md](composition.md) — Features → artifacts → instances → programs → launches
- [variants.md](variants.md) — Variance records, swapping, shopping, builders
- [program-manifest.md](program-manifest.md) — Program manifest schema, feature_imps/excludes, artifact contracts
- [reiteration.md](reiteration.md) — After shopping: client survey → brief → features; program-network growth
- [addressing.md](addressing.md) — Typed ids, logical routes, hostpark addr vs tip frame
- [ux-spectrum.md](ux-spectrum.md) — L0–Ln placement; **product skin** (shared L3 CSS) is normative
- [authoring.md](authoring.md) — How to author a program + skin in this environment
- [devops-goals.md](devops-goals.md) — Required `goal=` on put / hostpark-push; goals vs ops ledgers
- [ethos.md](ethos.md) — Principles and anti-patterns
- [glossary.md](glossary.md) — Shared vocabulary (navi_shell terms win on collision)

## Related docs

- [navi_shell/README.md](../../navi_shell/README.md) — runtime affordances
- [navi_shell/docs/navi_modules_guide.md](../../navi_shell/docs/navi_modules_guide.md) — module / park contract
- [A_document/_navi_style.md](../../A_document/_navi_style.md) — devops style of foobarch/navi
- [A_document/_style_refinement.md](../../A_document/_style_refinement.md) — composition lessons
- [A_document/hostparking.md](../../A_document/hostparking.md) — optional origin park publishes

## Status

Living docs. Adapted to tip/park/callin; **hostpark** default push; local-first dominant. See also [fsdevopstracker readme](/torus/testkit/mod/fsdevopstracker/readme) for flow-model **devops** tooling, and [devops-goals.md](devops-goals.md) for the normative `goal=` rule.
