import { ApiClient } from "./api/client.js";
import { runAuthCommand } from "./commands/auth.js";
import { runArtifactsCommand } from "./commands/artifacts.js";
import { runDoctorCommand } from "./commands/doctor.js";
import { HELP_TEXT, runHelpCommand } from "./commands/help.js";
import { runResourceCommand } from "./commands/resources.js";
import { optionDefinition, validateInvocation } from "./commands/specs.js";
import { runUpdateCommand } from "./commands/update.js";
import { runVersionCommand } from "./commands/version.js";
import { loadCleanupRuntime, loadPublicRuntime, loadRuntime } from "./config/runtime.js";
import { writeResult } from "./output/result.js";

const RESOURCE_COMMANDS = new Set([
  "projects",
  "overview",
  "events",
  "logs",
  "issues",
  "transactions",
  "traces",
  "monitors",
  "deployments",
  "insights",
  "metrics",
  "artifacts"
]);

export async function main(argv, io) {
  const parsed = parseArgs(argv);
  if (parsed.options.help || parsed.command === "help" || !parsed.command) {
    return runHelpCommand(parsed.args, io);
  }

  const invocation = validateInvocation(parsed);
  if (!invocation) {
    const error = new Error(`Unknown command: ${parsed.command}\n\n${HELP_TEXT}`);
    error.exitCode = 2;
    throw error;
  }

  let runtime;
  if (["version", "update"].includes(parsed.command)) runtime = loadPublicRuntime(parsed.options, io.env);
  else if (parsed.command === "auth" && invocation.subcommand === "logout") runtime = await loadCleanupRuntime(parsed.options, io.env);
  else runtime = await loadRuntime(parsed.options, io.env, io.credentialStore);
  const client = new ApiClient({
    host: runtime.host,
    token: runtime.token,
    userAgent: `logister-cli/${runtime.version}`,
    fetchImpl: io.fetchImpl || globalThis.fetch,
    timeoutMs: runtime.timeoutMs,
    retries: runtime.retries,
    allowInsecureHttp: runtime.allowInsecureHttp,
    legacyCredentialPending: runtime.legacyCredentialPending,
    sleepImpl: io.sleepImpl,
    randomImpl: io.randomImpl
  });
  const context = {
    ...io,
    parsed,
    invocation,
    runtime,
    client,
    write: (payload, options = {}) => {
      const redact = options.redact ?? parsed.options.redact;
      return writeResult(payload, {
        stdout: io.stdout,
        format: options.format || parsed.options.format || runtime.format || "table",
        redact,
        columns: options.columns,
        signal: io.signal,
        onBrokenPipe: io.onBrokenPipe
      });
    }
  };

  if (parsed.command === "auth") return runAuthCommand(parsed.args, context);
  if (parsed.command === "doctor") return runDoctorCommand(parsed.args, context);
  if (parsed.command === "version") return runVersionCommand(parsed.args, context);
  if (parsed.command === "update") return runUpdateCommand(parsed.args, context);
  if (parsed.command === "artifacts") return runArtifactsCommand(context);
  if (RESOURCE_COMMANDS.has(parsed.command)) return runResourceCommand(parsed.command, parsed.args, context);

  throw new Error(`Command dispatch is not implemented: ${parsed.command}`);
}

export function parseArgs(argv) {
  const options = {};
  const args = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      args.push(...argv.slice(index + 1));
      break;
    }

    if (!arg.startsWith("-") || arg === "-") {
      args.push(arg);
      continue;
    }

    if (arg.startsWith("--")) {
      const [rawKey, inlineValue] = arg.slice(2).split(/=(.*)/s, 2);
      const definition = optionDefinition(rawKey);
      if (!definition) usageError(`Unknown option: --${rawKey}`);

      if (definition.kind === "boolean") {
        if (inlineValue !== undefined) usageError(`Option --${rawKey} does not take a value.`);
        setOption(options, definition, definition.value);
      } else {
        const value = inlineValue ?? optionValue(argv, index, rawKey);
        if (inlineValue === undefined) index += 1;
        setOption(options, definition, value);
      }
      continue;
    }

    if (arg === "-h") options.help = true;
    else if (arg === "-v") args.push("version");
    else usageError(`Unknown option: ${arg}`);
  }

  return {
    command: args.shift(),
    args,
    options
  };
}

function optionValue(argv, index, key) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    usageError(`Missing value for --${key}`);
  }
  return value;
}

function setOption(options, definition, value) {
  const { key, repeatable } = definition;
  if (repeatable) {
    options[key] ||= [];
    options[key].push(value);
    return;
  }
  if (Object.hasOwn(options, key)) {
    usageError(`Option --${key.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`)} may only be specified once.`);
  }
  options[key] = value;
}

function usageError(message) {
  const error = new Error(message);
  error.exitCode = 2;
  throw error;
}
