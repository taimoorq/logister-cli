# Release Distribution Plan

This repo treats the npm package as the canonical release artifact. Other
package managers should wrap the same versioned release instead of becoming
separate sources of truth.

## Supported Install Paths

1. npm, yarn, and pnpm
   - Canonical package: `@logister/cli`
   - Primary install: `npm install -g @logister/cli`
   - Compatible installs: `yarn global add @logister/cli`, `pnpm add -g @logister/cli`
   - One-off use: `npx @logister/cli doctor`

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

1. Run CI checks.
2. Publish the npm package with provenance when possible.
3. Create a GitHub Release with the packed tarball, checksums, and contract SHA.
4. Open automated update PRs for package-manager metadata:
   - `logister/homebrew-tap`
   - `logister/scoop-bucket`
   - winget package metadata later

## Update Command Behavior

`logister update --check` should detect the installation source and print the
right package-manager command:

```text
brew upgrade logister
npm update -g @logister/cli
yarn global upgrade @logister/cli
pnpm add -g @logister/cli@latest
scoop update logister
winget upgrade Logister.CLI
```

`logister update --apply` should only self-mutate when the installer source is
safe to control from the CLI. For package-manager installs, prefer printing and
delegating to the package manager. A future standalone binary can support direct
self-update separately.

## Implementation Checklist

- Keep npm as the canonical artifact.
- Add release provenance once npm publishing is enabled.
- Create the Homebrew tap repository and formula.
- Create the Scoop bucket repository and manifest.
- Teach `logister update` to detect npm, yarn, pnpm, Homebrew, Scoop, and winget.
- Add release workflow jobs that open tap/bucket PRs after npm publish and
  GitHub Release creation.
- Add winget only after a stable Windows portable artifact exists.
