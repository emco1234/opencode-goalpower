# Releasing

This document describes how to cut a new release of Goalpower.

## Prerequisites

- Push access to `emco1234/goalpower`
- A clean `main` branch (CI green)
- `bun` installed locally

## Steps

### 1. Update CHANGELOG.md

Move entries from `[Unreleased]` into a new version section:

```markdown
## [1.2.1] — 2026-07-01

### Fixed

- Anti-ratchet detection now handles cross-round gap dedup correctly (#42)
```

Add the new version to the link references at the bottom:

```markdown
[Unreleased]: https://github.com/emco1234/goalpower/compare/v1.2.1...HEAD
[1.2.1]: https://github.com/emco1234/goalpower/releases/tag/v1.2.1
[1.2.0]: https://github.com/emco1234/goalpower/releases/tag/v1.2.0
```

### 2. Bump package.json

```bash
# For a patch
bun run version:patch   # if a script exists, otherwise edit manually

# Or manually edit package.json:
#   "version": "1.2.1"
```

### 3. Commit the version bump

```bash
git add CHANGELOG.md package.json
git commit -m "chore(release): v1.2.1"
```

### 4. Tag the release

```bash
git tag -a v1.2.1 -m "v1.2.1"
git push origin main
git push origin v1.2.1
```

### 5. The GitHub Action handles the rest

Pushing the `v*.*.*` tag triggers `.github/workflows/release.yml` which:

1. Verifies `bun run typecheck` passes
2. Extracts the matching section from CHANGELOG.md
3. Creates a GitHub Release with the changelog as the body

### 6. Verify

- Check the [Releases page](https://github.com/emco1234/goalpower/releases)
- Confirm the release notes match the CHANGELOG section
- Confirm the tag is on the correct commit

## Rollback

If the release is bad:

```bash
git tag -d v1.2.1
git push origin :refs/tags/v1.2.1
```

Then delete the GitHub Release via the UI (or `gh release delete v1.2.1`).

## Major versions

For major version bumps (e.g., 2.0.0):

1. Follow the above steps
2. Additionally: update the README to call out breaking changes prominently
3. Pin the old major version as a separate branch (`1.x`) for backports if needed
