import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "@waitron/db";
import { decimal } from "@waitron/shared";
import { claimAcceptedOffline, insertAcceptedOffline } from "./store.js";
import { startRealPostgres, type RealPostgres } from "./testing/postgres.js";
import { freshNif, seedWorkingOrder } from "../test/seed.js";

let pg: RealPostgres;
let admin: import("@waitron/db").Database;

beforeAll(async () => {
  pg = await startRealPostgres();
  admin = await pg.connect();
});
afterAll(async () => {
  await admin.close();
  await pg.stop();
});

const SETTLED = new Date("2026-07-23T10:00:00Z");

describe("claimAcceptedOffline SKIP LOCKED partitions the queue across concurrent forwards", () => {
  it("a concurrent claim skips the row the holder locked and returns exactly the other", async () => {
    const seeded = await seedWorkingOrder(admin, freshNif());
    for (const ref of ["q1", "q2"]) {
      await admin.transaction((tx) =>
        insertAcceptedOffline(tx, {
          tenantId: seeded.tenantId,
          workingOrderId: seeded.workingOrderId,
          provider: "fake",
          paymentRef: ref,
          amount: decimal("10.00"),
          settledAt: SETTLED,
        }),
      );
    }

    const holder = await pg.connect();
    const waiter = await pg.connect();
    let release: () => void = () => {};
    let holding: Promise<unknown> | undefined;
    try {
      const held = new Promise<void>((resolve) => (release = resolve));
      let acquire!: () => void;
      const acquired = new Promise<void>((resolve) => (acquire = resolve));
      let lockedRef = "";
      // Holder locks exactly ONE accepted_offline row and holds the transaction open.
      holding = withTenant(holder, seeded.tenantId, async (tx) => {
        const locked = await tx.execute<{ payment_ref: string }>(sql`
          select payment_ref from payments
          where provider = 'fake' and state = 'accepted_offline'
          order by created_at limit 1 for update skip locked`);
        lockedRef = locked.rows[0].payment_ref;
        acquire();
        await held;
      });
      await acquired;

      // The waiter's real claimAcceptedOffline runs WHILE the holder holds its lock. SKIP LOCKED
      // means it returns immediately (never blocks) with exactly the row the holder did NOT lock.
      const secondClaim = await withTenant(waiter, seeded.tenantId, (tx) =>
        claimAcceptedOffline(tx, seeded.tenantId, "fake"),
      );
      const secondRefs = secondClaim.map((r) => r.paymentRef);

      expect(secondRefs).not.toContain(lockedRef); // never the locked row
      expect(secondRefs).toEqual(["q1", "q2"].filter((r) => r !== lockedRef)); // exactly the other
      expect(secondRefs).toHaveLength(1);

      release();
      await holding;
    } finally {
      release();
      if (holding) await holding.catch(() => {});
      await holder.close();
      await waiter.close();
    }
  });
});
