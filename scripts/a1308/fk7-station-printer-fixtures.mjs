import ts from "typescript";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  addNamedImport,
  parse,
  removeUnusedImport,
  replaceNode,
  runFoldCli,
} from "./lib/fold-inserts.mjs";

export function foldStationPrinters(source, path) {
  const tree = parse(source, path),
    edits = [],
    handled = new Set(),
    reports = [];
  const walk = (node, visit) => {
    visit(node);
    ts.forEachChild(node, (child) => walk(child, visit));
  };
  walk(tree, (node) => {
    if (
      !ts.isCallExpression(node) ||
      !ts.isPropertyAccessExpression(node.expression) ||
      node.expression.name.text !== "values"
    )
      return;
    const insert = node.expression.expression;
    if (
      !ts.isCallExpression(insert) ||
      !ts.isPropertyAccessExpression(insert.expression) ||
      insert.expression.name.text !== "insert" ||
      insert.arguments[0]?.getText() !== "stationPrinters"
    )
      return;
    const outer = ts.isAwaitExpression(node.parent) ? node.parent : node;
    if (!ts.isExpressionStatement(outer.parent)) return;
    const values = node.arguments[0];
    const rows =
      values && ts.isObjectLiteralExpression(values)
        ? [values]
        : values && ts.isArrayLiteralExpression(values)
          ? [...values.elements]
          : [];
    if (!rows.length || rows.some((row) => !ts.isObjectLiteralExpression(row))) return;
    const pairs = rows.map((row) => {
      const fields = new Map(
        row.properties.map((prop) =>
          ts.isShorthandPropertyAssignment(prop)
            ? [prop.name.text, prop.name.text]
            : ts.isPropertyAssignment(prop)
              ? [prop.name.getText(), prop.initializer.getText()]
              : [null, null],
        ),
      );
      return fields.size === 2 && fields.has("stationId") && fields.has("printerId")
        ? fields
        : null;
    });
    if (pairs.some((pair) => !pair)) return;
    const receiver = insert.expression.expression.getText();
    edits.push({
      node: outer.parent,
      text: pairs
        .map(
          (pair) =>
            `await attachStationPrinterForTest(${receiver}, ${pair.get("stationId")}, ${pair.get("printerId")});`,
        )
        .join("\n"),
    });
    handled.add(insert.arguments[0]);
  });
  walk(tree, (node) => {
    if (
      ts.isIdentifier(node) &&
      node.text === "stationPrinters" &&
      !handled.has(node) &&
      !ts.isImportSpecifier(node.parent)
    )
      reports.push(
        `${path}:${tree.getLineAndCharacterOfPosition(node.getStart()).line + 1}: stationPrinters requires a manual port`,
      );
  });
  let text = source;
  for (const edit of edits.sort((a, b) => b.node.getStart() - a.node.getStart()))
    text = replaceNode(text, edit.node, edit.text);
  if (edits.length)
    text = addNamedImport(
      removeUnusedImport(text, "stationPrinters"),
      "@waitron/db/testing/seed.js",
      "attachStationPrinterForTest",
    );
  return { text, reports };
}
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href)
  await runFoldCli([], foldStationPrinters);
