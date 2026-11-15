import ts from "typescript";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { dirname, relative } from "node:path";
import {
  parse,
  replaceNode,
  addNamedImport,
  removeUnusedImport,
  runFoldCli,
} from "./lib/fold-inserts.mjs";

export function receiptFixtures(source, path) {
  const tree = parse(source, path),
    edits = [];
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "values"
    ) {
      const insert = node.expression.expression;
      if (
        ts.isCallExpression(insert) &&
        ts.isPropertyAccessExpression(insert.expression) &&
        insert.expression.name.text === "insert" &&
        insert.arguments[0]?.getText() === "departmentReceipts"
      ) {
        let outer = node;
        while (
          ts.isPropertyAccessExpression(outer.parent) &&
          ts.isCallExpression(outer.parent.parent) &&
          ["onConflictDoUpdate", "onConflictDoNothing"].includes(outer.parent.name.text)
        )
          outer = outer.parent.parent;
        const awaited = ts.isAwaitExpression(outer.parent) ? outer.parent : outer;
        const value = node.arguments[0];
        if (
          ts.isExpressionStatement(awaited.parent) &&
          value &&
          ts.isObjectLiteralExpression(value)
        ) {
          const fields = value.properties.map((prop) =>
            ts.isShorthandPropertyAssignment(prop)
              ? [prop.name.text, prop.name.text]
              : ts.isPropertyAssignment(prop) && !ts.isComputedPropertyName(prop.name)
                ? [prop.name.text, prop.initializer.getText()]
                : null,
          );
          const values = new Map(fields.filter(Boolean));
          if (
            fields.every(Boolean) &&
            values.has("departmentId") &&
            values.has("receipt") &&
            fields.every(([key]) =>
              ["departmentId", "receipt", "logoRasters", "updatedAt"].includes(key),
            )
          ) {
            const args = [
              insert.expression.expression.getText(),
              values.get("departmentId"),
              values.get("receipt"),
              ...(values.has("logoRasters") ? [values.get("logoRasters")] : []),
            ];
            edits.push({ node: awaited, text: `await seedDepartmentReceipt(${args.join(", ")})` });
            return;
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  let text = source;
  for (const edit of edits.sort((a, b) => b.node.getStart() - a.node.getStart()))
    text = replaceNode(text, edit.node, edit.text);
  if (edits.length) {
    let module = "@waitron/db/testing/seed.js";
    if (path.startsWith("packages/db/")) {
      module = relative(dirname(path), "packages/db/src/testing/seed.js");
      if (!module.startsWith(".")) module = "./" + module;
    }
    text = addNamedImport(
      removeUnusedImport(text, "departmentReceipts"),
      module,
      "seedDepartmentReceipt",
    );
  }
  const reports = [];
  const rewritten = parse(text, path);
  function report(node) {
    if (
      (ts.isIdentifier(node) &&
        node.text === "departmentReceipts" &&
        !ts.isImportSpecifier(node.parent)) ||
      (ts.isTaggedTemplateExpression(node) &&
        /\bdepartment_receipts\b/.test(node.template.getText()))
    )
      reports.push(
        `${path}:${rewritten.getLineAndCharacterOfPosition(node.getStart()).line + 1}: department receipt requires a manual port`,
      );
    ts.forEachChild(node, report);
  }
  report(rewritten);
  return { text, reports };
}
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href)
  await runFoldCli([], receiptFixtures);
