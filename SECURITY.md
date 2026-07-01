# Security Policy

## Supported Versions

Security fixes target the latest released `@logister/cli` version.

## Reporting A Vulnerability

Open a private security advisory on GitHub or contact the maintainer through the
security channel listed on the Logister project page. Do not open public issues
with exploit details, tokens, private telemetry, or customer payloads.

## Credential Rules

- Do not use project ingest API keys for CLI read access.
- Store CLI tokens outside source control.
- Prefer short-lived, scoped, project-limited tokens.
- Use `logister auth logout` to remove a saved token from the local profile.
- Use `LOGISTER_TOKEN` only for short-lived automation environments.

## Output Safety

The CLI redacts sensitive-looking keys by default, including passwords, tokens,
API keys, authorization headers, cookies, raw email fields, SSNs, and card
verification fields. Redaction is a safety net, not a substitute for server-side
minimization.
