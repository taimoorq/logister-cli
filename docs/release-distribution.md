# Release Distribution Plan

This repo treats the npm package as the canonical release artifact. Other
package managers should wrap the same versioned release instead of becoming
separate sources of truth.

Version numbers, release tags, and package-manager manifests must follow
[Versioning Strategy](versioning.md).

## Supported Install Paths

1. npm, yarn, and pnpm
   - Canonical package: `logister-cli`
   - Primary install: `npm install -g logister-cli`
   - Compatible installs: `yarn global add logister-cli`, `pnpm add -g logister-cli`
   - One-off use: `npx logister-cli doctor`

2. Homebrew for macOS and Linuxbrew users
   - Tap repository: `taimoorq/homebrew-logister`
   - Install shape: `brew tap taimoorq/logister && brew install logister`
   - Formula depends on Node and installs the versioned npm registry tarball for
     the same CLI version.

3. Scoop for Windows
   - Bucket repository: `taimoorq/scoop-logister`
   - Install shape: `scoop bucket add logister https://github.com/taimoorq/scoop-logister && scoop install logister`
   - Start here before winget because it is simpler for script-based CLIs.

4. winget later
   - Add after there is a stable standalone zip/exe/MSI-style artifact or a
     predictable portable package.

## Release Order

On every `vX.Y.Z` tag:

1. Confirm `package.json`, `package-lock.json`, and the `vX.Y.Z` tag match, and
   that the tag commit is reachable from protected `main`.
2. Run CI checks.
3. Publish the npm package with provenance when the protected publishing
   environment is enabled.
4. Re-download the registry tarball and verify its SHA256 and selected npm
   dist-tag against the exact tested artifact.
5. Create a GitHub Release with the packed tarball, checksums, and contract SHA.
6. Keep npm as the `latest` dist-tag for stable releases.
7. Use `next` for prerelease npm dist-tags.
8. For stable releases only, open automated update PRs for package-manager
   metadata:
   - `taimoorq/homebrew-logister`
   - `taimoorq/scoop-logister`
   - winget package metadata later

For manual recovery, first download the canonical `logister-cli-release`
artifact from the successful package job into `artifacts/`. Then restamp local
package-manager repos from its reviewed checksum:

```bash
version="$(node -p "require('./package.json').version")"
npm run update:package-managers -- \
  --version "$version" \
  --checksum-file "$PWD/artifacts/checksums.txt"
```

That updates `../homebrew-logister/Formula/logister.rb` and
`../scoop-logister/bucket/logister.json` with the canonical npm tarball URL and
the exact lowercase SHA256 already proven against the registry artifact. The
script deliberately does not obtain a second, untrusted checksum on its own.

For CI-driven updates, set:

- repository variable `PUBLISH_NPM=true`
- repository variable `UPDATE_PACKAGE_MANAGERS=true`
- npm Trusted Publishing for `logister-cli`
- repository secret `PACKAGE_MANAGER_REPO_TOKEN` with permission to push
  branches and open pull requests in `taimoorq/homebrew-logister` and
  `taimoorq/scoop-logister`

Run the manual `Release Credential Preflight` workflow after configuring or
rotating that secret. The check queries effective repository permissions but
does not create a branch or pull request.

Configure npm Trusted Publishing with:

- owner: `taimoorq`
- repository: `logister-cli`
- workflow filename: `release.yml`
- environment: `npm-publish`
- allowed action: `npm publish`

The publish job pins npm `11.19.0` on Node 24. This is above npm's trusted
publishing minimum (`npm` 11.5.1 and Node 22.14.0) and avoids relying on the
npm version that happens to be bundled with a runner image.

The workflow intentionally clears `NODE_AUTH_TOKEN` and removes registry token
configuration in the trusted publishing path. A stale, placeholder, or
under-scoped npm token can make the registry return a misleading
`404 Not Found - PUT https://registry.npmjs.org/logister-cli`.

If trusted publishing is unavailable and token publishing is deliberately
needed, set repository variable `NPM_AUTH_MODE=token` and store `NPM_TOKEN` in
the protected `npm-publish` environment.

