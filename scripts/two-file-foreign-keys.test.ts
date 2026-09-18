import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_MODULES } from "../packages/composition/src/index.js";

/**
 * Two database files, and nothing joining them at the database level.
 *
 * The SQLite switch puts everything classified `ledger` or `state` in `venue.db` and everything
 * classified `local` in `node.db` (topology design §2.1). A foreign key across the two would make it
 * impossible to back up or restore either file on its own, which is the whole reason for splitting
 * them, so the split's precondition is checked here rather than discovered at the flip.
 *
 * WHY A ROOT-PROJECT PROGRAM. The classification is assembled in `@waitron/composition` and the
 * foreign keys are spread across a dozen packages' own migration sets, so no per-package suite can
 * see both sides — the same reason `classification-complete.test.ts` lives here.
 *
 * WHAT IT READS. Drizzle's own head snapshot per migration set, resolved through `meta/_journal.json`
 * exactly as `no-tenant-column.test.ts` resolves it: the normalised schema drizzle-kit diffs to emit
 * its SQL, which holds the graph directly as `tables[*].foreignKeys[*]`. Reading generated artifacts
 * rather than the TypeScript keeps this file free of the storage engine's types, which is what the
 * flip exists to avoid having to revisit.
 *
 * Three gaps, stated because a failing test can never restore a missing hedge:
 *
 * 1. **A key declared in TypeScript but not yet generated is invisible to it**, and nothing in the
 *    tree regenerates a migration set and diffs it, so nothing catches the gap either: searched on
 *    2026-09-19 for every file naming drizzle-kit across `packages`, `apps`, `scripts`, `.github`,
 *    `.husky` and `deploy`, the only suites that came back are each package's
 *    `schema-ownership.test.ts`, which assert which tables a set creates, never that a regeneration
 *    is a no-op. The trade is deliberate: an ungenerated key reaches no database, while a key still
 *    live in every migrated box would have passed a reading taken from the TypeScript the moment
 *    someone edited it — which is exactly the state the two `DROP CONSTRAINT` migrations beside this
 *    guard exist to leave behind.
 * 2. **A key added by hand-written SQL is invisible too**, because a custom migration does not change
 *    the snapshot — and there are such keys: read on 2026-09-19, scanning each
 *    `packages/<pkg>/drizzle/` directory's SQL statement by statement, applying every `ADD
 *    CONSTRAINT … FOREIGN KEY` and subtracting every `DROP CONSTRAINT` and `DROP TABLE`, ends with
 *    MORE keys than the snapshots hold — the extras all declared in the hand-written `*_sql.sql`
 *    files. What that scan agrees with the snapshots about is the answer: no crossing edge, and no
 *    unclassified endpoint, from either reading. Nothing keeps them agreeing. (The directory is
 *    written with a placeholder because a glob's closing `*` followed by a slash would end this
 *    comment.)
 * 3. **It judges by the table NAME.** Two tables with the same physical name in different modules
 *    would be one node in this graph; `classification-complete.test.ts` is what forbids that.
 */

const repoRoot = join(import.meta.dirname, "..");
const ROOTS = ["packages", "apps"];

/** Which file a class lives in (topology design §2.1). */
function fileOfClass(cls: string): string {
  return cls === "local" ? "node.db" : "venue.db";
}

/** Physical table name (lowercased) -> declared class, across every module. */
function classOfTable(): Map<string, string> {
  const classes = new Map<string, string>();
  for (const module of ALL_MODULES) {
    for (const entry of module.classification ?? []) {
      classes.set(entry.table.toLowerCase(), entry.class);
    }
  }
  return classes;
}

/** Every `drizzle/` migration set directly under a package or app, as repo-relative paths. */
function migrationSets(): string[] {
  const sets: string[] = [];
  for (const root of ROOTS) {
    for (const entry of readdirSync(join(repoRoot, root))) {
      const dir = join(repoRoot, root, entry, "drizzle");
      if (existsSync(dir) && statSync(dir).isDirectory()) sets.push(relative(repoRoot, dir));
    }
  }
  return sets.sort();
}

/**
 * The snapshot drizzle holds for a set's HEAD. `"empty"` is a set that declares no migrations at all
 * (`packages/fiscal-none` owns no tables); `"missing"` is a set with no journal at all, or one whose
 * journal names a head whose snapshot is not on disk. Either would drop that set out of the check
 * below without saying so, which is the case the suite refuses rather than skips.
 */
type HeadSnapshot = { kind: "file"; path: string } | { kind: "empty" } | { kind: "missing" };

function headSnapshot(set: string): HeadSnapshot {
  const journal = join(repoRoot, set, "meta", "_journal.json");
  if (!existsSync(journal)) return { kind: "missing" };
  const entries = JSON.parse(readFileSync(journal, "utf8")).entries as { idx: number }[];
  if (entries.length === 0) return { kind: "empty" };
  const head = Math.max(...entries.map((entry) => entry.idx));
  const snapshot = join(repoRoot, set, "meta", `${String(head).padStart(4, "0")}_snapshot.json`);
  return existsSync(snapshot)
    ? { kind: "file", path: relative(repoRoot, snapshot) }
    : { kind: "missing" };
}

