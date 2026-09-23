import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  UNIQUE_VIOLATION,
  captureError,
  isRefusal,
  engineErrorMessage,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { PAYMENTS_MIGRATIONS } from "../migrations.js";
import { cardReaders } from "./card-readers.js";

// What this suite covers — the shape, the defaults and the unique index — is what a schema can
// still refuse on its own.
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });

describe("card_readers", () => {
  it("stores a reader and rejects a duplicate (provider, provider_ref)", async () => {
    const db = suite.db;

    await withTransaction(db, async (tx) => {
      await tx
        .insert(cardReaders)
        .values({ provider: "sumup", providerRef: "rdr_1", name: "Counter" });
    });

    // Round-trips: the row is readable and its defaults are what the schema promises.
    const stored = await withTransaction(db, (tx) =>
      tx.select().from(cardReaders).where(eq(cardReaders.providerRef, "rdr_1")),
    );
    expect(stored).toHaveLength(1);
    expect(stored[0]!.name).toBe("Counter");
    expect(stored[0]!.provider).toBe("sumup");
    expect(stored[0]!.active).toBe(true);
    expect(stored[0]!.disabledAt).toBeNull();
    expect(stored[0]!.unpairedAt).toBeNull();

    // The (provider, provider_ref) unique rejects a second reader with the same ref.
    const dup = await captureError(() =>
      withTransaction(db, async (tx) => {
        await tx
          .insert(cardReaders)
          .values({ provider: "sumup", providerRef: "rdr_1", name: "Dup" });
      }),
    );
    // SQLite reports a result code on `errcode`, and a duplicate key two ways — a unique index
    // (2067) and a primary key (1555) — so the class comes from `UNIQUE_VIOLATION` (`packages/db/src/sql-state.ts`), which holds both.
    expect(isRefusal(dup, UNIQUE_VIOLATION)).toBe(true);
    // Was `/card_readers_provider_ref_key/`. SQLite names the COLUMNS of the index it refused, not
    // the constraint's name, so the assertion moves to the columns — the same index, said the
    // engine's way. Nothing is lost here: a message naming these two columns can only have come
    // from this index.
    expect(engineErrorMessage(dup)).toMatch(
      /UNIQUE constraint failed: card_readers\.provider, card_readers\.provider_ref/,
    );
  });
});
