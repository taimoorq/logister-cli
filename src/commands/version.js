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
    try {
      payload.latest = await latestRelease({
        fetchImpl: context.fetchImpl || globalThis.fetch,
        signal: context.signal,
        timeoutMs: context.runtime.timeoutMs
      });
    } catch (error) {
      if (error?.interrupted || context.signal?.aborted) throw error;
      payload.latest = { error: error.message };
    }
    payload.update_available = isNewerVersion(payload.latest.version, context.runtime.version);
  }

  return context.write(payload, { format: context.parsed.options.format || "table", redact: false });
}
