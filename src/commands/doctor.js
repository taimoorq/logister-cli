export async function runDoctorCommand(_args, context) {
  const capabilities = await context.client.capabilities();
  const payload = {
    cli: {
      version: context.runtime.version,
      profile: context.runtime.profileName,
      host: context.runtime.host || null,
      token_present: Boolean(context.runtime.token),
      project: context.runtime.project || null
    },
    server: capabilities
  };

  context.write(payload, { format: context.parsed.options.format || "json", redact: false });
}
