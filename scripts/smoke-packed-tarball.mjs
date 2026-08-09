#!/usr/bin/env node
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const temp = await mkdtemp(join(tmpdir(), "logister-cli-pack-smoke-"));
let fixture;

try {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  let tarball;
  if (process.argv[2]) {
    tarball = resolve(process.argv[2]);
  } else {
    const packed = await execFile("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", temp], { cwd: process.cwd() });
    const packResult = JSON.parse(packed.stdout);
    tarball = join(temp, packResult[0].filename);
  }
  const installRoot = join(temp, "install");
  await execFile("npm", ["install", "--prefix", installRoot, "--ignore-scripts", "--no-audit", "--no-fund", tarball]);

  const binary = join(installRoot, "node_modules", ".bin", process.platform === "win32" ? "logister.cmd" : "logister");
  const version = await execFile(binary, ["version", "--format", "json"]);
  const versionPayload = JSON.parse(version.stdout);
  if (versionPayload.version !== packageJson.version) throw new Error(`packed CLI version mismatch: ${versionPayload.version}`);
  const help = await execFile(binary, ["help"]);
  if (!help.stdout.includes("Logister CLI")) throw new Error("packed CLI help smoke failed");
  fixture = await capabilitiesFixture(packageJson.version);
  const doctor = await execFile(binary, ["doctor", "--host", fixture.host, "--format", "json"], {
    env: {
      ...process.env,
      LOGISTER_CONFIG: join(temp, "smoke-config.json"),
      LOGISTER_HOST: "",
      LOGISTER_TOKEN: "",
      LOGISTER_PROJECT: "",
      LOGISTER_DISABLE_KEYCHAIN: "1"
    }
  });
  const doctorPayload = JSON.parse(doctor.stdout);
  if (doctorPayload.server?.server !== "logister" || doctorPayload.cli?.version !== packageJson.version) {
    throw new Error("packed CLI doctor smoke failed");
  }
  process.stdout.write(`Packed tarball smoke passed for logister-cli@${packageJson.version}.\n`);
} finally {
  if (fixture) await fixture.close();
  await rm(temp, { recursive: true, force: true });
}

async function capabilitiesFixture(cliVersion) {
  const server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/v1/cli/capabilities") {
      response.end(JSON.stringify({
        server: "logister",
        server_version: "3.5",
        api_contract_version: "3.5",
        minimum_cli_version: "0.1.0",
        recommended_cli_version: cliVersion,
        features: { capabilities: true }
      }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ code: "not_found", message: "Not found" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    host: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}
