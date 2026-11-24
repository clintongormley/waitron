// Cloud fixture map: fiscal_allocations becomes verifactu_identities with event_key not null.
// taxpayer_nif -> nif, software_id -> id_sistema_informatico, installation_identity ->
// numero_instalacion, sif_id -> id, activated_at -> registrado_en. The other columns keep their names.
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, writeFileSync } from "node:fs";
import { posix, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const oldName = /\b(?:fiscalAllocations|fiscal_allocations)\b/;
const testHelper = "packages/fiscal-verifactu/test/allocation-rows.js";

function method(node, name, argumentCount) {
  return (
    ts.isCallExpression(node) &&
    !node.questionDotToken &&
    ts.isPropertyAccessExpression(node.expression) &&
    !node.expression.questionDotToken &&
    node.expression.name.text === name &&
    node.arguments.length === argumentCount
  );
}

function helperImport(file) {
  if (!file.startsWith("packages/fiscal-verifactu/"))
    return "@waitron/fiscal-verifactu/test/allocation-rows.js";
  const path = posix.relative(posix.dirname(file), testHelper);
  return path.startsWith(".") ? path : "./" + path;
}

export function rewriteSource(file, input) {
  const ast = ts.createSourceFile(file, input, ts.ScriptTarget.Latest, true);
  const edits = [];
  const tableImports = [];
  let helperImported = false;
  for (const statement of ast.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const named = statement.importClause?.namedBindings;
    if (!named || !ts.isNamedImports(named)) continue;
    if (named.elements.some(({ name }) => name.text === "fiscalAllocations"))
      tableImports.push({ statement, named });
    if (named.elements.some(({ name }) => name.text === "allocationRows")) helperImported = true;
  }
  let otherUses = false;
  function visit(node) {
    if (ts.isImportDeclaration(node)) return;
    if (method(node, "from", 1) && node.arguments[0].getText(ast) === "fiscalAllocations") {
      const select = node.expression.expression;
      const chained =
        ts.isPropertyAccessExpression(node.parent) || ts.isElementAccessExpression(node.parent);
      if (!chained && method(select, "select", 0)) {
        const receiver = select.expression.expression.getText(ast);
        edits.push([node.getStart(ast), node.end, `allocationRows(${receiver})`]);
        return;
      }
    }
    if (ts.isIdentifier(node) && node.text === "fiscalAllocations") otherUses = true;
    ts.forEachChild(node, visit);
  }
  if (tableImports.length) visit(ast);
  if (edits.length) {
    if (!otherUses)
      for (const { statement, named } of tableImports) {
        const remaining = named.elements.filter(({ name }) => name.text !== "fiscalAllocations");
        if (remaining.length)
          edits.push([
            named.getStart(ast),
            named.end,
            `{ ${remaining.map((e) => e.getText(ast)).join(", ")} }`,
          ]);
        else edits.push([statement.getStart(ast), statement.end + 1, ""]);
      }
    if (!helperImported)
      edits.push([0, 0, `import { allocationRows } from "${helperImport(file)}";\n`]);
  }
  let text = input;
  for (const [start, end, replacement] of edits.sort((a, b) => b[0] - a[0] || b[1] - a[1]))
    text = text.slice(0, start) + replacement + text.slice(end);
  const manual = text.split("\n").flatMap((line, index) => (oldName.test(line) ? [index + 1] : []));
  return { text, manual };
}

function main(args) {
  if (args.length && (args.length !== 1 || args[0] !== "--check"))
    throw new Error("usage: fiscal-allocations-fold.mjs [--check]");
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    env,
    encoding: "utf8",
  }).trim();
  const files = execFileSync("git", ["ls-files", "-z", "--", "apps", "packages"], {
    cwd: root,
    env,
    encoding: "utf8",
  }).split("\0");
  let exitCode = 0;
  for (const file of files) {
    if (!file.endsWith(".ts")) continue;
    const path = resolve(root, file);
    if (!lstatSync(path, { throwIfNoEntry: false })?.isFile()) continue;
    const input = readFileSync(path, "utf8");
    if (!oldName.test(input)) continue;
    const { text, manual } = rewriteSource(file, input);
    for (const line of manual)
      console.log(file + ":" + line + ": allocation reference needs a hand edit");
    if (text === input) continue;
    if (args.length) {
      console.error(file + ": bare allocation reads still need rewriting");
      exitCode = 1;
    } else writeFileSync(path, text);
  }
  return exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = main(process.argv.slice(2));
