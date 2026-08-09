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
4. Create a GitHub Release with the packed tarball, checksums, and contract SHA.
5. Keep npm as the `latest` dist-tag for stable releases.
6. Use `next` for prerelease npm dist-tags.
7. For stable releases only, open automated update PRs for package-manager
   metadata:
   - `taimoorq/homebrew-logister`
   - `taimoorq/scoop-logister`
   - winget package metadata later

After the npm package exists, restamp local package-manager repos from the npm
tarball checksum:

```bash
npm run update:package-managers
```

That updates `../homebrew-logister/Formula/logister.rb` and
`../scoop-logister/bucket/logister.json` by downloading the published npm
tarball and computing its SHA256.

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
tarball to become available, computes its SHA256, updates the Homebrew formula
and Scoop manifest, and opens package-manager PRs for owner review.

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
succeeds. If publication fails because of a transient registry or credential
problem and npm has not accepted the version, correct the external condition
and rerun the unchanged tagged workflow. If code must change, use a new reviewed
version and tag; do not move the existing release tag. Never reuse a version
that npm has accepted.

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
