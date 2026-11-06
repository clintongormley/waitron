import { getTableColumns, sql } from "drizzle-orm";
import { getTableConfig, SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import {
  CORE_CLASSIFICATION,
  CORE_MIGRATIONS,
  FOREIGN_KEY_VIOLATION,
  captureError,
  checkFailed,
  isRefusal,
  nodes,
  triggerRaised,
  handoverActivations,
} from "../../index.js";
import { seedNode, seedVenue } from "../../testing/seed.js";
import { migratedTableNames, useVenueDb } from "../../testing/venue-db.js";
import * as barrel from "./index.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

const OPERATION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MISSING_NODE = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const ACTIVATED_AT = "2026-11-04T10:00:00.000Z";

async function twoNodes(): Promise<{ source: string; destination: string }> {
  await seedVenue(suite.db);
  return { source: await seedNode(suite.db), destination: await seedNode(suite.db) };
}

/** A raw insert, so each case proves what the migration built rather than the declaration. */
function insertRaw(values: { scenario?: string; source: string; destination: string }): unknown {
  return suite.db.execute(sql`
    insert into handover_activations
      (operation_id, scenario, source_node_id, destination_node_id, evidence, person_id, activated_at)
    values (${OPERATION}, ${values.scenario ?? "controlled"}, ${values.source},
            ${values.destination}, '{}', 'person-1', ${ACTIVATED_AT})`);
}

describe("the handover migration set", () => {
  it("creates the table in venue.db", () => {
    expect(migratedTableNames(suite.db)).toContain("handover_activations");
    expect(migratedTableNames(suite.node)).not.toContain("handover_activations");
  });

  it("a row cannot be updated or deleted", async () => {
    const { source, destination } = await twoNodes();
    await insertRaw({ source, destination });
    const update = await captureError(() =>
      suite.db.execute(sql`update handover_activations set person_id = 'someone-else'`),
    );
    expect(triggerRaised(update, "handover_activations is append-only")).toBe(true);
    const remove = await captureError(() =>
      suite.db.execute(sql`delete from handover_activations`),
    );
    expect(triggerRaised(remove, "handover_activations is append-only")).toBe(true);
    expect(suite.db.all(sql`select person_id from handover_activations`)).toEqual([
      { person_id: "person-1" },
    ]);
  });

  it("refuses a scenario outside the two the handover has", async () => {
    const { source, destination } = await twoNodes();
    const error = await captureError(() =>
      insertRaw({ scenario: "unplanned", source, destination }),
    );
    expect(checkFailed(error, "handover_activations_scenario_ck")).toBe(true);
    await insertRaw({ scenario: "emergency", source, destination });
    expect(suite.db.all(sql`select scenario from handover_activations`)).toEqual([
      { scenario: "emergency" },
    ]);
  });

  it("refuses a source or destination the venue has no node for", async () => {
    const { source, destination } = await twoNodes();
    for (const pair of [
      { source: MISSING_NODE, destination },
      { source, destination: MISSING_NODE },
    ]) {
      expect(isRefusal(await captureError(() => insertRaw(pair)), FOREIGN_KEY_VIOLATION)).toBe(
        true,
      );
    }
  });

  it("lives in core's set, which protects it as append-only", () => {
    expect(CORE_MIGRATIONS.migrationsTable).toBe("__drizzle_migrations_db");
    expect(CORE_MIGRATIONS.appendOnlyTables).toContain("handover_activations");
  });

  it("classifies the table as an append-only ledger", () => {
    expect(CORE_CLASSIFICATION.filter(({ table }) => table === "handover_activations")).toEqual([
      {
        table: "handover_activations",
        class: "ledger",
        reason:
          "which box took over from which, when, who asked and on what signed evidence; nothing may change or remove it",
        appendOnly: true,
      },
    ]);
  });
});

describe("the handover_activations declaration", () => {
  const config = getTableConfig(handoverActivations);
  const dialect = new SQLiteSyncDialect();

  it("exports only this table", () => {
    expect(Object.keys(barrel).sort()).toEqual(["handoverActivations", "handoverScenario"]);
    expect(barrel.handoverScenario.enumValues).toEqual(["controlled", "emergency"]);
  });

  it("declares exactly these columns", () => {
    expect(config.name).toBe("handover_activations");
    expect(
      Object.entries(getTableColumns(handoverActivations)).map(([key, column]) => ({
        key,
        name: column.name,
        type: column.getSQLType(),
        notNull: column.notNull,
        primary: column.primary,
        hasDefault: column.hasDefault,
      })),
    ).toEqual(
      [
        ["operationId", "operation_id", true],
        ["scenario", "scenario", false],
        ["sourceNodeId", "source_node_id", false],
        ["destinationNodeId", "destination_node_id", false],
        ["evidence", "evidence", false],
        ["personId", "person_id", false],
        ["activatedAt", "activated_at", false],
      ].map(([key, name, primary]) => ({
        key,
        name,
        type: "text",
        notNull: true,
        primary,
        hasDefault: false,
      })),
    );
  });

  it("declares its keys, its index and its check by name", () => {
    expect(
      config.foreignKeys.map((key) => {
        const { columns, foreignTable, foreignColumns } = key.reference();
        return {
          name: key.getName(),
          columns: columns.map((column) => column.name),
          foreignTable: getTableConfig(foreignTable).name,
          foreignColumns: foreignColumns.map((column) => column.name),
        };
      }),
    ).toEqual(
      ["source", "destination"].map((side) => ({
        name: `handover_activations_${side}_node_fk`,
        columns: [`${side}_node_id`],
        foreignTable: getTableConfig(nodes).name,
        foreignColumns: ["id"],
      })),
    );
    expect(config.indexes.map((index) => index.config.name)).toEqual([
      "handover_activations_destination_idx",
    ]);
    expect(
      config.indexes[0]!.config.columns.map((column) => (column as { name: string }).name),
    ).toEqual(["destination_node_id"]);
    expect(
      config.checks.map((check) => ({
        name: check.name,
        sql: dialect.sqlToQuery(check.value).sql,
      })),
    ).toEqual([
      {
        name: "handover_activations_scenario_ck",
        sql: `"handover_activations"."scenario" in ('controlled', 'emergency')`,
      },
    ]);
  });
});
