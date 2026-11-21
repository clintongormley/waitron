import { seedPersons } from "@waitron/identity/test/person-rows.js";

import {
  saveDraftForTest as saveDraft,
  takeOverDraftForTest as takeOverDraft,
} from "./testing/draft-command-fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { migrationOptionsFor, manifestSets } from "@waitron/migrations";

import { staffActivity } from "@waitron/workforce";
import { recordAttendanceFact, type AttendanceRecorder } from "./attendance-capture.js";
import { discardPartyDrafts, type Draft } from "./order-drafts.js";
import { setupPartyVenue, seat, OPERATOR, type PartyVenue } from "./testing/party-venue.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
let v: PartyVenue, partyId: string, tabId: string, other: string;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-05T09:00:00.987Z"));
  await seedPersons(suite.db, {
    id: OPERATOR,
    displayName: "Draft author",
    pinHash: "scrypt$00$00",
  });
  v = await setupPartyVenue(suite.db);

  ({ partyId, tabId } = await seat(v, await v.table("Attendance")));
  const [row] = await seedPersons(suite.db, {
    displayName: "Actual taker",
    pinHash: "scrypt$00$00",
  });
  other = row!.id;
});
afterEach(() => vi.useRealTimers());
const line = () => ({
  menuItemId: v.item("Burger"),
  variantId: null,
  menuVersionId: null,
  options: [],
  extras: [],
  note: null,
  quantity: "1",
  courseId: null,
  noMerge: false,
});
const run = <T>(body: Parameters<typeof withTransaction<T>>[1]) => withTransaction(suite.db, body);
function save(draft?: Draft, recorder: AttendanceRecorder | undefined = recordAttendanceFact) {
  return run((tx) =>
    saveDraft(
      tx,
      partyId,
      OPERATOR,
      {
        billId: tabId,
        draftId: draft?.id ?? null,
        revision: draft?.revision ?? 0,
        lines: [line()],
      },
      recorder,
    ),
  );
}
const operations = () =>
  suite.db.select().from(staffActivity).orderBy(staffActivity.firstAt, staffActivity.id);

describe("accepted draft attendance capture", () => {
  it("records the accepted save at its server instant", async () => {
    const first = await save();
    vi.setSystemTime(new Date("2026-01-05T11:00:00Z"));
    await save(first);
    expect((await operations()).map((row) => [row.personId, row.lastAt])).toEqual([
      [OPERATOR, "2026-01-05T11:00:00.000Z"],
    ]);
  });
  it("takeover credits the taker and taking one's own draft again creates no fact", async () => {
    const first = await save();
    vi.setSystemTime(new Date("2026-01-05T12:00:00Z"));
    const taken = await run((tx) =>
      takeOverDraft(tx, partyId, first.id, other, first.revision, recordAttendanceFact),
    );
    vi.setSystemTime(new Date("2026-01-05T16:00:00Z"));
    await run((tx) =>
      takeOverDraft(tx, partyId, first.id, other, taken.revision, recordAttendanceFact),
    );
    expect((await operations()).map((row) => [row.personId, row.lastAt])).toEqual([
      [OPERATOR, "2026-01-05T09:00:00.000Z"],
      [other, "2026-01-05T12:00:00.000Z"],
    ]);
  });
  it("discard records the current operator", async () => {
    await save();
    vi.setSystemTime(new Date("2026-01-05T14:00:00Z"));
    await run((tx) =>
      discardPartyDrafts(tx, partyId, other, {
        recorder: recordAttendanceFact,
      }),
    );
    const before = await operations();
    await run((tx) =>
      discardPartyDrafts(tx, partyId, other, {
        recorder: recordAttendanceFact,
      }),
    );
    expect(await operations()).toEqual(before);
    expect(before.map((row) => [row.personId, row.lastAt])).toEqual([
      [OPERATOR, "2026-01-05T09:00:00.000Z"],
      [other, "2026-01-05T14:00:00.000Z"],
    ]);
  });
});
