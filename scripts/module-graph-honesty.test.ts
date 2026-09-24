import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_MODULES } from "../packages/composition/src/index.js";
import { packageDirOf } from "../packages/module/src/module.js";

/**
 * Every module descriptor's `requires` must NAME every cross-module dependency its migrations
 * create in SQL. A module depends on another when its `drizzle/*.sql` either FK-`REFERENCES` a
 * table the other module owns or installs a `CREATE TRIGGER … ON <table>` against one — both edges
 * force a migration-order dependency, because the referenced or triggered table must exist first.
 *
 * It reads SQL as TEXT, never executing it: it maps every `CREATE TABLE <name>` to its owning
 * module, resolves each edge's target table to its owner, drops same-module targets, and asserts
 * the surviving cross-module set is a subset of the descriptor's declared `requires`. Every regex
 * accepts a backtick (drizzle-kit's SQLite spelling), a double quote or nothing, and the
 * optionally `public.`-qualified spelling; each spelling has a control test, because a spelling the
 * detector misses makes every edge written that way invisible.
 *
 * KNOWN LIMITATIONS:
 * - `[BRACKET]` QUOTING IS NOT HANDLED, and SQLite accepts it. A hand-written migration spelling an
 *   identifier that way would have its table read as owned by nobody and its FK edge dropped —
 *   silently, because a dropped edge looks exactly like an honest descriptor.
 * - A SQLITE TRIGGER'S BODY IS NOT READ. The detector for PostgreSQL's `EXECUTE FUNCTION <fn>` was
 *   deleted as dead syntax (SQLite has no functions). A SQLite trigger carries statements between
 *   `BEGIN` and `END`, and an `INSERT INTO` or a `SELECT … FROM` naming another module's table in
 *   there is a real cross-module edge that NEITHER remaining detector sees — media's triggers on
 *   `media_images` read core's and catalogue's tables that way. Nothing covers that today.
 * - Append-only enforcement is runtime code (`packages/store/src/append-only.ts`), not SQL, so the
 *   scan cannot see it. The `CREATE CONSTRAINT TRIGGER` spelling the trigger detector also accepts
 *   is PostgreSQL-only.
 * - It is a regex over comment- and string-stripped text, NOT a SQL parser. `stripSql` blanks
 *   slash-star blocks, `--` line comments, and `'…'` string literals (preserving line numbers), so
 *   a `references`/`create trigger` mention in any of those is ignored. But a trigger whose
 *   `ON <table>` the `.*?` cannot reach cleanly, or a table named with quoting the regexes do not
 *   cover, could be missed; the defence is the vacuous-pass anchor, which asserts the scan FOUND a
 *   known real edge in the tree's actual spelling.
 * - The stripping is single-pass and naive: `--` is treated as a comment start even inside a
 *   string literal (line comments are blanked before strings), so a migration mixing the two on one
 *   line could confuse it.
 */

const REPO_ROOT = join(import.meta.dirname, "..");
const PACKAGES_DIR = join(REPO_ROOT, "packages");

/** ``CREATE TABLE [`|"]<name>[`|"]`` — backtick-quoted (drizzle-kit's SQLite spelling),
 * double-quoted, or bare, optionally schema-qualified and IF NOT EXISTS. */
const CREATE_TABLE =
  /\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?["`]?(?:public["`]?\.)?["`]?(\w+)["`]?/gi;
/** ``REFERENCES [`|"]<table>[`|"]`` — the FK edge. The tree writes ``REFERENCES `persons`(`id`)``
 * with no space before the column list; `"public"."t"` and bare `t` are accepted too. */
const REFERENCES = /\breferences\s+["`]?(?:public["`]?\.)?["`]?(\w+)["`]?/gi;
/** ``CREATE [CONSTRAINT] TRIGGER <name> … ON [`|"]<table>[`|"]`` — the trigger edge. The
 * `s` (dotAll) flag lets `.*?` span a multi-line trigger; `\bon\b` first-matches the real ON clause
 * because no keyword between it and the trigger name is the word "on". */
const CREATE_TRIGGER =
  /\bcreate\s+(?:constraint\s+)?trigger\s+\S+\s+.*?\bon\s+["`]?(?:public["`]?\.)?["`]?(\w+)["`]?/gis;

const EDGE_KINDS = [
  ["FK reference", REFERENCES],
  ["trigger", CREATE_TRIGGER],
] as const;

/** Blank block comments, `--` line comments, and `'…'` string literals to whitespace, preserving
 * line count. Naive by design — see the header's known-limitations block. */
function stripSql(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n")
    .replace(/'(?:[^']|'')*'/g, (literal) => literal.replace(/[^\n]/g, " "));
}

/** Package DIR → module NAME, through `@waitron/module`'s `packageDirOf`; the name comes off the
 * descriptor, so a module whose name and directory differ resolves to the name it declares. */
function packageDirToModule(): Map<string, string> {
  return new Map(ALL_MODULES.map((module) => [packageDirOf(module), module.name]));
}

interface DrizzlePackage {
  moduleName: string;
  packageDir: string;
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
      // The vacuous-pass anchor's floor catches a discovery that silently found too few packages.
      continue;
    }
    const sqls = entries
      .filter((name) => name.endsWith(".sql"))
      .map((name) => readFileSync(join(drizzleDir, name), "utf8"));
    discovered.push({ moduleName, packageDir, sqls });
  }
  return discovered;
}

