// HYPERURI EXPLAINED
the core interest of hyperuri is to make uniform the addressing of concerns
the key proposal is:
if we request to a route and expect a return:

1) we have the request representation, 
2) there is the origin it points to who is invoked
3) the origin has information or operation that is invoked
3) and we have the return representation.

if we say the client is the requester, and the server is the returner

from the client's POV, the request representation mutates arbitrarily according to the server's POV
the only thing that is not arbitrary, is the server's claim to the namespace invoked which the client has accepted

this means that if the full request representation is contained in a word "foo" this word represents a namespace
if we sent this request "foo" the server may arbitrarily interpret this as anything and return anything
so the client accepts that it is equally possible that "foo" is a namespace, a schema, a path, a program, a function, a file, or all the above

if we simplify the relationship between client and server to the REPL model, where the user inputs and the obscure party responds,
the user may type into the input field "foo", this is referred to as a command.
if we adopt the norms of cli "foo" may be followed by subcommands "foo bar baz qux"
if we do not obfuscate the patterns presented, it follows that subcommands are hierarchically subordinate to their command
therefore "foo bar baz qux" could easily translate to "foo/bar/baz/qux"
the value of the words and their sequence approximates equal significance in both formats from the client's POV
there is some information lost, as "foo bar baz" is more clearly interpreted as a command, where as the purpose of "foo/bar/baz" is less clear for the client

the use of schema : notation assists in adding context to what follows, so it leads: foo:bar/baz . this is also an address notation that is clearly not a command.
here we begin the activity of organizing an expanding address with added context.
foobar:foo:bar/baz is foo:bar/baz recontextualized for the client to an arbitrary extent by the schema

when u add to the left of an address, the address is encapsulated to an arbitrary degree
when u add to the right of an address, the address is explicated to an arbitrary degree

as a representation is passed around, it can extend to accumulate its context readably, though extending to the right obfuscates the origin.
naturally, as a representation is mutated by a sequence of request and returns, the most recent context stub is the leftmost name
navi:foobar:foo:bar/baz^hash
if we wish to invoke this representation in command notation:
navi foobar foo bar baz
we can basically describe a series of operations, the data pointed to at "bar/baz" is requested, a function "foo" is requested to be performed upon that return,
and upon the return of "foo", "foobar" may be requested to be performed. "navi" may change the entire request sequence to mean something else entirely.
similarly navi/foobar/foo/bar/baz can have hierarchical coherence as a routed path
a problem arrives when we abstract complex statements like this, as the namespace constricts for the server as we expand into alternate namespaces
if "foo" is a namespace/function, what happens if its unrelated sibling function "foobar" has an unrelated child "foo"?
foobar/foo/bar and foo/bar both are handled by the server API without issue, but if we try to chain the return of foo/bar into a foobar request, our notation is insufficient to describe what we want
this is where we introduce the use of // to delimit uri when describing them in sequence. this satisfies the use of // as a prefix for an authority, as the next segment describes the most authoritative schema for the uri that follows. We can add this to the use of : when encapsulating to preserve the following name
foobar://foo:bar
and when this is flattened into a path for a request:
foobar//foo/bar
"foobar" and "foo" are both top level namespaces, but the uri they belong to together ("hyperuri" tada!) still describes "foobar" as the highest priority namespace. In command notation, the // is represented using -- which is normally used to delimit operands.
foobar -- foo bar
foobar://foo:bar
foobar//foo/bar
these are meaningfully distinct from:
foobar foo bar
foobar:foo:bar
foobar/foo/bar

this spec does not meaningfully address any issue on its own, it is only useful in the context of describing a pipeline of requests at once.
this spec also requires that authoritative namespaces do not include : or / characters in their name or they will not be parsed properly.

now if I describe these addresses:
A "navi:foobar:foo:bar"
B "navi:foobar://foo:bar"

These may very well be describing the exact same thing. Though, address "B" can be used to initiate 2 requests, as it describes two active namespaces,
whereas address "A" has a more obscure definition, as the "foo" namespace disappears into the shadow of the "foobar" namespace

note: if the operation between two stages is not apparent, such as a GET data blob chained to a GET data blob, the resolver should simply append the previous blob to the latest and form a multipart response body

## Server invocation (mimex:)

Hyperuri pipelines are executed by the **mimex** server (`hypercloud/mimex`, default `:8089`). Foobarch routes `/mimex/{hyperuri}` to mimex via the `mimex` proposal (`strip_key`).

In schema notation, prefix a pipeline address with **`mimex:`** to mark it as hyperuri-processing intent:

```
mimex:flowerpot_save/horizon/manifest//spacebarz/fuse//arbiter/...
```

HTTP equivalent: `GET /mimex/flowerpot_save/horizon/manifest//spacebarz/fuse//arbiter/...`

### Stage separator: `//` vs `/--/`

Between pipeline stages, hyperuri uses a delimiter so each stage keeps its own top-level namespace (same role as `--` in command notation: `foobar -- foo bar` ↔ `foobar//foo/bar`).

Two path spellings are equivalent to mimex:

| Form | Example | When |
|------|---------|------|
| `//` | `/mimex/fusion/fuse//arbiter/...//flowerpot/...` | Fine for `fetch`, curl, server-side clients |
| `/--/` | `/mimex/fusion/fuse/--/arbiter/.../--/flowerpot/...` | Prefer in browser `href` / navigation |

`/--/` is optional. Browsers (and some intermediaries) collapse or mishandle `//` inside a path before the request reaches foobarch/mimex; `/--/` survives href parsing. Mimex accepts either. It fits the existing delimiter pattern: path `/--/` mirrors command `--`.

### Nest: `/++/`

Mimex accepts `/++/` as a **nest** delimiter (not a stage break). Left of `/++/` is the outer chain; right is a nested sub-hyperuri. Mimex runs the nest first and treats its return body as a **synthetic GET** (req1) for the outer gather — for when the outer hyperuri needs a GET at its trailing gather slot and that value should be another pipeline's result rather than a flowerpot blob.

```
outer/fuse/--/arbiter/…/--/module/++/inner/fuse/--/arbiter/…/--/data
```

### Detach: `/__/`

Mimex accepts `/__/` as a **detach** delimiter (not a stage break). Left is the outer chain whose response is returned; right is a **prerequisite** sub-hyperuri. Mimex runs the prereq first, **discards** its body, then runs the left chain as a fully independent hyperuri (no synthetic GET, no pass-through from the prereq).

```
outer/fuse/--/arbiter/…/--/module/__/prereq/fuse/--/arbiter/…/--/warmup
```

When both `/++/` and `/__/` appear in one path, the **leftmost** delimiter wins at that level; the other side may nest further.

Stage cap is **9** stages per level. Composite nesting (`/++/` and `/__/`) is capped at **6 levels** from the root. See [mimex/README.md](../mimex/README.md).

Foobarch does **not** parse `//`, `/--/`, `/++/`, or `/__/` in paths unless they arrive under `/mimex/`. This allows hyperuri-shaped strings (e.g. flowerpot filenames describing provenance) to exist without triggering pipeline execution.
