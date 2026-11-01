import { readFileSync, writeFileSync } from "node:fs";
import { posix } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

// Moves a test file onto the shared venue seed helpers (A1301 F1): `seedVenue` for its one
// `locations` row, `seedNode`/`seedDevice` without a location, `seedWorkingOrder` for an order.
// Every rule applies only to a file holding exactly one `locations` insert; what it cannot rewrite
// it reports as `path:line: reason` for a hand edit. It splices text by node positions and never
// reprints the tree, so `prettier --write` tidies afterwards.
//
// Usage: node scripts/a1301-seed-codemod.mjs [--write] <file…>   (without --write, writes nothing)

// The `Venue` interface's fields in packages/db/src/venue.ts, plus the row's `id` and the
// `catalogueId` column that `seedVenue` takes as `defaultCatalogueId`.
const VENUE_KEYS = new Set([
  "id",
  "catalogueId",
  "name",
  "invoiceLocales",
  "operationDescription",
  "fiscalTerritory",
  "addressLine1",
  "addressLine2",
  "postalCode",
  "city",
  "province",
  "timeZone",
  "dayCutover",
  "defaultCatalogueId",
]);

/** Import names the rewrite may leave unused; removed only when they were used before it. */
const REMOVABLE_IMPORTS = new Set(["locations", "workingOrders", "locationId", "LocationId"]);

const RAW_INSERT = /insert\s+into\s+"?(locations|tenants)"?\b/i;

const REASON = {
  fiscal: "fiscal pair file: never rewritten",
  rawSql: "raw SQL insert into locations",
  tenants: "writes its own tenants row",
  localSeedVenue: "defines its own seedVenue: no import added",
  array: "values([…]) array: not rewritten",
  spread: "spread element in values: not rewritten",
  computed: "computed key in values: not rewritten",
  locationShape: "locations insert in a shape the codemod does not rewrite",
  orderShape: "workingOrders insert in a shape the codemod does not rewrite",
  orderNoLocation: "workingOrders insert without a locationId key",
  idNotConst: "id is not a module-level const",
};

function isFiscalPair(file) {
  return (
    file.endsWith("packages/fiscal-verifactu/src/write-path.e2e.test.ts") ||
    posix.basename(file).includes("inmutabilidad")
  );
}

function parse(file, source) {
  const kind = /\.m?js$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
}

function walk(node, visit) {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

function applyEdits(text, edits, offset = 0) {
  let out = text;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, edit.start - offset) + edit.text + out.slice(edit.end - offset);
  }
  return out;
}

/** The table an `R.insert(T)` call writes, when `T` is `name` or `schema.name`. */
function insertTable(node) {
  if (
    !ts.isCallExpression(node) ||
    !ts.isPropertyAccessExpression(node.expression) ||
    node.expression.name.text !== "insert" ||
    node.arguments.length !== 1
  ) {
    return undefined;
  }
  const [table] = node.arguments;
  if (ts.isIdentifier(table)) return table.text;
  if (ts.isPropertyAccessExpression(table) && ts.isIdentifier(table.expression)) {
    return table.expression.text === "schema" ? table.name.text : undefined;
  }
  return undefined;
}

/** `R.insert(T).values(arg)`, optionally `.tail(…)`, under an `await`. */
function valuesChain(insert) {
  const access = insert.parent;
  if (!ts.isPropertyAccessExpression(access) || access.name.text !== "values") return undefined;
  const valuesCall = access.parent;
  if (!ts.isCallExpression(valuesCall) || valuesCall.arguments.length !== 1) return undefined;
  let end = valuesCall;
  let tail;
  const next = valuesCall.parent;
  if (ts.isPropertyAccessExpression(next) && ts.isCallExpression(next.parent)) {
    tail = next.name.text;
    end = next.parent;
  }
  if (!ts.isAwaitExpression(end.parent)) return undefined;
  return { arg: valuesCall.arguments[0], tail, awaitNode: end.parent };
}

