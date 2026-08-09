# Command Reference

Logister CLI `1.0.0` uses user-scoped read tokens and API capability
negotiation. Commands reject unknown or irrelevant options instead of silently
ignoring them. Run `logister doctor` to see the connected server's feature map,
minimum/recommended CLI versions, and safe token-session metadata.

## Auth

```bash
logister auth login --host <url>
logister auth login --host <url> --no-browser
logister auth login --host <url> --token <cli-access-token>
printf '%s' "$LOGISTER_TOKEN" | logister auth login --host <url> --token-stdin
logister auth status
logister auth logout
```

Browser login requests `projects:read`, `project_summary:read`, `events:read`,
`errors:read`, `ai_context:read`, `traces:read`, `monitors:read`,
`deployments:read`, `insights:read`, and `metrics:read`. The approval page shows
the requested scopes. Existing tokens do not gain newly enabled scopes; if a
command reports `required_scopes`, log in again.

Keychain tokens are bound to the profile and normalized server origin. When
Keychain is unavailable, the host and token are changed together in the local
config. Unix-like systems enforce mode `0600`; Windows relies on restrictive
per-user directory ACLs and should not use a shared custom config path. A
successful secure-store migration removes the plaintext fallback.

An old profile-only Keychain entry has no provable server origin, so `1.0.0`
does not activate or migrate its secret. `auth status` reports it as unbound;
run login again to replace it. A different `--host`/`LOGISTER_HOST` suppresses
the saved credential and project unless an explicit token accompanies it.

`--host` must be an HTTPS origin. HTTP is allowed without acknowledgement only
for `localhost`, `127.0.0.0/8`, and `::1`. Use `--allow-insecure-http` or
`LOGISTER_ALLOW_INSECURE_HTTP=1` only for a trusted non-loopback development
server. The CLI rejects embedded URL credentials, query strings, fragments,
and path prefixes.

## Health And Updates

```bash
logister doctor [--format json]
logister version [--check]
logister update [--check]
logister update --apply
```

The CLI fails before a resource request when it is below
`minimum_cli_version`, warns on stderr when below `recommended_cli_version`,
and feature-gates routes absent from older self-hosted servers. A normal
resource `404` remains a resource `404` when the server advertises the feature.

## Projects And Overview

```bash
logister projects list [--include-archived] [--limit 50] [--cursor <opaque>] [--all]
logister projects show <project>
logister overview --project <project> [--since 24h] [--until <iso8601>]
```

Use project UUIDs when an account has ambiguous project slugs.

## Events And Logs

```bash
logister events list --project <project> \
  [--type error,log] [--event-type transaction] [--level warn,error] \
  [--status errored] [--environment production] [--release <release>] \
  [--since 1h] [--until <iso8601>] [--q <text>] \
  [--trace-id <id>] [--request-id <id>] [--min-duration-ms 500] \
  [--limit 50] [--cursor <opaque>] [--all]
logister events show <event-id> --project <project>
logister events tail --project <project> [filters] [--follow] [--poll-interval-ms 2000]

logister logs list --project <project> [event filters] [pagination]
logister logs tail --project <project> [event filters] [--follow]
```

Event types are `error`, `metric`, `transaction`, `log`, `check_in`, or `all`.
Tail without `--follow` returns one newest-first page. Follow requires the
server's `poll_cursor`/`after_cursor` protocol: the CLI emits the initial page,
then polls newer matching events in ascending high-water order and deduplicates
UUIDs. Follow supports NDJSON only and stops on Ctrl-C. It rejects table,
Markdown, and JSON formats and cannot be combined with `--all` or a list
`--cursor`.

## Issues

```bash
logister issues list --project <project> \
  [--status unresolved|resolved|ignored|archived|all] \
  [--introduced-today] [--assigned me] [--assignee all|me|unassigned|any|<uuid>] \
  [--sort <server-sort>] [--q <text>] \
  [--limit 50] [--cursor <opaque>] [--all]
logister issues show <group-id> --project <project> [--related-logs]
logister issues export <group-id> --project <project> [--include-occurrences] --format json
logister issues context <group-id> --project <project> [--token-budget 12000] --format json
```

Issue export and AI context are server-minimized and server-redacted. Mutation
commands such as resolve, ignore, archive, reopen, and assign are intentionally
not part of the read-only `1.0.0` CLI.

## Transactions And Traces

```bash
logister transactions list --project <project> \
  [--status errored] [--min-duration-ms 500] [event filters] [pagination]
logister traces list --project <project> \
  [--service <name>] [--operation <name>] [--status unset|ok|error|all] \
  [--environment <name>] [--release <release>] [--since 1h] [--until <iso8601>] \
  [--q <text>] [--min-duration-ms 500] [pagination]
logister traces show <trace-id> --project <project> [--since 24h] [--until <iso8601>]
```

Trace show returns a bounded, server-redacted span tree and reports when the
server truncated the span count.

## Monitors And Deployments

```bash
logister monitors list --project <project> \
  [--status ok|error|missed|paused|all] [--environment <name>] [--q <text>] [pagination]
logister monitors show <monitor-uuid> --project <project>

logister deployments list --project <project> \
  [--repository org/repo] [--environment production] [--source api|telemetry|manual] \
  [--release <release>] [--q <text>] [--since 7d] [--until <iso8601>] [pagination]
logister deployments show <deployment-uuid> --project <project>
```

These surfaces do not expose monitor mutation or deployment ingestion.

## Insights And Metrics

```bash
logister insights summary --project <project> \
  [--window 1h|6h|24h|7d] [--metric <name> ...] \
  [--environment <name>] [--release <release>] [--attribute key=value ...]
logister metrics catalog --project <project> [--window 1h|6h|24h|7d]
logister metrics query <metric> --project <project> \
  [--window 1h|6h|24h|7d] [--environment <name>] [--release <release>] \
  [--attribute key=value ...]
```

`--metric` and `--attribute` are repeatable. Metrics query requires an exact
catalog metric; the server rejects unknown names rather than substituting a
default. Analytics include minimized source/coverage metadata and exclude raw
recent-event context.

## Pagination And Output

List commands accept:

```text
--limit <1..100>       requested page size
--cursor <opaque>      continue from a server-issued, filter-bound cursor
--all                  continue until next_cursor is empty
```

JSON preserves the API envelope. NDJSON emits one item per line and streams
`--all` page by page while honoring downstream writable backpressure. Table and Markdown use stable resource-specific columns;
full response data remains available through JSON. In-memory `--all` output is
bounded at 100,000 records and 32 MiB of serialized rows, so use NDJSON for
larger exports.

```text
--format table|json|ndjson|markdown
--no-redact
```

Local redaction is enabled by default. `--no-redact` disables only that extra
client-side layer and never disables server-side redaction. Human formats strip
ANSI, C1, bidi, and other terminal controls, collapse multiline cells, and
render Markdown cells/headers as literal text rather than active HTML or links.
Data goes to stdout; warnings and errors go to stderr. Broken pipes such as
`logister events list --format ndjson --all | head` stop cleanly.

## Network Options

```text
--timeout-ms <100..120000>  per-attempt timeout (default 15000)
--retries <0..5>            idempotent GET retries (default 2)
```

`LOGISTER_TIMEOUT_MS` and `LOGISTER_RETRIES` provide environment defaults.
Retries honor `Retry-After` and apply only to network errors, timeouts, `429`,
`500`, `502`, `503`, and `504`. Authentication failures, invalid requests, and
POST requests are never retried.

API responses must use a JSON content type and fit within 16 MiB. The same
per-attempt timeout remains active while response headers and body chunks are
read.
