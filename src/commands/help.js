export const HELP_TEXT = `Logister CLI

Usage:
  logister <command> [subcommand] [options]

Auth:
  logister auth login --host <url>
  logister auth login --host <url> --no-browser
  logister auth login --host <url> --token <token>
  logister auth login --host <url> --artifact-write
  printf '%s' "$LOGISTER_TOKEN" | logister auth login --host <url> --token-stdin
  logister auth status
  logister auth logout

Core:
  logister doctor
  logister version [--check]
  logister update [--check|--apply]

Project data:
  logister projects list
  logister projects show <project>
  logister overview --project <project>
  logister events list --project <project> --type error --since 24h
  logister events show <event-id> --project <project>
  logister logs tail --project <project> --follow --format ndjson
  logister issues list --project <project> --status unresolved
  logister issues show <group-id> --project <project> --related-logs
  logister issues context <group-id> --project <project>
  logister transactions list --project <project>
  logister traces list --project <project> --service api --status error
  logister traces show <trace-id> --project <project>
  logister monitors list --project <project> --status missed
  logister monitors show <monitor-uuid> --project <project>
  logister deployments list --project <project> --environment production
  logister deployments show <deployment-uuid> --project <project>
  logister insights summary --project <project> --window 24h --metric errors.count
  logister metrics catalog --project <project> --window 24h
  logister metrics query <metric> --project <project> --attribute region=us-east
  logister artifacts upload-android --project <project> --file mapping.txt --package-name com.acme.app --version-code 42
  logister artifacts upload-ios --project <project> --file App.dSYM.zip --app-identifier com.acme.app --version-code 42 --binary-uuid <uuid> --architecture arm64

Global options:
  --host <url>          Logister host. Overrides saved profile.
  --token <token>       CLI access token. Prefer saved auth or LOGISTER_TOKEN.
  --profile <name>      Config profile. Defaults to LOGISTER_PROFILE or default.
  --project <id>        Project UUID or slug.
  --format <type>       table, json, ndjson, or markdown.
  --timeout-ms <n>      Request timeout from 100 to 120000 milliseconds.
  --retries <n>         GET retries from 0 to 5. Defaults to 2.
  --allow-insecure-http Allow credentials over non-loopback HTTP for trusted development only.
  --no-redact           Disable additional local redaction only.
  --help                Show help.

List options:
  --limit <n>           Page size from 1 to 100.
  --cursor <opaque>     Continue from a server-issued cursor.
  --all                 Fetch all pages; NDJSON streams one page at a time.

Run logister doctor to inspect server capabilities and token scopes.
`;

export async function runHelpCommand(_args, { stdout }) {
  stdout.write(HELP_TEXT);
}
