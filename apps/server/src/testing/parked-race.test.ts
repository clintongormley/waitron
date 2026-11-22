import { describe, expect, it, vi } from "vitest";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { parkedRace } from "./parked-race.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

describe("parkedRace", () => {
  it("rejects with the first transaction's own error and never starts the second", async () => {
    const failure = new Error("first failed");
    const second = vi.fn(async () => "second");
    await expect(
      parkedRace(
        suite.db,
        async () => {
          throw failure;
        },
        second,
      ),
    ).rejects.toBe(failure);
    expect(second).not.toHaveBeenCalled();
  });

  it("holds the second back behind a first that writes nothing", async () => {
    const settled = await parkedRace(
      suite.db,
      async () => "first",
      async () => "second",
    );
    expect(settled).toEqual([
      { status: "fulfilled", value: "first" },
      { status: "fulfilled", value: "second" },
    ]);
  });

  it("fails when the database lets the second transaction start while the first is open", async () => {
    // `withTransaction` uses only these two members; this one queues nothing.
    const unqueued = {
      withWriteLock: (body: () => Promise<unknown>) => body(),
      execute: () => ({ rows: [] }),
    } as unknown as Database;
    await expect(
      parkedRace(
        unqueued,
        async () => "first",
        async () => "second",
      ),
    ).rejects.toThrow("the second transaction started while the first was still open");
  });
});
