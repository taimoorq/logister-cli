const RESOURCE_ENDPOINTS = {
  projects: {
    list: () => ["/api/v1/cli/projects", {}],
    show: ({ id }) => [`/api/v1/cli/projects/${encodeURIComponent(id)}`, {}]
  },
  overview: {
    default: ({ options, runtime }) => [`/api/v1/cli/projects/${encodeURIComponent(projectId(options, runtime))}/summary`, query(options)]
  },
  events: {
    list: ({ options, runtime }) => [`/api/v1/cli/projects/${encodeURIComponent(projectId(options, runtime))}/events`, query(options)],
    show: ({ id, options, runtime }) => [`/api/v1/cli/projects/${encodeURIComponent(projectId(options, runtime))}/events/${encodeURIComponent(id)}`, query(options)],
    tail: ({ options, runtime }) => [`/api/v1/cli/projects/${encodeURIComponent(projectId(options, runtime))}/events`, { ...query(options), follow: options.follow || true }]
  },
  logs: {
    list: ({ options, runtime }) => [`/api/v1/cli/projects/${encodeURIComponent(projectId(options, runtime))}/events`, { ...query(options), type: "log" }],
    tail: ({ options, runtime }) => [`/api/v1/cli/projects/${encodeURIComponent(projectId(options, runtime))}/events`, { ...query(options), type: "log", follow: options.follow || true }]
  },
  issues: {
    list: ({ options, runtime }) => [`/api/v1/cli/projects/${encodeURIComponent(projectId(options, runtime))}/error_groups`, query(options)],
    show: ({ id, options, runtime }) => [`/api/v1/cli/projects/${encodeURIComponent(projectId(options, runtime))}/error_groups/${encodeURIComponent(id)}`, query(options)],
    export: ({ id, options, runtime }) => [`/api/v1/cli/projects/${encodeURIComponent(projectId(options, runtime))}/error_groups/${encodeURIComponent(id)}/export`, query(options)],
    context: ({ id, options, runtime }) => [`/api/v1/cli/projects/${encodeURIComponent(projectId(options, runtime))}/error_groups/${encodeURIComponent(id)}/context`, { ...query(options), for_ai: options.forAi || true }]
  },
  transactions: {
    list: ({ options, runtime }) => [`/api/v1/cli/projects/${encodeURIComponent(projectId(options, runtime))}/events`, { ...query(options), type: "transaction" }]
  },
  traces: {
    list: ({ options, runtime }) => [`/api/v1/cli/projects/${encodeURIComponent(projectId(options, runtime))}/traces`, query(options)],
    show: ({ id, options, runtime }) => [`/api/v1/cli/projects/${encodeURIComponent(projectId(options, runtime))}/traces/${encodeURIComponent(id)}`, query(options)]
  },
  monitors: {
    list: ({ options, runtime }) => [`/api/v1/cli/projects/${encodeURIComponent(projectId(options, runtime))}/monitors`, query(options)],
    show: ({ id, options, runtime }) => [`/api/v1/cli/projects/${encodeURIComponent(projectId(options, runtime))}/monitors/${encodeURIComponent(id)}`, query(options)]
  },
  deployments: {
    list: ({ options, runtime }) => [`/api/v1/cli/projects/${encodeURIComponent(projectId(options, runtime))}/deployments`, query(options)],
    show: ({ id, options, runtime }) => [`/api/v1/cli/projects/${encodeURIComponent(projectId(options, runtime))}/deployments/${encodeURIComponent(id)}`, query(options)]
  },
  insights: {
    summary: ({ options, runtime }) => [`/api/v1/cli/projects/${encodeURIComponent(projectId(options, runtime))}/insights`, query(options)]
  },
  metrics: {
    catalog: ({ options, runtime }) => [`/api/v1/cli/projects/${encodeURIComponent(projectId(options, runtime))}/metrics/catalog`, query(options)],
    query: ({ id, options, runtime }) => [`/api/v1/cli/projects/${encodeURIComponent(projectId(options, runtime))}/metrics/query`, { ...query(options), metric: id }]
  }
};

