import { readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path/posix";
import ts from "typescript";

export const parse = (source, path) =>
  ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
export const replaceNode = (text, node, replacement) =>
  text.slice(0, node.getStart()) + replacement + text.slice(node.end);
function walk(node, visit) {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}
export function addNamedImport(text, moduleName, name) {
  const imports = parse(text, "imports.ts").statements.filter(ts.isImportDeclaration);
  if (
    imports.some(
      (node) =>
        node.importClause?.name?.text === name ||
        (node.importClause?.namedBindings &&
          ts.isNamedImports(node.importClause.namedBindings) &&
          node.importClause.namedBindings.elements.some((item) => item.name.text === name)),
    )
  )
    return text;
  const statement = imports.find(
    (node) =>
      node.moduleSpecifier.text === moduleName &&
      !node.importClause?.isTypeOnly &&
      node.importClause?.namedBindings &&
      ts.isNamedImports(node.importClause.namedBindings),
  );
  if (statement) {
    const bindings = statement.importClause.namedBindings;
    return replaceNode(
      text,
      bindings,
      `{ ${[...bindings.elements.map((item) => item.getText()), name].join(", ")} }`,
    );
  }
  return `import { ${name} } from ${JSON.stringify(moduleName)};\n${text}`;
}
export function removeUnusedImport(text, name) {
  const tree = parse(text, "imports.ts");
  let used = false;
  walk(tree, (node) => {
    if (ts.isImportDeclaration(node)) return;
    if (
      ts.isIdentifier(node) &&
      node.text === name &&
      !ts.isImportSpecifier(node.parent) &&
      !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)
    )
      used = true;
  });
  if (used) return text;
  for (const statement of tree.statements.filter(ts.isImportDeclaration)) {
    const clause = statement.importClause,
      bindings = clause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    const kept = bindings.elements.filter((item) => item.name.text !== name);
    if (kept.length === bindings.elements.length) continue;
    if (kept.length)
      return replaceNode(text, bindings, `{ ${kept.map((item) => item.getText()).join(", ")} }`);
    if (clause.name) return replaceNode(text, clause, clause.name.getText());
    const end = statement.end + (text[statement.end] === "\n" ? 1 : 0);
    return text.slice(0, statement.getStart()) + text.slice(end);
  }
  return text;
}
function pairs(properties) {
  return properties.map((property) => {
    if (ts.isShorthandPropertyAssignment(property))
      return [property.name.text, property.name.getText()];
    if (ts.isPropertyAssignment(property) && !ts.isComputedPropertyName(property.name))
      return [property.name.text, property.initializer.getText()];
    return null;
  });
}
function mapped(values, key, fields, constants = {}) {
  if (
    values.some((value) => !value) ||
    !values.some(([name]) => name === key) ||
    values.some(([name]) => name !== key && !Object.hasOwn(fields, name))
  )
    return null;
  return {
    key: values.find(([name]) => name === key)[1],
    fields: [
      ...values
        .filter(([name]) => name !== key && fields[name] !== null)
        .map(([name, value]) => [fields[name], value]),
      ...Object.entries(constants),
    ],
  };
}
function splitValues(text) {
  const values = [];
  let start = 0,
    quote = "",
    braces = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote && text[i - 1] !== "\\") quote = "";
    } else if (c === "'" || c === '"') quote = c;
    else if (c === "{") braces++;
    else if (c === "}") braces--;
    else if (c === "," && braces === 0) {
      values.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  values.push(text.slice(start).trim());
  return values;
}
function fixturePath(path) {
  return (
    !/(^|\/)packages\/db\/src\/schema\//.test(path) &&
    (path.endsWith(".test.ts") || path.includes("/src/testing/") || path.includes("/test/"))
  );
}
function statementFor(call) {
  const value = ts.isAwaitExpression(call.parent) ? call.parent : call;
  return ts.isExpressionStatement(value.parent) ? value.parent : null;
}
const deletable = (statement) =>
  statement && (ts.isBlock(statement.parent) || ts.isSourceFile(statement.parent));
