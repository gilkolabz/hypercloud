# tiny

Local ibgib tips for live HTML on stage: **tiny_ibgib_space** (storage) +
**jockey_tiny** (claims / stamps / orient / menus). Viewport:
`torus/testkit/hypermedia/tinyviewport`.

Tips live in `navi.storage.tip` under the tip ib itself (e.g.
`<data-path>` for tiny HTMF clones). Frame `data.parts` mark them as
`htmf` + `tiny-clone` (plus `ibgib_frame`, `manifest`, `json`). There is
**no** `navi:ibgib:tip:` / `navi:ibgib:frame:` item-key wrapper on new saves
(legacy wrappers are migrated on read). Older tips named `htmf:…` /
`jockey:htmf:…` are still recognized on peel/clear.

`jockey-orient` is **retired** — use jockey_tiny. Do not mount the stub.

## Modules

| Mount | Role |
|---|---|
| `tiny_ibgib_space` | `space.create` / `mut8` / `tip` / `indexUnder` / callin `tiny …` |
| `jockey_tiny` | scrollbuffer claims + menus + callin `orient …` |
| `tinyviewport_manager` | **optional** plugin host for the viewport fragment |
| tinyviewport fragment | lineage / connection graph (flowerpot HTMF, not warez) |

### tinyviewport_manager

Optional. The HTMF fragment detects `navi.mod.tinyviewport_manager` and offers
**mount from warez** if missing. Without it, the fragment still draws same-ib
lineage locally.

Plugins register with:

```js
navi.mod.tinyviewport_manager.registerPlugin({
  id: "my_links",
  label: "my connections",
  enabledByDefault: false,
  legend: [{ id: "my", label: "my edge", color: "#e67e22" }],
  async contribute({ baseIb, getFrame, tipApi, navi }) {
    return {
      nodes: [{ addr, frame, row: "foreign", kind: "tip" }],
      edges: [{ from, to, rel: "my", color: "#e67e22" }],
    };
  },
  styleNode(node, frame, style) {
    // preference stack: return patches —
    // { fill, stroke, text, opacity, label, flair, width, height, detail }
    return null;
  },
});
```

`width` / `height` are logical px at scale 100%; the fragment scales them and grows layout cells. `detail` drives a larger mouseover flair card.

Built-ins:

| Plugin | Default | Role |
|---|---|---|
| `lineage` | on | past / cascade / other rel8n (same as classic viewport) |
| `htmf_href` | off | scan HTML bins for `href` / `hx-get` → other park tips **in the current view** |

Separate warez modules can register more plugins on mount, e.g.
`tinyviewport_flowchart` (`flowchart` plugin — flow-model artifact colors,
labels, route/policy/launch/config edges). Mount manager first, then the plugin
module.

Legend checkboxes toggle plugins. Nodes keep a **ghost** at the layout origin;
drag moves relative `(dx,dy)` (persisted under
`navi:tinyviewport_manager:prefs.offsets`). Cross-ib nodes land on a **foreign**
row. Callin: `tinyviewport_manager status|plugins|plugin on|off <id>`.

## Viewport

Fragment route: `torus/testkit/tinyviewport`
(local: `C_devops/fragment/navi_tinyviewport.html`).

- Click a square → **prune** (confirm **are u sure?** / **yes**) then the frame JSON.
  Prune is `navi.storage.tip.frame.del(ib^gib)`. If that addr was the tip, the
  pointer moves to `past[0]` when it still exists, else the newest remaining
  generation; last frame also drops the tip pointer (`tip.del`).
- Past lines are **only** real `rel8ns.past`. Pruning a middle generation splits
  the chain: the last square before the hole and the squares after it do not
  connect. Each remaining lineage head gets its **own row**.
- Main column = a past-connected lineage (not “all gens of this ib in one line”).
- Green edges = verified cascade attachment only (`mutation_of` maps into
  visible main row). Leaves also attach via frame `data.htmf_ibgib` when set.
- **No** “dump orphans on last main row” — unattached leaves sit on an
  **orphan** band (not implied cascade-from-tip).
- Multiple `tiny-init`s of the same leaf ib (same path/tag on different htmf
  instances) are **distinct branch heads**: createFresh re-points tip, but
  older geneses stay visible; expand walks **that cell’s addr**, not `tip(ib)`.
- With manager: plugin checkboxes, drag-reposition, foreign nodes, style stack.

## Tip ib shape

