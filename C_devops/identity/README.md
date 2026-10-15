# foobarch identities (foobarch_host tip publishers)

Multiple write-gate identities under this folder. Shared stock schema
`foobarch.schema.keys.v1`; each identity has its own owner key + policy ib.

Select with `--identity NAME` on `_publish.mjs` / `_wipe.mjs` / `_shape.mjs`
(default: `foobarch`). Known: `foobarch`, `hypertext`, `torus`.

## foobarch (default)

Write-gate for publishing **root tips** on
[`foobarch_host`](../../B_native_mods/foobarch_host/README.md)
(default `localhost:5353`; live also `https://foobarch.net`):

- `/navi_shell.js`, `/sw.js`, `/favicon.ico` — bin parks
- `/humans.txt`, `/robots.txt`, `/security.txt`, `/manifest.json` — short bin parks
  (from `foobarch/static/`)
- `/torus/text/spawn/enter` — bin park of `B_fragments/data/enter.html`
- `/torus/text/spawn/{welcome,bulletinboard,flowerpot_faq,gadgets,hypernetizenwarez,intro,phonebooth}` — same pattern from `B_fragments/data/*.html`
- `/torus/text/spawn/pages/{caniuseflowerpothere,whatisflowerpot}` — from `B_fragments/data/pages/*.html`
- `/mimex` — proxy park → `https://xomud.quest/mimex` (keep key on target)
- `/arbiter` — proxy park → `https://xogilko.online/arbiter` (GET+POST, default POST)
- `/fusion` — proxy park → `https://xogilko.online/fusion` (GET+POST, default POST)
- `/flowerpot` — proxy park → `https://xomud.quest/flowerpotv2` (GET+POST+PUT+DELETE); foobarch commit via **PATCH**
- `/devops_feedback_host_v1` — proxy park → `https://usernet.cloud/devops_feedback_host_v1`
- `/fofum` — proxy → `https://xomud.quest/fofum` (GET+POST+DELETE)
- `/phonebook` — proxy → `https://usernet.cloud/phonebook`
- `/torus_faucet` — proxy → `https://usernet.cloud/faucet` (classic custom path)

## hypertext

Separate identity for fragment tips under `hypertext/*` (same HTML sources as
spawn). Policy ib: `policies/hypertext`. Does **not** re-lock the shared schema
(foobarch owns that); only links it.

- `/hypertext/{enter,welcome,bulletinboard,flowerpot_faq,gadgets,hypernetizenwarez,intro,phonebooth}`
- `/hypertext/flowerpot_faq/pages/{caniuseflowerpothere,whatisflowerpot}.html`

```bash
node C_devops/identity/_publish.mjs --yes --identity hypertext
node C_devops/identity/_wipe.mjs --yes --identity hypertext
```

## torus

Write-gate for **torus** parks: testkit HTMFs, flow-model docs, ecosystem docs,
and devops mods. Policy ib: `policies/torus`. Does **not** re-lock the shared
schema. Catalog: [`_lib.mjs`](_lib.mjs) (`TORUS_ASSETS`, `FLOW_MODEL_HTMF_ASSETS`,
`ECOSYSTEM_HTMF_ASSETS` from [`../flow-model-docs/_catalog.mjs`](../flow-model-docs/_catalog.mjs)
and [`../htmf-ecosystem/_catalog.mjs`](../htmf-ecosystem/_catalog.mjs)).

### Testkit HTMFs (`C_devops/fragment/`)

- `/torus/testkit/text_editor`
- `/torus/testkit/tablemaker`
- `/torus/testkit/notemaker`
- `/torus/testkit/legacy/notemaker_v1`
- `/torus/testkit/tinyviewport`
- `/torus/testkit/relaytest`
- `/torus/testkit/storagetest`
- `/torus/testkit/scripter`
- `/torus/testkit/fofum`

Clone parks (same bytes, `data-path` rewritten): `testkit/{text_editor,tablemaker,notemaker,legacy/notemaker_v1,tinyviewport,relaytest,storagetest,scripter,fofum}`.

### Devops / native mods

- `/torus/testkit/mod/fsdevopstracker` — `B_native_mods/fsdevopstracker.js` (`application/navi-module`)
- `/torus/testkit/mod/fsdevopstracker/readme` — `C_devops/fragment/navi_fsdevopstracker_readme.html`
- `/torus/testkit/native/fofum_server` — `B_native_mods/fofum_server.js` (`application/navi-module`)
- `/torus/testkit/mod/scranton_lobby_v1_client` — torus copy of the lobby client; the install path is the `scranton_lobby` park (`C_devops/mods/_pot_all.mjs --only scranton_lobby`)
- `/testkit/surfroster` — `C_devops/scranton/scranton_lobby_v1_surfroster.html` (lobby roster HTMF)

