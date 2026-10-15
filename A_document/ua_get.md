# scripts/ua_get — shared User-Agent GET handler

**`scripts/ua_get`** is a write-gated Lua park on foobarch_host. Consumer parks
point `http.GET` at it; the script classifies the request and serves bytes from
**that consumer tip’s** menu — not from the Lua tip itself.

One shared classifier, many per-park menus. Lua does not hard-code which bin each
browser or CLI client gets.

## Live docs and source

| What | Where |
|------|--------|
| HTMF readme | https://foobarch.net/readme/scripts/ua_get |
| Same readme (under script ib) | https://foobarch.net/scripts/ua_get/readme |
| Lua bytes | https://foobarch.net/scripts/ua_get |
| Lua source | [`C_devops/identity/scripts/ua_get.lua`](../C_devops/identity/scripts/ua_get.lua) |
| HTMF source | [`C_devops/identity/readme/scripts/ua_get.html`](../C_devops/identity/readme/scripts/ua_get.html) |
| Identity catalog | [`C_devops/identity/_lib.mjs`](../C_devops/identity/_lib.mjs) (`scripts/ua_get`, readme clones) |

Publish (foobarch identity):

```bash
FOOBARCH_HOST=https://foobarch.net node C_devops/identity/_publish.mjs --yes scripts/ua_get
FOOBARCH_HOST=https://foobarch.net node C_devops/identity/_publish.mjs --yes readme/scripts/ua_get scripts/ua_get/readme
```

All three tips are `data.gate === true` and write-gated under `policies/foobarch-shell`.

## How GET resolves

1. Request hits a **consumer** park (e.g. `testkit/text_editor`).
2. That tip’s `http.GET` is `{ "kind": "lua", "script": "scripts/ua_get" }`.
3. Host loads Lua from `scripts/ua_get` and calls `handle(req)`.
4. **`req.tip` is the consumer frame** (ib, data, rel8ns) — not the script tip.
5. Lua reads `req.headers`, classifies User-Agent, picks a case from
   `data.ua.cases` (or `http.GET.ua`), serves the matching bin.

`Accept: application/eframe` alone skips Lua and returns the consumer frame JSON.
Accept priority is html > text > eframe (no tip attach beside other bodies).

## Consumer frame shape

Point GET at the script; put the menu on the consumer:

```json
"http": {
  "GET": { "kind": "lua", "script": "scripts/ua_get" },
  "PUT": { "kind": "commit" }
},
"ua": {
  "default": "default",
  "cases": {
    "default": { "kind": "bin" },
    "chrome":  { "kind": "bin" },
    "cli":     { "kind": "bin", "rel8n": "ua_cli" },
    "curl":    { "kind": "bin", "rel8n": "ua_cli" }
  }
},
"rel8ns": {
  "bin": ["bin <html sha>"],
  "ua_cli": ["bin <plaintext sha>"]
}
```

- `{ "kind": "bin" }` → `rel8ns.bin[0]` (default HTML).
- `{ "kind": "bin", "rel8n": "ua_cli" }` → `rel8ns.ua_cli[0]`.
- Per-browser variants: add named rel8n slots (`ua_edge`, …) and point each case
  at the slot name.

Case ids alone do not pick different bins — set `rel8n`, `bin`, `body`, or
`path` on each case that should differ.

## Classifier ids

`edge`, `ie`, `chrome`, `firefox`, `safari`, `opera`, `cli`, `curl`, `bot`,
`unknown`

Edge is checked before Chrome (Edge UA contains Chrome/Safari tokens). `cli`
covers navi_shell, undici, node-fetch, wget, etc.

## Request header overrides

| Header | Effect |
|--------|--------|
| `X-Navi-Ua-Passthru: 1` | Skip classify; use `ua.passthru` or `ua.default` |
| `X-Navi-Ua-Case: <id>` | Force that case (unknown → default) |
| `Accept: text/plain,…` | Prefer case `text` when plain outranks / appears without `text/html` |
| `Accept: text/html,…` | Prefer case `html` when html outranks / appears without `text/plain` |

Priority: passthru → `X-Navi-Ua-Case` → **Accept** → User-Agent (+ `ua.map`).

Suggested consumer cases: `html` (default `rel8ns.bin`), `text` (e.g. `rel8n: "ua_text"`),
and map `cli` / `curl` → `text`. Native `browse` already sends `Accept: text/plain,…`
(no html); browser `surf` sends `text/html, text/plain`.

Response headers include `X-Navi-Ua-Detected`, `X-Navi-Ua-Accept`, `X-Navi-Ua-Via`,
`X-Navi-Ua-Case`, `X-Navi-Ua-Script`.

## Fail-open

Missing `data.ua`, unknown case, or missing bin → fall back to `rel8ns.bin`, not
a Lua 500.

## Related

- [`hostparking.md`](hostparking.md) — publishing park tips generally
- [`slashfold.md`](slashfold.md) — delimiter race + `data.gate`
- [`C_devops/identity/README.md`](../C_devops/identity/README.md) — Lua GET sketch
  (Edge example) under “Richer GET (Lua)”
