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

function lineSpan(source, node) {
  const { start, end } = span(source, node);
  const lineStart = source.text.lastIndexOf("\n", start - 1) + 1;
  return { start: lineStart, length: end - lineStart };
}

function routeAnchor(statements, anchor, fileName) {
  const matches = statements.filter((node) => nameOf(node) === `app.${anchor.replace(" ", ":")}`);
  if (matches.length !== 1) {
    throw new Error(`${fileName}: expected one route anchor ${anchor}, found ${matches.length}`);
  }
  return matches[0];
}

function liftRoutes(source, { mount, groups }) {
  const declaration = source.statements.find((node) => nameOf(node) === mount);
  if (!declaration || !ts.isFunctionDeclaration(declaration) || !declaration.body) {
    throw new Error(`${source.fileName}: missing mount function ${mount}`);
  }
  const { statements } = declaration.body;
  const edits = [];
  const functions = [];
  for (const [name, { first, last, parameters, hoist }] of Object.entries(groups)) {
    const from = routeAnchor(statements, first, source.fileName);
    const to = routeAnchor(statements, last, source.fileName);
    const { start } = lineSpan(source, from);
    const { end } = span(source, to);
    const previous = edits.at(-1)?.span;
    if (to.pos < from.pos || (previous && start < previous.start + previous.length)) {
      throw new Error(`${source.fileName}: out-of-order route range for ${name}`);
    }
    let body = source.text.slice(start, end);
    let lifted = "";
    if (hoist !== undefined) {
      const matches = statements.filter(
        (node) => node.pos >= from.end && node.end <= to.pos && nameOf(node) === hoist,
      );
      if (matches.length !== 1) {
        throw new Error(`${source.fileName}: expected one ${hoist} inside ${name}`);
      }
      const { start: localStart, length } = lineSpan(source, matches[0]);
      const localEnd = localStart + length;
      lifted = source.text.slice(localStart, localEnd) + "\n\n";
      body =
        source.text.slice(start, localStart) + source.text.slice(localEnd, end).replace(/^\n+/, "");
    }
    const signature = Object.entries(parameters)
      .map(([param, type]) => `${param}: ${type}`)
      .join(", ");
    functions.push(`export function ${name}(${signature}): void {\n${body}\n}`);
    edits.push({
      span: { start, length: end - start },
      newText: `${lifted}  ${name}(${Object.keys(parameters).join(", ")});`,
    });
  }
  return parse(source.fileName, [replace(source.text, edits).trimEnd(), ...functions].join("\n\n"));
}

function retainTypeReexports(source) {
  const imports = new Map();
  for (const node of source.statements.filter(ts.isImportDeclaration)) {
    const bindings = node.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const item of bindings.elements) {
      imports.set(item.name.text, {
        from: node.moduleSpecifier.getText(source),
        name: (item.propertyName ?? item.name).getText(source),
      });
    }
  }
  const edits = [];
  for (const node of source.statements.filter(ts.isExportDeclaration)) {
    if (!node.isTypeOnly || node.moduleSpecifier || !ts.isNamedExports(node.exportClause)) continue;
    const exported = new Map();
    for (const item of node.exportClause.elements) {
      const binding = imports.get((item.propertyName ?? item.name).text);
      const name = item.name.getText(source);
      const from = binding?.from ?? "";
      const text = binding
        ? binding.name === name
          ? name
          : `${binding.name} as ${name}`
        : item.getText(source);
      const names = exported.get(from) ?? [];
      names.push(text);
      exported.set(from, names);
    }
    if (exported.size === 0 || (exported.size === 1 && exported.has(""))) continue;
    const lines = [...exported].map(
      ([from, names]) => `export type { ${names.join(", ")} }${from ? ` from ${from}` : ""};`,
    );
    const start = node.getStart(source);
    edits.push({ span: { start, length: node.end - start }, newText: lines.join("\n") });
  }
  return parse(source.fileName, replace(source.text, edits));
}

