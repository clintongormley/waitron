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
import { clockBehindChain, refuseWhileClockBehind } from "./clock-behind.js";

interface Reading {
  instant: Date;
  offsetMinutes: number;
}

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

let nodeId: NodeId;
let seriesId: SeriesId;
let backend: VerifactuBackend;

beforeEach(async () => {
  ({ nodeId, seriesId } = await seedTenantWithSif(suite.db));
  backend = new VerifactuBackend({
    deploymentEnvironment: "production",
    clock: steadyClock,
    db: suite.db,
    resolveClient: staticResolver(fakeClient),
  });
});

function clockAt(reading: Reading): TrustedClock {
  return {
    ...steadyClock,
    now: () => ({ ...reading, confident: true, confidence: "anchored", anchorAgeSeconds: 0 }),
  };
}

async function sellAt(
  reading: Reading,
  on: { nodeId: NodeId; seriesId: SeriesId } = { nodeId, seriesId },
): Promise<void> {
  await withTransaction(suite.db, (tx) =>
    recordSale(tx, backend, saleInput({ ...on, clock: clockAt(reading) })),
  );
}

const behind = (reading: Reading) =>
  withTransaction(suite.db, (tx) => clockBehindChain(tx, reading));

const refuse = (reading: Reading) =>
  withTransaction(suite.db, (tx) => refuseWhileClockBehind(tx, reading));

const T = new Date("2026-10-25T09:00:00.000Z");
const at = (ms: number, offsetMinutes = 60): Reading => ({
  instant: new Date(T.getTime() + ms),
  offsetMinutes,
});

describe("clockBehindChain", () => {
  it("never stops a database with no records", async () => {
    const now = { instant: new Date("2026-10-21T11:00:00.000Z"), offsetMinutes: 120 };
    const yearEarlier = { instant: new Date("2025-10-21T11:00:00.000Z"), offsetMinutes: 120 };
    expect(await behind(now)).toBeNull();
    expect(await behind(yearEarlier)).toBeNull();
    await expect(refuse(now)).resolves.toBeUndefined();
  });

  it("sells a reading exactly a minute earlier", async () => {
    await sellAt(at(0));
    expect(await behind(at(-60_000))).toBeNull();
    await expect(refuse(at(-60_000))).resolves.toBeUndefined();
  });

  it("does not stop a reading after the latest record", async () => {
    await sellAt(at(0));
    expect(await behind(at(1_000))).toBeNull();
    await expect(refuse(at(1_000))).resolves.toBeUndefined();
  });
});
