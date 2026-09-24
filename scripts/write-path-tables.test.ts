import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { PRIVILEGES } from "../packages/fiscal-verifactu/src/privileges.expected.js";

/**
 * Five tables the application code may read and never write: `tenants`, `nodes`, `deployment`,
 * `mirror_config` and `node_roles`.
 *
 * NOTHING BUT THIS FILE REFUSES THEM. SQLite has no roles and no grants — one process opens one
 * file — and every path, request and provisioning alike, shares that one venue handle. So the rule
 * survives only as a convention over source text, and this guard is the whole of its enforcement.
 * Read the four hedges below before trusting it.
 *
 * It is about WHICH FILE does the write, not about being a request. A request can legitimately
 * reach these tables: the setup-mode provision route reaches `tenants`, `nodes` and `deployment`,
 * the setup-mode adopt route reaches `deployment`, `node_roles` and `mirror_config`, and the
 * promote route reaches `node_roles`. Each does it by calling into one of the files
 * `write-path-tables.json` names, which is where such a write is allowed to live. Keeping
 * those writes in a handful of named files is the property being defended; hedge 2 below is what it
 * costs.
 *
 * WHY A ROOT-PROJECT PROGRAM. The list of tables lives in a different package from the code that
 * could write them, which is spread across every app and package, so no per-package suite can see
 * both sides — the same reason `two-file-foreign-keys.test.ts` and `classification-complete.test.ts`
 * live here. The root project is not typechecked (the root `vitest.config.ts` carries the mutation
 * that measured it), so the import of `PRIVILEGES` above is checked by running, not by `tsc`.
 *
 * WHERE THE LIST COMES FROM. `packages/fiscal-verifactu/src/privileges.expected.ts` — the matrix
 * that recorded `app_user`'s table privileges. Four of the tables are the ones it records as `S`;
 * `node_roles` came later and inherits `deployment`'s rule (`ADDED_SINCE_THE_MATRIX` below). It
 * is a frozen record, not a measurement: nothing checks it against a database. It only ever
 * measured TABLE-level grants, so a column-scoped write grant on one of the four never showed up in
 * it or here. `write-path-tables.json` beside this file holds the same four FROZEN, plus
 * `node_roles`, because the matrix goes when the rest of the grant-era record does; the case below
 * cross-checks the two while both exist, and deleting the matrix breaks this file's import rather
 * than making it quietly pass.
 *
 * It is WEAKER than "no write path touches a forbidden table", in four ways that are worth stating
 * because a failing test can never restore a missing hedge:
 *
 * 1. **It reads TEXT.** A write assembled from a variable table name, or reached through a helper
 *    that names the table somewhere this reader does not look, is invisible to it. So is any spelling
 *    the detector below does not list — it knows `insert into`, `delete from`, `truncate`, `update …
 *    set`, each optionally schema-qualified, and drizzle's three builder calls on a receiver whose
 *    name looks like a database handle. Nothing else, and the two paragraphs on `withoutComments`
 *    and `detector` name what each of those gives up.
 * 2. **It judges a FILE, not a call chain.** An allowed file is allowed outright, so a request path
 *    that calls into one of them writes through it unseen. What it catches is the shape that has
 *    actually occurred: a write appearing in a file that had no business having one.
 * 3. **It reads `<member>/src` under `apps` and `packages` only**, minus `*.test.ts` and everything
 *    under a `testing/` directory. Fixtures there seed `tenants` and `nodes` outright
 *    (`packages/db/src/testing/seed.ts` among them), so including them would mean an allowance list
 *    of fixtures that hides the real ones. Outside the walk entirely, and so unseen: a package's
 *    `test/` directory, `apps/<app>/scripts` (four demo scripts there write `tenants`, three of them `nodes` too),
 *    and anything at a package root.
 * 4. **It is about the tables that were refused AT ALL**, plus `node_roles`. The grants used to
 *    refuse plenty more one operation at a time — no DELETE on the sale tables, UPDATE narrowed to
 *    named columns on two others — and none of that was ever checked here, nor is any of it
 *    refused now.
 *    `docs/backlog.md` → B9 carries the decision.
 */

const REPO_ROOT = join(import.meta.dirname, "..");

