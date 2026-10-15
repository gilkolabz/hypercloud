# Manifests

A **manifest** is the **contract inside an ibgib frame**: the JSON in `data`
that says what this address is for and how to use it (**method** controls,
optional **park** claim policy, optional **declare** (license / robots /
attribution), about/notes, subject/attestation, domain payload).

```text
{ ib, gib, data, rel8ns }
```

- A **tip** is only a pointer to the latest `ib^gib`.
- Generations live in frame space; lineage walks `rel8ns.past`.
- **Any tip with an `ib` is already addressable** (`tip.get`, reference by ib).
  That is not what `park` means.
- **`method`** (not `http`) is the verb map when the tip handles HTTP/callin
  verbs. There is **no** required `parts` tag that means “has method controls.”

This replaces the older lead definition (“tagged vague JSON”). Soft tags may
still appear in `data.parts`, but they are not the definition of a manifest —
and whether tip-level `parts` stay at all is **under consolidation** (see
below).

Related: [navi_manifest_space.html](navi_manifest_space.html) (host ↔ shell),
[navi_park_addressing.md](navi_park_addressing.md) (callin / capture),
[stage_part_types.md](stage_part_types.md) (stage occupant types — different
`parts` problem).

---

## Frame shape

```json
{
  "ib": "navi:surf",
  "gib": "<content-hash-of-data>",
  "data": {
    "park": "capture",
    "default_method": "GET",
    "method": {
      "GET": { "kind": "mod", "target": "surf", "command": "surf", "mode": "async" },
      "POST": { "kind": "mod", "target": "surf", "command": "surf", "mode": "async" }
    },
    "about": { "label": "surf", "description": "…" },
    "n": 0,
    "timestamp": "<stamp>"
  },
  "rel8ns": {
    "past": [],
    "bin": [],
    "tjp": [],
    "dna": []
  }
}
```

**`data` — common blocks**

| Block | Role |
| --- | --- |
| `park` | Optional route-claim policy: `"capture"` \| `"defer"` (see below) |
| `method` | Per-verb controls (`kind`, `target`, `command`, `commands`, `mode`, …) |
| `content_type` | MIME for tip bin when GET serves bytes (`application/navi-module` for module parks) |
| `default_method` | Convenience default verb (legacy/mimex; not a substitute for `method`) |
| `declare` | Optional soft strings: license / robots / attribution / copyright / notice / … |
| `about` | Label, description, version, requires, commit-devnote, … |
| `subject` | Points at another tip’s bytes (module card) |
| `attestation` | Crypto proof (usually over `subject`) |
| `n`, `timestamp` | Generation hygiene when mut8’d |
| domain fields | Still on `data`: `parks[]`, stage maps, settings, warez `frames[]`, events, … |

**`rel8ns` — links**

| Rel | Role |
| --- | --- |
| `past` | Prior `ib^gib` |
| `bin` | `bin <sha>` opaque media for this tip |
| `policy` / `read_policy` / `schema` | Machine ACL gates (keys / Lua) when used — not the same as `declare` |
| `tjp` / `dna` | ibgib bookkeeping |

Behavior and meaning live in **`data`**. Identity links and blobs live in
**`rel8ns`**.

---

## `park` — route claim (not addressability)

An `ib` already means the tip can be referenced. **`park` only means: take part
in path/callin prefix resolve**, and how to win among candidates.

| Value | Meaning |
| --- | --- |
| *(absent)* | Addressable by ib; **not** in the resolve candidate set |
| `"capture"` | In resolve set; win even if deeper parks exist; keep remainder |
| `"defer"` | In resolve set; yield to longer matching prefixes when present |

**Deprecated (do not author; migrate off):**

| Old | New |
| --- | --- |
| `"park": true` | `"park": "defer"` (unless you meant capture) |
| `"park_precedence": "capture"` | `"park": "capture"` |
| `"park_precedence": "longest"` / omit with `park: true` | `"park": "defer"` |
| `"park_depth": …` | drop — tip `ib` segments define prefix length |
| `"park_capture": true` | `"park": "capture"` |

Runtimes (**foobarch_host ≥ 0.3.17**, navi_shell) read **only**
`"capture"` / `"defer"`. Convert live tips with
`C_devops/identity/_migrate_park_claim.mjs` before remount.

---

## `declare` — sovereign soft declarations

Optional, small, **per-frame**. Lets each tip speak for itself about how others
may treat / redistribute its content — without site-wide robots.txt and without
stuffing essays into `about`.

**Prefer strings.** This block is mainly **human-oriented** (and polite
clients). Dual licenses, custom terms, notices — describe them in a string; do
not invent a multi-license schema. All keys are **optional** and **per case**.

```json
"declare": {
  "license": "MIT",
  "robots": "noindex, noai",
  "attribution": "© Example"
}
```

`license` may be a short name **or** a URL (pick whichever fits):

```json
"declare": { "license": "https://opensource.org/licenses/MIT" }
```

```json
"declare": {
  "license": "MIT OR Apache-2.0 — see https://example.com/LICENSE"
}
```

### Common keys (none required)