function liftClient(source, { name, request, keep, groups }) {
  const client = source.statements.find((node) => nameOf(node) === name);
  if (
    !client ||
    !ts.isClassDeclaration(client) ||
    client.heritageClauses ||
    client.typeParameters
  ) {
    throw new Error(`${source.fileName}: expected a client class named ${name}`);
  }
  const memberName = (member) =>
    ts.isConstructorDeclaration(member) ? "constructor" : nameOf(member);
  const members = new Map(client.members.map((member) => [memberName(member), member]));
  const assignments = [...keep, ...Object.values(groups).flat()];
  if (members.size !== client.members.length || new Set(assignments).size !== assignments.length) {
    throw new Error(`${source.fileName}: duplicate client member`);
  }
  for (const member of assignments) {
    if (!members.has(member))
      throw new Error(`${source.fileName}: missing client member ${member}`);
  }
  for (const member of members.keys()) {
    if (!assignments.includes(member)) {
      throw new Error(`${source.fileName}: unmapped client member ${member}`);
    }
  }

  const constructor = members.get("constructor");
  if (!constructor?.body || !keep.includes("constructor")) {
    throw new Error(`${source.fileName}: keep the client constructor`);
  }
  const classes = [];
  const cuts = [];
  let parent;
  for (const [group, names] of Object.entries(groups)) {
    const included = client.members.filter((member) => names.includes(memberName(member)));
    const methods = included.map((member) => {
      const cut = lineSpan(source, member);
      cuts.push({ span: cut, newText: "" });
      return source.text.slice(cut.start, cut.start + cut.length);
    });
    const header = parent ? ` extends ${parent}` : "";
    const forward = parent ? "    super(request);\n" : "";
    classes.push(
      [
        `export class ${group}${header} {`,
        `  readonly #request: ${request};`,
        `  constructor(request: ${request}) {`,
        `${forward}    this.#request = request;`,
        "  }",
        ...methods,
        "}",
      ].join("\n"),
    );
    parent = group;
  }
  cuts.push(
    { span: { start: client.name.end, length: 0 }, newText: ` extends ${parent}` },
    {
      span: { start: constructor.body.getStart(source) + 1, length: 0 },
      newText: `\n    super(<T,>(...args: Parameters<${request}>) => this.#request<T>(...args));`,
    },
  );
  cuts.sort((left, right) => left.span.start - right.span.start);
  return parse(source.fileName, [replace(source.text, cuts).trimEnd(), ...classes].join("\n\n"));
}

function localModule(from, specifier) {
  if (!specifier.text.startsWith(".")) return undefined;
  return resolve(dirname(from), specifier.text.replace(/\.js$/, ".ts"));
}

function inlineImport(node) {
  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
    const { literal } = node.argument;
    if (ts.isStringLiteral(literal)) return literal;
  }
}

function relativeImport(from, target) {
  const path = relative(dirname(from), target).replace(/\.ts$/, ".js");
  return path.startsWith("../") ? path : `./${path}`;
}

