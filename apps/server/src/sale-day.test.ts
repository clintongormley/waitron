import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedVenue } from "@waitron/db/testing/seed.js";
import { cardTakenAt, venueDayOf } from "./sale-day.js";

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

describe("cardTakenAt", () => {
  const card = {
    providerTakenAt: null,
    resolutionOutcome: null,
    createdAt: "2026-03-31T21:58:00.000Z",
    settledAt: "2026-03-31T22:01:00.000Z",
  };

  it.each([
    ["a live answer: when it settled", card, card.settledAt],
    [
      "the provider's own time, ahead of everything else",
      { ...card, providerTakenAt: "2026-03-31T22:00:00.000Z", resolutionOutcome: "captured" },
      "2026-03-31T22:00:00.000Z",
    ],
    [
      "a resolved row: when it was written",
      { ...card, resolutionOutcome: "captured" },
      card.createdAt,
    ],
    ["nothing, for a card that never settled", { ...card, settledAt: null }, null],
  ])("takes %s", (_case, row, want) => {
    expect(cardTakenAt(row)).toBe(want);
  });
});