### Scranton lobby tips (not in this catalog)

Doc: [`C_devops/scranton/scranton_lobby_v1.md`](../scranton/scranton_lobby_v1.md).

- `/scranton/lobby/v1/schema`, `/scranton/lobby/v1/policy`, `/scranton/lobby/v1` (governor, `rel8ns.genesis_policy`) — `C_devops/scranton/_hostpark_lobby_v1.mjs`; owner-gated by `policies/foobarch-shell`
- `/sprinter` — capture relay park → `sprinter_server` on navi `sprinter_vps3` — `C_devops/identity/_hostpark_sprinter_relay.mjs --alias sprinter_vps3`; owner-gated by `policies/foobarch-shell`

Legacy tombstone: `torus/testkit/fsdevopstracker.js` (do not use).

### Host / flowerpot catalogs

- `/torus/host-catalog` — `C_devops/fragment/torus_host_catalog.html` (known hostpark `ib` index)
- `/torus/flowerpot-catalog` — `C_devops/fragment/torus_flowerpot_catalog.html` (known flowerpot routes; regenerate via `node C_devops/fragment/_collect_flowerpot_routes.mjs --write-html`)

### Linux native shell

- `/torus/linux/navi_shell-linux-x64` — pkg ELF (`navi_shell/navi_shell-linux-x64`)
- `/torus/linux/navi_shell.sh` — bootstrap installer (`C_devops/identity/linux/navi_shell.sh`)

```bash
curl -fsSL https://foobarch.net/torus/linux/navi_shell.sh | bash
# or:
FOOBARCH_HOST=https://foobarch.net node C_devops/identity/_publish.mjs --yes --identity torus linux/navi_shell-linux-x64
FOOBARCH_HOST=https://foobarch.net node C_devops/identity/_publish.mjs --yes --identity torus linux/navi_shell.sh
```

### Flow-model docs (`C_devops/flow-model-docs/htmf/`)

- `/torus/devops/flow-model/readme` (index)
- `/torus/devops/flow-model/{overview,runtime,flow-artifacts,manager,composition,variants,addressing,ux-spectrum,authoring,ethos,glossary}`

### Ecosystem docs (`C_devops/htmf-ecosystem/`)

- `/torus/docs/readme` (index)
- `/torus/docs/{hostparking,foobarch-usage-budgets,navi-style,style-refinement,navi-shell,navi-modules-guide,navi-units,manifest,navi-park-addressing}`

### Publish

```bash
# all torus catalog assets
node C_devops/identity/_publish.mjs --yes --identity torus

# flow-model + ecosystem HTMFs only
node C_devops/flow-model-docs/_hostpark.mjs --yes

# subsets
node C_devops/identity/_publish.mjs --yes --identity torus mod/fsdevopstracker
node C_devops/identity/_publish.mjs --yes --identity torus mod/fsdevopstracker/readme
node C_devops/identity/_publish.mjs --yes --identity torus native/fofum_server
node C_devops/flow-model-docs/_hostpark.mjs --yes flow-model/runtime ecosystem/hostparking

node C_devops/identity/_wipe.mjs --yes --identity torus
node C_devops/identity/_shape.mjs --identity torus
```

Inventory (no network): `node C_devops/identity/_shape.mjs --identity torus`

Not flowerpot snowcone (`torus/hypernet/navi/snowcone/…`) and not a
hypernetizen-style attestation tip. Those are different jobs. Project deploy
paths (e.g. `opry/devops/ti_punch/…`) are pushed via **fsdevopstracker**
`hostpark-push`, not this catalog.

## Layout

```
C_devops/identity/
  foobarch_owner.json     — PRIVATE ed25519 (gitignored)
  foobarch_public.json    — public half (safe to commit)
  hypertext/
    owner.json            — PRIVATE (gitignored)
    public.json           — public half
  torus/
    owner.json            — PRIVATE (gitignored)
    public.json           — public half
  frames/                 — canonical tip / envelope JSON (not demos)
  _lib.mjs                — shared tip + envelope builders + getIdentity()
  _shape.mjs              — dry-run dump (no network)
  _publish.mjs            — PUT to foobarch_host (requires --yes)
  _migrate_park_method.mjs — data.http → data.method (legacy)
  _migrate_park_claim.mjs — park:true/precedence → park capture|defer
  _wipe.mjs               — admin hard-delete (--identity scoped)
```

## What gets published

Shell assets are **not** raw file PUTs. The host stores an **ibgib frame tip**
that parks a path and declares HTTP controls; bytes live in the bin table.

