# Foobarch usage budgets (token sets + tip reserves)

**Vision.** Usage tokens should do more than gate writes with a header. A mint **batch** should be recognizable as **one budget** (shared lead on every token). Tips should be able to **carry** or **point at** a stash of those tokens so clients can mutate without holding a usage token — write access as an **obscure tip address** + a **depleting reserve**, fine-grained per product (or per operator / tenant).

Canonical host module: `B_native_mods/hostparkinator_5000.js` (formerly `foobarch_host`; reserves since 0.3.15). Operator detail: [hostparkinator README](../B_native_mods/hostparkinator_5000/README.md#tokens). **Spending tokens from a mod** (the `navi.tokens` stash, refund rules): [usage_tokens.md](usage_tokens.md).

## Mint shape (budget set)

Minting **N** tokens at once uses one shared **16-hex lead**, then a unique **48-hex** suffix each (**64** hex total).

```http
POST /foobarch/tokens
X-Foobarch-Usage-Password: <pwd>
{"count": N}

→ { "tokens": ["<16lead><48suffix>", …] }
```

Response is still just `{ tokens }`. The lead is in the string: `tokens[i].slice(0, 16)`. Same lead ⇒ same mint set / budget context.

Legacy unused flat 64-char tokens (pre–set-lead) remain valid via header until spent.

## Mutation payment (precedence)

Applies to **commit / tombstone kinds** on any HTTP verb (not “non-GET”). A tip may declare `GET: { kind: "commit" }` and that mutation still needs payment. **Reads stay unpaid.**

1. **`X-Foobarch-Usage-Token`** if present — consume one from the global table  
2. else **`data.foobarch.tokens`** on **that** tip — spend from the front; client’s new frame must **drop the head** only  
3. else **`rel8ns["foobarch.token_reserve"]`** / **`data.foobarch.token_reserve`** — spend **two** from the reserve tip (one for the content mut8, one for the host mut8 that drops them from the index)

Naive clients can hit a tip that already links a reserve and **never see** a usage token.

Tokens are consumed only after the commit is saved: a refused write (bad
envelope, policy / genesis gate denial, stale parent) spends nothing. A header
token is dead only on `401 invalid usage token` / `403 usage token already consumed`.

Relay connections also pay: each `relay connect` WebSocket spends one token
from the navi's stash for that host.

### Self-funded tip

```json
"data": {
  "foobarch": {
    "tokens": ["aabb…", "…"]
  }
}
```

### Content tip → reserve

```json
"rel8ns": {
  "foobarch.token_reserve": ["<obscure-reserve-ib>"]
}
```

Append more tokens later with an ordinary mut8 that extends `data.foobarch.tokens` (paid by header or another reserve).

## Product pattern (shared state without IAM in the client)

1. **Mint a budget** — one lead, many tokens. Treat the set as that operator’s / product’s write allowance.  
2. **Park a reserve tip** under an **obscure ib** (random alphanumeric segment — not a guessable product path). Put unused tokens in `data.foobarch.tokens`.  
3. **Give the operator the reserve ib** (and/or a bootstrap tip that already `rel8ns` to it) — not the usage password, not a long-lived header stash in the app.  
4. **Work frames** (job facts, punch frames, session state, …) **point at** that reserve. Clients mut8 those frames; payment comes from the reserve. State lives in the frame lineage; budget depletes on the reserve tip.  
5. **Refill** by minting another set (same or new lead) and appending to the reserve.  
6. **Realtime later** (optional) — if tip polling is not enough, add a thin proxy / dispatch capture to a server you control. Not required for the first shared-state story.

Fine-grained: different products (or PM vs sub budgets) get **different reserve tips** and different mint leads. Obscurity of the ib is part of the access story; do not publish reserve ibs on public catalogs.

## Not the same as

| Mechanism | Role |
|-----------|------|
| Flowerpot / phonebook **stashes** ([stashing.md](stashing.md)) | Devops publish tokens in JSON tips / faucet for **tooling** |
| `X-Foobarch-Usage-Token` header | Classic one-shot; still first precedence |
| `navi.tokens` (local `tokens` tip) ([usage_tokens.md](usage_tokens.md)) | Where a navi keeps its header tokens per host; filled by `hypertext/intro` claims or `relay tokens add` |
| Write-gate **identity** (schema + policy keys) | Who may overwrite a gated tip — orthogonal to usage payment |
| Hostpark **product artifacts** (`opry/…`) | Published app bytes — usually identity-signed, not end-user reserves |

## Related

- [hostparking.md](hostparking.md) — park tips as served routes  
- [navi_park_addressing.md](navi_park_addressing.md) — local vs host park  
- Docs HTMF: `/torus/docs/foobarch-usage-budgets`  
- [usage_tokens.md](usage_tokens.md) — `navi.tokens` API and spend pattern for mods  
- Module: `torus/native/hostparkinator_5000` (hostpark remount route)
