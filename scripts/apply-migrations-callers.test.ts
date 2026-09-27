import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Every product call to `applyMigrations` passes a `migrationOptionsFor(...)` result, because that
 * is what carries each set's `appendOnlyTables`: `applyMigrations` reads the field as `?? []`
 * (`packages/migrations/src/apply.ts`), so a caller handing over a plain `MigrationOptions[]` gets a
 * migrated database with no append-only triggers, `registros_facturacion`'s among them, and nothing
 * says so.
 *
 * It parses each file with the TypeScript compiler and accepts the options argument only as a
 * direct `migrationOptionsFor(...)` call, or as a name declared exactly once in the file, by a
 * `const` whose initialiser is that call. The function must be the one imported by name from
 * `@waitron/migrations`, and scopes are not resolved: if the file binds that local name anywhere
 * else — a function, a parameter, a variable, a class, another import — every call through it is
 * reported. Anything else it recognises is reported rather than guessed at: a parameter, a `let`,
 * a filtered or spread result, and `applyMigrations` renamed or handed on as a value.
 * `m["applyMigrations"]` (or with a backquoted name) is judged as `m.applyMigrations` is, and the
 * name written as a string in an import or export, or as a destructuring declaration's key, quoted
 * or computed, is judged as the bare name is. It is weaker than its name in these ways:
 *
 * 1. **It trusts `migrationOptionsFor`.** It checks the call's SHAPE, not what the function returns.
 *    `scripts/append-only-triggers.test.ts` pins the tables `orderedMigrationSets(ALL_MODULES)`
 *    declares and migrates with all of those sets; it never sees what any one caller passes.
 * 2. **It never reads the argument handed to `migrationOptionsFor`.** A subset of the sets passes
 *    — five demo scripts under `apps/server/scripts/` pass `manifestSets().filter(...)` — and so
 *    would hand-built sets whose `appendOnlyTables` is `[]`.
 * 3. **A const it accepts can still be changed before the call** — an element's `appendOnlyTables`
 *    overwritten, or the array emptied in place. It reads the declaration, not what happens to the
 *    value afterwards.
 * 4. **Through `??`, `||` or a conditional it judges only the options, never the other operand.**
 *    `apps/server/src/restore.ts` calls `(deps.migrate ?? applyMigrations)(…)`, and
 *    `apps/server/src/rejoin-command.ts` uses `deps.migrate ?? (…)`, so a function injected as
 *    `deps.migrate` runs unseen. On 2026-09-27
 *    `git grep -n "migrate:" -- apps packages ':!*.test.*'` printed nothing; without the exclusion
 *    every line it printed was in a `*.test.ts` file.
 * 5. **It sees `applyMigrations` alone.** A path that migrates without it — `runMigrations` from
 *    `@waitron/db` called directly, as `useVenueDb` does in `packages/db/src/testing/venue-db.ts` —
 *    is invisible to it.
 * 6. **Two destructuring shapes pass it on unseen.** An ASSIGNMENT that renames it —
 *    `({ applyMigrations: migrate } = mod)`, the key bare, quoted or computed — and a binding,
 *    object or array, that takes it as a default: `const { x = applyMigrations } = mod`,
 *    `const [migrate = applyMigrations] = []`.
 * 7. **A name computed at run time is invisible** — `m[key]`, a concatenated key,
 *    `Reflect.get(m, "applyMigrations")`; only a literal string in brackets is judged.
 * 8. **Its scope is non-test `.ts`/`.js` source (with the `m`/`c` variants) under `packages/` and
 *    `apps/`**, and it parses only a file whose text contains the name. `scripts/`, `bench/` and
 *    `deploy/` are outside it, and so is every `*.test.*` file, where a bare array is how the
 *    no-trigger path is tested.
 */

const repoRoot = join(import.meta.dirname, "..");
const ROOTS = ["packages", "apps"];
const NAME = "applyMigrations";
const OPTIONS_FOR = "migrationOptionsFor";
const HOME = "@waitron/migrations";

interface Scan {
  /** One line per call or reference the guard could not follow to a `migrationOptionsFor(...)`. */
  readonly offences: string[];
  /** How many `applyMigrations` calls it followed to one. */
  readonly followed: number;
}

