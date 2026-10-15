# Navi park addressing — callin, URL, relay

Design notes for hyperuri, slashfold, and the park resolver. Related: [hyperuri.md](./hyperuri.md), [slashfold.md](./slashfold.md), [navi_manifest_space.html](./navi_manifest_space.html), [navi_shell/README.md](../navi_shell/README.md).

---

## Addresses are API

From the user’s perspective, an address is the contract. Syntax is arbitrary; meaning is not.

```text
navi relay status
/navi/relay/status
navi:relay/status
navi%20relay%20status
```

Slashfold and delimiter racing let representation follow human expression without changing what is invoked. See [slashfold.md](./slashfold.md).

**Callin is the front door** into navi state. Direct URL, local text callin, and host relay all enter through the same callin multiplex:

- **path / text segments** — the address (like an HTTP path + optional query)
- **method** — GET (URL / SW) or POST (default local `navi('…')`); relay forwards either
- **headers / body** — the rest of the request when segments are not enough
- **viaRelay** — true only when the host WS forwarded the request

Default local callin is POST. Direct URL inherits GET. Relay always callins (`viaRelay: true`).

```text
callin → localpark → hostpark (when applicable) → callout
```

---

## Capture parks (resolver is dumb)

A tip joins path/callin prefix resolve by setting **`park`** on the frame
(standard shape — see [manifest.md](./manifest.md)):

```json
"park": "capture"
```

```json
"park": "defer"
```

| Value | Meaning |
|-------|---------|
| *(absent)* | Addressable by ib; not in the resolve candidate set |
| `"capture"` | In resolve set; win even if deeper parks exist; keep remainder |
| `"defer"` | In resolve set; yield to longer matching prefixes |

**Deprecated on disk (migrate before remount):** boolean `"park": true` plus
`"park_precedence"` / `"park_capture"` / `"park_depth"`. Runtimes no longer
read those — use `C_devops/identity/_migrate_park_claim.mjs`.

Same rule as hostpark (`foobarch_host.resolveRoute`).

The resolver:

1. Finds matching planted parks whose `ib` prefixes the path.
2. Prefers a **capture** claimant when present; otherwise the **longest**
   (defer) match.
3. Passes trailing segments as remainder/args.
4. Dispatches `method[incomingMethod]` on that tip.

It does **not** infer behavior from control shapes, `default_method`, or tip
names. Route participation is only `park: "capture"|"defer"`.
Execution is only what the frame’s `method.GET` / `method.POST` say.

Mod parks, kernel tips, and hostpark proxies all use this same capture/defer
vocabulary (e.g. `navi:surf`, `flowerpot/…` on the host).

---

## `default_method` (mimex vestige)

Optional on legacy / mimex-oriented frames. **Not used for capture or dispatch** in navi_shell’s park pipe. May still appear on hostpark proxy manifests.

---

## GET vs POST on the frame

Frames own method behavior:

- **Mod parks** — usually mirror GET and POST (`kind: "mod"`, same target/command).
- **Bin-bearing module parks** — same tip provisions and peels live verbs after mount. Local tip first; on miss, callin pins via `Accept: application/navi-mod` (**multipart/related**: eframe + addressed bin), localparks that eframe, mounts from `rel8ns.bin`, then `executeModPark` on navi (host never mounts). Tip-only borrow: `Accept: application/eframe` alone. Raw bytes: `Accept: application/navi-module`.
- **Kernel tips** — may differ per method (`surface`, `relay`, …) as each frame declares.
- **Hostpark proxies** — often GET-only toward a remote listener.

If callin and URL should feel identical to the user, write both handlers that way. Modules that need a request body (CRUD, large text) should read `navi.callinRequest` rather than inventing a relay-specific channel.

---

## `navi:relay`

Frame manifest (`C_devops/navi_redux/seed/navi_relay.frame.json`):

- Target shape: `park: "capture"` (seed may still show legacy boolean + precedence)
- `method.GET` and `method.POST` both `kind: "relay"` (same handler path; seed may still say `http`)

Local access (GET from park.check → callin GET, POST from text callin, bare or with trailing segments):

- Runs relay verbs (`status`, `connect`, …). Bare path behaves like `relay help`.
- **`connect [token|-] [alias]`** — open reverse WebSocket to **`navi.origin`** (no host URL arg; callin would shred `https://…`).

**Via relay channel** (`viaRelay: true` — host WS forwarded into callin):

- Bare `/navi-{alias}/` (empty remainder) → inherent **ping** JSON from the live shell.
- Remainder paths are presumed under `navi/` (`meshyrelay/hello` → `navi/meshyrelay/hello`) unless already `navi/…` / `navi:…`.
- `navi:relay` returns **`navi:relay is local-only.`** for GET and POST.
- Other captured parks (e.g. `navi:surf/…`, `navi:meshyrelay/…`) still dispatch normally over relay.

