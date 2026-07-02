const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export function normalizeVersion(version) {
  const value = String(version || "").trim();
  return value.startsWith("v") ? value.slice(1) : value;
}

export function isValidVersion(version, options = {}) {
  const value = options.allowVPrefix === false
    ? String(version || "").trim()
    : normalizeVersion(version);

  return SEMVER_PATTERN.test(value);
}

export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);

  for (const key of ["major", "minor", "patch"]) {
    if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1;
  }

  return comparePrerelease(a.prerelease, b.prerelease);
}

export function isNewerVersion(candidate, current) {
  if (!isValidVersion(candidate) || !isValidVersion(current)) return null;
  return compareVersions(candidate, current) > 0;
}

function parseVersion(version) {
  const value = normalizeVersion(version);
  const match = SEMVER_PATTERN.exec(value);
  if (!match) throw new Error(`Invalid SemVer version: ${version}`);

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split(".") : []
  };
}

function comparePrerelease(left, right) {
  if (left.length === 0 && right.length === 0) return 0;
  if (left.length === 0) return 1;
  if (right.length === 0) return -1;

  const max = Math.max(left.length, right.length);
  for (let index = 0; index < max; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    if (a === b) continue;

    const aNumeric = isNumericIdentifier(a);
    const bNumeric = isNumericIdentifier(b);
    if (aNumeric && bNumeric) return Number(a) > Number(b) ? 1 : -1;
    if (aNumeric) return -1;
    if (bNumeric) return 1;
    return a > b ? 1 : -1;
  }

  return 0;
}

function isNumericIdentifier(value) {
  return /^\d+$/.test(value);
}
