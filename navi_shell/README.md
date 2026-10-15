# navi_shell

navi_shell is a local-first JavaScript runtime. It can be loaded native (Node.js) or in a web browser. The Node runtime artifact is localnavi (`navi_shell_localnavi.cjs` / `navi_shell.exe`). It acts as a programmable layer for application state between network hypermedia and product logic, allowing for the dynamic use of restful modules with a text-stream command interface.

Canonical source for the working runtime: [src/index.ts](src/index.ts)

Module authoring conventions: [docs/navi_modules_guide.md](docs/navi_modules_guide.md)

Devops style around navi + foobarch: [docs/navi_style.md](docs/navi_style.md), [docs/style_refinement.md](docs/style_refinement.md)

---

## Purpose

Navi exists so products can:

- Keep logic and session state in the client (IndexedDB / local files), not only on a remote server
- Load capability modules at runtime (from storage or from the network) without rebuilding the shell
- Drive those capabilities programmatically via **callin** — path/text plus optional method, headers, and body (UI is optional presentation over that surface)
- Survive body content swaps (HTMX first paint, then `surf` for in-app steps) while `navi`, storage, and mounted modules stay in the same window

In the foobarch ecosystem, foobarch routes the origin; flowerpot (and other network level proposals) host versioned artifacts; navi is the client runtime that mounts modules, holds live data, and moves the user through hypermedia.

---

## Affordances (what you get)

Global `navi`
  Singleton runtime. `navi()` returns the instance; `navi("command args")` is POST callin.
  `navi.callin({ path, method, headers, body, viaRelay })` is the full front door.
  `navi.callinRequest` is the in-flight multiplex while a command runs.

callin / callout
  Front door into the park pipe. String callin defaults to POST; object form may set
  method / headers / body / viaRelay. URL park inherits GET. Relay always callins.
  Callout is the local POST text stream (`navi.callout(...)`, `'callout'` events).
  In-flight multiplex: `navi.callinRequest`.

`navi.storage`
  Tip + bin manifest space. `item` / `file` are tip+bin sugar for modules that want a simple key/value or media API. Browser: IndexedDB (`navi_shell`). Node: under `~/.navi_shell`.

`navi.park`
  Park-check-before-network: `navi.park.check(path, opts?)` resolves a local tip (delimiter race + optional `data.gate`) before the network is consulted. `%20` becomes space, then exact spelling, then space, `:`, `/`. The service worker calls this on same-origin GETs.

`navi.fetch`
  Formal path GET (optional; global `fetch` still works). `navi.fetch(path)` park-checks, then hostparks on miss unless the path is under `navi/` (local only). Passes the original path through — `/` optional, space / `:` / `/` / `%20` as today. Same stages as the SW, in-process so localnavi has no SW. Returns a `Response`.

`navi.stamp`
  `navi.stamp()` → `{ timestamp, uuid }`; `navi.stamp.time()` → offset-local ISO-8601; `navi.stamp.uuid()` → v4 UUID. Every locally stamped frame carries `data.timestamp` in the writer's own wall time and offset.

`navi.mount` / `navi.unmount` / `navi.remount` / `navi.mod`
  Load JS as modules; `register(navi)` modules land on `navi.mod.<name>` with auto-wired commands. `navi.remount()` restores modules still listed on the `navi:mod` index from each park tip's bin. `unmount` removes the live module **and** drops it from that remount ledger (park tip+bin stay planted for a later explicit `mount`).

`navi.script` / `init_script`
  Run JS now (`navi.script`), or append a line that runs on every boot (`navi.addToInitScript`). See **How to use `navi.script`**.

`surf` module (default)
  Three separate verbs: `surf` renders a route's HTML into the page; `browse` fetches a route and returns its **text only** (a module reveals its source, nothing is mounted); `mount` is the **install** verb that fetches + mounts a module from a route, or remounts a saved `navi:` key.

`navi.pwa`
  Runtime PWA identity: same-origin `/manifest.json` overlay via SW, managed meta/icons. Foobarch defaults on `/`. `navi.pwa.shell.*` caches start_url document + `/navi_shell.js` for offline boot.

Events
  EventEmitter3: `'callin'`, `'callout'`, `'ready'`, `'error'`, `'pwa'`, plus custom inter-module events.