/** The statement holding `await <chain>`: a plain statement, or `const [B] = await <chain>`. */
function statementOf(awaitNode) {
  const parent = awaitNode.parent;
  if (ts.isExpressionStatement(parent)) return { statement: parent, start: awaitNode.getStart() };
  if (!ts.isVariableDeclaration(parent) || !ts.isArrayBindingPattern(parent.name)) return undefined;
  const list = parent.parent;
  const elements = parent.name.elements;
  if (
    !(list.flags & ts.NodeFlags.Const) ||
    list.declarations.length !== 1 ||
    elements.length !== 1 ||
    !ts.isBindingElement(elements[0]) ||
    !ts.isIdentifier(elements[0].name)
  ) {
    return undefined;
  }
  return { statement: list.parent, start: list.parent.getStart(), binding: elements[0].name.text };
}

function keyOf(property) {
  return property.name && !ts.isComputedPropertyName(property.name)
    ? property.name.text
    : undefined;
}

/** Why an object literal's properties cannot be carried over, or undefined when they can. */
function propertyProblem(object, allowed) {
  for (const property of object.properties) {
    if (ts.isSpreadAssignment(property)) return REASON.spread;
    const key = keyOf(property);
    if (key === undefined) return REASON.computed;
    if (allowed && !allowed.has(key)) return `key outside the Venue set (${key}): not rewritten`;
  }
  return undefined;
}

/** The span that removes element `index` of a comma-separated list, with its comma. */
function elementSpan(list, index) {
  const element = list[index];
  return index < list.length - 1
    ? { start: element.getStart(), end: list[index + 1].getStart() }
    : { start: list[index - 1].end, end: element.end };
}

function isReference(node) {
  const parent = node.parent;
  if (parent.name === node && !ts.isShorthandPropertyAssignment(parent)) return false;
  if (ts.isBindingElement(parent) && parent.propertyName === node) return false;
  if (ts.isQualifiedName(parent) && parent.right === node) return false;
  return true;
}

function references(sourceFile, name) {
  const found = [];
  walk(sourceFile, (node) => {
    if (ts.isIdentifier(node) && node.text === name && !insideImport(node) && isReference(node)) {
      found.push(node);
    }
  });
  return found;
}

function insideImport(node) {
  for (let current = node; current; current = current.parent) {
    if (ts.isImportDeclaration(current)) return true;
  }
  return false;
}

function rootName(expression) {
  let current = expression;
  while (ts.isCallExpression(current) || ts.isPropertyAccessExpression(current)) {
    current = current.expression;
  }
  return current.text;
}

/** True when `node` runs as the module loads: outside every function but `describe` bodies. */
function readAtModuleLoad(node) {
  for (let current = node.parent; !ts.isSourceFile(current); current = current.parent) {
    if (!ts.isFunctionLike(current)) continue;
    const call = current.parent;
    if (!ts.isCallExpression(call) || rootName(call.expression) !== "describe") return false;
  }
  return true;
}

/** `const X = <expression>;` alone in a statement directly in the file, or undefined. */
function moduleConst(sourceFile, name) {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const list = statement.declarationList;
    const declaration = list.declarations.find(
      (candidate) => ts.isIdentifier(candidate.name) && candidate.name.text === name,
    );
    if (!declaration) continue;
    const single = list.declarations.length === 1 && declaration.initializer;
    return list.flags & ts.NodeFlags.Const && single ? statement : undefined;
  }
  return undefined;
}

function inside(node, ranges) {
  return ranges.some((range) => node.getStart() >= range.start && node.end <= range.end);
}

function lineIndent(text, position) {
  const lineStart = text.lastIndexOf("\n", position - 1) + 1;
  return /^[ \t]*/.exec(text.slice(lineStart))[0];
}

/** Whole lines from `start` to `end`, with the leading comments directly above `start`. */
function lineRemoval(text, node, withComments) {
  let start = node.getStart();
  if (withComments) {
    const comments = ts.getLeadingCommentRanges(text, node.getFullStart()) ?? [];
    for (const comment of comments.reverse()) {
      if (/\n[ \t]*\n/.test(text.slice(comment.end, start))) break;
      start = comment.pos;
    }
  }
  start = text.lastIndexOf("\n", start - 1) + 1;
  let end = node.end;
  if (text[end] === "\n") end += 1;
  if (text[end] === "\n" && text[start - 1] === "\n" && text[start - 2] === "\n") end += 1;
  return { start, end, text: "" };
}

