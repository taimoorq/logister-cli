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

  assert.match(workflow, /node scripts\/check-release-ref\.mjs/);
  assert.match(workflow, /node scripts\/check-release-channel\.mjs/);
  assert.match(workflow, /npm run smoke:pack -- "\.\/\$\{tarball\}"/);
  assert.match(workflow, /node scripts\/check-npm-release-state\.mjs/);
  assert.match(workflow, /steps\.npm_state\.outputs\.publish_required == 'true'/);
  assert.match(workflow, /concurrency:\s+group: release\s+cancel-in-progress: false/s);
  assert.match(workflow, /npm install --global npm@11\.19\.0/);
  assert.match(workflow, /--expected-tag "\$expected_tag"/);
  assert.equal(workflow.match(/--tag "\$NPM_DIST_TAG"/g)?.length, 2);
  assert.match(workflow, /needs\.package\.outputs\.is_prerelease == 'false'/);
  assert.match(workflow, /--prerelease/);
  assert.match(workflow, /--latest=false/);
  assert.match(workflow, /--draft=false/);
  assert.match(workflow, /name: logister-cli-release[\s\S]*path: artifacts[\s\S]*--checksum-file "\$GITHUB_WORKSPACE\/artifacts\/checksums\.txt"/);
});

test("contract sync uses its explicit bot credential", () => {
  const workflow = readFileSync(new URL("../.github/workflows/contract-sync.yml", import.meta.url), "utf8");

  assert.match(workflow, /LOGISTER_CLI_SYNC_BOT_TOKEN/);
  assert.match(workflow, /persist-credentials: false/);
  assert.doesNotMatch(workflow, /GH_TOKEN: \$\{\{ github\.token \}\}/);
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
