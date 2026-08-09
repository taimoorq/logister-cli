#!/usr/bin/env node
import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isValidVersion } from "../src/version/semver.js";

const REGISTRY_ORIGIN = "https://registry.npmjs.org";
const MAX_METADATA_BYTES = 512 * 1024;
const MAX_TARBALL_BYTES = 32 * 1024 * 1024;

export async function inspectNpmReleaseState({
  version,
  tarball,
  checksumFile,
  distTag,
  requirePublished = false,
  fetchImpl = globalThis.fetch,
  registryOrigin = REGISTRY_ORIGIN
}) {
  if (!isValidVersion(version, { allowVPrefix: false })) throw new Error(`Invalid release version: ${version}`);
  if (!/^[a-z][a-z0-9._-]{0,31}$/.test(distTag || "")) throw new Error(`Invalid npm dist-tag: ${distTag || "(empty)"}`);
  const tarballPath = resolve(tarball);
  const filename = basename(tarballPath);
  if (filename !== `logister-cli-${version}.tgz`) throw new Error(`Expected exact release tarball logister-cli-${version}.tgz, got ${filename}`);
  const localHash = await sha256File(tarballPath);
  const expectedHash = parseExactChecksum(await readFile(resolve(checksumFile), "utf8"), filename);
  if (localHash !== expectedHash) throw new Error(`Local tarball SHA256 ${localHash} does not match checksums.txt ${expectedHash}`);

  const registry = new URL(registryOrigin);
  const metadataUrl = new URL(`/logister-cli/${encodeURIComponent(version)}`, registry);
  const metadataResponse = await fetchBounded(metadataUrl, fetchImpl, MAX_METADATA_BYTES, { allowNotFound: true });
  if (metadataResponse.notFound) {
    if (requirePublished) throw new Error(`logister-cli@${version} is not published yet`);
    return { publishRequired: true, sha256: localHash, version, distTag };
  }
  const metadata = parseJsonObject(metadataResponse.body, "npm version metadata");
  if (metadata.version !== version) throw new Error(`npm metadata version mismatch: expected ${version}, got ${metadata.version || "(missing)"}`);
  const remoteTarball = new URL(metadata.dist?.tarball || "");
  if (remoteTarball.protocol !== "https:" || remoteTarball.hostname !== registry.hostname) {
    throw new Error("npm metadata returned an unexpected tarball origin");
  }
  const remoteHash = await sha256Remote(remoteTarball, fetchImpl, MAX_TARBALL_BYTES);
  if (remoteHash !== localHash) {
    throw new Error(`Published npm tarball SHA256 mismatch: local=${localHash} npm=${remoteHash}`);
  }

  const tagsUrl = new URL("/-/package/logister-cli/dist-tags", registry);
  const tagsResponse = await fetchBounded(tagsUrl, fetchImpl, MAX_METADATA_BYTES);
  const tags = parseJsonObject(tagsResponse.body, "npm dist-tags");
  if (tags[distTag] !== version) {
    throw new Error(`npm ${distTag} points to ${tags[distTag] || "(missing)"}, expected ${version}`);
  }

  return { publishRequired: false, sha256: localHash, version, distTag };
}

export function parseExactChecksum(body, filename) {
  const lines = String(body).split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length !== 1) throw new Error("checksums.txt must contain exactly one non-empty checksum line");
  const match = /^([a-f0-9]{64})  ([^\r\n]+)$/.exec(lines[0]);
  if (!match || match[2] !== filename) {
    throw new Error(`checksums.txt must contain one lowercase SHA256 line for exact tarball ${filename}`);
  }
  return match[1];
}

async function sha256File(path) {
  const details = await stat(path);
  if (!details.isFile() || details.size > MAX_TARBALL_BYTES) throw new Error(`Local release tarball exceeds the ${MAX_TARBALL_BYTES}-byte limit`);
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function sha256Remote(url, fetchImpl, maximum) {
  return withTimedResponse(url, fetchImpl, {}, async (response, signal) => {
    if (!response.ok) throw new Error(`Failed to download published npm tarball: HTTP ${response.status}`);
    const declared = Number(response.headers?.get?.("content-length"));
    if (Number.isFinite(declared) && declared > maximum) throw new Error(`Published npm tarball exceeds the ${maximum}-byte limit`);
    if (!response.body) throw new Error("Published npm tarball response has no body");
    const reader = response.body.getReader();
    const hash = createHash("sha256");
    let size = 0;
    while (true) {
      const { done, value } = await readWithAbort(reader, signal);
      if (done) break;
      size += value.byteLength;
      if (size > maximum) {
        await reader.cancel("npm tarball too large").catch(() => {});
        throw new Error(`Published npm tarball exceeds the ${maximum}-byte limit`);
      }
      hash.update(value);
    }
    return hash.digest("hex");
  });
}

async function fetchBounded(url, fetchImpl, maximum, { allowNotFound = false } = {}) {
  return withTimedResponse(url, fetchImpl, { Accept: "application/json" }, async (response, signal) => {
    if (allowNotFound && response.status === 404) {
      await response.body?.cancel("not found").catch(() => {});
      return { notFound: true, body: "" };
    }
    if (!response.ok) throw new Error(`npm registry request failed with HTTP ${response.status}`);
    const contentType = response.headers?.get?.("content-type") || "";
    if (!/(?:application\/json|\+json)(?:\s*;|$)/i.test(contentType)) throw new Error(`npm registry returned unexpected content type '${contentType || "missing"}'`);
    const declared = Number(response.headers?.get?.("content-length"));
    if (Number.isFinite(declared) && declared > maximum) throw new Error(`npm registry metadata exceeds the ${maximum}-byte limit`);
    if (!response.body) return { notFound: false, body: "" };
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await readWithAbort(reader, signal);
      if (done) break;
      size += value.byteLength;
      if (size > maximum) {
        await reader.cancel("npm metadata too large").catch(() => {});
        throw new Error(`npm registry metadata exceeds the ${maximum}-byte limit`);
      }
      chunks.push(Buffer.from(value));
    }
    return { notFound: false, body: Buffer.concat(chunks, size).toString("utf8") };
  });
}

async function withTimedResponse(url, fetchImpl, headers, consume) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("timeout"), 10_000);
  try {
    const response = await fetchImpl(url, { headers, signal: controller.signal });
    return await consume(response, controller.signal);
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`npm registry request timed out: ${url.pathname}`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function readWithAbort(reader, signal) {
  if (signal.aborted) return Promise.reject(new Error("npm registry request aborted"));
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      Promise.resolve(reader.cancel("npm registry request aborted")).catch(() => {});
      reject(new Error("npm registry request aborted"));
    };
    signal.addEventListener("abort", abort, { once: true });
    reader.read().then(
      (result) => { signal.removeEventListener("abort", abort); resolve(result); },
      (error) => { signal.removeEventListener("abort", abort); reject(error); }
    );
    if (signal.aborted) abort();
  });
}

function parseJsonObject(body, label) {
  let value;
  try { value = JSON.parse(body); } catch { throw new Error(`${label} returned malformed JSON`); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be a JSON object`);
  return value;
}

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const result = await inspectNpmReleaseState({
    version: valueAfter(args, "--version"),
    tarball: valueAfter(args, "--tarball"),
    checksumFile: valueAfter(args, "--checksum-file"),
    distTag: valueAfter(args, "--dist-tag"),
    requirePublished: args.includes("--require-published")
  });
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `publish_required=${result.publishRequired}\nsha256=${result.sha256}\n`, "utf8");
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
