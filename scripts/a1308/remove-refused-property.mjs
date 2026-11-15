import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import ts from "typescript";

export function refusals(output, property) {
  const found = [];
  for (const line of stripVTControlCharacters(output).split(/\n(?=\S)/)) {
    const match =
      line.match(/^(.*?)\((\d+),(\d+)\): error TS(?:2353|2769): ([\s\S]*)$/) ??
      line.match(/^(.*?):(\d+):(\d+) - error TS(?:2353|2769): ([\s\S]*)$/);
    if (
      match?.[4].includes(
        `Object literal may only specify known properties, and '${property}' does not exist in type`,
      )
    ) {
      found.push({ file: match[1], line: Number(match[2]), column: Number(match[3]) });
    }
  }
  return found;
}

export function removeAt(text, positions, property) {
  const source = ts.createSourceFile("input.ts", text, ts.ScriptTarget.Latest, true);
  const properties = new Map();
  function visit(node) {
    if (
      (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) &&
      ts.isObjectLiteralExpression(node.parent) &&
      node.name.text === property
    ) {
      properties.set(node.name.getStart(source), node);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  const cuts = new Map();
  for (const { line, column } of positions) {
    const start = source.getLineStarts()[line - 1] + column - 1;
    const node = properties.get(start);
    if (!node) throw new Error(`Position ${line}:${column} does not name property ${property}`);
    let end = node.end;
    while (text[end] === " " || text[end] === "\t") end++;
    if (text[end] === ",") end++;
    const lineStart = text.lastIndexOf("\n", start - 1) + 1;
    const nextLine = text.indexOf("\n", end);
    const lineEnd = nextLine === -1 ? text.length : nextLine;
    if (!text.slice(lineStart, start).trim() && !text.slice(end, lineEnd).trim()) {
      cuts.set(lineStart, nextLine === -1 ? lineEnd : nextLine + 1);
    } else cuts.set(start, end);
  }
  for (const [start, end] of [...cuts].sort((a, b) => b[0] - a[0])) {
    text = text.slice(0, start) + text.slice(end);
  }
  return text;
}

export function run({ root, property, outputFile }) {
  const byFile = new Map();
  for (const position of refusals(readFileSync(outputFile, "utf8"), property)) {
    const file = resolve(root, position.file);
    const positions = byFile.get(file) ?? [];
    if (!positions.some(({ line, column }) => line === position.line && column === position.column))
      positions.push(position);
    byFile.set(file, positions);
  }
  let removed = 0;
  for (const [file, positions] of byFile) {
    writeFileSync(file, removeAt(readFileSync(file, "utf8"), positions, property));
    removed += positions.length;
  }
  return { removed };
}

export function main(args, root) {
  if (args[0] !== "--property" || !args[1] || !args[2] || args.length !== 3) {
    throw new Error("Usage: remove-refused-property.mjs --property <name> <tsc-output-file>");
  }
  return run({ root, property: args[1], outputFile: resolve(root, args[2]) });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(main(process.argv.slice(2), process.cwd()));
}
