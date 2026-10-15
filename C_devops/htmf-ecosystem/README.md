# Docs HTMFs

Canonical surf docs for cross-cutting foobarch/navi references. Flow-model is related, not part of this set.

**Hostpark:** `torus/docs/*`  
**Sources:** `C_devops/htmf-ecosystem/*.html` (hand-maintained; not synced from repo MD)

## Pages

| Slug | Park |
|------|------|
| `readme` | `/torus/docs/readme` (index) |
| `hostparking` | `/torus/docs/hostparking` |
| `navi-style` | `/torus/docs/navi-style` |
| `style-refinement` | `/torus/docs/style-refinement` |
| `navi-shell` | `/torus/docs/navi-shell` |
| `navi-modules-guide` | `/torus/docs/navi-modules-guide` |
| `navi-units` | `/torus/docs/navi-units` |
| `manifest` | `/torus/docs/manifest` |
| `navi-park-addressing` | `/torus/docs/navi-park-addressing` |

## Publish

```bash
# all flow-model + docs
node C_devops/flow-model-docs/_hostpark.mjs --yes

# docs only
node C_devops/flow-model-docs/_hostpark.mjs --yes docs/hostparking docs/navi-style
```

Catalog: `_catalog.mjs`. One-time seed from repo MD/HTML: `_bootstrap.mjs`.
