import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyReleaseRef } from "../scripts/check-release-ref.mjs";
import { verifyReleaseChannelOrder, verifyStableReleaseOrder } from "../scripts/check-release-channel.mjs";
import { releaseMetadataForVersion } from "../scripts/release-metadata.mjs";
import { inspectNpmReleaseState, parseExactChecksum } from "../scripts/check-npm-release-state.mjs";
import { checksumFromFile, validateSha256 } from "../scripts/update-package-manager-repos.mjs";
import { reconcileDistributions } from "../scripts/reconcile-distributions.mjs";

test("stable releases publish to npm latest", () => {
  assert.deepEqual(releaseMetadataForVersion("1.2.3"), {
    version: "1.2.3",
    is_prerelease: "false",
    npm_dist_tag: "latest"
  });
});

test("prereleases publish to npm next", () => {
  assert.deepEqual(releaseMetadataForVersion("1.2.3-rc.1"), {
    version: "1.2.3-rc.1",
    is_prerelease: "true",
    npm_dist_tag: "next"
  });
});

test("build metadata does not turn a stable release into a prerelease", () => {
  assert.deepEqual(releaseMetadataForVersion("1.2.3+build.4"), {
    version: "1.2.3+build.4",
    is_prerelease: "false",
    npm_dist_tag: "latest"
  });
});

test("invalid release versions are rejected", () => {
  assert.throws(
    () => releaseMetadataForVersion("v1.2.3"),
    /strict SemVer/
  );
});

test("stable releases cannot move npm latest backward", () => {
  assert.deepEqual(
    verifyStableReleaseOrder({ releaseVersion: "1.0.0", currentLatest: "0.1.2" }),
    { releaseVersion: "1.0.0", currentLatest: "0.1.2" }
  );
  assert.deepEqual(
    verifyStableReleaseOrder({ releaseVersion: "1.0.0", currentLatest: "1.0.0" }),
    { releaseVersion: "1.0.0", currentLatest: "1.0.0" }
  );
  assert.throws(
    () => verifyStableReleaseOrder({ releaseVersion: "1.9.9", currentLatest: "2.0.0" }),
    /Refusing to move npm latest backward/
  );
});

test("prereleases cannot move npm next backward and allow a missing first next tag", () => {
  assert.deepEqual(
    verifyReleaseChannelOrder({ releaseVersion: "1.1.0-rc.2", currentVersion: "1.1.0-rc.1", channel: "next" }),
    { releaseVersion: "1.1.0-rc.2", currentVersion: "1.1.0-rc.1", channel: "next", firstRelease: false }
  );
  assert.throws(
    () => verifyReleaseChannelOrder({ releaseVersion: "1.0.0-rc.9", currentVersion: "1.1.0-rc.1", channel: "next" }),
    /Refusing to move npm next backward/
  );
  assert.deepEqual(
    verifyReleaseChannelOrder({ releaseVersion: "1.0.0-rc.1", currentVersion: "", channel: "next" }),
    { releaseVersion: "1.0.0-rc.1", currentVersion: null, channel: "next", firstRelease: true }
  );
});

test("package-manager updates reject prereleases before downloading artifacts", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/update-package-manager-repos.mjs", "--version", "1.2.3-rc.1"],
    { encoding: "utf8" }
  );

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Refusing to update stable Homebrew or Scoop metadata/);
});