/** Every `CREATE TABLE <name>` across the in-scope packages, mapped to its owning module. */
function ownerOfTable(discovered: DrizzlePackage[]): Map<string, string> {
  const owner = new Map<string, string>();
  for (const { moduleName, sqls } of discovered) {
    for (const raw of sqls) {
      for (const match of stripSql(raw).matchAll(CREATE_TABLE)) {
        const table = match[1]?.toLowerCase();
        if (table !== undefined) owner.set(table, moduleName);
      }
    }
  }
  return owner;
}

interface Edge {
  dep: string;
  kind: string;
  /** The depended-upon table. */
  target: string;
}

/** The cross-module edges a single SQL file's DDL creates for `moduleName`: every FK reference and
 * trigger whose target table is owned by a DIFFERENT in-scope module. Same-module targets and
 * targets owned by no in-scope package are dropped. */
function edgeDetails(rawSql: string, moduleName: string, owner: Map<string, string>): Edge[] {
  const sql = stripSql(rawSql);
  const edges: Edge[] = [];
  for (const [kind, pattern] of EDGE_KINDS) {
    for (const match of sql.matchAll(pattern)) {
      const target = match[1]?.toLowerCase();
      if (target === undefined) continue;
      const dep = owner.get(target);
      if (dep !== undefined && dep !== moduleName) edges.push({ dep, kind, target });
    }
  }
  return edges;
}

/** The set of module NAMES `moduleName` depends on, per this SQL — the `dep` field of its edges. */
function edgesFor(rawSql: string, moduleName: string, owner: Map<string, string>): Set<string> {
  return new Set(edgeDetails(rawSql, moduleName, owner).map((edge) => edge.dep));
}

/** The dependency names a descriptor DECLARES: `requires.core` (as "core") plus `requires.modules`. */
function declaredDepsOf(moduleName: string): Set<string> {
  const module = ALL_MODULES.find((candidate) => candidate.name === moduleName);
  const declared = new Set<string>();
  if (module?.requires?.core !== undefined) declared.add("core");
  for (const dep of Object.keys(module?.requires?.modules ?? {})) declared.add(dep);
  return declared;
}