| Key | Role |
| --- | --- |
| `license` | How redistribution is allowed — id, phrase, or URL |
| `robots` | Crawl / use directives as a normal robots string (same spirit as `X-Robots-Tag`; do not invent a new robots language) |
| `attribution` | Credit line when useful |
| `copyright` | Copyright line when you want it separate from attribution |
| `notice` | Extra human notice (warranty disclaimer, geographic limit, …) |

Other short string keys are fine when a case needs them (e.g. `terms` URL,
`contact`). Keep values strings; omit anything unused.

### Case examples

**Open module card**

```json
"declare": {
  "license": "MIT",
  "attribution": "hypernetizen"
}
```

**Bin tip — don’t index, don’t train**

```json
"declare": {
  "robots": "noindex, noai",
  "license": "All rights reserved"
}
```

**Custom terms by URL**

```json
"declare": {
  "license": "https://example.com/terms",
  "copyright": "© 2026 Example",
  "notice": "No resale of binary builds"
}
```

**Images / media — AI image training opt-out**

```json
"declare": {
  "robots": "noimageai",
  "license": "CC-BY-NC-4.0",
  "attribution": "Photo: …"
}
```

### `robots` (reuse the web; don’t rewrite it)

Put the same kind of comma-separated directives you would put in
`X-Robots-Tag` / meta robots. Classic ones include `noindex`, `nofollow`,
`none`, …

**What `noai` means:** a community robots directive asking AI systems **not to
use this content for model training**. It does **not** by itself block crawl,
download, search indexing, or scraping. **`noimageai`** is the same idea for
**images**. These are **voluntary** signals (not an IETF standard); well-behaved
AI crawlers may honor them; enforcement is not guaranteed. Hard deny still
needs `rel8ns.read_policy` (or not serving the bytes).

Omit `declare` entirely when you have nothing to say. Do not put key lists or
Lua here.

**Boundary:** `declare` is **declaration**. **Enforcement** (401/403, signed
writes, paid tokens) stays on `rel8ns.policy` / `rel8ns.read_policy` (and usage
tokens) when attached.

---

## Deprecating tip `parts` noise

These tip-level tags are **deprecated / unnecessary** going forward:

| Tag | Note |
| --- | --- |
| `ibgib_frame` | Implied by being a frame |
| `json` | Implied by JSON `data` |
| `network_proposal` | Legacy host left tag; retiring as a product word (may later mean licensing — not required for parks) |

Prefer **`method`** only in new writing and new frames. Runtime may still accept
`data.http` as a compat alias for a while; do not document it as current.

---

## `parts` — under consolidation

Today two different systems share the word **parts**:

1. **Tip / frame `data.parts`** — optional labels on manifests (`navi_park`,
   `module_sidecar`, `attestation`, `manifest`, …). Often ignored by the park
   resolver; useful for humans and some catalog tools.
2. **Stage / stagedir** — document `stage_dir`, occupant `type`, DOM
   `data-part`. This is a real type vocabulary for layout. See
   [stage_part_types.md](stage_part_types.md).

**Open design question:** do manifests still need tip-level `parts` at all?

- **Park / method:** no parts tag required — fields are enough.
- **Attestation / module card:** consumers today often look for
  `attestation` / `module_sidecar` in `parts` *and* for the fields; we can
  move to field presence only.
- **Stage:** keep a typed parts/type story; do not force that model onto every
  tip.

Until decided: new docs treat tip `parts` as **optional specialization
labels**, not the definition of a manifest. Existing frames may still carry
legacy tails (`manifest`, `json`, `ibgib_frame`).

### Tip-level parts actually seen (inventory)

**Generic tails (deprecate as required):** `manifest`, `json`, `ibgib_frame`,
`network_proposal`

**Navi seeds (specialization):** `navi_park`, `navi_unit`, `navi_relay`,
`navi_mod_index`, `navi_init_script`, …

**Module cards:** `module_sidecar`, `attestation` (+ legacy tails)

**Storage sugar tips:** `storage_item`, `storage_file`

**Stage documents:** `stage_dir` (+ tails) — stage world, not park dispatch

**Also documented / occasional:** `identity`, `warez_index`, …

---

## Ways to use the same frame (with examples)

Same frame shape; different fields filled. Examples are **illustrative target
shape** (legacy `parts` tails omitted on purpose).

### 1. Park / route tip

In the resolve set (`park` set) and handles verbs via `method`.

**Bin-bearing module parks** (`kind: "mod"` + `rel8ns.bin` + `content_type: application/navi-module`) are one frame with two jobs: **provision** (ensure-mount from tip bin / hostpark `Accept: application/navi-mod` multipart eframe+bin) and **verbology** (peel `commands` / default `command` after mount). Short hostpark ibs (underscore `about.name`) may differ from live `target` (`about.navi_name`). Kernel aliases like `mount` / `browse` / `unmount` → `target: surf` are not bin-bearing module parks.

