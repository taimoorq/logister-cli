#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { verifyCanonicalSource, verifyCliOperations, verifyContractVersion, verifyArtifactSecurity } from "./contract-check-lib.mjs";

const sourceLabel = process.argv[2] || "../logister/docs/openapi.yaml";
const targetLabel = process.argv[3] || "contracts/logister-openapi.yaml";
const canonicalSource = process.argv[5]
  || process.env.LOGISTER_CONTRACT_SOURCE
  || (await readFile("contracts/logister-api.lock", "utf8")).match(/^source=(.+)$/m)?.[1];
const source = resolve(sourceLabel);
const target = resolve(targetLabel);
const lockFile = resolve(process.argv[4] || "contracts/logister-api.lock");

const body = await readFile(source);
verifyCanonicalSource(canonicalSource);
verifyContractVersion(body.toString(), "3.6");
verifyCliOperations(body.toString());
verifyArtifactSecurity(body.toString());
const sha256 = createHash("sha256").update(body).digest("hex");
// Verify provenance before writing either reviewed file.
const upstream = await fetch(canonicalSource, { signal: AbortSignal.timeout(30_000), redirect: "error" });
if (!upstream.ok) throw new Error(`Canonical contract lookup failed: HTTP ${upstream.status}`);
const upstreamSha = createHash("sha256").update(Buffer.from(await upstream.arrayBuffer())).digest("hex");
if (sha256 !== upstreamSha) throw new Error("Local contract bytes do not match the pinned upstream commit");
await mkdir(dirname(target), { recursive: true });
await writeFile(target, body);
await writeFile(lockFile, `source=${canonicalSource}\nfile=${targetLabel}\napi_line=3.6\nsha256=${sha256}\n`, "utf8");

process.stdout.write(`Synced ${target}\nsha256=${sha256}\n`);
