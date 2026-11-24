import { readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { format, resolveConfig } from "prettier";
import ts from "typescript";

function createProject(root, configFile) {
  const { fileNames, options } = ts.getParsedCommandLineOfConfigFile(
    configFile,
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
        throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
      },
    },
  );
  const files = new Set(fileNames);
  const changed = new Map();
  const reads = new Map();
  const readFile = (file) => {
    if (changed.has(file)) return changed.get(file).text;
    if (!reads.has(file)) reads.set(file, ts.sys.readFile(file));
    return reads.get(file);
  };
  const service = ts.createLanguageService({
    ...ts.sys,
    useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
    getCurrentDirectory: () => root,
    getCompilationSettings: () => options,
    getDefaultLibFileName: ts.getDefaultLibFilePath,
    getScriptFileNames: () => [...files],
    getScriptVersion: (file) => String(changed.get(file)?.version ?? 0),
    getScriptSnapshot: (file) => {
      const text = readFile(file);
      return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
    },
    readFile,
    fileExists: (file) => changed.has(file) || ts.sys.fileExists(file),
  });
  return {
    changed,
    readFile,
    service,
    set(file, text) {
      files.add(file);
      changed.set(file, { text, version: (changed.get(file)?.version ?? 0) + 1 });
    },
  };
}

function parse(file, text) {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
}

function nameOf(statement) {
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.map(({ name }) => name.getText()).join(", ");
  }
  if (ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression)) {
    const {
      expression,
      arguments: [title],
    } = statement.expression;
    if (title && ts.isStringLiteral(title)) return `${expression.getText()}:${title.text}`;
    return expression.getText();
  }
  return statement.name?.text;
}

function validateMap(file, targets, keep) {
  const actual = file.statements.map(nameOf).filter(Boolean);
  const expected = [...keep, ...Object.values(targets).flat()];
  for (const name of expected) {
    if (!actual.includes(name)) throw new Error(`${file.fileName}: missing declaration ${name}`);
  }
  for (const name of actual) {
    if (!expected.includes(name)) throw new Error(`${file.fileName}: unmapped declaration ${name}`);
  }
}

function span(source, node) {
  const start =
    ts.getLeadingCommentRanges(source.text, node.getFullStart())?.[0]?.pos ?? node.getStart(source);
  const end = ts.getTrailingCommentRanges(source.text, node.end)?.at(-1)?.end ?? node.end;
  return { start, end };
}

function tokens(text) {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    text,
  );
  const result = [];
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    if (kind !== ts.SyntaxKind.WhitespaceTrivia && kind !== ts.SyntaxKind.NewLineTrivia) {
      const token = scanner.getTokenText();
      // Adding export can make Prettier wrap a list and add its trailing comma.
      if (result.at(-1) === "," && [")", "]", "}", ">"].includes(token)) result.pop();
      result.push(token);
    }
  }
  return result;
}

function snapshot(source, node) {
  const { start, end } = span(source, node);
  const body = ts.isFunctionDeclaration(node) ? node.body : undefined;
  const signature = body
    ? source.text.slice(start, body.getStart(source)) + source.text.slice(body.end, end)
    : source.text.slice(start, end);
  const exportAt = node.getStart(source) - start;
  const withoutExport = isExported(node)
    ? signature.slice(0, exportAt) + signature.slice(exportAt + "export".length)
    : signature;
  return {
    body: body?.getText(source) ?? (ts.isExpressionStatement(node) ? signature : undefined),
    signature: JSON.stringify(tokens(withoutExport)),
  };
}

function verifyMoves(expected, readFile) {
  for (const [target, declarations] of expected) {
    const output = parse(target, readFile(target));
    for (const [name, original] of declarations) {
      const node = output.statements.find((statement) => nameOf(statement) === name);
      if (!node) throw new Error(`${target}: missing moved declaration ${name}`);
      const actual = snapshot(output, node);
      if (actual.body !== original.body) throw new Error(`${target}: ${name} changed body`);
      if (actual.signature !== original.signature) {
        throw new Error(`${target}: ${name} changed signature or comments`);
      }
    }
  }
}

function isExported(statement) {
  return statement.modifiers?.some(({ kind }) => kind === ts.SyntaxKind.ExportKeyword);
}

function replace(text, edits) {
  for (const {
    span: { start, length },
    newText,
  } of edits.toReversed()) {
    text = text.slice(0, start) + newText + text.slice(start + length);
  }
  return text;
}

