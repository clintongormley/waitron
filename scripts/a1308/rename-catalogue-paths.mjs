import { execFileSync } from "node:child_process";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { dirname, matchesGlob, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const MOVES = [
  ["packages/catalogue/src/catalogue-items*", "packages/menu/src/product-items*"],
  ["packages/catalogue/", "packages/menu/"],
  ["apps/dashboard/src/screens/catalogue-screen*", "apps/dashboard/src/screens/products-screen*"],
  ["apps/dashboard/src/widgets/catalogue-browser*", "apps/dashboard/src/widgets/product-browser*"],
  ["apps/dashboard/src/widgets/catalogue-forms*", "apps/dashboard/src/widgets/product-forms*"],
  ["apps/server/src/catalogue-api*", "apps/server/src/menu-api*"],
  ["apps/server/src/catalogue-allergen-workflow*", "apps/server/src/menu-allergen-workflow*"],
  ["apps/server/src/catalogue-manage-permission*", "apps/server/src/menu-manage-permission*"],
  ["apps/server/scripts/demo-seed/seed-catalogue*", "apps/server/scripts/demo-seed/seed-menus*"],
  [
    "packages/composition/src/catalogue-media-backup-verification*",
    "packages/composition/src/menu-media-backup-verification*",
  ],
  ["packages/db/src/schema/catalogue/", "packages/db/src/schema/menu/"],
  ["packages/db/src/schema/catalogue.ts", "packages/db/src/schema/menus.ts"],
  ["packages/db/src/schema/catalogue.test.ts", "packages/db/src/schema/menus.test.ts"],
  ["scripts/catalogue-engine-neutral.test.ts", "scripts/menu-engine-neutral.test.ts"],
];
export const SCOPE = [
  "apps/**",
  "packages/**",
  "scripts/**",
  ".github/**",
  "package.json",
  "pnpm-workspace.yaml",
  "tsconfig*.json",
  "vitest.config.ts",
  "eslint.config.js",
  "CLAUDE.md",
  "README.md",
  "docs/developers/**",
  "docs/backlog/**",
  "docs/backlog.md",
];
export const NEVER = [
  "**/drizzle/**",
  "scripts/migration-baseline-epoch.json",
  "pnpm-lock.yaml",
  "packages/country-es/test-fixtures/**",
  "packages/country-es/src/data/sources/**",
  "apps/server/src/testing/fixtures/**",
  "scripts/a1308/**",
];

export function movedPath(path, rows = MOVES) {
  for (const [from, to] of rows) {
    if (from.endsWith("*") && path.startsWith(from.slice(0, -1)))
      return to.slice(0, -1) + path.slice(from.length - 1);
    if (from.endsWith("/") && path.startsWith(from)) return to + path.slice(from.length);
    if (path === from) return to;
  }
  return null;
}

const packageFolder = (path) => path.match(/^(?:apps|packages)\/[^/]+\//)?.[0];
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function replacePaths(text, pairs) {
  const replacements = new Map(pairs);
  if (!replacements.size) return text;
  const paths = [...replacements.keys()].sort((a, b) => b.length - a.length);
  return text.replace(
    new RegExp(`(?<![A-Za-z0-9_-])(?:${paths.map(escape).join("|")})(?![A-Za-z0-9_-])`, "g"),
    (path) => replacements.get(path),
  );
}

export function rewriteText(text, file, before, moves, rows = MOVES) {
  if (/\.(?:[cm]?ts|[cm]?js)$/.test(file)) {
    text = text.replace(
      /(\bfrom\s*|\bimport\s*(?:\(\s*)?|\bvi\.mock\s*\(\s*|\bnew\s+URL\s*\(\s*)(["'`])(\.\.?\/[^"'`\r\n]+)\2/g,
      (whole, lead, quote, specifier) => {
        const target = posix.normalize(posix.join(posix.dirname(before), specifier));
        const candidates = [
          target,
          target.replace(/\.js$/, ".ts"),
          `${target}.ts`,
          `${target}/index.ts`,
        ];
        const found = candidates.find((path) => moves.has(path));
        if (!found || (moves.get(found) === found && file === before)) return whole;
        let next = moves.get(found);
        if (specifier.endsWith(".js")) next = next.replace(/\.ts$/, ".js");
        else if (!posix.extname(specifier)) next = next.replace(/(?:\/index)?\.ts$/, "");
        next = posix.relative(posix.dirname(file), next);
        if (!next.startsWith(".")) next = `./${next}`;
        return `${lead}${quote}${next}${quote}`;
      },
    );
  }
  text = text
    .replace(/(?<![A-Za-z0-9_-])@waitron\/catalogue(?=["'`/])/g, "@waitron/menu")
    .replace(
      /(?<![A-Za-z0-9_-])@waitron\/db\/schema\/catalogue\.js(?=["'`])/g,
      "@waitron/db/schema/menu.js",
    );

  const pairs = rows.map(([from, to]) => [from.replace(/\*$/, ""), to.replace(/\*$/, "")]);
  for (const [from, to] of moves) {
    if (from === to) continue;
    pairs.push([from, to]);
  }
  // The folder spelling also appears without a slash in documentation and path assertions.
  const bareFolders = rows
    .filter(([from]) => from.endsWith("/"))
    .map(([from, to]) => [from.slice(0, -1), to.slice(0, -1)]);
  text = replacePaths(text, [...pairs, ...bareFolders]);

  const owner = packageFolder(before);
  if (owner) {
    const local = [];
    for (const [from, to] of [...pairs, ...bareFolders]) {
      if (!from.startsWith(owner) || from === owner) continue;
      const targetOwner = packageFolder(to);
      local.push([from.slice(owner.length), to.slice(targetOwner.length)]);
    }
    for (const [from, to] of moves) {
      if (from !== to && from.startsWith(owner))
        local.push([posix.basename(from), posix.basename(to)]);
    }
    text = replacePaths(text, local);
  }
  if (file === "packages/db/package.json")
    text = text.replaceAll('"./schema/catalogue.js"', '"./schema/menu.js"');
  if (file === "scripts/english-only-still-to-clean.ts")
    text = text.replace(
      /(export const STILL_TO_CLEAN[^=]*= \[\n)([\s\S]*?)(\n\];)/,
      (_whole, head, paths, tail) => head + paths.split("\n").sort().join("\n") + tail,
    );
  if (
    [
      "apps/server/test-durations.json",
      "apps/dashboard/test-durations.json",
      "packages/db/mutation-costs.json",
    ].includes(file)
  ) {
    const table = JSON.parse(text);
    text =
      JSON.stringify(
        Object.fromEntries(
          Object.keys(table)
            .sort()
            .map((path) => [path, table[path]]),
        ),
        null,
        2,
      ) + "\n";
  }
  return text;
}

export function run({ root, dryRun = false, moves: rows = MOVES }) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  const git = (...args) => execFileSync("git", args, { cwd: root, env, encoding: "utf8" });
  const tracked = git("ls-files", "-z").split("\0").filter(Boolean);
  const moves = new Map(tracked.map((path) => [path, movedPath(path, rows) ?? path]));
  const planned = [];
  for (const [from, to] of moves) {
    if (from === to) continue;
    if (existsSync(resolve(root, to))) throw new Error(`Move target exists: ${from} -> ${to}`);
    planned.push(`${from} -> ${to}`);
  }
  const moved = planned.length;
  const rewrites = [];
  for (const [before, file] of moves) {
    if (
      !SCOPE.some((glob) => matchesGlob(before, glob)) ||
      NEVER.some((glob) => matchesGlob(before, glob))
    )
      continue;
    const path = resolve(root, before);
    if (!lstatSync(path).isFile()) continue;
    const bytes = readFileSync(path);
    if (bytes.subarray(0, 8000).includes(0)) continue;
    const text = bytes.toString("utf8");
    const next = rewriteText(text, file, before, moves, rows);
    if (text === next) continue;
    const lines = text.split("\n");
    const changed = next.split("\n").filter((line, index) => line !== lines[index]).length;
    planned.push(`rewrite ${file} (${changed} changed lines)`);
    rewrites.push([file, next]);
  }
  if (!dryRun) {
    for (const [from, to] of moves) {
      if (from === to) continue;
      mkdirSync(dirname(resolve(root, to)), { recursive: true });
      git("mv", "--", from, to);
    }
    for (const [file, text] of rewrites) writeFileSync(resolve(root, file), text);
  }
  return { moved, rewrote: rewrites.length, planned };
}

export function main(args, root) {
  const dryRun = args.includes("--dry-run");
  const result = run({ root, dryRun });
  if (dryRun) for (const line of result.planned) console.log(line);
  console.log(`moved ${result.moved}, rewrote ${result.rewrote}`);
}

if (
  process.argv[1] &&
  existsSync(process.argv[1]) &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main(process.argv.slice(2), process.cwd());
