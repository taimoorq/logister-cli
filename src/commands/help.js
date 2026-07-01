export const HELP_TEXT = `Logister CLI

Usage:
  logister <command> [subcommand] [options]

Auth:
  logister auth login --host <url>
  logister auth login --host <url> --no-browser
  logister auth login --host <url> --token <token>
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
  logister logs tail --project <project> --follow
  logister issues list --project <project> --status unresolved
  logister issues show <group-id> --project <project> --related-logs
  logister issues context <group-id> --project <project> --for-ai
  logister transactions list --project <project>
  logister traces show <trace-id> --project <project>
  logister monitors list --project <project>
  logister deployments list --project <project>
  logister insights summary --project <project>
  logister metrics catalog --project <project>

Global options:
  --host <url>        Logister host. Overrides saved profile.
  --token <token>    CLI access token. Prefer saved auth or LOGISTER_TOKEN.
  --profile <name>   Config profile. Defaults to LOGISTER_PROFILE or default.
  --project <id>     Project UUID or slug.
  --format <type>    table, json, ndjson, or markdown.
  --no-redact        Disable output redaction for sensitive-looking keys.
  --help             Show help.
`;

export async function runHelpCommand(_args, { stdout }) {
  stdout.write(HELP_TEXT);
}
