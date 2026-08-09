const RESOURCE_COLUMNS = Object.freeze({
  projects: ["uuid", "name", "slug", "integration_kind", "archived", "updated_at"],
  events: ["uuid", "event_type", "level", "message", "environment", "release", "occurred_at"],
  logs: ["uuid", "level", "message", "environment", "release", "occurred_at", "trace_id"],
  issues: ["uuid", "status", "severity", "title", "occurrence_count", "last_seen_at", "assigned_to.name"],
  transactions: ["uuid", "transaction_name", "status", "duration_ms", "environment", "release", "occurred_at"],
  traces: ["trace_id", "name", "service", "operation", "status", "duration_ms", "started_at"],
  monitors: ["uuid", "slug", "environment", "status", "expected_interval_seconds", "last_check_in_at", "last_error_at"],
  deployments: ["uuid", "repository_full_name", "environment", "release", "short_commit_sha", "source", "deployed_at"],
  metrics: ["key", "label", "unit", "kind", "source", "category", "events"],
  insights: ["window", "generated_at", "analytics.source", "analytics.partial"]
});

export function columnsFor(resource) {
  return RESOURCE_COLUMNS[resource];
}
