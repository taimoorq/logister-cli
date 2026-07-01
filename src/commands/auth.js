import { deleteProfileToken, writeProfile, writeProfileToken } from "../config/runtime.js";
import { openBrowser, shouldOpenBrowser } from "../system/browser.js";

export async function runAuthCommand(args, context) {
  const subcommand = args[0] || "status";
  if (subcommand === "login") return login(context);
  if (subcommand === "status") return status(context);
  if (subcommand === "logout") return logout(context);

  const error = new Error(`Unknown auth subcommand: ${subcommand}`);
  error.exitCode = 2;
  throw error;
}

async function login({ parsed, runtime, stdout, env, stdin, client }) {
  const host = parsed.options.host || runtime.host;
  const token = parsed.options.tokenStdin ? await readTokenFromStdin(stdin) : parsed.options.token || env.LOGISTER_TOKEN;
  if (!host) {
    const error = new Error("Usage: logister auth login --host <url>\n   or: logister auth login --host <url> --token <cli-access-token>");
    error.exitCode = 2;
    throw error;
  }

  if (token) return saveLogin({ runtime, parsed, env, stdout, host, token });

  return deviceLogin({ parsed, runtime, stdout, env, client });
}

async function saveLogin({ runtime, parsed, env, stdout, host, token }) {
  await writeProfile(runtime.profileName, { host, project: parsed.options.project || runtime.project || undefined }, env);
  const tokenStore = await writeProfileToken(runtime.profileName, token, env);
  stdout.write(`Saved Logister profile '${runtime.profileName}' for ${host} using ${tokenStore} token storage.\n`);
}

async function deviceLogin({ parsed, runtime, stdout, env, client }) {
  const challenge = await client.post(
    "/api/v1/cli/device_authorizations",
    { client_name: "Logister CLI" },
    { auth: false }
  );
  const verificationUrl = challenge.verification_uri_complete || challenge.verification_uri;
  if (shouldOpenBrowser(parsed.options, env)) openBrowser(verificationUrl);

  stdout.write([
    "Approve this Logister CLI login in your browser.",
    `Code: ${challenge.user_code}`,
    `URL: ${verificationUrl}`,
    ""
  ].join("\n"));

  const tokenPayload = await pollForDeviceToken({
    client,
    deviceCode: challenge.device_code,
    expiresIn: Number(challenge.expires_in || 600),
    intervalSeconds: Number(challenge.interval || 3),
    env
  });

  await saveLogin({
    runtime,
    parsed,
    env,
    stdout,
    host: parsed.options.host || runtime.host,
    token: tokenPayload.access_token
  });
}

async function readTokenFromStdin(stdin) {
  const chunks = [];
  for await (const chunk of stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8").trim();
}

async function pollForDeviceToken({ client, deviceCode, expiresIn, intervalSeconds, env }) {
  const deadline = Date.now() + Math.max(expiresIn, 1) * 1000;
  let intervalMs = pollIntervalMs(intervalSeconds, env);

  while (Date.now() < deadline) {
    await sleep(intervalMs);

    try {
      return await client.post("/api/v1/cli/device_authorizations/token", { device_code: deviceCode }, { auth: false });
    } catch (error) {
      const errorCode = error?.body?.error;
      if (errorCode === "authorization_pending") continue;
      if (errorCode === "slow_down") {
        intervalMs += 5000;
        continue;
      }

      throw deviceLoginError(errorCode, error);
    }
  }

  const error = new Error("Logister CLI login expired before browser approval completed. Run `logister auth login` again.");
  error.exitCode = 3;
  throw error;
}

function pollIntervalMs(intervalSeconds, env) {
  const override = Number(env.LOGISTER_AUTH_POLL_INTERVAL_MS);
  if (Number.isFinite(override) && override >= 0) return override;
  return Math.max(intervalSeconds, 1) * 1000;
}

function deviceLoginError(errorCode, originalError) {
  const messages = {
    access_denied: "Logister CLI login was denied in the browser.",
    expired_token: "Logister CLI login expired. Run `logister auth login` again.",
    invalid_grant: "Logister CLI login is no longer valid. Run `logister auth login` again."
  };
  const error = new Error(messages[errorCode] || originalError.message);
  error.exitCode = 3;
  return error;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}


async function status({ runtime, stdout }) {
  const payload = {
    profile: runtime.profileName,
    config_path: runtime.configPath,
    host: runtime.host || null,
    token_present: Boolean(runtime.token),
    token_source: runtime.tokenSource || null,
    project: runtime.project || null
  };
  stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

async function logout({ runtime, stdout, env }) {
  await deleteProfileToken(runtime.profileName, env);
  stdout.write(`Removed token from Logister profile '${runtime.profileName}'.\n`);
}
