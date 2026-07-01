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
- Package name: `@logister/cli`.
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
