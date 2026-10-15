# Variants, swapping, and shopping

The flow model assumes many published alternatives and one active combination per navi session. Navi’s dynamic mount + flowerpot’s parallel paths make that practical. Local tips make the active combination local-first.

## Variance records

Anything that can diverge should be able to exist as its own published artifact:

- **program manifest** — shopping label: `feature_imps`, optional `feature_excludes`, layers, artifact contracts ([program-manifest.md](program-manifest.md))
- flow JSON (journey divergence)
- UI HTML (screen layout divergence)
- modules (logic / parse / view policy divergence)
- launches (which combination to boot)
- programs / instances (declared compositions)

Comparing two artifacts shows where responsibility diverged. That is intentional design archaeology, not accidental duplication.

## Kinds of swap

- Different journey — Different flow artifact (entry / policy / routes)
- Different screen for same role — Same route key → different HTML URL in the flow
- Optional behavior on shared host — Flow `meta` + Manager getters / prefs
- Different logic implementation — Config tip module routes; Manager `mount`s alternate parks
- Different full runtime — Different program + launch

Decision tree:

1. Whole screen layout changes? → new UI + flow route (+ launch)
2. Optional behavior on shared screen? → `meta` and/or prefs + module
3. Swappable logic you may shop later? → separate module artifact; keep Manager/registry API stable

## After shopping: reiteration

Once a spine runs, new ideas usually arrive as a **client survey** → project **brief** → features placed on the UX spectrum. That is **reiteration**, not a second shopping pass that throws away the spine. See [reiteration.md](reiteration.md). Breadth that does not belong on the primary launch becomes a **sibling program** or **program network** member ([composition.md](composition.md)).

## Launch as the shopping UI

Ship multiple `launch_*.html` bookmarks. Do not force a single default until someone chooses.

Supporting devops surfaces:

- Launch linker — human QA index: links + checklists + “current focus”
- Launch graph — machine-readable matrix (`launch_index.json`) for combo browsing

Fields useful per node: artifact types, status, flow, entry, parents, test hint, flowerpot logical route, `program_id`, **program manifest** (`feature_imps` / `feature_excludes`).

See [program-manifest.md](program-manifest.md) for the canonical manifest schema and `launch_index.json` convention.

## Session tip override pattern

```js
// inside launch fragment (conceptual)
await navi("mount torus/example/notes/modules/notes_init.js");
await navi.storage.tip.set({
  ib: "notes:session:flow_artifact",
  // …stamp / data: logical route string, optional pot addr…
  data: { value: "torus/example/notes/flow/notes_editor_first.json" },
});
// or tip sugar: await navi.storage.item.set("notes:session:flow_artifact", FLOW);
await navi("notes_init bootstrap"); // park leaf = register().name
```

Config tip’s `flow_artifact` remains the default for bootstrap without a launch override.

Prefer writing the session tip **before** bootstrap so Manager.loadFlow sees it.

## Dynamic module shopping

Manager + registry API stay stable. Behind them:

- parse module A vs B
- view template module A vs B
- edit-policy module A vs B

Pages keep calling the same Manager methods. Config (or a System-like screen) selects which **hostpark** module path to `mount` (each becomes `navi:<name>`).

This matches the navi style: resting tools; Manager picks and chooses; callin is park commands.

## Builder vs hand forks

Hand forks accumulate drift: features land on one layout and never propagate.

Prefer:

- declare instances with a why
- compose from concepts/fragments
- generate flow/launch from base + patch when only a few facts differ

Keep working hand-authored instances declared until builder-generated equivalents are validated; cut over deliberately. “Mainline” is a role (which launch people bookmark), not a sacred filename.

## Variant inherit without a builder

Even without codegen, keep discipline:

- new local file for a new screen variant (don’t overwrite the shared default unless intended)
- new or patched flow pointing the route key at it
- new launch setting that flow via session tip
- register paths in the project manifest / catalog
- plant body tips at the **same bare ib** as the hostpark route (same ib as surf/fetch) for local-first; Manager refreshes when UX wants

## What “dynamic” means here

Authors and runtimes may:

- publish new flows/instances at any time on hostpark
- point sessions at them (session tip) without redeploying foobarch itself
- mount alternate modules from hostpark mid-product (new park tips; remount via `navi:mod`)
- compose programs from family instances that did not exist when the Manager was first written

The Manager should resolve routes and modules from published data + tips, not from a closed compile-time enum of all possible products.

## Related

- [composition.md](composition.md)
- [flow-artifacts.md](flow-artifacts.md)
- [ethos.md](ethos.md)
- [runtime.md](runtime.md)