function scan(file: string, text: string): Scan {
  if (!text.includes(NAME)) return { offences: [], followed: 0 };
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const at = (node: ts.Node) =>
    `${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`;

  // Local names bound to `@waitron/migrations`' own `migrationOptionsFor`, and every other value
  // binding of every name. Scopes are not resolved: a const is trusted only when nothing else in
  // the file shares its name, and the imported factory only when nothing else in the file does.
  const optionsFor = new Set<string>();
  const declarations = new Map<string, ts.Node[]>();
  const collect = (node: ts.Node): void => {
    const factory =
      ts.isImportSpecifier(node) &&
      ts.isImportDeclaration(node.parent.parent.parent) &&
      ts.isStringLiteral(node.parent.parent.parent.moduleSpecifier) &&
      node.parent.parent.parent.moduleSpecifier.text === HOME &&
      (node.propertyName ?? node.name).text === OPTIONS_FOR;
    if (factory) optionsFor.add(node.name.text);
    else if (
      (ts.isVariableDeclaration(node) ||
        ts.isParameter(node) ||
        ts.isBindingElement(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isClassDeclaration(node) ||
        ts.isClassExpression(node) ||
        ts.isEnumDeclaration(node) ||
        ts.isModuleDeclaration(node) ||
        ts.isImportEqualsDeclaration(node) ||
        ts.isImportClause(node) ||
        ts.isNamespaceImport(node) ||
        ts.isImportSpecifier(node)) &&
      node.name !== undefined &&
      ts.isIdentifier(node.name)
    ) {
      declarations.set(node.name.text, [...(declarations.get(node.name.text) ?? []), node]);
    }
    ts.forEachChild(node, collect);
  };
  collect(source);

  const isOptionsCall = (node: ts.Node) =>
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    optionsFor.has(node.expression.text) &&
    !declarations.has(node.expression.text);

  const follows = (arg: ts.Expression): boolean => {
    if (isOptionsCall(arg)) return true;
    if (!ts.isIdentifier(arg)) return false;
    const found = declarations.get(arg.text) ?? [];
    if (found.length !== 1) return false;
    const [declaration] = found;
    return (
      ts.isVariableDeclaration(declaration!) &&
      ts.isVariableDeclarationList(declaration.parent) &&
      (declaration.parent.flags & ts.NodeFlags.Const) !== 0 &&
      declaration.initializer !== undefined &&
      isOptionsCall(declaration.initializer)
    );
  };

  const offences: string[] = [];
  let followed = 0;

  const judge = (node: ts.Identifier | ts.StringLiteralLike): void => {
    const parent =
      !ts.isIdentifier(node) &&
      ts.isComputedPropertyName(node.parent) &&
      ts.isBindingElement(node.parent.parent)
        ? node.parent.parent
        : node.parent;
    if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) {
      if (parent.propertyName && parent.propertyName.text !== parent.name.text)
        offences.push(`${at(node)} renames ${NAME}, which this guard cannot follow`);
      return;
    }
    if (ts.isBindingElement(parent)) {
      if (parent.propertyName)
        offences.push(`${at(node)} renames ${NAME}, which this guard cannot follow`);
      return;
    }
    if (
      (ts.isFunctionDeclaration(parent) ||
        ts.isPropertyAssignment(parent) ||
        ts.isPropertySignature(parent) ||
        ts.isPropertyDeclaration(parent) ||
        ts.isMethodDeclaration(parent) ||
        ts.isMethodSignature(parent)) &&
      parent.name === node
    )
      return;
    if (ts.isTypeQueryNode(parent) || ts.isQualifiedName(parent)) return;

    // The callee may be reached through `(deps.migrate ?? applyMigrations)`, so climb the
    // expressions that pass a function through unchanged before asking whether it is called.
    let current: ts.Node =
      (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
      (ts.isElementAccessExpression(parent) && !ts.isIdentifier(node))
        ? parent
        : node;
    for (;;) {
      const up: ts.Node = current.parent;
      if (
        ts.isParenthesizedExpression(up) ||
        (ts.isBinaryExpression(up) &&
          (up.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
            up.operatorToken.kind === ts.SyntaxKind.BarBarToken)) ||
        (ts.isConditionalExpression(up) && up.condition !== current)
      ) {
        current = up;
        continue;
      }
      break;
    }
    const call = current.parent;
    if (!ts.isCallExpression(call) || call.expression !== current) {
      offences.push(`${at(node)} refers to ${NAME} other than by calling it`);
      return;
    }
    const options = call.arguments[1];
    if (options !== undefined && follows(options)) followed++;
    else if (
      options !== undefined &&
      ts.isCallExpression(options) &&
      ts.isIdentifier(options.expression) &&
      optionsFor.has(options.expression.text)
    )
      offences.push(
        `${at(call)} calls ${NAME} through ${options.expression.text}, which the file also binds locally, so this guard cannot tell which one runs`,
      );
    else
      offences.push(
        `${at(call)} calls ${NAME} with ${options?.getText(source) ?? "no options"}, not a ${OPTIONS_FOR}(...) result`,
      );
  };

  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === NAME) judge(node);
    else if (ts.isStringLiteralLike(node) && node.text === NAME) {
      // Only where the string IS a name; elsewhere it is ordinary text.
      const key = ts.isComputedPropertyName(node.parent) ? node.parent : node;
      const parent = key.parent;
      if (
        (ts.isElementAccessExpression(parent) && parent.argumentExpression === node) ||
        ts.isImportSpecifier(parent) ||
        ts.isExportSpecifier(parent) ||
        (ts.isBindingElement(parent) && parent.propertyName === key)
      )
        judge(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { offences, followed };
}

function sourceFilesIn(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) out.push(...sourceFilesIn(full));
    else if (stats.isFile() && /\.[cm]?[jt]s$/.test(entry) && !/\.test\.[cm]?[jt]s$/.test(entry))
      out.push(full);
  }
  return out;
}

