import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  CORE_MIGRATIONS,
  FOREIGN_KEY_VIOLATION,
  captureError,
  isRefusal,
  withTransaction,
} from "@waitron/db";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { PAYMENTS_MIGRATIONS } from "../migrations.js";
import { freshNif, seedWorkingOrder } from "../../test/seed.js";
import { cardReaders } from "./card-readers.js";
import { payments } from "./payments.js";

// What this suite covers is the column and its foreign key, which the schema still refuses on its
// own.
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });

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
    const db = suite.db;
    const { workingOrderId, readerId } = await seedOrderWithReader(db);

    await withTransaction(db, async (tx) => {
      await tx.insert(payments).values({
        workingOrderId,
        readerId,
        provider: "sumup",
        paymentRef: "pay_1",
        amount: 1000, // the column counts whole cents
        state: "captured",
      });
    });

    const stored = await withTransaction(db, (tx) =>
      tx.select().from(payments).where(eq(payments.paymentRef, "pay_1")),
    );
    expect(stored).toHaveLength(1);
    expect(stored[0]!.readerId).toBe(readerId);
  });

  it("refuses a reader that does not exist", async () => {
    const db = suite.db;
    const { workingOrderId } = await seedOrderWithReader(db);
    const error = await captureError(() =>
      withTransaction(db, async (tx) => {
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
    // This case cannot match `/payments_reader_fk/` in the message. SQLite reports every
    // foreign-key refusal as the six words `FOREIGN KEY constraint failed` and names neither the
    // constraint nor the column (`packages/db/src/constraint-target.ts`), so this case can no
    // longer tell `payments_reader_fk` from the row's OTHER foreign key onto `working_orders`.
    // What keeps it honest is the statement: `workingOrderId` is a real seeded row and
    // `readerId` is the one unknown id in it, so only the reader key can be what fired.
    expect(isRefusal(error, FOREIGN_KEY_VIOLATION)).toBe(true);
  });
});
