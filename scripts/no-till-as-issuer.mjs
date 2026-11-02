import { readdirSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import ts from "typescript";

const historicalFiles = new Set([
  "docs/operations/a679-changed-checks.md",
  "docs/operations/a1154-changed-checks.md",
  "docs/developers/paper-custodian.md",
  "docs/compliance/verifactu-findings.md",
  "docs/compliance/asesor-questions.md",
  "docs/research/2026-07-20-pglite-throughput.md",
  "docs/research/2026-07-20-pglite-throughput-readme.md",
]);
const negativeSettingFiles = new Set([
  "apps/server/scripts/dev-setup.test.ts",
  "apps/server/src/boot.promote.test.ts",
  "apps/server/src/boot.setup-routes.test.ts",
  "apps/server/src/promote-endpoint-e2e.test.ts",
  "apps/server/src/restore.test.ts",
  "apps/server/src/restore-fiscal-e2e.test.ts",
  "apps/server/src/testing/stream-loop-scenario.ts",
  "apps/server/src/till-config.test.ts",
  "apps/server/src/trading-config.test.ts",
]);
const ignoredDirectories = new Set([
  ".git",
  ".superpowers",
  "node_modules",
  "dist",
  "coverage",
  ".vitest-reports",
  "test-results",
  "playwright-report",
  ".vite",
  "build",
]);
const textExtensions = /\.(?:[cm]?[jt]sx?|json|md|sh|ya?ml|txt|html|sql)$/;

export function sourceFilesIn(root, directory = "") {
  return readdirSync(join(root, directory), { withFileTypes: true })
    .flatMap((entry) => {
      const path = posix.join(directory, entry.name);
      if (entry.isDirectory())
        return ignoredDirectories.has(entry.name) ? [] : sourceFilesIn(root, path);
      return entry.isFile() && textExtensions.test(entry.name) ? [path] : [];
    })
    .sort();
}

export function inspectSource(path, source) {
  if (
    path.startsWith("docs/superpowers/") ||
    historicalFiles.has(path) ||
    /^(?:packages|apps)\/[^/]+\/drizzle\//.test(path)
  )
    return [];
  const failures = [];
  for (const pattern of [
    /\b(?:register|provision)(?:-|)till\b/gi,
    /\bre(?:-)register\b/g,
    /\bWAITRON_TILL_(?:SERIES|TILL|NODE|LOCATION)_ID\b/g,
    /\bWAITRON_(?:LOCATION)_ID\b/g,
  ]) {
    for (const match of `${path}\n${source}`.matchAll(pattern)) {
      if (/^WAITRON_TILL_(?:SERIES|TILL)_ID$/.test(match[0]) && negativeSettingFiles.has(path))
        continue;
      failures.push(`${path}: retired ${match[0]}`);
    }
  }
  if (/^packages\/fiscal(?:-[^/]+)?\/.*\.[cm]?[jt]sx?$/.test(path)) {
    const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
    const visit = (node) => {
      if ((ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) && /till/i.test(node.text))
        failures.push(`${path}: fiscal identifier ${node.text}`);
      ts.forEachChild(node, visit);
    };
    visit(tree);
  }
  return [...new Set(failures)];
}

export function scanTree(root) {
  return sourceFilesIn(root).flatMap((path) =>
    inspectSource(path, readFileSync(join(root, path), "utf8")),
  );
}

export function inspectTables(tables) {
  const owners = new Set(["invoice_series", "registro_sif", "cadenas"]);
  return tables.flatMap(({ name, columns, keys }) => {
    const failures = columns
      .filter((column) => /till/i.test(column))
      .map((column) => `${name}: fiscal till column ${column}`);
    if (owners.has(name)) {
      if (!columns.includes("node_id")) failures.push(`${name}: missing node_id`);
      else if (!keys.some((key) => key.includes("node_id")))
        failures.push(`${name}: missing node ownership key`);
      if (keys.some((key) => key.some((column) => /device/i.test(column))))
        failures.push(`${name}: device ownership key`);
    }
    return failures;
  });
}
