#!/usr/bin/env node
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const sourceLabel = process.argv[2] || "../logister/docs/openapi.yaml";
const targetLabel = process.argv[3] || "contracts/logister-openapi.yaml";
const canonicalSource = process.argv[5]
  || process.env.LOGISTER_CONTRACT_SOURCE
  || "https://raw.githubusercontent.com/taimoorq/logister/main/docs/openapi.yaml";
const source = resolve(sourceLabel);
const target = resolve(targetLabel);
const lockFile = resolve(process.argv[4] || "contracts/logister-api.lock");

await mkdir(dirname(target), { recursive: true });
await copyFile(source, target);

const body = await readFile(target);
const sha256 = createHash("sha256").update(body).digest("hex");
await writeFile(lockFile, `source=${canonicalSource}\nfile=${targetLabel}\nsha256=${sha256}\n`, "utf8");

process.stdout.write(`Synced ${target}\nsha256=${sha256}\n`);
