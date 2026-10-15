# Addressing and publishing

How artifacts are named, stored, and fetched. **navi_shell terms win** on collision — see [glossary.md](glossary.md).

## Two worlds, one product

| Concern | navi_shell | Flow-model default |
|---------|------------|--------------------|
| Live / local truth | tip + tip frame (`ib^gib`) + bin | Session, config, planted flow JSON, module parks |
| Published product bytes | **hostpark** on `navi.origin` | Same logical route; signed tip commits |
| In-app navigation | surf / park.check | Flow `routes` → HTML URLs; Manager.go |

Do not call a hostpark generation a “frame.” That word means **tip frame** in navi_shell. Remote history is a **hostpark addr** (`x-foobarch-ib^gib`).

## Three layers of identity (authoring)

- Integral typed id — Canonical authored id — e.g. `notes:flow:journey:list_direct`
- Branch / logical route — Path used by fetch & config — e.g. `torus/example/notes/flow/notes_list_direct.json`
- Hostpark addr — Immutable generation on a logical route — `route^…` (response `x-foobarch-ib^gib`)

Prefer: author the typed id; derive the logical route when the mapping is mechanical. Do not invent parallel hand-authored storage fields that drift from the id.

## Typed id shape (recommended)

```text
{product}:{kind}:{family}:{leaf}[@rev]
```

Examples:

- `notes:fragment:list:toolbar@r1`
- `notes:host:list:layout_compact@r1`
- `notes:instance:list:compact`
- `notes:flow:journey:list_direct`
- `notes:launch:journey:list_direct`
- `notes:program:list_first`
- `notes:module:core:manager`

`variant_of` and `compose` fields should reference typed ids, not ephemeral map keys.

## Logical route vs transport URL

- config, session tip values, logical routes — e.g. `opry/…/flow/….json` (bare park ib; **no** `/flowerpot` in the stored string)
- flow `routes.*`, `surf(url)` — transport URL on `navi.origin`, e.g. `/opry/…/ui/….html` (leading slash + same logical path)

Same hostpark artifact; two presentations (pointer string vs origin URL). Document both; do not treat them as unrelated naming schemes.

**Do not** client-prefix `/flowerpot/` onto logical routes. `navi.resolveUrl(logical)` is the mechanical resolve. Flowerpot transport is alternate only.

## One tip layer (local-first; UX guides how)

Session pointers, config, flow JSON, UI bytes, and module parks are **the same tip space**. There is no “Manager-private bag” vs “park world.” Roles differ; the store does not.

**Local-first is the dominant design pattern:** plant what you run; park-check before network; warm tips are the default path. **UX is the guide for how that happens** — when to fetch, when to plant, when to refresh, what to keep hot — so the journey feels instant and coherent. Manager (and init) own that policy; they do not invent a second architecture.

### Same-ib cache → natural park passthru

`pathToParkIb("/opry/…/ui/list.html")` → tip ib `opry/…/ui/list.html`.

Plant cached bytes at **that** ib (`kind` bin/frame + bin). Then surf / `navi.fetch` / SW park-check hit local first and fall through to hostpark on miss — same path, no special case.

Logical route in a pointer tip is *which artifact*; the **body cache** belongs under the **same bare ib** as hostpark. Only if you intentionally use `/flowerpot/…` transport should the tip ib be `flowerpot/…`.

Hostpark on the origin for the logical route is the default push **and** fetch path for flow-model products. Client localpark at `navi/…` (mirror) or planted tips keeps relay/dev aligned with the same route shape.

### Manager cache policy (on top of local-first)

Manager may:

- prefer warm tips (local-first default)
- request via park/surf/fetch (localpark then host) when UX needs bytes or freshness
- plant or mut8 a tip after a successful fetch
- keep pot addr / hash and refresh when UX wants an update
- skip network when a warm tip is good enough

That policy serves local-first *and* UX. It does not invent another storage layer.

Module remount stays tip-native: mount plants `navi:<name>` + bin; `navi.remount()` restores from `navi:mod`.

## Publish everything that matters

Eventually first-class routes for:

- fragments, hosts, instances
- flows, launches
- modules, schemas, data indexes
- programs / catalogs
- paradigm docs — `torus/devops/flow-model/*` (hostpark HTMF)

That preserves lossless devops history and enables future composition. Generated outputs are still first-class ids that accumulate pot addrs.

## Manifest / catalog

Flowerpot cannot always list “all paths.” Projects maintain an index:

- local sync manifest (tokens, paths, latest pot addrs)
- optional `artifact_type` on entries: `launch`, `flow`, `ui`, `module`, `data`, `doc`, `schema`, `config`, `assets`, `qa_index`, `graph`, …

### `assets` (not `ui`)

Static visual / audio / font bytes that **support** a screen or launch — banners, icons, product art — are **`assets`**, not screen-role HTML.

- Folder: prefer `assets/` under the product root (aliases `art/`, `media/` also classify as `assets`)
- Publish like any other product byte: hostpark at `{route_prefix}/assets/…`
- Reference from UI/launch via hostpark (or planted) URL — do **not** put banner images under `ui/` or invent a flow route for them
- fsdevopstracker indexes these as `artifact_type: assets` (also common image/font/audio extensions outside those folders)

### Product skin (L3 CSS — not `assets`, not a flow route)

Shared look for all screens/launches is a **product skin**: hostparked CSS, usually `{route_prefix}/ui/{product}_skin.css`.

- Classify as `artifact_type: skin` (or `ui` if your indexer only knows folder shapes)
- List in program `layers.L3` and config `flowerpot.skin_css`
- Fragments load via `navi.resolveUrl` into `document.head` (`data-flow-skin`)
- Do **not** invent a flow `routes` key for CSS; do **not** treat skin as decorative `assets/`

Product-level catalogs (`artifacts.json`, `programs.json`, family instance files) are the canonical composition graph. Launch indexes point at programs/flows for QA and PWA start URLs.

## Write gates and tokens

Publishing uses hostpark usage tokens / policies (project-specific). Store tokens in a stash tip, never passwords in chat. Minting is external (faucet / devops scripts). Identity publish: `C_devops/identity/_publish.mjs`.

## Legacy names

Old published history may keep naming drift (“frame” for pot history, mixed roots). New work: **tip frame** vs **pot addr**; typed-id → derived logical route; plant session/config/flow as tips. Repot when it clarifies; do not rewrite history casually.

Pre-adapt flowerpot snapshot: `flowerpot/devops/flow-model/*`. Current: hostpark `torus/devops/flow-model/*` via `_hostpark.mjs`.

## Related

- [composition.md](composition.md)
- [runtime.md](runtime.md)
- [glossary.md](glossary.md)
- [navi_shell/README.md](../../navi_shell/README.md)
- [A_document/hostparking.md](../../A_document/hostparking.md) — optional origin park publishes
