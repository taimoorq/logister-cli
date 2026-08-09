import { capabilitiesFor } from "../api/capabilities.js";

export async function runDoctorCommand(_args, context) {
  const capabilities = await capabilitiesFor(context);
  const payload = {
    cli: {
      version: context.runtime.version,
      profile: context.runtime.profileName,
      host: context.runtime.host || null,
      token_present: Boolean(context.runtime.token),
      project: context.runtime.project || null,
      legacy_credential_unbound: Boolean(context.runtime.legacyCredentialPending)
    },
    server: capabilities,
    session: null
  };

  if (context.runtime.token) {
    try {
      payload.session = await context.client.get("/api/v1/cli/session", {}, { signal: context.signal });
    } catch (error) {
      if (error?.interrupted || context.signal?.aborted) throw error;
      payload.session_error = {
        status: error.status || null,
        code: error.code || error.name,
        message: error.status === 404 ? "Session diagnostics are not available on this Logister server." : error.message
      };
    }
  }

  await context.write(payload, { format: context.parsed.options.format || "json", redact: false });
}
