import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { main } from "../src/main.js";
import { startHttpFixture } from "./helpers/http-fixture.js";

test("Android artifact upload streams a bounded multipart mapping to the typed project endpoint", async () => {
  const temp = await mkdtemp(join(tmpdir(), "logister-artifact-android-"));
  const mappingPath = join(temp, "mapping.txt");
  await writeFile(mappingPath, "com.acme.Cart -> a:\n    void save() -> a\n");
  const fixture = await artifactFixture("android-mapping", {
    artifact: "android_mapping",
    version_code: "42",
    status: "available"
  });

  try {
    const stdout = captureStream();
    await main([
      "artifacts", "upload-android",
      "--project", "mobile-app",
      "--file", mappingPath,
      "--package-name", "com.acme.shop",
      "--version-name", "1.4.0",
      "--version-code", "42"
    ], io(fixture, temp, stdout));

    assert.equal(JSON.parse(stdout.output).artifact, "android_mapping");
    const request = fixture.requests.find((entry) => entry.path.endsWith("/artifacts/android-mapping"));
    assert.equal(request.method, "POST");
    assert.equal(request.headers.authorization, "Bearer artifact-token");
    assert.match(request.headers["content-type"], /^multipart\/form-data; boundary=/);
    assert.match(request.body, /name="package_name"\r\n\r\ncom\.acme\.shop/);
    assert.match(request.body, /name="version_code"\r\n\r\n42/);
    assert.match(request.body, /filename="mapping\.txt"/);
    assert.match(request.body, /com\.acme\.Cart -> a:/);
  } finally {
    await fixture.close();
    await rm(temp, { recursive: true, force: true });
  }
});

test("iOS artifact upload validates identity fields before streaming a dSYM archive", async () => {
  const temp = await mkdtemp(join(tmpdir(), "logister-artifact-ios-"));
  const dsymPath = join(temp, "Shop.dSYM.zip");
  await writeFile(dsymPath, Buffer.from("PK\x03\x04symbol-data", "binary"));
  const fixture = await artifactFixture("apple-dsym", {
    artifact: "apple_dsym",
    binary_uuid: "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE",
    verification: "queued"
  });

  try {
    await assert.rejects(
      () => main([
        "artifacts", "upload-ios", "--project", "mobile-app", "--file", dsymPath,
        "--app-identifier", "com.acme.shop", "--version-code", "42",
        "--binary-uuid", "not-a-uuid", "--architecture", "arm64"
      ], io(fixture, temp, captureStream())),
      /--binary-uuid must be a UUID/
    );
    assert.equal(fixture.requests.some((entry) => entry.path.endsWith("/artifacts/apple-dsym")), false);

    const stdout = captureStream();
    await main([
      "artifacts", "upload-ios", "--project", "mobile-app", "--file", dsymPath,
      "--app-identifier", "com.acme.shop", "--version-code", "42",
      "--binary-uuid", "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE",
      "--architecture", "arm64"
    ], io(fixture, temp, stdout));

    assert.equal(JSON.parse(stdout.output).verification, "queued");
    const request = fixture.requests.find((entry) => entry.path.endsWith("/artifacts/apple-dsym"));
    assert.match(request.body, /name="binary_uuid"\r\n\r\nAAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE/);
    assert.match(request.body, /filename="Shop\.dSYM\.zip"/);
  } finally {
    await fixture.close();
    await rm(temp, { recursive: true, force: true });
  }
});

async function artifactFixture(endpoint, response) {
  return startHttpFixture(({ url }) => {
    if (url.pathname === "/api/v1/cli/capabilities") {
      return { body: { minimum_cli_version: "0.1.0", recommended_cli_version: "1.0.0", features: { mobile_artifacts: true } } };
    }
    if (url.pathname === `/api/v1/cli/projects/mobile-app/artifacts/${endpoint}`) return { status: 201, body: response };
    return { status: 404, body: { code: "not_found", message: "Not found" } };
  });
}

function io(fixture, temp, stdout) {
  return {
    env: {
      LOGISTER_HOST: fixture.host,
      LOGISTER_TOKEN: "artifact-token",
      LOGISTER_CONFIG: join(temp, "config.json")
    },
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout,
    stderr: captureStream(),
    fetchImpl: globalThis.fetch
  };
}

function captureStream() {
  return { output: "", write(chunk) { this.output += chunk; } };
}
