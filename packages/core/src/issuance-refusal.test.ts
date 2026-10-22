import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { CORE_MIGRATIONS, incidents, invoiceSeries, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { AppError, deviceOrigin, jobOrigin } from "@waitron/shared";
import type { Origin } from "@waitron/shared";
import { seedTenant } from "../test/fixtures.js";
import { IssuanceRefusal, withIssuanceTransaction } from "./index.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const detectedAt = new Date("2026-10-20T12:34:56Z");
let seed: Awaited<ReturnType<typeof seedTenant>>;

beforeEach(async () => {
  seed = await seedTenant(suite.db);
});

function refusal(origin: Origin = deviceOrigin(seed.deviceId), time = detectedAt) {
  return new IssuanceRefusal(new AppError("fiscal.taxpayer_domicile_missing", {}), {
    origin,
    detectedAt: time,
  });
}

describe("issuance refusal boundary", () => {
  it("rolls back the counter before committing a separate incident and preserves the refusal", async () => {
    const before = await suite.db.select().from(invoiceSeries);
    const error = refusal();
    await expect(
      withIssuanceTransaction(suite.db, async (tx) => {
        await tx.update(invoiceSeries).set({ nextNumber: 8 });
        throw error;
      }),
    ).rejects.toBe(error);
    expect(await suite.db.select().from(invoiceSeries)).toEqual(before);
    const rows = await suite.db.select().from(incidents);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source: "device",
      deviceId: seed.deviceId,
      saleId: null,
      code: "fiscal.taxpayer_domicile_missing",
      params: {},
      severity: "error",
      detectedAt: "2026-10-20T12:34:56.000Z",
    });
    expect(error).toBeInstanceOf(AppError);
    expect(JSON.parse(JSON.stringify(error))).toEqual({
      name: "AppError",
      code: "fiscal.taxpayer_domicile_missing",
      params: {},
    });
    expect({ ...error }).not.toHaveProperty("incident");
    await withTransaction(suite.db, (tx) => tx.update(invoiceSeries).set({ nextNumber: 2 }));
    expect((await suite.db.select().from(invoiceSeries))[0]?.nextNumber).toBe(2);
  });

  it("deduplicates an open refusal by origin, keeps its first detection, and raises again after handling", async () => {
    const fail = (error: ReturnType<typeof refusal>) =>
      withIssuanceTransaction(suite.db, () => {
        throw error;
      });
    await expect(fail(refusal())).rejects.toMatchObject({
      code: "fiscal.taxpayer_domicile_missing",
    });
    await expect(fail(refusal(undefined, new Date("2026-10-21T12:00:00Z")))).rejects.toBeInstanceOf(
      AppError,
    );
    let rows = await suite.db.select().from(incidents);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.detectedAt).toBe(detectedAt.toISOString());
    await expect(fail(refusal(jobOrigin("fiscal_filing")))).rejects.toBeInstanceOf(AppError);
    rows = await suite.db.select().from(incidents);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.source === "fiscal_filing")?.deviceId).toBeNull();
    await suite.db
      .update(incidents)
      .set({ acknowledgedAt: "2026-10-21T12:00:00Z" })
      .where(eq(incidents.deviceId, seed.deviceId));
    await expect(fail(refusal())).rejects.toBeInstanceOf(AppError);
    expect(await suite.db.select().from(incidents)).toHaveLength(3);
  });

  it("keeps ordinary results and ordinary errors without recording an incident", async () => {
    expect(await withIssuanceTransaction(suite.db, () => 42)).toBe(42);
    const ordinary = new AppError("fiscal.taxpayer_domicile_missing", {});
    await expect(
      withIssuanceTransaction(suite.db, async (tx) => {
        await tx.update(invoiceSeries).set({ nextNumber: 9 });
        throw ordinary;
      }),
    ).rejects.toBe(ordinary);
    expect((await suite.db.select().from(invoiceSeries))[0]?.nextNumber).toBe(1);
    expect(await suite.db.select().from(incidents)).toEqual([]);
  });

  it.each([false, true, "absent"] as const)(
    "incident failure preserves the refusal when logger throws=%s",
    async (throws) => {
      const error = refusal();
      await suite.db.execute(
        sql`create trigger refuse_incident before insert on incidents begin select raise(abort, 'private incident failure'); end`,
      );
      const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
      const logged: unknown[][] = [];
      const log =
        throws === "absent"
          ? undefined
          : (...args: unknown[]) => {
              logged.push(args);
              if (throws) throw new Error("private logger failure");
            };
      try {
        await expect(
          withIssuanceTransaction(
            suite.db,
            () => {
              throw error;
            },
            log,
          ),
        ).rejects.toBe(error);
        expect(await suite.db.select().from(incidents)).toEqual([]);
        const output = JSON.stringify([...logged, ...stderr.mock.calls]);
        expect(output).toContain("fiscal.taxpayer_domicile_missing");
        const fields =
          throws === false
            ? logged[0]?.[2]
            : JSON.parse(
                String(stderr.mock.calls[0]?.[0]).slice("fiscal.taxpayer_domicile_missing ".length),
              );
        expect(fields).toEqual({ incidentRecorded: false, incidentFailureCode: "unknown" });
        expect(output).not.toContain("private");
        expect(output).not.toContain(seed.deviceId);
        expect(output).not.toContain(detectedAt.toISOString());
        expect(error).not.toHaveProperty("cause");
        if (throws !== "absent") expect(logged).toHaveLength(1);
        if (throws === false) expect(stderr).not.toHaveBeenCalled();
        else expect(stderr).toHaveBeenCalledTimes(1);
      } finally {
        stderr.mockRestore();
        await suite.db.execute(sql`drop trigger refuse_incident`);
      }
    },
  );

  it("preserves the refusal even if stderr fails while reporting a full-disk incident failure", async () => {
    const error = refusal();
    const lock = suite.db.withWriteLock.bind(suite.db);
    const locked = vi
      .spyOn(suite.db, "withWriteLock")
      .mockImplementationOnce(lock)
      .mockRejectedValueOnce(new AppError("storage.disk_full", {}));
    const log = vi.fn(() => {
      throw new Error("private logger");
    });
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => {
      throw new Error("private stderr");
    });
    try {
      await expect(
        withIssuanceTransaction(
          suite.db,
          () => {
            throw error;
          },
          log,
        ),
      ).rejects.toBe(error);
      expect(log).toHaveBeenCalledWith("error", "fiscal.taxpayer_domicile_missing", {
        incidentRecorded: false,
        incidentFailureCode: "storage.disk_full",
      });
      expect(await suite.db.select().from(incidents)).toEqual([]);
    } finally {
      locked.mockRestore();
      stderr.mockRestore();
    }
  });
});