```
PUT /navi_shell.js  (commit envelope)
        │
        ▼
 tip frame  parts: network_proposal, ibgib_frame, manifest, json
        │  park + http.GET.kind=bin
        ▼
 rel8ns.bin → "bin <sha256>" → bin table bytes

GET /navi_shell.js → park resolve → same tip → bin bytes
```

### Tip frame

```json
{
  "ib": "navi_shell.js",
  "gib": "<sha256_of_bytes_UPPERCASE>",
  "data": {
    "parts": ["network_proposal", "ibgib_frame", "manifest", "json"],
    "park": "defer",
    "content_type": "application/javascript; charset=utf-8",
    "default_method": "GET",
    "method": {
      "GET": { "kind": "bin" },
      "PUT": { "kind": "commit" }
    },
    "n": 0,
    "timestamp": "…"
  },
  "rel8ns": {
    "bin": ["bin <sha256_lowercase>"],
    "policy": ["policies/foobarch-shell^…"],
    "past": [],
    "tjp": [],
    "dna": []
  }
}
```

Same for `sw.js`. Favicon uses `content_type: "image/x-icon"`.

Omit `data.seed` (host `seed` sets that; identity publishes do not).

### What `data.method` means

`method` is only the **verb → handler** map — not the full response recipe.
Content-type, park path, and bytes live in `content_type` / `park` /
`rel8ns.bin` (or the commit envelope’s `bin`).

For shell assets, `{ "GET": { "kind": "bin" } }` is enough: serve the tip’s
bin. Host kinds: `bin`, `frame`/`manifest`, `proxy` (+ `target`), `redirect`,
`commit` (PUT), and `lua` (script tip + `handle()`).

**Accept-frame (borrow):** `GET` with
`Accept: application/eframe` alone (legacy `application/ibgib+json`) returns the tip
frame JSON even when the park’s default GET kind is `bin`. Response
`Content-Type: application/eframe` and `X-Foobarch-ib^gib`. Accept priority among
content classes is **html > text > eframe** — eframe is not attached beside other
bodies. `Accept: application/navi-mod` on `kind: mod` returns `multipart/related`
(eframe + addressed bin). Default GETs without those Accept types still serve the payload.

### Richer GET (Lua) — browser / Edge sketch

Keep the route tip thin; put branching in a **script tip**.

**Route tip** points at a Lua handler instead of serving bin directly:

```json
"method": {
  "GET": { "kind": "lua", "script": "scripts/navi_shell_get^ABC…" },
  "PUT": { "kind": "commit" }
}
```

**Script tip** `scripts/navi_shell_get` — body is `text/x-lua` (often via
`rel8ns.bin`).

**Host → Lua** (request + remainder + tip in):

```lua
-- global req (or handle(req) arg)
req = {
  method = "GET",
  path = "/navi_shell.js",
  remainder = "",
  headers = { ["user-agent"] = "…Edg/…" },
  query = {},
  tip = { ib = "navi_shell.js", addr = "…", data = { … }, rel8ns = { … } },
}
-- host.get_bin("ac45…") → bytes (same spirit as flowerpot schema host APIs)
```

**Lua → Host** (response out) — e.g. Edge gets a different build:

```lua
function handle(req)
  local ua = req.headers["user-agent"] or ""
  if string.find(ua, "Edg/", 1, true) then
    return {
      status = 200,
      content_type = "application/javascript; charset=utf-8",
      bin = "bin <edge-build-sha>",
      headers = { ["X-Foobarch-Variant"] = "edge" },
    }
  end
  return {
    status = 200,
    content_type = "application/javascript; charset=utf-8",
    bin = req.tip.rel8ns.bin[1],  -- default tip bin
  }
end
```

```
GET /navi_shell.js
        → route tip  http.GET.kind=lua
        → load scripts/navi_shell_get
        → Lua handle(req)
        → status + bin/body + headers
```

Identity publishes today stay on `kind: "bin"`. Lua is how you’d later vary
by User-Agent (Edge vs others), remainder, etc. without stuffing match tables
into every shell tip.

### Park capture vs defer

Shell tips use default **defer** (`longest` park wins). A shallower tip can
instead **capture** so deeper parks never steal the request — full remainder
stays with that claimer (for proxy/lua):

```json
"park": "capture"
```

