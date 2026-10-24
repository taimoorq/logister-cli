# Security Policy

## Supported Versions

Security fixes target the latest released `logister-cli` version.

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
- Pass tokens to `auth login` with `--token-stdin`. `--token` puts the value in
  process listings and shell history. Other commands warn when they receive it.

## Local Credential Storage

- macOS: the CLI stores tokens in the login Keychain through `/usr/bin/security`.
  That tool creates the item, so the Keychain ACL trusts `/usr/bin/security`.
  Any process running as your user can read the token with that tool without a
  Keychain prompt while the Keychain is unlocked. The Keychain keeps the token
  off disk in plaintext. It does not isolate the token from other software you
  run.
- Linux, Windows, and macOS with Keychain unavailable or disabled
  (`LOGISTER_DISABLE_KEYCHAIN=1`): the token is stored in plaintext in the CLI
  config file (`~/.config/logister/config.json`, `XDG_CONFIG_HOME`, or
  `LOGISTER_CONFIG`). Unix-like systems enforce mode `0600`. Windows relies on
  the profile directory's ACLs. Anyone who can read that file as you, or who has
  your backups, can use the token.
- On shared machines, prefer short-lived tokens and run `logister auth logout`
  when you are done.

## Output Safety

The CLI redacts sensitive-looking keys by default, including passwords, tokens,
API keys, authorization headers, cookies, raw email fields, SSNs, and card
verification fields. It also masks `[name, value]` header pairs with a
sensitive name, and these patterns inside string values: `Bearer`/`Basic`
credentials, JWTs, `lgst_` and default `logister_` keys, AWS access key IDs, and
PEM blocks. Redaction is a safety net, not a substitute for server-side
minimization.

Markdown output starts with a line that marks the content as untrusted
telemetry data. Telemetry can carry attacker-written text aimed at AI tools.
