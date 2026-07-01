import { latestRelease } from "../update/releases.js";

export async function runVersionCommand(_args, context) {
  const payload = {
    name: "@logister/cli",
    version: context.runtime.version
  };

  if (context.parsed.options.check) {
    payload.latest = await latestRelease().catch((error) => ({ error: error.message }));
  }

  context.write(payload, { format: context.parsed.options.format || "table", redact: false });
}
