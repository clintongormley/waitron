import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asAppUser, captureError, pgErrorCode, withTenant } from "@waitron/db";
import type { Database } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { freshNif, seedWorkingOrder } from "../../test/seed.js";
import { cardReaders } from "./card-readers.js";
import { payments } from "./payments.js";

// Real Postgres, not PGlite: this suite doubles as the grant check (CLAUDE.md §4) — payments'
// existing SELECT/INSERT/UPDATE grants are unchanged by this column, and writing under
// `app_user`'s grants (`asAppUser`) is what would show a regression. A clone of the
// `core_payments` template (CORE + PAYMENTS).
const postgres = useTemplateDb({ template: "core_payments" });

/** Seeds a tenant/till/working_order (via the shared payments seed helper) plus one card reader
 * for that same tenant, everything `payments.reader_id`'s composite FK needs a real row to point
 * at. */
async function seedOrderWithReader(db: Database): Promise<{
  tenantId: string;
  workingOrderId: string;
  readerId: string;
}> {
  const seeded = await seedWorkingOrder(db, freshNif());
  const reader = await db
    .insert(cardReaders)
    .values({
      tenantId: seeded.tenantId,
      provider: "sumup",
      providerRef: `rdr_${seeded.workingOrderId}`,
      name: "Counter",
    })
    .returning({ id: cardReaders.id });
  return {
    tenantId: seeded.tenantId,
    workingOrderId: seeded.workingOrderId,
    readerId: reader[0]!.id,
  };
}

describe("payments.reader_id", () => {
  it("stores a payment's reader and round-trips it", async () => {
    const db = postgres.admin;
    const { tenantId, workingOrderId, readerId } = await seedOrderWithReader(db);

    await withTenant(db, tenantId, async (tx) => {
      await asAppUser(tx);
      await tx.insert(payments).values({
        tenantId,
        workingOrderId,
        readerId,
        provider: "sumup",
        paymentRef: "pay_1",
        amount: "10.00",
        state: "captured",
      });
    });

    const stored = await withTenant(db, tenantId, async (tx) => {
      await asAppUser(tx);
      return tx
        .select()
        .from(payments)
        .where(and(eq(payments.tenantId, tenantId), eq(payments.paymentRef, "pay_1")));
    });
    expect(stored).toHaveLength(1);
    expect(stored[0]!.readerId).toBe(readerId);
  });

  it("rejects a reader naming a DIFFERENT tenant (composite FK)", async () => {
    const db = postgres.admin;
    const own = await seedOrderWithReader(db);
    const foreign = await seedOrderWithReader(db);

    const e = await captureError(() =>
      withTenant(db, own.tenantId, async (tx) => {
        await asAppUser(tx);
        await tx.insert(payments).values({
          tenantId: own.tenantId,
          workingOrderId: own.workingOrderId,
          readerId: foreign.readerId,
          provider: "sumup",
          paymentRef: "pay_cross_tenant",
          amount: "10.00",
          state: "captured",
        });
      }),
    );
    expect(pgErrorCode(e)).toBe("23503"); // foreign_key_violation
  });
});
