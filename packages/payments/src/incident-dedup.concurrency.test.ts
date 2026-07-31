import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "@waitron/db";
import { AppError, tenantId as brandTenantId, tillId as brandTillId } from "@waitron/shared";
import { recordIncidentOnce } from "@waitron/core";
import { startRealPostgres, type RealPostgres } from "./testing/postgres.js";
import { freshNif, seedWorkingOrder } from "../test/seed.js";

let pg: RealPostgres;
let admin: import("@waitron/db").Database;

beforeAll(async () => {
  pg = await startRealPostgres();
  admin = await pg.connect();
});
afterAll(async () => {
  if (admin !== undefined) await admin.close();
  if (pg !== undefined) await pg.stop();
});

const AT = new Date("2026-07-24T10:00:00Z");

describe("recordIncidentOnce is race-safe: concurrent same-key raises collapse to one open incident", () => {
  it("an orphan (sale_id NULL) raise blocks a concurrent same-key raise, which then de-dups", async () => {
    const s = await seedWorkingOrder(admin, freshNif());
    const raiseInput = {
      tenantId: brandTenantId(s.tenantId),
      tillId: brandTillId(s.tillId),
      // no saleId — orphan; exercises NULLS NOT DISTINCT
      error: new AppError("payment.offline_forward_declined", {
        paymentRef: "race-1",
        amount: "1.00",
      }),
      severity: "error" as const,
      detectedAt: AT,
    };

    const holder = await pg.connect();
    const waiter = await pg.connect();
    let release: () => void = () => {};
    let holding: Promise<unknown> | undefined;
    try {
      const held = new Promise<void>((resolve) => (release = resolve));
      let acquire!: () => void;
      const acquired = new Promise<void>((resolve) => (acquire = resolve));

      // Holder inserts the incident, signals it has, and holds the transaction open.
      holding = withTenant(holder, s.tenantId, async (tx) => {
        const raised = await recordIncidentOnce(tx, raiseInput);
        expect(raised).toBe(true);
        acquire();
        await held;
      });
      await acquired;

      // The waiter's same-key raise blocks on the arbiter index until the holder commits.
      let waiterResolved = false;
      const waiting = withTenant(waiter, s.tenantId, (tx) =>
        recordIncidentOnce(tx, raiseInput),
      ).then((r) => {
        waiterResolved = true;
        return r;
      });
      // It must NOT resolve while the holder holds the row.
      const settledEarly = await Promise.race([
        waiting.then(() => true),
        new Promise<boolean>((r) => setTimeout(() => r(false), 200)),
      ]);
      expect(settledEarly).toBe(false);
      expect(waiterResolved).toBe(false);

      release();
      await holding;
      const waiterResult = await waiting;
      expect(waiterResult).toBe(false); // deduped against the now-committed incident

      const { rows } = await admin.execute<{ n: string }>(sql`
        select count(*)::text as n from incidents
        where tenant_id = ${s.tenantId} and code = 'payment.offline_forward_declined'
          and sale_id is null and acknowledged_at is null`);
      expect(rows[0].n).toBe("1");
    } finally {
      release();
      if (holding) await holding.catch(() => {});
      await holder.close();
      await waiter.close();
    }
  });
});
