import { beforeEach, describe, expect, it } from "vitest";
import { recordSale } from "@waitron/core";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import type { NodeId, SeriesId } from "@waitron/shared";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { seedTenantWithSif } from "../test/fixtures.js";
import { fakeClient, saleInput, staticResolver, steadyClock } from "../test/write-path-fixtures.js";
import { VerifactuBackend } from "./backend.js";

interface Reading {
  instant: Date;
  offsetMinutes: number;
}

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

let nodeId: NodeId;
let seriesId: SeriesId;
let backend: FiscalBackend;

beforeEach(async () => {
  ({ nodeId, seriesId } = await seedTenantWithSif(suite.db));
  backend = new VerifactuBackend({
    deploymentEnvironment: "production",
    clock: steadyClock,
    db: suite.db,
    resolveClient: staticResolver(fakeClient),
  });
});

const T = new Date("2026-10-25T09:00:00.000Z");
const at = (ms: number, offsetMinutes = 60): Reading => ({
  instant: new Date(T.getTime() + ms),
  offsetMinutes,
});

async function sellAt(reading: Reading): Promise<void> {
  const clock: TrustedClock = {
    ...steadyClock,
    now: () => ({ ...reading, confident: true, confidence: "anchored", anchorAgeSeconds: 0 }),
  };
  await withTransaction(suite.db, (tx) =>
    recordSale(tx, backend, saleInput({ nodeId, seriesId, clock })),
  );
}

const behind = (reading: Reading) =>
  withTransaction(suite.db, (tx) => backend.clockBehindLatestRecord(tx, reading));

const refuse = (reading: Reading) =>
  withTransaction(suite.db, (tx) => backend.refuseWhileClockBehind(tx, reading));

describe("VerifactuBackend answers whether the clock reads behind the latest record", () => {
  it("stops a reading more than a minute earlier than the latest record", async () => {
    await sellAt(at(0, 60));
    const reading = at(-60_001, 120);
    const params = {
      clockAt: reading.instant.toISOString(),
      offsetMinutes: 120,
      lastRecordAt: T.toISOString(),
      lastRecordOffsetMinutes: 60,
    };
    expect(await behind(reading)).toEqual(params);
    await expect(refuse(reading)).rejects.toMatchObject({ code: "clock.behind_chain", params });
  });

  it("sells a reading exactly a minute earlier", async () => {
    await sellAt(at(0));
    expect(await behind(at(-60_000))).toBeNull();
    await expect(refuse(at(-60_000))).resolves.toBeUndefined();
  });

  it("refuses a 2001 reading as clock.unusable", async () => {
    await sellAt(at(0));
    await expect(
      refuse({ instant: new Date("2001-01-01T11:00:00.000Z"), offsetMinutes: 60 }),
    ).rejects.toMatchObject({
      code: "clock.unusable",
      params: { clockAt: "2001-01-01T11:00:00.000Z", offsetMinutes: 60 },
    });
  });
});