/**
 * table -> the files allowed to write it, repo-relative.
 *
 * A frozen JSON file rather than a constant here, because it has to outlive the grants it was taken
 * from. Why each entry is allowed, traced caller by caller on 2026-09-19 (the `deployment.ts` entry
 * re-traced on 2026-09-24):
 *
 *   `packages/provisioning/src/venue-apply.ts`   creates the taxpayer row and the node, under the
 *                                                setup-mode provision route, the `waitron-provision`
 *                                                command line, and the fiscal-readiness runner's
 *                                                throwaway database.
 *   `packages/db/src/node-identity.ts`           stamps a node's public key, from the setup-mode
 *                                                provision route.
 *   `packages/db/src/reserved-identity.ts`       writes a standby's dormant node row, from the boot
 *                                                adoption worker.
 *   `packages/db/src/deployment.ts`              stamps the environment, from the setup-mode
 *                                                provision and adopt routes and the
 *                                                `waitron-provision` command line; writes a node's
 *                                                mode from adopt and the mirror promotion (a
 *                                                `mirror` mode write sets the singleton role with
 *                                                it); its singleton role from both promote paths
 *                                                and the boot demote; and its break-glass verifier
 *                                                from adopt, through the break-glass mint.
 *   `packages/db/src/mirror-config.ts`           writes the cloud mirror's connection config, from
 *                                                the setup-mode adopt route.
 */
const ALLOWED: Record<string, readonly string[]> = JSON.parse(
  readFileSync(join(REPO_ROOT, "scripts", "write-path-tables.json"), "utf8"),
);

