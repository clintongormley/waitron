import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildSchemaListFile,
  type BuiltSchemaListEntry,
  type BuiltSchemaListFile,
} from "./build.js";
import { LIST_FILE, runCli } from "./cli.js";
import type { SchemaListEntry, SchemaListFile } from "./compare.js";

// The build measured 3.7 s locally; the margin is for a slower CI runner.
const BUILD_TIMEOUT_MS = 120_000;

let workDir: string;
let file: BuiltSchemaListFile;

beforeAll(async () => {
  workDir = mkdtempSync(join(tmpdir(), "wt-protection-list-"));
  file = await buildSchemaListFile({ migrationRoot: null, workDir });
}, BUILD_TIMEOUT_MS);

afterAll(() => {
  if (workDir !== undefined) rmSync(workDir, { recursive: true, force: true });
});

function entry(composition: string, phase: string, database: string): BuiltSchemaListEntry {
  const found = file.entries.find(
    (candidate) =>
      candidate.composition === composition &&
      candidate.phase === phase &&
      candidate.database === database,
  );
  if (found === undefined) throw new Error(`no entry ${composition} ${phase} ${database}`);
  return found;
}

const triggerNames = (e: SchemaListEntry) => e.schema.triggers.map((trigger) => trigger.name);
const tableNames = (e: SchemaListEntry) => e.schema.tables.map((table) => table.name);

describe("buildSchemaListFile", () => {
  it("lists both fiscal compositions in all three phases, for both databases", () => {
    expect(file.entries.map((e) => `${e.composition} ${e.phase} ${e.database}`).sort()).toEqual(
      ["fiscal-none", "fiscal-verifactu"]
        .flatMap((composition) =>
          ["sql-only", "migrated", "change-feed"].flatMap((phase) =>
            ["venue", "node"].map((database) => `${composition} ${phase} ${database}`),
          ),
        )
        .sort(),
    );
  });

  it("lists a behavioural trigger in every venue phase", () => {
    for (const composition of ["fiscal-none", "fiscal-verifactu"]) {
      for (const phase of ["sql-only", "migrated", "change-feed"]) {
        expect(triggerNames(entry(composition, phase, "venue"))).toContain(
          "working_orders_enforce_transition",
        );
      }
    }
    expect(entry("fiscal-verifactu", "sql-only", "venue").owningSet).toMatchObject({
      "trigger working_orders_enforce_transition": "core",
    });
  });

  it("keeps what applyMigrations added under applyMigrations in the change-feed entry", () => {
    for (const phase of ["migrated", "change-feed"]) {
      expect(entry("fiscal-verifactu", phase, "venue").owningSet).toMatchObject({
        "trigger handover_activations_append_only_update": "applyMigrations",
      });
    }
  });

  it("holds a fiscal-verifactu table only in that composition", () => {
    expect(tableNames(entry("fiscal-verifactu", "migrated", "venue"))).toContain(
      "registros_facturacion",
    );
    expect(tableNames(entry("fiscal-none", "migrated", "venue"))).not.toContain(
      "registros_facturacion",
    );
    expect(entry("fiscal-verifactu", "migrated", "venue").setOrder).toContain("fiscal-verifactu");
    expect(entry("fiscal-none", "migrated", "venue").setOrder).not.toContain("fiscal-verifactu");
  });

  it("adds the installers' triggers after the SQL", () => {
    const sqlOnly = triggerNames(entry("fiscal-verifactu", "sql-only", "venue"));
    const migrated = triggerNames(entry("fiscal-verifactu", "migrated", "venue"));
    const feed = triggerNames(entry("fiscal-verifactu", "change-feed", "venue"));
    expect(sqlOnly.length).toBeLessThan(migrated.length);
    expect(migrated.length).toBeLessThan(feed.length);
    expect(sqlOnly.some((name) => name.endsWith("_append_only_update"))).toBe(false);
    expect(migrated.some((name) => name.endsWith("_append_only_update"))).toBe(true);
    expect(migrated.some((name) => name.startsWith("waitron_change_"))).toBe(false);
    expect(feed.some((name) => name.startsWith("waitron_change_"))).toBe(true);
  });

  it("puts the node set in node.db, apart from the venue sets", () => {
    const node = entry("fiscal-verifactu", "migrated", "node");
    expect(tableNames(node)).toContain("node_handover_restriction");
    expect(tableNames(entry("fiscal-verifactu", "migrated", "venue"))).not.toContain(
      "node_handover_restriction",
    );
    expect(node.bookkeepingRows).toEqual({ node: expect.any(Number) });
    expect(node.bookkeepingRows.node).toBeGreaterThan(0);
  });

  it("records the product connection's settings and the database checks", () => {
    for (const e of file.entries) {
      expect(e.checks.integrity, `${e.composition} ${e.phase} ${e.database}`).toEqual(["ok"]);
      expect(e.checks.foreignKeyViolations).toBe(0);
      expect(e.checks.foreignKeys).toBe(1);
      if (e.phase !== "sql-only") expect(e.checks.recursiveTriggers).toBe(1);
    }
  });
});

describe("the command line", () => {
  function written(name: string, content: SchemaListFile): string {
    const dir = join(workDir, name);
    mkdirSync(dir);
    writeFileSync(join(dir, LIST_FILE), JSON.stringify(content));
    return dir;
  }

  function captured() {
    const lines: string[] = [];
    return { lines, print: (text: string) => lines.push(text) };
  }

  it("prints EQUAL and answers 0 for two copies of one list, and writes the report", async () => {
    const report = join(workDir, "equal-report.txt");
    const out = captured();
    const status = await runCli(
      [
        "compare",
        "--old",
        written("old", file),
        "--new",
        written("same", file),
        "--report",
        report,
      ],
      out.print,
    );
    expect(status).toBe(0);
    expect(out.lines).toEqual(["EQUAL"]);
    expect(readFileSync(report, "utf8")).toBe("EQUAL\n");
  });

  it("prints each difference and answers 1 when a trigger has gone", async () => {
    const dropped = {
      entries: file.entries.map((e) =>
        e.composition === "fiscal-none" && e.phase === "migrated" && e.database === "venue"
          ? {
              ...e,
              schema: {
                ...e.schema,
                triggers: e.schema.triggers.filter(
                  (trigger) => trigger.name !== "working_orders_enforce_transition",
                ),
              },
            }
          : e,
      ),
    };
    const report = join(workDir, "dropped-report.txt");
    const out = captured();
    const status = await runCli(
      [
        "compare",
        "--old",
        written("before", file),
        "--new",
        written("after", dropped),
        "--report",
        report,
      ],
      out.print,
    );
    expect(status).toBe(1);
    expect(out.lines.join("\n")).toBe(
      "DIFF composition=fiscal-none phase=migrated database=venue\n" +
        "missing trigger working_orders_enforce_transition",
    );
    expect(readFileSync(report, "utf8")).toBe(`${out.lines.join("\n")}\n`);
  });

  it("refuses a relative output folder and an unknown command", async () => {
    await expect(runCli(["list", "--out", "relative/dir"], () => {})).rejects.toThrow(
      "--out must be an absolute path",
    );
    await expect(runCli(["inventory"], () => {})).rejects.toThrow("Usage:");
  });

  it("refuses an output folder that already holds files", async () => {
    const dir = written("occupied", file);
    await expect(runCli(["list", "--out", dir], () => {})).rejects.toThrow("is not empty");
  });
});
