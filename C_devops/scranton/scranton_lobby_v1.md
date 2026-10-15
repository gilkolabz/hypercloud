# scranton_lobby_v1

Scranton is the social layer that rides along with surfing. Every surf path
(`horizon/enter`, `hypertext/gadgets`, `Clip_Art_Deer_Drawing.jpg`, …) can have:

- a **lobby** — who is here (`roster`) and a notice board of `ib^gib` pointers (`append`);
- **posts** — frames people POST onto the page's notice board (a stage member, a whole
  stage, a navi-script);
- **address affordances** — shared frames kept *beside* the page under their own policy
  (`comments/{page}`, `stagedir/{page}`, `links/{page}`);
- **trust** — your own list of people (keys, or identities and their frens) whose stage
  directions and scripts apply themselves when you surf;
- **filter** — your own list of authors and post kinds to hide;
- **gates** — a post or direction can say it only applies itself when you arrive from a
  certain page.

Scranton discovers other people's annotations for wherever you are, without becoming a
game engine. Chess and other apps stay on their own tips and mods; they may *read* a lobby.
Contract name **`scranton_lobby_v1`**.

Contents: [Using it](#using-it) · [Pieces](#pieces) · [Lobbies](#lobbies) ·
[Posts](#posts) · [Affordances](#affordances) · [Stage direction](#stage-direction) ·
[Navi-scripts](#navi-scripts) · [Trust and frens](#trust-and-frens) ·
[Filter](#filter) · [Gates](#gates) · [Sprinter lane](#sprinter-lane) ·
[Operator](#operator-publishing) · [Tests](#tests) · [Keeping the stage](#keeping-the-stage) ·
[Pending](#pending)

---

## Using it

### 1. Mount

```text
mount scranton_lobby               the client (lobbies, posts, affordances, trust)
mount scranton_avatar              avi cards (thumbnail + alias only after you trust the key; not warez)
mount surfroster_stage_member      stage_member, stage_dir and stagedir affordances
(navi_script posts are built into scranton_lobby — POST the park)
mount jockey_netproposer           "scranton - post on this page…" menus (needs netproposer + keychain)
warez_updater check surf           optional: swap in surf's stage branch (keeps the stage)
```

After a new version is potted: `unmount -k <name>`, then mount it again.
Foobarch writes spend usage tokens from `navi.tokens`
(`scranton_lobby tokens count` shows what you have).

### 2. Open surfroster and follow

Surf to `testkit/surfroster` (or mount it as a stage member). **mount mod** fetches
`scranton_lobby` if it isn't mounted (and `scranton_avatar` for avi thumbnails). **enable surfroster** turns follow mode on: it listens for the `surf` event surf emits after a page lands, then leaves the old lobby and joins (or creates) that page's lobby. Surf's own commands, including settings and flags, do not emit it. **exit** turns it off.
**create / join / leave / refresh** act on the current path by hand. The roster shows "(OP)" for the lobby's creator and "(you)" for you.

Surfroster sections, all for the page you last surfed:

| Section | What you can do |
| --- | --- |
| roster | see who is here; trust/untrust a key (avi/name appear only after trust); the OP can kick; **your avi** dropdown to publish your own card |
| posts | every post on the page, drawn by its kind's affordance (stage, apply, show, run, trust author, hide author) |
| comments | read, add, delete your own |
| stage directions | shared placements: add, place one, place all, delete your own |
| links | paths people left for the page; clicking one surfs there |
| trust | your lobby key, trusted keys and identities (with hops), and the frens editor if an identity made you one |
| filter | hidden authors and kinds, and "show trusted authors only" |

Hidden things are folded away behind a "show N hidden" button. Posts and rows with a gate
show "only when arriving from …".

**Standalone parts.** Four sections also exist on their own, each a full HTMF you can surf to
or mount as a stage member:

| Path | Shows |
| --- | --- |
| `testkit/surfroster/posts` | posts on the page's lobby |
| `testkit/surfroster/comments` | `comments/<page>` |
| `testkit/surfroster/stagedirections` | `stagedir/<page>` |
| `testkit/surfroster/links` | `links/<page>` |

A part follows your surfs (it skips surfroster's own pages, so opening one keeps showing the
page you came from) and has a page box to look elsewhere. Roster, follow mode, trust and filter
stay in the main surfroster.

Each part names only the pattern it shows, never a mod. Its frame pins the current
generation of that pattern's frame, schema and policy (`rel8ns["scranton.frame"]`,
`["scranton.schema"]`, `["scranton.policy"]`): the lobby for posts, the affordance descriptor
for the others. Posts stay agnostic about post kinds; whatever affordance claims a kind draws
it.

The scranton frames name neither parts nor any other reader: surfroster is one way to read
them among any number. Readers point at the frames, never the reverse. A mod's park lists the
scranton frames it works with in `about.acknowledges`.

The one exception is a descriptor's `interpreter.mod`: the reference implementation the
affordance was made with, kept for clarity and base function. It is not a requirement: any
mounted mod exposing a plugin of that name serves it. Readers like surfroster use it for the
"mount … to read it" hint.

| Mod | `about.acknowledges` |
| --- | --- |
| `scranton_lobby` | `scranton/lobby/v1`, `scranton/affordance/v1` |
| `surfroster_stage_member` | `scranton/affordance/v1/{stage_member,stage_dir,stagedir}` |
| `scranton_lobby` | `scranton/affordance/v1/navi_script` |

### 3. Post things onto a page

| To post | Do this | Tokens |
| --- | --- | --- |
| one stage member | jockey the member → +1 **scranton - post on this page…** | 2–3 |
| your whole stage | stagejockey menu → **scranton - post stage on this page…** | 2–3 |
| a navi-script | `scranton_lobby script post <page> <script park path> [--callin] [--from <page>] [label…]` | 2–3 |
| a comment | surfroster comments box, or `scranton_lobby affordance push comments <page> <text…>` | 1–2 |
| a stage direction row | surfroster stage directions box, or `surfroster_stage_member direct <page> <member path> [SLOT] [pos] [--from <page>]` | 1–2 |
| a link | surfroster links box (a path; it resolves via surf) | 1–2 |

The extra token is spent only when the page has no lobby (posts) or no frame for that
affordance (rows) yet. Posting never overwrites the page's own stage park: the whole-stage
post asks for its own park path. The post panel's **only when arriving from** field (and
`--from` on the commands) adds a [gate](#gates). On the sprinter lane the lobby row is free;
the posted frame still lives on foobarch.

### 4. Trust people

Nothing anybody posts runs or stages itself on your screen unless you trust the author.
Clicking **stage**, **apply**, **place** or **run** is always manual and always allowed.

```text
scranton_lobby key                          your lobby pubkey (give this to people who want to trust you)
scranton_lobby trust key <pubkey> [label]   trust one person
scranton_lobby trust identity hypernetizen  trust everyone on hypernetizen/frens
scranton_lobby trust identity hypernetizen 2   … and everyone on the lists of identities it vouches for
scranton_lobby trust                        list
scranton_lobby untrust key|identity …
scranton_lobby trusted <pubkey>             is this key trusted, and via what
scranton_lobby frens <identity>             read and verify an identity's frens list
```

Surfroster's post cards also have **trust author / untrust author** buttons.

Once trusted, on every surf to a page: their latest whole stage is applied, then their
posted members and stagedir rows are placed (members already on stage are skipped), then
their navi-scripts run. Hidden authors and kinds never act, and gated items act only when
you arrive from their page.

### 5. Hide things

```text
scranton_lobby hide key <pubkey> [label]    hide an author
scranton_lobby hide kind navi_script        hide a whole post kind
scranton_lobby show trusted                 show trusted authors only (show all to undo)
scranton_lobby unhide key|kind …
scranton_lobby hidden                       your filter
```

Or use **hide author** on any post or row, and the surfroster **filter** section.

### 6. Edit a frens list from the browser

If an identity made your lobby key an editor (`_hostpark_frens.mjs --identity <id> editor
add <your lobby key>`), trust that identity and its entry in the surfroster **trust**
section shows an editor box: add or remove frens, and vouch for other identities. Or:

```text
scranton_lobby frens <id> add <pubkey> [label] | rm <pubkey>
scranton_lobby frens <id> vouch <identity> | unvouch <identity>
```

Each change is one token, signed with your lobby key.

---

## Pieces

| Piece | Where |
| --- | --- |
| Client mod `scranton_lobby` (1.14.0) | `B_testkit_mods/scranton_lobby_v1_client.js` |
| `surfroster_stage_member` (0.5.1) | `B_testkit_mods/surfroster_stage_member.js` |
| `surf`, stage branch (1.9.1) | `B_testkit_mods/surf.js` → warez park `surf` (embedded branch lives in `navi_shell/src/index.ts`) |
| Branch lookup on the host | `hostparkinator_5000` ≥ 0.7.1, `GET /foobarch/tip/{ib}?data.{path}=…` |
| `jockey_netproposer` (0.9.1) | `B_testkit_mods/jockey-plugins/jockey_netproposer.js` |
| Avatar mod `scranton_avatar` (0.2.0) | `B_testkit_mods/scranton_avatar.js` → park `scranton_avatar` (not warez); avis at `scranton/avatar/{pubkey}` |
| Avi write gate (Lua) | `C_devops/scranton/avatar_v1_schema.lua` → `scranton/avatar/schema` |
| Avi policy + governor | `C_devops/scranton/_hostpark_avatar_v1.mjs` → `scranton/avatar/policy`, `scranton/avatar` |
| Surfroster HTMF | `C_devops/scranton/scranton_lobby_v1_surfroster.html` → `testkit/surfroster` (torus) |
| Surfroster parts | `C_devops/scranton/scranton_lobby_v1_surfroster_part.html` → `testkit/surfroster/{posts,comments,stagedirections,links}` (one source; parts and their pins in `surfrosterPartAssets()`, `C_devops/identity/_lib.mjs`) |
| Lobby write gate (Lua) | `C_devops/scranton/lobby_v1_schema.lua` → `scranton/lobby/v1/schema` |
| Rows write gate (Lua) | `C_devops/scranton/rows_v1_schema.lua`, configured per affordance by `_affordance_lua.mjs` |
| Lobby policy + governor | `C_devops/scranton/_hostpark_lobby_v1.mjs` |
| Affordance descriptors + policies | `C_devops/scranton/_hostpark_affordances_v1.mjs` |
| Frens lists | `C_devops/scranton/_hostpark_frens.mjs`, `_frens_lib.mjs` |
| Sprinter lane (1.1.0) | `B_testkit_mods/sprinter_server.js` + park `sprinter` (`C_devops/identity/_hostpark_sprinter_relay.mjs`) |

Mods are potted with `node C_devops/mods/_pot_all.mjs --yes --only <name> --devnote "<purpose>"`.

---

## Lobbies

### Addresses

| Address | Backend | Cost per write |
| --- | --- | --- |
| `scranton/lobby/v1/{path}` | foobarch tips (history kept) | one usage token |
| `{alias}/scranton/lobby/v1/{path}` | foobarch tips under an alias prefix (parallel rooms) | one usage token |
| `sprinter/scranton/lobby/v1/{path}` | sprinter_server via relay (current frame only) | none |

`scranton_lobby alias sprinter` switches the client to the sprinter lane; `alias -` back.
The creation gate covers `scranton/lobby/v1/…` only. Other alias prefixes on foobarch are
ungoverned unless someone plants a governor at `{alias}/scranton/lobby/v1`; the client
refuses any foobarch lobby tip that does not link `scranton/lobby/v1/policy`.

### Frame shape

```json
{
  "ib": "scranton/lobby/v1/horizon/enter",
  "gib": "<sha256(JSON.stringify(data)) uppercase>",
  "data": {
    "parts": ["network_proposal", "ibgib_frame", "manifest", "json"],
    "park": "defer",
    "contract": "scranton_lobby_v1",
    "about": { "label": "scranton_lobby_v1", "description": "Scranton lobby v1 — roster + append ib^gib index" },
    "lobby": {
      "contract": "scranton_lobby_v1",
      "path": "horizon/enter",
      "created_at": "2026-10-04T06:00:00.000Z",
      "creator": "<pubkey>",
      "roster": { "<pubkey>": { "joined_at": "2026-10-04T06:00:00.000Z", "ts": 1791093600 } },
      "append": [{ "addr": "some/note^ABC…", "by": "<pubkey>", "at": "2026-10-04T06:01:00.000Z" }]
    },
    "default_method": "GET",
    "method": { "GET": { "kind": "frame" }, "PUT": { "kind": "commit" }, "PATCH": { "kind": "commit" } },
    "n": 0,
    "timestamp": "Sun, 04 Oct 2026 06:00:00 GMT"
  },
  "rel8ns": { "policy": ["scranton/lobby/v1/policy"], "past": [], "tjp": [], "dna": [] }
}
```

- `creator` is the **OP**. A few early lobbies stored `op` instead; the rules read either
  and allow renaming `op` → `creator` with the same pubkey.
- Pubkeys are the client's **lobby key**: a keychain child derived from `default` under
  label `scranton_lobby`, so the main pubkey stays out of lobby tips. Lobbies where
  `default` already holds OP/roster/rows keep signing with `default`. Relay-signing
  keychains use `default`.
- On mut8 the client copies the parent's `data` and `rel8ns` and changes only `lobby`,
  `n`, `timestamp` and `past`.

### Writes

Every write is a commit envelope (`firstGen` or `mut8`) signed **proposal-write-v1** over:

```text
proposal-write-v1
<ib>
<parent addr, or empty on firstGen>
<sha256 hex of the request body>
application/json
```

Ed25519, base64url. Headers `X-Foobarch-Sign-Keys` / `X-Foobarch-Signatures` (plus
`X-Flowerpot-*` copies). Foobarch writes are `PUT /{ib}` with `X-Foobarch-Usage-Token`;
sprinter writes are `POST /sprinter/{…}` with `X-Navi-Shell-Wait: 1`. A refused write
gives its token back unless the host already consumed it.

**Create (firstGen)**, enforced by `authorize_genesis()` on foobarch and `checkCreate` on sprinter:

- `data` minus `lobby` / `timestamp` equals the template above exactly (`n: 0`);
  `timestamp` a short string.
- `rel8ns` is exactly `{ policy: ["scranton/lobby/v1/policy"], past: [], tjp: [], dna: [] }`.
- `lobby` keys are exactly `contract, path, created_at, creator, roster, append`; `path`
  matches the address; `creator` = signer; `roster` = only the signer with
  `{ joined_at, ts }`; `append` empty.

**Mut8**, enforced by `authorize()` on foobarch and `checkMut8` on sprinter:

- `data`: only `lobby`, `n` (= parent + 1) and `timestamp` may differ.
- `rel8ns`: only `past` may differ, and it is exactly `[parent addr]`.
- `lobby`: only `roster` **or** `append` may differ (one concern per write);
  `contract`, `path`, `created_at`, `creator` are fixed.
- Roster: join one entry `{ joined_at, ts }` signed by that key; leave self; OP kicks one
  key. Existing entries never change.
- Append rows are exactly `{ addr, by, at }`, `addr` matching `ib^gib` (no spaces, one
  caret, ≤ 512 chars):

| Actor | Push row | Update / delete row |
| --- | --- | --- |
| OP (`creator`) | yes (`by` = self) | any row |
| Row author (`by`) | yes (`by` = self) | own rows; `by` immutable |
| Everyone else | yes (`by` = self) | no |

Sprinter also rejects a frame whose `gib` is not the sha256 of its `data`, or that has
keys beyond `ib, gib, data, rel8ns`.

### Host tips

| Tip | Role |
| --- | --- |
| `scranton/lobby/v1/schema` | Lua bin: `authorize()` (mut8) + `authorize_genesis()` (create) |
| `scranton/lobby/v1/policy` | `rel8ns.schema` → schema; every lobby names it in `rel8ns.policy` |
| `scranton/lobby/v1` | governor: `rel8ns.genesis_policy` → policy, so hostparkinator (≥ 0.7.0) runs `authorize_genesis()` on every firstGen under the prefix |

### Client commands

```text
scranton_lobby tokens count [host]    unused tokens in the navi tokens stash
scranton_lobby alias [name|-]         prefix {alias}/scranton/lobby/v1/…  (sprinter = fast lane)
scranton_lobby follow [on|off]        on: every surf leaves the old lobby and joins/creates the page's lobby
scranton_lobby create <path>          firstGen + self on roster; empty append
scranton_lobby join|leave|roster|ib <path>
scranton_lobby kick <path> <pubkey>   OP only
scranton_lobby enter <path> | exit | here | key | help
scranton_lobby append list <path>
scranton_lobby append push <path> <ib^gib>
scranton_lobby append update <path> <index|addr> <ib^gib>
scranton_lobby append delete <path> <index|addr>
scranton_lobby posts [path]           append rows that are posts (default: last surfed page)
scranton_lobby affordance list | add <name> | rm <name>
scranton_lobby affordance read <name> [path]
scranton_lobby affordance push <name> <path> <text…>
scranton_lobby affordance delete <name> <path> <index>
scranton_lobby trust | trust key <pubkey> [label] | trust identity <id> [hops]
scranton_lobby untrust key <pubkey> | untrust identity <id>
scranton_lobby frens <id>             read + verify <id>/frens
scranton_lobby frens <id> add <pubkey> [label] | rm <pubkey> | vouch <identity> | unvouch <identity>
scranton_lobby trusted <pubkey>       is this key trusted, and why
scranton_lobby hide key <pubkey> [label] | hide kind <post kind> | unhide key|kind …
scranton_lobby show all|trusted
scranton_lobby hidden
```

- Follow mode serializes surfs; a surf overtaken by a newer one skips its join.
- Local state: `scranton_lobby_v1.alias`, `.here`, `.follow`, `.trust`, `.hide` (prefs
  only; no history of lobby movement is kept).
- Other mods and the surfroster HTMF use the live service at `navi.mod.scranton_lobby.lobby`
  (roster, append, posts, affordances, trust, filter, gates — see below).

---

## Posts

A **post** is a frame POSTed onto a page's lobby: an append row whose `addr` points at a
frame carrying `data.post`. The posted frame is the thing itself — no wrapper park.

```json
"post": {
  "v": 1,
  "kind": "stage_member",
  "page": "Clip_Art_Deer_Drawing.jpg",
  "lobby": "scranton/lobby/v1/Clip_Art_Deer_Drawing.jpg",
  "author": "<lobby pubkey>",
  "stage_dir": { "slot": "DS", "at": 0, "type": "htmf" },
  "label": "I like this picture",
  "gate": { "from": "horizon/enter" },
  "created_at": "…"
}
```

- `gate` is optional (see [Gates](#gates)).
- Valid only when `post.author` equals the row's `by` (the lobby schema already makes `by`
  sign the row), `post.page` is the lobby's page, and `post.lobby` (when present) names
  that lobby. Rows pin the posted generation (`/foobarch/frame/<ib^gib>`).
- `kind` picks the affordance that draws and acts on it: `stage_member`, `stage_dir`,
  `navi_script`. Unknown kinds are listed without actions.
- **Posted bytes only.** Frames carry no bytes, so `lobby.postContent(x)` fetches the park
  and accepts it only when its sha256 equals the posted generation's `rel8ns.bin`. If the
  author re-parked since posting, applying or running the post is refused.
- jockey_netproposer posting: ensure the page's lobby (create if missing), hostpark the
  member / stage / script with `data.post`, then `append push` its `ib^gib`.
- Netproposer panel "policy" dropdown: none, **write protect**, other saved policy
  aliases, or a typed alias / `ib^gib`. Write protect is the host's basic keys policy
  frame `policies/keys/<pubkey16>` (`foobarch.schema.keys.v1`, threshold 1, keys =
  keychain default, self-locked): reused when saved or already on the host, otherwise
  created first (+2 tokens). It attaches on firstGen only.
- Client: `postsFor(path)`, `scranton_lobby posts [path]`.

---

## Affordances

An **affordance** is a way of identifying and interpreting frames. Two shapes:

- **post affordance** — claims posts of one `post_kind` (e.g. `stage_member`).
- **address affordance** — a frame at a derived address (`comments/{page}`,
  `stagedir/{page}`, `links/{page}`) kept beside the page instead of in its
  lobby. Anyone may create it; its own policy gates every write, and the page's lobby is
  never touched. Address affordances don't depend on the lobby, so they work the same
  whichever lobby lane (foobarch, alias, sprinter) you are on.

Descriptors are plain JSON at `scranton/affordance/v1/<name>` (`data.affordance`), listed
by the index tip `scranton/affordance/v1` (`data.affordances.names`). Live:

| Name | Shape | Interpreter |
| --- | --- | --- |
| `comments` | address `comments/{page}`, fields `text` | none (surfroster draws a generic table) |
| `stagedir` | address `stagedir/{page}`, fields `member`, `slot`, `pos`, `from` | `surfroster_stage_member` |
| `links` | address `links/{page}`, field `path` (type `surf`) | none |
| `stage_member` | post | `surfroster_stage_member` |
| `stage_dir` | post | `surfroster_stage_member` |
| `navi_script` | post | `scranton_lobby` (POST the park) |
| `frens` | identity address `{identity}/frens` (shape record for trust) | `scranton_lobby` |

```json
"affordance": {
  "v": 1, "name": "comments", "label": "comments",
  "address": "comments/{page}", "key": "comments",
  "policy_ib": "scranton/affordance/v1/comments/policy",
  "fields": { "text": { "max": 2000 } },
  "columns": ["by", "text", "at"]
}
```

```json
"affordance": {
  "v": 1, "name": "stage_member", "post_kind": "stage_member",
  "interpreter": { "mod": "surfroster_stage_member" }
}
```

A descriptor needs no code: comments and links are drawn entirely from `fields` and
`columns`. A field with `type: "surf"` is a page path; clicking it surfs there in this navi
(`surf/<path>` callin). Anything a path resolves to works, so an HTMF page can carry its own
hyperlinks if you want an outside link.

When a case needs code, the descriptor names an `interpreter.mod` whose `affordancePlugin`
(or `affordancePlugins: [...]`) reads it; several descriptors may share one mod.

### Address frames

- State (`data[key]`): `{ affordance, page, lobby, created_at, creator, rows: [{ …fields, by, at }] }`.
- A frame counts only when its tip and its first generation carry `rel8ns.policy` = the
  descriptor's `policy_ib`, the first generation started with no rows, `affordance` names
  the descriptor, and `page` is the page.
- Write gate `rows_v1_schema.lua`, one copy per affordance (`-- @config` block: state key +
  string fields with min/max lengths): each write pushes exactly one row (only the
  configured fields plus `by` = signer and `at`) or deletes exactly one of the signer's
  own rows. `n` = parent + 1, `past` = parent, nothing else may change.
- Fields with `min: 0` are optional (surfroster shows "(optional)").

### Plugin interface

```text
post plugin     { name, post_kind, order?, describe(x), actions(x), onSurf(list) }
address plugin  { name, address, order?, actions(read), rowActions(row, i, read), onSurf(read) }
```

Actions are `{ id, label, title, run }`; `run` may return text, or `{ text, show }` to
display a block (navi-script **show**). `order` sorts surf hooks (lower first). On every
surf the client runs each post plugin's `onSurf` with that page's valid posts of its kind,
and each address plugin's `onSurf` with the page's frame when it is valid and has rows.
Before that it drops hidden authors and kinds and gated items whose page you didn't arrive
from, so plugins only see what may act on its own. `ctx.arrivedFrom` is the previous page.

Client service: `affordances()`, `affordanceForPostKind(kind)`, `affordanceNamed(name)`,
`registerAffordance(plugin)`, `readAddress(name, page)`, `addressPush(name, page, fields)`
(creates the frame first when missing: +1 token), `addressDelete(name, page, index)`,
`postContent(x)`, `runSurfPlugins(page, arrivedFrom)`. Local extra descriptor names:
`scranton_lobby affordance add|rm <name>`.

---

## Stage direction

Three ways to direct someone's stage, all interpreted by `surfroster_stage_member`:

| Affordance | Shape | What it does | Make one |
| --- | --- | --- | --- |
| `stage_member` | post | the posted frame is one member; **stage** places it onto your current stage | jockey a member → **scranton - post on this page…** |
| `stage_dir` | post | the posted frame is a whole stage (stage_dir JSON); **apply** replaces your stage | stagejockey menu → **scranton - post stage on this page…** |
| `stagedir` | address `stagedir/{page}` | shared rows `{ member, slot, pos, from }`; **place** / **place all** add to your current stage without replacing it | `surfroster_stage_member direct <page> <member path> [SLOT] [pos] [--from <page>]` or the surfroster box |

- `stagedir` rows: empty `slot` / `pos` mean "use the member's own stage_dir"; `from` is
  an optional [gate](#gates).
- Placing uses stagedir `placeFromPath` then `persist` (stagedir ≥ 3.7.20); applying a
  whole stage uses `installManifestContent`.
- Trusted authors on surf: their latest `stage_dir` post first (`order` 0), then
  `stage_member` posts (20), then `stagedir` rows (30). Members already on stage and posts
  whose park changed are skipped.

---

## Navi-scripts

Post kind `navi_script`: a script park (`application/navi-script`) whose frame carries
`data.post { …, mode: "js" | "callin" }`. Navi runs it: **POST** the park (JS bin is one
program; callin mode is one POST path per line). Full-line `#` / `//` comments are dropped.
There is no extra interpreter mod.

```text
scranton_lobby script post <page> <script park path> [--callin] [--from <page>] [label…]
```

re-parks the script's current text at the same path with `data.post` and `method.POST` kind
bin, then appends it to the page's lobby (`--from` adds a [gate](#gates)). Surfroster shows
**show** (the text) and **run** (POST). Scripts by trusted authors run on surf the same way.
Only the posted bytes ever run (sha of the posted generation). Surfroster has a **scripts**
nest for `navi_script` posts (also listed under posts). The affordance descriptor is
`scranton/affordance/v1/navi_script` (post kind, not a Lua body schema).

---

## Trust and frens

Trust lives in `scranton_lobby` (local storage `scranton_lobby_v1.trust`) and every plugin
asks the same question: `lobby.isTrusted(pubkey)` → `{ trusted, via }`, where `via` is
`"key"`, `"frens of <identity>"` or `"frens of <b> (via <a>)"`. Trusted keys are **lobby
pubkeys** — the key that signs posts and rows (`scranton_lobby key`).

Trusting an **identity** trusts every key on its frens list. The list may also name
identities it vouches for; trusting with **hops** 2 or 3 follows those too (hops 1, the
default, does not). Cycles end; every identity is read once. The list lives at
`<identity>/frens`:

```json
"frens": {
  "identity": "hypernetizen",
  "keys": ["<lobby pubkey>"],
  "labels": { "<lobby pubkey>": "alice" },
  "identities": ["torus"]
},
"frens_sig": { "key": "<policies/hypernetizen key, or a named editor>", "sig": "<ed25519 over \"scranton-frens-v1\\n\" + JSON(frens)>" },
"frens_editors": { "identity": "hypernetizen", "editors": ["<lobby pubkey>"], "sig": { "key": "<policies/hypernetizen key>", "sig": "<ed25519 over \"scranton-frens-editors-v1\\n\" + JSON({ identity, editors })>" } }
```

- Readers accept the list only when `frens_sig.key` is in `policies/<identity>` `data.keys`,
  or in a `frens_editors` list that a `policies/<identity>` key signed, and the signature
  verifies. Even if someone else writes the path, only the identity (or its editors) can
  produce a list that counts. A broken list trusts nobody (`scranton_lobby frens <id>`
  shows why).
- **Write gate.** Until the first editor is added the frame names `policies/<identity>` in
  `rel8ns.policy` (identity key only). Adding an editor creates `policies/<identity>/frens`,
  a keys policy listing the identity key plus the editors (itself gated by
  `policies/<identity>`), and points the frame at it. The identity policy itself is never
  widened, so an editor can't touch the identity's other tips.
- Descriptor `scranton/affordance/v1/frens` records the shape.
- `surfroster_stage_member`'s old trusted list moves into scranton_lobby trust on mount.

Maintaining a list from here needs the identity's owner key on this machine (`C_devops/identity`):

```text
FOOBARCH_HOST=https://foobarch.net node C_devops/scranton/_hostpark_frens.mjs --identity hypernetizen list
… init                           create an empty signed list
… add <lobby pubkey> [label…] | rm <lobby pubkey>
… vouch <identity> | unvouch <identity>
… editor add <lobby pubkey> | editor rm <lobby pubkey>
```

Editors use `scranton_lobby frens <id> add|rm|vouch|unvouch …` or the surfroster trust
section (`lobby.frensEdit(id, { add | rm | addIdentity | rmIdentity, label })`).
`hypernetizen/frens` exists on foobarch.net (empty).

---

## Filter

Local only — nothing is written to any frame. `scranton_lobby_v1.hide` holds hidden author
keys, hidden post kinds and an only-trusted switch, on by default (your own key always
counts; turn it off with `scranton_lobby show all`). `lobby.isHidden(author, kind)` →
`{ hidden, why }`. Hidden items never reach surf hooks; surfroster folds them away behind
"show N hidden" and offers **hide author** on every post and row that isn't yours. Service:
`hideList()`, `hideKey(pub, on, label)`, `hideKind(kind, on)`, `setOnlyTrusted(on)`.

---

## Localpark

Scranton affordances are local-first. This is separate from the shell's stage-member
localpark (content parked at a data path): it belongs to the affordance layer and is what
surf hooks read when they direct the stage. Every behaviour below is a setting (see
**Settings**); the defaults are what's described.

- **Parked frames.** Lobbies, address frames (`comments/{page}`, …), descriptors, frens and
  policies are parked in this navi's tip storage under the host's own ib^gib (the host gib
  is the sha of the frame data, so the addresses match). Posted generations are kept in
  frame space by addr, and text post content in the bin store by sha. Each is verified
  before it's used. Each kind can be turned off; an unparked kind reads the host only.
- **Reads.** A page you've been to reads from the parked copy at once, and the host is asked
  at that moment; a difference is settled then. Nothing polls. `host.check` limits how
  often one frame is re-asked: every read, at most every N seconds (default 15), or only
  when you press refresh (`scranton_lobby park refresh`). With `host.frame_rules` on, a
  frame's own `data.localpark.check_s` decides instead. The first sight of a frame waits for
  the host; offline, the parked copy answers. Roster presence and writes read the host fresh.
- **Captured rows.** `add`/`delete` on an address go into the park ledger
  (`scranton_lobby_v1.park`) first and show at once, dimmed, with "created - hostparking...";
  then the host write is tried and the message follows it: "hostparked", or the refusal (4xx
  drops the row with the reason), or "created - hostpark waiting: <why>" when a network or
  token shortfall keeps it pending for `scranton_lobby park sync`. Rows are
  matched by `by|at`, so sending twice never doubles them. With `write.capture` off, a row
  goes straight to the host and appears only once it's there.
- **When the host differs.** Same addr: keep the local copy. Nothing pending: take the host's.
  Rows pending: the affordance plugin decides with `parkConflict(local, host, ctx)` →
  `both | host | local`, else `write.conflict` (default `both`: show the host frame with
  your pending rows over it and send them; `host`: drop yours; `local`: keep showing your
  view, the host frame stays parked beside it).
- **Surf hooks.** They run from parked data on arrival. If the host refresh brings
  something new for the page you're on, they run again with only the posts and rows they
  haven't been handed yet this visit. An item they already ran whose host version differs
  (same author and time, other content) is skipped by default; the plugin's
  `rerunHost(item, ctx)` decides per context, else `hooks.rerun: run` runs it again.
- **Events.** `lobby.onPark(fn)` gets `{ ib, change: host|both|local|gone|pending|dropped|synced, … }`;
  surfroster redraws on it.

| Callin | Does |
| --- | --- |
| `scranton_lobby park` | parked ibs, pending rows, conflict pick |
| `scranton_lobby park sync [ib]` | send pending rows now |
| `scranton_lobby park conflict both\|host\|local` | the default pick |
| `scranton_lobby park refresh [ib]` | ask the host now: every frame read this session, or one |
| `scranton_lobby park drop <ib>` | forget the parked copy |

---

## Settings

Stored locally in `scranton_lobby_v1.settings`. Surfroster walks you through every step you
haven't seen (first run, or an affordance that showed up since) before showing the lobby;
"keep the defaults for the rest" skips ahead. The **settings** panel in surfroster shows all
steps and saves on change; "walk me through them again" reopens the wizard.

| Step | Keys (default) |
| --- | --- |
| Localpark | `park.on` (on); `park.lobby`, `park.address`, `park.descriptor`, `park.frens`, `park.content` (on) |
| Host checks | `host.check` always\|throttle\|manual (throttle); `host.seconds` (15); `host.frame_rules` (off) |
| Your rows | `write.capture` (on); `write.conflict` both\|host\|local (both) |
| Surf hooks | `hooks.rerun` skip\|run (skip) |

Affordances add their own step: a plugin's `prefSteps(ctx)` returns fields
`{ key, label, help?, type: toggle|choice|number, options?, default, min?, max?, when?: [key, value] }`.
Its values live under the affordance name; read one with `lobby.affordanceSetting(name, key)`.
Service: `settingSteps()`, `settingsNeeded()`, `setSettings(patch, affordance?)`,
`markSettingsSeen(ids)`, `resetSettings({ defaults })`, `setting(key)`.

| Callin | Does |
| --- | --- |
| `scranton_lobby settings` | every step with its current values |
| `scranton_lobby settings set <key> <value>` | e.g. `park.on false`; affordance keys as `<affordance>:<key>` |
| `scranton_lobby settings wizard` | surfroster walks you through them again (values kept) |
| `scranton_lobby settings reset` | back to defaults, and the wizard again |

---

## Gates

A post may carry `post.gate = { from }`, a row (e.g. a stagedir row) a `from` field. It still
shows, and you can always apply it by hand, but it acts on its own only when the page you
arrived from matches `from`:

| `from` | Matches |
| --- | --- |
| `horizon/enter` | exactly that page |
| `horizon/*` | `horizon` and anything under it |
| `horiz*` | any page starting with `horiz` |

The client remembers the previous surf path (`lobby.prevSurfPath`); `lobby.gateOpen(from,
arrivedFrom)` and `lobby.gateOf(item)` are exposed for plugins and surfroster.

---

## Sprinter lane

`https://foobarch.net/sprinter` — *"we proudly bring you version S"*.

- The hostpark park `sprinter` is a capture relay to `sprinter_server` on the
  `navi_sprinter` navi (vps3, alias `sprinter_vps3`, relay whitelist on).
- Every `/sprinter/…` address answers (HTTP 200). Existence is in the body:
  `{ ib, addr, tombstone: false, frame }` or `{ ok: false, status: 404 }`.
- Sprinter is the only authority for its lobbies: it keeps the current frame per lobby in
  navi storage, no history and no stored signatures. It does not consult foobarch;
  `sprinter/…` and `scranton/…` are separate rooms.
- Operator: `sprinter_server status | list | drop <path>`.
- Remount after a pot: `unmount -k sprinter_server` then `sprinter_server status` in tmux
  `navi_sprinter`.
- Posts work on sprinter lobbies: the append row lives in the sprinter room (free) and
  the posted frame on foobarch. A post must name the lobby it was posted to, so a post
  made for `scranton/lobby/v1/<page>` doesn't count in `sprinter/scranton/lobby/v1/<page>`.
  Address affordances live on foobarch beside the page and don't depend on the lobby lane.

---

## Operator (publishing)

```text
FOOBARCH_HOST=https://foobarch.net node C_devops/scranton/_hostpark_lobby_v1.mjs --yes          lobby schema, policy, governor
FOOBARCH_HOST=https://foobarch.net node C_devops/scranton/_hostpark_avatar_v1.mjs --yes         avi schema, policy, governor, scranton_avatar mod
FOOBARCH_HOST=https://foobarch.net node C_devops/scranton/_hostpark_affordances_v1.mjs --yes    descriptors, rows schemas + policies, index
FOOBARCH_HOST=https://foobarch.net node C_devops/identity/_publish.mjs --yes --identity torus testkit/surfroster
FOOBARCH_HOST=https://foobarch.net node C_devops/identity/_publish.mjs --yes --identity torus scranton_lobby_v1_surfroster_part
node C_devops/mods/_pot_all.mjs --yes --only <mod> --devnote "<purpose sentence>"
```

Publish the parts **last**: they pin whatever generation of the lobby and affordance frames is
current, so rerun that line after any of those change.

- Lobby and affordance tips are write-gated by `policies/foobarch-shell` (foobarch owner
  key). `--open` skips that for local test hosts.
- The affordance hostpark skips unchanged frames ("same"), so re-running is safe.
- A squatted or broken lobby can be removed with `DELETE /foobarch/admin/delete/<ib>`
  (usage password); the next create at that address goes through the gate again.

---

## Tests

```text
node C_devops/scranton/_smoke_lobby_lua.mjs            lobby Lua rules in fengari (allow + forged cases)
node C_devops/scranton/_smoke_lobby_genesis_host.mjs   in-process hostparkinator + governor + real client
node C_devops/scranton/_smoke_sprinter.mjs             sprinter create/mut8 whitelist, follow mode, posts on sprinter lobbies
node C_devops/scranton/_smoke_lobby_derived_key.mjs    lobby key, tokens, refused-write refund
node C_devops/scranton/_smoke_posts.mjs                posts, registry, trust, frens hops + editors, gates, filter, posted bytes
node C_devops/scranton/_smoke_rows_lua.mjs             rows policy Lua for comments + stagedir (own row push / own delete only)
node C_devops/scranton/_smoke_affordances_host.mjs     in-process host: comments, stagedir, links, frens trust, browser frens edits, navi_script post
node B_native_mods/_smoke_tip_where.mjs                in-process host: newest frame on an ib whose data matches (branch lookup)
node C_devops/scranton/_smoke_surfroster_parts.mjs     the four part assets render from one source with their pins
node C_devops/scranton/_check_surfroster_parts_live.mjs   live: each part serves itself and its pins resolve
```

---

## Keeping the stage

A plain surf replaces the page body, so the stage goes with it. surf has two branches under
the same name and verb: the **embedded** branch built into navi_shell (1.8.16, no stage
support) and the **stage** branch on warez (park `surf`, 1.9.4, `about.branch: "stage"`). The
shell plants the embedded branch only when the `surf` tip has no module yet. A surf already
on that tip is left in place, and `remount` reloads it from the ledger instead of skipping
the live one. `warez_updater check surf` still swaps the stage branch in
(it unmounts surf and loads the `surf` park). The very first swap resets surf settings to
defaults (pinning the park replaces the local `surf` tip); after that the stage branch keeps a
copy and restores them.

```text
surf -k <page>                            keep the stage for this surf
surf --no-k <page>                        drop it even when keepstage is on
surf -settings keepstage true|false      every surf acts like -k
surf -settings proscene true|false       every surf acts like -p
```

- The current stage's members follow the surf and land **behind** the new page's members in
  each slot: the new page's CS0 stays CS0, your old CS0 becomes CS1. Left columns keep their
  inside-out order.
- If you have members to keep and the new page brings no stage, the surf lands on a proscene
  stage (needs stagejockey).
- **Unstage on leave:** members marked `data-unstage-on-leave` stay behind.
  `surfroster_stage_member` (≥ 0.5.0) marks what it places on its own for trusted authors, so a
  page's auto-placed members leave with the page. Members you place by hand stay.

**Picking a branch from the host.** Both branches can live on the one `surf` ib; the tip just
points at whichever was committed last. To read a specific branch, ask for the newest frame
whose data matches (hostparkinator_5000 ≥ 0.7.1, any chain on the ib):

```text
GET /foobarch/tip/surf?data.about.branch=stage      → { ib, addr, frame, latest, where }
GET /foobarch/tip/surf?data.about.branch=embedded   → 404 until an embedded frame is parked
```

Conditions are dotted paths under `frame.data`, compared as strings; several are ANDed.
`latest` says whether the match is also the current tip.

## Pending

- **More affordances.** Any new kind is a descriptor at `scranton/affordance/v1/<name>`
  (plus a rows policy for address shapes) and, if it needs behaviour, a mod exporting
  `affordancePlugin`.

Game state and other non-annotation automation stay on their own tips and mods; they may
consult roster/append.

Related: [stage_part_types.md](../../A_document/stage_part_types.md),
[manifest.md](../../A_document/manifest.md), `horizon_stagedir` `stage_dir`.
