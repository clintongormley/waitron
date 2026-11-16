import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, renameSync, writeFileSync } from "node:fs";

const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
);
const paths = execFileSync(
  "git",
  [
    "ls-files",
    "-z",
    "--",
    "apps",
    "packages",
    "scripts",
    "eslint.config.js",
    "docs/developers/conventions-data.md",
  ],
  { env, encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);
const rename = (text) =>
  text
    .replaceAll("scheduled_runs", "reconciliation_runs")
    .replaceAll("scheduledRuns", "reconciliationRuns")
    .replaceAll("scheduled-runs", "reconciliation-runs");
for (const path of paths) {
  if (
    path.includes("/drizzle/") ||
    path.startsWith("scripts/a1308/") ||
    path.startsWith("packages/country-es/test-fixtures/") ||
    path === "apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts" ||
    !existsSync(path) ||
    !lstatSync(path).isFile()
  )
    continue;
  const nextPath = rename(path);
  const text = readFileSync(path, "utf8");
  const next = rename(text);
  if (nextPath === path && next === text) continue;
  if (nextPath !== path) renameSync(path, nextPath);
  writeFileSync(nextPath, next);
  console.log(nextPath);
}