test("immutable npm reruns publish only when absent and verify exact bytes plus dist-tag when present", async () => {
  const directory = mkdtempSync(join(tmpdir(), "logister-cli-npm-state-"));
  const tarball = join(directory, "logister-cli-1.0.0.tgz");
  const checksumFile = join(directory, "checksums.txt");
  const bytes = Buffer.from("canonical tarball bytes");
  const hash = await import("node:crypto").then(({ createHash }) => createHash("sha256").update(bytes).digest("hex"));
  writeFileSync(tarball, bytes);
  writeFileSync(checksumFile, `${hash}  logister-cli-1.0.0.tgz\n`);

  try {
    const absent = await inspectNpmReleaseState({
      version: "1.0.0", tarball, checksumFile, distTag: "latest",
      fetchImpl: async () => new Response("{}", { status: 404, headers: { "content-type": "application/json" } })
    });
    assert.equal(absent.publishRequired, true);
    await assert.rejects(
      () => inspectNpmReleaseState({
        version: "1.0.0", tarball, checksumFile, distTag: "latest", requirePublished: true,
        fetchImpl: async () => new Response("{}", { status: 404, headers: { "content-type": "application/json" } })
      }),
      /is not published yet/
    );

    const fetchImpl = async (url) => {
      if (url.pathname === "/logister-cli/1.0.0") {
        return jsonResponse({ version: "1.0.0", dist: { tarball: "https://registry.npmjs.org/logister-cli/-/logister-cli-1.0.0.tgz" } });
      }
      if (url.pathname.endsWith("logister-cli-1.0.0.tgz")) return new Response(bytes);
      if (url.pathname.endsWith("/dist-tags")) return jsonResponse({ latest: "1.0.0" });
      throw new Error(`unexpected URL ${url}`);
    };
    const existing = await inspectNpmReleaseState({ version: "1.0.0", tarball, checksumFile, distTag: "latest", fetchImpl });
    assert.equal(existing.publishRequired, false);
    assert.equal(existing.sha256, hash);

    await assert.rejects(
      () => inspectNpmReleaseState({
        version: "1.0.0", tarball, checksumFile, distTag: "latest",
        fetchImpl: async (url) => url.pathname === "/logister-cli/1.0.0"
          ? jsonResponse({ version: "1.0.0", dist: { tarball: "https://registry.npmjs.org/logister-cli/-/logister-cli-1.0.0.tgz" } })
          : new Response("different bytes")
      }),
      /Published npm tarball SHA256 mismatch/
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("package-manager checksums are a single exact lowercase canonical-artifact line", () => {
  const directory = mkdtempSync(join(tmpdir(), "logister-cli-pm-checksum-"));
  const checksumFile = join(directory, "checksums.txt");
  const hash = "a".repeat(64);
  try {
    writeFileSync(checksumFile, `${hash}  logister-cli-1.0.0.tgz\n`);
    assert.equal(checksumFromFile(checksumFile, "1.0.0"), hash);
    assert.equal(validateSha256(hash), hash);
    assert.throws(() => validateSha256(hash.toUpperCase()), /64 lowercase/);
    assert.throws(() => parseExactChecksum(`${hash}  logister-cli-1.0.0.tgz\n${hash}  extra.tgz\n`, "logister-cli-1.0.0.tgz"), /exactly one/);
    assert.throws(() => parseExactChecksum(`${hash.toUpperCase()}  logister-cli-1.0.0.tgz\n`, "logister-cli-1.0.0.tgz"), /lowercase SHA256/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("release workflow applies the ref, dist-tag, and package-manager guards", () => {
  const workflow = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
  const finalPublish = workflow.lastIndexOf("npm publish");
  const registryVerification = workflow.indexOf("name: Verify published npm bytes and dist-tag");
  const githubRelease = workflow.indexOf("github-release:");

  assert.match(workflow, /^name: Release \(immutable vX\.Y\.Z tag\)$/m);
  assert.match(workflow, /on:\s+push:\s+tags:\s+- "v\*"/s);
  assert.match(workflow, /workflow_dispatch:\s+inputs:\s+tag:\s+description: Existing immutable vX\.Y\.Z tag to recover\s+required: true/s);
  assert.match(workflow, /ref: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.tag \|\| github\.ref \}\}/);
  assert.match(workflow, /--tag-ref "refs\/tags\/\$\{RELEASE_TAG\}"/);
  assert.equal((workflow.match(/ref: \$\{\{ needs\.package\.outputs\.tag \}\}/g) || []).length, 3);
  assert.doesNotMatch(workflow, /\$GITHUB_REF_NAME/);
  assert.match(workflow, /node scripts\/check-release-ref\.mjs/);
  assert.match(workflow, /node scripts\/check-release-channel\.mjs/);
  assert.match(workflow, /npm run smoke:pack -- "\.\/\$\{tarball\}"/);
  assert.match(workflow, /node scripts\/check-npm-release-state\.mjs/);
  assert.match(workflow, /steps\.npm_state\.outputs\.publish_required == 'true'/);
  assert.equal((workflow.match(/npm publish "\.\/artifacts\/logister-cli-\$\{RELEASE_VERSION\}\.tgz"/g) || []).length, 2);
  assert.ok(finalPublish >= 0 && finalPublish < registryVerification);
  assert.ok(registryVerification < githubRelease);
  assert.match(workflow, /Verify published npm bytes and dist-tag[\s\S]*--require-published[\s\S]*for attempt in \$\(seq 1 24\)/);
  assert.match(workflow, /concurrency:\s+group: release\s+cancel-in-progress: false/s);
  assert.match(workflow, /npm install --global npm@11\.19\.0/);
  assert.match(workflow, /--expected-tag "\$expected_tag"/);
  assert.equal(workflow.match(/--tag "\$NPM_DIST_TAG"/g)?.length, 2);
  assert.match(workflow, /needs\.package\.outputs\.is_prerelease == 'false'/);
  assert.match(workflow, /--prerelease/);
  assert.match(workflow, /--latest=false/);
  assert.match(workflow, /--draft=false/);
  assert.match(workflow, /if \[ "\$is_draft" != "true" \]; then\s+verify_public_release "\$verify_dir"\s+exit 0/s);
  assert.match(workflow, /gh release upload "\$RELEASE_TAG" artifacts\/\* --clobber\s+verify_release_assets "\$verify_dir"\s+gh release edit "\$RELEASE_TAG" \\\s+--draft=false/s);
  assert.match(workflow, /diff -u "\$expected_assets" "\$actual_assets"/);
  assert.match(workflow, /cmp "artifacts\/\$\{asset_name\}" "\$\{downloads\}\/\$\{asset_name\}"/);
  assert.match(workflow, /name: logister-cli-release[\s\S]*path: artifacts[\s\S]*--checksum-file "\$GITHUB_WORKSPACE\/artifacts\/checksums\.txt"/);
});

test("release-from-main tags only the successful current main commit with publishable changes", () => {
  const workflow = readFileSync(new URL("../.github/workflows/release-from-main.yml", import.meta.url), "utf8");

  assert.match(workflow, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(workflow, /CANDIDATE_SHA: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/);
  assert.match(workflow, /refs\/remotes\/origin\/main/);
  assert.match(workflow, /git diff --quiet "\$tagged_sha" "\$\{\{ github\.event\.workflow_run\.head_sha \}\}" -- bin src contracts docs README\.md/);
  assert.match(workflow, /Bump package\.json and package-lock\.json and add changelog notes/);
  assert.match(workflow, /git tag -a "\$\{\{ steps\.version\.outputs\.tag \}\}"/);
  assert.doesNotMatch(workflow, /gh workflow run/);
  assert.match(workflow, /concurrency:\s+group: release-from-main\s+cancel-in-progress: false/s);
});

test("distribution reconciliation requires npm, GitHub, Homebrew, and Scoop to share exact bytes", async () => {
  const bytes = Buffer.from("canonical npm bytes");
  const sha256 = await import("node:crypto").then(({ createHash }) => createHash("sha256").update(bytes).digest("hex"));
  const tarball = "https://registry.npmjs.org/logister-cli/-/logister-cli-1.2.3.tgz";
  const fetchImpl = async (url) => {
    if (url === "https://registry.npmjs.org/logister-cli/1.2.3") {
      return jsonResponse({ version: "1.2.3", dist: { tarball } });
    }
    if (url === tarball) return new Response(bytes);
    if (url.endsWith("/releases/tags/v1.2.3")) {
      return jsonResponse({ tag_name: "v1.2.3", draft: false, prerelease: false, html_url: "https://github.example/v1.2.3" });
    }
    if (url.includes("homebrew-logister")) {
      return new Response(`url "${tarball}"\n  sha256 "${sha256}"\n`);
    }
    if (url.includes("scoop-logister")) {
      return jsonResponse({ version: "1.2.3", url: tarball, hash: sha256 });
    }
    throw new Error(`unexpected URL ${url}`);
  };

  const receipt = await reconcileDistributions({ version: "1.2.3", expectedSha256: sha256, fetchImpl });
  assert.equal(receipt.sha256, sha256);
  assert.deepEqual(Object.keys(receipt.channels), ["npm", "github_release", "homebrew", "scoop"]);

  await assert.rejects(
    () => reconcileDistributions({ version: "1.2.3", expectedSha256: "0".repeat(64), fetchImpl }),
    /Callback SHA256 does not match npm/
  );
});

test("package-manager PR recovery stages one file and callbacks drive aggregate completion", () => {
  const releaseWorkflow = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
  const reconcileWorkflow = readFileSync(new URL("../.github/workflows/distribution-reconcile.yml", import.meta.url), "utf8");

  assert.match(releaseWorkflow, /git add -- "\$metadata_file"/);
  assert.match(releaseWorkflow, /gh pr list --repo "\$repo" --state all --head "\$branch"/);
  assert.match(releaseWorkflow, /gh pr reopen "\$pr_number"/);
  assert.match(releaseWorkflow, /gh pr merge "\$pr_number" --repo "\$repo" --auto --squash/);
  assert.match(releaseWorkflow, /Formula\/logister\.rb/);
  assert.match(releaseWorkflow, /bucket\/logister\.json/);
  assert.match(reconcileWorkflow, /repository_dispatch:\s+types:\s+- distribution-published/s);
  assert.match(reconcileWorkflow, /context=release\/distributions/);
  assert.match(reconcileWorkflow, /state=pending/);
  assert.match(reconcileWorkflow, /state=success/);
});

test("manual package-manager recovery consumes the canonical tested checksum", () => {
  const documentation = readFileSync(new URL("../docs/release-distribution.md", import.meta.url), "utf8");

  assert.match(documentation, /npm run update:package-managers -- \\\s+--version "\$version" \\\s+--checksum-file "\$PWD\/artifacts\/checksums\.txt"/);
  assert.match(documentation, /re-downloads the tarball, and proves\s+its bytes match the tested SHA256/);
  assert.doesNotMatch(documentation, /downloading the published npm\s+tarball and computing its SHA256/);
});

test("contract sync uses its explicit bot credential", () => {
  const workflow = readFileSync(new URL("../.github/workflows/contract-sync.yml", import.meta.url), "utf8");

  assert.match(workflow, /LOGISTER_CLI_SYNC_BOT_TOKEN/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /openapi_sha256/);
  assert.match(workflow, /expected_url="https:\/\/raw\.githubusercontent\.com\/taimoorq\/logister\/\$\{backend_sha\}\/docs\/openapi\.yaml"/);
  assert.match(workflow, /sha256sum --check --strict/);
  assert.match(workflow, /contracts\/logister-api\.lock "\$CONTRACT_SOURCE"/);
  assert.doesNotMatch(workflow, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.doesNotMatch(workflow, /raw\.githubusercontent\.com\/taimoorq\/logister\/main\/docs\/openapi\.yaml/);
});

test("upstream release impact is validated by the shared public workflow", () => {
  const workflow = readFileSync(new URL("../.github/workflows/upstream-release-impact.yml", import.meta.url), "utf8");

  assert.match(workflow, /repository_dispatch:/);
  assert.match(workflow, /types: \[logister-release-impact\]/);
  assert.match(workflow, /uses: taimoorq\/logister\/\.github\/workflows\/addon-impact-check\.yml@main/);
  assert.match(workflow, /release_set_sha256:/);
});

test("release credential preflight checks both package-manager repositories without mutation", () => {
  const workflow = readFileSync(new URL("../.github/workflows/release-preflight.yml", import.meta.url), "utf8");

  assert.match(workflow, /PACKAGE_MANAGER_REPO_TOKEN/);
  assert.match(workflow, /taimoorq\/homebrew-logister taimoorq\/scoop-logister/);
  assert.match(workflow, /\.permissions\.push/);
  assert.doesNotMatch(workflow, /gh pr create|git push/);
});

test("release refs must be reachable from protected main", () => {
  const repository = mkdtempSync(join(tmpdir(), "logister-cli-release-ref-"));

  try {
    git(repository, "init", "-b", "main");
    git(repository, "config", "user.name", "Release Test");
    git(repository, "config", "user.email", "release-test@example.invalid");
    writeFileSync(join(repository, "fixture.txt"), "reviewed\n", "utf8");
    git(repository, "add", "fixture.txt");
    git(repository, "commit", "-m", "Reviewed release");
    git(repository, "tag", "v1.0.0");

    const result = verifyReleaseRef({
      tagRef: "refs/tags/v1.0.0",
      expectedTag: "v1.0.0",
      mainRef: "main",
      cwd: repository
    });
    assert.equal(result.tagCommit, result.mainCommit);

    writeFileSync(join(repository, "fixture.txt"), "main advanced\n", "utf8");
    git(repository, "commit", "-am", "Advance main");

    const advancedMainResult = verifyReleaseRef({
      tagRef: "refs/tags/v1.0.0",
      expectedTag: "v1.0.0",
      mainRef: "main",
      cwd: repository
    });
    assert.notEqual(advancedMainResult.tagCommit, advancedMainResult.mainCommit);

    git(repository, "checkout", "-b", "side", "refs/tags/v1.0.0");
    writeFileSync(join(repository, "side.txt"), "unmerged\n", "utf8");
    git(repository, "add", "side.txt");
    git(repository, "commit", "-m", "Unmerged release");
    git(repository, "tag", "v1.0.1");

    assert.throws(
      () => verifyReleaseRef({
        tagRef: "refs/tags/v1.0.1",
        expectedTag: "v1.0.1",
        mainRef: "main",
        cwd: repository
      }),
      /not reachable from protected main/
    );

    assert.throws(
      () => verifyReleaseRef({
        tagRef: "refs/tags/v1.0.0",
        expectedTag: "v1.0.0-wrong",
        mainRef: "main",
        cwd: repository
      }),
      /Release ref must be refs\/tags\/v1\.0\.0-wrong/
    );
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

function git(cwd, ...args) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

function jsonResponse(value) {
  return new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
}
