# Logister CLI

`logister` is the command-line companion for Logister. It helps developers and
AI coding tools inspect project telemetry, logs, grouped issues, and
investigation context from a Logister server without exposing project ingest
keys.

This repository is public. Do not open issues or pull requests that include
tokens, private telemetry, customer data, local credentials, private endpoints,
or exploit details.

## Table Of Contents

1. [What is this CLI for?](#what-is-this-cli-for)
2. [How do I install it?](#how-do-i-install-it)
3. [How do I use it?](#how-do-i-use-it)
4. [How do I report issues and problems?](#how-do-i-report-issues-and-problems)
5. [Security model](#security-model)
6. [Development](#development)
7. [Release and distribution](#release-and-distribution)
8. [Versioning strategy](#versioning-strategy)

## What is this CLI for?

Use the Logister CLI when you want quick, scriptable access to the operational
data Logister stores for your projects:

- list projects available to your account
- summarize recent project telemetry
- inspect redacted logs and events
- list grouped issues
- export issue details for debugging
- generate minimized AI context bundles for a grouped issue
- check which CLI features a hosted or self-hosted Logister server supports

The CLI reads through user-scoped CLI access tokens. Project ingest API keys are
write-only credentials for SDKs and direct HTTP clients; they are intentionally
not accepted for CLI reads.

Some command groups are scaffolded for the broader Logister ecosystem. The first
backend read slice supports `projects`, `overview`, `events`, `logs`, `issues`,
`issues export`, `issues context`, and transaction listing through the event API.
Commands for traces, monitors, deployments, insights, and metrics remain
feature-gated until the server exposes those endpoints.

## How do I install it?

### npm

Use npm when Node is already part of your toolchain:

```bash
npm install -g logister-cli
logister version
```

You can also run it without a global install:

```bash
npx logister-cli doctor --host https://logister.example.com
```

### yarn and pnpm

```bash
yarn global add logister-cli
pnpm add -g logister-cli
```

### Homebrew

Use Homebrew on macOS or Linuxbrew:

```bash
brew tap taimoorq/logister
brew install logister
logister version
```

### Scoop

Use Scoop on Windows:

```powershell
scoop bucket add logister https://github.com/taimoorq/scoop-logister
scoop install logister
logister version
```

The full release distribution plan is documented in
[docs/release-distribution.md](docs/release-distribution.md). winget remains a
later option after there is a stable portable Windows artifact.

### Local development install

```bash
npm install
npm link
logister version
```

## How do I use it?

### 1. Connect to Logister

Browser-approved login is the default:

```bash
logister auth login --host https://logister.example.com
```

If the CLI cannot open a browser, copy the displayed URL manually:

```bash
logister auth login --host https://logister.example.com --no-browser
```

Saved tokens use macOS Keychain when available and fall back to the local
`0600` config file on other platforms.

For automation, avoid putting tokens in shell history:

```bash
printf '%s' "$LOGISTER_TOKEN" | logister auth login \
  --host https://logister.example.com \
  --token-stdin
```

Environment overrides are available for CI and one-off commands:

```bash
LOGISTER_HOST=https://logister.example.com \
LOGISTER_TOKEN=<cli-access-token> \
LOGISTER_PROJECT=<project-uuid-or-slug> \
logister doctor
```

### 2. Check your setup

```bash
logister doctor
logister auth status
logister version --check
logister update --check
```

`doctor` reports the local CLI version, active profile, configured host, token
presence, and the server feature map. It does not print the token value.

### 3. Inspect projects and telemetry

```bash
logister projects list
logister projects show <project>
logister overview --project <project> --since 24h
logister events list --project <project> --type error --since 1h
logister events show <event-id> --project <project>
logister logs list --project <project> --level warn,error
logister logs tail --project <project> --follow
```

### 4. Investigate grouped issues

```bash
logister issues list --project <project> --status unresolved
logister issues show <group-id> --project <project> --related-logs
logister issues export <group-id> --project <project> --format json
logister issues context <group-id> --project <project> --for-ai --format json
```

`issues context` returns a minimized, server-redacted bundle designed for use
with AI coding tools.

### 5. Inspect transactions

```bash
logister transactions list --project <project> --status errored --min-duration-ms 500
```

Transactions currently use the event read capability and require server support
for event reads.

### 6. Choose an output format

```bash
--format table
--format json
--format ndjson
--format markdown
```

Output is redacted by default for sensitive-looking keys. Use `--no-redact` only
when you intentionally need raw payloads and have permission to view them.

## How do I report issues and problems?

Use GitHub Issues for bugs, confusing behavior, documentation gaps, and feature
requests:

<https://github.com/taimoorq/logister-cli/issues>

When reporting a problem, include:

- CLI version from `logister version`
- install method, such as npm, Homebrew, Scoop, or source checkout
- operating system and shell
- Logister server version from `logister doctor`, if available
- the command you ran
- the error message or unexpected output

Do not include tokens, authorization headers, cookies, private telemetry,
customer payloads, local config files, or exploit details. For security issues,
follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

Pull requests may be opened by contributors, but only the repository owner can
approve, merge, tag releases, or publish packages.

## Security model

- CLI read access uses user-scoped CLI access tokens.
- CLI tokens should be scoped, project-limited, expiring, revocable, and audited
  by the Logister server.
- Project ingest API keys are never accepted for read access.
- Browser-approved login issues CLI tokens through the signed-in Logister web
  session.
- The CLI redacts sensitive-looking output by default.
- Server responses for AI/debug commands should already be minimized and
  redacted before they reach the CLI.

## Development

```bash
npm install
npm test
npm run check
```

The CLI has no runtime npm dependencies in the first version. Keep it that way
unless a dependency removes more risk than it adds.

## Release and distribution

The npm package is the canonical release artifact. The release workflow packages
the npm tarball, writes checksums, creates a GitHub Release, and can publish to
npm when the protected publishing environment is enabled.

Distribution planning for npm, Homebrew, Scoop, and future winget support lives
in [docs/release-distribution.md](docs/release-distribution.md).

Public repository controls for branch protection, CODEOWNERS, release tags, npm
publishing, and issue/PR hygiene live in
[docs/repository-settings.md](docs/repository-settings.md).

## Versioning strategy

`package.json` is the CLI version source of truth. Stable releases use matching
`vX.Y.Z` GitHub tags, npm package versions, GitHub Release artifacts, and
package-manager manifest versions.

The full versioning and package-manager integration policy lives in
[docs/versioning.md](docs/versioning.md).
