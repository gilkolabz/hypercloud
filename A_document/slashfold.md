# slashfold and delimiter race

Fold typed **whitespace** into `/` for callers that still want a single
slash path. **surf / browse / mount passthru does not slashfold** — they
join remainder tokens with a space and look up that ib.

Space, `:`, and `/` are interchangeable delimiters for the same segments.
`//` stays frozen (hyperuri). Absolute URLs are unchanged.

**`%20` is not a delimiter.** Before search, localpark and hostpark turn
`%20` into a space (`horizon%20welcome` → `horizon welcome`). A URL or
surf `fetch` may encode spaces as `%20` on the wire; lookup always sees
whitespace. A literal ib `horizon%20welcome` is one continuous name and
is not reached through this pipeline.

## Race (localpark and hostpark — same rules)

1. **Exact ib first** — `/horizon/welcome` hits `horizon/welcome` if it
   exists.
2. Then every mix of the same segments, ranked **left to right**:
   space, then `:`, then `/`.

Writes keep the separators you wrote. Delete is exact-ib only.

## `data.gate === true`

At most **one** gated frame per delimiter race set. The gated park
**always wins**. Planting a second `gate=true` in the same race rejects.
Ungate with `gate=false` or omit `gate`. Header `X-Navi-Gate-Passthru: 1`
skips the gated winner.

## Capturing parks

If a leading park is capturing (`park_capture` / `park_precedence:
capture`, or local kind=mod prefix), remainder delimiters do not
matter.

## slashfold API (optional)

`await navi.mod.surf.slashfold(input)` — async fold for modules that want
whitespace → `/` (keeps `:` and `//`). Not used on surf passthru.
