import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createFakeAeat } from "@waitron/verifactu/testing";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedPendingEnvios, seedSecondChain } from "../test/drain-fixtures.js";
import { staticResolver } from "../test/write-path-fixtures.js";
import { DEFAULT_SKIP_RETRY_MS, RECUPERACION_ENVIANDO_MS, drain } from "./drain.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const NOW = new Date("2026-07-21T00:01:00Z");
const RETRY_AT = new Date("2026-07-21T00:03:00Z");

describe("drain chain ordering", () => {
  it("does not submit a due successor before its earlier retry, and wakes when the retry is due", async () => {
    const seeded = await seedPendingEnvios(suite.db, { count: 2 });
    await withTransaction(suite.db, (tx) =>
      tx.execute(sql`
        update envios set proximo_intento_en = ${RETRY_AT.toISOString()}
        where registro_id = ${seeded.registroIds[0]}
      `),
    );
    const aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });
    const deps = {
      db: suite.db,
      resolveClient: staticResolver(aeat.client()),
      skipRetryMs: DEFAULT_SKIP_RETRY_MS,
      environment: "production" as const,
    };

    const first = await drain(deps, NOW);

    expect(first.batchesSent).toBe(0);
    expect(first.recordsSubmitted).toBe(0);
    expect(first.nextDueAt).toEqual(RETRY_AT);
    expect(aeat.stored()).toHaveLength(0);
    const before = await suite.db.execute<{ estado: string }>(sql`
      select estado from envios where registro_id in ${seeded.registroIds}
      order by registro_id
    `);
    expect(before.rows.map((row) => row.estado)).toEqual(["pendiente", "pendiente"]);

    const second = await drain(deps, RETRY_AT);
    expect(second.batchesSent).toBe(1);
    expect(second.recordsSubmitted).toBe(2);
    expect(aeat.stored().map((row) => row.refExterna)).toEqual(seeded.registroIds);
  });

  it("sends a due independent chain while an earlier record on another chain waits", async () => {
    const blocked = await seedPendingEnvios(suite.db, { count: 2 });
    const independent = await seedSecondChain(suite.db, blocked, 3);
    await withTransaction(suite.db, (tx) =>
      tx.execute(sql`
        update envios set proximo_intento_en = ${RETRY_AT.toISOString()}
        where registro_id = ${blocked.registroIds[0]}
      `),
    );
    const aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });

    const result = await drain(
      {
        db: suite.db,
        resolveClient: staticResolver(aeat.client()),
        skipRetryMs: DEFAULT_SKIP_RETRY_MS,
        environment: "production",
      },
      NOW,
    );

    expect(result.recordsSubmitted).toBe(1);
    expect(aeat.stored().map((row) => row.refExterna)).toEqual([independent.registroId]);
    expect(result.nextDueAt).toEqual(new Date("2026-07-21T00:02:00Z"));
  });

  it("wakes after an in-flight predecessor can be recovered", async () => {
    const seeded = await seedPendingEnvios(suite.db, { count: 2 });
    await withTransaction(suite.db, (tx) =>
      tx.execute(sql`
        update envios set estado = 'enviando', enviado_en = ${NOW.toISOString()}
        where registro_id = ${seeded.registroIds[0]}
      `),
    );
    const aeat = createFakeAeat({ serverNow: new Date("2026-07-21T00:00:00Z") });

    const result = await drain(
      {
        db: suite.db,
        resolveClient: staticResolver(aeat.client()),
        skipRetryMs: DEFAULT_SKIP_RETRY_MS,
        environment: "production",
      },
      NOW,
    );

    expect(result.recordsSubmitted).toBe(0);
    expect(result.nextDueAt).toEqual(new Date(NOW.getTime() + RECUPERACION_ENVIANDO_MS + 1));
    expect(aeat.stored()).toHaveLength(0);
  });
});
