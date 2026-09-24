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

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });

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
    // This engine's foreign-key refusal names no key; `readerId` is the statement's one unknown id,
    // so only the reader key can have fired.
    expect(isRefusal(error, FOREIGN_KEY_VIOLATION)).toBe(true);
  });
});