Service worker bridge
  SW may message `navi:call` for a small allowlist (`storage.file.load`, `park.check`, `callout`), plus named page-side handlers under `['handler', name]`. Used with foobarch’s `/navi/*` local-first pattern.

`navi.sw`
  Module-facing service-worker controls: register page-side handlers the SW can invoke (`on`/`off`/`list`), send executable plugin source directly from a Navi module (`registerPluginSource`), or manage/message worker plugins (`registerPlugin`/`unregisterPlugin`/`listPlugins`/`send`). See [docs/navi_modules_guide.md](docs/navi_modules_guide.md#service-worker-integration).

`navi.plug` / `navi.unit`
  Entry-plug bind (`navi.plug.ping` / `navi('plug ping')` confirms before reveal) vs unit-system state on tip `navi:unit` (`navi.unit.get()`). Gated ops (`storage kill`, `factoryreset`, `prune`, …) prompt: `[navi] allow <op> via entry-plug of <unitIb>?`. Kill also asks: `HARD ERASE tip "<ib>" from local tip space via entry-plug of <unitIb>?` (or type-the-ib `prompt` when available). Plug reveal: `[navi:plug] reveal entry-plug of <unitIb>?`.

---

## Park frames: GET vs POST (callin contract)

**Callin is the front door** of the park pipe:

```text
callin → localpark (capture / tip) → hostpark (when applicable) → callout
```

Every entry — local REPL, direct URL / SW `park.check`, and host relay — goes through `dispatchCallin` / `navi.callin`. Path (or space-delimited text) is the address; **method, headers, body, viaRelay** are the HTTP multiplex on that address.

| Path | Method | Origin | Typical effect |
|------|--------|--------|----------------|
| `/navi/…` (park.check / SW) | **GET** | local callin | Run `http.GET` |
| `navi('…')` / string callin | **POST** | local callin | Run `http.POST` |
| Host relay WS remainder | **GET** or **POST** | callin `viaRelay: true` | Same pipe; `navi:relay` is local-only |

```javascript
navi('surf horizon/enter')                    // POST, path from text
navi.callin({
  path: 'fsdevopstracker/append',
  method: 'POST',
  body: JSON.stringify({ path: 'x', goal: 'why', body: '…' }),
})
// URL / SW → internally callin({ path: 'navi/…', method: 'GET' })
// Relay → always callin({ path: remainder, method, headers, body, viaRelay: true })
```

Modules may read the in-flight multiplex as `navi.callinRequest` (`method`, `headers`, `body`, `viaRelay`, `path`) while their command runs. Outside a callin it is `null`.

**Capture** uses `park: "capture"` on the frame (same as hostpark). The resolver passes trailing segments as args and dispatches `method[incomingMethod]`. See [A_document/navi_park_addressing.md](../A_document/navi_park_addressing.md).

Conceptually, `navi relay status` and `/navi/relay/status` are the same address to the user. Frames declare GET vs POST behavior.

**Frame rule for module parks** (`kind: "mod"`): declare **both** GET and POST. For most mods they are identical (same `target` + `command`). Capture + remainder args work the same either way.

**Module parks = provision + verbology.** A bin-bearing tip (`rel8ns.bin`, `content_type: application/navi-module`) has two jobs on the same frame:

1. **Provision** — if `navi.mod[target]` is not live, dispatch loads the tip’s bin (local, else hostpark pin) and mounts.
2. **Verbs** — once live, `park: "capture"` peels remainder against `method.*.commands`; bare path runs default `command`.

Parkpipe is park-neutral for these tips: local tip/capture first; on miss, hostpark `GET /{ib}` with `Accept: application/navi-mod` returns **multipart/related** (eframe part + addressed bin part). Navi localparks the eframe as-is, puts the bin under its host sha, then mounts from `tip.rel8ns.bin`. Tip-only borrow uses `Accept: application/eframe` alone (priority html > text > eframe — no header attach). Raw bytes remain via `Accept: application/navi-module`. Kernel aliases (`mount` / `browse` / `unmount` → `target: surf`) are not bin-bearing module parks.

Short hostpark names (e.g. `/potter_gibbert`) use underscore `about.name` as tip `ib`, `target` = `about.navi_name` / `register().name`, and the module source in `rel8ns.bin`.

```json
"method": {
  "GET":  { "kind": "mod", "target": "my_mod", "command": "my_mod", "mode": "async" },
  "POST": { "kind": "mod", "target": "my_mod", "command": "my_mod", "mode": "async" }
}
```

**Surfaces / kernel tips** often differ on purpose:

- **GET** → describe / snapshot / presence (safe to park-fetch)
- **POST** → execute (`navi('reseed force')`, `navi('storage kill …')`, `navi('plug ping')`, …)

Example: `navi:relay` — capture park; GET and POST both `kind: "relay"` locally (`relay status`, bare GET, callin). **`viaRelay`** (host WS) → `navi:relay is local-only.` Frame JSON via `navi.storage.tip`. `navi:plug` — GET = bound presence; POST verbs `ping|touch|ensure`.

Planted tip ibs stay flat: `navi:<name>` (e.g. `navi:surf`). `navi:mod` is the registration ledger only.

Whitespace / `:` / `/` / `%20` are interchangeable segment delimiters until delimiter race. Callin text is folded into a `navi/…` path before the same capture logic as the URL. Headers and body are the other half of the multiplex when path segments are not enough (same idea as HTTP query vs headers/body).

Design background: [A_document/navi_park_addressing.md](../A_document/navi_park_addressing.md).

---

- navi_shell is meant to feel like a shell: REPL-like callin, scripts on boot, pluggable “programs” (modules), local filesystem metaphors in storage.
- Modules do one thing well; text streams are the universal interface; UI embellishes robust programmatic capability.
- The version of navi_shell in this repo is wired to foobarch.net as hypermedia server aka the hypermedia dispatcher and product api proxy

---

## Foobarch hosting at https://foobarch.net

1. Browser hits any foobarch path → SSR shell HTML loads `navi_shell.js` (+ HTMX).
2. Navi auto-initializes: storage, service worker registration (unless disabled), `init_script`.

**Lineage mirror (tinyviewport, comb):** hostpark exposes the same span shape as local storage:

- `GET /foobarch/span/{ib}?dir=reverse|forward|all&limit=&offset=&addrsOnly=`
- Returns `{ ib, dir, hits: [{ addr, ib, gib, n, frame }, …] }` (or addrs only)

Use `@span reverse|forward|all [limit]` in tinyviewport hostpark paths, or fetch the span endpoint directly when planting a lineage into localpark.

---

## Technical overview

### Layout

```
navi_shell/
  src/index.ts                ← source of truth
  src/navi_redux_seeds.ts     ← seed tip frames 
  build.js                    ← esbuild → browser IIFE + localnavi CJS
  build.bat                   ← win + linux pkg from Windows
  lib/htmx.min.js             ← prepended into browser bundle
  dist/navi_shell.js          ← browser build output
  dist/navi_shell_localnavi.cjs  ← pkg input
  navi_shell.exe              ← Windows localnavi
  navi_shell-linux-x64        ← Linux x64 localnavi (no embedded icon)
```

Current signed Flowerpot artifacts (Snowcone Edition):

- `torus/hypernet/navi/snowcone/navi_shell.js`
- `torus/hypernet/navi/snowcone/sw.js`

### Build

```bash
# Full rebuild from Windows (browser bundle + navi_shell.exe + navi_shell-linux-x64)
build.bat
```

```bash
cd navi_shell
npm install
npm run build
```

Browser: IIFE named `naviShell`, HTMX banner prepended, outfile `dist/navi_shell.js`.

Localnavi: `build.bat` packages `dist/navi_shell_localnavi.cjs` with `@yao-pkg/pkg` → `navi_shell.exe` (`node22-win-x64`) and `navi_shell-linux-x64` (`node22-linux-x64`). Windows gets icon/metadata via `resedit-cli` from [`favicon.ico`](favicon.ico). Linux ELF has no PE icon resource — use a `.desktop` + PNG if you want a launcher icon. Data dir is `~/.navi_shell` on both. Build host should be Node ≥22. (Odd Node 23 is not used — short-lived non-LTS; 22 has `node:sqlite` from 22.5.)

Node builtins (`fs`/`path`/`os`/`readline`) are pulled in via `require` at their Node-only call sites (pkg-safe); the browser bundle marks them `external` and never hits those paths.

### Bootstrap sequence

1. First `navi()` / property access creates the singleton `Navi` instance.
2. Constructor: storage backend, worker pool stub, default callout→`console.log`, SW message bridge, Foobarch PWA defaults if path is `/`.
3. `initialize()`: register SW (`/sw.js` by default; pass `serviceWorkerScript: false` to skip), load `navi:init_script`, `navi.script()` those lines, emit `'ready'`.

Surf module source lives in the bin attached to tip `navi:surf` (`rel8ns.bin`). Seeds are plant-if-missing: an existing tip is left alone.

**Entry points differ by runtime.** The browser bundle auto-initializes lazily on first `navi()` access. Localnavi (`navi_shell.exe`) instead has `main()` explicitly `await shell.initialize()` and then drop into an interactive `navi>` REPL (`startLocalnaviRepl`). `navi.localnavi` reports `{ node, exe, browser }`; the park tip is `localnavi` (callin `localnavi`).

### How to use `navi.script`

Two jobs:

| I want… | Do this |
|---|---|
| Run JS **once**, now | `await navi.script([ "…js…", "…js…" ])` |
| Run JS **every boot** (after reload) | `await navi.addToInitScript("…js…")` |

Each array entry / added string is **source text of JavaScript**, not a callin line. Write the same JS you would type in the console, as a string. `navi` is already in scope.

**Where:** browser DevTools console on a navi page, or the localnavi `navi>` REPL (those are JS surfaces). Callin (`navi("surf …")`) is a different channel — it cannot take `navi.script([...])`.

#### Run something once

```javascript
await navi.script([
  'navi.callout("hello")',
])
```

Several steps, in order (wait for each):

```javascript
await navi.script([
  'await navi("mount flowerpot/hypercloud/testkit/mods/legacy/notemaker.js")',
  'await navi("notemaker demo")',
])
```

One entry can be a small program (`if`, `await`, more than one statement):

```javascript
await navi.script([
  'if (!navi.mod.notemaker) { await navi("mount flowerpot/hypercloud/testkit/mods/legacy/notemaker.js") }',
])
```

If a line throws, you get a `[SCRIPT:HHMMSS]` callout and **the next line still runs**.

From a text file, after mounting `scripter`:

```text
scripter run torus/testkit/myscript
```

`run` fetches that path and turns the body into snippets (blank line separates them; `#` comments dropped), then `navi.script`.

#### Persist something for every boot

Boot already runs whatever is on tip `navi:init_script` → `data.script` (see default seed below). **Append** a line; do not `clearInitScript` unless you are replacing the whole list yourself.

```javascript
await navi.getInitScript()
// → the current array; copy it if you need to edit

await navi.addToInitScript(
  'await navi("mount flowerpot/hypercloud/testkit/mods/legacy/notemaker.js")'
)
```

Next `initialize()` (page reload / localnavi restart) runs the old lines, then yours.

Put **remount-sensitive** work after the seed’s `await navi.remount()` by appending — `addToInitScript` always pushes at the end.

To drop a line: copy `getInitScript()`, splice, then rewrite. There is no “remove one line” helper; `clearInitScript()` writes `[]` and **the next boot fails** until you put lines back:

```javascript
const lines = await navi.getInitScript()
lines.push('navi.callout("boot extra")')
await navi.clearInitScript()
for (const line of lines) await navi.addToInitScript(line)
```

Or skip the clear and only `addToInitScript` when you are appending.

#### Quotes

The argument is a JS string that *contains* JS. Inner strings need escaping:

```javascript
await navi.addToInitScript('navi.callout("mounted extras")')
await navi.addToInitScript("await navi('surf hypertext/skellyrelay')")
```

#### What not to put in a script line

- A bare callin like `surf horizon/enter` — that is not JS. Wrap it: `await navi("surf horizon/enter")`.
- Module source / `export const register` — that is `navi.mount` / `mount <route>`, not `script`.
- Anything that must run only in the browser if you also boot localnavi: lines that mention `window`, `document`, or `htmx` are **skipped in Node**. The seeded empty-body surf line is written that way on purpose.

#### Default boot list (already planted)

1. `navi.callout("[script] Welcome to navi_shell — …")`
2. `await navi.mount(await navi.storage.bin.mediaFromTip("navi:surf"))`
3. `if (window.self == window.top && !document.body.innerHTML.trim()) { await navi("surf horizon/enter") }`
4. `await navi.remount()`

`initialize()` loads that array, filters (3) out under Node, then `navi.script(lines)`. The list is local IndexedDB / `.navi_shell`, not the host HTML. GET on park `init_script` returns the tip frame (including `data.script`); it does not execute the list.

### Callin / callout

navi_shell recognizes commands as verbs first (word segment)

```text
User / code / URL / relay → callin({ path, method, headers?, body?, viaRelay? })
            → emit 'callin' (request object)
            → localpark capture / tip → method[method]
            → result → callout stream only for local POST
            → URL returns via park.check; relay returns via WS

Modules → navi.callout("status…") → emit 'callout'
Modules → navi.callinRequest → in-flight method/headers/body/viaRelay/path
```

Callin is the uniform front door (hard). First path segment under `navi:` is the park; remainder is passthrough args. The park tip must be planted and listed on `navi:mod` (mount mut8). Sibling module commands that are not parks are reached via `navi.mod.<name>.commands.…`, not as top-level callins.

`navi.unmount(mod)` drops the module and mut8s `navi:mod`. `onUnmount` is for DOM, timers, listeners the runtime does not track.

### Park check

```javascript
await navi.park.check('hypertext/welcome')  // { hit, ib, kind, body, mime, reason }
navi.park.ib('hypertext/welcome')           // path → canonical tip ib
```

`park.check` enters through **callin GET** (same pipe as POST callin and relay). A hit is a local tip that the pipe can serve: capture/`kind: "mod"`/`surface` dispatch, `kind: "frame"` (tip JSON), or `kind: "bin"` / `rel8ns.bin` (bin media). The root `navi` tip is excluded. The service worker calls this before the network on same-origin GETs, which is what makes local tips win over host routes.

Callin `dispatchParkPath` (after local miss) may **hostpark-pin** a mod tip: `Accept: application/navi-mod` multipart → localpark eframe + addressed bin, then the same mod dispatch (ensure-mount + verb peel). `navi.fetch(path)` remains park-check then raw host fetch for non-dispatch path GETs.

### Storage API

The core store is tip + bin manifest space. A **tip** is only a pointer to the latest `ib^gib`; the frames themselves live in a shared frame space, so every generation of a lineage stays addressable. `item` and `file` are sugar APIs that write tips and bins underneath.

```javascript
await navi.storage.tip.get(ib)              // resolve pointer → latest frame
await navi.storage.tip.set(frame)           // stamp (if needed) + point tip at it
await navi.storage.tip.del(ib)              // drop pointer + that ib's frames
await navi.storage.tip.list()               // ibs that have a tip pointer
await navi.storage.tip.mut8(ib, dataPatch, opts?)  // new generation, past ← prior addr
await navi.storage.tip.presume(key)         // bare/navi path → canonical tip ib

await navi.storage.tip.frame.get(addr)      // one generation by ib^gib
await navi.storage.tip.frame.put(frame)     // store a generation (tip pointer unmoved)
await navi.storage.tip.frame.del(addr)
await navi.storage.tip.frame.list(ib?)      // addrs, optionally for one ib

// Lineage span — delta/event tips (relay:log, devops ops, navi:mod, …)
await navi.storage.tip.span(ib, { dir: 'reverse', limit: 6 })   // newest 6
await navi.storage.tip.span(ib, { dir: 'forward', limit: 6 })   // earliest 6
await navi.storage.tip.span(ib, { dir: 'all' })                 // full chain (oldest→newest)
await navi.storage.tip.span(ib, { addrsOnly: true })            // ib^gib addrs for comb/hostpark
await navi.storage.tip.lineage(ib)                              // full chain, newest first
await navi.storage.tip.spanDiff(ib, { dir: 'all', fold: true }) // event/op/park deltas

await navi.storage.bin.putMedia({ media, mime })   // → sha
await navi.storage.bin.ref(sha)             // "bin <sha>" for rel8ns.bin
await navi.storage.bin.get(sha)
await navi.storage.bin.mediaFromTip(ib)     // media string from tip.rel8ns.bin[0]
```

`mut8` stamps a new `gib`, writes the frame into frame space, moves the tip pointer, and links `rel8ns.past` to the prior address. Frame identity (`gib`) is a content hash of `data`, which includes the offset-local `timestamp`, so each generation is distinct even for byte-identical responses.

Frames imported whole from another space arrive pre-gibbed: Navi stores them as-is rather than restamping, since restamping would produce a different frame than the one that was authored.

---

item/file sugar (tip + bin under the hood)

```javascript
await navi.storage.item.set(key, value)
await navi.storage.item.get(key)
await navi.storage.item.del(key)
await navi.storage.item.getPath(key, ['user', 'theme'])
await navi.storage.item.setPath(key, ['user', 'theme'], 'dark')

await navi.storage.file.save(path, { media, mime })  // must be an object with media (+ mime)
await navi.storage.file.load(path)          // media string (or null)
await navi.storage.file.get(path)           // full stored object { media, mime }
await navi.storage.file.list(prefix?)
await navi.storage.file.del(path)
```

These are convenience wrappers, not separate stores: `item` keeps a tip with `data.value`; `file` keeps a tip plus `rel8ns.bin`. Every file key is stored under `navi:…` (idempotent if the caller already passed `navi:`). So `save("notes/x", …)` and `save("navi:notes/x", …)` both address `navi:notes/x`.

Browser IndexedDB name: `navi_shell` (schema v5) — object stores `tips`, `tip_frames`, `bins` only. `tips` holds pointers keyed by ib (`navi:surf`); `tip_frames` holds every generation keyed by `ib^gib`; bins are keyed by sha (`rel8ns.bin` → `bin <sha>`). Older `items`/`files` stores are deleted on upgrade.

### Usage tokens (`navi.tokens`)

Foobarch usage tokens live in the local tip `tokens` (`data.hosts[origin].unused`, one per line; optional `paths[path].unused` sub-budgets). Calls are serialized; `host` defaults to the relay host, else `navi.origin`.

```javascript
await navi.tokens.count(host?, path?)
await navi.tokens.look(host?, path?)              // first token, kept
await navi.tokens.take(host?, path?)              // first token, removed — throws err.code "NO_TOKENS" when empty
await navi.tokens.giveBack(host, token, path?)    // refund (host did not consume it)
await navi.tokens.add(host, tokens, path?)        // array or whitespace string → { added, count }
```

`relay connect` pays one token per connection from this stash. Shell callins: `relay tokens` (count), `relay tokens add <token…>`, `relay tokens file <path>`. Users get tokens through `hypertext/intro` (Approver → claim). Mod spend pattern and refund rules: [A_document/usage_tokens.md](../A_document/usage_tokens.md).

### Stamps

```javascript
navi.stamp()        // { timestamp: "2026-08-14T18:05:03.417-05:00", uuid: "…" }
navi.stamp.time()   // offset-local ISO-8601 for now
navi.stamp.time(ms) // …for a Date, epoch ms, or parseable string
navi.stamp.uuid()   // RFC 4122 v4
```

Timestamps are the value reads as the wall clock of whoever wrote it, and the explicit offset keeps it unambiguous across DST. The root `navi` tip additionally carries a `uuid` identifying that install.

### Modules

Preferred shape: export `register(navi)` returning `{ name, commands?, onMount?, onUnmount?, ... }`.

```javascript
export const register = (navi) => ({
  name: 'example',
  commands: {
    example: {
      name: 'example',
      description: 'example <args>',
      execute: async (...args) => { /* ... */ },
    },
  },
  onMount: async () => {},
  onUnmount: () => {},
});
```

`navi.mount(code)`:

- Detects ES module syntax vs bare script
- Browser: dynamic `import` of a data-URL module
- If `register` exists → register on `navi.mod`, wire commands, run `onMount`
- Legacy patterns still appear in older modules; see the modules guide

Access: `navi.mod.example`, `navi.listModules()`, `navi.unmount(navi.mod.example)`.

### Surf (default module)

Three verbs with distinct, non-overlapping roles:

The surf module provides three main verbs, each with a distinct role:

- `surf <route>`  
  Performs browser navigation. Fetches the HTML at the provided route, parses it into a `<template>`, parks any persisted body nodes into a surf-owned off-body shelter, replaces the page body with the new content using `document.body.replaceChildren(...)`, re-injects `<script>` tags, and finally restores the persisted nodes to the `body`.

- `surfrefresh`  
  Full document load of origin `/`. If already there, `location.reload()`; otherwise `location.replace('/')`. PWA stand-in for a hard browser navigate/reload of the shell. 

- `browse <route>`  
  Fetches the provided route and returns only its text content. 

- `mount <target>`  
  Installs a module. See the routing section below for further detail.

**Persist / immunity** (programmatic on `navi.mod.surf` — references stay inside surf):

```javascript
navi.mod.surf.persist(el)       // mark Element immune across surf()
navi.mod.surf.unpersist(el)     // drop immunity (bool)
navi.mod.surf.isPersisted(el)   // bool
navi.mod.surf.listPersisted()   // Element[] in registration order
```

Marked nodes are the same live elements (no clone). Surf parks them off `body` for the swap, then restores them onto `body`. Call `unpersist` when finished so surf can stop retaining them.

`mount` picks its mode from the first token:

- **Route (default):** any target is joined into a route, fetched, verified to be a Navi module, saved as `mod:<route>` (→ store key `navi:mod:<route>`), then mounted. Non-modules are rejected (browse them to read the text).
- **Storage key:** a target starting with `navi:` or `mod:` is remounted from `storage.file` — no network. (`mod:` is surf’s module kind; other `navi:…` keys remount too.)

Separators are interchangeable typing conveniences (callin splits your line on spaces, then the verb re-joins):

- routes join spaces with `/` → `surf manifest temp_storage index` ≡ `surf manifest/temp_storage/index`
- storage keys join spaces with `:` → `mount mod foo` ≡ `mount mod:foo` ≡ `mount navi:mod:foo`

Under the hood the Node file store also maps `:` ⇄ `__` for on-disk filenames (Windows can't use `:` in names); this is invisible to callers.

Programmatic:

```javascript
await navi.mod.surf.surf('/flowerpot/torus/.../ui/numpad.html')  // render HTML
await navi.mod.surf.browse('manifest')                           // returns text, never mounts
await navi.mod.surf.mount('some/module/route')                   // fetch + install + mount
await navi.mod.surf.mount('mod:mymod')                           // remount from storage
await navi.mod.surf.mount('navi:mod:mymod')                      // same key, full form
navi.mod.surf.persist(myWindowEl)                                // survive the next surf()
```

Callin: `surf …`, `surfrefresh`, `browse …`, `mount …`, `surf_settings …`.

A Navi module is recognized by `application/navi-module` MIME, or JS source that passes the `register`/`moduleInfo` checks.

### PWA

```javascript
navi.pwa.set({
  name: 'Product Demo',
  short_name: 'Product',
  theme_color: '#00897b',
  start_url: '/',
  icons: [{ src: '/favicon.ico', sizes: '16x16 32x32 48x48', type: 'image/x-icon' }],
  replace_url: true, // or a path string
})
navi.pwa.get()
navi.pwa.clear()
```

Publishes the manifest to the service worker, which serves it as a same-origin `/manifest.json` overlay (Chromium refuses to install from `blob:`), and manages head tags marked `data-navi-pwa-managed`. Icon `src` must be a same-origin http(s) path for the same reason.

#### App shell cache (offline boot)

SW caches `/navi_shell.js` in `foobarch-shell-v2` (network-first; offline fallback). SSR documents for offline boot are warmed in `foobarch-offline-docs-v1`. Document navigations are network-first with cache fallback (do not trust `navigator.onLine`). On boot, `ensureShellCache()` refreshes the runtime bundle and warms entry + `/`.

```javascript
await navi.pwa.shell.status()
await navi.pwa.shell.refresh()   // /navi_shell.js only
await navi.pwa.shell.warm(urls)  // offline doc warm (navigate headers)
await navi.pwa.shell.delete(url)
await navi.pwa.shell.put({ url, body, contentType })
await navi.pwa.shell.clear()
```

---

This is perhaps the 4th redesign of navi_shell.