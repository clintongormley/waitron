import { describe, expect, it } from "vitest";
import { recordSale } from "@waitron/core";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenantWithSif } from "../test/fixtures.js";
import { TEST_MIGRATIONS } from "../test/migrations.js";
import { fakeClient, saleInput, staticResolver, steadyClock } from "../test/write-path-fixtures.js";
import { VerifactuBackend } from "./backend.js";
import { clockBehindSource } from "./alerts.js";
import { FISCAL_ALERTS } from "./index.js";
import { fiscalSubmissionSource } from "./submission-alerts.js";

const suite = useVenueDb({ migrations: TEST_MIGRATIONS });

it("claims fiscal. incidents for the fiscal area under fiscal.view, and contributes the submission and clock-behind sources", () => {
  expect(FISCAL_ALERTS).toEqual({
    events: [{ prefix: "fiscal.", area: "fiscal", permission: "fiscal.view" }],
    sources: [fiscalSubmissionSource, clockBehindSource],
  });
});

describe("clockBehindSource", () => {
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
    withTransaction(suite.db, (tx) => clockBehindSource.read({ tx, now }));

  it("belongs to the box area under system.manage", () => {
    expect(clockBehindSource.area).toBe("box");
    expect(clockBehindSource.permission).toBe("system.manage");
    expect(clockBehindSource.readOutsideTransaction).toBeUndefined();
  });

  it("raises one error while the clock reads more than a minute before the latest record", async () => {
    await sellAt(LAST);
    const now = new Date("2026-10-25T08:58:59.999Z");
    expect(await read(now)).toEqual([
      {
        key: "clock.behind_chain",
        code: "clock.behind_chain",
        severity: "error",
        since: null,
        screen: "box-status",
        params: { clockAt: now.toISOString(), lastRecordAt: LAST.toISOString() },
      },
    ]);
  });

  it("raises nothing a minute before the latest record", async () => {
    await sellAt(LAST);
    expect(await read(new Date("2026-10-25T08:59:00.000Z"))).toEqual([]);
  });

  it("raises nothing with no records", async () => {
    expect(await read(new Date("2025-01-01T00:00:00.000Z"))).toEqual([]);
  });
});
