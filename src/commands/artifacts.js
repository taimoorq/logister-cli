import { openAsBlob } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { ensureFeature } from "../api/capabilities.js";

const ANDROID_MAX_BYTES = 20 * 1024 * 1024;
const IOS_MAX_BYTES = 500 * 1024 * 1024;

export async function runArtifactsCommand(context) {
  const { subcommand } = context.invocation;
  const options = context.parsed.options;
  const project = options.project || context.runtime.project;
  if (!project) usageError("Missing project. Pass --project <uuid-or-slug>, set LOGISTER_PROJECT, or save a project in your profile.");

  await ensureFeature(context, "mobile_artifacts");
  const upload = subcommand === "upload-android"
    ? await androidUpload(options)
    : await appleUpload(options);
  const path = `/api/v1/cli/projects/${encodeURIComponent(project)}/artifacts/${upload.endpoint}`;
  const payload = await context.client.upload(path, upload.form, { signal: context.signal });
  await context.write(payload, { format: options.format || "json" });
  return payload;
}

async function androidUpload(options) {
  requireOptions(options, ["file", "packageName", "versionCode"]);
  const file = await artifactFile(options.file, { extension: ".txt", maxBytes: ANDROID_MAX_BYTES, label: "R8 mapping" });
  const form = new FormData();
  appendValues(form, {
    package_name: options.packageName,
    version_name: options.versionName,
    version_code: options.versionCode,
    release: options.release
  });
  form.append("file", await openAsBlob(file.path, { type: "text/plain" }), file.name);
  return { endpoint: "android-mapping", form };
}

async function appleUpload(options) {
  requireOptions(options, ["file", "appIdentifier", "versionCode", "binaryUuid", "architecture"]);
  const file = await artifactFile(options.file, { extension: ".zip", maxBytes: IOS_MAX_BYTES, label: "dSYM archive" });
  const form = new FormData();
  appendValues(form, {
    app_identifier: options.appIdentifier,
    version_name: options.versionName,
    version_code: options.versionCode,
    release: options.release,
    binary_uuid: options.binaryUuid,
    architecture: options.architecture
  });
  form.append("file", await openAsBlob(file.path, { type: "application/zip" }), file.name);
  return { endpoint: "apple-dsym", form };
}

async function artifactFile(rawPath, { extension, maxBytes, label }) {
  const path = resolve(String(rawPath));
  let metadata;
  try {
    metadata = await stat(path);
  } catch (error) {
    usageError(`${label} file cannot be read: ${error.message}`);
  }
  if (!metadata.isFile()) usageError(`${label} path must be a regular file.`);
  if (metadata.size <= 0) usageError(`${label} file is empty.`);
  if (metadata.size > maxBytes) usageError(`${label} exceeds the ${Math.floor(maxBytes / 1024 / 1024)} MB limit.`);
  if (extname(path).toLowerCase() !== extension) usageError(`${label} must use the ${extension} extension.`);
  return { path, name: basename(path) };
}

function appendValues(form, values) {
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== "") form.append(key, String(value));
  }
}

function requireOptions(options, keys) {
  const missing = keys.find((key) => !options[key]);
  if (missing) usageError(`Missing --${missing.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`)}.`);
}

function usageError(message) {
  const error = new Error(message);
  error.exitCode = 2;
  throw error;
}
