import { capabilitiesFor } from "../api/capabilities.js";
import { redactSessionDiagnostics } from "../redaction/redact.js";

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
    const redact = context.parsed.options.redact !== false;
    try {
      const session = await context.client.get("/api/v1/cli/session", {}, { signal: context.signal });
      payload.session = redact ? redactSessionDiagnostics(session) : session;
    } catch (error) {
      if (error?.interrupted || context.signal?.aborted) throw error;
      const sessionError = {
        status: error.status || null,
        code: error.code || error.name,
        message: error.status === 404 ? "Session diagnostics are not available on this Logister server." : error.message
      };
      payload.session_error = redact ? redactSessionDiagnostics(sessionError) : sessionError;
    }
  }

  // The local and capability fields are CLI-validated; only the server session objects are redacted.
  await context.write(payload, { format: context.parsed.options.format || "json", redact: false });
}
