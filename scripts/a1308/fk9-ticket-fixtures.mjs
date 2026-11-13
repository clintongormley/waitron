import ts from "typescript";
import { readFileSync, writeFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { dirname, relative } from "node:path";
import { parse, replaceNode, addNamedImport } from "./lib/fold-inserts.mjs";

export function rewriteTicketBills(source, path) {
  const tree = parse(source, path),
    edits = [],
    reports = [];
  let joined = false,
    flat = false;
  const report = (node, reason) =>
    reports.push(
      `${path}:${tree.getLineAndCharacterOfPosition(node.getStart()).line + 1}: ${reason}`,
    );
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      if (method === "values") {
        const insert = node.expression.expression;
        if (
          ts.isCallExpression(insert) &&
          ts.isPropertyAccessExpression(insert.expression) &&
          insert.expression.name.text === "insert" &&
          insert.arguments[0]?.getText() === "ticketItems"
        ) {
          const value = node.arguments[0];
          for (const row of value && ts.isArrayLiteralExpression(value)
            ? value.elements
            : [value]) {
            if (!row || !ts.isObjectLiteralExpression(row)) {
              report(node, "nonliteral ticket values");
              continue;
            }
            const kept = row.properties.filter(
              (property) => property.name?.getText() !== "workingOrderId",
            );
            if (kept.length !== row.properties.length)
              edits.push({ node: row, text: `{ ${kept.map((p) => p.getText()).join(", ")} }` });
          }
        }
      }
      if (["select", "selectDistinct"].includes(method)) {
        let query = node;
        while (
          ts.isPropertyAccessExpression(query.parent) &&
          ts.isCallExpression(query.parent.parent)
        )
          query = query.parent.parent;
        let text = query.getText();
        if (text.includes("ticketItems.workingOrderId")) {
          if (!text.includes(".from(ticketItems)")) report(query, "ticket query has another base");
          else {
            text = text.replaceAll(
              "ticketItems.workingOrderId",
              "workingOrderLines.workingOrderId",
            );
            if (!/\.(?:innerJoin|leftJoin)\(workingOrderLines\b/.test(text)) {
              text = text.replace(
                ".from(ticketItems)",
                ".from(ticketItems).innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))",
              );
              joined = true;
            }
            if (node.arguments.length === 0) {
              text = text.replace(
                `.${method}()`,
                `.${method}({ ...getTableColumns(ticketItems), workingOrderId: workingOrderLines.workingOrderId })`,
              );
              flat = true;
            }
            edits.push({ node: query, text });
            return;
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  let text = source;
  for (const edit of edits.sort((a, b) => b.node.getStart() - a.node.getStart()))
    text = replaceNode(text, edit.node, edit.text);
  if (joined) {
    let module = "@waitron/db";
    if (path.startsWith("packages/db/")) {
      module = relative(dirname(path), "packages/db/src/index.js");
      if (!module.startsWith(".")) module = "./" + module;
    }
    text = addNamedImport(addNamedImport(text, module, "workingOrderLines"), "drizzle-orm", "eq");
  }
  if (flat) text = addNamedImport(text, "drizzle-orm", "getTableColumns");
  if (text.includes("ticketItems.workingOrderId"))
    reports.push(`${path}: remaining ticket bill reference`);
  if (
    /\bticket_items\b[\s\S]*\bworking_order_id\b|\bworking_order_id\b[\s\S]*\bticket_items\b/.test(
      text,
    )
  )
    reports.push(`${path}: inspect raw SQL ticket bill references`);
  return { text, reports };
}
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const write = process.argv.includes("--write");
  for (const path of process.argv.slice(2).filter((arg) => arg !== "--write")) {
    if (path.endsWith("seed.madrid-baseline.test.ts")) continue;
    const source = readFileSync(path, "utf8"),
      result = rewriteTicketBills(source, path);
    for (const report of result.reports) console.log(report);
    if (result.text !== source) {
      if (write) writeFileSync(path, result.text);
      console.log(`${path}: ${write ? "rewritten" : "would rewrite"}`);
    }
  }
}
