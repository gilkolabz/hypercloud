# Flow artifacts

A flow artifact is a versioned JSON document (**hostpark** by default) that records one journey design: where to start, which HTML each step uses, how named outcomes map to next steps, and optional soft capability flags.

It is a variance record, not executable UI. Prefer also **planting** it as a local tip (+ bin) at the same bare ib so localpark wins — see [runtime.md](runtime.md).

## Minimal shape

```json
{
  "id": "notes_list_direct",
  "description": "Open on list; create and edit are separate screens.",
  "entry": "list",
  "meta": {},
  "routes": {
    "list": "/torus/example/notes/ui/list.html",
    "edit": "/torus/example/notes/ui/edit.html",
    "create": "/torus/example/notes/ui/create.html"
  },
  "policy": {
    "list": {
      "create": "create",
      "open": "edit"
    },
    "create": {
      "success": "edit",
      "cancel": "list"
    },
    "edit": {
      "save": "list",
      "cancel": "list"
    }
  }
}
```

Fields:

- `id` — Stable name for this journey design
- `description` — Human why / what differs
- `entry` — Route key Manager opens after bootstrap
- `routes` — Route key → surfable HTML URL (`/` + hostpark logical path; **not** `/flowerpot/…`)
- `policy` — Named transitions from a screen/context to a route key
- `meta` — Soft flags the Manager or pages may consult (not hard navigation)

## Route keys

A route key is a short name (`list`, `folder`, `capture`, `settings`). It is the Manager’s vocabulary.

`Manager.go("edit")` looks up `routes.edit` and surfs that URL. The same key can point at different HTML files in different flow artifacts — that is how screen variants work without changing call sites in pages.

Prefer stable keys across a product family. Swap URLs and meta; keep keys when the role of the screen is the same.

## Policy

Policy answers: given an event or user choice, which route key next?

Examples of policy shapes (not mandated keys):

- Lookup / resolve: `found` / `missing`
- Form outcomes: `success` / `cancel`
- Sheet hosts: `back` / `save` / `delete`
- Optional forks: `parse` / `skip`

Policy is navigation wiring. It does not implement application rules. Facts come from resting modules (registry lookup returned miss); the Manager uses policy to choose the next screen.

Do not auto-fire side effects from policy alone. Prefer: page offers choices → user acts → Manager navigates per policy.

## Meta

`meta` is for optional behavior on a shared screen role without forking HTML:

- which settings sections to show
- which presentation mode a host supports (`sheet` vs `overlay`)
- which actions are advertised (`edit`, `delete`, …)
- layout hints a page may read

Manager helpers often expose `meta` as typed getters. Pages and resting modules remain free of hard-coded product defaults when the flow can declare them.

If the whole layout of a screen changes, prefer a new HTML file + route URL change (or a composed instance), not an ever-growing meta bag.

## Active flow (pointer tip + body tip)

“Which journey am I on?” is tip data — usually a pointer tip (launch sets it; else config tip default). Mid-session override is the same: mut8 that tip.

One active flow per navi session. Many published flows on hostpark. (Units out of scope.)

Loading the JSON is **not** a separate storage mode. **Local-first** path (UX may refresh):

1. Read pointer tip → logical route (e.g. `opry/…/flow/notes_list_direct.json`).
2. Resolve body at tip ib **equal to that logical route** (bare park ib). Plant/cache there so park-check / surf / fetch passthrough work.
3. On miss (or when Manager wants fresh for UX): `fetch(navi.resolveUrl(logical))` / origin `GET /{logical}`, then plant/mut8 that tip (optional hostpark addr for later refresh).

**Anti-pattern:** concatenating `/flowerpot/` onto the logical route in Manager code. That fetches a different park (often 404) while hostpark already holds the bytes.

Manager owns when to skip or hit the network. Same layer for pointer, config, and artifact bodies.

## Multiple artifacts as design archaeology

Publish alternatives even when divergence is small (splash entry vs direct entry; list-first vs editor-first).

Why:

- Diff two JSON files → see exactly where journeys diverged
- Alternatives stay switchable without rewriting modules
- Ship one active path; keep the rest as usable options

Do not invent a generic rules interpreter early. When a new journey is worth recording, add another concrete JSON file.

## Flow authoring modes (when composition grows)

Inheritance is optional convenience:

- Full authorship — Genuinely different journey. Hand-write the full flow file; instance/program points at it.
- Family base + patch — Same app family; few facts differ. Merge a patch onto a shared base (`routes` / `meta` / `policy` defaults).
- Variant inherit — Same policy; only one screen URL / labels change. Copy parent flow; patch `id`, description, the differing route(s).

Resolution order when using a builder/registry: full `flow` path → `flow_patch` + base → `variant_of` inherit.

Future (pencilled): split shared policy/routes/meta into composable flow fragments — only when fan-out pain justifies it.

## Config sketch

```json
{
  "project": "notes",
  "flowerpot": {
    "registry_module": "torus/example/notes/modules/notes_registry.js",
    "manager_module": "torus/example/notes/modules/notes_manager.js",
    "flow_artifact": "torus/example/notes/flow/notes_list_direct.json",
    "launch_fragment": "torus/example/notes/ui/launch.html"
  }
}
```

Publish config on hostpark; mirror into a config tip at bootstrap — same tip layer as session and flow bodies. Launches set the active-flow pointer tip (and optionally program). Cache artifact bodies under the **same bare ib** as the hostpark route.

Module fields are logical routes for `mount {logical}` — after mount, parks live at `navi:<register.name>`. The config key name `flowerpot` is historical; values are bare hostpark paths.

## Related

- [manager.md](manager.md) — who loads and applies the artifact
- [variants.md](variants.md) — how many flows coexist and get shopped
- [addressing.md](addressing.md) — ids, pot addrs, tips
