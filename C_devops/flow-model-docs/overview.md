# Overview

## One sentence

A flow is a named, published record of how a user moves through screens; a Manager is a thin navi module that loads one active flow and navigates via surf; everything else (data APIs, device modules, HTML) stays resting and swappable.

## Why it exists

foobarch + navi_shell already give you:

- a persistent runtime in the browser shell (`navi`, tip+bin storage, mounted module parks)
- a versioned publish host (**flowerpot** by default) for HTML, JSON, JS modules, schemas
- in-app navigation that swaps body content without tearing down navi (`surf`)
- local-first resolve (`park.check` / planted tips before network)

What they do not decide for you is journey design: which fragment is “home,” what happens on success/failure, which alternate screens are legal, which soft capabilities are on.

The flow model fills that gap with concrete, versioned artifacts instead of a fat orchestrator module or an abstract rules engine.

## Mental model

```
launch  →  picks a flow (session tip); mounts init park
flow    →  maps route keys → HTML; declares entry + policy + meta
Manager →  go(routeKey), apply policy, hold session tips
surf    →  fetch fragment, replace body; navi stays alive
pages   →  call Manager / resting modules; do not own the journey
modules →  capability only; parks at navi:<name>; remount via navi:mod
```

Publish many flows and launches on flowerpot. Everything the session needs is tips (pointers, config, cached bodies under `flowerpot/…` when that matches fetch paths) — **local-first** by default; Manager tunes fetch/plant/refresh for **UX**. Run one active combination per navi session. Swap by pointing at a different published artifact — not by rewriting the registry.

## What it is not

- Not a generic BPM / workflow engine
- Not SPA client-side routing (React Router, etc.) as the primary metaphor
- Not “put all UI in one `*_flow.js`”
- Not event spaghetti where screens auto-open because a module emitted a fact
- Not your application’s data model (that lives in your registry tips)
- Not a redesign of navi units / entry-plug (ignore for flow products)

## Environment assumption

People write arbitrary programs: different entry screens, different HTML for the same route key, different policy graphs, different module sets. Navi enables dynamic mounting and flowerpot enables parallel published variants. Tips make the active set local-first. The flow model is the discipline that keeps those variants composable and comparable.

## Core pieces (index)

- Flow artifact — Journey wiring (JSON on flowerpot; plantable as tip)
- Manager — Thin navigator + session-tip helper (navi module park)
- UI fragments — Screens loaded by surf
- Resting modules — One-job capabilities (`navi:<name>`)
- Launch — Cold-start bookmark that chooses a flow
- Program (optional layer) — Composition of family instances into a runnable whole
- Config — Default module routes + default flow (tip, often mirrored from flowerpot)

See [runtime.md](runtime.md), [flow-artifacts.md](flow-artifacts.md), [manager.md](manager.md), [composition.md](composition.md), [glossary.md](glossary.md).