/** `mirror_config` -> `mirrorConfig`: the drizzle object a write names, from the SQL table name. */
function schemaObject(table: string): string {
  return table.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

/**
 * Comments removed, line by line, including a comment that follows code on its own line.
 *
 * Why remove them at all: `packages/db/src/mirror-config.ts` explains in a comment that
 * `stampDeployment` writes through `db.insert(deployment)`, and that one sentence was everything the
 * first version of this guard reported across the whole tree.
 *
 * Why a trailing comment has to go too: leaving it there made the sentence above report the file it
 * was written in as soon as somebody moved it to the end of a line of code. The line in front of the
 * comment is still read, so a write there is not lost.
 *
 * A `//` that follows `:` is left alone, because that is a URL inside a string and cutting the line
 * there could drop a write sitting after it.
 *
 * Only a block opener that STARTS its line runs on to the lines below. A `"/*"` in the middle of a
 * line is nearly always a string — the review seat wrote exactly that file and hid a real write on
 * the lines under it — so an unclosed one ends its own line and nothing more.
 *
 * WHERE IT IS STILL WRONG, three ways, each needing a parser rather than a reader. A block comment
 * that opens at the END of a line of code and runs on is not followed, so its text is read as code:
 * a write written inside one is reported, which is the false direction to be wrong in but still
 * wrong. A comment marker inside a string on a line of code ends that line here, so a write after it
 * on the same line is lost. And the string-literal hole is narrowed rather than closed — a line
 * inside a template literal whose first characters are `/*` still opens a block and still swallows
 * the code below it, measured on this reader, so a write can hide under one.
 */
function withoutComments(source: string): string {
  const kept: string[] = [];
  let inBlock = false;
  for (const line of source.split("\n")) {
    let rest = line;
    if (inBlock) {
      const close = rest.indexOf("*/");
      if (close === -1) continue;
      inBlock = false;
      rest = rest.slice(close + 2);
    } else if (rest.trimStart().startsWith("/*")) {
      const open = rest.indexOf("/*");
      const close = rest.indexOf("*/", open + 2);
      if (close === -1) {
        inBlock = true;
        continue;
      }
      rest = rest.slice(0, open) + " " + rest.slice(close + 2);
    }
    // Then any balanced block comment sitting inside a line of code: `foo(/* why */ a)` is code.
    let open = rest.indexOf("/*");
    while (open !== -1) {
      const close = rest.indexOf("*/", open + 2);
      rest = close === -1 ? rest.slice(0, open) : rest.slice(0, open) + " " + rest.slice(close + 2);
      if (close === -1) break;
      open = rest.indexOf("/*");
    }
    const lineComment = rest.search(/(^|[^:])\/\//);
    if (lineComment !== -1) rest = rest.slice(0, lineComment);
    kept.push(rest);
  }
  return kept.join("\n");
}

/**
 * How a write of `table` is spelled.
 *
 * `UPDATE` must carry its `SET`. That is defensive rather than a fix for something observed:
 * `nodes` and `deployment` are ordinary English words, and a sentence about updating nodes would
 * otherwise read as a write. No such sentence is in the tree today — the requirement is there to
 * keep one from arriving. The rest are shapes
 * reviewers proved slip past a narrower reader: a schema qualification, an alias between the table
 * and its `SET`, `TRUNCATE`, a space before a builder's parenthesis, a namespace or a cast inside it.
 *
 * The builder's receiver has to look like a database handle — a name ending in `db`, `tx`, `trx`,
 * `transaction`, `conn` or `client`, or nothing at all where the call opens its line as part of a
 * chain. Without that, `cache.delete(nodes)` on an ordinary `Set` is reported as a write to the
 * `nodes` table, and every one of these tables has a name an ordinary variable might carry. The cost
 * is the other half of the same coin: a real write through a handle named something else, on a line
 * that does not start with the dot, is invisible here.
 */
function detector(table: string): string {
  const object = schemaObject(table);
  const named = String.raw`(?:"?[a-z_][\w$]*"?\s*\.\s*)?"?${table}"?`;
  const statement =
    String.raw`(?:insert\s+into|delete\s+from|truncate(?:\s+table)?(?:\s+only)?)\s+${named}\b` +
    `|` +
    String.raw`\bupdate\s+(?:only\s+)?${named}(?:\s+(?:as\s+)?[a-z_$][\w$]*)?\s+set\b`;
  const handle = String.raw`(?:^|[^\w$])[\w$]*(?:db|tx|trx|transaction|conn|client)\s*\.\s*|^\s*\.\s*`;
  const builder =
    String.raw`(?:${handle})(?:insert|update|delete)\s*\(\s*` +
    String.raw`(?:[A-Za-z_$][\w$]*\s*\.\s*){0,2}${object}\s*(?:as\s+[\w$]+\s*)?[,)]`;
  return `${statement}|${builder}`;
}

const TABLES = Object.keys(ALLOWED);
/** Built once. The combined form is a cheap reject: most files match none of the tables. */
const DETECTORS = new Map(TABLES.map((table) => [table, new RegExp(detector(table), "im")]));
const ANY_TABLE = new RegExp(TABLES.map((table) => detector(table)).join("|"), "im");

/** Does this source write `table`? A comment is not code, wherever on its line it starts. */
function writes(source: string, table: string): boolean {
  return DETECTORS.get(table)!.test(withoutComments(source));
}

const SOURCE_EXTENSIONS = [".ts", ".mts", ".cts", ".tsx"];

/**
 * Production source under both roots: no suites, and nothing from a `testing/` directory.
 *
 * Directories are pruned as the walk descends rather than filtered afterwards, the way
 * `module-seams.test.ts` does it — `guarded-teardowns.test.ts` measured a post-filter walk of
 * `packages/` at "~996,000 entries to find ~190 files". A directory can also vanish between listing its parent and reading it, so a failed
 * read is skipped rather than thrown.
 */
function sourceFiles(dir: string): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "testing" || entry.name === "node_modules" || entry.name.startsWith("."))
        continue;
      files.push(...sourceFiles(path));
      continue;
    }
    if (entry.name.includes(".test.")) continue;
    if (!SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) continue;
    // A failing browser test leaves a screenshot DIRECTORY named like a source file (CLAUDE.md §4).
    // The branch above descends into it rather than excluding it, and it holds no `.ts` file, so
    // nothing reaches this line from one — which is why there is no `statSync` here: it would add a
    // syscall that throws on the very race the read above is wrapped for.
    if (!entry.isFile()) continue;
    files.push(relative(REPO_ROOT, path));
  }
  return files;
}

function productionSources(): string[] {
  const files: string[] = [];
  for (const root of ["apps", "packages"]) {
    let members: string[];
    try {
      members = readdirSync(join(REPO_ROOT, root));
    } catch {
      continue;
    }
    for (const member of members) {
      files.push(...sourceFiles(join(REPO_ROOT, root, member, "src")));
    }
  }
  return files.sort();
}

