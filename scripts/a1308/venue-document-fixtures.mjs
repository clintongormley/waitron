import { readFileSync, writeFileSync } from "node:fs";
import ts from "typescript";
import { isMainScript } from "../is-main-script.mjs";

const SEED_IMPORT = "@waitron/db/testing/seed.js";
function walk(node, visit) {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}
function apply(source, edits) {
  for (const edit of edits.sort((a, b) => b.start - a.start))
    source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  return source;
}
function key(node) {
  return node.name?.getText().replace(/^["']|["']$/g, "");
}
function properties(source, literal, keep) {
  return literal.properties
    .filter(keep)
    .map((p) => source.slice(p.getStart(), p.end))
    .join(", ");
}

export function transformSource(path, source, moves) {
  if (
    ["write-path.e2e.test.ts", "inmutabilidad.test.ts"].some((name) =>
      path.endsWith(`packages/fiscal-verifactu/src/${name}`),
    )
  )
    return { source, report: [`${path}: fiscal pair: never edited`] };
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const edits = [],
    report = [],
    helpers = new Set();
  let inserts = 0;
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
      insert.arguments[0]?.getText() !== "locations"
    )
      return;
    inserts++;
    const value = node.arguments[0];
    if (
      !value ||
      !ts.isObjectLiteralExpression(value) ||
      value.properties.some(
        (p) => ts.isSpreadAssignment(p) || (p.name && ts.isComputedPropertyName(p.name)),
      )
    ) {
      report.push(
        `${path}:${tree.getLineAndCharacterOfPosition(node.getStart()).line + 1}: values not edited`,
      );
      return;
    }
    let statement = node;
    while (!ts.isStatement(statement)) statement = statement.parent;
    if (!statement.getText().includes("await ") || !statement.parent.statements) {
      report.push(`${path}: statement not edited`);
      return;
    }
    const allMoved = new Set(moves.flatMap((move) => move.fields));
    for (let i = 0; i < value.properties.length; i++) {
      if (!allMoved.has(key(value.properties[i]))) continue;
      const first = i;
      while (i + 1 < value.properties.length && allMoved.has(key(value.properties[i + 1]))) i++;
      let start = value.properties[first].getStart(),
        end = value.properties[i].end;
      if (i + 1 < value.properties.length) end = source.indexOf(",", end) + 1;
      else if (first > 0) start = source.indexOf(",", value.properties[first - 1].end);
      else if (source[end] === ",") end++;
      edits.push({ start, end, text: "" });
    }
    if (inserts > 1) {
      report.push(`${path}: second insert stripped`);
      return;
    }
    const database = insert.expression.expression.getText();
    const siblings = statement.parent.statements;
    const index = siblings.indexOf(statement);
    let added = "",
      anchor = statement.end;
    const following = new Map();
    for (const next of siblings.slice(index + 1)) {
      let call = ts.isExpressionStatement(next) ? next.expression : undefined;
      if (call && ts.isAwaitExpression(call)) call = call.expression;
      if (
        !call ||
        !ts.isCallExpression(call) ||
        !moves.some((move) => move.helper === call.expression.getText()) ||
        call.arguments[0]?.getText() !== database
      )
        break;
      following.set(call.expression.getText(), call);
      anchor = next.end;
    }
    for (const move of moves) {
      helpers.add(move.helper);
      const moved = value.properties.filter((p) => move.fields.includes(key(p)));
      const call = following.get(move.helper);
      if (call && ts.isObjectLiteralExpression(call.arguments[1])) {
        const target = call.arguments[1];
        const existingKeys = new Set(target.properties.map(key));
        const extra = moved.filter((p) => !existingKeys.has(key(p))).map((p) => p.getText());
        if (extra.length)
          edits.push({
            start: target.getStart(),
            end: target.end,
            text: `{ ${[properties(source, target, () => true), ...extra].filter(Boolean).join(", ")} }`,
          });
      } else {
        added += `\nawait ${move.helper}(${database}, { ${moved.map((p) => p.getText()).join(", ")} });`;
      }
    }
    if (added) edits.push({ start: anchor, end: anchor, text: added });
  });
  if (helpers.size) {
    const declaration = tree.statements.find(
      (s) =>
        ts.isImportDeclaration(s) &&
        s.moduleSpecifier.text === SEED_IMPORT &&
        s.importClause?.namedBindings &&
        ts.isNamedImports(s.importClause.namedBindings),
    );
    if (declaration) {
      const bindings = declaration.importClause.namedBindings;
      const missing = [...helpers].filter(
        (helper) => !bindings.elements.some((e) => e.name.text === helper),
      );
      if (missing.length) {
        const at = bindings.elements.length
          ? bindings.elements[bindings.elements.length - 1].end
          : bindings.getStart() + 1;
        edits.push({
          start: at,
          end: at,
          text: `${bindings.elements.length ? ", " : " "}${missing.join(", ")}`,
        });
      }
    } else
      edits.push({
        start: 0,
        end: 0,
        text: `import { ${[...helpers].join(", ")} } from "${SEED_IMPORT}";\n`,
      });
  }
  return { source: apply(source, edits), report };
}

export function main(args, print = console.log) {
  const moves = [],
    files = [];
  let write = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--write") write = true;
    else if (args[i] === "--move") {
      const match = /^([\w,]+)=([A-Za-z_$][\w$]*)$/.exec(args[++i] ?? "");
      if (!match) throw new Error("Expected --move field,field=helper");
      moves.push({ fields: match[1].split(","), helper: match[2] });
    } else files.push(args[i]);
  }
  if (!moves.length || !files.length)
    throw new Error("Expected --move field=helper [--write] file...");
  for (const file of files) {
    const before = readFileSync(file, "utf8");
    const result = transformSource(file, before, moves);
    if (write && result.source !== before) writeFileSync(file, result.source);
    for (const line of result.report) print(line);
    if (result.source !== before) print(`${file}: ${write ? "written" : "would change"}`);
  }
}
if (isMainScript(import.meta.url)) main(process.argv.slice(2));
