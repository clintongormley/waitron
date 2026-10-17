import { expectedDraftEditForTest } from "./testing/draft-command-fixture.js";
import {
  saveDraftForTest as saveDraft,
  takeOverDraftForTest as takeOverDraft,
} from "./testing/draft-command-fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  locations,
  orderDraftEvents,
  orderDraftLines,
  orderDrafts,
  parties,
  workingOrders,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { persons } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { AppError } from "@waitron/shared";
import { attendanceDayWork, attendanceOperationFacts } from "@waitron/workforce";
import { recordAttendanceFact, type AttendanceRecorder } from "./attendance-capture.js";
import { readAttendanceFacts } from "./attendance-facts.js";
import { discardPartyDrafts, moveDraftsToBill, submitDraft, type Draft } from "./order-drafts.js";
import { OPERATOR, seat, setupPartyVenue, type PartyVenue } from "./testing/party-venue.js";
import { newId } from "@waitron/db";
import { createOpenOrder } from "./working-order.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
let v: PartyVenue, partyId: string, other: string;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-05T09:00:00.987Z"));
  v = await setupPartyVenue(suite.db);
  await suite.db
    .insert(persons)
    .values({ id: OPERATOR, displayName: "Owner", pinHash: "scrypt$00$00" });
  ({ partyId } = await seat(v, await v.table("Draft snapshots")));
  const [row] = await suite.db
    .insert(persons)
    .values({ displayName: "Acting worker", pinHash: "scrypt$00$00" })
    .returning();
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
    const [row] = await tx
      .select({ billId: parties.mainBillId })
      .from(parties)
      .where(eq(parties.id, party));
    return saveDraft(
      tx,
      v.cfg,
      party,
      owner,
      {
        billId: billId ?? row!.billId!,
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
    const [party] = await tx.select().from(parties).where(eq(parties.id, partyId));
    await createOpenOrder(tx, v.cfg, billId, [], "Other bill", {
      partyId,
      existingService: true,
      copyServiceContextFrom: party!.mainBillId!,
    });
  });
  return save(owner, partyId, recordAttendanceFact, billId);
}
const state = async () => ({
  drafts: await suite.db.select().from(orderDrafts),
  lines: await suite.db.select().from(orderDraftLines),
  events: await suite.db.select().from(orderDraftEvents),
  facts: await suite.db.select().from(attendanceOperationFacts),
  days: await suite.db.select().from(attendanceDayWork),
});
async function factsAt(locationId: string = v.cfg.locationId) {
  return run((tx) =>
    readAttendanceFacts(tx, {
      locationId,
      businessDay: "2026-01-05",
      startAt: "2026-01-05T00:00:00Z",
      endAt: "2026-01-06T00:00:00Z",
    }),
  );
}
async function assertSnapshots(
  events: Awaited<ReturnType<typeof state>>["events"],
  at: string,
  actor: string,
) {
  const facts = (await state()).facts.filter((f) => events.some((e) => f.key === `event:${e.id}`));
  expect(facts.map((f) => [f.source, f.key, f.personId, f.locationId, f.at, f.outcome])).toEqual(
    events.map((e) => ["draft", `event:${e.id}`, actor, v.cfg.locationId, at, "qualifying"]),
  );
  for (const event of events)
    expect((await factsAt()).filter((f) => f.key === `event:${event.id}`)).toEqual([
      expect.objectContaining({ personId: actor, locationId: v.cfg.locationId, at }),
    ]);
}
describe("natural draft-event attendance snapshots", () => {
  it("captures creation by its event identity and retains the original location after a later move", async () => {
    await save();
    const { events } = await state();
    expect(events).toHaveLength(1);
    await assertSnapshots(events, "2026-01-05T09:00:00.000Z", OPERATOR);
    const [originalLocation] = await suite.db.select().from(locations);
    const [elsewhere] = await suite.db
      .insert(locations)
      .values({
        ...originalLocation!,
        id: crypto.randomUUID(),
        name: "Elsewhere",
        addressLine1: "Other address",
      })
      .returning();
    await suite.db
      .update(workingOrders)
      .set({ locationId: elsewhere!.id })
      .where(eq(workingOrders.partyId, partyId));
    await assertSnapshots(events, "2026-01-05T09:00:00.000Z", OPERATOR);
    expect(
      (await factsAt(elsewhere!.id)).filter((f) => f.key === `event:${events[0]!.id}`),
    ).toEqual([]);
  });
  it.each([false, true])(
    "takeover snapshots every derived event under the taker (own draft: %s)",
    async (own) => {
      const draft = await save();
      if (own) await saveOtherBill(other);
      const before = await state();
      vi.setSystemTime(new Date("2026-01-05T13:00:00.987Z"));
      await run((tx) =>
        takeOverDraft(tx, v.cfg, partyId, draft.id, other, draft.revision, recordAttendanceFact),
      );
      const events = (await state()).events.filter(
        (e) => !before.events.some((old) => old.id === e.id),
      );
      expect(events.map((e) => e.kind)).toEqual(["taken_over"]);
      await assertSnapshots(events, "2026-01-05T13:00:00.000Z", other);
    },
  );
  it("snapshots submit once and preserves it on a replay the next day", async () => {
    const draft = await save();
    const before = await state();
    vi.setSystemTime(new Date("2026-01-05T14:00:00.987Z"));
    const input = {
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
        locationId: v.cfg.locationId,
      }),
    );
    const events = (await state()).events.filter(
      (e) => !before.events.some((old) => old.id === e.id),
    );
    expect(events).toHaveLength(2);
    await assertSnapshots(events, "2026-01-05T15:00:00.000Z", other);
  });
  it("an absorbed draft retains the mover, original source location and supplied command instant", async () => {
    const from = await save();
    const target = await seat(v, await v.table("Target"));
    const into = await save(OPERATOR, target.partyId);
    await run((tx) =>
      takeOverDraft(tx, v.cfg, partyId, from.id, other, from.revision, recordAttendanceFact),
    );
    await run((tx) =>
      takeOverDraft(tx, v.cfg, target.partyId, into.id, other, into.revision, recordAttendanceFact),
    );
    const before = await state();
    await run((tx) =>
      moveDraftsToBill(tx, v.cfg, from.billId, target.tabId, other, {
        recorder: recordAttendanceFact,
        at: "2026-01-05T16:00:00.987Z",
      }),
    );
    const saved = await state();
    const events = saved.events.filter((e) => !before.events.some((old) => old.id === e.id));
    expect(events.map((e) => [e.draftId, e.kind])).toEqual([[from.id, "discarded"]]);
    await assertSnapshots(events, "2026-01-05T16:00:00.000Z", other);
  });
  it("a natural-event capture refusal rolls back the event, draft and attendance day", async () => {
    const before = await state();
    const refuse: AttendanceRecorder = async (tx, fact) => {
      await recordAttendanceFact(tx, fact);
      if (fact.key.startsWith("event:"))
        throw new AppError("attendance.invalid", { reason: "event snapshot refused" });
    };
    await expect(save(OPERATOR, partyId, refuse)).rejects.toMatchObject({
      code: "attendance.invalid",
    });
    expect(await state()).toEqual(before);
  });
  it("legacy calls without a recorder retain events without workforce writes", async () => {
    const draft: Draft = await save(OPERATOR, partyId, null);
    expect(draft.lines).toHaveLength(1);
    const saved = await state();
    expect(saved.events).toHaveLength(1);
    expect(saved.facts).toEqual([]);
    expect(saved.days).toEqual([]);
  });
});