function scanTree(): Map<string, Scan> {
  const scans = new Map<string, Scan>();
  for (const root of ROOTS) {
    for (const full of sourceFilesIn(join(repoRoot, root))) {
      const file = relative(repoRoot, full);
      scans.set(file, scan(file, readFileSync(full, "utf8")));
    }
  }
  return scans;
}

const IMPORTS = `import { applyMigrations, migrationOptionsFor } from "@waitron/migrations";\n`;

function offencesIn(body: string, imports = IMPORTS): string[] {
  return scan("fixture.ts", imports + body).offences;
}

describe("every product call to applyMigrations carries each set's append-only tables", () => {
  const scans = scanTree();

  it("no non-test source under packages/ or apps/ migrates without migrationOptionsFor", () => {
    expect([...scans.values()].flatMap((s) => s.offences)).toEqual([]);
  });

  it("reaches the calls it exists for: boot's, the restore's through `??`, and the cloud fixture's", () => {
    expect(scans.get("apps/server/src/boot.ts")?.followed).toBeGreaterThan(0);
    expect(scans.get("apps/server/src/restore.ts")?.followed).toBeGreaterThan(0);
    expect(scans.get("apps/server/scripts/cloud-integration-fixture.ts")?.followed).toBeGreaterThan(
      0,
    );
  });
});

