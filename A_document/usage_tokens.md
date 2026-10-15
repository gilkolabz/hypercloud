# Foobarch usage tokens in navi mods

How a mod pays for foobarch writes today. If a mod keeps its own token list,
loads tokens from a flowerpot tip, or mints with a password, it predates this
and should be migrated (checklist at the end).

Related: [foobarch_usage_budgets.md](foobarch_usage_budgets.md) (mint sets,
tip reserves), [hostparkinator README](../B_native_mods/hostparkinator_5000/README.md#tokens)
(host side), [stashing.md](stashing.md) (flowerpot / phonebook tooling only).

---

## What costs a token

| Action | Cost |
| --- | --- |
| Commit / tombstone on hostparkinator (`PUT`/`PATCH`/tip-declared `commit`/`tombstone`) | one usage token, unless the tip pays from a reserve |
| `relay connect` (each WebSocket connection) | one token from the stash for the relay host, sent in the hello |
| Reads (`GET`, `/foobarch/tip`, …) | free |
| HTTP callins through a relay park | free (the connection already paid) |

Every host restart or `remount_host` drops relay sockets, so each relayed navi
pays one more token to reconnect.

---

## Where tokens live: the `tokens` tip

One local tip, ib `tokens`, shared by every mod on the navi:

```json
{
  "ib": "tokens",
  "data": {
    "parts": ["navi_park", "ibgib_frame", "manifest", "json"],
    "default_host": "https://foobarch.net",
    "hosts": {
      "https://foobarch.net": {
        "unused": "<token>\n<token>\n",
        "paths": {
          "/my_app": { "unused": "<token>\n" }
        }
      }
    }
  }
}
```

- Keyed by **origin** (`https://foobarch.net`, `https://punchbox.quest`, …).
- `unused` is one token per line. Each change is a new tip generation.
- Optional **path lists** (`/my_app`) are separate budgets: a path only reads
  its own list, never the host-level one.
- Do not edit the tip by hand from a mod; use `navi.tokens`.

---

## `navi.tokens`

All calls are serialized, so two spenders never take the same token.
`host` defaults to the relay host, else `navi.origin`; pass it explicitly when
you write somewhere specific. `path` is optional.

| Call | Returns |
| --- | --- |
| `count(host?, path?)` | number of unused tokens |
| `look(host?, path?)` | first token, left in the stash (throws `NO_TOKENS` if empty) |
| `take(host?, path?)` | first token, removed (throws `NO_TOKENS` if empty) |
| `giveBack(host, token, path?)` | puts it back at the front; returns the new count |
| `add(host, tokens, path?)` | `tokens` = array or whitespace-separated string; skips duplicates; `{ added, count }` |

Empty stash error: `err.code === "NO_TOKENS"`, message
`no usage tokens for <origin><path> — relay tokens add <token…> (or request some via hypertext/intro)`.

---

## Spend pattern

The host consumes a token **only after the commit is saved**. Anything it
refuses (bad envelope, missing payment, policy or genesis gate says no, stale
parent) leaves the token unused. Only two answers mean the token is gone:

- `401 invalid usage token`
- `403 usage token already consumed`

So: take, send, and give it back on any failure except those two.

```js
const host = "https://foobarch.net";
const token = await navi.tokens.take(host);
let res, text;
try {
    res = await fetch(`${host}/${ib}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-Foobarch-Usage-Token": token, ...signHeaders },
        body,
    });
    text = await res.text();
} catch (e) {
    await navi.tokens.giveBack(host, token);
    throw e;
}
if (!res.ok) {
    if (!/consumed|invalid usage token/i.test(text)) await navi.tokens.giveBack(host, token);
    throw new Error(`PUT ${ib} → ${res.status}: ${text.slice(0, 300)}`);
}
```

If a response is lost after the host saved the write, the token you gave back
is already spent; its next use fails with "already consumed" and is dropped.
That is self-healing; do not try to detect it.

Check `count` first if you want a friendly message before doing work; the
`NO_TOKENS` throw from `take` is the same signal.

Never print whole tokens. The first 16 hex (the mint lead) is fine for logs.

---

## Getting tokens into the stash

| Who | How |
| --- | --- |
| Users | `hypertext/intro` → "Request tokens" (note for the Approver) → once approved, tokens are claimed into `navi.tokens` (`token_distro_endpoint` ≥ 0.5.3, requester role) |
| Operators | `relay tokens add <token…>` — host = relay host |
| Operators | `relay tokens file <path>` — one token per line; delete the file afterwards |
| Anyone | `relay tokens` — unused count for the relay host |
| Mods | `navi.tokens.add(host, tokens, path?)` |

Minting (`POST /foobarch/tokens` + `X-Foobarch-Usage-Password`) is an operator
action on the host. Mods must not carry the password or mint.

---

## Writes without a header (reserves)

A tip can pay for its own writes: `data.foobarch.tokens` on the tip (the new
frame drops the head token), or `rel8ns["foobarch.token_reserve"]` → a reserve
tip (two tokens per write). The client sends no usage token at all. Use this
for product state shared by many clients; see
[foobarch_usage_budgets.md](foobarch_usage_budgets.md).

---

## Migrating an older mod

- [ ] Remove the private stash (`<mod>.tokens` in `navi.storage.item`) and its
      `tokens <path>` loader. Use `navi.tokens.take(host)` / `giveBack`.
      Optionally offer a one-time import: `navi.tokens.add(host, oldList)`.
- [ ] Give tokens back only when the error is not `consumed` / `invalid usage token`.
- [ ] Do not load foobarch tokens from flowerpot tips; flowerpot stashes are
      for flowerpot (`X-Flowerpot-Usage-Token`).
- [ ] Point empty-stash errors at `hypertext/intro` or `relay tokens add`.
- [ ] Tip method blocks are `data.method` (`data.http` is ignored), and
      `GET` must be declared explicitly (`GET: { kind: "bin" }` / `"frame"`),
      or the tip answers 405.
- [ ] Sign firstGen writes too (proposal-write-v1 with empty parent). Addresses
      under a governor (`rel8ns.genesis_policy`, hostparkinator ≥ 0.7.0) refuse
      unsigned creates; signing is harmless on open addresses.
- [ ] Mount the keychain by its park (`keychain`), not a flowerpot path.
- [ ] Use `foobarch.net` / hostparkinator naming (`foobarch_host` was renamed
      in 0.4.0).

Examples in this repo: `B_testkit_mods/scranton_lobby_v1_client.js`
(`commit`), `B_testkit_mods/netproposer.js` 0.2.0 (`commitEnvelope`,
a migrated mod), `B_testkit_mods/token_distro_endpoint.js` (claim → `add`).
