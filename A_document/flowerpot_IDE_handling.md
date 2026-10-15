# Flowerpot IDE handling

How we version and publish files from the hypercloud IDE to the live flowerpot API at foobarch.net. This document covers the **torus mirror** case — publishing `A_document/` and `A_devops/{project}/` under a `torus/` route prefix. For arbitrary routes (e.g. Horizon testkit), see [Custom routes (B_devops)](#custom-routes-b_devops) below.

Related: [flowerpot/README.md](../flowerpot/README.md) (server API), [_style_refinement.md](_style_refinement.md) (design context).

## What this is for

Flowerpot is append-only versioned file storage. Each upload creates a new ibgib frame; prior frames stay addressable. We use it as the published mirror of IDE work — docs, modules, config, seed data, HTML — so foobarch and navi can fetch them at runtime without a separate deploy step.

Local edits live in the repo. Upload pushes a new frame to flowerpot. GET on the route always serves the latest frame unless you request a specific version by addr.

## What gets mirrored

Published to flowerpot:

- Everything under `A_document/`
- Everything under `A_devops/{project}/` subfolders (e.g. `A_devops/allenvethosp/`)

Not published:

- `A_devops/flowerpot_manifest.json` — local sync index only
- `A_devops/_upload_flowerpot.mjs` — local upload script only
- `B_devops/`, `foobarch/`, and other repo paths outside the mirror scope

Flowerpot has no directory listing. We track known routes ourselves in the manifest.

## Route mapping

IDE path and flowerpot route share the same folder structure after a `torus/` prefix:

```
IDE:  hypercloud/A_document/flowerpot_IDE_handling.md
URL:  https://foobarch.net/flowerpot/torus/A_document/flowerpot_IDE_handling.md

IDE:  hypercloud/A_devops/allenvethosp/config.json
URL:  https://foobarch.net/flowerpot/torus/A_devops/allenvethosp/config.json
```

At runtime, project code usually fetches via relative `/flowerpot/torus/...` on the same origin as foobarch.

## The two A_devops files

All flowerpot sync tooling for IDE work lives at the `A_devops/` root (not inside individual projects).

### flowerpot_manifest.json

Local index of what we publish. Contains:

- `meta` — flowerpot base URL, path prefix (`torus`), last updated date
- `tokens.unused` — single-use upload tokens ready to spend
- `tokens.used` — audit log of token, route, frame addr, timestamp
- `paths` — keyed by IDE-relative path (forward slashes)

Each path entry looks like:

```json
"A_devops/allenvethosp/config.json": {
  "flowerpot_route": "torus/A_devops/allenvethosp/config.json",
  "latest_addr": "flowerpot:torus/A_devops/allenvethosp/config.json^feddf5c2...",
  "frames": [
    { "addr": "flowerpot:...", "at": "2026-07-05T22:27:47.225Z" }
  ]
}
```

When you add a new file to a mirrored folder, register it here before first upload. Copy an existing entry and change the keys and route.

### _upload_flowerpot.mjs

Node script that reads the manifest, uploads file contents via the flowerpot API, consumes one token per upload, and writes back updated addrs and token state.

Run from `A_devops/` or pass paths relative to the hypercloud repo root (the script resolves from parent of `A_devops/`).

## Upload commands

Upload everything in the manifest that has never been uploaded:

```
node A_devops/_upload_flowerpot.mjs
```

Upload specific paths (must already be registered in manifest):

```
node A_devops/_upload_flowerpot.mjs A_devops/allenvethosp/devguide.md A_document/_style_refinement.md
```

Force re-upload even if `latest_addr` already exists (use after editing a file that was previously published):

```
node A_devops/_upload_flowerpot.mjs --all A_devops/allenvethosp/devguide.md
```

The script skips paths not in `manifest.paths`. It does not auto-register new files — add them to the manifest first.

Each successful upload:

1. POSTs JSON `{ content, content_type }` to `https://foobarch.net/flowerpot/{flowerpot_route}`
2. Sends header `X-Flowerpot-Usage-Token` with one token from `tokens.unused`
3. Records the returned `ib^gib` addr in `latest_addr` and appends to `frames`
4. Moves the token from unused to used

If unused tokens run out during upload, the script can mint more automatically — but only if `FLOWERPOT_PASSWORD` is set in the environment (see below).

## Minting tokens

Upload tokens are single-use. Mint a batch and store them in the manifest — never store the usage password in the repo.

Set the password in your shell session (ask the project owner; do not commit it):

```
# PowerShell
$env:FLOWERPOT_PASSWORD = "..."

# bash
export FLOWERPOT_PASSWORD="..."
```

Mint tokens (default 25, max 100):

```
node A_devops/_upload_flowerpot.mjs --mint 25
```

This POSTs to `https://foobarch.net/flowerpot/_flowerpot/tokens` with header `X-Flowerpot-Usage-Password` and appends the returned token strings to `manifest.tokens.unused`.

Commit the manifest after minting (tokens yes, password never).

Manual mint via curl is also fine if you prefer; the script is just convenience.

## Reading published content

Latest version:

```
GET https://foobarch.net/flowerpot/torus/A_devops/allenvethosp/config.json
```

Specific frame:

```
GET https://foobarch.net/flowerpot/torus/A_devops/allenvethosp/config.json?addr=flowerpot:torus/A_devops/allenvethosp/config.json^feddf5c2...
```

List version history for a route:

```
GET https://foobarch.net/flowerpot/_flowerpot/versions?route=torus/A_devops/allenvethosp/config.json
```

Admin version listing requires the usage password header. Public reads work for unprotected frames.

## Typical workflow

Starting a new project under `A_devops/myapp/`:

1. Create files locally (readme, devguide, modules, config, etc.)
2. Add each publishable path to `flowerpot_manifest.json` under `paths`
3. Ensure `tokens.unused` is not empty (mint if needed)
4. Run `node A_devops/_upload_flowerpot.mjs` for first publish
5. After edits, run with `--all` on changed paths to push new frames
6. Commit IDE files and the updated manifest together

Day-to-day on an existing project:

1. Edit files under `A_devops/{project}/` or `A_document/`
2. Upload changed paths with `--all`
3. Commit manifest if addrs or token counts changed

Commit the IDE files and the updated manifest together.

## Custom routes (B_devops)

The torus mirror above is only one publishing pattern. Runtime artifacts often live at **explicit flowerpot routes** that do not match IDE paths — for example Horizon’s testkit:

| Local file | Flowerpot route |
|------------|-----------------|
| `B_devops/horizon_imp/template/horizon_v1.js` | `hypercloud/horizon/testkit/v1` |
| `B_devops/horizon_imp/data/manifest_test_1.json` | `hypercloud/manifest/testkit/v1` |

Use `B_devops/_pot_routes.mjs` to PUT any `route=local-path` pairs. Tokens come from `B_devops/flowerpot_tokens.json` (same store as `_pot_repo_torus.mjs`), not `A_devops/flowerpot_manifest.json`.

```
node B_devops/_pot_routes.mjs hypercloud/horizon/testkit/v1=B_devops/horizon_imp/template/horizon_v1.js hypercloud/manifest/testkit/v1=B_devops/horizon_imp/data/manifest_test_1.json
```

Pass as many `route=path` args as you need. Mint via `FLOWERPOT_PASSWORD` if spare tokens run out (same as torus potting).

Live URL: `https://foobarch.net/flowerpot/{route}`

Do **not** use `_pot_repo_torus.mjs` for these — that script always prefixes `torus/` and walks whole trees.

## Content types

The upload script sets content type from extension for ordinary mirrored files:

- `.json` → application/json
- `.md` → text/markdown
- `.js` → application/javascript (plain scripts only)
- other → text/plain

**Navi modules are different.** If the file is a Navi module (`export const register = …`, or legacy `moduleInfo` + default export), do **not** publish it as `application/javascript`. Upload with PUT and:

```
Content-Type: application/navi-module
```

Send the raw `.js` body (not a JSON `{ content, content_type }` POST). Surf and navi storage use this MIME to save/auto-mount modules. See [navi_modules_guide.md](navi_modules_guide.md) (Content type section).

The `_upload_flowerpot.mjs` extension map currently defaults `.js` to `application/javascript` — for navi modules, PUT manually (or extend the script) with `application/navi-module`.

For other binary files, use PUT with the flowerpot API directly or extend the script.

## Security notes

- Usage password: env var only, never in git, never in this doc
- Upload tokens: safe to store in manifest (single-use, consumed on upload)
- The manifest itself is not published to flowerpot — it is team-local bookkeeping

## Quick reference

```
# Mint tokens (needs FLOWERPOT_PASSWORD in env)
node A_devops/_upload_flowerpot.mjs --mint 25

# First upload / catch up unuploaded paths
node A_devops/_upload_flowerpot.mjs

# Re-publish after edits
node A_devops/_upload_flowerpot.mjs --all A_devops/allenvethosp/devguide.md

# Live URL pattern
https://foobarch.net/flowerpot/torus/{same path as IDE after hypercloud/}
```