describe("negative controls", () => {
  it("refuses a bare array", () => {
    expect(
      offencesIn(`await applyMigrations(dir, [{ migrationsFolder: "x", migrationsTable: "t" }]);`),
    ).toHaveLength(1);
  });

  it("refuses a missing options argument", () => {
    expect(offencesIn(`await applyMigrations(dir);`)).toHaveLength(1);
  });

  it("refuses a parameter it cannot follow", () => {
    expect(
      offencesIn(`export async function migrate(dir: string, sets: never[]) {
        await applyMigrations(dir, sets);
      }`),
    ).toHaveLength(1);
  });

  it("refuses a variable that is not a const holding the call", () => {
    expect(
      offencesIn(`let source = migrationOptionsFor(sets, null);
        source = [];
        await applyMigrations(dir, source);`),
    ).toHaveLength(1);
  });

  it("refuses a variable declared twice, which it cannot tell apart", () => {
    expect(
      offencesIn(`function a() { const source = migrationOptionsFor(sets, null); return source; }
        function b() { const source = []; return applyMigrations(dir, source); }`),
    ).toHaveLength(1);
  });

  it("refuses a result it did not see built: a filtered or spread one", () => {
    expect(
      offencesIn(`await applyMigrations(dir, migrationOptionsFor(sets, null).filter(Boolean));
        await applyMigrations(dir, [...migrationOptionsFor(sets, null)]);`),
    ).toHaveLength(2);
  });

  it("refuses a migrationOptionsFor that is not the one @waitron/migrations exports", () => {
    expect(
      offencesIn(
        `function migrationOptionsFor() { return []; }
        await applyMigrations(dir, migrationOptionsFor());`,
        `import { applyMigrations } from "@waitron/migrations";\n`,
      ),
    ).toHaveLength(1);
  });

  it("refuses the imported migrationOptionsFor shadowed by a local function, parameter or const", () => {
    expect(
      offencesIn(`async function migrate() {
        function migrationOptionsFor() { return []; }
        await applyMigrations(dir, migrationOptionsFor());
      }`),
    ).toHaveLength(1);
    expect(
      offencesIn(`async function migrate(migrationOptionsFor: () => never[]) {
        await applyMigrations(dir, migrationOptionsFor());
      }`),
    ).toHaveLength(1);
    expect(
      offencesIn(`async function migrate() {
        const migrationOptionsFor = () => [];
        await applyMigrations(dir, migrationOptionsFor());
      }`),
    ).toHaveLength(1);
    expect(
      offencesIn(`async function migrate() {
        const migrationOptionsFor = () => [];
        const source = migrationOptionsFor();
        await applyMigrations(dir, source);
      }`),
    ).toHaveLength(1);
  });

  it("refuses a const it follows when a function elsewhere in the file shares its name", () => {
    expect(
      offencesIn(`function a() { const source = migrationOptionsFor(sets, null); return source; }
        function b() { function source() {} return applyMigrations(dir, source); }`),
    ).toHaveLength(1);
  });

  it("refuses applyMigrations handed on as a value, which it cannot follow", () => {
    expect(offencesIn(`const deps = { migrate: applyMigrations };`)).toHaveLength(1);
    expect(offencesIn(`const deps = { applyMigrations };`)).toHaveLength(1);
    expect(offencesIn(`const migrate = applyMigrations;`)).toHaveLength(1);
  });

  it("refuses applyMigrations renamed on import or destructuring", () => {
    expect(
      offencesIn(
        `await migrate(dir, migrationOptionsFor(sets, null));`,
        `import { applyMigrations as migrate, migrationOptionsFor } from "@waitron/migrations";\n`,
      ),
    ).toHaveLength(1);
    expect(
      offencesIn(`const { applyMigrations: migrate } = await import("@waitron/migrations");`),
    ).toHaveLength(1);
  });

  it.each([
    [
      "an import",
      `import { "applyMigrations" as migrate, migrationOptionsFor } from "@waitron/migrations";\n` +
        `await migrate(dir, migrationOptionsFor(sets, null));`,
    ],
    ["a re-export", `export { "applyMigrations" as migrate } from "./apply.js";`],
    ["a quoted destructuring key", `const { "applyMigrations": migrate } = mod;`],
    ["a computed destructuring key", `const { ["applyMigrations"]: migrate } = mod;`],
    ["a computed backquoted destructuring key", "const { [`applyMigrations`]: migrate } = mod;"],
  ])("refuses applyMigrations renamed through a string name in %s", (_, text) => {
    const offences = offencesIn(text, "");
    expect(offences).toHaveLength(1);
    expect(offences[0]).toContain(`renames ${NAME}`);
  });

  it("follows a namespace call, and refuses a bare array through it", () => {
    expect(offencesIn(`await ns.applyMigrations(dir, []);`)).toHaveLength(1);
  });

  it("judges applyMigrations reached by a string in brackets as it judges a property access", () => {
    const ns = `import * as m from "@waitron/migrations";\n`;
    expect(offencesIn(`await m["applyMigrations"](dir, []);`, ns)).toHaveLength(1);
    expect(offencesIn("await m[`applyMigrations`](dir, []);", ns)).toHaveLength(1);
    expect(offencesIn(`const migrate = m["applyMigrations"];`, ns)).toHaveLength(1);
    expect(
      scan(
        "fixture.ts",
        IMPORTS + `await m["applyMigrations"](dir, migrationOptionsFor(sets, null));`,
      ),
    ).toEqual({ offences: [], followed: 1 });
  });
});

describe("what it accepts", () => {
  it("does not report a string name that keeps applyMigrations' own name", () => {
    expect(offencesIn(`export { "applyMigrations" } from "./apply.js";`, "")).toEqual([]);
    expect(
      offencesIn(`export { "applyMigrations" as applyMigrations } from "./apply.js";`, ""),
    ).toEqual([]);
  });

  it("accepts the shapes the product uses", () => {
    const text =
      IMPORTS +
      `await applyMigrations(dir, migrationOptionsFor(sets, null));
      await (deps.migrate ?? applyMigrations)(dir, migrationOptionsFor(sets, root));
      const others = manifestSets(),
        source = migrationOptionsFor(others, null);
      await applyMigrations(dir, source);
      export type Migrate = typeof applyMigrations;
      export { applyMigrations } from "./apply.js";`;
    expect(scan("fixture.ts", text)).toEqual({ offences: [], followed: 3 });
  });

  it("accepts an aliased import of migrationOptionsFor", () => {
    expect(
      offencesIn(
        `await applyMigrations(dir, optionsFor(sets, null));`,
        `import { applyMigrations, migrationOptionsFor as optionsFor } from "@waitron/migrations";\n`,
      ),
    ).toEqual([]);
  });

  it("does not read comments or strings", () => {
    expect(
      offencesIn(`// applyMigrations(dir, [])
        /** applyMigrations(dir, []) */
        const note = "applyMigrations(dir, [])";`),
    ).toEqual([]);
    expect(
      offencesIn(`const { a: b = "applyMigrations", c = "applyMigrations" } = mod;
        const d = { ["applyMigrations"]: 1 };`),
    ).toEqual([]);
  });

  it("does not report the function's own declaration", () => {
    expect(
      scan(
        "apply.ts",
        `export async function applyMigrations(directory: string, options: readonly never[]) {}`,
      ).offences,
    ).toEqual([]);
  });
});