```json
{
  "ib": "navi:surf",
  "gib": "<gib>",
  "data": {
    "park": "capture",
    "default_method": "GET",
    "method": {
      "GET": {
        "kind": "mod",
        "target": "surf",
        "command": "surf",
        "mode": "async",
        "commands": ["surf", "surf_settings"]
      },
      "POST": {
        "kind": "mod",
        "target": "surf",
        "command": "surf",
        "mode": "async",
        "commands": ["surf", "surf_settings"]
      }
    },
    "about": {
      "label": "surf",
      "description": "surf mod park — fetch/swap routes"
    },
    "n": 0,
    "timestamp": "<stamp>"
  },
  "rel8ns": { "past": [], "bin": [], "tjp": [], "dna": [] }
}
```

### 2. Module card (subject + attestation)

Catalog / warez entry. Points at module bytes tip; **no `park`** unless you
also want it in path resolve.

```json
{
  "ib": "hypercloud/testkit/mods/stagejockey",
  "gib": "<gib>",
  "data": {
    "about": {
      "name": "stagejockey",
      "version": "0.9.78",
      "description": "Stage pick…",
      "requires": [
        "flowerpot/hypercloud/testkit/mods/legacy/supermouse.js"
      ],
      "commit-devnote": "…"
    },
    "declare": {
      "license": "https://…/license",
      "attribution": "hypernetizen warez"
    },
    "subject": {
      "ib": "flowerpot/hypercloud/testkit/mods/legacy/supermouse_plugin_stagejockey.js",
      "addr": "…js^GIB.HASH",
      "content_sha256": "…",
      "content_type": "application/navi-module"
    },
    "attestation": {
      "scheme": "hypernetizen-attestation-v1",
      "identity_ib": "hypernetizen",
      "public_key": "…",
      "signature": "…"
    },
    "n": 0,
    "timestamp": "<stamp>"
  },
  "rel8ns": { "past": [], "tjp": [], "dna": [] }
}
```

### 3. Index / ledger

Lists other tip addrs (or park registrations) in `data`.

```json
{
  "ib": "navi:mod",
  "gib": "<gib>",
  "data": {
    "park": "capture",
    "method": {
      "GET": { "kind": "frame", "mode": "sync" }
    },
    "about": {
      "description": "registration ledger — parks[] after mounts"
    },
    "parks": [],
    "n": 0,
    "timestamp": "<stamp>"
  },
  "rel8ns": { "past": [], "tjp": [], "dna": [] }
}
```

Warez index variant uses something like `frames: ["path/to/card^GIB", …]` on
`data` instead of `parks`.

### 4. Bin-backed content tip

GET serves bytes from `rel8ns.bin`.

```json
{
  "ib": "hypertext/welcome",
  "gib": "<gib>",
  "data": {
    "park": "capture",
    "content_type": "text/html; charset=utf-8",
    "method": {
      "GET": { "kind": "bin" }
    },
    "about": { "label": "welcome" },
    "n": 0,
    "timestamp": "<stamp>"
  },
  "rel8ns": {
    "bin": ["bin <sha256>"],
    "past": [],
    "tjp": [],
    "dna": []
  }
}
```

### 5. Event / log tip

**No `park`.** Mut8 appends generations; readers use `tip.span` / `past`.

```json
{
  "ib": "navi:relay:log",
  "gib": "<gib>",
  "data": {
    "about": {
      "label": "navi:relay:log",
      "description": "relay event log — one event per mut8"
    },
    "n": 0,
    "timestamp": "<stamp>"
  },
  "rel8ns": { "past": [], "tjp": [], "dna": [] }
}
```

### 6. Stage / layout tip

Stage map payload on `data` (slots like `CS`, …). This is where **stage**
typing still matters; see [stage_part_types.md](stage_part_types.md). Tip-level
`parts: ["stage_dir", …]` may remain until stage vocabulary is folded cleanly.

```json
{
  "ib": "navi:stage/…",
  "gib": "<gib>",
  "data": {
    "CS": [],
    "USL": [],
    "about": { "description": "3×3 stage map" },
    "n": 0,
    "timestamp": "<stamp>"
  },
  "rel8ns": { "past": [], "tjp": [], "dna": [] }
}
```

### 7. Identity / discovery tip

```json
{
  "ib": "hypernetizen",
  "gib": "<gib>",
  "data": {
    "about": {
      "label": "hypernetizen",
      "description": "attestation identity"
    },
    "public_key": "…",
    "n": 0,
    "timestamp": "<stamp>"
  },
  "rel8ns": { "past": [], "tjp": [], "dna": [] }
}
```

---

## Direction

1. Write and read **manifests as frames** with clear `data` / `rel8ns` roles.
2. Treat **`method`** as the verb contract; **`park`: `"capture"` \| `"defer"`**
   as optional route-claim policy (not addressability).
3. Optional **`declare`** for per-tip license / robots / attribution
   (soft); machine ACL stays on `rel8ns.policy*`.
4. Drop documenting `ibgib_frame` / `json` / `network_proposal` as required;
   drop `park_depth` / boolean `park` / `park_precedence` from new writing.
5. **Consolidate `parts`:** decide tip-level labels vs stage types so the word
   does not mean two incompatible systems forever.
