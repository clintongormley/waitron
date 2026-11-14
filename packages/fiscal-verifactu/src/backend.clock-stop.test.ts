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

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });
const H = 3_600_000;
const T = Date.parse("2026-10-19T21:40:00.000Z");
const R = T - 2 * H;

let backend: FiscalBackend;
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
const reading = (ms: number) => ({ instant: new Date(ms), offsetMinutes: 60 });

async function sellAt(ms: number): Promise<void> {
  const clock: TrustedClock = {
    ...steadyClock,
    now: () => ({ ...steadyClock.now(), instant: new Date(ms), offsetMinutes: 60 }),
  };
  await withTransaction(suite.db, (tx) =>
    recordSale(tx, backend, saleInput({ nodeId, seriesId, clock })),
  );
}

describe("VerifactuBackend confirms the clock through the seat", () => {
  it("has no restart method left", () => {
    expect("restartAfterClockStop" in backend).toBe(false);
  });

  it("answers no stop while the clock is not behind", async () => {
    await sellAt(T);
    expect(
      await withTransaction(suite.db, (tx) => backend.clockStopState!(tx, reading(T), [])),
    ).toBeNull();
  });

  it("notes a clock proved wrong with no lift in force as touching nothing", async () => {
    await sellAt(T);
    expect(
      await withTransaction(suite.db, (tx) =>
        backend.noteClockProvedWrong!(tx, {
          trustedUntil: new Date(R),
          observedAt: new Date(T),
          reason: "jump",
        }),
      ),
    ).toEqual({ recorded: [], unused: [], held: [] });
  });
});
