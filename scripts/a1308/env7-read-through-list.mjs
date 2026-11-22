import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path/posix";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { addNamedImport, parse } from "./lib/fold-inserts.mjs";

const namePattern = /^WAITRON_[A-Z0-9_]*[A-Z0-9]$/;
const inventory = "packages/shared/src/environment-variables.js";

function isWrite(node) {
  const parent = node.parent;
  return (
    ts.isDeleteExpression(parent) ||
    (ts.isBinaryExpression(parent) &&
      parent.left === node &&
      parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment)
  );
}

function rewrite(path, original) {
  const source = parse(original, path);
  const edits = [];
  function visit(node) {
    const name = ts.isPropertyAccessExpression(node)
      ? node.name.text
      : ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression)
        ? node.argumentExpression.text
        : "";
    if (namePattern.test(name) && !isWrite(node)) {
      edits.push([
        node.getStart(source),
        node.end,
        `readVariable(${node.expression.getText(source)}, ${JSON.stringify(name)})`,
      ]);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (edits.length === 0) return original;
  let text = original;
  for (const [start, end, replacement] of edits.reverse()) {
    text = text.slice(0, start) + replacement + text.slice(end);
  }
  let module = "@waitron/shared";
  if (path.startsWith("packages/shared/")) {
    module = relative(dirname(path), inventory);
    if (!module.startsWith(".")) module = `./${module}`;
  }
  return addNamedImport(text, module, "readVariable");
}

export function run(root = process.cwd()) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  const files = execFileSync(
    "git",
    ["ls-files", "-z", "--", "apps/server/src", "apps/server/scripts", "packages"],
    { cwd: root, env, encoding: "utf8" },
  ).split("\0");
  const changed = new Map();
  for (const path of files) {
    if (
      !/^(?:apps\/server\/(?:src|scripts)|packages\/[^/]+\/src)\/.*\.ts$/.test(path) ||
      path.endsWith(".test.ts") ||
      /\/(?:test|testing)\//.test(path)
    )
      continue;
    const original = readFileSync(resolve(root, path), "utf8");
    if (!original.includes("WAITRON_")) continue;
    const text = rewrite(path, original);
    if (text === original) continue;
    const pkg = path.split("/").slice(0, 2).join("/");
    const manifest = JSON.parse(readFileSync(resolve(root, pkg, "package.json"), "utf8"));
    if (pkg !== "packages/shared" && !manifest.dependencies?.["@waitron/shared"]) {
      throw new Error(`${path}: ${pkg} has no @waitron/shared dependency`);
    }
    changed.set(path, text);
  }
  for (const [path, text] of changed) writeFileSync(resolve(root, path), text);
  return [...changed.keys()];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const path of run()) process.stdout.write(`${path}\n`);
}
