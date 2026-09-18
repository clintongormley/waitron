import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_MODULES } from "../packages/composition/src/index.js";
import { declaredForeignKeys } from "../packages/db/src/schema/foreign-keys.js";

/**
 * Two database files, and nothing joining them at the database level.
 *
 * The SQLite switch puts everything classified `ledger` or `state` in `venue.db` and everything
 * classified `local` in `node.db` (topology design §2.1). A foreign key across the two would make it
 * impossible to back up or restore either file on its own, which is the whole reason for splitting
 * them, so the split's precondition is checked here rather than discovered at the flip.
 *
 * WHY A ROOT-PROJECT PROGRAM. The classification is assembled in `@waitron/composition` and the
 * foreign keys are declared in a dozen packages' schema files, so no per-package suite can see both
 * sides — the same reason `classification-complete.test.ts` lives here.
 *
 * Three gaps, stated because a failing test can never restore a missing hedge:
 *
 * 1. **It reads the TypeScript schema, not the database.** A foreign key written by hand in a
 *    migration and never declared in a table file is invisible to it. Checked on 2026-09-18 by
 *    scanning every `packages/*∕drizzle/*.sql` for `ADD CONSTRAINT … FOREIGN KEY`: every crossing
 *    edge in the tree is declared in TypeScript, so today the two readings agree — but nothing keeps
 *    them agreeing.
 * 2. **A package is in scope only if it has a `drizzle.config.ts` naming its schema entry point**,
 *    which is read as TEXT from that file. A table declared in a file the entry point does not
 *    export is outside both this guard and drizzle-kit's own snapshot.
 * 3. **It judges by the table NAME.** Two tables with the same physical name in different modules
 *    would be one node in this graph; `classification-complete.test.ts` is what forbids that.
 */

const REPO_ROOT = join(import.meta.dirname, "..");
const PACKAGES_DIR = join(REPO_ROOT, "packages");

/** `schema: "./src/schema/index.ts"` — the entry point drizzle-kit itself builds its snapshot from,
 * so this guard reads exactly the table set the migrations are generated from. */
const SCHEMA_ENTRY = /schema:\s*"([^"]+)"/;

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

/** Every package whose `drizzle.config.ts` names a schema entry point, with that path. */
function schemaEntryPoints(): { packageDir: string; entry: string }[] {
  const found: { packageDir: string; entry: string }[] = [];
  for (const packageDir of readdirSync(PACKAGES_DIR).sort()) {
    let config: string;
    try {
      config = readFileSync(join(PACKAGES_DIR, packageDir, "drizzle.config.ts"), "utf8");
    } catch {
      continue;
    }
    const match = SCHEMA_ENTRY.exec(config);
    if (match?.[1] !== undefined) {
      found.push({ packageDir, entry: join(PACKAGES_DIR, packageDir, match[1]) });
    }
  }
  return found;
}

interface Edge {
  packageDir: string;
  table: string;
  columns: readonly string[];
  references: string;
}

async function allForeignKeys(): Promise<Edge[]> {
  const edges: Edge[] = [];
  for (const { packageDir, entry } of schemaEntryPoints()) {
    const schemaModule: Record<string, unknown> = await import(/* @vite-ignore */ entry);
    for (const fk of declaredForeignKeys(schemaModule)) {
      edges.push({ packageDir, ...fk });
    }
  }
  return edges;
}

describe("the two database files are independent", () => {
  it("has no foreign key crossing between them", async () => {
    const classes = classOfTable();
    const crossings = (await allForeignKeys())
      .filter((edge) => {
        const from = classes.get(edge.table.toLowerCase());
        const to = classes.get(edge.references.toLowerCase());
        return from !== undefined && to !== undefined && fileOfClass(from) !== fileOfClass(to);
      })
      .map(
        (edge) =>
          `${edge.packageDir}: ${edge.table}(${edge.columns.join(", ")}) -> ${edge.references}` +
          ` [${classes.get(edge.table.toLowerCase())} -> ${classes.get(edge.references.toLowerCase())}]`,
      );
    expect(crossings.sort()).toEqual([]);
  });

  it("knows the class of every table in the foreign-key graph", async () => {
    const classes = classOfTable();
    const unclassified = new Set<string>();
    for (const edge of await allForeignKeys()) {
      for (const table of [edge.table, edge.references]) {
        if (!classes.has(table.toLowerCase())) unclassified.add(table);
      }
    }
    expect([...unclassified].sort()).toEqual([]);
  });

  // Vacuous-pass anchor. An empty graph — a schema entry point that stopped resolving, a discovery
  // that matched no package — would leave both checks above passing, which is what a fully resolved
  // tree looks like too. So pin that the scan really read the tree.
  it("reads a real foreign-key graph, not an empty one", async () => {
    const edges = await allForeignKeys();
    const printed = edges.map((e) => `${e.table} -> ${e.references}`);
    expect(printed).toContain("sale_lines -> sales");
    expect(printed).toContain("webauthn_credentials -> persons");
    expect(edges.length).toBeGreaterThanOrEqual(100);
    expect(new Set(edges.map((e) => e.packageDir)).size).toBeGreaterThanOrEqual(6);
  });
});
