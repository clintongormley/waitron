import { sql } from "drizzle-orm";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { expectedDraftEditForTest } from "./testing/draft-command-fixture.js";
import { firstOpenBillOf } from "./testing/party-bill-of.js";
import {
  saveDraftForTest as saveDraft,
  takeOverDraftForTest as takeOverDraft,
} from "./testing/draft-command-fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { orderEvents, orderDraftLines, orderDrafts, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";

import { manifestSets, migrationOptionsFor } from "@waitron/migrations";

import { attendanceDays, staffActivity } from "@waitron/workforce";
import { recordAttendanceFact, type AttendanceRecorder } from "./attendance-capture.js";

import { readBillEditState } from "./bill-editing.js";
import { discardPartyDrafts, moveDraftsToBill, submitDraft } from "./order-drafts.js";
import { OPERATOR, seat, setupPartyVenue, type PartyVenue } from "./testing/party-venue.js";
import { newId } from "@waitron/db";
import { createOpenOrder } from "./working-order-open.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
let v: PartyVenue, partyId: string, other: string;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-05T09:00:00.987Z"));
  await seedPersons(suite.db, { id: OPERATOR, displayName: "Owner", pinHash: "scrypt$00$00" });
  v = await setupPartyVenue(suite.db);

  ({ partyId } = await seat(v, await v.table("Draft snapshots")));
  const [row] = await seedPersons(suite.db, {
    displayName: "Acting worker",
    pinHash: "scrypt$00$00",
  });
  other = row!.id;
});
afterEach(() => vi.useRealTimers());
const run = <T>(body: Parameters<typeof withTransaction<T>>[1]) => withTransaction(suite.db, body);
function save(
  owner = OPERATOR,
  party = partyId,
  attendance: AttendanceRecorder | null = recordAttendanceFact,
  billId?: string,
) {
  return run(async (tx) => {
    const firstOpen = await firstOpenBillOf(tx, party);
    return saveDraft(
      tx,
      party,
      owner,
      {
        billId: billId ?? firstOpen!,
        draftId: null,
        revision: 0,
        lines: [
          {
            menuItemId: v.item("Burger"),
            variantId: null,
            menuVersionId: null,
            options: [],
            extras: [],
            note: null,
            quantity: "1",
            courseId: null,
            noMerge: false,
          },
        ],
      },
      attendance ?? undefined,
    );
  });
}
async function saveOtherBill(owner: string) {
  const billId = newId();
  await run(async (tx) => {
    const firstOpen = await firstOpenBillOf(tx, partyId);
    await createOpenOrder(tx, v.cfg, billId, [], "Other bill", {
      partyId,
      existingService: true,
      copyServiceContextFrom: firstOpen!,
    });
  });
  return save(owner, partyId, recordAttendanceFact, billId);
}
const state = async () => ({
  drafts: await suite.db.select().from(orderDrafts),
  lines: await suite.db.select().from(orderDraftLines),
  events: await suite.db
    .select()
    .from(orderEvents)
    .where(sql`${orderEvents.kind} like 'draft.%'`),
  facts: await suite.db.select().from(staffActivity),
  days: await suite.db.select().from(attendanceDays),
});

async function assertSnapshots(_events: unknown, at: string, actor: string) {
  expect((await state()).facts.filter((row) => row.personId === actor)).toMatchObject([
    { personId: actor, lastAt: at },
  ]);
}

describe("natural draft-event attendance snapshots", () => {
  it("captures creation by its event identity", async () => {
    await save();
    const { events } = await state();
    expect(events).toHaveLength(1);
    await assertSnapshots(events, "2026-01-05T09:00:00.000Z", OPERATOR);
  });
  it.each([false])(
    "takeover snapshots every derived event under the taker (own draft: %s)",
    async (own) => {
      const draft = await save();
      if (own) await saveOtherBill(other);
      const before = await state();
      vi.setSystemTime(new Date("2026-01-05T13:00:00.987Z"));
      await run((tx) =>
        takeOverDraft(tx, partyId, draft.id, other, draft.revision, recordAttendanceFact),
      );
      const events = (await state()).events.filter(
        (e) => !before.events.some((old) => old.id === e.id),
      );
      expect(events.map((e) => e.kind)).toEqual(["draft.taken_over"]);
      await assertSnapshots(events, "2026-01-05T13:00:00.000Z", other);
    },
  );
  it("snapshots submit once and preserves it on a replay the next day", async () => {
    const draft = await save();
    const before = await state();
    vi.setSystemTime(new Date("2026-01-05T14:00:00.987Z"));
    const input = {
      allergy: { party: { answer: "none" as const, guests: [] }, ticks: [] },
      submissionId: newId(),
      expectedPartyRevision: 0,
      operatorId: OPERATOR,
      expectedEdit: await expectedDraftEditForTest(suite.db, draft),
      draftRevision: draft.revision,
      groups: [{ lineIds: draft.lines.map((l) => l.id), release: "hold" as const }],
    };
    const result = await run((tx) =>
      submitDraft(tx, v.cfg, partyId, draft.id, input, recordAttendanceFact),
    );
    const saved = await state();
    await assertSnapshots(
      saved.events.filter((e) => !before.events.some((old) => old.id === e.id)),
      "2026-01-05T14:00:00.000Z",
      OPERATOR,
    );
    vi.setSystemTime(new Date("2026-01-06T14:00:00Z"));
    expect(
      await run((tx) => submitDraft(tx, v.cfg, partyId, draft.id, input, recordAttendanceFact)),
    ).toEqual(result);
    expect(await state()).toEqual(saved);
  });
  it("discard snapshots all owners' events under the acting worker", async () => {
    await save();
    await saveOtherBill(other);
    const before = await state();
    vi.setSystemTime(new Date("2026-01-05T15:00:00.987Z"));
    await run((tx) =>
      discardPartyDrafts(tx, partyId, other, {
        recorder: recordAttendanceFact,
      }),
    );
    const events = (await state()).events.filter(
      (e) => !before.events.some((old) => old.id === e.id),
    );
    expect(events).toHaveLength(2);
    await assertSnapshots(events, "2026-01-05T15:00:00.000Z", other);
  });
  it("an absorbed draft retains the mover and supplied command instant", async () => {
    const from = await save();
    const target = await seat(v, await v.table("Target"));
    const into = await save(OPERATOR, target.partyId);
    await run((tx) =>
      takeOverDraft(tx, partyId, from.id, other, from.revision, recordAttendanceFact),
    );
    await run((tx) =>
      takeOverDraft(tx, target.partyId, into.id, other, into.revision, recordAttendanceFact),
    );
    const before = await state();
    await run(async (tx) =>
      moveDraftsToBill(
        tx,
        from.billId,
        target.tabId,
        other,
        [
          await readBillEditState(tx, [from.billId, target.tabId].sort()[0]!),
          await readBillEditState(tx, [from.billId, target.tabId].sort()[1]!),
        ],
        {
          recorder: recordAttendanceFact,
          at: "2026-01-05T16:00:00.987Z",
        },
      ),
    );
    const saved = await state();
    const events = saved.events.filter((e) => !before.events.some((old) => old.id === e.id));

    await assertSnapshots(events, "2026-01-05T16:00:00.000Z", other);
  });
});
