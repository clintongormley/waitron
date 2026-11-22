import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import names from "./fiscal-rename-map.json" with { type: "json" };

const baseline = "packages/fiscal-verifactu/drizzle/0000_baseline.sql";
const codeFile = /\.(?:ts|mts|js|mjs)$/;
const textFile = /\.(?:json|md|sql|sh|yml|yaml)$/;
const appendOnlySuffix = /_append_only_(?:update|delete)$/;
const { envios, ...otherIdentifiers } = names.identifiers;

function pattern(words) {
  const alternatives = Object.keys(words)
    .sort((a, b) => b.length - a.length)
    .map((word) => RegExp.escape(word));
  return new RegExp(`(?<![A-Za-z0-9_])(?:${alternatives.join("|")})(?![A-Za-z0-9_])`, "g");
}

const mappedText = { ...names.sql, ...names.strings, ...names.files };
const documentNames = { ...mappedText, ...otherIdentifiers };
const textPattern = pattern(mappedText);
const documentPattern = pattern(documentNames);

export function renameDocument(text, file) {
  const keep = names.keep.filter((entry) => entry.file === file).map((entry) => entry.text);
  for (const original of keep) {
    if (!text.includes(original)) throw Error(`Missing keep text in ${file}: ${original}`);
  }
  const pieces = keep.length
    ? text.split(new RegExp(`(${keep.map(RegExp.escape).join("|")})`))
    : [text];
  return pieces
    .map((piece) =>
      keep.includes(piece) ? piece : piece.replace(documentPattern, (name) => documentNames[name]),
    )
    .join("");
}

function modulePath(file, specifier) {
  const packagePrefix = "@waitron/fiscal-verifactu/";
  const packagePath = "packages/fiscal-verifactu/";
  const isDeep = specifier.startsWith(packagePrefix);
  if (!isDeep && !specifier.startsWith(".")) return specifier;
  const extension = specifier.match(/\.(?:js|ts)$/)?.[0] ?? "";
  const stem = extension ? specifier.slice(0, -extension.length) : specifier;
  const old = isDeep
    ? packagePath + stem.slice(packagePrefix.length)
    : posix.join(posix.dirname(file), stem);
  const next = names.files[old + ".ts"];
  if (!next) return specifier;
  const target = next.slice(0, -3) + extension;
  if (isDeep) return packagePrefix + target.slice(packagePath.length);
  const relative = posix.relative(posix.dirname(file), target);
  return relative.startsWith(".") ? relative : "./" + relative;
}

function hasEnviosBinding(source) {
  return source.statements.some((statement) => {
    if (ts.isImportDeclaration(statement)) {
      const bindings = statement.importClause?.namedBindings;
      return (
        bindings &&
        ts.isNamedImports(bindings) &&
        bindings.elements.some(
          (specifier) => specifier.name.text === "envios" && !specifier.propertyName,
        )
      );
    }
    return (
      ts.isVariableStatement(statement) &&
      statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) &&
      statement.declarationList.declarations.some(
        (declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === "envios",
      )
    );
  });
}

function renameEnvios(node, hasBinding) {
  const parent = node.parent;
  if (ts.isImportSpecifier(parent)) return (parent.propertyName ?? parent.name) === node;
  if (ts.isExportSpecifier(parent)) return true;
  if (ts.isBindingElement(parent) && parent.propertyName === node) return false;
  if (
    (ts.isPropertyAccessExpression(parent) ||
      ts.isPropertyAssignment(parent) ||
      ts.isPropertySignature(parent)) &&
    parent.name === node
  ) {
    return false;
  }
  return hasBinding;
}

