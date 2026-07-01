# Command Reference

## Auth

```bash
logister auth login --host <url>
logister auth login --host <url> --no-browser
logister auth login --host <url> --token <cli-access-token>
printf '%s' "$LOGISTER_TOKEN" | logister auth login --host <url> --token-stdin
logister auth status
logister auth logout
```

The default login starts a browser-approved device authorization request and
stores the returned CLI access token locally. Use `--no-browser` to copy the
displayed URL manually. Prefer `--token-stdin` or `LOGISTER_TOKEN` for
automation so secrets do not land in shell history. Saved tokens use macOS
Keychain when available and fall back to the local `0600` config file on other
platforms.

## Health And Updates

```bash
logister doctor
logister version
logister version --check
logister update --check
logister update --apply
```

`doctor` calls `/api/v1/cli/capabilities` and reports the local CLI version,
profile, configured host, and server-supported feature map.

## Projects

```bash
logister projects list
logister projects show <project>
logister overview --project <project> --since 24h
```

## Events And Logs

```bash
logister events list --project <project> --type error --since 1h
logister events show <event-id> --project <project>
logister events tail --project <project> --type error,log --follow
logister logs list --project <project> --level warn,error
logister logs tail --project <project> --trace-id <trace-id>
```

## Issues

```bash
logister issues list --project <project> --status unresolved
logister issues show <group-id> --project <project> --related-logs
logister issues export <group-id> --project <project> --format json
logister issues context <group-id> --project <project> --for-ai --token-budget 12000
```

Mutation commands such as `resolve`, `ignore`, `archive`, `reopen`, and `assign`
should be added only after the backend supports write-scoped CLI tokens.

## Performance

```bash
logister transactions list --project <project> --status errored --min-duration-ms 500
logister traces list --project <project> --since 1h
logister traces show <trace-id> --project <project>
```

`transactions` uses the event read capability. `traces` is scaffolded in the CLI
but remains disabled until the backend exposes `traces:read`.

## Monitors And Deployments

```bash
logister monitors list --project <project> --status missed,error
logister monitors show <slug> --project <project>
logister deployments list --project <project> --env production
logister deployments show <release> --project <project>
```

## Insights And Metrics

```bash
logister insights summary --project <project> --window 24h
logister metrics catalog --project <project>
logister metrics query transactions.p95 --project <project> --window 24h
```