Tip ib (hyperuri-style, rightmost = deeper):

```text
htmf:<data-path>[:<name>][:<tag>]…
```

Root fragment = `htmf:<data-path>`. Nested element scopes append
`:name` / `:tag` from nesting toward the leaf.

## Live identity: `data-ibgib`

Live DOM only has `data-path` (**ib**). The exact frame is stamped after
tiny-init / tiny-edit:

- **`data-ibgib`** — `ib^gib` of the frame just created/mut8’d, on the
  **edited element** (htmf host for root scope, or the leaf element).
- **`data-htmf-ibgib`** — on leaves: parent htmf host’s `data-ibgib` at
  init/edit time (which htmf gib this leaf was taken from).

Matching:

- **tiny-init** — editable + **no** `data-ibgib`
- **tiny-edit** — **has** `data-ibgib` (mut8 from that addr, not blindly
  `space.tip`)

Claim `types` list **htmf before htm-element**, so an htmf host binds as
**htmf** (not always labeled htm-element). Nested leaves without `data-part`
still bind as htm-element.

Init when a tip already exists but the live node is unstamped: **createFresh**
from live HTML (re-points tip = new genesis). Prior tip past stays in
`indexUnder` but is no longer the tip line. Escape on the init editor does
**not** stamp (create deferred until Enter).

Stage presentation `syncPresentation` keeps stamps in saved outerHTML.

## Claims (`+1`)

| Claim | Types | Behavior |
|---|---|---|
| `tiny-init` | htmf, html, htm-element | No stamp → editor → createFresh + stamp |
| `tiny-edit` | htmf, html, htm-element | Stamp → editor → mut8 stamped addr → restamp |
| `tiny-from-snoop` | htmf, html, htm-element | Fetch wire HTML (snoopy hint); Enter mut8s |
| `tiny-orient` | **htmf / html** | Stamp → `storage.file` + orient index; if no stamp → forceFresh init then orient |
| `tiny-base` | `<a>` / htm-element | Prefix path attrs with `/navi`, `htmx.process`, then `persistLiveEdit` |

Cascade on save: mut8 leaf (or skip mut8 after fresh create that already holds
HTML) → parent **snapshots** (`source=cascade`, `cascade_of` → leaf,
`mutation_of` → parent tip, `updateTip: false`). Parent tip past stays
direct-author only.

## Orient index

Reserved storage.file key: **`navi:tiny:orients`** (JSON map).

```text
<path> → { addr, tipIb, n, at }
```

Publishing also writes HTML to `storage.file` under the data-path (SW
`/navi/…` / `/navi:…`).

Callin (jockey_tiny):

```text
orient list
orient rm <path|ib^gib>
orient <path|ib^gib> [n]
```

`rm` drops the index entry and tries `storage.file.del` for that path.

## Dropdown menus

### `tiny ▸` (top-level root menu)

Discovered via `jockey_tiny.rootDropdownMenu` (same pattern as draggem_div).

| Item | Behavior |
|---|---|
| **tiny-orient** | Dual field (index `<select>` + path/`ib^gib`) → orient |
| **stage tiny frame** | Same picker → stage from `frame.data.html` |

### stagejockey → `stage-member add ▸`

| Item | Behavior |
|---|---|
| **tiny frame** | Same staging picker (alias of stage tiny frame) |

`tiny-orient` is **not** under stage-member add.

UI (classic HTML, not the dropdown mod): contentful `n` options + path or
full addr.

## Indices (`n`)

`space.create` / `mut8` use `nCounter: true` alone. Do **not** also patch
`data.n` in jockey_tiny (that double-count produced odd-only labels like
1,3,5). Omit-genesis still hides empty DNA frames without `data.html`.

## Ops

```text
node C_devops/mods/_pot_all.mjs --only tinyviewport_manager
node C_devops/fragment/_pot_tinyviewport.mjs
node hypernetizen/warez/_upsert.mjs <manifest-ib^gib>
```

tinyviewport HTMF is flowerpot hypermedia — **not** listed on warez.
`tinyviewport_manager` **is** a warez mod (subject + sidecar).

## Mental model

```text
live DOM ──data-path──► ib only
         ──data-ibgib─► exact frame (after init/edit/orient-init)

leaf edit ──► leaf tip mut8 + parent cascade snapshots (non-tip)
tiny-orient ──► storage.file[path] + navi:tiny:orients[path].addr
tiny frame / stage tiny frame ──► stage-member from frame.data.html
```
