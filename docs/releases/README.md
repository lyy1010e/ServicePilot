# Release Notes

Create one Markdown file per released version when you want curated notes:

```text
docs/releases/v1.0.8.md
```

The updater manifest and GitHub Release will use the matching file automatically.
If the file is missing, `npm run release -- <version>` generates `v<version>.md`
from Git commit subjects before committing the release.

Recommended shape:

```markdown
# ServicePilot 1.0.8

## New

- List concrete new feature points here.

## Improved

- Refined several page interactions and visual details.

## Fixed

- List user-visible fixes here.
```

Feature points should be specific enough for users to understand what changed.
Page and style polish can stay concise and general.
