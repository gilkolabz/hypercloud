# Runtime environment

The flow model sits on foobarch + navi_shell + **hostpark**. This page names the runtime facts the model depends on — in **current** navi_shell terms (tip/park/callin). Units exist in the shell but flow products assume one session per navi window and do not design against them.

## Stack (bottom → top)

1. foobarch — origin dispatch server; serves the browser shell and hostpark routes.
2. Browser shell — loads `navi_shell.js` once. Body content may change; navi does not.
3. navi_shell — JS runtime: tip+bin storage, mount, callin (park dispatch), module registry.
4. surf — in-app navigation: fetch HTML from a route, parse, `document.body.replaceChildren`.
5. **hostpark** — default versioned push host for product artifacts on `navi.origin` (modules, flows, UI, schemas, assets).
6. Project modules + flow + UI (+ optional `assets/`) — what authors push; Manager drives the journey; tips hold session/local copies.

Flowerpot remains available as an alternate file-server surface; flow-model **push** defaults to hostpark.

## Shell persistence

While the user moves through a product:

- `navi` remains in the same window
- tip space persists session and application data
- Mounted modules stay mounted unless explicitly unmounted; ledger `navi:mod` + park tip bins support `navi.remount()` after reload
- Body HTML is ephemeral payload from hostpark (or a planted tip that wins park-check)

Deep links matter for entry (bookmark, PWA start URL, custom proposal). Inside a running session, prefer surf over full navigation so the runtime survives.

## Entry vs in-app move

- First paint / cold start — Shell may HTMX-bootstrap a fragment, or a launch fragment runs bootstrap script
- Step-to-step inside product — `navi.mod.surf.surf(url)` — not HTMX

Surf avoids hx-get load flicker for in-app steps. HTMX may still seed the first screen on entry.

## Hostpark as default artifact host

Projects **hostpark-push**:

- modules (`.js` navi modules, MIME `application/navi-module`)
- flow artifacts (`.json`)
- UI fragments (`.html` / HTMF)
- schemas, seed data, config, indexes

Each signed commit on a route appends a **hostpark addr**. Surf / fetch load latest unless UX requests a specific generation.

Hostpark does not invent variants. Authors create local files; push mirrors them to routes. Parallel variants = parallel paths (or parallel revisions), not overwrite-by-default.

See [addressing.md](addressing.md). Devops tooling: [fsdevopstracker readme](/torus/testkit/mod/fsdevopstracker/readme). Every push needs a real why — [devops-goals.md](devops-goals.md).

## Logical route vs transport URL

- **Logical route** — bare park ib, e.g. `torus/…/flow/notes_basic.json` or `opry/devops/ti_punch/flow/….json`. Stored in config / session tips. **Do not** invent a `/flowerpot/` prefix in Managers or launches.
- **Transport / surf URL** — same path as an origin URL: `navi.resolveUrl(logical)` → `https://{navi.origin}/{logical}`, or `/` + logical for relative surf (e.g. `/opry/…/ui/list.html`). Hostpark serves that tip.

Flowerpot is an **alternate** prefix park (`/flowerpot/{logical}`). Use it only when the artifact was deliberately potted there. Flow-model **default** is hostpark bare paths — push, fetch, mount, and plant tips all share the same logical ib.

See [addressing.md](addressing.md).

## Storage: one tip layer (local-first)

Authoritative store is tip + tip frame + bin. `navi.storage.item` / `file` are sugar only. Session, config, artifacts, and modules all live here — different ibs / roles, same layer.

| Role (examples) | Same layer |
|-----------------|------------|
| Active-flow pointer, pending ids, return-to | Tips (often project-prefixed) |
| Config defaults | Tip (often mirrored from hostpark JSON) |
| Flow JSON / UI / module bytes | Tips; **cache under the same bare ib as the hostpark route** (e.g. `opry/…/flow/….json`) |
| Mounted modules | `navi:<name>` + bin; ledger `navi:mod` |

**Local-first is the default:** plant what you run; park-check / surf / `navi.fetch` already do local tip → then network/host. Planting at the logical route’s tip ib makes that passthru automatic.

**UX guides how:** Manager chooses when to use a warm tip, when to refresh (e.g. hostpark addr moved), when to fetch on miss — so the journey feels right. Not a separate “selection store.”

“Which flow is active” is tip data (pointer to a logical route / typed id). The flow document itself is another tip at that logical ib. Both are tips; both participate in local-first.

## Callin and mount

- `navi("mount opry/…/modules/notes_init.js")` — surf install verb; fetches hostpark (or local tip), plants park tip from live `register().name`
- `navi("notes bootstrap")` — only if the init module’s park + `commands.bootstrap` exist (park dispatch, not a global registry)
- Prefer coherent names: module `name` / park leaf / default command key aligned (see navi modules guide)

Remount after reload: init_script / `await navi.remount()` restores `navi:mod.parks[]` from tip bins — not a separate “file cache” world. Prefer remounting product init/manager **from the hostpark route** when bytes may have moved (stale tip remounts keep old fetch helpers).

## Bootstrap shape

A cold start typically:

1. Wait for `navi` + storage (+ surf module)
2. `mount` project init module from its **bare hostpark** route (plants `navi:<initName>`)
3. Set session tip for which flow (and optionally program / manager module) to use
4. Callin bootstrap command: mount registry + Manager from hostpark, seed/plant flow if needed, `go(entry)`

Launch fragments own step 3. Config tip supplies the default when no session override is set. Managers resolve assets with `navi.resolveUrl(logical)` / origin `GET /{logical}` — never concatenate `/flowerpot/`.


## Citations

- [navi_shell/README.md](../../navi_shell/README.md)
- [navi_shell/docs/navi_modules_guide.md](../../navi_shell/docs/navi_modules_guide.md)
- [glossary.md](glossary.md)
- [A_document/_navi_style.md](../../A_document/_navi_style.md)
