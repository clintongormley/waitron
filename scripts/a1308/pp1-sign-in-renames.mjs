import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const moves = new Map([
  [
    "packages/db/src/schema/identity/sessions.ts",
    "packages/db/src/schema/identity/till-sessions.ts",
  ],
  [
    "packages/db/src/schema/identity/management-sessions.ts",
    "packages/db/src/schema/identity/dashboard-sessions.ts",
  ],
  [
    "packages/db/src/schema/identity/management-account-actions.ts",
    "packages/db/src/schema/identity/account-actions.ts",
  ],
]);
const literals = new Set([
  "packages/db/src/classification.ts",
  "packages/identity/src/classification.ts",
  "packages/identity/src/backup-verification.ts",
  "packages/identity/src/backup-verification.test.ts",
  "packages/identity/src/schema-ownership.test.ts",
  "packages/composition/src/composition.test.ts",
  "scripts/schema-constraints.test.ts",
  "packages/db/src/schema/identity/sessions.ts",
  "apps/server/src/attendance-discovery.test.ts",
]);
const pairs = [
  ["sessions", "tillSessions"],
  ["managementSessions", "dashboardSessions"],
  ["managementAccountActions", "accountActions"],
];
const excluded =
  /^(?:packages\/store\/|apps\/dashboard\/|packages\/workforce-es\/src\/record-export|packages\/workforce\/src\/record-schema\.test\.ts|scripts\/a1308\/pp1-sign-in-renames\.)/;