**foobarch_host HTTP (async callin):** starter request returns **202** `{ job_id, status_path, park_job_path }` after WS `callin` is sent — it does not hang for `result`. Poll `GET /_foobarch/navi_shell/job/{uuid}/{job_id}` or `GET /navi-{alias}/_job/{job_id}`: `running` JSON while in flight; when done, one delivery of the body then the job record is **dumped**. Unclaimed done jobs expire (`FOOBARCH_NAVI_SHELL_JOB_DONE_TTL_MS`, default 60s). Header `X-Navi-Shell-Wait: 1` holds HTTP until `result` under `FOOBARCH_NAVI_SHELL_JOB_MS` (default 10m). WS types remain only `callin` and `result`.

The frame JSON is always available via `navi.storage.tip.get('navi:relay')` — GET on the park address is for operation, not manifest export.

---

## Relay origin: `viaRelay`

Callin request shape (also exposed as `navi.callinRequest` while a command runs):

```typescript
{
  method: 'GET' | 'POST',
  headers: Record<string, string>,
  body: string,
  viaRelay: boolean,
  path: string, // normalized navi/…
}
```

- **Local** — `park.check` / URL, `navi('…')`: `viaRelay` false.
- **Host relay WS** — remainder forwarded from the host: always `dispatchCallin({ …, viaRelay: true })`.

Frames (or kinds like `relay`) may branch on `viaRelay`. The resolver only passes method + origin; it does not interpret policy.

---

---

## `data.method` block

Park tips declare dispatch in **`data.method`** (not `module.commands`).

Each transport key (`GET`, `POST`, `PUT`, …) is one **control object**: `kind`, kind-specific fields, and optional **`commands`** — peelable text verbs for *that* transport.

| Field on control | Meaning |
|----------------|---------|
| `kind` | Handler (`mod`, `relay`, `bin`, `commit`, …) |
| `command` | Default mod command when the park captures (mod parks) |
| `commands` | Allowed explicit verbs after the park path for this transport (omit when only `command` is needed) |

**Single-command mod park** (`navi:browse`, `navi:stagedir`) — `command` only:

```json
"method": {
  "GET":  { "kind": "mod", "target": "surf", "command": "browse", "mode": "async" },
  "POST": { "kind": "mod", "target": "surf", "command": "browse", "mode": "async" },
  "PUT":  { "kind": "commit", "mode": "async" }
}
```

Callin `navi:browse horizon/enter` → park captures at `navi:browse`, default `command: browse`, args `horizon/enter`.

**Multi-verb park** (`navi:relay`) — `commands` on each callin transport:

```json
"method": {
  "GET": {
    "kind": "relay",
    "mode": "sync",
    "commands": ["connect", "status", "token", "advertise", "retire", "help"]
  },
  "POST": {
    "kind": "relay",
    "mode": "async",
    "commands": ["connect", "status", "token", "advertise", "retire", "help"]
  }
}
```

**Multi-command mod** (`navi:surf`) — default `command` plus `commands` on GET/POST:

```json
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
}
```

GET and POST usually mirror each other unless mod commands declare **`methods: ["GET"]` / `["POST"]`** (or both). Mount sync writes per-transport `commands` and defaults (`list` when present). Dispatch reads the active transport control (`method.POST` for callin, `method.GET` for URL park).

**Bin-bearing module park** (planted or hostpark short name) — provision + verbs on one tip:

```json
{
  "ib": "potter_gibbert",
  "data": {
    "park": "capture",
    "content_type": "application/navi-module",
    "method": {
      "GET": {
        "kind": "mod",
        "target": "potter_gibbert",
        "command": "list",
        "commands": ["list", "help"],
        "mode": "async"
      },
      "POST": {
        "kind": "mod",
        "target": "potter_gibbert",
        "command": "list",
        "commands": ["list", "help"],
        "mode": "async"
      }
    },
    "module": { "name": "potter_gibbert" }
  },
  "rel8ns": { "bin": ["bin <sha>"] }
}
```

Bare `/potter_gibbert` ensure-mounts from the bin then runs default `command`. `/potter_gibbert/list` peels the verb. Hostpark tips with `kind: "mod"` serve the bin on GET (like `bin`); `Accept: application/eframe` returns the tip frame; `Accept: application/navi-mod` returns multipart eframe + bin.

**Transport-split mod** (`navi:keychain` proof of concept):

```json
"method": {
  "GET": {
    "kind": "mod",
    "target": "keychain",
    "command": "list",
    "commands": ["list", "show", "help"],
    "mode": "async"
  },
  "POST": {
    "kind": "mod",
    "target": "keychain",
    "command": "list",
    "commands": ["list", "create", "import", "del", "sign", "help"],
    "mode": "async"
  }
}
```

Bare `navi:keychain` on POST still lists keys (same default as GET). `navi:keychain create torus` peels `create` and passes `torus`.

---

## Module authors

1. Flat parks: `navi:<name>`, listed on `navi:mod`.
2. Set `park: "capture"` when the park should take trailing segments.
3. Declare `method.GET` and `method.POST` explicitly.
4. Trailing segments become args (percent-decoded).
5. Optional: read `navi.callinRequest.body` / `.headers` for the HTTP multiplex (do not teach modules about “relay” — relay is just callin with `viaRelay: true`).

---

## Pipe (short)

```text
callin(method, headers, body, viaRelay, path)
  → deepest capture park? → args + method[method] → frame handler
  → else delimiter race → exact tip → method[method]
```

Syntax varies; the address does not. Frames explain; callin gates; the pipe routes.
