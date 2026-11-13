import ts from "typescript";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parse, replaceNode, runFoldCli } from "./lib/fold-inserts.mjs";

const rules = [
  {
    child: "ticketItemAllergies",
    parent: "ticketItems",
    key: "ticketItemId",
    fields: { originalBlock: "allergyOriginal", currentBlock: "allergyCurrent" },
    constants: { allergyFrozen: "true" },
  },
];

export function dropObsoleteFields(source, path) {
  const tree = parse(source, path),
    edits = [];
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "values"
    ) {
      const insert = node.expression.expression;
      if (
        ts.isCallExpression(insert) &&
        ts.isPropertyAccessExpression(insert.expression) &&
        insert.expression.name.text === "insert"
      ) {
        const table = insert.arguments[0]?.getText();
        const field =
          table === "ticketItems"
            ? "nodeId"
            : table === "routingCellPeriods"
              ? "departmentId"
              : null;
        const value = node.arguments[0];
        if (field && value)
          for (const row of ts.isArrayLiteralExpression(value) ? value.elements : [value]) {
            if (!ts.isObjectLiteralExpression(row)) continue;
            const kept = row.properties.filter((property) => property.name?.getText() !== field);
            if (kept.length !== row.properties.length)
              edits.push({
                node: row,
                text: `{ ${kept.map((property) => property.getText()).join(", ")} }`,
              });
          }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  let text = source;
  for (const edit of edits.sort((a, b) => b.node.getStart() - a.node.getStart()))
    text = replaceNode(text, edit.node, edit.text);
  return { text, reports: [] };
}
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.argv = process.argv.filter(
    (path) => !path.endsWith("apps/server/scripts/demo-seed/seed.madrid-baseline.test.ts"),
  );
  await runFoldCli(rules, dropObsoleteFields);
}
