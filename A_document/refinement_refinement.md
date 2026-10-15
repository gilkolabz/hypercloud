# navi_style — refinement

## One sentence

navi_shell is a local-first runtime that keeps logic and state in the client, loads capability as modules at runtime, and drives everything through a text stream — presentation is an embellishment layered over a programmatically complete core.

## Principles that held

These carried through every redesign and remain the spine:

1. **Text streams are the universal interface.** Every affordance is reachable through `callin`/`callout`. UI is optional presentation over that surface, never the only door to a capability.
2. **One job per module.** Modules provide resting capability; they compose; they do not orchestrate the journey. The Unix spirit, restated in navi terms.
3. **DRY against the platform.** Prefer the runtime, storage, and existing host proposals over a new server or a parallel framework. New infrastructure needs a capability the current stack genuinely lacks.
4. **UX rides a spectrum of programmatic soundness → presentation richness.** Build the sound core first; extend outward into richer presentation in modular, separable steps.
5. **Local-first identity.** Whoever writes a frame stamps it in their own wall time and offset; peers convert if they ever need to. No shared clock, no borrowed timezone.
6. **Standardize as you discover.** The ecosystem is still learning how its own pieces interoperate; fold new coherence back into the shared vocabulary rather than forking a private one.

## Refinements (what the intentions became)

### Storage is one space: tips + bins

The parent doc left storage abstract. It resolved into a single manifest space. A **tip** is only a pointer to the latest `ib^gib`; frames live in a shared frame space, so every generation stays addressable. `mut8` stamps a new generation and moves the pointer. `item` and `file` are **sugar over tip+bin**, not separate stores — treat them as convenience, and reach for tip frames + `rel8ns.bin` when you care about the ledger.

Generalized principle: *state has one authoritative shape; ergonomic APIs are shims that write into it, never side stores that drift.*

### Local-first is enforced, not assumed

"Keep logic and state in the client" became a concrete gate: `navi.park.check(path)` resolves a local tip before the network is consulted, and the service worker calls it on same-origin GETs so local tips win over host routes. Being local-first is now a runtime behavior, not a coding convention.


### callin is park dispatch, not a flat registry

"Everything is reachable programmatically" hardened into a rule: the first token is a park under `navi:`, the remainder is passthrough, and the park must be planted and listed on `navi:mod`. Sibling verbs that are not parks are reached via `navi.mod.<name>.commands.…`. Do not attach your own top-level `callin` listener for verbs — dispatch owns that.

### Durable capability across restarts

Modules and service-worker plugins survive termination: `navi.remount()` restores parks listed on `navi:mod`, and SW plugins persist and rehydrate on restart. A capability that vanishes when a worker idles out is a bug, not a lifecycle. Design module side effects to be re-established idempotently, and clean them in `onUnmount`.

## Scope note

This document generalizes; it does not restate the API. For exact affordances, storage calls, bootstrap order, and the surf verbs, the README is authoritative. When the runtime gains a new composition or storage affordance, extend the README first, then distill the principle here.