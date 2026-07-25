# Logister CLI Agent Notes

This repository is intended to become public. Treat every file as publishable.

## Boundaries

- Do not commit tokens, private customer data, local credentials, private keys,
  or generated payloads from real Logister projects.
- Do not add commands that read telemetry through project ingest API keys.
  Ingest keys are write-only credentials for SDKs and direct HTTP clients.
- CLI read access must use user-scoped CLI access tokens with explicit scopes,
  project allowlists, expiry, revocation, and auditability.
- Prefer server-side allowlisted API endpoints over client-side scraping,
  database access, or arbitrary query submission.
- Keep AI context commands minimized and redacted by default.

## Ecosystem Contract

- The main `logister` Rails repo owns `docs/openapi.yaml`.
- This repo stores a reviewed copy in `contracts/logister-openapi.yaml`.
- Run `npm run sync:contract` after backend API changes.
- Contract sync PRs should update generated/contract files first; command UX and
  redaction changes should be explicit code changes in the same PR or a follow-up.

## CLI Design

- Binary name: `logister`.
- Package name: `logister-cli`.
- Default output: table for humans.
- Machine output: `--format json`, `--format ndjson`, and `--format markdown`.
- Redaction is on by default; `--no-redact` should remain explicit.
- Commands should fail with actionable messages when a self-hosted server is
  older than the CLI.

## Verification

Before handing work back:

```bash
npm test
npm run check
```

If Node or network state prevents a release/version check, report that directly.

## Dependency Maintenance

- `package.json` and `package-lock.json` own the CLI version, Node floor, and
  dependency graph. Keep CI aligned with `engines.node`; it currently covers
  Node 22, 24, and 26.
- Run `npm audit --audit-level=low` through `npm run check`. Keep npm and GitHub
  Actions Dependabot updates enabled.
- Pin GitHub Actions to full commit SHAs and retain a readable version comment.
- Treat dropping a supported Node major as a SemVer-major CLI change.

## Release and Distribution Guardrails

- Update `package.json`, `package-lock.json`, and `CHANGELOG.md` together. Run
  `npm ci`, `npm run check`, and `npm pack --dry-run` before tagging.
- The tag is manual and must be `vX.Y.Z` for the checked-in version. Do not tag
  a PR commit; merge the reviewed change and tag the resulting `main` commit.
- `release.yml` builds and tests one tarball, publishes that exact artifact to
  npm, creates the GitHub Release, waits for registry propagation, and then
  opens Homebrew and Scoop PRs. Preserve that order.
- npm trusted publishing is bound to `release.yml` and the `npm-publish`
  environment. Keep `PUBLISH_NPM=true` and `UPDATE_PACKAGE_MANAGERS=true` for
  the complete release chain. Token mode is an explicit fallback only.
- npm versions are immutable. If npm accepted a version, never move the tag or
  reuse the version; prepare a new patch version.
- After package-manager PRs merge, run the main Logister repo's
  `bin/sync-doc-versions --check` and update CLI compatibility metadata/docs.

## Protected Branch Governance

- The PR author cannot approve their own PR, even when they are the repository
  admin and sole `CODEOWNER`.
- Agents must not weaken required reviews, disable admin enforcement, or add a
  bypass to merge their own work. Obtain an independent eligible approval. A
  deliberate branch-policy change, if ever needed, belongs to the repository
  owner outside an automated release task.
- Before release, require green Node 22/24/26 checks and confirm the tag points
  at the reviewed merge commit.
