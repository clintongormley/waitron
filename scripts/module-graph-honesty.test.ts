import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_MODULES } from "../apps/server/src/modules.js";

/**
 * Every module descriptor's `requires` must NAME every cross-module dependency its migrations create
 * in SQL. A module depends on another when its `drizzle/*.sql` either FK-`REFERENCES` a table the
 * other module owns, OR installs a `CREATE TRIGGER … ON <table>` against one — both edges force a
 * migration-order dependency, because the referenced/triggered table must exist first.
 *
 * WHY THIS HAS TO BE A TREE-WIDE ROOT-PROJECT PROGRAM. The `requires` graph lives in one package
 * (`apps/server/src/modules.ts`) but the evidence for it — the `CREATE TABLE`/`REFERENCES`/
 * `CREATE TRIGGER` statements — is spread across every domain package's `drizzle/` directory. No
 * per-package suite can see both: a package that under-declares `requires` has, by construction, the
 * SQL in one package and the descriptor in another, and each package's own `test:coverage` loads only
 * its own tree. Only a program that reads `apps/server`'s descriptors AND every `packages/<pkg>/drizzle`
 * at once can cross-check them. That is why it sits in the root Vitest project beside
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
 * its owning module, then for each module scans for the two edge kinds, resolves each target table to
 * its owner, drops same-module targets, and asserts the surviving cross-module set is a subset of the
 * descriptor's declared `requires`. A package is in scope only if a descriptor's `migrations.from`
 * (`../<pkg>/drizzle`) points at it, so the module NAME (e.g. `fiscal`) is derived from the descriptor
 * rather than assumed equal to the package DIR name (e.g. `fiscal-verifactu`).
 *
 * KNOWN LIMITATIONS, stated rather than papered over (CLAUDE.md §1):
 *   - It is a regex over comment- and string-stripped text, NOT a SQL parser. `stripSql` blanks
 *     slash-star blocks, `--` line comments, and `'…'` string literals (preserving line numbers), so a
 *     `references`/`create trigger` mention in any of those is ignored — pinned by the detector's
 *     negative controls below. But a `CREATE TRIGGER` whose `ON <table>` is separated from the trigger
 *     name by content the `.*?` cannot span cleanly, or a table named with unusual quoting the
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
/** `CREATE TRIGGER <name> … ON ["public".]"<table>"` — the capture/immutability trigger edge. The
 * `s` (dotAll) flag lets `.*?` span the multi-line triggers the tree writes (name on line 1, `ON`
 * clause on line 2); `\bon\b` first-matches the real ON clause because no keyword between it and the
 * trigger name (`AFTER`/`INSERT`/`UPDATE`/`DELETE`/`OR`/`BEFORE`/`TRUNCATE`) is the word "on". */
const CREATE_TRIGGER = /\bcreate\s+trigger\s+\S+\s+.*?\bon\s+"?(?:public"?\.)?"?(\w+)"?/gis;

const EDGE_KINDS = [
  ["FK reference", REFERENCES],
  ["capture trigger", CREATE_TRIGGER],
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

/** From every descriptor's `migrations.from` (`../<pkg>/drizzle`), the package DIR → module NAME map.
 * A package is only in scope if some descriptor points at it — that is what makes `fiscal-verifactu`
 * resolve to the module named `fiscal`, not to a module named after the directory. */
function packageDirToModule(): Map<string, string> {
  const map = new Map<string, string>();
  for (const module of ALL_MODULES) {
    const match = /^\.\.\/(.+)\/drizzle$/.exec(module.migrations.from);
    if (match?.[1] !== undefined) map.set(match[1], module.name);
  }
  return map;
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
      { dep: "beta", kind: "capture trigger", table: "gadgets" },
    ]);
  });
});

describe("the tree's module graph is honest", () => {
  const discovered = discoverDrizzlePackages();
  const owner = ownerOfTable(discovered);
  const modules = discovered.map((pkg) => pkg.moduleName);

  const foundEdges = new Set<string>();
  for (const pkg of discovered) {
    for (const raw of pkg.sqls) {
      for (const edge of edgeDetails(raw, pkg.moduleName, owner)) {
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
  });

  it("every FK/trigger edge in the SQL is named in the depending descriptor's requires", () => {
    const violations: string[] = [];
    for (const pkg of discovered) {
      const declared = declaredDepsOf(pkg.moduleName);
      for (const raw of pkg.sqls) {
        for (const edge of edgeDetails(raw, pkg.moduleName, owner)) {
          if (declared.has(edge.dep)) continue;
          const message = `${pkg.moduleName} depends on ${edge.dep} via ${edge.kind} on ${edge.table} — not in requires`;
          if (!violations.includes(message)) violations.push(message);
        }
      }
    }
    expect(violations.sort()).toEqual([]);
  });
});
