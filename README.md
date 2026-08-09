# Logister CLI

`logister` lets developers, operators, scripts, and coding agents inspect a
Logister project from the terminal. It reads projects, recent telemetry,
grouped issues, and redacted investigation context without reusing the
write-only API keys embedded in monitored applications.

This repository is public. Do not open issues or pull requests that include
tokens, private telemetry, customer data, local credentials, private endpoints,
or exploit details.

## Table Of Contents

1. [Quick start](#quick-start)
2. [What is this CLI for?](#what-is-this-cli-for)
3. [How do I install it?](#how-do-i-install-it)
4. [How do I use it?](#how-do-i-use-it)
5. [How do I report issues and problems?](#how-do-i-report-issues-and-problems)
6. [Security model](#security-model)
7. [Development](#development)
8. [Release and distribution](#release-and-distribution)
9. [Versioning strategy](#versioning-strategy)

## Quick start

You need Node.js 22 or newer and access to a Logister server that exposes the CLI API.

```bash
npm install -g logister-cli
logister auth login --host https://logister.example.com
logister doctor
logister projects list
```

The login command opens a browser so you can approve a scoped CLI token. A successful `doctor` response shows the server version and feature map without printing the token. Choose a project from `projects list`, then try:

```bash
logister overview --project <project-slug> --since 24h
logister issues list --project <project-slug> --status unresolved
logister traces list --project <project-slug> --status error --since 1h
```

If `doctor` reports that a feature is unavailable, the server does not expose that read endpoint yet; upgrading only the CLI will not add it.

## What is this CLI for?

Use the Logister CLI when you want quick, scriptable access to the operational
data Logister stores for your projects:

- list projects available to your account
- summarize recent project telemetry
- inspect redacted logs and events
- list grouped issues
- export issue details for debugging
- generate minimized AI context bundles for a grouped issue
- inspect traces, monitor health, and deployment history
- query shared Insights summaries and metric series
- check which CLI features a hosted or self-hosted Logister server supports

The CLI reads through user-scoped CLI access tokens. Project ingest API keys are
write-only credentials for SDKs and direct HTTP clients; they are intentionally
not accepted for CLI reads.

Logister API contract 3.5 adds read-only traces, monitors, deployments,
Insights, metrics, and token-session diagnostics. Every command remains
capability-gated: an older self-hosted server continues to support its existing
commands and returns upgrade guidance before the CLI attempts a newer route.

## How do I install it?

### npm

Use npm when Node.js 22 or newer is already part of your toolchain:

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

Saved macOS Keychain tokens are bound to both the profile and normalized server
origin. When Keychain is unavailable, the profile stores a host-bound fallback
token in `~/.config/logister/config.json`. Unix-like systems enforce mode
`0600`; Windows relies on the current user's profile-directory ACLs, so keep a
custom `LOGISTER_CONFIG` in a restrictive per-user location. Set
`XDG_CONFIG_HOME` or `LOGISTER_CONFIG` to choose a different path.

Legacy profile-only Keychain entries do not record their server origin and are
never activated automatically. `auth status` reports one as unbound; log in
again to replace it safely. Switching `--host` also suppresses saved profile
credentials unless the new origin matches, or an explicit `--token` or
`LOGISTER_TOKEN` accompanies the override.

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

Device login requests the complete supported read-scope set. Tokens created
before a server enables traces, monitors, deployments, Insights, or metrics do
not gain those scopes automatically. If a command reports `required_scopes`,
run `logister auth login` again and approve the displayed scopes.

Configure `--host` as an HTTPS server origin such as
`https://logister.example.com`. Plain HTTP is accepted automatically only for
`localhost`, `127.0.0.0/8`, and `::1`. A trusted non-loopback development
server requires `--allow-insecure-http` or
`LOGISTER_ALLOW_INSECURE_HTTP=1`; bearer tokens are otherwise never sent over
cleartext HTTP. Embedded credentials, query strings, fragments, and path
prefixes are rejected.

### 2. Check your setup

```bash
logister doctor
logister auth status
logister version --check
logister update --check
```

`doctor` reports the local CLI version, active profile, configured host, token
presence, server feature map, and safe session/scope metadata. It never prints
the token value. The CLI stops when it is below the server's minimum supported
version and warns on stderr when the server recommends a newer version.

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

`events tail --follow` and `logs tail --follow` make a normal newest-first
request, seed a server-issued high-water cursor, and then poll newer records in
stable order. UUID deduplication protects against at-least-once page overlap.
Follow uses NDJSON exclusively and stops cleanly on Ctrl-C; explicit table,
Markdown, or JSON formats are rejected because repeated JSON documents would
not form one valid stream. It requires a contract
3.5 server that returns `poll_cursor`; older servers can still run tail without
`--follow`.

### 4. Investigate grouped issues

```bash
logister issues list --project <project> --status unresolved
logister issues show <group-id> --project <project> --related-logs
logister issues export <group-id> --project <project> --format json
logister issues context <group-id> --project <project> --format json
```

`issues context` returns a minimized, server-redacted bundle designed for use
with AI coding tools.

For example, save a redacted Markdown bundle alongside a bug report:

```bash
logister issues context <group-id> \
  --project <project> \
  --format markdown > logister-context.md
```

### 5. Inspect transactions

```bash
logister transactions list --project <project> --status errored --min-duration-ms 500
```

Transactions currently use the event read capability and require server support
for event reads.

### 6. Inspect performance, monitors, and releases

```bash
logister traces list --project <project> --service checkout --status error --since 1h
logister traces show <trace-id> --project <project>
logister monitors list --project <project> --status missed
logister monitors show <monitor-uuid> --project <project>
logister deployments list --project <project> --environment production --source api --since 7d
logister deployments show <deployment-uuid> --project <project>
```

These commands are read-only. The CLI intentionally does not ingest spans,
pause monitors, create deployments, or expose project administration.

### 7. Query Insights and metrics

```bash
logister insights summary --project <project> --window 24h \
  --metric errors.count --metric transactions.p95 \
  --attribute region=us-east
logister metrics catalog --project <project> --window 24h
logister metrics query transactions.p95 --project <project> --window 24h \
  --environment production --attribute region=us-east
```

`--metric` and `--attribute key=value` are repeatable where documented. The
server applies range limits, semantic redaction, and its coverage-aware
ClickHouse/PostgreSQL fallback before returning analytics.

### 8. Paginate and choose an output format

```bash
--format table
--format json
--format ndjson
--format markdown
```

List commands accept `--limit 1..100`, an opaque `--cursor`, and `--all`.
For large exports, use `--format ndjson --all`: each item is written as one
JSON line while pages are fetched, rather than collecting the full result in
memory. The writer waits for downstream pipe backpressure between records.
JSON output preserves the API envelope; NDJSON emits item records only.
Non-NDJSON `--all` collection is capped at 100,000 records and 32 MiB of
serialized rows.

Output is additionally redacted by the CLI for sensitive-looking keys. Use
`--no-redact` only when you intentionally need locally unredacted fields and
have permission to view them. It never disables mandatory server-side
redaction.

For scripts, prefer JSON and let the command fail on authentication or capability errors:

```bash
logister events list \
  --project <project> \
  --type error \
  --since 1h \
  --format json > recent-errors.json
```

GET requests time out after 15 seconds and retry transient `429`, `500`,
`502`, `503`, and `504` responses twice by default. Override those bounds with
`--timeout-ms 100..120000`, `--retries 0..5`, `LOGISTER_TIMEOUT_MS`, or
`LOGISTER_RETRIES`. Response headers and bodies share the same timeout; JSON
responses are capped at 16 MiB. Authentication and invalid requests are never
retried.

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
npm ci
npm test
npm run check
```

The CLI currently has no runtime npm dependencies.

## Release and distribution
The npm package is the canonical release artifact. A `vX.Y.Z` tag makes the
release workflow test and pack one tarball, publish that artifact to npm, create
the matching GitHub Release, wait for npm propagation, and then open update PRs
for the Homebrew tap and Scoop bucket when package-manager updates are enabled.

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