const SOURCES = productionSources();
const ALLOWANCES = new Map(TABLES.map((table) => [table, new Set(ALLOWED[table])]));

// Tables created after the privilege matrix froze, each inheriting a frozen table's rule.
// `node_roles` holds the three columns that left `deployment` (slice-2 spec §2).
const ADDED_SINCE_THE_MATRIX = ["node_roles"];

describe("no source writes a table the application role may only read", () => {
  it("finds no forbidden write", () => {
    const offenders: string[] = [];
    for (const file of SOURCES) {
      const text = withoutComments(readFileSync(join(REPO_ROOT, file), "utf8"));
      if (!ANY_TABLE.test(text)) continue;
      for (const table of TABLES) {
        if (ALLOWANCES.get(table)!.has(file)) continue;
        if (DETECTORS.get(table)!.test(text)) offenders.push(`${file} writes ${table}`);
      }
    }
    expect(
      offenders,
      "This guard is the ONLY thing refusing this write. A role used to hold SELECT and no write " +
        "on these tables, so the database refused it; SQLite has no roles, so nothing at runtime " +
        "will stop you. Either the write belongs on a provisioning or boot " +
        "path, or it should not exist. Adding the file to " +
        "scripts/write-path-tables.json is the wrong answer unless it is such a path:\n  " +
        offenders.join("\n  "),
    ).toEqual([]);
  });

  it("holds exactly the tables the privilege matrix records as readable but not writable, plus those added since", () => {
    const readOnly = Object.entries(PRIVILEGES)
      .filter(([, letters]) => !/[IUDT]/.test(letters))
      .map(([table]) => table);
    expect(TABLES.slice().sort()).toEqual([...readOnly, ...ADDED_SINCE_THE_MATRIX].sort());
  });

  // Non-vacuity, end to end, and deliberately NOT a count of how many files were read: every
  // allowance must still be a file that really writes its table. If the reader broke — a regex that
  // matches nothing, a walk that returns nothing — these go quiet together and this case fails.
  it("still sees a write in every file it allows", () => {
    const silent: string[] = [];
    const found = new Set(SOURCES);
    for (const [table, allowed] of Object.entries(ALLOWED)) {
      for (const file of allowed) {
        if (!found.has(file)) silent.push(`${file} is not a production source file`);
        else if (!writes(readFileSync(join(REPO_ROOT, file), "utf8"), table)) {
          silent.push(`${file} no longer writes ${table} — delete the allowance`);
        }
      }
    }
    expect(silent).toEqual([]);
  });

  // Every allowance is under `packages/`, so the `apps/` half of the walk could return nothing and
  // every other case here would still pass.
  it("reaches both roots, and reads a whole tree rather than a corner of one", () => {
    for (const root of ["apps", "packages"]) {
      expect(SOURCES.some((file) => file.startsWith(`${root}${sep}`))).toBe(true);
    }
    // A lower bound, not a count — the same shape and the same number `no-tenant-column.test.ts`
    // uses, and for the same reason: a figure that tracked the tree would go stale on any deletion,
    // while a floor set well under it only fires when the walk has genuinely stopped descending.
    expect(SOURCES.length).toBeGreaterThan(500);
  });

  it("leaves everything under a testing directory out of scope, and there is some", () => {
    expect(SOURCES.filter((file) => file.split(sep).includes("testing"))).toEqual([]);
    expect(
      readdirSync(join(REPO_ROOT, "packages", "db", "src", "testing")).some((name) =>
        name.endsWith(".ts"),
      ),
    ).toBe(true);
  });
});

