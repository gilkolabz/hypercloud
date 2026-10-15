# Ethos and anti-patterns

## Ethos

1. Modules do not orchestrate UX. Resting modules provide capability. The Manager, driven by the active flow, decides what happens next.
2. Lower layers keep a voice. Registries speak facts; pages render; neither auto-opens the world because an event fired.
3. No presumptive auto-reaction. Offer choices; navigate on user (or explicit) action.
4. Tools rest. Manager moves. Logic stays dumb about the journey.
5. Variance is data. Alternative journeys and screens are published artifacts, not commented-out branches in one file.
6. Composition over silent forks. Declare why a variant exists; pin revisions; do not hand-drift generated outputs.
7. Mainline is a role. Whatever people bookmark is mainline; no filename is sacred by assistant habit.
8. DRY against the platform. Prefer flowerpot + navi tips/parks + existing proposals over new servers and parallel frameworks. (Hostpark is optional when an origin route is cleaner than a flowerpot path.)
9. Unix spirit in navi. Modules do one job; they compose; park callin + tips are the universal interface.
10. Defer the generic engine. Concrete JSON flows first. Abstract interpreters only when pain is real.
11. Local-first is the dominant pattern; UX guides how. Tips are one layer (session, config, artifacts, modules). Plant/cache host bodies under the ib park will use (`flowerpot/…` for those URLs). Prefer warm tips; Manager owns fetch/plant/refresh so the journey feels right. Remount via `navi:mod`.

## Anti-patterns

Prefer the right-hand habit over the left-hand failure:

- Fat `*_flow.js` owning all DOM → Flow JSON + HTML fragments + thin Manager
- Registry/page auto-surf on emit → Facts up; Manager navigates
- Query params on flowerpot for variants → Launch sets session tip
- Overwriting the only HTML to “try an idea” → New path + flow route + launch
- Editing all N flow files for one shared route → Flow base + patch, or shared keys with builder
- Hand-editing generated UI without registry update → Promote to declared instance or edit sources
- Silent slot collisions in a builder → Loud error
- Project-specific process docs as if they are the paradigm → Keep those in the project; paradigm docs here
- New Go service for static modules/HTML → flowerpot (or hostpark if that is the chosen publish)
- Closed enum of all products inside Manager → Resolve from published config/flow/program data + tips
- Calling flowerpot history a “frame” → Say **pot addr**; reserve **tip frame** for navi
- Soft global callin verbs → Park tips + `commands` on `navi:<name>`
- Always network, never plant → Local-first: warm tips at path ib; UX only decides refresh
- Split “session bag” from tip/park space → One tip layer

## Citations

- [A_document/_navi_style.md](../../A_document/_navi_style.md)
- [A_document/_style_refinement.md](../../A_document/_style_refinement.md)
- [overview.md](overview.md)
- [glossary.md](glossary.md)
