const GLOBAL_OPTIONS = [
  "host",
  "token",
  "profile",
  "project",
  "format",
  "redact",
  "color",
  "allowInsecureHttp",
  "timeoutMs",
  "retries"
];

const PAGE_OPTIONS = ["limit", "cursor", "all"];
const RANGE_OPTIONS = ["since", "until"];
const EVENT_FILTERS = [
  "type",
  "eventType",
  "level",
  "status",
  "environment",
  "release",
  "query",
  "traceId",
  "requestId",
  "minDurationMs"
];

export const OPTION_DEFINITIONS = Object.freeze({
  "--host": valueOption("host"),
  "--token": valueOption("token"),
  "--profile": valueOption("profile"),
  "--project": valueOption("project"),
  "--format": valueOption("format"),
  "--timeout-ms": valueOption("timeoutMs"),
  "--retries": valueOption("retries"),
  "--no-color": booleanOption("color", false),
  "--no-redact": booleanOption("redact", false),
  "--allow-insecure-http": booleanOption("allowInsecureHttp"),
  "--help": booleanOption("help"),
  "--check": booleanOption("check"),
  "--apply": booleanOption("apply"),
  "--no-browser": booleanOption("noBrowser"),
  "--token-stdin": booleanOption("tokenStdin"),
  "--all": booleanOption("all"),
  "--follow": booleanOption("follow"),
  "--include-archived": booleanOption("includeArchived"),
  "--include-occurrences": booleanOption("includeOccurrences"),
  "--introduced-today": booleanOption("introducedToday"),
  "--related-logs": booleanOption("relatedLogs"),
  "--limit": valueOption("limit"),
  "--cursor": valueOption("cursor"),
  "--since": valueOption("since"),
  "--until": valueOption("until"),
  "--type": valueOption("type"),
  "--event-type": valueOption("eventType"),
  "--level": valueOption("level"),
  "--status": valueOption("status"),
  "--assigned": valueOption("assigned"),
  "--assignee": valueOption("assignee"),
  "--sort": valueOption("sort"),
  "--env": valueOption("environment"),
  "--environment": valueOption("environment"),
  "--release": valueOption("release"),
  "--q": valueOption("query"),
  "--query": valueOption("query"),
  "--trace-id": valueOption("traceId"),
  "--request-id": valueOption("requestId"),
  "--min-duration-ms": valueOption("minDurationMs"),
  "--window": valueOption("window"),
  "--token-budget": valueOption("tokenBudget"),
  "--poll-interval-ms": valueOption("pollIntervalMs"),
  "--service": valueOption("service"),
  "--operation": valueOption("operation"),
  "--repository": valueOption("repository"),
  "--source": valueOption("source"),
  "--metric": repeatableOption("metrics"),
  "--attribute": repeatableOption("attributes")
});