function redirectInlineImports(project, source, targets) {
  const destinations = new Map(
    Object.entries(targets).flatMap(([file, names]) => names.map((name) => [name, file])),
  );
  for (const file of project.service.getProgram().getSourceFiles()) {
    if (file.isDeclarationFile) continue;
    const edits = [];
    function visit(node) {
      const specifier = inlineImport(node);
      if (specifier && localModule(file.fileName, specifier) === source) {
        let qualifier = node.qualifier;
        while (qualifier && ts.isQualifiedName(qualifier)) qualifier = qualifier.left;
        const to = destinations.get(qualifier?.text);
        if (to) {
          const start = specifier.getStart(file);
          edits.push({
            span: { start, length: specifier.end - start },
            newText: JSON.stringify(relativeImport(file.fileName, to)),
          });
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(file);
    if (edits.length) project.set(file.fileName, replace(file.text, edits));
  }
}

function markTypeImports(project, modules) {
  const program = project.service.getProgram();
  const checker = program.getTypeChecker();
  for (const file of project.changed.keys()) {
    const source = program.getSourceFile(file);
    const edits = [];
    for (const node of source.statements.filter(ts.isImportDeclaration)) {
      const { importClause: clause, moduleSpecifier } = node;
      if (!clause || clause.isTypeOnly || !modules.has(localModule(file, moduleSpecifier)))
        continue;
      const bindings = clause.namedBindings;
      if (!bindings || !ts.isNamedImports(bindings)) continue;
      const typeNames = bindings.elements.filter((element) => {
        const alias = checker.getSymbolAtLocation(element.name);
        const target = alias && checker.getAliasedSymbol(alias);
        return (
          !element.isTypeOnly &&
          target?.declarations?.length &&
          !(target.flags & ts.SymbolFlags.Value)
        );
      });
      if (typeNames.length === bindings.elements.length && !clause.name && typeNames.length) {
        edits.push({ span: { start: clause.getStart(source), length: 0 }, newText: "type " });
      } else {
        for (const name of typeNames) {
          edits.push({ span: { start: name.getStart(source), length: 0 }, newText: "type " });
        }
      }
    }
    if (edits.length) project.set(file, replace(source.text, edits));
  }
}

function verifyClientImports(source, targets, allowedType, readFile) {
  const files = new Set([source, ...Object.keys(targets)]);
  const checked = new Set();
  const visiting = new Set();
  function visit(file) {
    if (checked.has(file)) return;
    if (visiting.has(file)) {
      throw new Error(
        `client import cycle: ${[...visiting, file].map((path) => relative(dirname(source), path)).join(" -> ")}`,
      );
    }
    visiting.add(file);
    function walk(node) {
      const specifier =
        ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
          ? node.moduleSpecifier
          : inlineImport(node);
      if (specifier && ts.isStringLiteral(specifier)) {
        const imported = localModule(file, specifier);
        const importedNames = node.importClause?.namedBindings;
        const permitted =
          file === allowedType?.file &&
          imported === source &&
          node.importClause?.isTypeOnly &&
          !node.importClause.name &&
          importedNames &&
          ts.isNamedImports(importedNames) &&
          importedNames.elements.length === 1 &&
          importedNames.elements[0].name.text === allowedType.name;
        if (files.has(imported) && !permitted) visit(imported);
      }
      ts.forEachChild(node, walk);
    }
    walk(parse(file, readFile(file)));
    visiting.delete(file);
    checked.add(file);
  }
  for (const file of files) visit(file);
}

function verifyClientRuntimeImports(source, targets, readFile) {
  const dependencies = new Map();
  function imports(file) {
    if (!dependencies.has(file)) {
      const text = readFile(file);
      const imported = [];
      if (text !== undefined) {
        for (const node of parse(file, text).statements) {
          const specifier =
            (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) ||
            (ts.isExportDeclaration(node) && !node.isTypeOnly)
              ? node.moduleSpecifier
              : undefined;
          if (specifier && ts.isStringLiteral(specifier)) {
            const target = localModule(file, specifier);
            if (target) imported.push(target);
          }
        }
      }
      dependencies.set(file, imported);
    }
    return dependencies.get(file);
  }

  for (const root of [source, ...Object.keys(targets)]) {
    const seen = new Set();
    function visit(file, trail) {
      if (file === root && trail.length) {
        throw new Error(
          `client import cycle: ${[...trail, file].map((path) => relative(dirname(source), path)).join(" -> ")}`,
        );
      }
      if (seen.has(file)) return;
      seen.add(file);
      for (const imported of imports(file)) visit(imported, [...trail, file]);
    }
    visit(root, []);
  }
}

function clientMethods(source, name) {
  const declaration = source.statements.find((node) => nameOf(node) === name);
  return declaration.members.filter(ts.isMethodDeclaration).map((method) => method.getText(source));
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
      const from = relativeImport(file.fileName, target);
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
    const mounts = new Map();
    const formatFile = async (file, text) =>
      format(text, { ...(await resolveConfig(file)), filepath: file });
    const operations = [];
    const clients = [];
    for (const { source, targets, keep = [], lift, classLift } of map.moves) {
      const file = resolve(root, source);
      let original = parse(file, project.readFile(file));
      if (lift) {
        original = liftRoutes(original, lift);
        const node = original.statements.find((statement) => nameOf(statement) === lift.mount);
        const { start, end } = span(original, node);
        const formattedMount = parse(file, await formatFile(file, original.text.slice(start, end)));
        mounts.set(
          file,
          new Map([[lift.mount, [snapshot(formattedMount, formattedMount.statements[0])]]]),
        );
      }
      if (classLift) {
        original = liftClient(retainTypeReexports(original), classLift);
        const destinations = Object.fromEntries(
          Object.entries(targets).map(([target, names]) => [resolve(root, target), names]),
        );
        const methods = new Map([
          [file, [classLift.name, clientMethods(original, classLift.name)]],
        ]);
        for (const name of Object.keys(classLift.groups)) {
          const target = Object.keys(destinations).find((path) =>
            destinations[path].includes(name),
          );
          methods.set(target, [name, clientMethods(original, name)]);
        }
        const allowedType = classLift.allowClientTypeFrom && {
          file: resolve(root, classLift.allowClientTypeFrom),
          name: classLift.name,
        };
        clients.push({ file, destinations, methods, allowedType });
      }
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
    for (const { file, destinations } of clients) {
      redirectInlineImports(project, file, destinations);
      markTypeImports(project, new Set(Object.keys(destinations)));
      const importChanges = project.service.organizeImports(
        { type: "file", fileName: file, mode: ts.OrganizeImportsMode.RemoveUnused },
        {},
        {},
      );
      for (const { fileName, textChanges } of importChanges) {
        project.set(fileName, replace(project.readFile(fileName), textChanges));
      }
    }
    verifyMoves(expected, project.readFile);
    const formatted = new Map();
    for (const [file, { text }] of project.changed) {
      formatted.set(file, await formatFile(file, text));
    }
    verifyMoves(expected, (file) => formatted.get(file));
    verifyMoves(mounts, (file) => formatted.get(file));
    for (const { file, destinations, methods, allowedType } of clients) {
      for (const [target, [name, originals]] of methods) {
        const actual = clientMethods(parse(target, formatted.get(target)), name);
        if (JSON.stringify(actual) !== JSON.stringify(originals)) {
          throw new Error(`${target}: ${name} changed a method signature or body`);
        }
      }
      verifyClientImports(file, destinations, allowedType, (path) => formatted.get(path));
      verifyClientRuntimeImports(
        file,
        destinations,
        (path) => formatted.get(path) ?? project.readFile(path),
      );
    }

    for (const [file, text] of formatted) writeFileSync(file, text);
    return [...formatted.keys()];
  } finally {
    project.service.dispose();
  }
}

if (import.meta.main) await main(process.argv.slice(2), process.cwd());
