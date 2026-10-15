# Manager

The Manager is a thin navi module that:

1. Loads the active flow artifact (tip first, flowerpot on miss / refresh)
2. Navigates with surf using route keys
3. Holds journey context in **session tips**
4. Calls resting modules for facts and capabilities
5. Optionally resolves program / PWA identity for the running combination

It does not own HTML templates, application CRUD, or device I/O. Those stay in UI fragments and resting modules.

Flow products assume **one session per navi window**. The shell may bond a unit underneath; Manager code does not need to branch on units.

## Contract (conceptual)

```text
loadFlow()           → resolve active flow (tips + host as Manager chooses)
getFlow()            → current artifact (or null)
setFlowArtifact(r)   → tip: which flow is active; cache body as Manager chooses
go(routeKey)         → surf(routes[routeKey])  // park-check then host
policy helpers       → map named outcomes → go(nextKey)
session getters/set  → tips (pending ids, return-to, prefs, active flow pointer)
ensureXModule()      → mount from config routes → navi.mod.<name>
bootstrap path       → init module park command, not Manager alone
```

Exact method names are per-project. The paradigm is: thin, flow-driven, surf-based, **one tip layer**, **local-first by default**, Manager owns cache/request policy so UX stays good.

## Navigation

```js
// conceptual
async go(routeKey) {
  const flow = await this.loadFlow();
  const url = flow.routes[routeKey];
  if (!url) throw new Error(`unknown route: ${routeKey}`);
  await navi.mod.surf.surf(url);
}
```

Pages should call `go("edit")`, not hard-code flowerpot URLs. That keeps HTML reusable across flows that remap the same keys.

## Policy application

Typical pattern after a resting-module fact:

```text
user submits code / id
  → registry.lookup(...)
  → if found:  go(policy.lookup.found)
  → if missing: go(policy.lookup.missing)
```

Or after a page action:

```text
user taps Cancel on create
  → go(policy.create.cancel)
```

The Manager may expose named helpers (`submitCode`, `finishCreate`, `openSettings`) that encode those branches so pages stay short. Helpers still read this flow’s policy — they must not hard-wire destinations.

## Session + cache (same tip layer; local-first)

Everything that must survive a body swap is tips — not a side channel:

- which flow is active (pointer tip → logical route / id)
- the flow JSON and screen HTML (body tips; prefer ib `flowerpot/…` when that matches surf/fetch paths so park-check wins)
- pending / active entity ids, return-to, program id, prefs
- config defaults

Pointer tips and artifact tips are the same kind of thing: tips. A tip with `http` GET bin/frame is what park-check serves; Manager can also `tip.get` any ib it knows. That is not two systems.

**Local-first default; UX guides how:** prefer warm tips; fetch host when needed; plant/mut8 after fetch; optionally track pot addr for refresh. Optimize for how the journey feels without inventing a parallel store.

## Resting modules vs Manager

- Registry / L1 — Facts: get, list, create, update. Emit events as facts only
- Device / L2 — Camera, OCR, sensors — capability
- Manager / L4 — Journey: go, policy, session tips, which module to mount
- Page script — Wire buttons to Manager + modules; render

Anti-pattern: registry opens a screen because it emitted `item_found`.
Pattern: registry returns / emits a fact; Manager (or page → Manager) decides UI.

## Callin / park dispatch

Manager and init are normal navi modules:

- Mount plants park tip `navi:<name>` + indexes `navi:mod`
- Callin verbs are `commands` keys on that park (GET/POST both `kind: "mod"`)
- Example: after mounting init, `navi("notes bootstrap")` runs `commands.bootstrap` if the park leaf is `notes` (or use `navi("notes_init bootstrap")` if that is the register name)

Do not assume a flat global command table. Align `name`, park leaf, and command keys deliberately.

## Dynamic swapping

Because modules are flowerpot logical routes named in config (and optionally overridden), the Manager can:

- `mount` alternate parse / view / policy modules (new park tips)
- keep the same `go()` and registry API while shopping implementations
- describe runtime identity (project, flow id, program id, launch) for feedback and System-like hosts

This is the “shop for final version” posture at the logic layer: Manager + registry API stay stable; modules behind them swap.

## Init + bootstrap

Usually a separate init module owns callin commands (`bootstrap`, `lookup`, …) and mounts registry + Manager. Launch fragments:

1. `mount` init from flowerpot
2. set session tip for flow (and optional program)
3. `navi("<initPark> bootstrap")` (or project-chosen verb)

Manager should tolerate remount after reload (`navi.remount()` / init_script) without assuming DOM from a previous page still exists.

## What not to put in the Manager

- Large HTML strings / template rendering of whole screens
- Schema validation that belongs in registry
- One-off UI for a single variant (put it in that variant’s HTML or a resting module)
- Silent auto-navigation on every registry event
- Unit / entry-plug bookkeeping (out of scope for flow products)

When the Manager file becomes a churn magnet, split resting capabilities out; keep Manager as the junction of flow + surf + session tips.

## Related

- [flow-artifacts.md](flow-artifacts.md)
- [runtime.md](runtime.md)
- [ethos.md](ethos.md)
- [navi_shell/docs/navi_modules_guide.md](../../navi_shell/docs/navi_modules_guide.md)