interface Edge {
  set: string;
  constraint: string;
  from: string;
  columns: string[];
  to: string;
}

/** Every foreign key in every set's head snapshot. */
function declaredForeignKeys(): Edge[] {
  const edges: Edge[] = [];
  for (const set of migrationSets()) {
    const head = headSnapshot(set);
    if (head.kind !== "file") continue;
    const snapshot = JSON.parse(readFileSync(join(repoRoot, head.path), "utf8")) as {
      tables: Record<
        string,
        {
          name: string;
          foreignKeys?: Record<
            string,
            { name: string; tableFrom: string; tableTo: string; columnsFrom: string[] }
          >;
        }
      >;
    };
    for (const table of Object.values(snapshot.tables)) {
      for (const fk of Object.values(table.foreignKeys ?? {})) {
        edges.push({
          set,
          constraint: fk.name,
          from: fk.tableFrom.toLowerCase(),
          columns: fk.columnsFrom,
          to: fk.tableTo.toLowerCase(),
        });
      }
    }
  }
  return edges;
}

/**
 * What the check below says about one edge: `null` when it is fine, a message when it is not. Lifted
 * out of the test so the negative controls at the bottom can pin that it fires — an absence
 * assertion passes just as well when the predicate underneath it has stopped working, which is why
 * `no-tenant-column.test.ts` carries controls of its own.
 */
function violationOf(edge: Edge, classes: Map<string, string>): string | null {
  const from = classes.get(edge.from);
  const to = classes.get(edge.to);
  const where = `${edge.set}: ${edge.constraint} — ${edge.from}(${edge.columns.join(", ")}) -> ${edge.to}`;
  // An unclassified endpoint is a violation, not a skip: the crossing cannot be judged without both
  // classes, and a filter would drop the edge and pass.
  if (from === undefined || to === undefined) {
    return `${where} [unclassified: ${from ?? edge.from}, ${to ?? edge.to}]`;
  }
  return fileOfClass(from) !== fileOfClass(to) ? `${where} [${from} -> ${to}]` : null;
}

describe("the two database files are independent", () => {
  it("has no foreign key crossing between them", () => {
    const classes = classOfTable();
    const violations = declaredForeignKeys()
      .map((edge) => violationOf(edge, classes))
      .filter((violation) => violation !== null);
    expect(violations.sort()).toEqual([]);
  });

  it("reads a head snapshot for every migration set that declares one", () => {
    // A set whose journal names a head with no snapshot on disk would drop out of the check above
    // without saying so, and an absence assertion cannot notice its own missing input.
    expect(migrationSets().filter((set) => headSnapshot(set).kind === "missing")).toEqual([]);
  });

  // Vacuous-pass anchor. An empty graph — a snapshot shape that changed under us, a discovery that
  // matched no set — would leave the check above passing, which is what a fully resolved tree looks
  // like too. So pin that the scan really read the tree.
  it("reads a real foreign-key graph, not an empty one", () => {
    const edges = declaredForeignKeys();
    const printed = edges.map((edge) => `${edge.from} -> ${edge.to}`);
    expect(printed).toContain("sale_lines -> sales");
    expect(printed).toContain("webauthn_credentials -> persons");
    expect(edges.length).toBeGreaterThanOrEqual(100);
    expect(new Set(edges.map((edge) => edge.set)).size).toBeGreaterThanOrEqual(6);
  });
});

/**
 * The check above asserts an absence, which passes exactly as well when the judgement underneath it
 * has stopped working. These feed `violationOf` edges built by hand — the real classifications, a
 * made-up constraint — so that both answers are pinned rather than one.
 */
describe("negative controls", () => {
  const classes = classOfTable();
  const edge = (from: string, to: string): Edge => ({
    set: "control",
    constraint: "control_fk",
    from,
    columns: ["control_id"],
    to,
  });

  it("reports a key from a node's own table into the venue's", () => {
    // `sessions` is `local` and `persons` is `state` — the shape this branch removed six of.
    expect(violationOf(edge("sessions", "persons"), classes)).toContain("[local -> state]");
  });

  it("reports one in the other direction too", () => {
    expect(violationOf(edge("persons", "sessions"), classes)).toContain("[state -> local]");
  });

  it("says nothing about a key that stays inside one file", () => {
    // Both `state`: the keys this rule leaves alone.
    expect(violationOf(edge("webauthn_credentials", "persons"), classes)).toBeNull();
    // Both `local`.
    expect(violationOf(edge("sessions", "management_sessions"), classes)).toBeNull();
  });

  it("reports an endpoint no module classifies, rather than skipping it", () => {
    expect(violationOf(edge("sessions", "not_a_table"), classes)).toContain("unclassified");
  });
});
