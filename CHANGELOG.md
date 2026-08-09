# Changelog

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
