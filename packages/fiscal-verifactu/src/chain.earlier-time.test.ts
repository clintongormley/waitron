import { asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { recordSale } from "@waitron/core";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { TrustedClock } from "@waitron/fiscal";
import type { NodeId, SeriesId } from "@waitron/shared";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTenantWithSif } from "../test/fixtures.js";
import { fakeClient, saleInput, staticResolver, steadyClock } from "../test/write-path-fixtures.js";
import { VerifactuBackend } from "./backend.js";
import { registrosFacturacion } from "./schema/registros.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

const T = Date.parse("2026-03-01T12:05:00.000Z");
const HOUR = 3_600_000;
const DAY = 86_400_000;
// 27-10-2024 at 12:00 in the reading's own offset of +60 minutes.
const DAY_BEFORE_FIRST_ISSUE = Date.parse("2024-10-27T11:00:00.000Z");

let backend: VerifactuBackend;
let nodeId: NodeId;
let seriesId: SeriesId;

beforeEach(async () => {
  ({ nodeId, seriesId } = await seedTenantWithSif(suite.db));
  backend = new VerifactuBackend({
    deploymentEnvironment: "production",
    clock: steadyClock,
    db: suite.db,
    resolveClient: staticResolver(fakeClient),
  });
});

function clockAt(ms: number): TrustedClock {
  return {
    ...steadyClock,
    now: () => ({ ...steadyClock.now(), instant: new Date(ms), offsetMinutes: 60 }),
  };
}

function sell(ms: number) {
  return withTransaction(suite.db, (tx) =>
    recordSale(tx, backend, saleInput({ nodeId, seriesId, clock: clockAt(ms) })),
  );
}

function chain() {
  return suite.db
    .select({
      n: registrosFacturacion.numSerieFactura,
      s: registrosFacturacion.secuencia,
      at: registrosFacturacion.fechaHoraHusoGenRegistro,
    })
    .from(registrosFacturacion)
    .where(eq(registrosFacturacion.nodeId, nodeId))
    .orderBy(asc(registrosFacturacion.secuencia))
    .all()
    .map((row) => ({ ...row, at: row.at.toISOString() }));
}

describe("a record dated before the latest one is written after it", () => {
  it.each([
    ["an hour", HOUR],
    ["a day", DAY],
  ])("chains a sale dated %s before the latest record, with its own time", async (_, gap) => {
    await sell(T);
    await sell(T - gap);
    expect(chain()).toEqual([
      { n: "A/1", s: 1, at: new Date(T).toISOString() },
      { n: "A/2", s: 2, at: new Date(T - gap).toISOString() },
    ]);
  });

  it("refuses a sale dated 27-10-2024 as clock.unusable and writes nothing", async () => {
    await sell(T);
    await expect(sell(DAY_BEFORE_FIRST_ISSUE)).rejects.toMatchObject({
      code: "clock.unusable",
      params: { clockAt: new Date(DAY_BEFORE_FIRST_ISSUE).toISOString(), offsetMinutes: 60 },
    });
    expect(chain()).toEqual([{ n: "A/1", s: 1, at: new Date(T).toISOString() }]);
  });
});
