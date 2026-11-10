import { readFileSync, writeFileSync } from "node:fs";
import ts from "typescript";
import { isMainScript } from "../is-main-script.mjs";

function walk(node, visit) {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

function apply(source, edits) {
  const unique = new Map(edits.map((edit) => [`${edit.start}:${edit.end}`, edit]));
  for (const { start, end } of [...unique.values()].sort((a, b) => b.start - a.start))
    source = source.slice(0, start) + source.slice(end);
  return source;
}

function removeItem(source, items, node) {
  const index = items.indexOf(node);
  let start = node.getStart();
  let end = node.end;
  const next = items[index + 1];
  if (next !== undefined)
    end = ts.getLeadingCommentRanges(source, next.pos)?.[0]?.pos ?? next.getStart();
  else if (index > 0) start = items[index - 1].end;
  else {
    if (source[end] === ",") end++;
    while (source[end] === " ") end++;
  }
  const line = source.lastIndexOf("\n", start - 1) + 1;
  const newline = source.indexOf("\n", end);
  if (
    /^\s*$/.test(source.slice(line, start)) &&
    newline >= 0 &&
    /^\s*$/.test(source.slice(end, newline))
  )
    return { start: line, end: newline + 1 };
  return { start, end };
}

function removeStatement(source, node) {
  const start = node.getStart();
  const end = node.end;
  const line = source.lastIndexOf("\n", start - 1) + 1;
  const newline = source.indexOf("\n", end);
  return /^\s*$/.test(source.slice(line, start)) &&
    newline >= 0 &&
    /^\s*$/.test(source.slice(end, newline))
    ? { start: line, end: newline + 1 }
    : { start, end };
}

function callName(node) {
  return ts.isIdentifier(node)
    ? node.text
    : ts.isPropertyAccessExpression(node)
      ? node.name.text
      : undefined;
}

function tableInChain(node, tables) {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return false;
  if (["insert", "update"].includes(node.expression.name.text))
    return ts.isIdentifier(node.arguments[0]) && tables.has(node.arguments[0].text);
  return tableInChain(node.expression.expression, tables);
}

function propertyName(node) {
  return node.name?.getText().replace(/^["']|["']$/g, "");
}

function unwrap(node) {
  while (
    ts.isAwaitExpression(node) ||
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isNonNullExpression(node)
  )
    node = node.expression;
  return node;
}

const helpers = new Set(["venueLocationId", "locationId", "brandLocationId"]);
function reference(node) {
  const parent = node.parent;
  return !(
    parent.name === node &&
    (ts.isVariableDeclaration(parent) ||
      ts.isParameter(parent) ||
      ts.isPropertyAccessExpression(parent) ||
      ts.isPropertyAssignment(parent) ||
      ts.isImportSpecifier(parent))
  );
}

export function transformSource(path, source, options) {
  if (
    [
      "packages/fiscal-verifactu/src/write-path.e2e.test.ts",
      "packages/fiscal-verifactu/src/inmutabilidad.test.ts",
    ].some((file) => path.endsWith(file))
  )
    return { source, report: [`${path}: fiscal pair file: never rewritten`] };
  const tables = new Set(options.tables);
  const helperProps = new Map((options.helperProps ?? []).map((value) => value.split(".")));
  const helperArgs = new Map(
    (options.helperArgs ?? []).map((value) => {
      const [name, index] = value.split("#");
      return [name, Number(index)];
    }),
  );
  const parse = () =>
    ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const edits = [];
  function dropProperties(value, key) {
    if (ts.isArrayLiteralExpression(value)) {
      for (const row of value.elements) dropProperties(row, key);
    } else if (ts.isObjectLiteralExpression(value)) {
      for (const property of value.properties)
        if (propertyName(property) === key)
          edits.push(removeItem(source, value.properties, property));
    }
  }
  walk(parse(), (node) => {
    if (!ts.isCallExpression(node)) return;
    const name = callName(node.expression);
    if (helperProps.has(name))
      for (const argument of node.arguments) dropProperties(argument, helperProps.get(name));
    const last = helperArgs.get(name);
    if (last !== undefined && last === node.arguments.length - 1)
      edits.push(removeItem(source, node.arguments, node.arguments[last]));
    if (
      !ts.isPropertyAccessExpression(node.expression) ||
      !tableInChain(node.expression.expression, tables)
    )
      return;
    if (["values", "set"].includes(name) && node.arguments[0] !== undefined)
      dropProperties(node.arguments[0], "locationId");
    if (
      ["onConflictDoNothing", "onConflictDoUpdate"].includes(name) &&
      ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      for (const property of node.arguments[0].properties) {
        if (
          !ts.isPropertyAssignment(property) ||
          propertyName(property) !== "target" ||
          !ts.isArrayLiteralExpression(property.initializer)
        )
          continue;
        for (const element of property.initializer.elements)
          if (
            ts.isPropertyAccessExpression(element) &&
            ts.isIdentifier(element.expression) &&
            tables.has(element.expression.text) &&
            element.name.text === "locationId"
          )
            edits.push(removeItem(source, property.initializer.elements, element));
      }
    }
  });
  source = apply(source, edits);
  let previous;
  do {
    previous = source;
    const tree = parse();
    const unused = [];
    function used(name, outside) {
      let found = false;
      walk(tree, (node) => {
        if (
          ts.isIdentifier(node) &&
          node.text === name &&
          reference(node) &&
          !(node.pos >= outside.pos && node.end <= outside.end)
        )
          found = true;
      });
      return found;
    }
    walk(tree, (node) => {
      if (ts.isVariableStatement(node) && node.declarationList.declarations.length === 1) {
        const declaration = node.declarationList.declarations[0];
        if (
          (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export) !== 0 ||
          !ts.isIdentifier(declaration.name) ||
          declaration.initializer === undefined ||
          used(declaration.name.text, node)
        )
          return;
        const value = unwrap(declaration.initializer);
        if (
          (ts.isCallExpression(value) && helpers.has(callName(value.expression))) ||
          (ts.isPropertyAccessExpression(value) && value.name.text === "locationId")
        )
          unused.push(removeStatement(source, node));
      }
      if (
        ts.isImportDeclaration(node) &&
        node.importClause?.namedBindings &&
        ts.isNamedImports(node.importClause.namedBindings)
      ) {
        const bindings = node.importClause.namedBindings;
        const dropped = bindings.elements.filter(
          (element) =>
            [...helpers, "LocationId"].includes(element.name.text) &&
            !used(element.name.text, node),
        );
        if (dropped.length === 0) return;
        if (dropped.length === bindings.elements.length && node.importClause.name === undefined)
          unused.push(removeStatement(source, node));
        else
          for (const element of dropped)
            unused.push(removeItem(source, bindings.elements, element));
      }
    });
    source = apply(source, unused);
  } while (source !== previous);
  const report = source
    .split("\n")
    .flatMap((line, index) =>
      /\blocationId\b|location_id|venueLocationId/.test(line)
        ? [`${path}:${index + 1}: hand edit: ${line}`]
        : [],
    );
  return { source, report };
}

export function main(args) {
  const options = { tables: [], helperProps: [], helperArgs: [] };
  const files = [];
  let write = false;
  const keys = {
    "--tables": "tables",
    "--helper-prop": "helperProps",
    "--helper-arg": "helperArgs",
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--write") write = true;
    else if (keys[arg]) options[keys[arg]] = args[++i].split(",");
    else files.push(arg);
  }
  for (const path of files) {
    const input = readFileSync(path, "utf8");
    const result = transformSource(path, input, options);
    if (result.source !== input) {
      if (write) writeFileSync(path, result.source);
      else process.stdout.write(`${path}: preview\n${result.source}\n`);
    }
    for (const line of result.report) process.stdout.write(`${line}\n`);
  }
}

if (isMainScript(import.meta.url)) main(process.argv.slice(2));
