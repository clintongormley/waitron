import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { asAppUser, captureError, pgErrorCode, pgErrorMessage, withTransaction } from "@waitron/db";
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

/** Seeds a till/working_order (via the shared payments seed helper) plus one card reader — the
 * rows `payments.reader_id`'s FK points at. */
async function seedOrderWithReader(db: Database): Promise<{
  workingOrderId: string;
  readerId: string;
}> {
  const seeded = await seedWorkingOrder(db, freshNif());
  const reader = await db
    .insert(cardReaders)
    .values({
      provider: "sumup",
      providerRef: `rdr_${seeded.workingOrderId}`,
      name: "Counter",
    })
    .returning({ id: cardReaders.id });
  return {
    workingOrderId: seeded.workingOrderId,
    readerId: reader[0]!.id,
  };
}

describe("payments.reader_id", () => {
  it("stores a payment's reader and round-trips it", async () => {
    const db = postgres.admin;
    const { workingOrderId, readerId } = await seedOrderWithReader(db);

    await withTransaction(db, async (tx) => {
      await asAppUser(tx);
      await tx.insert(payments).values({
        workingOrderId,
        readerId,
        provider: "sumup",
        paymentRef: "pay_1",
        amount: 1000, // the column counts whole cents
        state: "captured",
      });
    });

    const stored = await withTransaction(db, async (tx) => {
      await asAppUser(tx);
      return tx.select().from(payments).where(eq(payments.paymentRef, "pay_1"));
    });
    expect(stored).toHaveLength(1);
    expect(stored[0]!.readerId).toBe(readerId);
  });

  it("refuses a reader that does not exist", async () => {
    const db = postgres.admin;
    const { workingOrderId } = await seedOrderWithReader(db);
    const error = await captureError(() =>
      withTransaction(db, async (tx) => {
        await asAppUser(tx);
        await tx.insert(payments).values({
          workingOrderId,
          readerId: randomUUID(),
          provider: "sumup",
          paymentRef: "pay_missing_reader",
          amount: 1000,
          state: "captured",
        });
      }),
    );
    expect(pgErrorCode(error)).toBe("23503"); // foreign_key_violation
    expect(pgErrorMessage(error)).toMatch(/payments_reader_fk/);
  });
});