function reexportEdits(program, source, name, target) {
  const checker = program.getTypeChecker();
  const symbol = checker.getSymbolAtLocation(program.getSourceFile(source));
  const changes = [];
  for (const file of program.getSourceFiles()) {
    if (file.isDeclarationFile) continue;
    const edits = [];
    for (const node of file.statements) {
      if (
        !ts.isExportDeclaration(node) ||
        !node.moduleSpecifier ||
        !node.exportClause ||
        !ts.isNamedExports(node.exportClause) ||
        checker.getSymbolAtLocation(node.moduleSpecifier) !== symbol
      )
        continue;
      const moved = node.exportClause.elements.filter(
        (item) => (item.propertyName ?? item.name).text === name,
      );
      if (!moved.length) continue;
      const staying = node.exportClause.elements.filter((item) => !moved.includes(item));
      const modulePath = relative(dirname(file.fileName), target).replace(/\.ts$/, ".js");
      const from = modulePath.startsWith("../") ? modulePath : `./${modulePath}`;
      const render = (items, specifier) =>
        `export ${node.isTypeOnly ? "type " : ""}{ ${items.map((item) => item.getText(file)).join(", ")} } from ${specifier};`;
      const newText = [
        staying.length ? render(staying, node.moduleSpecifier.getText(file)) : "",
        render(moved, JSON.stringify(from)),
      ]
        .filter(Boolean)
        .join("\n");
      const start = node.getStart(file);
      edits.push({ span: { start, length: node.end - start }, newText });
    }
    if (edits.length) changes.push({ fileName: file.fileName, textChanges: edits });
  }
  return changes;
}

function moveDeclaration(project, source, name, target) {
  const file = parse(source, project.readFile(source));
  const node = file.statements.find((statement) => nameOf(statement) === name);
  const oldTarget = project.readFile(target);
  if (
    oldTarget &&
    parse(target, oldTarget).statements.some((statement) => nameOf(statement) === name)
  ) {
    throw new Error(`${target}: already contains ${name}`);
  }
  const { start, end } = span(file, node);
  const declaration = file.text.slice(start, end);
  const reexports = reexportEdits(project.service.getProgram(), source, name, target);
  const { edits } = project.service.getEditsForRefactor(
    source,
    { quotePreference: "double", newLineCharacter: "\n" },
    { pos: node.getStart(file), end: node.end },
    "Move to file",
    "Move to file",
    { importModuleSpecifierEnding: "js", quotePreference: "double" },
    { targetFile: target },
  );
  for (const fileName of new Set([...edits, ...reexports].map((edit) => edit.fileName))) {
    const refactor = edits.find((edit) => edit.fileName === fileName);
    const exports = reexports.find((edit) => edit.fileName === fileName);
    const textChanges = [...(refactor?.textChanges ?? []), ...(exports?.textChanges ?? [])];
    textChanges.sort((left, right) => left.span.start - right.span.start);
    project.set(
      fileName,
      replace(refactor?.isNewFile ? "" : project.readFile(fileName), textChanges),
    );
  }
  const output = parse(target, project.readFile(target));
  const moved = output.statements.find((statement) => nameOf(statement) === name);
  if (!moved) throw new Error(`${target}: TypeScript did not move ${name}`);
  const outputSpan = span(output, moved);
  const addedExport = isExported(moved) && !isExported(node);
  const exportAt = node.getStart(file) - start;
  const restored = addedExport
    ? declaration.slice(0, exportAt) + "export " + declaration.slice(exportAt)
    : declaration;
  project.set(
    target,
    replace(output.text, [
      {
        span: { start: outputSpan.start, length: outputSpan.end - outputSpan.start },
        newText: restored,
      },
    ]),
  );
}

export async function main([mapFile], root) {
  const map = JSON.parse(readFileSync(resolve(root, mapFile), "utf8"));
  const project = createProject(root, resolve(root, map.tsconfig));
  try {
    const expected = new Map();
    for (const { source, targets, keep = [] } of map.moves) {
      const file = resolve(root, source);
      const original = parse(file, project.readFile(file));
      validateMap(original, targets, keep);
      for (const [target, names] of Object.entries(targets)) {
        const destination = resolve(root, target);
        const declarations = expected.get(destination) ?? new Map();
        for (const name of names) {
          const node = original.statements.find((statement) => nameOf(statement) === name);
          declarations.set(name, snapshot(original, node));
        }
        expected.set(destination, declarations);
      }
    }
    for (const { source, targets } of map.moves) {
      const file = resolve(root, source);
      for (const [target, names] of Object.entries(targets)) {
        for (const name of names) {
          moveDeclaration(project, file, name, resolve(root, target));
        }
      }
    }
    verifyMoves(expected, project.readFile);
    const formatted = new Map();
    for (const [file, { text }] of project.changed) {
      formatted.set(file, await format(text, { ...(await resolveConfig(file)), filepath: file }));
    }
    verifyMoves(expected, (file) => formatted.get(file));
    for (const [file, text] of formatted) writeFileSync(file, text);
    return [...formatted.keys()];
  } finally {
    project.service.dispose();
  }
}

if (import.meta.main) await main(process.argv.slice(2), process.cwd());
