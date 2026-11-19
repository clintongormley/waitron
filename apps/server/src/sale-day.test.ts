import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedVenue } from "@waitron/db/testing/seed.js";
import { venueDayOf } from "./sale-day.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

async function dayIn(timeZone: string, instant: string): Promise<string> {
  await seedVenue(suite.db, {
    invoiceLocales: ["en-GB"],
    timeZone,
  });
  const scope = { nodeId: await seedNode(suite.db) };
  return withTransaction(suite.db, (tx) => venueDayOf(tx, scope, instant));
}

describe("venueDayOf", () => {
  it("takes the offset at the instant itself, across the night the clocks go back", async () => {
    // 00:30 summer time on 25 October in Madrid; winter time's offset would say the 24th.
    expect(await dayIn("Europe/Madrid", "2026-10-24T22:30:00.000Z")).toBe("2026-10-25");
  });

  it.each([
    // 00:30 in the Canaries, 23:30 in UTC, 01:30 in Madrid.
    ["2026-07-14T23:30:00.000Z", "2026-07-15"],
    // 23:30 in the Canaries, 22:30 in UTC, 00:30 in Madrid.
    ["2026-07-14T22:30:00.000Z", "2026-07-14"],
  ])("reads the venue's zone, not the process's, for %s", async (instant, day) => {
    expect(await dayIn("Atlantic/Canary", instant)).toBe(day);
  });
});
