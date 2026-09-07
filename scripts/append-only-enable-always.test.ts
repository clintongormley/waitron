import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_MODULES } from "../packages/composition/src/index.js";
import { packageDirOf } from "../packages/module/src/module.js";

/**
 * Every `reject_mutation()` trigger a module's migrations create is set `ENABLE ALWAYS` (CLAUDE.md §3,
 * swap spec §2.1). The replication apply worker fires only `ALWAYS`/`REPLICA` triggers; a
 * `reject_mutation` trigger left at the default `ENABLE ORIGIN` would silently NOT run on the apply
 * path, so a corrupted row copied in from a peer would land in an append-only table unchallenged —
 * exactly what the immutability and truncate-block triggers exist to refuse. The pairing is the check:
 * every created `reject_mutation` trigger name must have a matching `ALTER TABLE … ENABLE ALWAYS
 * TRIGGER <name>`.
 *
 * WHY A TREE-WIDE ROOT-PROJECT PROGRAM. The append-only tables and their triggers are spread across
 * every domain package's `drizzle/` directory (`db`, `fiscal-verifactu`, `workforce`), and the
 * invariant is per-trigger regardless of which module owns it. So this sits in the root Vitest project
 * beside `module-graph-honesty.test.ts` and `classification-complete.test.ts` (see the repo-root
 * `vitest.config.ts`). It reads SQL as TEXT, never executing it, and — like everything under
 * `scripts/` — is NOT typechecked, so it stays plain and uses its cross-package imports for runtime
 * values only.
 *
 * QUOTING. Trigger and table names are inconsistently quoted across the baselines, and the CREATE and
 * the ENABLE ALWAYS for the SAME trigger can differ (`fiscal-verifactu`'s CREATE quotes the name, its
 * ENABLE ALWAYS does not). Both regexes make the surrounding quotes optional (`"?`) on the trigger AND
 * table name and capture only the bare `\w+`, so pairing is by the unquoted name. Names are NOT assumed
 * to carry an `_enforce_immutability` suffix — `daily_closes` uses `daily_closes_immutable` /
 * `daily_closes_no_truncate`, and the truncate blockers also call `reject_mutation` and must pair.
 */

const REPO_ROOT = join(import.meta.dirname, "..");
const PACKAGES_DIR = join(REPO_ROOT, "packages");

/** A `CREATE [CONSTRAINT] TRIGGER <name> … ON <table> … EXECUTE FUNCTION reject_mutation()` statement.
 * `[^;]*?` bounds each match to a single statement (no semicolon appears inside a trigger definition),
 * so a non-`reject_mutation` trigger cannot borrow a later statement's `reject_mutation()` to match.
 * Quotes are optional on both the trigger name and the table; only the bare `\w+` is captured. */
const REJECT_TRIGGER =
  /\bcreate\s+(?:constraint\s+)?trigger\s+"?(\w+)"?[^;]*?\bon\s+"?(?:public"?\.)?"?(\w+)"?[^;]*?\bexecute\s+(?:function|procedure)\s+"?reject_mutation"?\s*\(/gi;

/** An `ALTER TABLE <table> ENABLE ALWAYS TRIGGER <name>` statement — quotes optional on both, only the
 * bare `\w+` trigger name captured (that is the pairing key). */
const ENABLE_ALWAYS =
  /\balter\s+table\s+(?:only\s+)?"?(?:public"?\.)?"?(\w+)"?\s+enable\s+always\s+trigger\s+"?(\w+)"?/gi;

/** Blank block comments, `--` line comments, and `'…'` string literals to whitespace, preserving line
 * count. Copied from `module-graph-honesty.test.ts`; naive by design. */
function stripSql(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n")
    .replace(/'(?:[^']|'')*'/g, (literal) => literal.replace(/[^\n]/g, " "));
}

/** From every descriptor's `migrations.from` (`../<pkg>/drizzle`), the package DIR → module NAME map,
 * through `@waitron/module`'s `packageDirOf`. A package is in scope only if a descriptor points at it. */
function packageDirToModule(): Map<string, string> {
  return new Map(ALL_MODULES.map((module) => [packageDirOf(module), module.name]));
}

interface DrizzlePackage {
  moduleName: string;
  packageDir: string;
  /** Raw SQL of each `drizzle/*.sql` file; stripping happens at scan time. */
  sqls: string[];
}

function discoverDrizzlePackages(): DrizzlePackage[] {
  const discovered: DrizzlePackage[] = [];
  for (const [packageDir, moduleName] of packageDirToModule()) {
    const drizzleDir = join(PACKAGES_DIR, packageDir, "drizzle");
    let entries: string[];
    try {
      entries = readdirSync(drizzleDir);
    } catch {
      // A descriptor pointing at a package with no `drizzle/` dir (e.g. `fiscal-none`, which has only
      // `meta/`): skip it. The anchor's floor catches a discovery that silently found too few triggers.
      continue;
    }
    const sqls = entries
      .filter((name) => name.endsWith(".sql"))
      .map((name) => readFileSync(join(drizzleDir, name), "utf8"));
    discovered.push({ moduleName, packageDir, sqls });
  }
  return discovered;
}

interface RejectTrigger {
  name: string;
  table: string;
  moduleName: string;
}

