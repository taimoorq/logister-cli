import { latestRelease } from "../update/releases.js";
import { packageInfo } from "../version/package.js";
import { isNewerVersion } from "../version/semver.js";

export async function runVersionCommand(_args, context) {
  const payload = {
    name: packageInfo.name,
    version: context.runtime.version,
    node: process.versions.node,
    repository: packageInfo.repository
  };

  if (context.parsed.options.check) {
    payload.latest = await latestRelease().catch((error) => ({ error: error.message }));
    payload.update_available = isNewerVersion(payload.latest.version, context.runtime.version);
  }

  context.write(payload, { format: context.parsed.options.format || "table", redact: false });
}
