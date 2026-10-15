# Navi module writer’s guide (today)

How to write a navi module for current `navi_shell` (browser foobarch host + native Node). This replaces older guides that assumed automatic callin listeners, `navi.core`, path-derived module names, `navi:mod:<name>` parks, and storage as plain key bags.

Shell overview: [README.md](../README.md). Units / entry-plug: [A_document/navi_units.html](../../A_document/navi_units.html).

## What a module is

A module is JS with `export const register = (navi) => { … return moduleObject }`.

Mount loads the source, calls `register(navi)`, and places the return value at `navi.mod.<name>`.

**Park tip** for a module is flat `navi:<name>` (e.g. `navi:stagedir`), or a short hostpark ib (underscore `about.name`, e.g. `stagedir` / `potter_gibbert`). **`navi:mod` is only the registration ledger** (`parks[]` with `ib^gib`) — never the module park itself. Declare **both** `method.GET` and `method.POST` as `kind: "mod"` (usually identical), with `rel8ns.bin` + `content_type: application/navi-module`. Host provision pin uses `Accept: application/navi-mod` (multipart eframe+bin); tip-only `Accept: application/eframe`; raw bytes `Accept: application/navi-module`. URL park uses GET callin; `navi('…')` uses POST callin — same resolution otherwise. Capture uses `park: "capture"`. See [README — Park frames: GET vs POST](../README.md#park-frames-get-vs-post-callin-contract) and [navi_park_addressing.md](../../A_document/navi_park_addressing.md).

For request bodies / headers (CRUD, large text), read **`navi.callinRequest`** while your command runs — not a relay-specific API. Relay is callin with `viaRelay: true`.

```javascript
export const register = (navi) => {
  const isBrowser =
    typeof window !== "undefined" && typeof window.document !== "undefined";

  const eventListeners = [];
  const createdElements = [];
  const timers = [];

  const runHelp = async (...args) => {
    if (!args.length || args[0] === "help") {
      return "my_mod — try: my_mod ping";
    }
    if (args[0] === "ping") return "pong";
    return `unknown: ${args[0]}`;
  };

  return {
    name: "my_mod", // required — navi.mod.my_mod + park tip navi:my_mod
    version: "1.0.0",
    description: "Example module",
    moduleInfo: {
      name: "my_mod",
      version: "1.0.0",
      description: "Example module",
    },
    commands: {
      // `my_mod …` runs commands.my_mod; parse subcommands from its args
      my_mod: {
        name: "my_mod",
        description: "my_mod help | ping",
        execute: runHelp,
      },
    },
    onMount: async () => {
      /* optional init */
    },
    onUnmount: () => {
      for (const { element, event, handler } of eventListeners) {
        element.removeEventListener(event, handler);
      }
      eventListeners.length = 0;
      for (const el of createdElements) el.remove();
      createdElements.length = 0;
      for (const t of timers) clearTimeout(t);
      timers.length = 0;
    },
  };
};
```

Required for a healthy mount:

- `name` — Registry key + park tip `navi:<name>`. Taken from the live `register()` return (required). Single segment only (no `/` or `:`).
- `commands` — Map of command keys → `{ name, description?, execute }`. Must include `commands.<name>` (the help verb below), including plugin-only mods (stagejockey plugins, supermouse plugins) that have nothing else to type. Other keys are only reachable as `<name> <key> …`, never as a first word.
- `onUnmount` — Clean DOM / listeners / timers you added (browser).

### Help text (required)

Every module answers `navi('<name>')` and `navi('<name> help')` with help text written by hand for that module. Typing a mounted mod's name with no `commands.<name>` throws `navi.mod.<name>.commands.<name> not available`, so plugin-only mods are not exempt.

- Key it as `commands.<name>` (same string as the module `name`); no args and `help` both return the text.
- Write it for a person who just mounted the mod: what it is for, how to use it (for jockey plugins, which claims appear, on what, and in which direction), what else must be mounted, and any subcommands.
- Do not generate it from `description`, claim ids, or `Object.keys(commands)`, and do not return only a version string.
- Live state is welcome after the text (e.g. "netproposer: mounted · 3 tokens"), but the hand-written part must still read correctly when nothing else is mounted.
- Keep it plain text, a few short lines, no ANSI.
- Do not store module state on the same tip ib as the module park (`<name>` / `navi:<name>`). That shadows the park; a bare `navi('<name>')` then returns the state frame instead of help. Use a nested ib (e.g. `navi:<name>:frame`) or `navi.storage.item`.

```javascript
const HELP = [
  "image_resize — resize a picture on the page by dragging.",
  "use: select an image with stagejockey → +1 \"image-resize\"; drag a corner,",
  "     click inside the frame to keep it, Escape / click outside to undo.",
  "needs: stagejockey",
].join("\n");

commands: {
  image_resize: { name: "image_resize", description: "help", execute: async () => HELP },
},
```

MIME for published bytes: `application/navi-module`.

## Install / mount

```text
mount flowerpot/hypercloud/testkit/mods/legacy/horizon_stagedir.js
```

(Fetch route / filename need not match `register().name` — that module plants park tip `navi:stagedir`.)

Surf flow (simplified):

1. Fetch route as a navi module.
2. `mount(source)` → `register(navi)` → live `moduleObject.name`.
3. `plantModulePark` under that live name → tip **`navi:<name>`** + bin (`kind: "mod"`). The fetch route is not the park ib.
4. Index **`navi:mod.parks[]`** with live `Object.keys(commands)` (may be `[]`) and mut8 the tip’s `method.GET.commands` / `method.POST.commands` when the mod exposes more than one verb. Claim the mount on this instance’s unit tip when units are active.

Name comes from the register return, not a source scrape (scraping false-positives like WebCrypto `{ name: "Ed25519" }`).

Also: `mount navi:my_mod` when the park tip already exists; `navi.remount()` mounts every park listed on ledger `navi:mod`, independent of which unit this instance is.

Do not hand-register `navi.on('callin', …)` for your verbs. Hard park dispatch owns callin.

## Callin discovery (parks, not a flat command registry)

```text
navi('my_mod ping')
```

1. First token → park tip `navi:<token>` (modules and `surf` included). Shell/kernel tips also use flat `navi:<token>` (`storage`, `init_script`, `mod`, `plug`, `reseed`, …). There is no `navi:mod:<token>` park path.
2. Optional unit prefix first: `navi('unit/01/my_mod …')` — see [navi_units.html](../../A_document/navi_units.html).
3. Tip must be listed on `navi:mod.parks` and `method.POST.kind === 'mod'` for callin (URL GET uses `method.GET`). There is no fallback search: if `navi:<token>` is not a mod park, the callin fails.
4. Default command is the park's `method.<M>.command` (the module `name`). If the next token is another key listed in `method.<M>.commands`, that key runs instead.
5. Execute `navi.mod.<target>.commands.<command>.execute(...rest)`.

### The first word is the module name (hard rule)

The only top-level word that reaches a mod is its module `name`, because that is its park leaf. Any other `commands` key is reachable only as the second word: `navi('my_mod other_key …')`. A command key is never a global verb.

- Do not register a second command key as a "short name" or alias for the module. `commands.foo` on mod `foo_client` is only reachable as `foo_client foo …`; typing `foo …` fails.
- In help text, README, docs, and instructions to users, always write the module name as the first word: `my_mod alias x`, never a shortened form.
- Handle subcommands as arguments inside `commands.<name>.execute` (e.g. `my_mod status`, `my_mod panel`) rather than as extra `commands` keys, unless you specifically need per-verb `methods` on the park.
- Before telling anyone to type a callin, confirm the first word equals the module `name` in the source.

When a mod exposes multiple callin verbs, mount sync writes per-transport `method.GET.commands` / `method.POST.commands` from optional `methods: ["GET"]` / `["POST"]` on each command entry (default transport prefers `list`). Single-command mods rely on `method.GET.command` / `method.POST.command` only.

Snapshot timing: index/tip commands are written at mount from `commands{}`. Mutating `commands` later on the live object does not update discovery until remount / `navi('reindex')`. Programmatic `navi.mod.x.commands.y.execute()` still works without remount.

## Storage (tip + bin; item/file are shims)

Authoritative space is tips + bins (`tip` pointer + `tip.frame` at `ib^gib`). `navi.storage.item` / `file` remain as shims; bare keys presume `navi:` (no bare ↔ `navi:` bridge on lookup).

- Prefer tip frames + `rel8ns.bin` for module-owned data when you care about the ledger.
- Park-check / surf paths do not presume: `surf horizon/enter` is host; `surf navi/horizon/enter` is local tip space.
- Path GET for modules: `navi.fetch(path)` (optional). Global `fetch` still works in the browser via the SW.

See also: [README — Storage API](../README.md#storage-api), `C_devops/navi_redux/`, `presumeNaviIb` in shell source.

## Paying for foobarch writes (`navi.tokens`)

Foobarch commits need a usage token (`X-Foobarch-Usage-Token`). Do not keep a
private token list in your mod; use the shared stash (local tip `tokens`, keyed
by origin):

```js
const token = await navi.tokens.take(host);          // throws err.code "NO_TOKENS" when empty
// … PUT with the token …
// on failure, unless the host said "consumed" / "invalid usage token":
await navi.tokens.giveBack(host, token);
```

Also `count(host)`, `look(host)`, `add(host, tokens)`, and an optional `path`
argument for a separate budget. The host only spends a token when the commit is
saved. Users fill the stash via `hypertext/intro`; operators via
`relay tokens add|file`. Full guide: [A_document/usage_tokens.md](../../A_document/usage_tokens.md).

## Units (when you care about multi-instance)

Registration (`navi:mod`) ≠ session claim on this window’s unit. Prefer reading [navi_units.html](../../A_document/navi_units.html) before gating destructive ops. Permission-style APIs (`storage kill`, `prune`, …) expect a bonded entry-plug and usually a confirm (`via entry-plug of <unitIb>`).

## Native vs browser

- DOM / `window` — Browser: yes. Native (`navi_shell.exe` / `navi_shell-linux-x64` / Node localnavi): no — guard with `isBrowser`.
- `navi.require('fs')` etc. — Browser: no. Native: yes (Node modules).
- Ports / SQLite hosts — Browser: N/A. Native: e.g. `foobarch_host`.
- `navi.native` — `{ node, exe, browser }` (native to this navi). Park tip / callin: `native`.

One `register` can serve both; throw or no-op when the environment is wrong.

## Service worker (optional)

- Shell registers `/sw.js`.
- Page: `navi.sw.on(name, fn)`, `navi.sw.registerPlugin…`.
- Clear handlers in `onUnmount` (owner-scoped).

PWA identity: prefer same-origin `/manifest.json` (host tip or SW overlay from `navi.pwa.set`). Do not rely on `blob:` manifests for Chromium installability. Icon `src` must be fetchable http(s) paths.

Offline boot: SW caches `start_url` document + `/navi_shell.js` (`navi.pwa.shell.*`). Tip/bin localpark still needs the runtime loaded first.

## Cleanup

Track what you add; tear it down in `onUnmount`: listeners, DOM nodes, style tags, observers, timers, `navi.sw` handlers. Unmount without cleanup leaks across remounts in a long-lived tab.

## Publishing (hostpark + warez)

Testkit subjects live under `B_testkit_mods/`. Catalog + attest:

```text
FOOBARCH_HOST=https://foobarch.net node C_devops/mods/_pot_all.mjs --yes --only my_mod --devnote "<one sentence: why this revision exists>"
```

That hostparks a short park on foobarch whose ib is the mod name (`my_mod`), writes `C_devops/mods/<name>.json`, and upserts `hypernetizen/warez`. The catalog `version` in `_pot_all.mjs` must match the source `version`, and `--devnote` (written to the manifest's `commit-devnote`) is required on every pot. Users mount by callin of the park (`my_mod`). `about.name` should match the live `register()` `name` (the subject filename may differ — e.g. `horizon_stagedir.js` → name `stagedir`).

Native modules under `B_native_mods/` use their own pot routes (`torus/native/…`); same `register` shape.

## Quick checklist

- [ ] `export const register`
- [ ] `name` in return (and usually `moduleInfo`) — single segment
- [ ] Park tip will be `navi:<name>` (not `navi:mod:<name>`)
- [ ] `commands.<name>` (=== module `name`) returns hand-written help on no args / `help` — required, plugin-only mods included
- [ ] Subcommands are args to `commands.<name>`; no alias / short-name command keys (they are unreachable as a first word)
- [ ] Every callin in help, README, and instructions starts with the module `name`
- [ ] Park tip name comes from live `register()` return — keep `name` accurate there
- [ ] `onUnmount` cleans browser side effects
- [ ] Do not attach your own top-level `callin` listener for verbs
- [ ] After changing `commands{}`, remount (or `reindex`) so discovery snapshots update
- [ ] Foobarch writes pay via `navi.tokens` (take, give back unless consumed) — no private stash, no mint password

## See also

- [README.md](../README.md) — runtime affordances, storage, surf, callin  
- [A_document/navi_units.html](../../A_document/navi_units.html) — units, entry-plug, heartbeat  
- [A_document/slashfold.md](../../A_document/slashfold.md) — delimiter race, gate, surf/hostpark  
- [A_document/navi_park_addressing.md](../../A_document/navi_park_addressing.md) — callin vs URL, relay, capture  
- [A_document/navi_manifest_space.html](../../A_document/navi_manifest_space.html) — tip / park / http kinds  
- `C_devops/navi_redux/` — seed tips (`navi:mod`, `navi:surf`, `navi:unit`, …)  
- `B_native_mods/README.md` — native (Node) host modules  
- `C_devops/mods/_pot_all.mjs` — attest + warez catalog  
- [A_document/usage_tokens.md](../../A_document/usage_tokens.md) — `navi.tokens`, what costs a token, refund rules  
