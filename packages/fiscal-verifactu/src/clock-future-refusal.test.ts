import { sql, type Query } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { withTransaction, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createFakeAeat } from "@waitron/verifactu/testing";
import type { VerifactuClient } from "@waitron/verifactu";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { openSendingGate, seedPendingEnvios, seedSecondChain } from "../test/drain-fixtures.js";
import { staticResolver } from "../test/write-path-fixtures.js";
import { latestFutureDateRefusal } from "./clock-future-refusal.js";
import { DEFAULT_SKIP_RETRY_MS, drain, FUTURE_DATE_REFUSAL } from "./drain.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

const SEND_AT = new Date("2026-07-21T00:00:10Z");

async function drainOnce(client: VerifactuClient) {
  await openSendingGate(suite.db);
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

const refusalOn = (nodeId: string, above = 0) =>
  withTransaction(suite.db, (tx) => latestFutureDateRefusal(tx, nodeId, above));

type Session = { prepareQuery(query: Query, ...rest: unknown[]): { all(): unknown } };

/** The plan of the one statement the read sends. */
function planOfRead(): Promise<string[]> {
  return withTransaction(suite.db, async (tx: Transaction) => {
    const session = (tx as unknown as { session: Session }).session;
    const prepare = vi.spyOn(session, "prepareQuery");
    let sent: Query[];
    try {
      await latestFutureDateRefusal(tx, "node-1", 0);
      sent = prepare.mock.calls.map(([query]) => query);
    } finally {
      prepare.mockRestore();
    }
    expect(sent).toHaveLength(1);
    const rows = session
      .prepareQuery(
        { sql: `explain query plan ${sent[0]!.sql}`, params: sent[0]!.params },
        undefined,
        "all",
        false,
      )
      .all() as { detail: string }[];
    return rows.map((row) => row.detail);
  });
}

describe("latestFutureDateRefusal", () => {
  it("answers the highest position above the given one on the node's chain AEAT refused as dated in the future, with its issue date", async () => {
    const fake = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
    const seeded = await seedPendingEnvios(suite.db, { count: 3 });
    fake.reject(seeded.facturaKeys[0]!, FUTURE_DATE_REFUSAL, "Rechazo");
    fake.reject(seeded.facturaKeys[1]!, FUTURE_DATE_REFUSAL, "Rechazo");
    await drainOnce(fake.client());

    expect(await refusalOn(seeded.nodeId)).toEqual({ position: 2, issuedOn: "2026-07-20" });
    expect(await refusalOn(seeded.nodeId, 1)).toEqual({ position: 2, issuedOn: "2026-07-20" });
    expect(await refusalOn(seeded.nodeId, 2)).toBeNull();
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
      sql`select estado from verifactu_submissions`,
    );

    expect(acceptedState.rows).toEqual([{ estado: "aceptado_con_errores" }]);
    expect(await refusalOn(accepted.nodeId)).toBeNull();

    await suite.db.execute(
      sql`update verifactu_submissions set estado = 'rechazado', codigo_error = '1100'`,
    );

    expect(await refusalOn(accepted.nodeId)).toBeNull();
  });

  it("answers null when the refusal is on another node's chain", async () => {
    const fake = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
    const seeded = await seedPendingEnvios(suite.db, { count: 1 });
    const other = await seedSecondChain(suite.db, seeded, 5);
    fake.reject(other.facturaKey, FUTURE_DATE_REFUSAL, "Rechazo");
    await drainOnce(fake.client());
    const { rows } = await suite.db.execute<{ estado: string }>(
      sql`select estado from verifactu_submissions where registro_id = ${other.registroId}`,
    );

    expect(rows).toEqual([{ estado: "rechazado" }]);
    expect(await refusalOn(seeded.nodeId)).toBeNull();
  });

  it("starts from the refused filing replies through verifactu_submissions_drenaje_idx", async () => {
    const plan = await planOfRead();

    expect(plan[0]).toBe("SEARCH e USING INDEX verifactu_submissions_drenaje_idx (estado=?)");
  });
});
