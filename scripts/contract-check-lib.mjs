export const EXPECTED_CLI_OPERATIONS = Object.freeze([
  ["/api/v1/cli/capabilities", "get", "getCliCapabilities"],
  ["/api/v1/cli/device_authorizations", "post", "createCliDeviceAuthorization"],
  ["/api/v1/cli/device_authorizations/token", "post", "exchangeCliDeviceAuthorization"],
  ["/api/v1/cli/session", "get", "getCliSession"],
  ["/api/v1/cli/projects", "get", "listCliProjects"],
  ["/api/v1/cli/projects/{project_uuid}", "get", "getCliProject"],
  ["/api/v1/cli/projects/{project_uuid}/summary", "get", "getCliProjectSummary"],
  ["/api/v1/cli/projects/{project_uuid}/events", "get", "listCliEvents"],
  ["/api/v1/cli/projects/{project_uuid}/events/{uuid}", "get", "getCliEvent"],
  ["/api/v1/cli/projects/{project_uuid}/error_groups", "get", "listCliErrorGroups"],
  ["/api/v1/cli/projects/{project_uuid}/error_groups/{uuid}", "get", "getCliErrorGroup"],
  ["/api/v1/cli/projects/{project_uuid}/error_groups/{uuid}/export", "get", "exportCliErrorGroup"],
  ["/api/v1/cli/projects/{project_uuid}/error_groups/{uuid}/context", "get", "getCliErrorGroupAiContext"],
  ["/api/v1/cli/projects/{project_uuid}/traces", "get", "listCliTraces"],
  ["/api/v1/cli/projects/{project_uuid}/traces/{trace_id}", "get", "getCliTrace"],
  ["/api/v1/cli/projects/{project_uuid}/monitors", "get", "listCliMonitors"],
  ["/api/v1/cli/projects/{project_uuid}/monitors/{uuid}", "get", "getCliMonitor"],
  ["/api/v1/cli/projects/{project_uuid}/deployments", "get", "listCliDeployments"],
  ["/api/v1/cli/projects/{project_uuid}/deployments/{uuid}", "get", "getCliDeployment"],
  ["/api/v1/cli/projects/{project_uuid}/insights", "get", "getCliInsights"],
  ["/api/v1/cli/projects/{project_uuid}/metrics/catalog", "get", "getCliMetricCatalog"],
  ["/api/v1/cli/projects/{project_uuid}/metrics/query", "get", "queryCliMetric"]
]);

export function verifyCliOperations(contract, expected = EXPECTED_CLI_OPERATIONS) {
  const operations = parseOperations(contract);
  for (const [path, method, operationId] of expected) {
    const actual = operations.get(path)?.get(method);
    if (!actual) throw new Error(`contract is missing ${method.toUpperCase()} ${path}`);
    if (actual !== operationId) {
      throw new Error(`contract operationId mismatch for ${method.toUpperCase()} ${path}: expected ${operationId}, found ${actual}`);
    }
  }
}

export function parseOperations(contract) {
  const operations = new Map();
  let currentPath = null;
  let currentMethod = null;

  for (const line of contract.split(/\r?\n/)) {
    const pathMatch = /^  (\/[^:]*?(?:\{[^}]+\}[^:]*)?):\s*$/.exec(line);
    if (pathMatch) {
      currentPath = pathMatch[1];
      currentMethod = null;
      operations.set(currentPath, new Map());
      continue;
    }
    if (/^  \S/.test(line)) {
      currentPath = null;
      currentMethod = null;
      continue;
    }
    if (!currentPath) continue;

    const methodMatch = /^    (get|post|put|patch|delete|head|options|trace):\s*$/.exec(line);
    if (methodMatch) {
      currentMethod = methodMatch[1];
      continue;
    }
    const operationMatch = /^      operationId:\s*["']?([^"'\s]+)["']?\s*$/.exec(line);
    if (currentMethod && operationMatch) operations.get(currentPath).set(currentMethod, operationMatch[1]);
  }
  return operations;
}
