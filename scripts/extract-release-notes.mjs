#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function extractReleaseNotes(changelog, tag) {
  const lines = String(changelog).split(/\r?\n/);
  const heading = `## ${tag}`;
  const start = lines.findIndex((line) => line === heading || line.startsWith(`${heading} `) || line.startsWith(`${heading} -`));
  if (start < 0) return `Release ${tag}\n`;
  const notes = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index].startsWith("## ")) break;
    notes.push(lines[index]);
  }
  const body = notes.join("\n").trim();
  return body ? `${body}\n` : `Release ${tag}\n`;
}

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function main() {
  const args = process.argv.slice(2);
  const tag = valueAfter(args, "--tag");
  const output = valueAfter(args, "--output");
  if (!tag || !output) throw new Error("Usage: extract-release-notes.mjs --tag <vX.Y.Z> --output <path>");
  const changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
  writeFileSync(output, extractReleaseNotes(changelog, tag), "utf8");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