export function renameSource(file, text) {
  const parsed = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const hasBinding = hasEnviosBinding(parsed);
  const edits = new Map();
  const edit = (start, end, updated) => {
    if (updated !== text.slice(start, end)) edits.set(start, { start, end, updated });
  };
  const renameTextAt = (start, end) =>
    edit(
      start,
      end,
      text.slice(start, end).replace(textPattern, (name) => mappedText[name]),
    );

  function visit(node) {
    const start = node.getStart(parsed);
    const end = node.getEnd();
    if (ts.isIdentifier(node)) {
      const next =
        node.text === "envios"
          ? renameEnvios(node, hasBinding)
            ? envios
            : undefined
          : otherIdentifiers[node.text];
      if (typeof next === "string") edit(start, end, next);
    } else if (ts.isStringLiteralLike(node)) {
      const parent = node.parent;
      const isSpecifier =
        ((ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) &&
          parent.moduleSpecifier === node) ||
        (ts.isCallExpression(parent) && parent.expression.kind === ts.SyntaxKind.ImportKeyword);
      const next = isSpecifier ? modulePath(file, node.text) : node.text;
      if (next !== node.text) edit(start + 1, end - 1, next);
      else renameTextAt(start, end);
    } else if (ts.isTemplateLiteralToken(node)) {
      renameTextAt(start, end);
    }
    for (const range of ts.getLeadingCommentRanges(text, node.getFullStart()) ?? []) {
      renameTextAt(range.pos, range.end);
    }
    for (const range of ts.getTrailingCommentRanges(text, end) ?? []) {
      renameTextAt(range.pos, range.end);
    }
    ts.forEachChild(node, visit);
  }

  visit(parsed);
  let renamed = text;
  for (const { start, end, updated } of [...edits.values()].sort((a, b) => b.start - a.start)) {
    renamed = renamed.slice(0, start) + updated + renamed.slice(end);
  }
  return renamed;
}

const sqlPattern = pattern(names.sql);
export function applyListMap(value) {
  if (typeof value === "string") return value.replace(sqlPattern, (name) => names.sql[name]);
  if (Array.isArray(value)) return value.map(applyListMap);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [applyListMap(key), applyListMap(entry)]),
  );
}

export function main(args, root = process.cwd(), log = console.log) {
  if (args[0] === "--protection-list" && args.length === 3) {
    const [input, output] = args.slice(1).map((path) => resolve(root, path));
    const mapped = applyListMap(
      JSON.parse(readFileSync(resolve(input, "protection-list.json"), "utf8")),
    );
    mkdirSync(output);
    writeFileSync(resolve(output, "protection-list.json"), JSON.stringify(mapped));
    return 0;
  }
  const check = args.length === 1 && args[0] === "--check";
  if (args.length && !check)
    throw Error("Usage: fiscal-rename.mjs [--check | --protection-list IN OUT]");

  const migration = readFileSync(resolve(root, baseline), "utf8");
  const present = new Set(migration.match(/[A-Za-z0-9_]+/g));
  for (const [old, next] of Object.entries(names.sql)) {
    // The append-only installer derives these names from the table, outside the starting SQL.
    if (
      !present.has(old.replace(appendOnlySuffix, "")) &&
      !present.has(next.replace(appendOnlySuffix, ""))
    ) {
      throw Error(`Missing name in baseline: ${old} or ${next}`);
    }
  }

  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  const git = (...argv) => execFileSync("git", argv, { cwd: root, env, encoding: "utf8" });
  const paths = git(
    "ls-files",
    "-z",
    "--",
    "apps",
    "packages",
    "scripts",
    "deploy",
    "CLAUDE.md",
    "docs/backlog.md",
    "docs/backlog/",
    ":!**/drizzle/**",
    ":!packages/country-es/test-fixtures/**",
    ":!scripts/a1308/**",
    ":!scripts/english-only.test.ts",
  )
    .split("\0")
    .filter(Boolean);

  const changes = [];
  for (const file of paths) {
    const from = resolve(root, file);
    if (!(codeFile.test(file) || textFile.test(file)) || !lstatSync(from).isFile()) continue;
    const old = readFileSync(from, "utf8");
    const next = codeFile.test(file) ? renameSource(file, old) : renameDocument(old, file);
    const target = names.files[file] ?? file;
    if (target !== file && existsSync(resolve(root, target)))
      throw Error(`Both ${file} and ${target} exist`);
    if (target !== file || next !== old) changes.push({ file, target, next });
  }
  for (const { file, target, next } of changes) {
    log(file === target ? file : `${file} -> ${target}`);
    if (check) continue;
    if (file !== target) git("mv", "--", file, target);
    writeFileSync(resolve(root, target), next);
  }
  if (!changes.length) log("nothing to change");
  return Number(check && changes.length > 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
