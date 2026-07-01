# Logister CLI

`logister` is the command-line companion for Logister. It gives humans and AI
tools a safe way to inspect project telemetry, issue context, traces, monitors,
deployments, and server capabilities from self-hosted or hosted Logister
instances.

This repository is designed to be public. Do not commit private endpoints,
tokens, customer data, or unreleased private implementation notes.

## Install

During local development:

```bash
npm install
npm link
logister version
```

After the package is published:

```bash
npm install -g @logister/cli
logister version
```

## Configure

The CLI uses browser-approved device login by default. CLI access tokens are
separate from project ingest API keys; ingest keys are for writing telemetry
only and are not accepted for reading stored project data.

```bash
logister auth login --host https://logister.example.com
logister auth status
```

Use `--no-browser` when the CLI cannot launch a browser and open the displayed
URL manually.

Saved tokens use macOS Keychain when available and fall back to the local
`0600` config file on other platforms. To avoid putting a token in shell
history in automation:

```bash
logister auth login --host https://logister.example.com --token <cli-access-token>
printf '%s' "$LOGISTER_TOKEN" | logister auth login --host https://logister.example.com --token-stdin
```

Environment overrides are available for scripts:

```bash
LOGISTER_HOST=https://logister.example.com \
LOGISTER_TOKEN=<cli-access-token> \
LOGISTER_PROJECT=<project-uuid-or-slug> \
logister doctor
```

## Common Commands

```bash
logister doctor
logister version --check
logister update --check

logister projects list
logister overview --project api --since 24h
logister events list --project api --type error --since 1h
logister logs tail --project api --follow
logister issues list --project api --status unresolved
logister issues show <group-id> --project api --related-logs
logister issues context <group-id> --project api --for-ai --format json
logister traces show <trace-id> --project api
logister deployments list --project api --env production
```

Output formats:

```bash
--format table
--format json
--format ndjson
--format markdown
```

Output is redacted by default for sensitive-looking keys. Use `--no-redact` only
when you intentionally need raw payloads and have permission to view them.

The first backend read slice supports `projects`, `overview`, `events`, `logs`,
`issues`, `issues export`, and `issues context`. Commands for traces, monitors,
deployments, insights, and metrics remain scaffolded but depend on future server
capabilities.

## Ecosystem Sync

The Logister Rails app owns the public API contract. This CLI stores a snapshot
under `contracts/` so changes are reviewable in this repository.

```bash
npm run sync:contract
```

CI can also receive a `repository_dispatch` event from the main `logister` repo
and open a contract-sync PR.

## Development

```bash
npm test
npm run check
```

The CLI has no runtime npm dependencies in the first version. Keep it that way
unless a dependency removes more risk than it adds.

## Release

Create a semver tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The release workflow packages the npm tarball, writes checksums, and creates a
GitHub Release. Publishing to npm requires `NPM_TOKEN`.

See `docs/release-distribution.md` for the npm, Homebrew, Scoop, and future
winget distribution plan.