export const COMMAND_SPECS = Object.freeze({
  help: command({ defaultSubcommand: "default", subcommands: { default: spec() } }),
  auth: command({
    defaultSubcommand: "status",
    subcommands: {
      login: spec({ options: ["host", "token", "profile", "project", "noBrowser", "tokenStdin", "timeoutMs", "retries", "allowInsecureHttp"] }),
      status: spec({ options: GLOBAL_OPTIONS }),
      logout: spec({ options: ["profile", "allowInsecureHttp"] })
    }
  }),
  doctor: command({ defaultSubcommand: "default", subcommands: { default: spec({ options: GLOBAL_OPTIONS }) } }),
  version: command({ defaultSubcommand: "default", subcommands: { default: spec({ options: ["format", "check", "timeoutMs", "retries"] }) } }),
  update: command({ defaultSubcommand: "default", subcommands: { default: spec({ options: ["format", "check", "apply", "timeoutMs", "retries"] }) } }),
  projects: resource("projects", {
    list: spec({ options: [...GLOBAL_OPTIONS, ...PAGE_OPTIONS, "includeArchived"], paginated: true }),
    show: spec({ positional: ["project"], options: GLOBAL_OPTIONS })
  }),
  overview: resource("project_summary", {
    default: spec({ options: [...GLOBAL_OPTIONS, ...RANGE_OPTIONS] })
  }, "default"),
  events: resource("events", {
    list: spec({ options: [...GLOBAL_OPTIONS, ...PAGE_OPTIONS, ...RANGE_OPTIONS, ...EVENT_FILTERS], paginated: true }),
    show: spec({ positional: ["event-id"], options: GLOBAL_OPTIONS }),
    tail: spec({ options: [...GLOBAL_OPTIONS, ...PAGE_OPTIONS, ...RANGE_OPTIONS, ...EVENT_FILTERS, "follow", "pollIntervalMs"], paginated: true })
  }),
  logs: resource("logs", {
    list: spec({ options: [...GLOBAL_OPTIONS, ...PAGE_OPTIONS, ...RANGE_OPTIONS, ...EVENT_FILTERS.filter((key) => key !== "type" && key !== "eventType")], paginated: true }),
    tail: spec({ options: [...GLOBAL_OPTIONS, ...PAGE_OPTIONS, ...RANGE_OPTIONS, ...EVENT_FILTERS.filter((key) => key !== "type" && key !== "eventType"), "follow", "pollIntervalMs"], paginated: true })
  }),
  issues: resource("error_groups", {
    list: spec({ options: [...GLOBAL_OPTIONS, ...PAGE_OPTIONS, "status", "assigned", "assignee", "sort", "query", "introducedToday"], paginated: true }),
    show: spec({ positional: ["group-id"], options: [...GLOBAL_OPTIONS, "relatedLogs"] }),
    export: spec({ positional: ["group-id"], options: [...GLOBAL_OPTIONS, "includeOccurrences"] }),
    context: spec({ positional: ["group-id"], options: [...GLOBAL_OPTIONS, "tokenBudget"] })
  }),
  transactions: resource("events", {
    list: spec({ options: [...GLOBAL_OPTIONS, ...PAGE_OPTIONS, ...RANGE_OPTIONS, ...EVENT_FILTERS.filter((key) => key !== "type" && key !== "eventType")], paginated: true })
  }),
  traces: resource("traces", {
    list: spec({ options: [...GLOBAL_OPTIONS, ...PAGE_OPTIONS, ...RANGE_OPTIONS, "environment", "release", "service", "operation", "query", "status", "minDurationMs"], paginated: true }),
    show: spec({ positional: ["trace-id"], options: [...GLOBAL_OPTIONS, ...RANGE_OPTIONS] })
  }),
  monitors: resource("monitors", {
    list: spec({ options: [...GLOBAL_OPTIONS, ...PAGE_OPTIONS, "environment", "status", "query"], paginated: true }),
    show: spec({ positional: ["monitor-uuid"], options: GLOBAL_OPTIONS })
  }),
  deployments: resource("deployments", {
    list: spec({ options: [...GLOBAL_OPTIONS, ...PAGE_OPTIONS, ...RANGE_OPTIONS, "repository", "environment", "source", "release", "query"], paginated: true }),
    show: spec({ positional: ["deployment-uuid"], options: GLOBAL_OPTIONS })
  }),
  insights: resource("insights", {
    summary: spec({ options: [...GLOBAL_OPTIONS, "window", "metrics", "environment", "release", "attributes"] })
  }, "summary"),
  metrics: resource("metrics", {
    catalog: spec({ options: [...GLOBAL_OPTIONS, "window"] }),
    query: spec({ positional: ["metric"], options: [...GLOBAL_OPTIONS, "window", "environment", "release", "attributes"] })
  })
});

export function validateInvocation(parsed) {
  const commandSpec = COMMAND_SPECS[parsed.command];
  if (!commandSpec) return null;

  const { subcommand, positionals } = resolveSubcommand(parsed.command, parsed.args, commandSpec);
  const subcommandSpec = commandSpec.subcommands[subcommand];
  if (!subcommandSpec) usageError(`Unknown ${parsed.command} subcommand: ${parsed.args[0]}`);

  const expectedPositionals = subcommandSpec.positional;
  if (positionals.length < expectedPositionals.length) {
    usageError(`Missing ${expectedPositionals[positionals.length]} for ${parsed.command}${subcommand === "default" ? "" : ` ${subcommand}`}.`);
  }
  if (positionals.length > expectedPositionals.length) {
    usageError(`Unexpected argument for ${parsed.command}${subcommand === "default" ? "" : ` ${subcommand}`}: ${positionals[expectedPositionals.length]}`);
  }

  const allowed = new Set([...subcommandSpec.options, "help"]);
  for (const key of Object.keys(parsed.options)) {
    if (!allowed.has(key)) usageError(`Option --${kebabCase(key)} is not valid for ${parsed.command}${subcommand === "default" ? "" : ` ${subcommand}`}.`);
  }

  validateCommonValues(parsed.options);
  validateCommandValues(parsed.command, subcommand, parsed.options);
  validatePositionalValues(parsed.command, subcommand, positionals);

  return {
    ...subcommandSpec,
    command: parsed.command,
    subcommand,
    id: positionals[0],
    feature: commandSpec.feature
  };
}

export function optionDefinition(name) {
  return OPTION_DEFINITIONS[`--${name}`];
}

function command({ defaultSubcommand, subcommands, feature = null }) {
  return { defaultSubcommand, subcommands, feature };
}

function resource(feature, subcommands, defaultSubcommand = "list") {
  return command({ feature, defaultSubcommand, subcommands });
}

function spec({ positional = [], options = GLOBAL_OPTIONS, paginated = false } = {}) {
  return { positional, options: [...new Set(options)], paginated };
}