function tableModule(specifier, path) {
  return (
    ["@waitron/db", "@waitron/identity", "@waitron/db/schema/identity.js"].includes(specifier) ||
    /\/schema\/identity(?:\/index)?\.js$/.test(specifier) ||
    (path === "packages/db/src/index.ts" && specifier === "./schema/index.js") ||
    /\/identity\/sessions\.js$/.test(posix.normalize(posix.join(dirname(path), specifier))) ||
    (specifier.startsWith(".") &&
      /^packages\/(?:db|identity)\/src\/index\.js$/.test(
        posix.normalize(posix.join(dirname(path), specifier)),
      ))
  );
}
function syntax(path, text) {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const host = ts.createCompilerHost({});
  host.getSourceFile = (name) => (name === path ? source : undefined);
  const checker = ts.createProgram([path], { noLib: true, noResolve: true }, host).getTypeChecker();
  return { source, checker };
}
function rewrite(path, text) {
  const { source, checker } = syntax(path, text);
  const sessionSymbols = new Set();
  const namespaces = new Set();
  const declarations = new Set();
  function collect(node) {
    if (
      ts.isIdentifier(node) &&
      node.parent.name === node &&
      (ts.isVariableDeclaration(node.parent) ||
        ts.isParameter(node.parent) ||
        ts.isImportSpecifier(node.parent) ||
        ts.isBindingElement(node.parent) ||
        ts.isFunctionDeclaration(node.parent) ||
        ts.isClassDeclaration(node.parent))
    )
      declarations.add(node.text);
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      tableModule(node.moduleSpecifier.text, path)
    ) {
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings))
        namespaces.add(checker.getSymbolAtLocation(bindings.name));
      if (bindings && ts.isNamedImports(bindings))
        for (const binding of bindings.elements)
          if (binding.name.text === "sessions" && !binding.propertyName)
            sessionSymbols.add(checker.getSymbolAtLocation(binding.name));
    }
    if (
      path === "packages/db/src/schema/identity/sessions.ts" &&
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "sessions"
    )
      sessionSymbols.add(checker.getSymbolAtLocation(node.name));
    ts.forEachChild(node, collect);
  }
  collect(source);
  const edits = [];
  function visit(node) {
    const parent = node.parent;
    if (ts.isIdentifier(node) && node.text === "sessions") {
      let rename = false;
      if (ts.isPropertyAccessExpression(parent) && parent.name === node)
        rename =
          ts.isIdentifier(parent.expression) &&
          namespaces.has(checker.getSymbolAtLocation(parent.expression));
      else if (ts.isExportSpecifier(parent)) {
        const declaration = parent.parent.parent;
        rename = declaration.moduleSpecifier
          ? tableModule(declaration.moduleSpecifier.text, path) ||
            (path === "packages/db/src/schema/identity/index.ts" &&
              declaration.moduleSpecifier.text === "./sessions.js")
          : sessionSymbols.size > 0;
      } else if (
        !(ts.isPropertyAssignment(parent) && parent.name === node) &&
        !ts.isShorthandPropertyAssignment(parent)
      )
        rename = sessionSymbols.has(checker.getSymbolAtLocation(node));
      if (rename) edits.push([node.getStart(source), node.end, "tillSessions"]);
    }
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      const raw = text.slice(node.getStart(source), node.end);
      let next = raw.replace(
        /\b(from|join|into|update|exists|table)(\s+"?)sessions\b/gi,
        "$1$2till_sessions",
      );
      if (
        (literals.has(path) || /madrid-before-move\.(?:en|es|manifest)\.json$/.test(path)) &&
        node.text === "sessions"
      )
        next = raw.replace("sessions", "till_sessions");
      if (ts.isNoSubstitutionTemplateLiteral(node) && node.text === "sessions")
        next = "`till_sessions`";
      if (
        node.text.startsWith(".") &&
        /\/identity\/sessions\.js$/.test(posix.normalize(posix.join(dirname(path), node.text)))
      )
        next = next.replace(/sessions\.js/, "till-sessions.js");
      if (next !== raw) edits.push([node.getStart(source), node.end, next]);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  let next = text;
  for (const [start, end, value] of edits.sort((a, b) => b[0] - a[0]))
    next = next.slice(0, start) + value + next.slice(end);
  next = next
    .replace(/\bmanagement_account_actions(?=_|\b)/g, "account_actions")
    .replace(/\bmanagementAccountActions\b/g, "accountActions")
    .replace(/\bmanagement_sessions(?=_|\b)/g, "dashboard_sessions")
    .replace(/\bmanagementSessions\b/g, "dashboardSessions")
    .replace(/\bmanagement-sessions\.js\b/g, "dashboard-sessions.js")
    .replace(/\bmanagement-account-actions\.js\b/g, "account-actions.js")
    .replace(/\bsessions_(open_idx|token_hash_uq|token_hash_ck)\b/g, "till_sessions_$1");
  if (/madrid-before-move\.(?:en|es|manifest)\.json$/.test(path))
    next = next.replace(/"sessions"/g, '"till_sessions"');
  const collisions = pairs.filter(
    ([oldName, target]) =>
      declarations.has(target) &&
      (oldName === "sessions"
        ? sessionSymbols.size > 0
        : new RegExp(`\\b${oldName}\\b`).test(text)),
  );
  return { next, collisions };
}

export function run({ root = process.cwd(), write = false } = {}) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  const files = execFileSync("git", ["ls-files", "-z", "apps", "packages", "scripts"], {
    cwd: root,
    env,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean);
  const changes = [];
  const collisions = [];
  for (const path of files) {
    if (
      excluded.test(path) ||
      path.includes("/drizzle/") ||
      !/\.(?:[cm]?[jt]sx?|json|txt)$/.test(path) ||
      !existsSync(join(root, path))
    )
      continue;
    const text = readFileSync(join(root, path), "utf8");
    if (
      !/sessions|managementSessions|managementAccountActions|management_account_actions/.test(text)
    )
      continue;
    const result = rewrite(path, text);
    const target = moves.get(path) ?? path;
    if (result.next !== text || target !== path) {
      if (result.collisions.length > 0) collisions.push(path);
      changes.push({ path, target, text: result.next });
    }
  }
  if (collisions.length > 0) throw new Error(`Identifier collision: ${collisions.join(", ")}`);
  if (write)
    for (const change of changes) {
      writeFileSync(join(root, change.path), change.text);
      if (change.path !== change.target)
        renameSync(join(root, change.path), join(root, change.target));
    }
  return changes.map(({ path }) => path);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const path of run({ write: process.argv.includes("--write") }))
    process.stdout.write(`${path}\n`);
}
