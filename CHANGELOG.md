# Changelog

## v1.3.0 - 2026-10-23

- Stop redacting bare `key` fields, so `metrics catalog`, `metrics query`, and Insights show metric keys under default redaction. A `key` field stays sensitive with a secret-ish qualifier such as `api_key`, `private_key`, `secret_key`, `access_key`, or `x-api-key`.
- Add value-pattern redaction. With redaction on, the CLI masks `Bearer` and `Basic` credentials, JWTs, `lgst_` and default `logister_` keys, AWS access key IDs, and PEM blocks inside strings, and the value of `[name, value]` header pairs with a sensitive name.
- Redact the server session payload in `auth status` and `doctor` by default, keeping the token metadata fields visible. `--no-redact` shows it unmodified.
- Pin device-flow verification URLs to the configured host origin. A URL on another origin is not opened automatically, triggers a stderr warning, and is labelled untrusted.
- Print a one-line stderr deprecation warning when `--token` is used outside `auth login`. It is still accepted. Use `LOGISTER_TOKEN` for automation.
- Reject `.`, `..`, and other values outside `^[A-Za-z0-9][A-Za-z0-9._-]*$` for `--project`, `LOGISTER_PROJECT`, saved profile projects, and `projects show`. Reject `.`/`..` as any positional identifier.
- Start `--format markdown` output with a one-line untrusted telemetry data notice.
- Clamp `LOGISTER_AUTH_POLL_INTERVAL_MS` to at least 250 ms.
- Stop shipping `scripts/` and `docs/` in the npm package and remove the `.npmignore` that `files` overrode.
- Document the macOS Keychain ACL caveat and the plaintext config fallback in SECURITY.md.

## v1.2.1 - 2026-09-28

- Review the additive backend 3.8 correlation contract, including selected occurrence metadata, HTTP outcome, duration scope, app builds and issue ownership.
- Display HTTP status, span status, recorded duration and measurement scope in related-request tables; preserve enriched metadata and coverage in machine output.
- Continue supporting older capability-enabled servers when optional enriched fields are absent.

## v1.2.0 - 2026-09-24

- Add events correlations with related-project evidence, deployment references, coverage, and truncation metadata.
- Review the additive backend 3.7 API contract while retaining capability-based handling for older servers.

## v1.1.0 - 2026-09-11

- Added Android R8/ProGuard mapping and Apple dSYM uploads using explicit user-scoped artifact-write authorization.
- Pinned the reviewed API contract to an immutable Rails commit, accepted compatible 3.6 patch versions, and verified artifact operations, write scopes, and authentication.
- Fixed Scoop distribution reconciliation for raw JSON served as text/plain while preserving exact canonical npm artifact checks.
- Kept tagging manual after reviewed main and coordinated backend readiness; release preflight now reports readiness without creating tags.

## v1.0.0 - 2026-08-09

- Added read-only traces, monitors, deployments, Insights, and metrics commands with capability negotiation for older self-hosted servers.
- Added strict table-driven command parsing and validation for subcommands, arguments, filters, formats, timestamps, limits, statuses, and repeatable metric/attribute filters.
- Added opaque cursor pagination, bounded `--all` collection, streaming NDJSON, and reliable event/log follow using server-issued high-water cursors.
- Added minimum/recommended CLI compatibility checks, structured scope guidance, cached capabilities, configurable timeouts, and bounded idempotent GET retries with `Retry-After` support.
- Expanded device login to request all supported read scopes, validate device-flow responses, retain safe scope/expiry metadata, and report server session diagnostics.
- Added resource-specific human output, terminal-control and Markdown sanitization, semantic local redaction, clean interruption, and broken-pipe handling.
- Added byte-exact API contract verification, a local HTTP integration fixture, and packed-tarball installation smoke support.
- Bound saved credentials to server origins, required HTTPS outside loopback by default, and added fail-safe legacy credential and logout diagnostics.
- Hardened machine/human output against C1, bidi, raw Markdown/HTML, hostile keys, and expanded semantic secret-key spellings.
- Made release reruns immutable: existing npm versions must match the exact tested tarball and dist-tag, while package-manager updates consume its strictly validated checksum.
- Raised the supported runtime floor to Node.js 22 and added Node 22, 24, and 26 CI coverage.
- Added npm vulnerability auditing to the standard verification path.
- Reordered releases so the exact tested tarball is published to npm before the GitHub release is created.
- Pinned GitHub Actions to immutable commits and added automated dependency maintenance.

## v0.1.2 - 2026-06-18

- Added deployment and source context support across the Logister ecosystem.