function valueOption(key) {
  return { key, kind: "value", repeatable: false };
}

function repeatableOption(key) {
  return { key, kind: "value", repeatable: true };
}

function booleanOption(key, value = true) {
  return { key, kind: "boolean", value, repeatable: false };
}

function resolveSubcommand(commandName, args, commandSpec) {
  if (commandSpec.defaultSubcommand === "default") {
    return { subcommand: "default", positionals: args };
  }

  if (args.length === 0) return { subcommand: commandSpec.defaultSubcommand, positionals: [] };
  const candidate = args[0];
  if (!commandSpec.subcommands[candidate]) usageError(`Unknown ${commandName} subcommand: ${candidate}`);
  return { subcommand: candidate, positionals: args.slice(1) };
}

function validateCommonValues(options) {
  if (options.format && !["table", "json", "ndjson", "markdown"].includes(options.format)) {
    usageError(`Invalid format '${options.format}'. Expected table, json, ndjson, or markdown.`);
  }

  integerOption(options, "limit", { min: 1, max: 100 });
  integerOption(options, "retries", { min: 0, max: 5 });
  integerOption(options, "timeoutMs", { min: 100, max: 120_000 });
  integerOption(options, "pollIntervalMs", { min: 250, max: 60_000 });
  integerOption(options, "tokenBudget", { min: 1, max: 100_000 });
  numericOption(options, "minDurationMs", { min: 0, max: 86_400_000 });

  if (options.cursor && String(options.cursor).length > 8192) usageError("--cursor must not exceed 8192 characters.");
  if (options.since && !validSince(options.since)) usageError(`Invalid --since value '${options.since}'. Use an ISO-8601 timestamp or a duration such as 30m, 24h, 7d, or 2w.`);
  if (options.until && !validTimestamp(options.until)) usageError(`Invalid --until value '${options.until}'. Use an ISO-8601 timestamp.`);

  const attributeKeys = new Set();
  if ((options.attributes || []).length > 6) usageError("--attribute may be specified at most 6 times.");
  for (const attribute of options.attributes || []) {
    const match = /^([a-z][a-z0-9_.:-]{0,63})=([^\u0000-\u001F\u007F]{1,80})$/.exec(attribute);
    if (!match) usageError(`Invalid --attribute value '${attribute}'. Expected key=value with a supported key and value up to 80 characters.`);
    if (attributeKeys.has(match[1])) usageError(`--attribute key '${match[1]}' may only be specified once.`);
    attributeKeys.add(match[1]);
  }
  if ((options.metrics || []).length > 8) usageError("--metric may be specified at most 8 times.");
  const metricNames = new Set();
  for (const metric of options.metrics || []) {
    if (!validMetricName(metric)) usageError(`Invalid --metric value '${metric}'.`);
    if (metricNames.has(metric)) usageError(`--metric '${metric}' may only be specified once.`);
    metricNames.add(metric);
  }
  stringOption(options, "query", 200);
  stringOption(options, "project", 255);
  stringOption(options, "profile", 100);
  stringOption(options, "token", 8192);
  stringOption(options, "environment", 100);
  stringOption(options, "sort", 100);
  for (const key of ["release", "service", "operation", "repository", "assignee", "traceId", "requestId"]) stringOption(options, key, 200);
}

function validateCommandValues(commandName, subcommand, options) {
  if (options.window && !["1h", "6h", "24h", "7d"].includes(options.window)) {
    usageError(`Invalid --window value '${options.window}'. Expected 1h, 6h, 24h, or 7d.`);
  }

  if (commandName === "issues" && subcommand === "list" && options.status) {
    enumList(options.status, "status", ["unresolved", "resolved", "ignored", "archived", "all"]);
  }
  if (commandName === "issues" && subcommand === "list" && options.status && options.introducedToday) {
    usageError("Use either --status or --introduced-today, not both.");
  }
  if (commandName === "issues" && subcommand === "list" && options.assigned && options.assignee) {
    usageError("Use either --assigned or --assignee, not both.");
  }
  if (commandName === "traces" && options.status) enumList(options.status, "status", ["unset", "ok", "error", "all"]);
  if (commandName === "monitors" && options.status) enumList(options.status, "status", ["ok", "error", "missed", "paused", "all"]);
  if (commandName === "deployments" && options.source) enumList(options.source, "source", ["api", "telemetry", "manual"]);
  if (["events", "logs", "transactions"].includes(commandName) && options.level) {
    enumList(options.level, "level", ["trace", "debug", "info", "notice", "warn", "warning", "error", "fatal", "critical"]);
  }
  if (commandName === "events" && options.type) enumList(options.type, "type", ["error", "metric", "transaction", "log", "check_in", "all"]);
  if (commandName === "events" && options.eventType) enumList(options.eventType, "event-type", ["error", "metric", "transaction", "log", "check_in", "all"]);
  if (options.type && options.eventType) usageError("Use either --type or --event-type, not both.");
  if (options.assigned) enumList(options.assigned, "assigned", ["me", "any", "unassigned"]);
  if (options.assignee && !["all", "me", "unassigned", "any"].includes(options.assignee) && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(options.assignee)) {
    usageError("--assignee must be all, me, unassigned, any, or a user UUID.");
  }
  if (["events", "logs", "transactions"].includes(commandName) && options.status && !eventStatusList(options.status)) {
    usageError(`Invalid --status value '${options.status}'. Use a status name, an HTTP status code, or a comma-separated list.`);
  }
  if (options.follow && options.all) usageError("--follow cannot be combined with --all.");
  if (options.follow && options.cursor) usageError("--follow cannot be combined with --cursor; the server provides its own polling high-water cursor.");
  if (options.follow && options.format && options.format !== "ndjson") {
    usageError("--follow supports only --format ndjson so every polled event remains a valid streaming record.");
  }
  if (commandName === "auth" && subcommand === "login" && options.token && options.tokenStdin) usageError("Use either --token or --token-stdin, not both.");
  if (commandName === "update" && options.check && options.apply) usageError("Use either --check or --apply, not both.");
  if (["insights", "metrics"].includes(commandName)) {
    stringOption(options, "environment", 80);
    stringOption(options, "release", 80);
  }
}