/** Every `reject_mutation` trigger CREATEd across the in-scope packages (name lowercased). */
function rejectTriggers(discovered: DrizzlePackage[]): RejectTrigger[] {
  const found: RejectTrigger[] = [];
  for (const { moduleName, sqls } of discovered) {
    for (const raw of sqls) {
      for (const match of stripSql(raw).matchAll(REJECT_TRIGGER)) {
        const name = match[1]?.toLowerCase();
        const table = match[2]?.toLowerCase();
        if (name !== undefined && table !== undefined) found.push({ name, table, moduleName });
      }
    }
  }
  return found;
}

/** Every trigger name set `ENABLE ALWAYS` across the in-scope packages (lowercased). */
function enabledAlways(discovered: DrizzlePackage[]): Set<string> {
  const names = new Set<string>();
  for (const { sqls } of discovered) {
    for (const raw of sqls) {
      for (const match of stripSql(raw).matchAll(ENABLE_ALWAYS)) {
        const name = match[2]?.toLowerCase();
        if (name !== undefined) names.add(name);
      }
    }
  }
  return names;
}

describe("the detector itself", () => {
  // The quoting variance the baselines actually carry: a bare CREATE paired with a quoted ENABLE
  // ALWAYS, and the reverse. If either spelling escaped a regex the pairing would falsely flag it.
  it("pairs a bare CREATE with a quoted ENABLE ALWAYS by name", () => {
    const create = `create trigger sales_enforce_immutability\n  before update or delete on sales\n  for each row execute function reject_mutation();`;
    const alter = `alter table "sales" enable always trigger "sales_enforce_immutability";`;
    const pkg = [{ moduleName: "core", packageDir: "db", sqls: [create, alter] }];
    expect(rejectTriggers(pkg).map((t) => t.name)).toEqual(["sales_enforce_immutability"]);
    expect(enabledAlways(pkg).has("sales_enforce_immutability")).toBe(true);
  });

  it("pairs a quoted CREATE with a bare ENABLE ALWAYS by name", () => {
    const create = `create trigger "registros_facturacion_enforce_immutability"\n  before update or delete on "registros_facturacion"\n  for each row execute function reject_mutation();`;
    const alter = `alter table registros_facturacion enable always trigger registros_facturacion_enforce_immutability;`;
    const pkg = [
      { moduleName: "fiscal-verifactu", packageDir: "fiscal-verifactu", sqls: [create, alter] },
    ];
    expect(rejectTriggers(pkg).map((t) => t.name)).toEqual([
      "registros_facturacion_enforce_immutability",
    ]);
    expect(enabledAlways(pkg).has("registros_facturacion_enforce_immutability")).toBe(true);
  });

  it("matches the CREATE CONSTRAINT TRIGGER spelling", () => {
    const create = `create constraint trigger t_block\n  after insert on t\n  for each row execute function reject_mutation();`;
    const pkg = [{ moduleName: "core", packageDir: "db", sqls: [create] }];
    expect(rejectTriggers(pkg).map((t) => t.name)).toEqual(["t_block"]);
  });

  // A trigger that calls some OTHER function (a capture trigger) must not be recorded as a
  // reject_mutation trigger — and its `[^;]` bound must stop it borrowing a LATER statement's
  // reject_mutation() to match.
  it("ignores a non-reject_mutation trigger even when a reject one follows", () => {
    const sql = `create trigger sales_capture after insert on sales for each row execute function sync_capture();\ncreate trigger sales_block before truncate on sales for each statement execute function reject_mutation();`;
    const pkg = [{ moduleName: "core", packageDir: "db", sqls: [sql] }];
    expect(rejectTriggers(pkg).map((t) => t.name)).toEqual(["sales_block"]);
  });

  // Negative control: a reject_mutation mention in a `--` comment must not fake a trigger.
  it("ignores a reject_mutation trigger written in a comment", () => {
    const sql = `-- create trigger ghost before update on t for each row execute function reject_mutation();\ncreate table t (id uuid primary key);`;
    const pkg = [{ moduleName: "core", packageDir: "db", sqls: [sql] }];
    expect(rejectTriggers(pkg)).toEqual([]);
  });
});

describe("every append-only reject_mutation trigger is ENABLE ALWAYS", () => {
  const discovered = discoverDrizzlePackages();
  const triggers = rejectTriggers(discovered);
  const enabled = enabledAlways(discovered);

  it("pairs every created reject_mutation trigger with an ENABLE ALWAYS", () => {
    const violations: string[] = [];
    for (const { name, table, moduleName } of triggers) {
      if (!enabled.has(name)) {
        const message = `${moduleName}: reject_mutation trigger "${name}" on ${table} is not ENABLE ALWAYS`;
        if (!violations.includes(message)) violations.push(message);
      }
    }
    expect(violations.sort()).toEqual([]);
  });

  // Vacuous-pass anchor. A scan that silently matched nothing (the regex drifted out from under the
  // tree's SQL, or discovery found nothing) would leave `violations` empty and pass — identical to a
  // fully-paired tree. So pin that the scan actually FOUND the known real triggers in the tree's
  // ACTUAL spelling, at a floor. The floor is exactly today's count (the immutability + truncate pairs
  // on the append-only tables); it only guards against the scan finding nothing.
  it("finds the known real reject_mutation triggers, at a floor", () => {
    const names = new Set(triggers.map((t) => t.name));
    for (const known of [
      "registros_facturacion_enforce_immutability",
      "sales_enforce_immutability",
      "time_entries_enforce_immutability",
    ]) {
      expect(names.has(known)).toBe(true);
    }
    expect(triggers.length).toBeGreaterThanOrEqual(20);
  });
});