On a `vX.Y.Z` tag, the release workflow publishes npm first, waits for the npm
tarball and dist-tag to become available, re-downloads the tarball, and proves
its bytes match the tested SHA256 before creating the GitHub Release. It then
updates the Homebrew formula and Scoop manifest from that same checksum and
opens package-manager PRs for owner review.

Each package-manager PR enables auto-merge when repository rules allow it. The
Homebrew CI job verifies the checksum, installs the formula, runs its formula
test, and checks the installed CLI version. Scoop CI verifies the checksum,
extracts the archive, runs the CLI directly, builds the generated wrapper, and
runs the wrapper's version command. A protected-main CI success in each
repository sends a `distribution-published` callback to this repository.

Configure a `CLI_RELEASE_CALLBACK_TOKEN` secret in both package-manager
repositories with only the access required to dispatch this repository's
reconciliation workflow. Do not place the token value in a manifest, workflow,
release note, test fixture, or planning document.

The `Reconcile release distributions` workflow independently re-reads npm, the
public GitHub Release, the Homebrew formula, and the Scoop manifest. Completion
requires one version and one npm tarball SHA256 across all four channels. It
publishes the result as the `release/distributions` commit status on the
immutable release commit: `pending` while a reviewed package-manager PR is
still waiting, and `success` only after every channel is public and verified.
The workflow also runs daily so missed callbacks cannot hide drift.

The workflow derives the channel from the strict SemVer package version:

- Stable versions publish explicitly to npm `latest` and create a GitHub
  Release eligible to be `Latest`.
- Versions containing a prerelease component publish explicitly to npm `next`,
  create a GitHub prerelease, and skip Homebrew and Scoop updates.

The package-manager update script also rejects prerelease versions, providing a
second guard if it is run outside the release workflow.

Before publishing a stable version, the workflow compares it with the current
npm `latest` version and refuses to move the stable npm, GitHub, Homebrew, or
Scoop channels backward. A lower maintenance-line release requires a separately
reviewed channel policy and must not use this stable release workflow unchanged.
Tag-triggered releases are serialized so two otherwise valid versions cannot
race between that comparison and publication.

The GitHub Release step is idempotent and does not run until npm publication
and exact registry-byte/dist-tag verification succeed. A draft receives and
verifies all release assets before it becomes public. A compatible public
release is verified without mutation; incompatible public metadata or assets
fail closed. If publication fails because of a transient registry or credential
problem and npm has not accepted the version, correct the external condition
and rerun the unchanged tagged workflow. If code must change, use a new reviewed
version and tag; do not move the existing release tag. Never reuse a version
that npm has accepted.

If release-workflow code must be corrected before npm accepts the version, fix
the workflow on protected `main` without moving the tag. Then manually dispatch
the workflow with that existing `vX.Y.Z` tag. Recovery checks out the tagged
commit, repeats the tag/version/main-ancestry and package checks, and publishes
the same immutable source through the protected npm environment.

## Update Command Behavior

`logister update --check` should detect the installation source and print the
right package-manager command:

```text
brew upgrade logister
npm install -g logister-cli@latest
yarn global upgrade logister-cli
pnpm add -g logister-cli@latest
scoop update logister
winget upgrade Logister.CLI
```

`logister update --apply` may run npm, yarn, or pnpm updates directly. For
Homebrew, Scoop, winget, and source checkout installs, print the command and let
the package manager own file mutation. A future standalone binary can support
direct self-update separately.

## Implementation Checklist

- Keep npm as the canonical artifact.
- Add release provenance once npm publishing is enabled.
- Keep the Homebrew tap repository and formula aligned with the npm tarball.
- Keep the Scoop bucket repository and manifest aligned with the npm tarball.
- Teach `logister update` to detect npm, yarn, pnpm, Homebrew, Scoop, and winget.
- Set `LOGISTER_INSTALL_SOURCE` in package-manager wrappers when practical.
- Add release workflow jobs that open tap/bucket PRs after npm publish and
  GitHub Release creation.
- Add winget only after a stable Windows portable artifact exists.
