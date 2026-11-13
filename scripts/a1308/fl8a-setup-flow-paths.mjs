import ts from "typescript";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const paths = new Map([
  ["first-setup.json", "flows/setup/record.json"],
  ["first-setup-node-key.json", "flows/setup/node-key.json"],
  ["module-operation-public.json", "flows/setup/public-evidence.json"],
  ["fiscal-readiness.json", "flows/setup/readiness.json"],
  ["setup-operation.json", "flows/setup/operation.json"],
  ["first-fiscal-documents", "flows/setup/documents"],
  ["configuration-import.json", "flows/setup/import/marker.json"],
  ["configuration-import.artifact", "flows/setup/import/artifact"],
  ["configuration-import.key", "flows/setup/import/key"],
  ["first-setup-start-again-guesses.json", "flows/setup/start-again-guesses.json"],
]);
const helpers = new Set([
  "apps/server/test/start-again-deleted.ts",
  "apps/server/test/start-again-held-fixture.ts",
  "apps/server/test/stop-route-server.ts",
  "packages/provisioning/test/start-again-attempt.ts",
  "packages/provisioning/test/recovery-document-file.ts",
  "scripts/waitron-sh.test.mjs",
]);
const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter((file) => /^(apps|packages)\/.*\.test\.ts$/.test(file) || helpers.has(file));

for (const file of files) {
  const source = readFileSync(file, "utf8");
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const edits = [];
  const visit = (node) => {
    if (
      ts.isStringLiteralLike(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      const start = node.getStart(tree);
      const literal = source.slice(start, node.end);
      let value = literal;
      for (const [oldPath, newPath] of paths) {
        const escaped = oldPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        value = value.replace(
          new RegExp(`(["'\x60/])${escaped}(?=["'\x60/])`, "g"),
          `$1${newPath}`,
        );
      }
      if (value !== literal) edits.push({ start, end: node.end, value });
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  let changed = source;
  for (const { start, end, value } of edits.sort((a, b) => b.start - a.start))
    changed = changed.slice(0, start) + value + changed.slice(end);
  if (source !== changed) {
    writeFileSync(file, changed);
    process.stdout.write(`${file}\n`);
  }
}
