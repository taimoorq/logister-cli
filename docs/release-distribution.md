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
   - Planned tap: `logister/homebrew-tap`
   - Install shape: `brew tap logister/tap && brew install logister`
   - Formula should depend on Node LTS and install the versioned npm tarball or
     GitHub Release tarball for the same CLI version.

3. Scoop for Windows
   - Planned bucket: `logister/scoop-bucket`
   - Install shape: `scoop bucket add logister https://github.com/logister/scoop-bucket && scoop install logister`
   - Start here before winget because it is simpler for script-based CLIs.

4. winget later
   - Add after there is a stable standalone zip/exe/MSI-style artifact or a
     predictable portable package.

## Release Order

On every `vX.Y.Z` tag:

1. Confirm `package.json`, `package-lock.json`, and the `vX.Y.Z` tag match.
2. Run CI checks.
3. Create a GitHub Release with the packed tarball, checksums, and contract SHA.
4. Publish the npm package with provenance when the protected publishing
   environment is enabled.
5. Keep npm as the `latest` dist-tag for stable releases.
6. Use `next` for prerelease npm dist-tags.
7. Open automated update PRs for package-manager metadata:
   - `logister/homebrew-tap`
   - `logister/scoop-bucket`
   - winget package metadata later

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
- Create the Homebrew tap repository and formula.
- Create the Scoop bucket repository and manifest.
- Teach `logister update` to detect npm, yarn, pnpm, Homebrew, Scoop, and winget.
- Set `LOGISTER_INSTALL_SOURCE` in package-manager wrappers when practical.
- Add release workflow jobs that open tap/bucket PRs after npm publish and
  GitHub Release creation.
- Add winget only after a stable Windows portable artifact exists.
