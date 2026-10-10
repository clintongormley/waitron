import { eq, sql } from "drizzle-orm";
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

  it("a deleted reader frees its provider id; an inactive one keeps it", async () => {
    const db = suite.db;
    const columns = await db.execute<{ name: string }>(
      sql`select name from pragma_table_info('card_readers')`,
    );
    expect(columns.rows.map((row) => row.name)).toContain("deleted_at");
    const [old] = await withTransaction(db, (tx) =>
      tx
        .insert(cardReaders)
        .values({ provider: "sumup", providerRef: "rdr_free", name: "Old", active: false })
        .returning({ id: cardReaders.id }),
    );
    const dup = await captureError(() =>
      withTransaction(db, (tx) =>
        tx.insert(cardReaders).values({ provider: "sumup", providerRef: "rdr_free", name: "Dup" }),
      ),
    );
    expect(isRefusal(dup, UNIQUE_VIOLATION)).toBe(true);
    await withTransaction(db, (tx) =>
      tx
        .update(cardReaders)
        .set({ deletedAt: "2026-10-10T10:00:00.000Z" })
        .where(eq(cardReaders.id, old!.id)),
    );
    const [fresh] = await withTransaction(db, (tx) =>
      tx
        .insert(cardReaders)
        .values({ provider: "sumup", providerRef: "rdr_free", name: "Old" })
        .returning({ id: cardReaders.id }),
    );
    expect(fresh!.id).not.toBe(old!.id);
    const secondLive = await captureError(() =>
      withTransaction(db, (tx) =>
        tx.insert(cardReaders).values({ provider: "sumup", providerRef: "rdr_free", name: "Dup" }),
      ),
    );
    expect(isRefusal(secondLive, UNIQUE_VIOLATION)).toBe(true);
    const rows = await withTransaction(db, (tx) =>
      tx.select().from(cardReaders).where(eq(cardReaders.providerRef, "rdr_free")),
    );
    expect(rows.map((r) => [r.id, r.deletedAt])).toEqual(
      expect.arrayContaining([
        [old!.id, "2026-10-10T10:00:00.000Z"],
        [fresh!.id, null],
      ]),
    );
    expect(rows).toHaveLength(2);
  });
});
