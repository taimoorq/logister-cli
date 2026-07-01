import { ApiClient, ApiError } from "./api/client.js";
import { runAuthCommand } from "./commands/auth.js";
import { runDoctorCommand } from "./commands/doctor.js";
import { HELP_TEXT, runHelpCommand } from "./commands/help.js";
import { runResourceCommand } from "./commands/resources.js";
import { runUpdateCommand } from "./commands/update.js";
import { runVersionCommand } from "./commands/version.js";
import { loadRuntime } from "./config/runtime.js";
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
  "metrics"
]);

export async function main(argv, io) {
  const parsed = parseArgs(argv);
  if (parsed.options.help || parsed.command === "help" || !parsed.command) {
    return runHelpCommand(parsed.args, io);
  }

  const runtime = await loadRuntime(parsed.options, io.env);
  const client = new ApiClient({
    host: runtime.host,
    token: runtime.token,
    userAgent: `logister-cli/${runtime.version}`,
    fetchImpl: globalThis.fetch
  });
  const context = {
    ...io,
    parsed,
    runtime,
    client,
    write: (payload, options = {}) => {
      const redact = options.redact ?? parsed.options.redact;
      return writeResult(payload, {
        stdout: io.stdout,
        format: options.format || parsed.options.format || "table",
        redact
      });
    }
  };

  try {
    if (parsed.command === "auth") return runAuthCommand(parsed.args, context);
    if (parsed.command === "doctor") return runDoctorCommand(parsed.args, context);
    if (parsed.command === "version") return runVersionCommand(parsed.args, context);
    if (parsed.command === "update") return runUpdateCommand(parsed.args, context);
    if (RESOURCE_COMMANDS.has(parsed.command)) return runResourceCommand(parsed.command, parsed.args, context);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      error.message = [
        "This Logister server does not expose that CLI endpoint yet.",
        `Requested: ${error.method} ${error.path}`,
        "Run `logister doctor` to inspect server capabilities."
      ].join("\n");
    }
    throw error;
  }

  const error = new Error(`Unknown command: ${parsed.command}\n\n${HELP_TEXT}`);
  error.exitCode = 2;
  throw error;
}

export function parseArgs(argv) {
  const options = {
    format: "table",
    redact: true
  };
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
      const key = normalizeOptionKey(rawKey);

      if (key === "noColor") {
        options.color = false;
      } else if (key === "noRedact") {
        options.redact = false;
      } else if (isBooleanOption(key)) {
        options[key] = true;
      } else {
        const value = inlineValue ?? optionValue(argv, index, rawKey);
        if (inlineValue === undefined) index += 1;
        options[key] = value;
      }
      continue;
    }

    if (arg === "-h") options.help = true;
    else if (arg === "-v") options.version = true;
    else {
      const error = new Error(`Unknown option: ${arg}`);
      error.exitCode = 2;
      throw error;
    }
  }

  if (options.version && args.length === 0) args.push("version");

  return {
    command: args.shift(),
    args,
    options
  };
}

function normalizeOptionKey(key) {
  return key.replace(/-([a-z])/g, (_, character) => character.toUpperCase());
}

function optionValue(argv, index, key) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    const error = new Error(`Missing value for --${key}`);
    error.exitCode = 2;
    throw error;
  }
  return value;
}

function isBooleanOption(key) {
  return new Set([
    "help",
    "check",
    "apply",
    "raw",
    "noBrowser",
    "follow",
    "forAi",
    "includeOccurrences",
    "introducedToday",
    "relatedLogs",
    "slowest",
    "tokenStdin",
    "version"
  ]).has(key);
}
