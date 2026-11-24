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
  const assigned = new Set();
  for (const name of expected) {
    if (!actual.includes(name)) throw new Error(`${file.fileName}: missing declaration ${name}`);
    if (assigned.has(name)) throw new Error(`${file.fileName}: ${name} assigned more than once`);
    assigned.add(name);
  }
  for (const name of actual) {
    if (!assigned.has(name)) throw new Error(`${file.fileName}: unmapped declaration ${name}`);
  }
}

function span(source, node) {
  const start =
    ts.getLeadingCommentRanges(source.text, node.getFullStart())?.[0]?.pos ?? node.getStart(source);
  const end = ts.getTrailingCommentRanges(source.text, node.end)?.at(-1)?.end ?? node.end;
  return { start, end };
}

function tokens(text) {
  const source = parse("signature.ts", text);
  const optionalSemicolons = new Set();
  function visit(node) {
    if (ts.isTypeLiteralNode(node)) {
      const last = node.members.at(-1)?.getLastToken(source);
      if (last?.kind === ts.SyntaxKind.SemicolonToken) {
        optionalSemicolons.add(last.getStart(source));
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);

  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    text,
  );
  const result = [];
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    // Prettier adds a final type member's semicolon when the type wraps.
    if (optionalSemicolons.has(scanner.getTokenStart())) continue;
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
  const functions = ts.isVariableStatement(node)
    ? node.declarationList.declarations.map(({ initializer }) => initializer)
    : [node];
  const bodies = functions.flatMap((fn) =>
    fn &&
    (ts.isFunctionDeclaration(fn) || ts.isFunctionExpression(fn) || ts.isArrowFunction(fn)) &&
    fn.body
      ? [fn.body]
      : [],
  );
  const signature = replace(
    source.text.slice(start, end),
    bodies.map((body) => {
      const bodyStart = body.getStart(source);
      return { span: { start: bodyStart - start, length: body.end - bodyStart }, newText: "" };
    }),
  );
  const exportAt = node.getStart(source) - start;
  const withoutExport = isExported(node)
    ? signature.slice(0, exportAt) + signature.slice(exportAt + "export".length)
    : signature;
  return {
    body: ts.isExpressionStatement(node)
      ? signature
      : JSON.stringify(bodies.map((body) => body.getText(source))),
    signature: JSON.stringify(tokens(withoutExport)),
  };
}

function verifyMoves(expected, readFile) {
  for (const [target, declarations] of expected) {
    const output = parse(target, readFile(target));
    for (const [name, originals] of declarations) {
      const nodes = output.statements.filter((statement) => nameOf(statement) === name);
      if (nodes.length !== originals.length)
        throw new Error(`${target}: missing moved declaration ${name}`);
      for (const [index, node] of nodes.entries()) {
        const actual = snapshot(output, node);
        const original = originals[index];
        if (actual.body !== original.body) throw new Error(`${target}: ${name} changed body`);
        if (actual.signature !== original.signature) {
          throw new Error(`${target}: ${name} changed signature or comments`);
        }
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

function reexportEdits(program, source, names, target) {
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
      const moved = node.exportClause.elements.filter((item) =>
        names.has((item.propertyName ?? item.name).text),
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

function groupForTypeScript(original, targets) {
  const moves = new Map();
  const cuts = [];
  const destinationFor = new Map(
    Object.entries(targets).flatMap(([target, names]) => names.map((name) => [name, target])),
  );
  for (const node of original.statements) {
    const target = destinationFor.get(nameOf(node));
    if (!target) continue;
    const { start, end } = span(original, node);
    const group = moves.get(target) ?? [];
    group.push(original.text.slice(start, end));
    moves.set(target, group);
    cuts.push({ span: { start, length: end - start }, newText: "" });
  }
  // One move per destination keeps TypeScript from editing and deleting the same import.
  const staying = replace(original.text, cuts).trimEnd();
  const groups = Object.keys(targets).map((target) => (moves.get(target) ?? []).join("\n\n"));
  return [staying, ...groups].filter(Boolean).join("\n\n") + "\n";
}

function revealShorthand(file) {
  const edits = [];
  const affected = new Set();
  function visit(node) {
    if (ts.isShorthandPropertyAssignment(node) && !node.objectAssignmentInitializer) {
      edits.push({
        span: { start: node.name.end, length: 0 },
        newText: `: ${node.name.getText(file)}`,
      });
    }
    ts.forEachChild(node, visit);
  }
  for (const statement of file.statements) {
    const name = nameOf(statement);
    if (!name) continue;
    const count = edits.length;
    visit(statement);
    if (edits.length !== count) affected.add(name);
  }
  return { text: replace(file.text, edits), affected };
}

function restoreDeclarations(file, output, names) {
  const originals = file.statements.filter((statement) => names.has(nameOf(statement)));
  const moved = output.statements.filter((statement) => names.has(nameOf(statement)));
  if (moved.length !== originals.length) {
    throw new Error(`${output.fileName}: TypeScript did not preserve ${[...names].join(", ")}`);
  }
  const restored = moved.map((statement, index) => {
    const original = originals[index];
    const { start, end } = span(file, original);
    const declaration = file.text.slice(start, end);
    const exportAt = original.getStart(file) - start;
    const newText =
      isExported(statement) && !isExported(original)
        ? declaration.slice(0, exportAt) + "export " + declaration.slice(exportAt)
        : declaration;
    const outputSpan = span(output, statement);
    return {
      span: { start: outputSpan.start, length: outputSpan.end - outputSpan.start },
      newText,
    };
  });
  return replace(output.text, restored);
}

function moveDeclarations(project, source, names, target) {
  const file = parse(source, project.readFile(source));
  const oldTarget = project.readFile(target);
  if (
    oldTarget &&
    parse(target, oldTarget).statements.some((statement) => names.has(nameOf(statement)))
  ) {
    throw new Error(`${target}: already contains one of ${[...names].join(", ")}`);
  }
  // TypeScript misses imports that are used only in a shorthand property.
  const { text, affected } = revealShorthand(file);
  if (affected.size) project.set(source, text);
  const refactorSource = parse(source, text);
  const nodes = refactorSource.statements.filter((statement) => names.has(nameOf(statement)));
  const reexports = reexportEdits(project.service.getProgram(), source, names, target);
  const { edits } = project.service.getEditsForRefactor(
    source,
    { quotePreference: "double", newLineCharacter: "\n" },
    { pos: nodes[0].getStart(refactorSource), end: nodes.at(-1).end },
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
  project.set(target, restoreDeclarations(file, output, names));
  const staying = affected.difference(names);
  if (staying.size) {
    project.set(
      source,
      restoreDeclarations(file, parse(source, project.readFile(source)), staying),
    );
  }
}

export async function main([mapFile], root) {
  const map = JSON.parse(readFileSync(resolve(root, mapFile), "utf8"));
  const project = createProject(root, resolve(root, map.tsconfig));
  try {
    const expected = new Map();
    const operations = [];
    for (const { source, targets, keep = [] } of map.moves) {
      const file = resolve(root, source);
      const original = parse(file, project.readFile(file));
      validateMap(original, targets, keep);
      for (const [target, names] of Object.entries(targets)) {
        const destination = resolve(root, target);
        const declarations = expected.get(destination) ?? new Map();
        for (const name of names) {
          const nodes = original.statements.filter((statement) => nameOf(statement) === name);
          declarations.set(
            name,
            nodes.map((node) => snapshot(original, node)),
          );
        }
        expected.set(destination, declarations);
        operations.push([file, new Set(names), destination]);
      }
      project.set(file, groupForTypeScript(original, targets));
    }
    for (const operation of operations) moveDeclarations(project, ...operation);
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
