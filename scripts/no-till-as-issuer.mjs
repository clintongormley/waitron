import { readdirSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import ts from "typescript";

const historicalFiles = new Set([
  "docs/operations/a679-changed-checks.md",
  "docs/operations/a1154-changed-checks.md",
  "docs/developers/paper-custodian.md",
  "docs/compliance/verifactu-findings.md",
  "docs/compliance/asesor-questions.md",
  "docs/research/2026-07-20-pglite-throughput.md",
  "docs/research/2026-07-20-pglite-throughput-readme.md",
]);
const negativeSettingFiles = new Set([
  "apps/server/scripts/dev-setup.test.ts",
  "apps/server/src/boot.promote.test.ts",
  "apps/server/src/boot.setup-routes.test.ts",
  "apps/server/src/promote-endpoint-e2e.test.ts",
  "apps/server/src/restore.test.ts",
  "apps/server/src/restore-fiscal-e2e.test.ts",
  "apps/server/src/testing/stream-loop-scenario.ts",
  "apps/server/src/till-config.test.ts",
  "apps/server/src/trading-config.test.ts",
]);
const ignoredDirectories = new Set([
  ".git",
  ".superpowers",
  "node_modules",
  "dist",
  "coverage",
  ".vitest-reports",
  "test-results",
  "playwright-report",
  ".vite",
  "build",
]);
const textExtensions = /\.(?:[cm]?[jt]sx?|json|md|sh|ya?ml|txt|html|sql)$/;

export function sourceFilesIn(root, directory = "") {
  return readdirSync(join(root, directory), { withFileTypes: true })
    .flatMap((entry) => {
      const path = posix.join(directory, entry.name);
      if (entry.isDirectory())
        return ignoredDirectories.has(entry.name) ? [] : sourceFilesIn(root, path);
      return entry.isFile() && textExtensions.test(entry.name) ? [path] : [];
    })
    .sort();
}

// `\b` sees no word start after the letter of an escape such as `\n`, so the lookbehind accepts one.
const retiredSpellings = [
  /(?:\b|(?<=\\[bfnrtv0]))(?:register|provision)(?:-|)till\b/gi,
  /(?:\b|(?<=\\[bfnrtv0]))re(?:-)register\b/g,
  /(?:\b|(?<=\\[bfnrtv0]))WAITRON_TILL_(?:SERIES|TILL|NODE|LOCATION)_ID\b/g,
  /(?:\b|(?<=\\[bfnrtv0]))WAITRON_(?:LOCATION)_ID\b/g,
];
const retiredIn = (text) => retiredSpellings.flatMap((pattern) => text.match(pattern) ?? []);

// Decodes escapes as TypeScript does, keeping the backslash where TypeScript may keep one (a
// malformed \x, \u or \u{}, \8, \9), so a file whose decoded text holds no retired spelling has no
// string value that does.
const escapeSequence =
  /\\(?:x([\dA-Fa-f]{2})|u\{([\dA-Fa-f]+)\}|u([\dA-Fa-f]{4})|([0-3][0-7]{0,2}|[4-7][0-7]?)|(\r\n|[\n\r\u2028\u2029])|([^]))/g;
const singleEscapes = { b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v" };
function decodeEscapes(source) {
  return source.replace(escapeSequence, (_, hex, braced, unicode, octal, lineBreak, other) => {
    if (lineBreak) return "";
    if (other) return singleEscapes[other] ?? (/[xu89]/.test(other) ? `\\${other}` : other);
    if (octal) return String.fromCharCode(parseInt(octal, 8));
    const code = parseInt(hex ?? braced ?? unicode, 16);
    return code <= 0x10ffff ? String.fromCodePoint(code) : _;
  });
}

export function inspectSource(path, source) {
  if (
    path.startsWith("docs/superpowers/") ||
    historicalFiles.has(path) ||
    /^(?:packages|apps)\/[^/]+\/drizzle\//.test(path)
  )
    return [];
  const failures = [];
  const checkSpellings = (text) => {
    for (const spelling of retiredIn(text)) {
      if (/^WAITRON_TILL_(?:SERIES|TILL)_ID$/.test(spelling) && negativeSettingFiles.has(path))
        continue;
      failures.push(`${path}: retired ${spelling}`);
    }
  };
  checkSpellings(`${path}\n${source}`);
  let parsed;
  const tree = () => (parsed ??= ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true));
  if (/\.[cm]?[jt]sx?$/.test(path) && retiredIn(decodeEscapes(source)).length > 0) {
    const visit = (node) => {
      if (ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node))
        checkSpellings(node.text);
      ts.forEachChild(node, visit);
    };
    visit(tree());
  }
  if (/^packages\/fiscal(?:-[^/]+)?\/.*\.[cm]?[jt]sx?$/.test(path)) {
    const visit = (node) => {
      if ((ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) && /till/i.test(node.text))
        failures.push(`${path}: fiscal identifier ${node.text}`);
      ts.forEachChild(node, visit);
    };
    visit(tree());
  }
  return [...new Set(failures)];
}

export function scanTree(root) {
  return sourceFilesIn(root).flatMap((path) =>
    inspectSource(path, readFileSync(join(root, path), "utf8")),
  );
}

export function inspectTables(tables) {
  const owners = new Set(["invoice_series", "registro_sif", "cadenas"]);
  return tables.flatMap(({ name, columns, keys }) => {
    const failures = columns
      .filter((column) => /till/i.test(column))
      .map((column) => `${name}: fiscal till column ${column}`);
    if (owners.has(name)) {
      if (!columns.includes("node_id")) failures.push(`${name}: missing node_id`);
      else if (!keys.some((key) => key.includes("node_id")))
        failures.push(`${name}: missing node ownership key`);
      if (keys.some((key) => key.some((column) => /device/i.test(column))))
        failures.push(`${name}: device ownership key`);
    }
    return failures;
  });
}
