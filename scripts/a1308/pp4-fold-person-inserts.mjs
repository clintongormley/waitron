import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { addNamedImport } from "./lib/fold-inserts.mjs";

export function rewrite(text, path) {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  if (source.parseDiagnostics.length) throw new Error(`${path}: cannot parse TypeScript`);
  const persons = new Set(),
    namespaces = new Set();
  for (const node of source.statements.filter(ts.isImportDeclaration)) {
    const module = node.moduleSpecifier.text;
    if (
      !["@waitron/db", "@waitron/db/schema/identity.js", "@waitron/identity"].includes(module) &&
      !module.startsWith(".")
    )
      continue;
    const bindings = node.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const item of bindings.elements)
        if ((item.propertyName ?? item.name).text === "persons") persons.add(item.name.text);
    } else if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
  }
  const edits = [],
    helpers = new Set();
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      const receiver = node.expression.expression;
      if (
        ["values", "set"].includes(method) &&
        ts.isCallExpression(receiver) &&
        ts.isPropertyAccessExpression(receiver.expression) &&
        receiver.expression.name.text === (method === "values" ? "insert" : "update")
      ) {
        const table = receiver.arguments[0];
        const matches =
          table &&
          ((ts.isIdentifier(table) && persons.has(table.text)) ||
            (ts.isPropertyAccessExpression(table) &&
              table.name.text === "persons" &&
              ts.isIdentifier(table.expression) &&
              namespaces.has(table.expression.text)));
        if (matches) {
          const arg = node.arguments[0],
            helper = method === "values" ? "withFoldedPersonKeys" : "withFoldedPersonChanges";
          if (node.arguments.length !== 1 || ts.isSpreadElement(arg))
            throw new Error(`${path}: cannot wrap person ${method} argument`);
          if (!(
            ts.isCallExpression(arg) &&
            ts.isIdentifier(arg.expression) &&
            arg.expression.text === helper
          )) {
            edits.push([arg.getStart(source), `${helper}(`], [arg.end, ")"]);
            helpers.add(helper);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  for (const [at, value] of edits.sort((a, b) => b[0] - a[0]))
    text = text.slice(0, at) + value + text.slice(at);
  for (const helper of helpers) text = addNamedImport(text, "@waitron/db", helper);
  return text;
}

export function run({ root = process.cwd(), write = false } = {}) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  const files = execFileSync("git", ["ls-files", "-z", "--", "apps", "packages", "scripts"], {
    cwd: root,
    env,
    encoding: "utf8",
  }).split("\0");
  const changes = [];
  for (const path of files) {
    if (
      !path.endsWith(".ts") ||
      path.includes("/drizzle/") ||
      path === "packages/db/src/schema/identity/fold.ts"
    )
      continue;
    const text = readFileSync(join(root, path), "utf8");
    if (!text.includes("persons")) continue;
    const next = rewrite(text, path);
    if (next !== text) changes.push({ path, text: next });
  }
  if (write) for (const change of changes) writeFileSync(join(root, change.path), change.text);
  return changes.map(({ path }) => path);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  for (const path of run({ write: process.argv.includes("--write") }))
    process.stdout.write(`${path}\n`);
