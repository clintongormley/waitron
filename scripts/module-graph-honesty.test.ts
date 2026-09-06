import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_MODULES } from "../packages/composition/src/index.js";
import { packageDirOf } from "../packages/module/src/module.js";

/**
 * Every module descriptor's `requires` must NAME every cross-module dependency its migrations create
 * in SQL. A module depends on another when its `drizzle/*.sql` either FK-`REFERENCES` a table the
 * other module owns, installs a `CREATE TRIGGER … ON <table>` against one, OR calls another module's
 * `sync_capture` SPI via `EXECUTE FUNCTION sync_capture()` in a trigger — all three edges force a
 * migration-order dependency, because the referenced/triggered table or the called function must
 * exist first.
 *
 * WHY THIS HAS TO BE A TREE-WIDE ROOT-PROJECT PROGRAM. The `requires` graph lives in one package
 * (`@waitron/composition`) but the evidence for it — the `CREATE TABLE`/`REFERENCES`/
 * `CREATE TRIGGER` statements — is spread across every domain package's `drizzle/` directory. No
 * per-package suite can see both: a package that under-declares `requires` has, by construction, the
 * SQL in one package and the descriptor in another, and each package's own `test:coverage` loads only
 * its own tree. Only a program that reads the composition list's descriptors AND every
 * `packages/<pkg>/drizzle` at once can cross-check them. That is why it sits in the root Vitest project beside
 * `errors-reachable.test.ts` and `guarded-teardowns.test.ts` (see the repo-root `vitest.config.ts`),
 * not in any package.
 *
 * WHAT IT COST. SP-1c derived the first `requires` graph from FK `REFERENCES` ALONE and declared
 * `sync` as depending on `core` only. That missed the two TRIGGER edges — `sync → identity` and
 * `sync → payments` — because `sync` enrols other modules' tables by installing capture triggers on
 * them (`persons`/`webauthn_credentials` from identity; `payments`/`payment_refunds`/`payment_policy`
 * from payments), with no FK between them. Review caught all three by hand and CLAUDE.md §3 recorded
 * the lesson: "a dependency graph has TWO kinds of cross-set edge, not one — grep for both." SP-1c
 * deferred the automated guard to SP-2, where descriptor package-ownership begins. This is it.
 *
 * MECHANISM. This reads SQL as TEXT (never executing it). It maps every `CREATE TABLE "<name>"` to
 * its owning module and every `CREATE FUNCTION "<name>"` to the module that defines it, then for each
 * module scans for the edge kinds (FK reference, trigger, and the `sync_capture` SPI call), resolves
 * each target table/function to its owner, drops same-module targets, and asserts the surviving
 * cross-module set is a subset of the descriptor's declared `requires`. A package is in scope only if a descriptor's `migrations.from`
 * (`../<pkg>/drizzle`) points at it, so the module NAME (e.g. `fiscal`) is derived from the descriptor
 * rather than assumed equal to the package DIR name (e.g. `fiscal-verifactu`).
 *
 * KNOWN LIMITATIONS, stated rather than papered over (CLAUDE.md §1):
 *   - The SPI-call edge is scoped to the `sync_capture` function SPECIFICALLY, not to arbitrary
 *     cross-module function calls. `EXECUTE_SYNC_CAPTURE` matches only `EXECUTE FUNCTION sync_capture`;
 *     the OWNER of `sync_capture` is auto-resolved from `CREATE FUNCTION` across the tree (so it is
 *     `sync`, not hardcoded), but a trigger calling some OTHER module's function would not surface.
 *     This is deliberate — a general function-call scan would surface unrelated edges (RLS helpers,
 *     shared trigger functions) beyond SP-3a's scope. Extend `EXECUTE_SYNC_CAPTURE` when another
 *     cross-module SPI appears. The `fiscal→sync` vacuous-pass anchor pins that this edge is actually
 *     found in the tree's real spelling.
 *   - It is a regex over comment- and string-stripped text, NOT a SQL parser. `stripSql` blanks
 *     slash-star blocks, `--` line comments, and `'…'` string literals (preserving line numbers), so a
 *     `references`/`create trigger` mention in any of those is ignored — pinned by the detector's
 *     negative controls below. Both trigger forms are matched — plain `CREATE TRIGGER` AND
 *     `CREATE CONSTRAINT TRIGGER` (core's deferrable coverage checks). But a trigger whose
 *     `ON <table>` is separated from the trigger name by content the `.*?` cannot span cleanly, or a
 *     table named with unusual quoting the
 *     `"?(?:public"?\.)?"?(\w+)"?` shape does not cover, could be missed. The defence against that is
 *     not a proof of totality — it is the vacuous-pass anchor, which asserts the scan actually FOUND
 *     the three known real edges (`sync→identity`, `sync→payments`, `workforce→identity`) in the
 *     tree's ACTUAL spelling. If the tree's SQL dialect drifts out from under these regexes, that
 *     anchor goes red rather than the guard passing empty (CLAUDE.md §1, "a measurement where both
 *     answers look alike measures nothing").
 *   - The stripping is single-pass and naive: `--` is treated as a comment start even inside a string
 *     literal (line comments are blanked before strings), and a `'` inside a `--` comment cannot open
 *     a string (comments are blanked first). The real tree is clean under this order — verified by the
 *     anchor and the empty tree-wide result — but a future migration mixing the two on one line could
 *     confuse it. A full tokenizer was not built; the failure mode is a stale anchor, not a silent
 *     pass.
 *   - Like every file under `scripts/`, this is NOT typechecked — `pnpm typecheck` is `pnpm -r
 *     typecheck` and never visits the workspace root (CLAUDE.md §2/§4). So it is kept plain and its
 *     one cross-package import (`ALL_MODULES`) is used only for runtime values, never for a shape only
 *     a typechecker would validate.
 */