export function foldInserts(source, path, rules) {
  if (!fixturePath(path)) return { text: source, reports: [] };
  const localPath = relative(process.cwd(), resolve(path));
  const tree = parse(source, path),
    edits = [],
    reports = [],
    folded = new Set();
  const typeImports = tree.statements
    .filter(ts.isImportDeclaration)
    .flatMap(({ importClause: clause }) =>
      clause?.namedBindings && ts.isNamedImports(clause.namedBindings)
        ? clause.namedBindings.elements
            .filter((item) => clause.isTypeOnly || item.isTypeOnly)
            .map((item) => item.name.text)
        : [],
    );
  const report = (node, reason) =>
    reports.push(
      `${path}:${tree.getLineAndCharacterOfPosition(node.getStart()).line + 1}: ${reason}`,
    );
  walk(tree, (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "values"
    ) {
      const insert = node.expression.expression;
      if (
        !ts.isCallExpression(insert) ||
        !ts.isPropertyAccessExpression(insert.expression) ||
        insert.expression.name.text !== "insert"
      )
        return;
      const rule = rules.find((rule) => rule.child === insert.arguments[0]?.getText());
      if (!rule) return;
      let outer = node;
      while (
        ts.isPropertyAccessExpression(outer.parent) &&
        ts.isCallExpression(outer.parent.parent)
      ) {
        const method = outer.parent.name.text;
        if (!["onConflictDoNothing", "onConflictDoUpdate"].includes(method))
          return report(node, `${method} chain must be adapted by hand`);
        outer = outer.parent.parent;
      }
      const statement = statementFor(outer);
      if (!statement) return report(node, "insert result is used");
      const value = node.arguments[0];
      const data =
        value && ts.isObjectLiteralExpression(value)
          ? mapped(pairs(value.properties), rule.key, rule.fields, rule.constants)
          : null;
      if (!data) return report(node, "unsupported insert values");
      if (data.fields.length && [rule.parent, "eq"].some((name) => typeImports.includes(name)))
        return report(node, "type-only import requires a manual edit");
      const database = insert.expression.expression.getText();
      let replacement = "";
      if (data.fields.length) {
        replacement = `${database}.update(${rule.parent}).set({ ${data.fields.map(([key, value]) => `${key}: ${value}`).join(", ")} }).where(eq(${rule.parent}.${rule.parentKey ?? "id"}, ${data.key}))`;
        folded.add(rule);
      } else {
        if (!deletable(statement)) return report(node, "empty insert is conditional");
        outer = statement;
      }
      edits.push({ node: outer, replacement });
      folded.add({ child: rule.child });
    }
    if (!ts.isTaggedTemplateExpression(node) || node.tag.getText() !== "sql") return;
    const text = node.template.getText().slice(1, -1);
    for (const rule of rules.filter((rule) => rule.raw)) {
      const raw = rule.raw;
      if (!new RegExp(`\\b${raw.childTable}\\b`, "i").test(text)) continue;
      const match = text.match(
        new RegExp(
          `^\\s*insert\\s+into\\s+${raw.childTable}\\s*\\(([^()]*)\\)\\s*values\\s*\\(([^()]*)\\)\\s*;?\\s*$`,
          "i",
        ),
      );
      if (!match) {
        report(node, "unsupported raw SQL");
        continue;
      }
      const columns = splitValues(match[1]),
        values = splitValues(match[2]);
      const data =
        columns.length === values.length
          ? mapped(
              columns.map((key, i) => [key, values[i]]),
              raw.key,
              raw.columns,
              raw.constants,
            )
          : null;
      if (!data) {
        report(node, "unsupported raw SQL columns or values");
        continue;
      }
      const call = node.parent;
      const statement =
        ts.isCallExpression(call) &&
        call.arguments.length === 1 &&
        ts.isPropertyAccessExpression(call.expression) &&
        ["execute", "run"].includes(call.expression.name.text)
          ? statementFor(call)
          : null;
      if (!statement) {
        report(node, "SQL result is used or the execution call is unknown");
        continue;
      }
      let outer = node,
        replacement;
      if (data.fields.length)
        replacement = `sql\`update ${raw.parentTable} set ${data.fields.map(([key, value]) => `${key} = ${value}`).join(", ")} where ${raw.parentKey ?? "id"} = ${data.key}\``;
      else {
        outer = statement;
        if (!deletable(outer)) {
          report(node, "empty SQL result is used or conditional");
          continue;
        }
        replacement = "";
      }
      edits.push({ node: outer, replacement });
    }
  });
  let text = source;
  for (const edit of edits.sort((a, b) => b.node.getStart() - a.node.getStart()))
    text = replaceNode(text, edit.node, edit.replacement);
  for (const rule of folded) {
    if (rule.parent) {
      let moduleName = "@waitron/db";
      if (localPath.startsWith("packages/db/")) {
        moduleName = relative(dirname(localPath), "packages/db/src/index.js");
        if (!moduleName.startsWith(".")) moduleName = "./" + moduleName;
      }
      text = addNamedImport(addNamedImport(text, moduleName, rule.parent), "drizzle-orm", "eq");
    }
    text = removeUnusedImport(text, rule.child);
  }
  return { text, reports };
}

export async function runFoldCli(rules, extra) {
  const args = process.argv.slice(2),
    write = args.includes("--write");
  for (const path of args.filter((arg) => arg !== "--write")) {
    if (!fixturePath(path)) continue;
    const source = readFileSync(path, "utf8"),
      result = foldInserts(source, path, rules);
    if (extra) {
      const next = extra(result.text, path);
      result.text = next.text;
      result.reports.push(...next.reports);
    }
    for (const line of result.reports) console.log(line);
    if (source !== result.text) {
      if (write) writeFileSync(path, result.text);
      console.log(`${path}: ${write ? "rewritten" : "would rewrite"}`);
    }
  }
}