describe("the detector itself", () => {
  // `alpha` owns `widgets`; `beta` owns `gadgets`. A `references`/`trigger` from an `alpha` file
  // onto `gadgets` is a cross-module edge; onto `widgets` it is not.
  const OWNER = new Map([
    ["widgets", "alpha"],
    ["gadgets", "beta"],
  ]);

  // The spelling the tree actually contains: backtick-quoted, inline in the CREATE TABLE, with no
  // space between the table name and its column list.
  it("flags a cross-module FK reference in the SQLite spelling", () => {
    const sql =
      "CREATE TABLE `widgets` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`g_id` text NOT NULL,\n\tFOREIGN KEY (`g_id`) REFERENCES `gadgets`(`id`) ON UPDATE no action ON DELETE restrict\n);";
    expect([...edgesFor(sql, "alpha", OWNER)]).toEqual(["beta"]);
  });

  // The table-ownership half of the same tolerance: a backtick-quoted CREATE TABLE must resolve its
  // owner, or every edge onto that table silently resolves to no owner and is dropped.
  it("resolves table ownership from a backtick-quoted CREATE TABLE", () => {
    const discovered: DrizzlePackage[] = [
      { moduleName: "alpha", packageDir: "alpha", sqls: ["CREATE TABLE `widgets` (`id` text);"] },
      { moduleName: "beta", packageDir: "beta", sqls: ['CREATE TABLE "gadgets" ("id" text);'] },
    ];
    expect(ownerOfTable(discovered)).toEqual(
      new Map([
        ["widgets", "alpha"],
        ["gadgets", "beta"],
      ]),
    );
  });

  // A trigger in the form SQLite accepts: backtick-quoted names, statements between BEGIN and END
  // instead of a function call.
  it("flags a cross-module trigger in the SQLite spelling", () => {
    const sql =
      "CREATE TRIGGER `gadgets_append_only` BEFORE UPDATE ON `gadgets`\nBEGIN\n  SELECT RAISE(ABORT, 'append-only');\nEND;";
    expect([...edgesFor(sql, "alpha", OWNER)]).toEqual(["beta"]);
  });

  it("flags a cross-module FK reference", () => {
    const sql = `alter table "widgets" add constraint w_g_fk foreign key ("g_id")\n  references "public"."gadgets"("id");`;
    expect([...edgesFor(sql, "alpha", OWNER)]).toEqual(["beta"]);
  });

  it("flags a cross-module capture trigger", () => {
    const sql = `create trigger gadgets_capture after insert or update on gadgets\n  for each row execute function capture();`;
    expect([...edgesFor(sql, "alpha", OWNER)]).toEqual(["beta"]);
  });

  // The CONSTRAINT-trigger form is PostgreSQL-only, so these two cases say nothing about the engine
  // the tree now generates for; they are labelled rather than deleted so nobody reads them as
  // evidence about SQLite.
  it("flags a cross-module CREATE CONSTRAINT TRIGGER", () => {
    const sql = `create constraint trigger gadgets_check after insert on gadgets\n  deferrable initially deferred\n  for each row execute function gadgets_check();`;
    expect([...edgesFor(sql, "alpha", OWNER)]).toEqual(["beta"]);
  });

  it("accepts the CREATE CONSTRAINT TRIGGER spelling", () => {
    const sql = `CREATE CONSTRAINT TRIGGER sales_check_tender_coverage\n  AFTER INSERT ON sales\n  DEFERRABLE INITIALLY DEFERRED\n  FOR EACH ROW EXECUTE FUNCTION sales_check_tender_coverage();`;
    const owner = new Map([["sales", "core"]]);
    expect([...edgesFor(sql, "bookings", owner)]).toEqual(["core"]);
  });

  it("ignores a same-module reference", () => {
    const sql = `alter table "widgets" add constraint self_fk foreign key ("p") references "widgets"("id");`;
    expect([...edgesFor(sql, "alpha", OWNER)]).toEqual([]);
  });

  it("ignores a same-module reference in the SQLite spelling", () => {
    const sql = "FOREIGN KEY (`p`) REFERENCES `widgets`(`id`) ON UPDATE no action;";
    expect([...edgesFor(sql, "alpha", OWNER)]).toEqual([]);
  });

  // Negative control: the keyword sitting in a `--` comment must not fake an edge.
  it("ignores a reference inside a line comment", () => {
    const sql =
      "-- references `gadgets`(`id`) — describing the old shape\ncreate table `widgets` (`id` text primary key);";
    expect([...edgesFor(sql, "alpha", OWNER)]).toEqual([]);
  });

  // Negative control: the keyword inside a single-quoted string literal must not fake an edge.
  it("ignores a reference inside a string literal", () => {
    const sql = "insert into notes (body) values ('this references `gadgets` in prose');";
    expect([...edgesFor(sql, "alpha", OWNER)]).toEqual([]);
  });

  it("carries the kind and target on each edge, for a readable violation message", () => {
    const sql =
      "REFERENCES `gadgets`(`id`);\nCREATE TRIGGER `t` AFTER INSERT ON `gadgets` BEGIN SELECT 1; END;";
    expect(edgeDetails(sql, "alpha", OWNER)).toEqual([
      { dep: "beta", kind: "FK reference", target: "gadgets" },
      { dep: "beta", kind: "trigger", target: "gadgets" },
    ]);
  });
});

describe("the tree's module graph is honest", () => {
  const discovered = discoverDrizzlePackages();
  const owner = ownerOfTable(discovered);
  const modules = discovered.map((pkg) => pkg.moduleName);

  // Every cross-module edge found, keyed by kind AND target, so an anchor can pin a SPECIFIC edge
  // shape rather than just "some edge between these two modules".
  const foundEdgeDetails = new Set<string>();
  for (const pkg of discovered) {
    for (const raw of pkg.sqls) {
      for (const edge of edgeDetails(raw, pkg.moduleName, owner)) {
        foundEdgeDetails.add(`${pkg.moduleName}→${edge.dep} via ${edge.kind} on ${edge.target}`);
      }
    }
  }

  // An empty scan would leave `violations` empty and pass. So pin modules that are not going away,
  // and one known real edge per detector in the tree's own spelling: `workforce → identity`, a
  // backtick-quoted `REFERENCES` onto identity's `persons`, and `media → core`, a trigger that
  // `packages/media/drizzle/0001_image_references.sql` puts ON core's `products`.
  it("discovers the modules and finds the known real cross-module edges", () => {
    for (const name of ["core", "identity", "payments", "workforce"]) {
      expect(modules).toContain(name);
    }
    expect(modules.length).toBeGreaterThanOrEqual(10);
    expect(foundEdgeDetails.has("workforce→identity via FK reference on persons")).toBe(true);
    expect(foundEdgeDetails.has("media→core via trigger on products")).toBe(true);
  });

  it("every FK/trigger edge in the SQL is named in the depending descriptor's requires", () => {
    const violations: string[] = [];
    for (const pkg of discovered) {
      const declared = declaredDepsOf(pkg.moduleName);
      for (const raw of pkg.sqls) {
        for (const edge of edgeDetails(raw, pkg.moduleName, owner)) {
          if (declared.has(edge.dep)) continue;
          const message = `${pkg.moduleName} depends on ${edge.dep} via ${edge.kind} on ${edge.target} — not in requires`;
          if (!violations.includes(message)) violations.push(message);
        }
      }
    }
    expect(violations.sort()).toEqual([]);
  });
});