const REPO_ROOT = join(import.meta.dirname, "..");
const PACKAGES_DIR = join(REPO_ROOT, "packages");

/** `CREATE TABLE ["public".]"<name>"` — quoted or bare, optionally schema-qualified and IF NOT EXISTS. */
const CREATE_TABLE = /\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?"?(?:public"?\.)?"?(\w+)"?/gi;
/** `REFERENCES ["public".]"<table>"` — the FK edge; both `"public"."t"` and bare `"t"` spellings. */
const REFERENCES = /\breferences\s+"?(?:public"?\.)?"?(\w+)"?/gi;
/** `CREATE [CONSTRAINT] TRIGGER <name> … ON ["public".]"<table>"` — the trigger edge, in both the
 * plain `CREATE TRIGGER` form (sync's capture triggers, the immutability triggers) and the
 * `CREATE CONSTRAINT TRIGGER` form (core's deferrable coverage checks, e.g. `0005_sales.sql`). The
 * `s` (dotAll) flag lets `.*?` span the multi-line triggers the tree writes (name on line 1, `ON`
 * clause on a later line); `\bon\b` first-matches the real ON clause because no keyword between it and
 * the trigger name (`AFTER`/`INSERT`/`UPDATE`/`DELETE`/`OR`/`BEFORE`/`TRUNCATE`/`CONSTRAINT`/
 * `DEFERRABLE`) is the word "on". */
const CREATE_TRIGGER =
  /\bcreate\s+(?:constraint\s+)?trigger\s+\S+\s+.*?\bon\s+"?(?:public"?\.)?"?(\w+)"?/gis;

/** `CREATE [OR REPLACE] FUNCTION ["public".]"<name>"` — to resolve which module DEFINES a function. */
const CREATE_FUNCTION = /\bcreate\s+(?:or\s+replace\s+)?function\s+"?(?:public"?\.)?"?(\w+)"?/gi;
/** `EXECUTE (FUNCTION|PROCEDURE) sync_capture` — a trigger calling sync's capture SPI. Scoped to
 * sync_capture deliberately: a general cross-module function-call scan would surface unrelated edges
 * (RLS helper calls, shared trigger functions) beyond SP-3a's scope. Limitation stated, not papered
 * over (CLAUDE.md §1) — extend to other SPIs when one appears. */
const EXECUTE_SYNC_CAPTURE =
  /\bexecute\s+(?:function|procedure)\s+"?(?:public"?\.)?"?(sync_capture)"?(?!\w)/gi;

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

/** From every descriptor's `migrations.from` (`../<pkg>/drizzle`), the package DIR → module NAME
 * map, through `@waitron/module`'s `packageDirOf` — the one place that parses that string to
 * recover the package directory. A package is only in scope if some descriptor points at it —
 * that is what makes `fiscal-verifactu` resolve to the module named `fiscal`, not to a module named
 * after the directory. A descriptor whose `from` has another shape throws rather than silently
 * dropping its package from the scan. */
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
      // A descriptor pointing at a package with no `drizzle/` dir: skip it rather than crash. The
      // vacuous-pass anchor's floor catches a discovery that silently found too few packages.
      continue;
    }
    const sqls = entries
      .filter((name) => name.endsWith(".sql"))
      .map((name) => readFileSync(join(drizzleDir, name), "utf8"));
    discovered.push({ moduleName, packageDir, sqls });
  }
  return discovered;
}

/** Every `CREATE TABLE "<name>"` across the in-scope packages, mapped to its owning module. */
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

/** Which module DEFINES sync_capture (and any other function), from CREATE FUNCTION across the tree. */
function ownerOfFunction(discovered: DrizzlePackage[]): Map<string, string> {
  const owner = new Map<string, string>();
  for (const { moduleName, sqls } of discovered) {
    for (const raw of sqls) {
      for (const match of stripSql(raw).matchAll(CREATE_FUNCTION)) {
        const fn = match[1]?.toLowerCase();
        if (fn !== undefined && !owner.has(fn)) owner.set(fn, moduleName);
      }
    }
  }
  return owner;
}

