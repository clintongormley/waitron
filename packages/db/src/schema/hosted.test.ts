import { is } from "drizzle-orm";
import { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import * as adjustments from "./adjustments/index.js";
import * as catalogue from "./menu/index.js";
import * as credentials from "./credentials/index.js";
import * as handover from "./handover/index.js";
import * as identity from "./identity/index.js";
import * as core from "./index.js";
import * as media from "./media/index.js";
import * as venueService from "./venue-service/index.js";

// What each table's indexes, checks and foreign keys say is compared with what core's migrations
// build by `./schema-conformance.test.ts`, which covers every table in core's barrel.

function tablesIn(module: Record<string, unknown>): SQLiteTable[] {
  return Object.values<unknown>(module).filter((value): value is SQLiteTable =>
    is(value, SQLiteTable),
  );
}

const nameOf = (table: SQLiteTable): string => getTableConfig(table).name;

/** Each module folder's barrel. */
const folders = [
  { barrel: credentials, name: "credentials" },
  { barrel: media, name: "media" },
  { barrel: handover, name: "handover" },
  { barrel: identity, name: "identity" },
  { barrel: catalogue, name: "catalogue" },
  { barrel: adjustments, name: "adjustments" },
  { barrel: venueService, name: "venue-service" },
] as const;

const hostedTables = folders.flatMap(({ barrel }) => tablesIn(barrel));
const coreTables = new Set(tablesIn(core));

describe("tables a module's set creates, declared in @waitron/db", () => {
  it("declares tables", () => {
    expect(hostedTables.length).toBeGreaterThan(0);
  });

  it.each(hostedTables.map((table) => [nameOf(table), table] as const))(
    "%s is in core's barrel, so core's generator builds it",
    (_name, table) => {
      expect(coreTables.has(table)).toBe(true);
    },
  );

  it("maps every hosted table to exactly one folder", () => {
    const names = hostedTables.map(nameOf);
    expect(new Set(names).size).toBe(names.length);
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
