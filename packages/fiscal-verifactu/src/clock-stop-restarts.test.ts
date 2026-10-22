import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  FOREIGN_KEY_VIOLATION,
  UNIQUE_VIOLATION,
  captureError,
  isRefusal,
  newId,
  refusalOn,
  triggerRaised,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedPendingEnvios } from "../test/drain-fixtures.js";
import { clockStopRestarts } from "./schema/clock-stop-restarts.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

const PERSON = "33333333-3333-4333-8333-333333333333";

function insertRestart(nodeId: string, registroId: string) {
  return withTransaction(suite.db, (tx) =>
    tx
      .insert(clockStopRestarts)
      .values({
        nodeId,
        personId: PERSON,
        restartedAt: new Date("2026-07-21T10:00:00.000Z"),
        clockAt: new Date("2026-07-21T09:58:00.000Z"),
        registroId,
        recordAt: new Date("2026-07-21T10:30:00.000Z"),
        proof: { reading: "manager accepted" },
      })
      .returning({ id: clockStopRestarts.id }),
  );
}

async function restartRows() {
  const { rows } = await suite.db.execute<{ registro_id: string }>(
    sql`select registro_id from clock_stop_restarts`,
  );
  return rows;
}

describe("clock_stop_restarts", () => {
  it("refuses an update and a delete", async () => {
    const { nodeId, registroIds } = await seedPendingEnvios(suite.db, { count: 1 });
    await insertRestart(nodeId, registroIds[0]!);
    const update = await captureError(async () =>
      suite.db.execute(sql`update clock_stop_restarts set person_id = 'someone else'`),
    );
    expect(triggerRaised(update, "clock_stop_restarts is append-only")).toBe(true);
    const remove = await captureError(async () =>
      suite.db.execute(sql`delete from clock_stop_restarts`),
    );
    expect(triggerRaised(remove, "clock_stop_restarts is append-only")).toBe(true);
    expect(await restartRows()).toEqual([{ registro_id: registroIds[0] }]);
  });

  it("answers a second restart of the same record with a refusal", async () => {
    const { nodeId, registroIds } = await seedPendingEnvios(suite.db, { count: 1 });
    await insertRestart(nodeId, registroIds[0]!);
    const error = await captureError(() => insertRestart(nodeId, registroIds[0]!));
    expect(
      refusalOn(error, UNIQUE_VIOLATION, {
        table: "clock_stop_restarts",
        columns: ["registro_id"],
      }),
    ).toBe(true);
    expect(await restartRows()).toEqual([{ registro_id: registroIds[0] }]);
  });

  it("refuses a row naming no record", async () => {
    const { nodeId } = await seedPendingEnvios(suite.db, { count: 0 });
    const error = await captureError(() => insertRestart(nodeId, newId()));
    expect(isRefusal(error, FOREIGN_KEY_VIOLATION)).toBe(true);
    expect(await restartRows()).toEqual([]);
  });

  it("reads the latest record time through the index", async () => {
    const { rows } = await suite.db.execute<{ detail: string }>(
      sql`explain query plan select fecha_hora_huso_gen_registro, offset_minutos
        from registros_facturacion order by fecha_hora_huso_gen_registro desc limit 1`,
    );
    expect(rows.map((row) => row.detail)).toEqual([
      "SCAN registros_facturacion USING INDEX registros_generado_idx",
    ]);
  });
});
