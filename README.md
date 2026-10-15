# hypercloud

This repo is the source for [navi_shell](navi_shell) and [foobarch.net](https://foobarch.net). The host serves named pages, the shell, and the docs. The folders here are the files those names are published from.

## Basics

A name is an ib, a path such as `hypertext/welcome` or `torus/docs/readme`. The public hostpark copy is:

`https://foobarch.net/<ib>`

A GET of that URL returns the current generation hostparked under that name. A later publish moves the name. Pin one generation with `ib^gib`, where `gib` is the content hash of that generation.

navi_shell is the local runtime. It keeps tips and bins on the machine, mounts mods (js modules) at runtime. It comes with an embedded mod `surf` which helps to present and navigate hostparked representations. The local runtime namespace takes priority over the assigned host namespace (embedded default host is foobarch.net).

## Built on

| Library | Where |
|---|---|
| [ibgib](https://github.com/wraiford/ibgib) | Frame shape (`ib`, `gib`, `data`, `rel8ns`). Vendored as [ts-gib](https://gitlab.com/ibgib/ts-gib) in `flowerpot_v2/lib/ts-gib` and [B_testkit_mods/vendor/tsgib.min.js](B_testkit_mods/vendor/tsgib.min.js). |
| [htmx](https://github.com/bigskysoftware/htmx) 2.0.10 | [navi_shell/lib/htmx.min.js](navi_shell/lib/htmx.min.js). Hypertext pages swap with `hx-get`. |
| [eventemitter3](https://github.com/primus/eventemitter3) | `navi` emits `callin`, `callout`, and `surf`. |
| [wasmoon](https://github.com/ceifa/wasmoon) | Lua runtime in `flowerpot_v2`. |
| [fengari](https://github.com/fengari-lua/fengari) | Lua schemas in hostparkinator and the scranton lobby checks. |
| [SQLite](https://github.com/sqlite/sqlite) | [hostparkinator_5000.js](B_native_mods/hostparkinator_5000.js), the hosting server used at [foobarch.net](https://foobarch.net) bound to localhost:5353, stores tips through Node's `node:sqlite` (`hostparkinator_5000.sqlite`). |
| [esbuild](https://github.com/evanw/esbuild) | [navi_shell/build.js](navi_shell/build.js) writes `dist/navi_shell.js`. |
| [TypeScript](https://github.com/microsoft/TypeScript) | Shell source is [navi_shell/src/index.ts](navi_shell/src/index.ts). |

## Docs

Hosted pages and the files they are built from:

| Topic | On foobarch.net | In this repo |
|---|---|---|
| Doc index | [torus/docs/readme](https://foobarch.net/torus/docs/readme) | [C_devops/htmf-ecosystem/readme.html](C_devops/htmf-ecosystem/readme.html) |
| Hostparking | [torus/docs/hostparking](https://foobarch.net/torus/docs/hostparking) | [A_document/hostparking.md](A_document/hostparking.md) |
| Usage budgets | [torus/docs/foobarch-usage-budgets](https://foobarch.net/torus/docs/foobarch-usage-budgets) | [A_document/foobarch_usage_budgets.md](A_document/foobarch_usage_budgets.md) |
| Navi style | [torus/docs/navi-style](https://foobarch.net/torus/docs/navi-style) | [A_document/_navi_style.md](A_document/_navi_style.md) |
| Style notes | [torus/docs/style-refinement](https://foobarch.net/torus/docs/style-refinement) | [A_document/_style_refinement.md](A_document/_style_refinement.md) |
| Shell | [torus/docs/navi-shell](https://foobarch.net/torus/docs/navi-shell) | [navi_shell/README.md](navi_shell/README.md) |
| Modules | [torus/docs/navi-modules-guide](https://foobarch.net/torus/docs/navi-modules-guide) | [navi_shell/docs/navi_modules_guide.md](navi_shell/docs/navi_modules_guide.md) |
| Units | [torus/docs/navi-units](https://foobarch.net/torus/docs/navi-units) | [A_document/navi_units.html](A_document/navi_units.html) |
| Manifest frames | [torus/docs/manifest](https://foobarch.net/torus/docs/manifest) | [A_document/manifest.md](A_document/manifest.md) |
| Park addressing | [torus/docs/navi-park-addressing](https://foobarch.net/torus/docs/navi-park-addressing) | [A_document/navi_park_addressing.md](A_document/navi_park_addressing.md) |
| Flow model | [torus/devops/flow-model/readme](https://foobarch.net/torus/devops/flow-model/readme) | [C_devops/flow-model-docs/README.md](C_devops/flow-model-docs/README.md) |

The HTML that is actually parked for `torus/docs/*` lives in [C_devops/htmf-ecosystem](C_devops/htmf-ecosystem). The flow-model HTML lives in [C_devops/flow-model-docs/htmf](C_devops/flow-model-docs/htmf).

## Repo

| Path | What it is |
|---|---|
| [navi_shell](navi_shell) | Shell source (`src/index.ts`), browser bundle (`dist/navi_shell.js`), and the Node and native builds. |
| [foobarch/static](foobarch/static) | Files served beside the shell: service worker, manifest, icons, humans, robots, security. |
| [B_fragments/data](B_fragments/data) | Hypertext pages. Published as `hypertext/…` and again as `torus/text/spawn/…`. |
| [C_devops/fragment](C_devops/fragment) | Testkit pages. Short names such as `testkit/notemaker` are what [hypertext/gadgets](https://foobarch.net/hypertext/gadgets) links. |
| [B_testkit_mods](B_testkit_mods) | JavaScript modules those pages mount. |
| [C_devops/identity](C_devops/identity) | Publish catalog and the script that writes tips to the host. See [C_devops/identity/README.md](C_devops/identity/README.md). |
| [C_devops/mods/_pot_all.mjs](C_devops/mods/_pot_all.mjs) | Pots testkit modules into the warez catalog. |
| [B_native_mods/hostparkinator_5000.js](B_native_mods/hostparkinator_5000.js) | The hosting server used at [foobarch.net](https://foobarch.net) bound to localhost:5353. |

Publish one shell asset to the live host with:

```bash
FOOBARCH_HOST=https://foobarch.net node C_devops/identity/_publish.mjs --yes navi_shell.js
```

The asset list, including hypertext and torus identities, is [C_devops/identity/_lib.mjs](C_devops/identity/_lib.mjs). The human list of those names is [torus/host-catalog](https://foobarch.net/torus/host-catalog), from [C_devops/fragment/torus_host_catalog.html](C_devops/fragment/torus_host_catalog.html).
