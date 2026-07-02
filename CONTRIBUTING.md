# Contributing

Thanks for helping improve the Logister CLI.

This repository is public. Treat every issue, pull request, commit, fixture, and
log excerpt as publishable.

## Before You Open An Issue Or Pull Request

- Do not include CLI tokens, project ingest API keys, authorization headers,
  cookies, private telemetry, customer payloads, local config files, private
  endpoints, or exploit details.
- Use placeholders such as `<cli-access-token>`, `<project>`, and
  `https://logister.example.com`.
- Run `npm test` before opening a code pull request when possible.
- For security issues, follow `SECURITY.md` instead of opening a public issue.

## Pull Request Policy

Pull requests are welcome for fixes, documentation, tests, and small CLI
improvements. The repository owner is the only person who can approve, merge,
tag releases, or publish packages.

Automated contract-sync pull requests may update `contracts/` when the main
Logister API contract changes. Those pull requests still require owner review.

## Local Development

```bash
npm install
npm test
npm run check
```

## Public Repo Hygiene

- Keep runtime dependencies minimal.
- Keep `--no-redact` explicit.
- Do not add commands that read project data through ingest API keys.
- Prefer feature-gated server APIs over assumptions about a self-hosted server.
- Keep docs, examples, and tests free of real credentials and customer data.
