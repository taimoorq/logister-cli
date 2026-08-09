# Versioning Strategy

`package.json` is the source of truth for the CLI version. Every published
artifact must use the same version:

- npm package `logister-cli`
- GitHub Release tag `vX.Y.Z`
- GitHub Release tarball and checksum
- Homebrew formula version
- Scoop manifest version
- future winget manifest version

## SemVer Policy

The CLI follows SemVer.

- Patch: bug fixes, documentation updates, internal refactors, output fixes that
  preserve fields and command behavior, compatible redaction improvements.
- Minor: new commands, new options, additional output fields, support for new
  backend capabilities, backward-compatible auth or config improvements.
- Major: removed or renamed commands, changed defaults that affect security or
  scripts, incompatible output field changes, dropped Node support, dropped
  server compatibility, or changed token/auth semantics.

Prereleases use `X.Y.Z-alpha.N`, `X.Y.Z-beta.N`, or `X.Y.Z-rc.N`. Publish
prereleases under an npm dist-tag such as `next`, not `latest`.

## Release Invariants

Before a stable release:

1. Update `package.json` and `package-lock.json` to the target version.
2. Run `npm run check`.
3. Create a signed or owner-created tag named exactly `vX.Y.Z`.
4. Confirm the tag points to the intended reviewed commit on protected `main`,
   then push it.
5. Let the release workflow create the GitHub Release and npm package.
6. Update package-manager manifests to the exact same version and checksum.

The release workflow runs:

```bash
npm run check:version -- --tag-required
```

That check fails if the package version, lockfile version, or release tag do not
match.

The release workflow also fetches the protected default branch and fails unless
the tag commit is reachable from it. This prevents publishing an unmerged
pull-request or side-branch commit without spuriously rejecting a valid tag when
`main` advances before the release workflow starts.

## Package-Manager Integration

`logister update --check` reports the detected install source and prints the
right update command:

```text
npm install -g logister-cli@latest
yarn global upgrade logister-cli
pnpm add -g logister-cli@latest
brew upgrade logister
scoop update logister
winget upgrade Logister.CLI
```

`logister update --apply` can run npm, yarn, or pnpm updates directly. Homebrew,
Scoop, winget, and source checkout installs should print the command and let the
package manager own mutation of its files.

Package-manager wrappers may set `LOGISTER_INSTALL_SOURCE` to one of:

```text
npm
yarn
pnpm
homebrew
scoop
winget
source
```

That override makes update instructions deterministic even when the executable
path is ambiguous.

## Backend Compatibility

The Logister backend capability response should include:

- `minimum_cli_version`
- `recommended_cli_version`
- `features`
- `api_contract_version`
- `server_version`

The server can recommend a newer CLI, but it should not require a newer CLI
unless the documented API contract and CLI release are ready together. Breaking
server-side CLI API changes require a major CLI version unless the old behavior
remains available behind capability flags.

## npm Dist-Tags

- Stable releases publish to `latest`.
- Prereleases publish to `next`.
- A stable release older than the current npm `latest` is rejected so the
  GitHub, Homebrew, and Scoop stable channels cannot be moved backward.
- Prereleases are marked as GitHub prereleases and do not update the stable
  Homebrew formula or Scoop manifest.
- Emergency rollback should move the npm dist-tag instead of republishing an
  existing version.

Never reuse a published version number. If a release is bad, publish the next
patch version.