export async function runResourceCommand(resource, args, context) {
  const subcommand = normalizedSubcommand(resource, args[0]);
  const id = needsId(resource, subcommand) ? args[1] : args[0] === subcommand ? args[1] : args[0];
  const handlers = RESOURCE_ENDPOINTS[resource] || {};
  const handler = handlers[subcommand] || handlers.default;
  if (!handler) {
    const error = new Error(`Unknown ${resource} subcommand: ${subcommand}`);
    error.exitCode = 2;
    throw error;
  }

  await ensureServerFeature(resource, subcommand, context);

  if (needsProject(resource) && !projectId(context.parsed.options, context.runtime)) {
    const error = new Error(`Missing project. Pass --project <uuid-or-slug>, set LOGISTER_PROJECT, or save a project in your profile.`);
    error.exitCode = 2;
    throw error;
  }
  if (needsId(resource, subcommand) && !id) {
    const error = new Error(`Missing identifier for ${resource} ${subcommand}.`);
    error.exitCode = 2;
    throw error;
  }

  const [path, params] = handler({
    id,
    options: context.parsed.options,
    runtime: context.runtime
  });
  const payload = await context.client.get(path, params);
  context.write(payload, {
    format: context.parsed.options.format || defaultFormat(resource, subcommand),
    redact: !context.parsed.options.raw && context.parsed.options.redact
  });
}

function normalizedSubcommand(resource, firstArg) {
  if (resource === "overview") return "default";
  if (!firstArg || firstArg.startsWith("-")) {
    if (resource === "projects") return "list";
    if (resource === "insights") return "summary";
    return "list";
  }
  const known = Object.keys(RESOURCE_ENDPOINTS[resource] || {});
  return known.includes(firstArg) ? firstArg : "show";
}

function needsProject(resource) {
  return resource !== "projects";
}

function needsId(resource, subcommand) {
  return ["show", "export", "context", "query"].includes(subcommand) && !(resource === "projects" && subcommand === "list");
}

function projectId(options, runtime) {
  return options.project || runtime.project;
}

function defaultFormat(resource, subcommand) {
  if (resource === "issues" && ["export", "context"].includes(subcommand)) return "json";
  return "table";
}

function query(options) {
  return {
    type: options.type,
    event_type: options.eventType,
    level: options.level,
    status: options.status,
    assigned: options.assigned,
    assignee: options.assignee,
    environment: options.env || options.environment,
    release: options.release,
    since: options.since,
    until: options.until,
    limit: options.limit,
    q: options.query || options.q,
    trace_id: options.traceId,
    request_id: options.requestId,
    min_duration_ms: options.minDurationMs,
    window: options.window,
    include_occurrences: options.includeOccurrences,
    related_logs: options.relatedLogs,
    token_budget: options.tokenBudget
  };
}

async function ensureServerFeature(resource, subcommand, context) {
  const feature = featureFor(resource, subcommand);
  if (!feature) return;

  const capabilities = await context.client.capabilities();
  if (capabilities?.features?.[feature]) return;

  const error = new Error([
    `This Logister server does not support CLI feature '${feature}' yet.`,
    `Server version: ${capabilities?.server_version || "unknown"}`,
    `Recommended CLI version: ${capabilities?.recommended_cli_version || "unknown"}`,
    "Run `logister doctor` for the full server capability map."
  ].join("\n"));
  error.exitCode = 4;
  throw error;
}

function featureFor(resource, subcommand) {
  if (resource === "overview") return "project_summary";
  if (resource === "logs") return "logs";
  if (resource === "issues" && subcommand === "context") return "ai_context_bundles";
  if (resource === "issues") return "error_groups";
  if (resource === "transactions") return "events";

  return {
    projects: "projects",
    events: "events",
    traces: "traces",
    monitors: "monitors",
    deployments: "deployments",
    insights: "insights",
    metrics: "metrics"
  }[resource];
}