function importSpecifiers(file) {
  const match = /(?:^|\/)packages\/db\/(.*)$/.exec(file);
  if (!match) return { seed: "@waitron/db/testing/seed.js", venue: "@waitron/db" };
  const from = posix.dirname(match[1]);
  const relative = (target) => {
    const path = posix.relative(from, target);
    return path.startsWith(".") ? path : `./${path}`;
  };
  return { seed: relative("src/testing/seed.js"), venue: relative("src/venue.js") };
}

function namedImports(declaration) {
  const bindings = declaration.importClause?.namedBindings;
  return bindings && ts.isNamedImports(bindings) ? bindings : undefined;
}

/** Removes the import specifiers the rewrite left with no reference. */
function removeEmptiedImports(original, text, file) {
  const before = parse(file, original);
  const usedBefore = new Set();
  for (const statement of before.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    for (const element of namedImports(statement)?.elements ?? []) {
      const imported = (element.propertyName ?? element.name).text;
      if (REMOVABLE_IMPORTS.has(imported) && references(before, element.name.text).length > 0) {
        usedBefore.add(element.name.text);
      }
    }
  }
  const after = parse(file, text);
  const edits = [];
  for (const statement of after.statements) {
    const named = ts.isImportDeclaration(statement) ? namedImports(statement) : undefined;
    if (!named) continue;
    const kept = named.elements.filter(
      (element) =>
        !usedBefore.has(element.name.text) || references(after, element.name.text).length > 0,
    );
    if (kept.length === named.elements.length) continue;
    if (kept.length === 0 && !statement.importClause.name) {
      edits.push(lineRemoval(text, statement, false));
    } else {
      edits.push({
        start: named.getStart(),
        end: named.end,
        text: `{ ${kept.map((element) => element.getText()).join(", ")} }`,
      });
    }
  }
  return applyEdits(text, edits);
}

/** Adds `names` (by module) to the file's imports, or as new import lines after the last one. */
function addImports(text, file, wanted, quote) {
  const sourceFile = parse(file, text);
  const imports = sourceFile.statements.filter(ts.isImportDeclaration);
  const edits = [];
  const fresh = [];
  for (const [module, names] of wanted) {
    if (names.length === 0) continue;
    const existing = imports.find(
      (statement) =>
        statement.moduleSpecifier.text === module &&
        !statement.importClause?.isTypeOnly &&
        namedImports(statement),
    );
    if (!existing) {
      fresh.push(`import { ${names.join(", ")} } from ${quote}${module}${quote};`);
      continue;
    }
    const named = namedImports(existing);
    const present = named.elements.map((element) => element.name.text);
    const missing = names.filter((name) => !present.includes(name));
    if (missing.length === 0) continue;
    const merged = named.elements.map((element) => element.getText());
    for (const name of missing) {
      const index = present.findIndex((other) => other > name);
      const at = index === -1 ? present.length : index;
      present.splice(at, 0, name);
      merged.splice(at, 0, name);
    }
    edits.push({ start: named.getStart(), end: named.end, text: `{ ${merged.join(", ")} }` });
  }
  if (fresh.length > 0) {
    const last = imports.at(-1);
    edits.push(
      last
        ? { start: last.end, end: last.end, text: fresh.map((line) => `\n${line}`).join("") }
        : { start: 0, end: 0, text: fresh.map((line) => `${line}\n`).join("") },
    );
  }
  return applyEdits(text, edits);
}

