import { dirname, relative } from "node:path/posix";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { addNamedImport, parse, removeUnusedImport, runFoldCli } from "./lib/fold-inserts.mjs";

function walk(node, visit) {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}
function call(node, name) {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === name
  );
}

export function rewriteSeedZones(source, path) {
  const reports = [],
    edits = [];
  if (path.includes("packages/db/src/schema/")) return { text: source, reports };
  let moduleName = "@waitron/db/testing/seed.js";
  if (path.startsWith("packages/db/")) {
    moduleName = relative(dirname(path), "packages/db/src/testing/seed.js");
    if (!moduleName.startsWith(".")) moduleName = "./" + moduleName;
  }
  const tree = parse(source, path);
  let collision = false;
  walk(tree, (node) => {
    if (ts.isImportSpecifier(node) && node.name.text === "seedZone") {
      const clause = node.parent.parent;
      if (
        node.isTypeOnly ||
        clause.isTypeOnly ||
        node.propertyName ||
        clause.parent.moduleSpecifier.text !== moduleName
      )
        collision = true;
    }
    if (
      (ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node) || ts.isParameter(node)) &&
      node.name?.getText() === "seedZone"
    )
      collision = true;
  });
  const report = (node, reason) =>
    reports.push(
      `${path}:${tree.getLineAndCharacterOfPosition(node.getStart()).line + 1}: ${reason}`,
    );
  walk(tree, (node) => {
    if (
      ts.isTaggedTemplateExpression(node) &&
      node.tag.getText() === "sql" &&
      /insert\s+into\s+floor_zones\b/i.test(node.template.getText())
    )
      report(node, "raw zone insert");
    if (!call(node, "values")) return;
    const insert = node.expression.expression;
    if (!call(insert, "insert") || insert.arguments[0]?.getText() !== "floorZones") return;
    let statement = node;
    while (statement.parent && !ts.isStatement(statement)) statement = statement.parent;
    if (
      /\/\/ a1308-keep: bare zone insert\s*$/.test(
        source.slice(statement.getFullStart(), statement.getStart()),
      )
    )
      return;
    const values = node.arguments[0];
    if (
      collision ||
      !values ||
      !ts.isObjectLiteralExpression(values) ||
      values.properties.some(
        (p) =>
          !(
            (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) &&
            !ts.isComputedPropertyName(p.name) &&
            ["id", "name", "displayOrder", "active", "locationId"].includes(p.name.text)
          ),
      )
    ) {
      report(node, "zone insert needs a hand port");
      return;
    }
    let outer = node;
    if (ts.isPropertyAccessExpression(node.parent) && call(node.parent.parent, "returning"))
      outer = node.parent.parent;
    if (!ts.isAwaitExpression(outer.parent)) {
      report(node, "zone result or chained clause needs a hand port");
      return;
    }
    const awaitNode = outer.parent,
      declaration = awaitNode.parent;
    let binding;
    if (outer !== node) {
      if (
        !ts.isVariableDeclaration(declaration) ||
        !ts.isArrayBindingPattern(declaration.name) ||
        declaration.name.elements.length !== 1 ||
        !ts.isBindingElement(declaration.name.elements[0]) ||
        !ts.isIdentifier(declaration.name.elements[0].name)
      ) {
        report(node, "zone result binding needs a hand port");
        return;
      }
      binding = declaration.name.elements[0].name;
      const returned = outer.arguments[0];
      if (
        returned &&
        (!ts.isObjectLiteralExpression(returned) ||
          returned.properties.length !== 1 ||
          !ts.isPropertyAssignment(returned.properties[0]) ||
          returned.properties[0].name.getText() !== "id" ||
          returned.properties[0].initializer.getText() !== "floorZones.id")
      ) {
        report(node, "zone returning fields need a hand port");
        return;
      }
      const scope = statement.parent;
      let readsOther = false;
      walk(scope, (read) => {
        if (
          !ts.isIdentifier(read) ||
          read.text !== binding.text ||
          read === binding ||
          read.getStart() < statement.end
        )
          return;
        let value = read;
        while (ts.isNonNullExpression(value.parent) || ts.isParenthesizedExpression(value.parent))
          value = value.parent;
        if (
          !ts.isPropertyAccessExpression(value.parent) ||
          value.parent.expression !== value ||
          value.parent.name.text !== "id"
        )
          readsOther = true;
      });
      if (readsOther) {
        report(node, "zone result is read beyond id");
        return;
      }
    } else if (!ts.isExpressionStatement(declaration)) {
      report(node, "zone insert result is used");
      return;
    }
    const properties = values.properties.filter((p) => p.name.text !== "locationId");
    const input =
      properties.length === values.properties.length
        ? values.getText()
        : `{ ${properties.map((p) => p.getText()).join(", ")} }`;
    edits.push({
      start: outer.getStart(),
      end: outer.end,
      text: `seedZone(${insert.expression.expression.getText()}, ${input})`,
    });
    if (binding)
      edits.push({
        start: declaration.name.getStart(),
        end: declaration.name.end,
        text: binding.text,
      });
  });
  let text = source;
  for (const edit of edits.sort((a, b) => b.start - a.start))
    text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
  if (edits.length) {
    text = removeUnusedImport(addNamedImport(text, moduleName, "seedZone"), "floorZones");
  }
  return { text, reports };
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href)
  await runFoldCli([], rewriteSeedZones);
