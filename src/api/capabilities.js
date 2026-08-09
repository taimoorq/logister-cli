import { compareVersions, isValidVersion } from "../version/semver.js";

const checkedContexts = new WeakSet();

export async function capabilitiesFor(context, { warn = true } = {}) {
  let capabilities;
  try {
    capabilities = validateCapabilities(await context.client.capabilities({ signal: context.signal }));
  } catch (error) {
    if (error?.status === 404) {
      const unsupported = new Error([
        "This Logister server does not expose CLI capability negotiation.",
        "Upgrade the server before using this command, or use a CLI version supported by that self-hosted release."
      ].join("\n"));
      unsupported.exitCode = 4;
      throw unsupported;
    }
    throw error;
  }
  checkCompatibility(capabilities, context.runtime.version, warn ? context.stderr : null, context);
  return capabilities;
}

export function validateCapabilities(capabilities) {
  if (!capabilities || typeof capabilities !== "object" || Array.isArray(capabilities)) capabilityError("root must be an object");
  const validated = { ...capabilities };
  for (const field of ["minimum_cli_version", "recommended_cli_version"]) {
    if (validated[field] !== undefined && validated[field] !== null && !isValidVersion(validated[field], { allowVPrefix: false })) {
      capabilityError(`${field} must be a semantic version`);
    }
  }
  for (const field of ["server_version", "api_contract_version"]) {
    if (validated[field] !== undefined && validated[field] !== null) {
      if (typeof validated[field] !== "string" || !/^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/.test(validated[field])) {
        capabilityError(`${field} must be a bounded version identifier`);
      }
    }
  }
  if (validated.features !== undefined) {
    if (!validated.features || typeof validated.features !== "object" || Array.isArray(validated.features)) capabilityError("features must be an object");
    const entries = Object.entries(validated.features);
    if (entries.length > 100 || !entries.every(([key, value]) => /^[a-z_]{1,64}$/.test(key) && typeof value === "boolean")) {
      capabilityError("features must contain at most 100 boolean feature flags");
    }
    validated.features = Object.fromEntries(entries);
  }
  return validated;
}

function capabilityError(detail) {
  const error = new Error(`Invalid Logister capability response: ${detail}.`);
  error.exitCode = 1;
  throw error;
}

export async function ensureFeature(context, feature) {
  if (!feature) return capabilitiesFor(context);

  const capabilities = await capabilitiesFor(context);
  if (capabilities?.features?.[feature] === true) return capabilities;

  const error = new Error([
    `This Logister server does not support CLI feature '${feature}'.`,
    `Server version: ${capabilities?.server_version || "unknown"}`,
    `API contract: ${capabilities?.api_contract_version || "unknown"}`,
    `Recommended CLI version: ${capabilities?.recommended_cli_version || "unknown"}`,
    "Upgrade or enable the feature on the server, then run `logister doctor`."
  ].join("\n"));
  error.exitCode = 4;
  throw error;
}

export function checkCompatibility(capabilities, cliVersion, stderr, contextKey = null) {
  const minimum = capabilities?.minimum_cli_version;
  if (isValidVersion(minimum) && isValidVersion(cliVersion) && compareVersions(cliVersion, minimum) < 0) {
    const error = new Error([
      `Logister CLI ${cliVersion} is older than this server's minimum supported CLI ${minimum}.`,
      "Upgrade Logister CLI before running this command."
    ].join("\n"));
    error.exitCode = 4;
    throw error;
  }

  const recommended = capabilities?.recommended_cli_version;
  if (!stderr || !isValidVersion(recommended) || !isValidVersion(cliVersion) || compareVersions(cliVersion, recommended) >= 0) return;
  if (contextKey && checkedContexts.has(contextKey)) return;

  stderr.write(`Warning: Logister CLI ${recommended} is recommended by this server; you are running ${cliVersion}.\n`);
  if (contextKey) checkedContexts.add(contextKey);
}
