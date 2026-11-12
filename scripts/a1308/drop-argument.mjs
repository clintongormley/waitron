import { readFileSync, writeFileSync } from "node:fs";
import ts from "typescript";
import { isMainScript } from "../is-main-script.mjs";

function walk(node, visit) {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

function itemEdit(source, items, index) {
  const node = items[index];
  let start = node.getStart();
  let end = node.end;
  const next = items[index + 1];
  if (next)
    end =
      ts.getTrailingCommentRanges(source, next.pos)?.[0]?.pos ??
      ts.getLeadingCommentRanges(source, next.pos)?.[0]?.pos ??
      next.getStart();
  else if (index > 0) start = items[index - 1].end;
  else if (source[end] === ",") end++;
  return { start, end };
}

function statementEdit(source, node) {
  const start = node.getStart();
  const line = source.lastIndexOf("\n", start - 1) + 1;
  const newline = source.indexOf("\n", node.end);
  return /^\s*$/.test(source.slice(line, start)) &&
    newline >= 0 &&
    /^\s*$/.test(source.slice(node.end, newline))
    ? { start: line, end: newline + 1 }
    : { start, end: node.end };
}

const parse = (path, source) => ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
// Matching uses spelling, not type resolution: every bare or property call with a matching
// name in an input file must refer to the declared function.
const nameOf = (node) =>
  ts.isIdentifier(node)
    ? node.text
    : ts.isPropertyAccessExpression(node)
      ? node.name.text
      : undefined;

export function transformSources(sources, declaredIn, targets) {
  const active = new Map();
  walk(parse(declaredIn, sources.get(declaredIn)), (node) => {
    if (!ts.isFunctionDeclaration(node) || !node.name || !targets.has(node.name.text)) return;
    const index = targets.get(node.name.text);
    if (node.parameters[index]?.name.getText() === "cfg") active.set(node.name.text, index);
  });
  const result = new Map(sources);
  const report = [];
  if (active.size === 0) return { sources: result, report };
  for (const [path, source] of sources) {
    if (
      ["write-path.e2e", "inmutabilidad"].some((name) =>
        path.endsWith(`packages/fiscal-verifactu/src/${name}.test.ts`),
      )
    ) {
      report.push(`${path}: fiscal pair file: never rewritten`);
      continue;
    }
    const tree = parse(path, source);
    const edits = [];
    const note = (node, name, reason) =>
      report.push(
        `${path}:${tree.getLineAndCharacterOfPosition(node.getStart()).line + 1}: ${name}: ${reason}`,
      );
    walk(tree, (node) => {
      if (path === declaredIn && ts.isFunctionDeclaration(node) && active.has(node.name?.text)) {
        edits.push(itemEdit(source, node.parameters, active.get(node.name.text)));
        for (const statement of node.body.statements)
          if (
            ts.isExpressionStatement(statement) &&
            ts.isVoidExpression(statement.expression) &&
            statement.expression.expression.getText() === "cfg"
          )
            edits.push(statementEdit(source, statement));
      }
      if (ts.isCallExpression(node) && active.has(nameOf(node.expression))) {
        const name = nameOf(node.expression);
        const index = active.get(name);
        if (node.arguments.some(ts.isSpreadElement)) note(node, name, "spread argument");
        else if (node.arguments.length <= index) note(node, name, "too few arguments");
        else edits.push(itemEdit(source, node.arguments, index));
      }
      if (!ts.isIdentifier(node) || !active.has(node.text)) return;
      const p = node.parent;
      if (
        ts.isImportSpecifier(p) ||
        (ts.isFunctionDeclaration(p) && p.name === node) ||
        (ts.isCallExpression(p) && p.expression === node)
      )
        return;
      if (
        ts.isPropertyAccessExpression(p) &&
        p.name === node &&
        ts.isCallExpression(p.parent) &&
        p.parent.expression === p
      )
        return;
      if (
        (ts.isPropertyAssignment(p) ||
          ts.isMethodDeclaration(p) ||
          ts.isShorthandPropertyAssignment(p)) &&
        p.name === node
      )
        note(node, node.text, "object member");
      else if (!ts.isExportSpecifier(p) || p.propertyName) note(node, node.text, "used as a value");
    });
    let changed = source;
    for (const { start, end } of edits.sort((a, b) => b.start - a.start))
      changed = changed.slice(0, start) + changed.slice(end);
    result.set(path, changed);
  }
  return { sources: result, report };
}

export function main(args = process.argv.slice(2)) {
  let declaredIn;
  let calls;
  let write = false;
  const files = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--call") calls = args[++i];
    else if (args[i] === "--declared-in") declaredIn = args[++i];
    else if (args[i] === "--write") write = true;
    else files.push(args[i]);
  }
  if (!calls || !declaredIn || files.length === 0)
    throw new Error("usage: --call name#index --declared-in file [--write] files...");
  const targets = new Map(
    calls.split(",").map((call) => {
      const [name, index] = call.split("#");
      if (!name || !/^\d+$/.test(index)) throw new Error("call must be name#index");
      return [name, Number(index)];
    }),
  );
  const sources = new Map(
    [...new Set([declaredIn, ...files])].map((path) => [path, readFileSync(path, "utf8")]),
  );
  const result = transformSources(sources, declaredIn, targets);
  const changed = [...result.sources.keys()].filter(
    (path) => result.sources.get(path) !== sources.get(path),
  );
  if (write) for (const path of changed) writeFileSync(path, result.sources.get(path));
  console.log(JSON.stringify({ changed, report: result.report }));
}

/* v8 ignore start */
if (isMainScript(import.meta.url)) main();
/* v8 ignore stop */