function validatePositionalValues(commandName, subcommand, positionals) {
  for (const value of positionals) {
    if (value.length > 512 || /[\u0000-\u001F\u007F]/.test(value)) usageError("Identifiers must be at most 512 printable characters.");
  }
  if (commandName === "metrics" && subcommand === "query" && !validMetricName(positionals[0])) {
    usageError(`Invalid metric name '${positionals[0]}'.`);
  }
  if (commandName === "traces" && subcommand === "show" && !/^[A-Za-z0-9._:-]{1,128}$/.test(positionals[0])) {
    usageError("Trace IDs must use 1 to 128 letters, numbers, dots, underscores, colons, or hyphens.");
  }
  if (requiresUuid(commandName, subcommand) && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(positionals[0])) {
    usageError(`${commandName} ${subcommand} requires a UUID identifier.`);
  }
}

function requiresUuid(commandName, subcommand) {
  if (["events", "monitors", "deployments"].includes(commandName)) return subcommand === "show";
  return commandName === "issues" && ["show", "export", "context"].includes(subcommand);
}

function integerOption(options, key, { min, max }) {
  if (options[key] === undefined) return;
  if (!/^\d+$/.test(String(options[key]))) usageError(`--${kebabCase(key)} must be an integer.`);
  const value = Number(options[key]);
  if (value < min || value > max) usageError(`--${kebabCase(key)} must be between ${min} and ${max}.`);
}

function numericOption(options, key, { min, max = Number.POSITIVE_INFINITY }) {
  if (options[key] === undefined) return;
  const value = Number(options[key]);
  if (!Number.isFinite(value) || value < min || value > max) usageError(`--${kebabCase(key)} must be a number between ${min} and ${max}.`);
}

function enumList(value, label, allowed) {
  const values = String(value).split(",");
  const invalid = values.find((item) => !allowed.includes(item));
  if (invalid) usageError(`Invalid --${label} value '${invalid}'. Expected one of: ${allowed.join(", ")}.`);
}

function validSince(value) {
  const duration = /^(\d+)(m|h|d|w)$/.exec(String(value));
  if (duration) {
    const maximum = { m: 129_600, h: 2_160, d: 90, w: 12 }[duration[2]];
    return Number(duration[1]) >= 1 && Number(duration[1]) <= maximum;
  }
  return validTimestamp(value);
}

function validTimestamp(value) {
  const text = String(value);
  return /^\d{4}-\d{2}-\d{2}T/.test(text) && Number.isFinite(Date.parse(text));
}

function eventStatusList(value) {
  return String(value).split(",").every((item) => {
    if (/^[1-5]\d{2}$/.test(item)) return true;
    return /^[A-Za-z][A-Za-z0-9_.:/-]{0,99}$/.test(item);
  });
}

function stringOption(options, key, max) {
  if (options[key] === undefined) return;
  const value = String(options[key]);
  if (value.length === 0 || value.length > max || /[\u0000-\u001F\u007F]/.test(value)) {
    usageError(`--${kebabCase(key)} must be between 1 and ${max} printable characters.`);
  }
}

function validMetricName(value) {
  return typeof value === "string" && value.length >= 1 && value.length <= 200 && !/[\u0000-\u001F\u007F]/.test(value);
}

function usageError(message) {
  const error = new Error(message);
  error.exitCode = 2;
  throw error;
}

function kebabCase(key) {
  return key.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`);
}
