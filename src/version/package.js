import { readFileSync } from "node:fs";

const packageJson = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8")
);

export const packageInfo = {
  name: packageJson.name,
  version: packageJson.version,
  repository: packageJson.repository?.url || "https://github.com/taimoorq/logister-cli.git"
};
