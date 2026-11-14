import { describe, expect, it } from "vitest";
import { recordSale } from "@waitron/core";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenantWithSif } from "../test/fixtures.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { fakeClient, saleInput, staticResolver, steadyClock } from "../test/write-path-fixtures.js";
import { VerifactuBackend } from "./backend.js";
import { clockUnusableSource } from "./clock-behind-alerts.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

describe("clockUnusableSource", () => {
  const LAST = new Date("2026-10-25T09:00:00.000Z");

  async function sellAt(instant: Date): Promise<void> {
    const { nodeId, seriesId } = await seedTenantWithSif(suite.db);
    const backend = new VerifactuBackend({
      deploymentEnvironment: "production",
      clock: steadyClock,
      db: suite.db,
      resolveClient: staticResolver(fakeClient),
    });
    const clock = {
      ...steadyClock,
      now: () => ({
        instant,
        offsetMinutes: 60,
        confident: true,
        confidence: "anchored" as const,
        anchorAgeSeconds: 0,
      }),
    };
    await withTransaction(suite.db, (tx) =>
      recordSale(tx, backend, saleInput({ nodeId, seriesId, clock })),
    );
  }

  const read = (now: Date) =>
    withTransaction(suite.db, (tx) => clockUnusableSource.read({ tx, now }));

  it("belongs to the box area under system.manage", () => {
    expect(clockUnusableSource.area).toBe("box");
    expect(clockUnusableSource.permission).toBe("system.manage");
    expect(clockUnusableSource.readOutsideTransaction).toBeUndefined();
  });

  it("raises nothing a day before the latest record", async () => {
    await sellAt(LAST);
    expect(await read(new Date("2026-10-24T09:00:00.000Z"))).toEqual([]);
  });

  it("raises nothing with no records", async () => {
    expect(await read(new Date("2025-01-01T00:00:00.000Z"))).toEqual([]);
  });

  it("raises one clock.unusable error while the clock reads before 28 October 2024", async () => {
    await sellAt(LAST);
    const now = new Date("2001-01-01T11:00:00.000Z");
    expect(await read(now)).toEqual([
      {
        key: "clock.unusable",
        code: "clock.unusable",
        severity: "error",
        since: null,
        screen: "box-status",
        params: { clockAt: now.toISOString() },
      },
    ]);
  });

  it("raises clock.unusable before 28 October 2024 with no records", async () => {
    const now = new Date("2001-01-01T11:00:00.000Z");
    expect(await read(now)).toEqual([
      {
        key: "clock.unusable",
        code: "clock.unusable",
        severity: "error",
        since: null,
        screen: "box-status",
        params: { clockAt: now.toISOString() },
      },
    ]);
  });

  it("raises nothing at the start of 28 October 2024 with no records", async () => {
    expect(await read(new Date("2024-10-28T00:00:00.000Z"))).toEqual([]);
  });

  it("judges the date at offset 0, so 23:30 UTC on 27 October 2024 is still before", async () => {
    const now = new Date("2024-10-27T23:30:00.000Z");
    expect(await read(now)).toEqual([
      {
        key: "clock.unusable",
        code: "clock.unusable",
        severity: "error",
        since: null,
        screen: "box-status",
        params: { clockAt: now.toISOString() },
      },
    ]);
  });
});
