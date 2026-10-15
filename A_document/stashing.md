# Stashing usage tokens

Flowerpot and Phonebook both mint **one-shot usage tokens**. Operators keep a
**stash** (a list of unused tokens) somewhere convenient, then **consume** from
the front of the list as they pot, subscribe, or otherwise call gated APIs.

This doc covers the shared stash shape, how Navi modules load it, and the
native **faucet** that redispenses tokens over a local HTTP API.

**Foobarch tokens do not use this pattern.** A navi keeps foobarch usage tokens
in its local `tokens` tip via `navi.tokens` (take / giveBack / add per host); see
[usage_tokens.md](usage_tokens.md). Header-less product writes use tip reserves
(`data.foobarch.tokens` / `foobarch.token_reserve`); see
[foobarch_usage_budgets.md](foobarch_usage_budgets.md). This file is **devops
tooling** stashes for flowerpot / phonebook only.

Native listener modules live under [`B_native_mods/`](../B_native_mods/README.md)
(`torus/native/*` on Flowerpot).

---

## Consumable tip shape

A stash tip on Flowerpot is JSON in one of these forms (all accepted):

```json
{ "spare tokens": ["abc…", "def…"] }
```

```json
{ "tokens": ["abc…", "def…"] }
```

```json
["abc…", "def…"]
```

Convention in this repo:

| Service    | Example tip                         | Header when spent                          |
|------------|-------------------------------------|--------------------------------------------|
| Flowerpot  | `torus/devops/tokens/a`             | `X-Flowerpot-Usage-Token`                  |
| Phonebook  | `torus/devops/phonebook-tokens/a`   | `X-Phonebook-Usage-Token`                  |

Minting is owner/password gated on each service (`POST /_flowerpot/tokens`,
`POST /_phonebook/tokens`, …). Stashing is just **publishing the leftover list**
as a tip so clients can refill without pasting secrets into chat.

---

## Pattern in Navi

1. **Keep a local queue** in `navi.storage` (or a native ledger on disk).
2. **Refill** by `GET`ting a Flowerpot path that holds the consumable JSON;
   append into the local queue.
3. **Take** = `shift()` one token, persist the remainder, send it on the request.
4. On failed requests that never consumed the token, **unshift** it back
   (potter does this).

Browser potter:

```text
mount flowerpot/hypercloud/testkit/mods/legacy/potter.js
potter tokens torus/devops/tokens/a
potter tokens list
potter tokens count
```

`potter tokens <path>` GETs the tip, parses `spare tokens` / `tokens` / array,
and merges into `potter.tokens`. Each pot consumes one.

---

## Native faucet (`faucet_server`)

Sometimes many tools need tokens without each one holding its own stash.
**faucet_server** (navi_shell.exe only) keeps named stashes on disk and
**generously** hands out one token per request on localhost.

Defaults: `flowerpot`, `phonebook`. You can `add` arbitrary service names.

```text
mount flowerpot/torus/native/server_manager
mount flowerpot/torus/native/faucet_server

faucet_server feed flowerpot torus/devops/tokens/a
faucet_server feed phonebook torus/devops/phonebook-tokens/a
faucet_server services
faucet_server start
```

Or via the manager:

```text
servers start faucet_server
servers status faucet_server
```

### Callin

| Command | Effect |
|---------|--------|
| `faucet_server start [port]` | Listen on `localhost` (default **8080**) |
| `faucet_server stop` / `status` / `help` | Lifecycle |
| `faucet_server services` | Names + counts (no secrets) |
| `faucet_server add <name>` | New empty stash |
| `faucet_server remove <name>` | Drop a non-default stash |
| `faucet_server feed <name> <fp-path>` | GET Flowerpot tip → append |
| `faucet_server push <name> <token…>` | Append literals |
| `faucet_server count [name]` | Remaining |
| `faucet_server clear <name>` | Empty one stash |
| `faucet_server take <name>` | Dispense one via callin |

### HTTP (localhost, no auth)

```text
GET  http://localhost:8080/health
GET  http://localhost:8080/services
GET  http://localhost:8080/token/flowerpot
GET  http://localhost:8080/token/phonebook
```

Response when fed: raw token string body (`text/plain`), not JSON. Empty stash → `503` with empty body.

Ledger path: `~/.navi_shell/faucet_server/ledger.json`
(override with `FAUCET_SERVER_DATA`).

### Custom service example

```text
faucet_server add myapi
faucet_server feed myapi torus/devops/myapi-tokens/a
curl http://localhost:8080/token/myapi
```

---

## Related modules

| Module | Role |
|--------|------|
| `potter` | Browser/client potting; local `potter.tokens` stash |
| `phonebook_client` | Browser/client; reports frames; spends phonebook usage tokens |
| `phonebook_server` | Native Phonebook HTTP; navi.storage state; feed Flowerpot + usage token stashes (or mint usage) |
| `faucet_server` | Shared redispenser for already-minted stashes |
| `server_manager` | `servers list\|start\|stop\|status` for native listeners |

See [B_native_mods/README.md](../B_native_mods/README.md) for mount routes and
`navi.require` notes for native modules.