/** Cross-module edges a file creates by CALLING the sync_capture SPI a different module owns. */
function spiEdgesFor(
  rawSql: string,
  moduleName: string,
  funcOwner: Map<string, string>,
): Set<string> {
  const sql = stripSql(rawSql);
  const deps = new Set<string>();
  for (const match of sql.matchAll(EXECUTE_SYNC_CAPTURE)) {
    const fn = match[1]?.toLowerCase();
    if (fn === undefined) continue;
    const dep = funcOwner.get(fn);
    if (dep !== undefined && dep !== moduleName) deps.add(dep);
  }
  return deps;
}

interface Edge {
  dep: string;
  kind: string;
  table: string;
}

/** The cross-module edges a single SQL file's DDL creates for `moduleName`: every FK reference and
 * capture trigger whose target table is owned by a DIFFERENT in-scope module. Same-module targets and
 * targets owned by no in-scope package are dropped. */
function edgeDetails(rawSql: string, moduleName: string, owner: Map<string, string>): Edge[] {
  const sql = stripSql(rawSql);
  const edges: Edge[] = [];
  for (const [kind, pattern] of EDGE_KINDS) {
    for (const match of sql.matchAll(pattern)) {
      const table = match[1]?.toLowerCase();
      if (table === undefined) continue;
      const dep = owner.get(table);
      if (dep !== undefined && dep !== moduleName) edges.push({ dep, kind, table });
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
  // `alpha` owns `widgets`; `beta` owns `gadgets`. A `references`/`trigger` from an `alpha` file onto
  // `gadgets` is a cross-module edge; onto `widgets` it is not.
  const OWNER = new Map([
    ["widgets", "alpha"],
    ["gadgets", "beta"],
  ]);

  it("flags a cross-module FK reference", () => {
    const sql = `alter table "widgets" add constraint w_g_fk foreign key ("g_id")\n  references "public"."gadgets"("id");`;
    expect([...edgesFor(sql, "alpha", OWNER)]).toEqual(["beta"]);
  });

  it("flags a cross-module capture trigger", () => {
    const sql = `create trigger gadgets_capture after insert or update on gadgets\n  for each row execute function capture();`;
    expect([...edgesFor(sql, "alpha", OWNER)]).toEqual(["beta"]);
  });

  // The CONSTRAINT-trigger form is a distinct spelling PostgreSQL accepts and the tree uses (core's
  // deferrable coverage checks); it must be caught too, or the guard has a silent gap in the very
  // edge-kind it exists to check.
  it("flags a cross-module CREATE CONSTRAINT TRIGGER", () => {
    const sql = `create constraint trigger gadgets_check after insert on gadgets\n  deferrable initially deferred\n  for each row execute function gadgets_check();`;
    expect([...edgesFor(sql, "alpha", OWNER)]).toEqual(["beta"]);
  });

  // The real spelling, not a synthetic one: mirrors `packages/db/drizzle/0005_sales.sql:310`. Pins
  // that the regex matches the tree's ACTUAL constraint-trigger DDL. Owner here is a different module
  // than the file's, so it must surface as a cross-module edge.
  it("matches the real CREATE CONSTRAINT TRIGGER spelling from 0005_sales.sql", () => {
    const sql = `CREATE CONSTRAINT TRIGGER sales_check_tender_coverage\n  AFTER INSERT ON sales\n  DEFERRABLE INITIALLY DEFERRED\n  FOR EACH ROW EXECUTE FUNCTION sales_check_tender_coverage();`;
    const owner = new Map([["sales", "core"]]);
    expect([...edgesFor(sql, "sync", owner)]).toEqual(["core"]);
  });

  it("ignores a same-module reference", () => {
    const sql = `alter table "widgets" add constraint self_fk foreign key ("p") references "widgets"("id");`;
    expect([...edgesFor(sql, "alpha", OWNER)]).toEqual([]);
  });

  // Negative control: the keyword sitting in a `--` comment must not fake an edge.
  it("ignores a reference inside a line comment", () => {
    const sql = `-- references "public"."gadgets"("id") — describing the old shape\ncreate table "widgets" ("id" uuid primary key);`;
    expect([...edgesFor(sql, "alpha", OWNER)]).toEqual([]);
  });

  // Negative control: the keyword inside a single-quoted string literal must not fake an edge.
  it("ignores a reference inside a string literal", () => {
    const sql = `insert into notes (body) values ('this references "gadgets" in prose');`;
    expect([...edgesFor(sql, "alpha", OWNER)]).toEqual([]);
  });

  it("carries the kind and table on each edge, for a readable violation message", () => {
    const sql = `references "gadgets"("id");\ncreate trigger t after insert on gadgets for each row execute function f();`;
    expect(edgeDetails(sql, "alpha", OWNER)).toEqual([
      { dep: "beta", kind: "FK reference", table: "gadgets" },
      { dep: "beta", kind: "trigger", table: "gadgets" },
    ]);
  });

  it("flags a cross-module sync_capture SPI call", () => {
    const funcOwner = new Map([["sync_capture", "sync"]]);
    const sql = `create trigger foo_capture after insert on foo\n  for each row execute function sync_capture();`;
    expect([...spiEdgesFor(sql, "fiscal", funcOwner)]).toEqual(["sync"]);
  });

  it("ignores a same-module sync_capture call", () => {
    const funcOwner = new Map([["sync_capture", "sync"]]);
    const sql = `create trigger p_capture after insert on p for each row execute function sync_capture();`;
    expect([...spiEdgesFor(sql, "sync", funcOwner)]).toEqual([]); // sync calling its own SPI
  });

  it("ignores a sync_capture mention inside a comment", () => {
    const funcOwner = new Map([["sync_capture", "sync"]]);
    const sql = `-- execute function sync_capture() — describing the old shape\ncreate table foo (id uuid);`;
    expect([...spiEdgesFor(sql, "fiscal", funcOwner)]).toEqual([]);
  });

  // Boundary control: a DIFFERENT function whose name merely STARTS with `sync_capture` must not fake
  // the SPI edge. Without the trailing `(?!\w)` in EXECUTE_SYNC_CAPTURE the capture group would prefix-
  // match `sync_capture` inside `sync_capture_extra` and surface a spurious cross-module edge.
  it("ignores a call to a different function named like sync_capture", () => {
    const funcOwner = new Map([["sync_capture", "sync"]]);
    const sql = `create trigger foo_capture after insert on foo\n  for each row execute function sync_capture_extra();`;
    expect([...spiEdgesFor(sql, "fiscal", funcOwner)]).toEqual([]);
  });
});

describe("the tree's module graph is honest", () => {
  const discovered = discoverDrizzlePackages();
  const owner = ownerOfTable(discovered);
  const funcOwner = ownerOfFunction(discovered);
  const modules = discovered.map((pkg) => pkg.moduleName);

  // Every cross-module edge a file creates: FK/trigger edges (via `edgeDetails`) plus the SPI-call
  // edges (a trigger EXECUTEing a function a different module owns, e.g. fiscal → sync via
  // sync_capture). Both fold into the same `{dep, kind, table}` shape so one violations loop covers
  // them and the message reads the same way.
  function crossModuleEdges(raw: string, moduleName: string): Edge[] {
    const edges = edgeDetails(raw, moduleName, owner);
    for (const dep of spiEdgesFor(raw, moduleName, funcOwner)) {
      edges.push({ dep, kind: "sync_capture SPI", table: "sync_capture" });
    }
    return edges;
  }

  const foundEdges = new Set<string>();
  for (const pkg of discovered) {
    for (const raw of pkg.sqls) {
      for (const edge of crossModuleEdges(raw, pkg.moduleName)) {
        foundEdges.add(`${pkg.moduleName}→${edge.dep}`);
      }
    }
  }

  // Vacuous-pass anchor. A scan that silently matched nothing would leave `violations` empty and pass
  // — identical to every descriptor being honest. So pin that the discovery found the modules that
  // are not going away (a loose floor, not an exact count — CLAUDE.md §2) AND that the scan actually
  // resolved the three known real cross-module edges SP-1c's review caught by hand.
  it("discovers the modules and finds the known real cross-module edges", () => {
    for (const name of ["core", "identity", "payments", "sync", "workforce"]) {
      expect(modules).toContain(name);
    }
    expect(modules.length).toBeGreaterThanOrEqual(8);
    expect(foundEdges.has("sync→identity")).toBe(true);
    expect(foundEdges.has("sync→payments")).toBe(true);
    expect(foundEdges.has("workforce→identity")).toBe(true);
    expect(foundEdges.has("fiscal→sync")).toBe(true);
  });

  it("every FK/trigger edge in the SQL is named in the depending descriptor's requires", () => {
    const violations: string[] = [];
    for (const pkg of discovered) {
      const declared = declaredDepsOf(pkg.moduleName);
      for (const raw of pkg.sqls) {
        for (const edge of crossModuleEdges(raw, pkg.moduleName)) {
          if (declared.has(edge.dep)) continue;
          const message = `${pkg.moduleName} depends on ${edge.dep} via ${edge.kind} on ${edge.table} — not in requires`;
          if (!violations.includes(message)) violations.push(message);
        }
      }
    }
    expect(violations.sort()).toEqual([]);
  });
});
