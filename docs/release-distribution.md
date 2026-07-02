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

1. Confirm `package.json`, `package-lock.json`, and the `vX.Y.Z` tag match.
2. Run CI checks.
3. Publish the npm package with provenance when the protected publishing
   environment is enabled.
4. Create a GitHub Release with the packed tarball, checksums, and contract SHA.
5. Keep npm as the `latest` dist-tag for stable releases.
6. Use `next` for prerelease npm dist-tags.
7. Open automated update PRs for package-manager metadata:
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

Configure npm Trusted Publishing with:

- owner: `taimoorq`
- repository: `logister-cli`
- workflow filename: `release.yml`
- environment: `npm-publish`
- allowed action: `npm publish`

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

The GitHub Release step is idempotent. If a package publish fails after the
release is created, commit the fix, move the same `vX.Y.Z` tag to the fixed
commit if that version is still unpublished on npm, and the workflow will update
the existing release assets instead of failing because the release already
exists.

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
