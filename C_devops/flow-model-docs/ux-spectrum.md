# UX spectrum

UX sits on a spectrum from programmatic soundness to presentation richness. The flow model asks you to place each concern on a level so modules stay resting and composable.

Levels are per-project labels. The numbers below are a common template, not a rigid global enum — rename in your `devguide.md`, but keep the progression.

## Template levels

- L0 — Data & contracts — Schemas, seed JSON, derived maps
- L1 — Logic / registry — CRUD, lookup, facts; tip APIs; park commands if needed; no DOM
- L2 — Device affordances — Camera, OCR, sensors, files
- L3 — HTML pages — One fragment per screen role
- L4 — Flow + Manager — Active flow JSON; `go`; policy; session tips
- L5 — Resting UI capability — Page helpers / small modules invoked on demand
- L6 — Document / media presentation — Sheets, overlays, paper frames, players
- L7 — Enrichment — AI parse, optional sync, fancy motion

When adding a feature: name the level, name what it depends on, update the project’s spectrum list.

## Placement rules of thumb

- If it is a fact about data, it is L1 (or L0).
- If it is which screen next, it is L4 (flow/Manager).
- If it is how one screen looks, it is L3 (and maybe L5/L6).
- If it is the **shared look** across screens and launches, it is still **L3**: one hostparked **product skin** CSS — not Manager, not a flow route, not L4.
- If it is optional behavior on a shared host, prefer flow `meta` + L5 module over forking L3.
- If it is device I/O, L2 — Manager navigates to a screen that uses it; the device module does not own the journey.

### Product skin (normative)

Every flow product should ship a shared L3 skin so screens and launches do not copy-paste `<style>` blocks.

| | |
|---|---|
| What | One CSS file: tokens + layout helpers for the product’s HTMF fragments |
| Where | Prefer `{root}/ui/{product}_skin.css` (same publish root as screens). Decorative banners/fonts stay under `assets/` |
| Publish | Hostpark bare logical route; plant tip at the same ib for local-first |
| Config | `flowerpot.skin_css` (or project equivalent) points at that route |
| Load | Each UI/launch fragment ensures a single `<link data-flow-skin="…">` in `document.head` via `navi.resolveUrl(skin)` — head survives surf |
| Not | Not a flow `routes` entry; not mounted as a navi module; Manager does not own look |

**One skin per session.** Head survives surf, so later screens must **no-op** when a product skin is already present. If you ship a skin *variant* (second CSS + new `data-flow-skin` id), either:

1. Point **every** route in that journey at fragments that load the same skin id, or
2. Keep shared screens **skin-preserving** — guard on a product prefix (e.g. `link[data-flow-skin^="tipunch"]`) and only inject the default skin on cold first paint.

**Anti-pattern:** fork look on launch/jobs only; leave area/punch/report injecting the default under a *different* `data-flow-skin` id. Both sheets sit in `head`; the second wins the cascade and look “falls apart” mid-journey. Flow `meta.skin` is documentation unless you wire it — the real contract is fragment `ensureFlowSkin`.

Screen-role HTML may keep a tiny page-local `<style>` only for one-off exceptions. Default: skin owns the look.

Example (ti_punch): `opry/devops/ti_punch/ui/tipunch_skin.css` — listed in program `layers.L3` and loaded by every `ui/*` + `launch/*` fragment.

## Spectrum and composition

Composition hierarchy (features → … → launches) applies across levels:

- L3/L6 fragments slot into hosts
- L4 flows patch meta/routes; session tips select the active flow
- L1/L2/L5 modules register as parks (`navi:<name>`) with Manager at runtime

Presentation extends outward from soundness; it should not collapse lower layers into one blob.

## Anti-patterns by level

- L1 opens DOM / surfs — Logic lost its voice; journey leaks downward
- L3 embeds three other screens’ HTML — Can’t swap; Manager can’t navigate
- Fat L4 module with all templates — Becomes the only edit surface; variants die
- L5 auto-listens to L1 events and navigates — Event spaghetti; bypasses policy
- Skipping L0/L1 “just to ship UI” — No programmatic core; UX cannot rest on facts
- Partial skin-variant rollout — New `data-flow-skin` on some screens; shared downstream screens still inject the default → two skins in `head`, cascade clash mid-journey

## Project docs

Each project should keep a living spectrum section in its own `devguide.md`. This file only defines the shared idea.

## Citations

- [A_document/_navi_style.md](../../A_document/_navi_style.md) — spectrum ethos
- [ethos.md](ethos.md)
- [glossary.md](glossary.md)
