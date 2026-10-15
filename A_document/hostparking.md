# Hostparking

**Hostparking** puts a named route on a foobarch host so a plain HTTP GET of that
name returns the bytes parked there. The host holds the tip and answers from it.
The live host is `https://foobarch.net`.

The browser shell does the same thing locally. `navi.park.check` resolves a
planted tip for a path before the network is asked. Hostparking is that win on
the server: anyone who can reach the host reads the current generation of the
route.

## A route is a tip

The public name is an **ib**, a path such as `torus/docs/hostparking`.
`GET /{ib}` follows that name to the **current tip**.

Each publish is one **generation**. The generation's identity is the content
hash of its frame, the **gib**. The address of one generation is `ib^gib`.
`GET /{ib}` returns whatever generation is current. `GET /{ib}^{gib}` pins that
generation, so a later publish leaves the pinned address where it was.

A name the host has never stored answers `404` with `no tip for {ib}`. A pinned
generation the host does not have answers `no frame {addr}`.

## What a GET returns

The tip's frame says what the route does. For a document, image, script, or
other file, `data.method.GET` is `{ "kind": "bin" }`. The host returns the bytes
linked from `rel8ns.bin`, with the content type stored beside those bytes.

The frame and the bytes are separate objects.

- `data` is the meaning: which methods exist, what kind each method is, the
  content type, and whether the route joins path resolve.
- `rel8ns.bin` is a list of `bin <sha256>` links. The host stores those bytes
  once, by hash. Two generations that share the same bytes share the same bin.
- `rel8ns.past` points at the previous `ib^gib`. That is the lineage of the name.

Other method kinds are behavior, or a package, rather than "return this file":

- `mod` is a navi module. A normal GET still has a body.
  `Accept: application/navi-mod` asks for the frame and the module bytes
  together, so a shell can plant the tip and mount it.
  `Accept: application/eframe` asks for the frame alone.
  `Accept: application/navi-module` asks for the raw module bytes.
- `frame` and `manifest` return the frame itself.
- `proxy`, `relay`, `redirect`, and `lua` make the route do work. See
  [navi park addressing](/torus/docs/navi-park-addressing).

A verb the frame does not declare answers `405`.

## Publishing is a commit

A publish is a signed write of a new generation. The client authors the frame.
The host stores that frame as written. The gib is the hash of the frame, so the
generation id is the content.

1. The first write of an ib is `firstGen`. There is no parent.
2. A later write is `mut8`. `rel8ns.past` points at the previous `ib^gib`. The
   name stays. The current tip moves.

The write is a `PUT` or `PATCH` of the envelope to `/{ib}`. A read spends
nothing. A commit spends one usage token, unless the tip pays from a reserve it
already links. Artifact publish and shared runtime state are different jobs.
See [foobarch usage budgets](/torus/docs/foobarch-usage-budgets).

## Who may write

A route that should stay under known authors sits on a **write gate**.

1. A **schema** is seeded once: a `keys.v1` gate, ed25519, m-of-n.
2. A **policy** tip names the authorized public keys and the threshold. It
   links the schema and locks to itself.
3. Each asset commit is signed by a key that policy accepts. The frame's
   `rel8ns` point at the policy. A signature the policy rejects is not stored.

The gate decides who can move the tip. `declare` is a separate, human notice
about license and reuse. See [manifest](/torus/docs/manifest).

## History

Older generations stay reachable through `past`.

- `GET /foobarch/tip/{ib}` returns the current tip and its frame.
- `GET /foobarch/frame/{ib}^{gib}` returns one generation.
- `GET /foobarch/span/{ib}` returns the past chain in order. `dir` is
  `reverse`, `forward`, or `all`. `limit` and `offset` page it. `addrsOnly`
  returns addresses without full frames. This matches `navi.storage.tip.span`.
  One span read mirrors a lineage; walking `past` one generation at a time
  takes a request per step.

A tombstone ends a route: the name stops resolving, and a later first write can
reclaim it. Hard delete of a tip is an admin act, separate from a tombstone.

## Park versus address

An ib is already an address. The `park` field only says whether this tip
competes for prefixes of longer paths.

- Absent: fetch the name itself. The tip is not a candidate for longer paths.
- `"capture"`: this tip wins, including when a longer park also matches, and it
  keeps the remainder.
- `"defer"`: this tip yields to a longer matching prefix.

A document fetched at its exact name often omits `park`. A module or a shell
surface that should answer `/{ib}/…` sets `capture` or `defer`. See
[navi park addressing](/torus/docs/navi-park-addressing).

## Artifacts and live facts

Hostparking publishes the artifact readers fetch: the page, the module, the
image, the schema. Live shared facts (a ledger, a session row, a score) are
ordinary tip commits on a route that already exists. Those commits are paid by
a usage token on the request, or by a reserve the frame already links, so a
client can write without holding a token. See
[foobarch usage budgets](/torus/docs/foobarch-usage-budgets).
