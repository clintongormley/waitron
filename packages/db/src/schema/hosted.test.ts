import { readFileSync } from "node:fs";
import { is } from "drizzle-orm";
import { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import * as adjustments from "./adjustments/index.js";
import * as catalogue from "./catalogue/index.js";
import * as credentials from "./credentials/index.js";
import * as handover from "./handover/index.js";
import * as hosted from "./hosted.js";
import * as identity from "./identity/index.js";
import * as core from "./index.js";
import * as media from "./media/index.js";
import * as venueService from "./venue-service/index.js";

// A `packages/db` test cannot import a module's migration set, so the declarations are compared with
// the newest drizzle snapshot of the set each folder generates, read from disk.

function tablesIn(module: Record<string, unknown>): SQLiteTable[] {
  return Object.values<unknown>(module).filter((value): value is SQLiteTable =>
    is(value, SQLiteTable),
  );
}

const nameOf = (table: SQLiteTable): string => getTableConfig(table).name;

/** Each folder's barrel, and the package whose `drizzle.config.ts` generates its set from it. */
const folders = [
  { barrel: credentials, set: "credentials" },
  { barrel: media, set: "media" },
  { barrel: handover, set: "handover" },
  { barrel: identity, set: "identity" },
  { barrel: catalogue, set: "catalogue" },
  { barrel: adjustments, set: "adjustments" },
  { barrel: venueService, set: "venue-service" },
] as const;

interface SnapshotTable {
  indexes: Record<string, { name: string; isUnique: boolean }>;
  uniqueConstraints: Record<string, { name: string }>;
  checkConstraints: Record<string, { name: string }>;
  foreignKeys: Record<
    string,
    {
      tableTo: string;
      columnsFrom: string[];
      columnsTo: string[];
      onDelete: string;
      onUpdate: string;
    }
  >;
}

function newestSnapshot(set: string): Record<string, SnapshotTable> {
  const meta = new URL(`../../../${set}/drizzle/meta/`, import.meta.url);
  const journal = JSON.parse(readFileSync(new URL("_journal.json", meta), "utf8")) as {
    entries: { idx: number }[];
  };
  const idx = Math.max(...journal.entries.map((entry) => entry.idx));
  const file = `${String(idx).padStart(4, "0")}_snapshot.json`;
  return (
    JSON.parse(readFileSync(new URL(file, meta), "utf8")) as {
      tables: Record<string, SnapshotTable>;
    }
  ).tables;
}

interface Shape {
  indexes: string[];
  checks: string[];
  foreignKeys: string[];
}

function declaredShape(table: SQLiteTable): Shape {
  const config = getTableConfig(table);
  return {
    indexes: [
      ...config.indexes.map(
        (index) => `${index.config.name} unique=${index.config.unique === true}`,
      ),
      ...config.uniqueConstraints.map((constraint) => `${constraint.name} unique=true`),
      ...config.columns
        .filter((column) => column.isUnique)
        .map((column) => `${column.uniqueName} unique=true`),
    ].sort(),
    checks: config.checks.map((check) => check.name).sort(),
    foreignKeys: config.foreignKeys
      .map((key) => {
        const reference = key.reference();
        return `${reference.columns.map((column) => column.name).join(",")} -> ${nameOf(reference.foreignTable)}(${reference.foreignColumns.map((column) => column.name).join(",")}) on delete ${key.onDelete ?? "no action"} on update ${key.onUpdate ?? "no action"}`;
      })
      .sort(),
  };
}

function snapshotShape(table: SnapshotTable): Shape {
  return {
    indexes: [
      ...Object.values(table.indexes).map((index) => `${index.name} unique=${index.isUnique}`),
      ...Object.values(table.uniqueConstraints).map(
        (constraint) => `${constraint.name} unique=true`,
      ),
    ].sort(),
    checks: Object.values(table.checkConstraints)
      .map((check) => check.name)
      .sort(),
    foreignKeys: Object.values(table.foreignKeys)
      .map(
        (key) =>
          `${key.columnsFrom.join(",")} -> ${key.tableTo}(${key.columnsTo.join(",")}) on delete ${key.onDelete} on update ${key.onUpdate}`,
      )
      .sort(),
  };
}

const hostedTables = tablesIn(hosted);
const coreNames = new Set(tablesIn(core).map(nameOf));

describe("tables a module's set creates, declared in @waitron/db", () => {
  it("declares tables", () => {
    expect(hostedTables.length).toBeGreaterThan(0);
  });

  it.each(hostedTables.map((table) => [nameOf(table), table] as const))(
    "%s is not also in core's barrel, so core's generator never claims it",
    (name) => {
      expect(coreNames.has(name)).toBe(false);
    },
  );

  it("maps every hosted table to exactly one folder", () => {
    expect(folders.flatMap(({ barrel }) => tablesIn(barrel).map(nameOf)).sort()).toEqual(
      hostedTables.map(nameOf).sort(),
    );
  });

  describe.each(folders)("the $set set", ({ barrel, set }) => {
    const snapshot = newestSnapshot(set);
    const tables = tablesIn(barrel);

    it("declares exactly the tables its newest snapshot holds", () => {
      expect(tables.map(nameOf).sort()).toEqual(Object.keys(snapshot).sort());
    });

    it.each(tables.map((table) => [nameOf(table), table] as const))(
      "%s declares the indexes, checks and foreign keys its newest snapshot holds",
      (name, table) => {
        expect(declaredShape(table)).toEqual(snapshotShape(snapshot[name]!));
      },
    );
  });

  const computedDefaults = hostedTables.flatMap((table) => {
    const config = getTableConfig(table);
    return config.columns
      .filter((column) => column.defaultFn !== undefined)
      .map((column) => [`${config.name}.${column.name}`, column] as const);
  });

  it.each(computedDefaults)(
    "%s's computed default gives a value the column can store",
    (_, column) => {
      const first = column.defaultFn!();
      const second = column.defaultFn!();
      expect(first).toBeDefined();
      expect(() => column.mapToDriverValue(first)).not.toThrow();
      // A default that is an object must be a fresh one per row, never one shared and mutable.
      if (typeof first === "object" && first !== null) expect(second).not.toBe(first);
    },
  );
});