export function transformSource(path, source) {
  const file = path.replaceAll("\\", "/");
  if (isFiscalPair(file))
    return { output: source, edits: 0, left: [{ line: 1, reason: REASON.fiscal }] };
  const sourceFile = parse(file, source);
  const left = [];
  const edits = [];
  const removed = [];
  const needs = { seedVenue: false, seedWorkingOrder: false, venueLocationId: false };
  const report = (node, reason) =>
    left.push({ line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1, reason });

  const locationInserts = [];
  const rawLocations = [];
  const orderInserts = [];
  const seedNodes = [];
  const seedDevices = [];
  let ownTenants = false;
  let localSeedVenue = false;

  walk(sourceFile, (node) => {
    const table = insertTable(node);
    if (table === "locations") locationInserts.push(node);
    else if (table === "workingOrders") orderInserts.push(node);
    else if (table === "nodes" || table === "devices") report(node, `raw insert(${table})`);
    else if (table === "tenants") {
      ownTenants = true;
      report(node, REASON.tenants);
    }
    if (ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node)) {
      const raw = RAW_INSERT.exec(node.text);
      if (raw?.[1] === "locations") rawLocations.push(node);
      else if (raw) {
        ownTenants = true;
        report(node, REASON.tenants);
      }
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      if (node.expression.text === "seedNode") seedNodes.push(node);
      if (node.expression.text === "seedDevice") seedDevices.push(node);
    }
    const defined =
      (ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) &&
      node.name &&
      ts.isIdentifier(node.name) &&
      node.name.text === "seedVenue";
    if (defined) {
      localSeedVenue = true;
      report(node, REASON.localSeedVenue);
    }
  });

  for (const raw of rawLocations) report(raw, REASON.rawSql);
  const total = locationInserts.length + rawLocations.length;
  if (total > 1) {
    for (const node of [...locationInserts, ...rawLocations]) {
      report(node, `one of ${total} locations inserts: no location rule applied`);
    }
  }

  const dropArguments = (call) => {
    const span = { start: call.arguments[0].end, end: call.arguments.end, text: "" };
    edits.push(span);
    removed.push(span);
  };

  const carriedObject = (object, drop, rename) => {
    if (object.properties.length === drop.length) return undefined;
    const local = [];
    for (const property of drop) {
      local.push({
        ...elementSpan(object.properties, object.properties.indexOf(property)),
        text: "",
      });
    }
    if (rename) {
      local.push(
        ts.isShorthandPropertyAssignment(rename)
          ? {
              start: rename.name.getStart(),
              end: rename.name.end,
              text: `defaultCatalogueId: ${rename.name.text}`,
            }
          : { start: rename.name.getStart(), end: rename.name.end, text: "defaultCatalogueId" },
      );
    }
    return applyEdits(source.slice(object.getStart(), object.end), local, object.getStart());
  };

  const receiver = (insert) => insert.expression.expression.getText();
  const callText = (name, insert, object) =>
    `${name}(${receiver(insert)}${object === undefined ? "" : `, ${object}`})`;

  const rewriteOrder = (insert) => {
    const chain = valuesChain(insert);
    if (!chain) return report(insert, REASON.orderShape);
    if (ts.isArrayLiteralExpression(chain.arg)) return report(insert, REASON.array);
    if (!ts.isObjectLiteralExpression(chain.arg)) return report(insert, REASON.orderShape);
    const problem = propertyProblem(chain.arg);
    if (problem) return report(insert, problem);
    const location = chain.arg.properties.find((property) => keyOf(property) === "locationId");
    if (!location) return report(insert, REASON.orderNoLocation);
    const context = statementOf(chain.awaitNode);
    const tailOk = context?.binding
      ? chain.tail === "returning"
      : [undefined, "returning"].includes(chain.tail);
    if (!context || !tailOk) return report(insert, REASON.orderShape);
    removed.push({ start: location.getStart(), end: location.end });
    const call = `await ${callText("seedWorkingOrder", insert, carriedObject(chain.arg, [location]))}`;
    edits.push({
      start: context.start,
      end: chain.awaitNode.end,
      text: context.binding ? `const ${context.binding} = ${call}` : call,
    });
    needs.seedWorkingOrder = true;
  };

  const rewriteVenue = (insert) => {
    const chain = valuesChain(insert);
    const tailOk = [undefined, "returning", "onConflictDoNothing"].includes(chain?.tail);
    if (!chain || !tailOk) return report(insert, REASON.locationShape);
    if (ts.isArrayLiteralExpression(chain.arg)) return report(insert, REASON.array);
    const context = statementOf(chain.awaitNode);
    if (!ts.isObjectLiteralExpression(chain.arg) || !context)
      return report(insert, REASON.locationShape);
    const object = chain.arg;
    const problem = propertyProblem(object, VENUE_KEYS);
    if (problem) return report(insert, problem);
    const idProperty = object.properties.find((property) => keyOf(property) === "id");
    const catalogue = object.properties.find((property) => keyOf(property) === "catalogueId");
    const gone = [...removed];
    let constant;
    let name;
    if (idProperty) {
      const value = ts.isShorthandPropertyAssignment(idProperty)
        ? idProperty.name
        : idProperty.initializer;
      name = ts.isIdentifier(value) ? value.text : undefined;
      constant = name && moduleConst(sourceFile, name);
      if (!constant) return report(insert, REASON.idNotConst);
      gone.push({ start: idProperty.getStart(), end: idProperty.end });
    }
    if (context.binding) {
      const still = references(sourceFile, context.binding).filter((node) => !inside(node, gone));
      if (still.length > 0) return report(insert, `const [${context.binding}] is still referenced`);
    }
    let keepConstant = false;
    if (constant) {
      const still = references(sourceFile, name).filter((node) => !inside(node, gone));
      if (still.some(readAtModuleLoad)) {
        return report(insert, `${name} is read at module load, before seedVenue assigns it`);
      }
      keepConstant = still.length > 0;
      edits.push(
        keepConstant
          ? { start: constant.getStart(), end: constant.end, text: `let ${name}: string;` }
          : lineRemoval(source, constant, true),
      );
    }
    const object2 = carriedObject(object, idProperty ? [idProperty] : [], catalogue);
    edits.push({
      start: context.start,
      end: chain.awaitNode.end,
      text: `await ${callText("seedVenue", insert, object2)}`,
    });
    if (keepConstant) {
      const indent = lineIndent(source, context.statement.getStart());
      edits.push({
        start: context.statement.end,
        end: context.statement.end,
        text: `\n${indent}${name} = await venueLocationId(${receiver(insert)});`,
      });
      needs.venueLocationId = true;
    }
    needs.seedVenue = true;
  };

  let count = 0;
  if (total === 1) {
    for (const call of seedNodes) {
      if (call.arguments.length !== 2) continue;
      dropArguments(call);
      count += 1;
    }
    for (const call of seedDevices) {
      const options = call.arguments[1];
      if (!options || !ts.isObjectLiteralExpression(options)) continue;
      const index = options.properties.findIndex((property) => keyOf(property) === "locationId");
      if (index === -1) continue;
      if (options.properties.length === 1) dropArguments(call);
      else {
        const span = { ...elementSpan(options.properties, index), text: "" };
        edits.push(span);
        removed.push(span);
      }
      count += 1;
    }
    if (!localSeedVenue) {
      for (const insert of orderInserts) {
        const before = left.length;
        rewriteOrder(insert);
        if (left.length === before) count += 1;
      }
      if (!ownTenants && locationInserts.length === 1) {
        const before = left.length;
        rewriteVenue(locationInserts[0]);
        if (left.length === before) count += 1;
      }
    }
  }

  let output = removeEmptiedImports(source, applyEdits(source, edits), file);
  const modules = importSpecifiers(file);
  const firstImport = sourceFile.statements.find(ts.isImportDeclaration);
  const quote = firstImport?.moduleSpecifier.getText().startsWith("'") ? "'" : '"';
  output = addImports(
    output,
    file,
    [
      [modules.seed, ["seedVenue", "seedWorkingOrder"].filter((name) => needs[name])],
      [modules.venue, needs.venueLocationId ? ["venueLocationId"] : []],
    ],
    quote,
  );
  left.sort((a, b) => a.line - b.line);
  return { output, edits: count, left };
}

export function main(argv, { stdout = console.log } = {}) {
  const write = argv.includes("--write");
  for (const path of argv.filter((arg) => arg !== "--write")) {
    const result = isFiscalPair(path.replaceAll("\\", "/"))
      ? transformSource(path, "")
      : transformSource(path, readFileSync(path, "utf8"));
    for (const entry of result.left) stdout(`${path}:${entry.line}: ${entry.reason}`);
    stdout(`${path}: ${result.edits} edit${result.edits === 1 ? "" : "s"}`);
    if (write && result.edits > 0) writeFileSync(path, result.output);
  }
  return 0;
}

/* v8 ignore start */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
/* v8 ignore stop */
