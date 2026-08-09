import { ensureFeature } from "../api/capabilities.js";
import { columnsFor } from "../output/presenters.js";
import { followEvents } from "./follow.js";
import { runPaginatedRequest } from "./pagination.js";
import { validateInvocation } from "./specs.js";

const RESOURCE_ENDPOINTS = {
  projects: {
    list: ({ options }) => ["/api/v1/cli/projects", compact({
      include_archived: options.includeArchived,
      limit: options.limit,
      cursor: options.cursor
    })],
    show: ({ id }) => [`/api/v1/cli/projects/${encoded(id)}`, {}]
  },
  overview: {
    default: ({ options, runtime }) => [projectPath(options, runtime, "summary"), compact({
      since: options.since,
      until: options.until
    })]
  },
  events: {
    list: ({ options, runtime }) => [projectPath(options, runtime, "events"), eventQuery(options)],
    show: ({ id, options, runtime }) => [`${projectPath(options, runtime, "events")}/${encoded(id)}`, {}],
    tail: ({ options, runtime }) => [projectPath(options, runtime, "events"), eventQuery(options)]
  },
  logs: {
    list: ({ options, runtime }) => [projectPath(options, runtime, "events"), { ...eventQuery(options), type: "log" }],
    tail: ({ options, runtime }) => [projectPath(options, runtime, "events"), { ...eventQuery(options), type: "log" }]
  },
  issues: {
    list: ({ options, runtime }) => [projectPath(options, runtime, "error_groups"), compact({
      status: options.status,
      assigned: options.assigned,
      assignee: options.assignee,
      sort: options.sort,
      q: options.query,
      introduced_today: options.introducedToday,
      limit: options.limit,
      cursor: options.cursor
    })],
    show: ({ id, options, runtime }) => [`${projectPath(options, runtime, "error_groups")}/${encoded(id)}`, compact({ related_logs: options.relatedLogs })],
    export: ({ id, options, runtime }) => [`${projectPath(options, runtime, "error_groups")}/${encoded(id)}/export`, compact({ include_occurrences: options.includeOccurrences })],
    context: ({ id, options, runtime }) => [`${projectPath(options, runtime, "error_groups")}/${encoded(id)}/context`, compact({ token_budget: options.tokenBudget })]
  },
  transactions: {
    list: ({ options, runtime }) => [projectPath(options, runtime, "events"), { ...eventQuery(options), type: "transaction" }]
  },
  traces: {
    list: ({ options, runtime }) => [projectPath(options, runtime, "traces"), compact({
      since: options.since,
      until: options.until,
      environment: options.environment,
      release: options.release,
      service: options.service,
      operation: options.operation,
      q: options.query,
      status: options.status,
      min_duration_ms: options.minDurationMs,
      limit: options.limit,
      cursor: options.cursor
    })],
    show: ({ id, options, runtime }) => [`${projectPath(options, runtime, "traces")}/${encoded(id)}`, compact({
      since: options.since,
      until: options.until
    })]
  },
  monitors: {
    list: ({ options, runtime }) => [projectPath(options, runtime, "monitors"), compact({
      environment: options.environment,
      status: options.status,
      q: options.query,
      limit: options.limit,
      cursor: options.cursor
    })],
    show: ({ id, options, runtime }) => [`${projectPath(options, runtime, "monitors")}/${encoded(id)}`, {}]
  },
  deployments: {
    list: ({ options, runtime }) => [projectPath(options, runtime, "deployments"), compact({
      repository: options.repository,
      environment: options.environment,
      source: options.source,
      release: options.release,
      q: options.query,
      since: options.since,
      until: options.until,
      limit: options.limit,
      cursor: options.cursor
    })],
    show: ({ id, options, runtime }) => [`${projectPath(options, runtime, "deployments")}/${encoded(id)}`, {}]
  },
  insights: {
    summary: ({ options, runtime }) => [projectPath(options, runtime, "insights"), compact({
      window: options.window,
      metric: options.metrics,
      environment: options.environment,
      release: options.release,
      attribute: options.attributes
    })]
  },
  metrics: {
    catalog: ({ options, runtime }) => [projectPath(options, runtime, "metrics/catalog"), compact({ window: options.window })],
    query: ({ id, options, runtime }) => [projectPath(options, runtime, "metrics/query"), compact({
      metric: id,
      window: options.window,
      environment: options.environment,
      release: options.release,
      attribute: options.attributes
    })]
  }
};

export async function runResourceCommand(resource, args, context) {
  const invocation = context.invocation || validateInvocation({ command: resource, args, options: context.parsed.options });
  const { subcommand, id } = invocation;
  const options = context.parsed.options;

  if (needsProject(resource) && !projectIdentifier(options, context.runtime)) {
    usageError("Missing project. Pass --project <uuid-or-slug>, set LOGISTER_PROJECT, or save a project in your profile.");
  }

  await ensureFeature(context, featureFor(resource, subcommand));

  const handler = RESOURCE_ENDPOINTS[resource]?.[subcommand];
  if (!handler) usageError(`Unknown ${resource} subcommand: ${subcommand}`);
  const [path, query] = handler({ id, options, runtime: context.runtime });
  const columns = columnsFor(resource);

  if (["events", "logs"].includes(resource) && subcommand === "tail" && options.follow) {
    return followEvents({ path, query, context, columns });
  }
  if (invocation.paginated) return runPaginatedRequest({ path, query, context, columns });

  const payload = await context.client.get(path, query, { signal: context.signal });
  await context.write(payload, {
    format: options.format || defaultFormat(resource, subcommand),
    columns
  });
  return payload;
}

function eventQuery(options) {
  return compact({
    type: options.type || options.eventType,
    level: options.level,
    status: options.status,
    environment: options.environment,
    release: options.release,
    since: options.since,
    until: options.until,
    limit: options.limit,
    cursor: options.cursor,
    q: options.query,
    trace_id: options.traceId,
    request_id: options.requestId,
    min_duration_ms: options.minDurationMs,
    summary: true
  });
}

function needsProject(resource) {
  return resource !== "projects";
}

function projectIdentifier(options, runtime) {
  return options.project || runtime.project;
}

function projectPath(options, runtime, suffix) {
  return `/api/v1/cli/projects/${encoded(projectIdentifier(options, runtime))}/${suffix}`;
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

function defaultFormat(resource, subcommand) {
  if (resource === "issues" && ["export", "context"].includes(subcommand)) return "json";
  return "table";
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ""));
}

function encoded(value) {
  return encodeURIComponent(value);
}

function usageError(message) {
  const error = new Error(message);
  error.exitCode = 2;
  throw error;
}
