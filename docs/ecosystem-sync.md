# Ecosystem Sync

The CLI follows backend capabilities instead of guessing what a self-hosted
server supports.

## Source Of Truth

- Main app repository: `taimoorq/logister`
- Contract file in main app: `docs/openapi.yaml`
- Contract snapshot in this repo: `contracts/logister-openapi.yaml`
- Lock file in this repo: `contracts/logister-api.lock`
- Runtime capability endpoint: `GET /api/v1/cli/capabilities`

## Local Sync

From `logister-cli/` in the shared workspace:

```bash
npm run sync:contract
```

That copies `../logister/docs/openapi.yaml` and updates the lock file hash.

## Automated Sync

This repository accepts a `repository_dispatch` event:

```json
{
  "event_type": "logister-contract-updated",
  "client_payload": {
    "openapi_url": "https://raw.githubusercontent.com/taimoorq/logister/main/docs/openapi.yaml"
  }
}
```

The workflow downloads the contract, updates `contracts/`, and opens a PR when
there is a diff.

## Release Compatibility

The backend capability response should include:

```json
{
  "server_version": "2.9.0",
  "api_contract_version": "2.9",
  "minimum_cli_version": "0.1.0",
  "recommended_cli_version": "0.1.0",
  "features": {
    "projects": true,
    "project_summary": true,
    "events": true,
    "logs": true,
    "error_groups": true,
    "ai_context_bundles": true
  }
}
```

The CLI should use this to make older self-hosted servers understandable rather
than mysterious.
