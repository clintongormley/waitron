import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createFakeAeat } from "@waitron/verifactu/testing";
import type { VerifactuClient } from "@waitron/verifactu";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedPendingEnvios, seedSecondChain } from "../test/drain-fixtures.js";
import { staticResolver } from "../test/write-path-fixtures.js";
import { latestFutureDateRefusal } from "./clock-future-refusal.js";
import { DEFAULT_SKIP_RETRY_MS, drain, FUTURE_DATE_REFUSAL } from "./drain.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

const SEND_AT = new Date("2026-07-21T00:00:10Z");

async function drainOnce(client: VerifactuClient) {
  await suite.db.execute(sql`delete from envio_flujo`);
  return drain(
    {
      db: suite.db,
      resolveClient: staticResolver(client),
      environment: "production",
      skipRetryMs: DEFAULT_SKIP_RETRY_MS,
    },
    SEND_AT,
  );
}

const refusalOn = (nodeId: string) =>
  withTransaction(suite.db, (tx) => latestFutureDateRefusal(tx, nodeId));

describe("latestFutureDateRefusal", () => {
  it("answers the highest position on the node's chain AEAT refused as dated in the future, with its issue date", async () => {
    const fake = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
    const seeded = await seedPendingEnvios(suite.db, { count: 3 });
    fake.reject(seeded.facturaKeys[0]!, FUTURE_DATE_REFUSAL, "Rechazo");
    fake.reject(seeded.facturaKeys[1]!, FUTURE_DATE_REFUSAL, "Rechazo");
    await drainOnce(fake.client());

    expect(await refusalOn(seeded.nodeId)).toEqual({ position: 2, issuedOn: "2026-07-20" });
  });

  it("answers the one refused record when only one is", async () => {
    const fake = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
    const seeded = await seedPendingEnvios(suite.db, { count: 3 });
    fake.reject(seeded.facturaKeys[0]!, FUTURE_DATE_REFUSAL, "Rechazo");
    await drainOnce(fake.client());

    expect(await refusalOn(seeded.nodeId)).toEqual({ position: 1, issuedOn: "2026-07-20" });
  });

  it("answers null for a record accepted with the 2004 warning or refused with another code (controls)", async () => {
    const fake = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
    const accepted = await seedPendingEnvios(suite.db, { count: 1, futureDated: true });
    await drainOnce(fake.client());
    const acceptedState = await suite.db.execute<{ estado: string }>(
      sql`select estado from envios`,
    );

    expect(acceptedState.rows).toEqual([{ estado: "aceptado_con_errores" }]);
    expect(await refusalOn(accepted.nodeId)).toBeNull();

    await suite.db.execute(sql`update envios set estado = 'rechazado', codigo_error = '1100'`);

    expect(await refusalOn(accepted.nodeId)).toBeNull();
  });

  it("answers null when the refusal is on another node's chain", async () => {
    const fake = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
    const seeded = await seedPendingEnvios(suite.db, { count: 1 });
    const other = await seedSecondChain(suite.db, seeded, 5);
    fake.reject(other.facturaKey, FUTURE_DATE_REFUSAL, "Rechazo");
    await drainOnce(fake.client());
    const { rows } = await suite.db.execute<{ estado: string }>(
      sql`select estado from envios where registro_id = ${other.registroId}`,
    );

    expect(rows).toEqual([{ estado: "rechazado" }]);
    expect(await refusalOn(seeded.nodeId)).toBeNull();
  });
});
