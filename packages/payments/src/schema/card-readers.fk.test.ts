import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  UNIQUE_VIOLATION,
  captureError,
  engineErrorMessage,
  isRefusal,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { PAYMENTS_MIGRATIONS } from "../migrations.js";
import { cardReaders } from "./card-readers.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });

describe("card_readers", () => {
  it("stores a reader and rejects a duplicate (provider, provider_ref)", async () => {
    const db = suite.db;

    await withTransaction(db, async (tx) => {
      await tx
        .insert(cardReaders)
        .values({ provider: "sumup", providerRef: "rdr_1", name: "Counter" });
    });

    const stored = await withTransaction(db, (tx) =>
      tx.select().from(cardReaders).where(eq(cardReaders.providerRef, "rdr_1")),
    );
    expect(stored).toHaveLength(1);
    expect(stored[0]!.name).toBe("Counter");
    expect(stored[0]!.provider).toBe("sumup");
    expect(stored[0]!.active).toBe(true);
    expect(stored[0]!.disabledAt).toBeNull();
    expect(stored[0]!.unpairedAt).toBeNull();

    const dup = await captureError(() =>
      withTransaction(db, async (tx) => {
        await tx
          .insert(cardReaders)
          .values({ provider: "sumup", providerRef: "rdr_1", name: "Dup" });
      }),
    );
    expect(isRefusal(dup, UNIQUE_VIOLATION)).toBe(true);
    // This engine names the refused index's COLUMNS, not the constraint.
    expect(engineErrorMessage(dup)).toMatch(
      /UNIQUE constraint failed: card_readers\.provider, card_readers\.provider_ref/,
    );
  });
});