describe("the detector itself", () => {
  it("reports an insert, an update, a delete and a truncate written as SQL", () => {
    expect(writes("insert into tenants (id) values (1)", "tenants")).toBe(true);
    expect(writes("update nodes set name = 'x'", "nodes")).toBe(true);
    expect(writes("delete from mirror_config where id = 1", "mirror_config")).toBe(true);
    expect(writes("truncate table tenants", "tenants")).toBe(true);
  });

  it("reports a schema-qualified write and one that aliases the table", () => {
    expect(writes("delete from public.tenants where id = 1", "tenants")).toBe(true);
    expect(writes("update deployment as d set mode = 'primary' where d.id = 1", "deployment")).toBe(
      true,
    );
    expect(writes("update nodes n set name = 'x'", "nodes")).toBe(true);
  });

  it("reports the drizzle builder, through a namespace and across a space", () => {
    expect(writes("await tx.insert(tenants).values(row)", "tenants")).toBe(true);
    expect(writes("await tx.update(schema.mirrorConfig).set(row)", "mirror_config")).toBe(true);
    expect(writes("await tx.delete(deployment)", "deployment")).toBe(true);
    expect(writes("await tx.update (deployment).set(row)", "deployment")).toBe(true);
  });

  it("says nothing about a read", () => {
    expect(writes("select legal_name from tenants where id = 1", "tenants")).toBe(false);
    expect(writes("await tx.select().from(tenants)", "tenants")).toBe(false);
  });

  it("says nothing about prose that happens to contain the table's name", () => {
    expect(writes("update nodes in the tree before painting", "nodes")).toBe(false);
    expect(writes("await tx.insert(nodeMembership).values(row)", "nodes")).toBe(false);
  });

  it("says nothing about a comment describing a write that lives somewhere else", () => {
    expect(writes("/** stampDeployment writes via db.insert(deployment). */", "deployment")).toBe(
      false,
    );
    expect(writes("  // ... db.insert(deployment) stamps the row", "deployment")).toBe(false);
    expect(
      writes(
        "/**\n * `insert into tenants` happens in the provisioner\n */\nconst x = 1;",
        "tenants",
      ),
    ).toBe(false);
  });

  it("still reads a line of code that carries a trailing comment", () => {
    expect(writes("await tx.insert(tenants).values(row); // see the provisioner", "tenants")).toBe(
      true,
    );
  });

  // A string literal holding a comment opener must not take the code beneath it with it.
  it("does not treat a comment opener inside a string as a comment", () => {
    const source = [
      'const start = "/*";',
      "await tx.insert(tenants).values(row);",
      'const end = "*/";',
    ].join("\n");
    expect(writes(source, "tenants")).toBe(true);
  });

  // A continuation line of an arithmetic expression starts with `*`, and an earlier version of this
  // reader dropped every such line as though it were inside a block comment.
  it("reads a line that begins with an operator", () => {
    expect(writes("const n = a\n  * b;\nawait tx.insert(tenants).values(row);", "tenants")).toBe(
      true,
    );
  });

  // Each of these fired on an ordinary line of code before the reader learned to strip a comment
  // that follows code, and each would have failed a push that had nothing to do with a database.
  it("says nothing about a comment that follows code on its line", () => {
    expect(writes("const x = 1; // update nodes when set", "nodes")).toBe(false);
    expect(writes("const x = 1; /* insert into tenants (id) values (1) */", "tenants")).toBe(false);
    expect(writes("function f(/* insert into tenants */ a) {}", "tenants")).toBe(false);
  });

  // `nodes` and `deployment` are names an ordinary variable carries, so a builder call is only read
  // as a write when its receiver looks like a database handle, or the call opens its own line.
  it("says nothing about a collection that happens to be called nodes", () => {
    expect(writes("this.cache.delete(nodes);", "nodes")).toBe(false);
    expect(writes("seen.delete(deployment);", "deployment")).toBe(false);
    expect(writes("await deps.ownerDb.insert(nodes).values(row);", "nodes")).toBe(true);
    expect(writes("  .insert(mirrorConfig)\n  .values(row)", "mirror_config")).toBe(true);
  });

  it("reports a namespaced or cast builder argument", () => {
    expect(writes("await tx.insert(schema.core.tenants).values(row)", "tenants")).toBe(true);
    expect(writes("await tx.insert(tenants as never).values(row)", "tenants")).toBe(true);
  });

  it("reports a write qualified by a schema that is not public", () => {
    expect(writes("insert into sync.tenants (id) values (1)", "tenants")).toBe(true);
  });

  // The reader keeps a URL's `//` rather than cutting the line there, because a write can follow it.
  it("does not read a URL inside a string as a comment", () => {
    expect(
      writes('const url = "https://x/y"; await tx.insert(tenants).values(row);', "tenants"),
    ).toBe(true);
  });
});
