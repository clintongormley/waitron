import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedVenue } from "@waitron/db/testing/seed.js";
import { decimal } from "@waitron/shared";
import { clockAtIso } from "./testing/later-sale-date-fixture.js";
import { NO_ADVANCES } from "./issue-moment.js";
import { cardSaleMoment, issueOrderMoment } from "./sale-day.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

/** The sale day an order with no bill row files when its meal ended at `mealEndedAt` and it is
 * issued at `issuedAt`, in a venue in `timeZone`. */
async function mealDayIn(
  timeZone: string,
  mealEndedAt: string,
  issuedAt: string,
): Promise<string | undefined> {
  await seedVenue(suite.db, {
    invoiceLocales: ["en-GB"],
    timeZone,
  });
  const scope = { nodeId: await seedNode(suite.db) };
  const moment = await withTransaction(suite.db, (tx) =>
    issueOrderMoment(
      tx,
      scope,
      { clock: clockAtIso(issuedAt), backend: { assertRecordableAt: () => {} } },
      randomUUID(),
      { lines: [], total: decimal("0") },
      NO_ADVANCES,
      mealEndedAt,
    ),
  );
  return moment.operationDate;
}

describe("issueOrderMoment's sale day", () => {
  it("takes the offset at the instant itself, across the night the clocks go back", async () => {
    // 00:30 summer time on 25 October in Madrid; winter time's offset would say the 24th.
    expect(
      await mealDayIn("Europe/Madrid", "2026-10-24T22:30:00.000Z", "2026-10-28T12:00:00.000Z"),
    ).toBe("2026-10-25");
  });

  it.each([
    // 00:30 in the Canaries, 23:30 in UTC, 01:30 in Madrid.
    ["2026-07-14T23:30:00.000Z", "2026-07-15"],
    // 23:30 in the Canaries, 22:30 in UTC, 00:30 in Madrid.
    ["2026-07-14T22:30:00.000Z", "2026-07-14"],
  ])("reads the venue's zone, not the process's, for %s", async (instant, day) => {
    expect(await mealDayIn("Atlantic/Canary", instant, "2026-07-20T12:00:00.000Z")).toBe(day);
  });
});

describe("cardSaleMoment", () => {
  const card = {
    providerCheckoutStartedAt: null,
    resolutionOutcome: null,
    createdAt: "2026-03-31T21:58:00.000Z",
    settledAt: "2026-03-31T22:01:00.000Z",
  };

  it.each([
    ["a live answer: when it settled", card, card.settledAt],
    [
      "the provider's start of the checkout, ahead of everything else",
      {
        ...card,
        providerCheckoutStartedAt: "2026-03-31T21:58:01.000Z",
        resolutionOutcome: "captured",
      },
      "2026-03-31T21:58:01.000Z",
    ],
    [
      "a resolved row: when it was written",
      { ...card, resolutionOutcome: "captured" },
      card.createdAt,
    ],
    ["nothing, for a card that never settled", { ...card, settledAt: null }, null],
  ])("takes %s", (_case, row, want) => {
    expect(cardSaleMoment(row)).toBe(want);
  });
});