See [foobarch_host park routing](../../B_native_mods/foobarch_host/README.md#park-routing).

### Proxy tips (keep vs strip)

Park always peels the tip ib into **remainder**. Proxy joins
`target + "/" + remainder`. So **keep key** means put the key on `target`;
**strip** means origin only:

| Intent | Example `target` | `/mimex/foo/--/bar` forwards to |
|--------|------------------|----------------------------------|
| keep | `https://xomud.quest/mimex` | `…/mimex/foo/--/bar` |
| strip | `https://xomud.quest` | `…/foo/--/bar` |

Canonical frames:
[`frames/mimex.frame.json`](frames/mimex.frame.json) — capture park + keep to xomud.quest;
[`frames/arbiter.frame.json`](frames/arbiter.frame.json) /
[`frames/fusion.frame.json`](frames/fusion.frame.json) — same keep pattern to xogilko.online,
`default_method: POST`, both GET and POST proxy;
[`frames/flowerpot.frame.json`](frames/flowerpot.frame.json) — keep to xomud.quest/flowerpotv2.

### Commit envelope (HTTP PUT body)

```json
{
  "transform": "firstGen",
  "newIbGib": { /* frame above */ },
  "dnas": [],
  "intermediateIbGibs": [],
  "bin": {
    "sha256": "<same sha lowercase>",
    "bytes_b64": "<file bytes>",
    "content_type": "application/javascript; charset=utf-8"
  }
}
```

| Rule | Detail |
|------|--------|
| Usage token | `X-Foobarch-Usage-Token` on every PUT |
| Path | URL path ib must equal `newIbGib.ib` |
| firstGen | No existing tip (or tip tombstoned) |
| mut8 | `rel8ns.past` includes current tip addr |
| Policy | After first publish, tips link `rel8ns.policy`; mut8 needs `X-Flowerpot-Sign-Keys` / `X-Flowerpot-Signatures` over `proposal-write-v1` (foobarch_host). Flowerpot pots keep `flowerpot-write-v1`. |

### Schema + policy tips

Schema ib: `foobarch.schema.keys.v1` (Lua `authorize()`, `text/x-lua` bin).

Policy ib: `policies/foobarch-shell` — params for that schema.

```json
{
  "ib": "policies/foobarch-shell",
  "data": {
    "parts": ["keys_policy", "ibgib_frame", "manifest", "json"],
    "schema_ib": "foobarch.schema.keys.v1",
    "threshold": 1,
    "keys": ["<owner publicKey x>"]
  },
  "rel8ns": {
    "schema": ["foobarch.schema.keys.v1^…"],
    "policy": ["policies/foobarch-shell^…"]
  }
}
```

Host runs Lua from the schema tip only (no embedded JS keys gate). Bootstrap in
`_publish.mjs`: schema open → policy open (link schema) → lock policy under
itself → lock schema under policy → publish tips with `rel8ns.policy`.

## Defaults

| Setting | Value |
|---------|--------|
| Host | `http://localhost:5353` |
| Assets | `foobarch/static/{navi_shell.js,sw.js,favicon.ico}` |
| Usage password (mint) | `FOOBARCH_USAGE_PASSWORD` (local only; not stored in this repo) |

## Commands

Wipe prior identity tips (admin hard-delete), then republish:

```bash
$env:FOOBARCH_HOST = "https://foobarch.net"
node C_devops/identity/_wipe.mjs --yes
# remount foobarch_host v0.2.1+ (schema-only gates), then:
node C_devops/identity/_publish.mjs --yes
# hypertext fragments:
node C_devops/identity/_publish.mjs --yes --identity hypertext
```

Inspect shape only (no network):

```bash
node C_devops/identity/_shape.mjs
node C_devops/identity/_shape.mjs --include-bytes
node C_devops/identity/_shape.mjs navi_shell.js
node C_devops/identity/_shape.mjs --identity hypertext
```

Publish (explicit gate):

```bash
node C_devops/identity/_publish.mjs --yes
node C_devops/identity/_publish.mjs --yes navi_shell.js
node C_devops/identity/_publish.mjs --yes mimex
node C_devops/identity/_publish.mjs --yes arbiter
node C_devops/identity/_publish.mjs --yes fusion
node C_devops/identity/_publish.mjs --yes flowerpot
node C_devops/identity/_publish.mjs --yes devops_feedback_host_v1
node C_devops/identity/_publish.mjs --yes horizon
node C_devops/identity/_publish.mjs --yes --identity hypertext
node C_devops/identity/_publish.mjs --yes --identity hypertext enter
node C_devops/identity/_publish.mjs --yes --identity torus
node C_devops/identity/_publish.mjs --yes --identity torus text_editor
node C_devops/identity/_publish.mjs --yes --identity torus mod/fsdevopstracker
node C_devops/flow-model-docs/_hostpark.mjs --yes
```

Without `--yes`, `_publish.mjs` refuses to PUT.

## vs other shell publish paths

| Path | Shape |
|------|--------|
| foobarch_host (this folder) | `network_proposal` + `ibgib_frame` + bin + park |
| flowerpot snowcone | raw JS under `torus/hypernet/navi/snowcone/…` |
| classic foobarch_server | `STATIC_FILE` proposal |

See also: [A_document/manifest.md](../../A_document/manifest.md), host seed in `B_native_mods/foobarch_host.js`.
