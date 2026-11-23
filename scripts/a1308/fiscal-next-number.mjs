import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

function walk(node, visit) {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

function method(node, name) {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === name
  );
}

function isSeries(node, names) {
  return node && ts.isIdentifier(node) && names.has(node.text);
}

function seriesInsert(node, names) {
  if (!method(node, "values")) return false;
  const insert = node.expression.expression;
  return method(insert, "insert") && isSeries(insert.arguments[0], names);
}

function dropProperty(edit, property, object) {
  const i = object.properties.indexOf(property);
  const following = object.properties[i + 1];
  const preceding = object.properties[i - 1];
  if (following) edit(property.getStart(), following.getStart(), "");
  else if (preceding) edit(preceding.end, property.end, "");
  else edit(property.getStart(), object.properties.end, "");
}

function sourceLocations(ast, bindings) {
  const seriesNames = new Set(["invoiceSeries"]);
  let dbImport;
  for (const statement of ast.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const imports = statement.importClause?.namedBindings;
    if (!imports || !ts.isNamedImports(imports)) continue;
    if (statement.moduleSpecifier.text === "@waitron/db" && !statement.importClause.isTypeOnly) {
      dbImport = imports;
    }
    for (const { name, propertyName } of imports.elements) {
      bindings.add(name.text);
      if (propertyName?.text === "invoiceSeries") seriesNames.add(name.text);
    }
  }
  walk(ast, (node) => {
    if (!ts.isVariableDeclaration(node) || !node.initializer || !ts.isIdentifier(node.name)) return;
    const initializer = node.initializer;
    if (
      ts.isCallExpression(initializer) &&
      initializer.expression.getText() === "alias" &&
      isSeries(initializer.arguments[0], seriesNames)
    ) {
      seriesNames.add(node.name.text);
    }
  });
  return { seriesNames, dbImport };
}

export function rewriteSource(file, input) {
  const ast = ts.createSourceFile(file, input, ts.ScriptTarget.Latest, true);
  const bindings = new Set();
  const { seriesNames, dbImport } = sourceLocations(ast, bindings);
  const patches = [];
  const edit = (start, end, text) => patches.push({ start, end, text });
  const manual = new Set();
  const refused = new Set();
  const line = (node) => ast.getLineAndCharacterOfPosition(node.getStart()).line + 1;
  let rewrittenRead = false;

  walk(ast, (node) => {
    if (
      ts.isPropertyAccessExpression(node) &&
      isSeries(node.expression, seriesNames) &&
      node.name.text === "nextNumber"
    ) {
      const property = node.parent;
      const object = property.parent;
      if (
        ts.isPropertyAssignment(property) &&
        property.initializer === node &&
        ts.isObjectLiteralExpression(object) &&
        method(object.parent, "select")
      ) {
        edit(node.getStart(), node.end, "nextInvoiceNumberOf(" + node.expression.text + ".id)");
        rewrittenRead = true;
      } else {
        manual.add(line(node));
      }
    }

    if (seriesInsert(node, seriesNames)) {
      const [first] = node.arguments;
      const rows = first && ts.isArrayLiteralExpression(first) ? first.elements : [first];
      for (const row of rows) {
        if (!row || !ts.isObjectLiteralExpression(row)) {
          if (row?.getText().includes("nextNumber")) manual.add(line(row));
          continue;
        }
        for (const property of row.properties) {
          if (!property.name || property.name.getText() !== "nextNumber") continue;
          if (ts.isPropertyAssignment(property) && property.initializer.getText() === "1") {
            dropProperty(edit, property, row);
          } else {
            manual.add(line(property));
          }
        }
      }
    }

    if (
      ts.isTaggedTemplateExpression(node) &&
      node.tag.getText() === "sql" &&
      ts.isTemplateExpression(node.template) &&
      /\bselect\b[\s\S]*\bfrom\s+(?:sales\b|"sales"|\$\{\s*sales\s*\})/i.test(
        node.template.getText(),
      )
    ) {
      for (const { expression } of node.template.templateSpans) {
        if (
          ts.isPropertyAccessExpression(expression) &&
          isSeries(expression.expression, seriesNames)
        ) {
          refused.add(line(expression));
        }
      }
    }
  });

  if (rewrittenRead && !bindings.has("nextInvoiceNumberOf")) {
    if (dbImport?.elements.length) {
      const last = dbImport.elements.at(-1);
      edit(last.end, last.end, ", nextInvoiceNumberOf");
    } else {
      edit(0, 0, 'import { nextInvoiceNumberOf } from "@waitron/db";\n');
    }
  }
  let text = input;
  for (const patch of patches.sort((a, b) => b.start - a.start)) {
    text = text.slice(0, patch.start) + patch.text + text.slice(patch.end);
  }
  return { text, manual: [...manual], refused: [...refused] };
}

function main() {
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const check = process.argv.includes("--check");
  const files = execFileSync("git", ["ls-files", "-z", "--", "apps", "packages"], {
    cwd: root,
    encoding: "utf8",
  }).split("\0");
  for (const file of files) {
    if (!file.endsWith(".ts")) continue;
    const path = resolve(root, file);
    const input = readFileSync(path, "utf8");
    if (!/invoiceSeries|invoice_series/.test(input)) continue;
    const { text, manual, refused } = rewriteSource(file, input);
    for (const line of manual)
      console.log(file + ":" + line + ": series counter needs a hand edit");
    for (const line of refused) {
      console.error(
        file + ":" + line + ": qualify the outer series column with nextInvoiceNumberOf",
      );
      process.exitCode = 1;
    }
    if (text === input) continue;
    if (check) {
      console.error(file + ": series counter references need rewriting");
      process.exitCode = 1;
    } else if (!refused.length) {
      writeFileSync(path, text);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
