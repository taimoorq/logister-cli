# Public Repository Settings

Use this checklist before making `logister-cli` public.

Some controls cannot be enforced by files in this repository. Apply them in
GitHub repository settings, organization settings, npm account settings, and any
package-manager tap or bucket repositories.

## Maintainer Access

- Keep `@taimoorq` as the only account with admin, maintain, or write access.
- Remove unused collaborators, deploy keys with write access, and broad machine
  users.
- Keep outside contributors at read/fork access only.
- If pull requests from the public should not be accepted, disable forking where
  available or close public pull requests and ask users to open issues instead.

Public GitHub repositories commonly allow users to open issues and fork-based
pull requests. The critical control is that only the owner can approve, merge,
push protected branches, create release tags, and publish packages.

## General Repository Settings

- Visibility: public.
- Issues: enabled.
- Discussions: optional.
- Wiki: disabled unless documentation moves there.
- Projects: optional.
- Secret scanning: enabled.
- Push protection: enabled.
- Dependabot alerts: enabled.
- Dependabot security updates: enabled.

## Actions Settings

- Default workflow token permissions: read-only.
- Allow GitHub Actions to create pull requests only if contract sync should keep
  opening PRs automatically.
- Require approval for first-time contributors before fork workflows run.
- Do not expose repository secrets to forked pull requests.

### Contract Sync Credential

Use a dedicated fine-grained bot token for Rails-to-CLI contract updates. Store
it as:

- `LOGISTER_CLI_SYNC_TOKEN` in `taimoorq/logister`, where it is used only to
  dispatch `logister-contract-updated` to this repository.
- `LOGISTER_CLI_SYNC_BOT_TOKEN` in this repository, where it is used for the
  contract-sync checkout, `bot/contract-sync-*` branch push, and pull request.

Grant access only to `taimoorq/logister-cli`, with Contents: write and Pull
requests: write. Do not use a maintainer's broad personal token. The workflows
fail closed when either credential is absent. Because the CLI pull request is
created by this explicit bot credential rather than the default workflow token,
the required Node matrix is expected to run normally.

## Main Branch Ruleset

Protect `main` with a repository ruleset or branch protection rule:

- Require pull request before merge.
- Require at least one approval.
- Require review from Code Owners.
- Dismiss stale approvals when new commits are pushed.
- Require conversation resolution before merge.
- Require status checks to pass:
  - `test` from `.github/workflows/ci.yml`
- Require branches to be up to date before merge if CI queueing becomes noisy.
- Restrict who can push to matching branches:
  - `@taimoorq`
- Block force pushes.
- Block branch deletion.
- Require linear history if merge commits are not desired.

With `.github/CODEOWNERS` set to `@taimoorq`, code-owner review ensures public
pull requests cannot be merged without owner approval.

## Tag And Release Ruleset

Protect release tags with a ruleset matching:

```text
v*
```

Recommended rules:

- Restrict who can create matching tags:
  - `@taimoorq`
- Restrict who can update matching tags:
  - `@taimoorq`
- Restrict who can delete matching tags:
  - `@taimoorq`
- Block force updates.

The release workflow only runs on `v*` tags, so tag protection is part of the
publish boundary. Each release tag must match the version in `package.json` and
`package-lock.json`; CI enforces this with `npm run check:version -- --tag-required`.
It also requires the tag commit to be reachable from protected `main` and
therefore part of its reviewed history. A later `main` merge does not invalidate
an already valid release tag.

## npm Publishing

- Package: `logister-cli`.
- Enable two-factor authentication on the npm account.
- Configure npm Trusted Publishing for the GitHub Actions workflow
  `taimoorq/logister-cli/.github/workflows/release.yml`, environment
  `npm-publish`, and allowed action `npm publish`. Trusted-publisher fields are
  case-sensitive and the workflow filename is only `release.yml`, not its full
  repository path.
- Configure the `npm-publish` environment with `@taimoorq` as the required
  reviewer.
- Set repository variable `PUBLISH_NPM=true` only when npm publishing is ready.

The release workflow publishes the tested tarball to npm before creating its
GitHub Release. Publishing requires a `v*` tag, the `PUBLISH_NPM` variable, and
the protected `npm-publish` environment.

Stable versions publish explicitly to npm `latest`. Strict SemVer prereleases
publish explicitly to `next`, become GitHub prereleases, and cannot open stable
Homebrew or Scoop update pull requests.

The workflow also rejects a stable package version older than npm's current
`latest`; this prevents a maintenance-line tag from downgrading npm `latest`,
GitHub Latest, Homebrew, and Scoop together.

Trusted Publishing is the default path. The release workflow does not export
`NODE_AUTH_TOKEN` unless repository variable `NPM_AUTH_MODE=token` is set. If
token publishing is deliberately needed, store `NPM_TOKEN` only in the protected
`npm-publish` environment and confirm the token can publish `logister-cli`.

## Package Manager Repositories

When Homebrew and Scoop support are added:

- Keep tap and bucket repositories under the same owner.
- Protect their `main` branches with owner-only CODEOWNER review.
- Let automation open update PRs, not push directly to `main`.
- Require checks before formula or manifest updates merge.

For automated release PRs from `logister-cli`, store a narrowly scoped token as
`PACKAGE_MANAGER_REPO_TOKEN` in the CLI repository. The token needs access to
push branches and open pull requests in:

- `taimoorq/homebrew-logister`
- `taimoorq/scoop-logister`

After storing or rotating the token, manually run the `Release Credential
Preflight` workflow. It verifies read-only that the credential has branch-push
access to both repositories; it does not create branches or pull requests.

Keep direct pushes to `main` restricted to `@taimoorq`; automation should only
push `bot/logister-cli-v*` branches.

## Sensitive Data Rules

Do not commit or accept:

- CLI access tokens
- Logister project ingest API keys
- authorization headers
- cookies
- private telemetry or customer payloads
- private endpoint hostnames
- local config files
- exploit details in public issues

Use placeholders such as `<cli-access-token>`, `<project>`, and
`https://logister.example.com` in examples.
