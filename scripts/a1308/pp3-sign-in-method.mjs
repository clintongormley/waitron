import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export function run({ root = process.cwd(), write = false } = {}) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")),
  );
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: root, env, encoding: "utf8" }).split(
    "\0",
  );
  const changes = [];
  for (const path of files) {
    if (!/\.ts$/.test(path) || !/\.test\.ts$|\/(?:test|src\/testing)\//.test(path)) continue;
    const text = readFileSync(join(root, path), "utf8");
    if (!text.includes("startManagementSession")) continue;
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
    const edits = [];
    function visit(node) {
      if (
        ts.isCallExpression(node) &&
        ((ts.isIdentifier(node.expression) && node.expression.text === "startManagementSession") ||
          (ts.isPropertyAccessExpression(node.expression) &&
            node.expression.name.text === "startManagementSession"))
      ) {
        const input = node.arguments[1];
        if (!input || !ts.isObjectLiteralExpression(input)) {
          const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
          throw new Error(`${path}:${line}: startManagementSession requires an object literal`);
        }
        if (!input.properties.some((p) => p.name && p.name.getText(source) === "method"))
          edits.push([input.getStart(source) + 1, ' method: "password",']);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    let next = text;
    for (const [at, value] of edits.sort((a, b) => b[0] - a[0]))
      next = next.slice(0, at) + value + next.slice(at);
    if (next !== text) changes.push({ path, text: next });
  }
  if (write) for (const change of changes) writeFileSync(join(root, change.path), change.text);
  return changes.map(({ path }) => path);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  for (const path of run({ write: process.argv.includes("--write") }))
    process.stdout.write(`${path}\n`);
