/**
 * Weaker than its name: reads TEXT, seeing only a const holding a whole state name or a join from
 * a variable ending in stateDir. Arrays, objects, differently named roots, names assembled from
 * pieces and shell escape it; it checks declarations, never whether the resulting path is right.
 * Its scanner can also misread comment-like text inside a regular expression or template and hide
 * later definitions.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";
import * as layout from "../packages/store/src/state-layout.js";
const { CLOUD_DIR, RESET_KEPT, STATE_LAYOUT } = layout;

const ROOT = join(import.meta.dirname, "..");
const LAYOUT = "packages/store/src/state-layout.ts";
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const names = [
  ...STATE_LAYOUT.map((entry) => entry.name).filter((name) => /[.\-/]/.test(name)),
  ...Object.values(layout).filter(
    (value): value is string => typeof value === "string" && value.startsWith(`${CLOUD_DIR}/`),
  ),
];
const quotedNames = names.map(escaped).join("|");
const definitions = new RegExp(
  String.raw`\bconst\s+[A-Za-z_$][\w$]*\s*(?::[^=]+)?=\s*["'\x60](?:${quotedNames})["'\x60]|\bjoin\(\s*[\w$.#]*stateDir\s*,\s*["'\x60](?:${quotedNames}|stream|handover|tls|venue|records|logs|cloud)["'\x60]`,
  "gi",
);

function withoutComments(text: string): string {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    text,
  );
  let result = "";
  let end = 0;
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    const start = scanner.getTokenPos();
    const next = scanner.getTextPos();
    result += text.slice(end, start);
    const value = text.slice(start, next);
    result +=
      token === ts.SyntaxKind.SingleLineCommentTrivia ||
      token === ts.SyntaxKind.MultiLineCommentTrivia
        ? value.replace(/[^\r\n]/g, " ")
        : value;
    end = next;
  }
  return result + text.slice(end);
}

function strays(path: string, text: string): string[] {
  if (path === LAYOUT) return [];
  const code = withoutComments(text);
  return [...code.matchAll(definitions)].map(
    (match) => `${path}:${code.slice(0, match.index).split("\n").length}: ${match[0]}`,
  );
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (
      ["node_modules", "dist", "testing", "test"].includes(entry.name) ||
      entry.name.startsWith(".")
    )
      return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!entry.isFile() || !entry.name.endsWith(".ts") || /(?:\.test|\.d)\.ts$/.test(entry.name))
      return [];
    const local = relative(ROOT, path);
    return /^apps\/[^/]+\/scripts\/.*-fixture\.ts$/.test(local) ||
      local === "apps/server/src/handover-manifest.ts"
      ? []
      : [path];
  });
}

function resetKept(text: string): string[] {
  const line = text.split("\n").find((line) => /find .* -exec rm/.test(line));
  expect(line, "plain reset find command").toBeDefined();
  return [...line!.matchAll(/! -name ([\w-]+)/g)].map((match) => match[1]).sort();
}

it("only the layout module defines a state name", () => {
  const paths: string[] = [];
  for (const top of ["apps", "packages"]) {
    for (const entry of readdirSync(join(ROOT, top), { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === "print-agent") continue;
      for (const child of top === "apps" ? ["src", "scripts"] : ["src"]) {
        const dir = join(ROOT, top, entry.name, child);
        try {
          if (statSync(dir).isDirectory()) paths.push(...sourceFiles(dir));
        } catch {
          /* No source folder. */
        }
      }
    }
  }
  const hits = paths.flatMap((path) => strays(relative(ROOT, path), readFileSync(path, "utf8")));
  expect(hits).toEqual([]);
});

it("waitron.sh's plain reset keeps exactly the layout's kept entries", () => {
  expect(resetKept(readFileSync(join(ROOT, "deploy/waitron.sh"), "utf8"))).toEqual(
    [...RESET_KEPT].sort(),
  );
});

it("reports definitions but accepts comments, format items and the layout module", () => {
  const text =
    'export const NEW_NAME = "spare-space.released";\nconst p = join(deps.stateDir, "tls");\n// we write "secrets.env" here\n/* join(stateDir, "trading.env") */\nconst item = { item: "secrets.env" };';
  expect(strays("apps/server/src/example.ts", text)).toEqual([
    'apps/server/src/example.ts:1: const NEW_NAME = "spare-space.released"',
    'apps/server/src/example.ts:2: join(deps.stateDir, "tls"',
  ]);
  expect(strays(LAYOUT, text)).toEqual([]);
  expect(strays("apps/server/src/example.ts", text.split("\n").slice(2).join("\n"))).toEqual([]);
});

it("detects an extra reset keep name and accepts exactly the retained folders", () => {
  expect(resetKept('find "$STATE" ! -name tls ! -name records ! -name old -exec rm')).not.toEqual(
    [...RESET_KEPT].sort(),
  );
  expect(resetKept('find "$STATE" ! -name tls ! -name records -exec rm')).toEqual([
    "records",
    "tls",
  ]);
});

it("reports Cloud folder and child definitions while accepting other roots and format items", () => {
  const text =
    'const root = join(stateDir, "cloud");\nconst file = join(deps.stateDir, "cloud/connection.json");\nconst key = "cloud/staff.key";';
  expect(strays("apps/server/src/example.ts", text)).toEqual([
    'apps/server/src/example.ts:1: join(stateDir, "cloud"',
    'apps/server/src/example.ts:2: join(deps.stateDir, "cloud/connection.json"',
    'apps/server/src/example.ts:3: const key = "cloud/staff.key"',
  ]);
  expect(
    strays(
      "apps/server/src/example.ts",
      'const label = "Cloud"; const path = join(archiveDir, "cloud"); const item = { item: "cloud/connection.json" };',
    ),
  ).toEqual([]);
  expect(strays(LAYOUT, text)).toEqual([]);
});
