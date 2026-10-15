# Authoring guide

How to build something in the flow model inside foobarch / navi (current tip/park/callin).

## Preconditions

- foobarch origin available (e.g. foobarch.net or local)
- navi_shell in the browser shell
- **hostpark** for publishing product artifacts (default)
- a project workspace (IDE folder and/or hostpark logical root)

## Scaffold (minimal)

```text
{project}/
  readme.md
  devguide.md          # spectrum, why-decisions, citations
  config.json          # default modules + flow (mirror to config tip)
  modules/
    {project}_registry.js
    {project}_init.js
    {project}_manager.js
  flow/
    {name}.json
  ui/
    {product}_skin.css   # shared L3 look (normative)
    {screens}.html
  launch/                # cold-start bookmarks (also load the skin)
  assets/                # optional — banners, icons, product art (not screen roles)
  schema/                # optional
  data/                  # seeds, programs, indexes — optional early
```

Register publish paths in the project hostpark / identity catalog. Include the skin CSS in the same catalog as UI.

## Recommended build order

1. L0–L1 — schema + registry + park commands as needed. Prove facts with no DOM.
2. One flow + Manager + 1–2 screens — entry and one transition.
3. Launch fragment — session tip override + mount init + bootstrap command.
4. More routes / policy as the journey grows.
5. Resting modules when page inline script is not enough.
6. Variants as separate flows/HTML/launches when divergence is real.
7. Programs / instances / builder when fork fan-out hurts.
8. Linker / graph when launch combos outgrow memory.

Do not start with a generic flow engine or a mega Manager. Do not design against shell units.

## Authoring a flow

1. List route keys (screen roles).
2. Point each key at a hostpark HTML transport URL (`/` + logical path, e.g. `/opry/…/ui/list.html`). **Do not** prefix `/flowerpot/`.
3. Set `entry`.
4. Write `policy` for real user outcomes (not speculative).
5. Add `meta` only for soft shared-host flags.
6. Hostpark-push; point config or a launch at the logical route; plant body tips under the **same bare ib** for local-first.

## Authoring a screen

- HTML fragment suitable for surf into `document.body`
- Prefer `data-part` / `data-*` over document-global `id` where collisions matter
- Call Manager via `navi.mod.<managerName>` (live object) or park callin if you exposed commands
- Do not hard-code next URLs; use route keys
- Do not auto-navigate on mount unless the product explicitly wants a redirect screen
- **Load the product skin** (see below) — do not duplicate shared CSS in every fragment

## Authoring a product skin (normative L3)

Shared look across all screens and launches is an L3 hostpark CSS artifact, not flow/Manager work.

1. Create `{root}/ui/{product}_skin.css` (CSS variables + `.product-page` helpers).
2. Hostpark-push at the bare logical route; plant tip at the same ib.
3. Put the route in config (`flowerpot.skin_css`) and in each program’s `layers.L3`.
4. At the top of every `ui/*.html` and `launch/*.html`, ensure one head link:

```html
<script>
(function ensureFlowSkin() {
  var SKIN = "opry/devops/example/ui/example_skin.css";
  if (document.querySelector('link[data-flow-skin="example"]')) return;
  var href = (typeof navi !== "undefined" && navi.resolveUrl)
    ? navi.resolveUrl(SKIN)
    : "/" + SKIN;
  var l = document.createElement("link");
  l.rel = "stylesheet";
  l.href = href;
  l.setAttribute("data-flow-skin", "example");
  document.head.appendChild(l);
})();
</script>
```

Head survives surf, so the skin stays for the whole session. Do **not** invent a flow route for CSS. Do **not** put skin ownership in init/Manager beyond optional reseed of the CSS tip.

## Authoring a launch

```html
<script>
(async function () {
  const FLOW = "torus/example/notes/flow/notes_list_direct.json";
  // wait for navi + storage + surf …
  await navi("mount torus/example/notes/modules/notes_init.js");
  // tip sugar OK; prefer tip.set when you also store hostpark addr / meta
  await navi.storage.item.set("notes:session:flow_artifact", FLOW);
  // park leaf = live register().name (example assumes name "notes_init")
  await navi("notes_init bootstrap");
})();
</script>
```

Init module must export `commands` that include the bootstrap verb, with both GET and POST `kind: "mod"` on the planted park tip (mount does this).

Optional: also set a session tip for `program_id` for composed runtimes / PWA identity.

## Authoring a resting module

Follow `navi_modules_guide.md`: `export const register`, single-segment `name`, `commands` for callin verbs, cleanup in `onUnmount`.

Keep modules journey-agnostic. Accept inputs; return facts; let Manager move. Park tip will be `navi:<name>` — not `navi:mod:<name>`.

## Declaring composition (when ready)

1. Catalog features / fragments with typed ids.
2. Declare instances with `why` and compose lists (or hand-authored `source_rel`).
3. Declare programs that compose family instances + spine flow.
4. Point launches at programs in a launch index.
5. Optionally generate instance HTML/flow/launch via a builder.

## Publishing checklist

- Local (or IDE) file exists for each new artifact
- Path registered in manifest / catalog (and [torus host catalog](/torus/host-catalog) when new product routes appear)
- **Every** fsdevops `put` / `append` / `hostpark-push` carries `goal=<why>` — see [devops-goals.md](devops-goals.md)
- Upload / hostpark script appended a hostpark addr
- Launch or config points at the new flow if it should be reachable
- Pointer / config / artifact tips planted (bodies under the **same bare ib** as hostpark) — local-first
- Linker / graph updated if humans need to find it
- `devguide.md` notes level + why; longer work also in `devops/goals.json`

## Notes-shaped example (illustrative only)

A tiny notes product in this model might publish:

- `notes_registry` — notes CRUD in tip space
- `notes_manager` — load flow, `go`, policy helpers
- `notes_init` — mount stack + bootstrap
- one or more flow JSON files
- UI screens + a launch that sets the flow session tip and mounts init from its **bare hostpark** route

## Related

- [runtime.md](runtime.md)
- [flow-artifacts.md](flow-artifacts.md)
- [composition.md](composition.md)
- [variants.md](variants.md)
- [devops-goals.md](devops-goals.md)
